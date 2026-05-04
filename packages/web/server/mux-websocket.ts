/**
 * Multiplexed WebSocket server for terminal multiplexing.
 * Manages multiple terminal connections over a single persistent WebSocket.
 *
 * Session updates are delivered via polling of Next.js /api/sessions/patches
 * every 3s, then broadcast to all subscribed clients via WebSocket.
 */

import { WebSocketServer, WebSocket } from "ws";
import { homedir, userInfo } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { findTmux, resolveTmuxSession, validateSessionId } from "./tmux-utils.js";

// ─── PTY-leak diagnostics (issue #1639) ─────────────────────────────────────
// Lightweight always-on instrumentation. Each lifecycle event prints a single
// grep-friendly line tagged "[PtyLeak]" so we can correlate PTY counts with
// mux activity over many hours of normal AO use.
//
// Cost: ~50 ms execFileSync(lsof) per logged event. Lifecycle events are
// infrequent compared to PTY data flow, and the periodic sampler runs at 60 s,
// so this stays out of any hot path.

let nextPtyId = 0;
function newPtyId(): number {
  nextPtyId += 1;
  return nextPtyId;
}

function countOpenPtys(): number {
  try {
    const out = execFileSync("lsof", ["-p", String(process.pid), "-nP"], {
      encoding: "utf8",
      timeout: 4000,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024,
    });
    let count = 0;
    for (const line of out.split("\n")) {
      // Match the master multiplexer (/dev/ptmx) and slave PTY paths
      // (/dev/ttys000 .. /dev/ttysNNN on macOS, /dev/pts/N on Linux).
      if (line.includes("/dev/ptmx") || /\/dev\/ttys\d+|\/dev\/pts\/\d+/.test(line)) {
        count += 1;
      }
    }
    return count;
  } catch {
    return -1;
  }
}

function logPty(event: string, fields: Record<string, unknown> = {}): void {
  const ptys = countOpenPtys();
  const ts = new Date().toISOString();
  const payload = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : v}`)
    .join(" ");
  console.log(`[PtyLeak] ts=${ts} event=${event} ptys=${ptys} ${payload}`.trimEnd());
}

export interface MuxDebugSnapshot {
  ts: string;
  ptyCount: number;
  terminalCount: number;
  withPty: number;
  withoutPty: number;
  totalSubscribers: number;
  wsClients: number;
  entries: Array<{
    key: string;
    hasPty: boolean;
    subscribers: number;
    bufferBytes: number;
    reattachAttempts: number;
  }>;
}
// ────────────────────────────────────────────────────────────────────────────

// These types mirror src/lib/mux-protocol.ts exactly.
// tsconfig.server.json constrains rootDir to "server/", so we cannot import
// across the boundary. Keep both in sync when updating the protocol.

// ── Client → Server ──
type ClientMessage =
  | { ch: "terminal"; id: string; type: "data"; data: string; projectId?: string }
  | { ch: "terminal"; id: string; type: "resize"; cols: number; rows: number; projectId?: string }
  | { ch: "terminal"; id: string; type: "open"; projectId?: string; tmuxName?: string }
  | { ch: "terminal"; id: string; type: "close"; projectId?: string }
  | { ch: "system"; type: "ping" }
  | { ch: "subscribe"; topics: "sessions"[] };

// ── Server → Client ──
type ServerMessage =
  | { ch: "terminal"; id: string; type: "data"; data: string; projectId?: string }
  | { ch: "terminal"; id: string; type: "exited"; code: number; projectId?: string }
  | { ch: "terminal"; id: string; type: "opened"; projectId?: string }
  | { ch: "terminal"; id: string; type: "error"; message: string; projectId?: string }
  | { ch: "sessions"; type: "snapshot"; sessions: SessionPatch[] }
  | { ch: "sessions"; type: "error"; error: string }
  | { ch: "system"; type: "pong" }
  | { ch: "system"; type: "error"; message: string };

// Mirrors AttentionLevel in src/lib/types.ts — keep in sync.
type AttentionLevel = "merge" | "action" | "respond" | "review" | "pending" | "working" | "done";

interface SessionPatch {
  id: string;
  status: string;
  activity: string | null;
  attentionLevel: AttentionLevel;
  lastActivityAt: string;
}

/**
 * Manages polling of session patches from Next.js /api/sessions/patches.
 * Broadcasts to all subscribed callbacks.
 * Lazily starts polling on first subscriber, stops when the last one leaves.
 */
export class SessionBroadcaster {
  private subscribers = new Set<(sessions: SessionPatch[]) => void>();
  private errorSubscribers = new Set<(error: string) => void>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private readonly baseUrl: string;

  constructor(nextPort: string) {
    this.baseUrl = `http://localhost:${nextPort}`;
  }

  /**
   * Subscribe to session patches and errors. Returns an unsubscribe function.
   * Sends an immediate snapshot to the new subscriber, then polling updates.
   */
  subscribe(callback: (sessions: SessionPatch[]) => void, onError?: (error: string) => void): () => void {
    const wasEmpty = this.subscribers.size === 0;
    this.subscribers.add(callback);
    if (onError) this.errorSubscribers.add(onError);

    // Immediately send a one-off snapshot to just this new subscriber
    void this.fetchSnapshot().then((result) => {
      if (result.sessions && this.subscribers.has(callback)) {
        try {
          callback(result.sessions);
        } catch {
          // Isolate subscriber errors so one bad subscriber doesn't break others
        }
      } else if (result.error && onError && this.errorSubscribers.has(onError)) {
        try {
          onError(result.error);
        } catch {
          // Isolate subscriber errors
        }
      }
    });

    // Start polling if this is the first subscriber
    if (wasEmpty) {
      this.intervalId = setInterval(() => {
        if (this.polling) return;
        this.polling = true;
        void this.fetchSnapshot()
          .then((result) => {
            if (result.sessions && this.intervalId !== null) this.broadcast(result.sessions);
            else if (result.error && this.intervalId !== null) this.broadcastError(result.error);
          })
          .finally(() => {
            this.polling = false;
          });
      }, 3000);
    }

    return () => {
      this.subscribers.delete(callback);
      if (onError) this.errorSubscribers.delete(onError);
      if (this.subscribers.size === 0) {
        this.disconnect();
      }
    };
  }

  private broadcast(sessions: SessionPatch[]): void {
    for (const callback of this.subscribers) {
      try {
        callback(sessions);
      } catch (err) {
        console.error("[MuxServer] Session broadcast subscriber threw:", err);
      }
    }
  }

  private broadcastError(error: string): void {
    for (const callback of this.errorSubscribers) {
      try {
        callback(error);
      } catch (err) {
        console.error("[MuxServer] Session error subscriber threw:", err);
      }
    }
  }

  /** One-shot HTTP fetch of the current session list. */
  private async fetchSnapshot(): Promise<{ sessions: SessionPatch[] | null; error: string | null }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions/patches`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const msg = `Session fetch failed: HTTP ${res.status}`;
        console.warn(`[SessionBroadcaster] ${msg}`);
        return { sessions: null, error: msg };
      }
      const data = (await res.json()) as { sessions?: SessionPatch[] };
      return { sessions: data.sessions ?? null, error: null };
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[SessionBroadcaster] fetchSnapshot error:", msg);
      return { sessions: null, error: msg };
    }
  }

  private disconnect(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

// node-pty is an optionalDependency — load dynamically
/* eslint-disable @typescript-eslint/consistent-type-imports -- node-pty is optional; static import would crash if missing */
type IPty = import("node-pty").IPty;
let ptySpawn: typeof import("node-pty").spawn | undefined;
/* eslint-enable @typescript-eslint/consistent-type-imports */
try {
  const nodePty = await import("node-pty");
  ptySpawn = nodePty.spawn;
} catch (err) {
  console.warn("[MuxServer] node-pty not available — mux server will be disabled.", err);
}

interface ManagedTerminal {
  id: string;
  tmuxSessionId: string;
  pty: IPty | null;
  /** Diagnostic id of the currently-attached PTY (issue #1639). */
  ptyId: number | null;
  subscribers: Set<(data: string) => void>;
  exitCallbacks: Set<(exitCode: number) => void>;
  buffer: string[];
  bufferBytes: number;
  reattachAttempts: number;
}

const RING_BUFFER_MAX = 50 * 1024; // 50KB max per terminal
const WS_BUFFER_HIGH_WATERMARK = 64 * 1024; // 64KB
const MAX_REATTACH_ATTEMPTS = 3;

/**
 * TerminalManager manages PTY processes independently of WebSocket connections.
 * A single manager instance is shared across all mux connections.
 */
class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private TMUX: string;

  constructor(tmuxPath?: string) {
    this.TMUX = tmuxPath ?? findTmux();
  }

  private terminalKey(id: string, projectId?: string): string {
    return projectId ? `${projectId}:${id}` : id;
  }

  /**
   * Open/attach to a terminal. If already open, just return.
   * If has subscribers but PTY crashed, re-attach.
   */
  open(id: string, projectId?: string, tmuxName?: string): string {
    // Validate and resolve
    if (!validateSessionId(id)) {
      throw new Error(`Invalid session ID: ${id}`);
    }

    // Use provided tmuxName, or reuse from existing terminal entry, or resolve
    const key = this.terminalKey(id, projectId);
    const existing = this.terminals.get(key);
    const tmuxSessionId =
      tmuxName ??
      existing?.tmuxSessionId ??
      resolveTmuxSession(id, this.TMUX, undefined, undefined, projectId);
    if (!tmuxSessionId) {
      throw new Error(`Session not found: ${id}`);
    }

    // Get or create terminal entry
    let terminal = this.terminals.get(key);
    const isNewEntry = !terminal;
    if (!terminal) {
      terminal = {
        id,
        tmuxSessionId,
        pty: null,
        ptyId: null,
        subscribers: new Set(),
        exitCallbacks: new Set(),
        buffer: [],
        bufferBytes: 0,
        reattachAttempts: 0,
      };
      this.terminals.set(key, terminal);
    }

    // If PTY is already attached, we're done
    if (terminal.pty) {
      logPty("open_reuse", {
        key,
        ptyId: terminal.ptyId ?? -1,
        subs: terminal.subscribers.size,
        mapSize: this.terminals.size,
      });
      return tmuxSessionId;
    }
    logPty("open_begin", {
      key,
      newEntry: isNewEntry,
      subs: terminal.subscribers.size,
      mapSize: this.terminals.size,
    });

    // Enable mouse mode
    const mouseProc = spawn(this.TMUX, ["set-option", "-t", tmuxSessionId, "mouse", "on"]);
    mouseProc.on("error", (err) => {
      console.error(`[MuxServer] Failed to set mouse mode for ${tmuxSessionId}:`, err.message);
    });

    // Hide the status bar
    const statusProc = spawn(this.TMUX, ["set-option", "-t", tmuxSessionId, "status", "off"]);
    statusProc.on("error", (err) => {
      console.error(`[MuxServer] Failed to hide status bar for ${tmuxSessionId}:`, err.message);
    });

    // Build environment
    const homeDir = process.env.HOME || homedir();
    const currentUser = process.env.USER || userInfo().username;
    const env = {
      HOME: homeDir,
      SHELL: process.env.SHELL || "/bin/bash",
      USER: currentUser,
      PATH: process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
      TERM: "xterm-256color",
      LANG: process.env.LANG || "en_US.UTF-8",
      TMPDIR: process.env.TMPDIR || "/tmp",
    };

    if (!ptySpawn) {
      throw new Error("node-pty not available");
    }

    // Spawn PTY
    const pty = ptySpawn(this.TMUX, ["attach-session", "-t", tmuxSessionId], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: homeDir,
      env,
    });

    const ptyId = newPtyId();
    terminal.pty = pty;
    terminal.ptyId = ptyId;
    logPty("pty_spawn", {
      key,
      ptyId,
      tmuxSession: tmuxSessionId,
      subs: terminal.subscribers.size,
      mapSize: this.terminals.size,
    });

    // Wire up data events
    pty.onData((data: string) => {
      // Push to all subscribers — isolate each callback so a throw in one
      // (e.g. a closed ws.send) doesn't abort the loop or skip the buffer.
      for (const callback of terminal.subscribers) {
        try {
          callback(data);
        } catch (err) {
          console.error("[MuxServer] Subscriber callback threw:", err);
        }
      }

      // Append to ring buffer
      terminal.buffer.push(data);
      terminal.bufferBytes += Buffer.byteLength(data, "utf8");

      // Trim buffer if over limit
      while (terminal.bufferBytes > RING_BUFFER_MAX && terminal.buffer.length > 0) {
        const removed = terminal.buffer.shift() ?? "";
        terminal.bufferBytes -= Buffer.byteLength(removed, "utf8");
      }
    });

    // Handle PTY exit. Capture ptyId from closure so the log still carries
    // the real id even if unsubscribe already cleared terminal.ptyId.
    const exitPtyId = ptyId;
    pty.onExit(({ exitCode }) => {
      console.log(`[MuxServer] PTY exited for ${id} with code ${exitCode}`);
      // Only clear if this is still the active PTY (defensive — a re-attach
      // could have replaced it with a newer PTY by the time exit fires).
      if (terminal.ptyId === exitPtyId) {
        terminal.pty = null;
        terminal.ptyId = null;
      }
      logPty("pty_exit", {
        key,
        ptyId: exitPtyId,
        exitCode,
        subs: terminal.subscribers.size,
        attempts: terminal.reattachAttempts,
        mapSize: this.terminals.size,
      });

      // Re-attach if subscribers are still present, up to MAX_REATTACH_ATTEMPTS.
      // The cap prevents an unbounded respawn loop when the PTY crashes immediately
      // after every attach (e.g. resource exhaustion or a broken tmux session).
      if (terminal.subscribers.size > 0 && terminal.reattachAttempts < MAX_REATTACH_ATTEMPTS) {
        terminal.reattachAttempts += 1;
        console.log(
          `[MuxServer] Re-attaching to ${id} (attempt ${terminal.reattachAttempts}/${MAX_REATTACH_ATTEMPTS})`,
        );
        logPty("pty_reattach_try", {
          key,
          oldPtyId: exitPtyId,
          attempt: terminal.reattachAttempts,
        });
        try {
          this.open(id, projectId);
          // BUG SUSPECT (issue #1639): counter reset here means MAX never engages
          // when each new PTY exits quickly. Logging keeps the existing behavior
          // intact so we can observe whether the loop actually spins.
          logPty("pty_reattach_counter_reset", {
            key,
            attemptsBefore: terminal.reattachAttempts,
          });
          terminal.reattachAttempts = 0;
          return; // re-attached — don't notify exit
        } catch (err) {
          console.error(`[MuxServer] Failed to re-attach ${id}:`, err);
          logPty("pty_reattach_fail", {
            key,
            attempts: terminal.reattachAttempts,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (terminal.reattachAttempts >= MAX_REATTACH_ATTEMPTS) {
        console.error(`[MuxServer] Max re-attach attempts reached for ${id}, giving up`);
        logPty("pty_reattach_giveup", { key, attempts: terminal.reattachAttempts });
      }

      // Notify subscribers that the terminal has exited (re-attach failed or no subscribers)
      for (const cb of terminal.exitCallbacks) {
        cb(exitCode);
      }
    });

    console.log(`[MuxServer] Opened terminal ${id} (tmux: ${tmuxSessionId})`);
    return tmuxSessionId;
  }

  /**
   * Write data to the PTY if attached
   */
  write(id: string, data: string, projectId?: string): void {
    const terminal = this.terminals.get(this.terminalKey(id, projectId));
    if (terminal?.pty) {
      terminal.pty.write(data);
    }
  }

  /**
   * Resize the PTY if attached
   */
  resize(id: string, cols: number, rows: number, projectId?: string): void {
    const terminal = this.terminals.get(this.terminalKey(id, projectId));
    if (terminal?.pty) {
      terminal.pty.resize(cols, rows);
    }
  }

  /**
   * Subscribe to terminal data. Returns unsubscribe function.
   * Automatically opens the terminal if needed.
   * @param onExit - called when the PTY exits and cannot be re-attached
   */
  subscribe(
    id: string,
    projectId: string | undefined,
    callback: (data: string) => void,
    onExit?: (exitCode: number) => void,
  ): () => void {
    // Ensure terminal is open
    this.open(id, projectId);
    const key = this.terminalKey(id, projectId);
    const terminal = this.terminals.get(key);
    if (!terminal) {
      throw new Error(`Failed to open terminal: ${id}`);
    }

    // Add subscriber
    terminal.subscribers.add(callback);
    if (onExit) terminal.exitCallbacks.add(onExit);

    // Return unsubscribe function
    return () => {
      terminal.subscribers.delete(callback);
      if (onExit) terminal.exitCallbacks.delete(onExit);
      // Kill PTY and clean up when the last subscriber leaves
      if (terminal.subscribers.size === 0) {
        const killedPtyId = terminal.ptyId;
        if (terminal.pty) {
          terminal.pty.kill();
          terminal.pty = null;
          terminal.ptyId = null;
        }
        this.terminals.delete(key);
        logPty("pty_kill_lastsub", {
          key,
          ptyId: killedPtyId ?? -1,
          mapSize: this.terminals.size,
        });
      } else {
        logPty("unsub_keep", {
          key,
          ptyId: terminal.ptyId ?? -1,
          remainingSubs: terminal.subscribers.size,
        });
      }
    };
  }

  /**
   * Diagnostic snapshot of internal state. Used by the periodic sampler and
   * the /debug/pty endpoint (issue #1639).
   */
  getDebugSnapshot(): Omit<MuxDebugSnapshot, "wsClients"> {
    let withPty = 0;
    let withoutPty = 0;
    let totalSubscribers = 0;
    const entries: MuxDebugSnapshot["entries"] = [];
    for (const [key, t] of this.terminals) {
      if (t.pty) withPty += 1;
      else withoutPty += 1;
      totalSubscribers += t.subscribers.size;
      entries.push({
        key,
        hasPty: t.pty !== null,
        subscribers: t.subscribers.size,
        bufferBytes: t.bufferBytes,
        reattachAttempts: t.reattachAttempts,
      });
    }
    return {
      ts: new Date().toISOString(),
      ptyCount: countOpenPtys(),
      terminalCount: this.terminals.size,
      withPty,
      withoutPty,
      totalSubscribers,
      entries,
    };
  }

  /**
   * Get buffered data for a terminal
   */
  getBuffer(id: string, projectId?: string): string {
    const terminal = this.terminals.get(this.terminalKey(id, projectId));
    if (!terminal) return "";
    return terminal.buffer.join("");
  }
}

/**
 * Bundle returned by createMuxWebSocket. Includes the WebSocketServer plus a
 * diagnostic snapshot accessor used by the dev-terminal HTTP /debug/pty
 * endpoint and periodic sampler (issue #1639).
 */
export interface MuxWebSocketBundle {
  wss: WebSocketServer;
  getDebugSnapshot: () => MuxDebugSnapshot;
}

/**
 * Create a mux WebSocket server (noServer mode).
 * Returns the WebSocketServer instance plus a debug snapshot accessor.
 */
export function createMuxWebSocket(tmuxPath?: string): MuxWebSocketBundle | null {
  if (!ptySpawn) {
    console.warn("[MuxServer] node-pty not available — mux WebSocket will be disabled");
    return null;
  }

  const terminalManager = new TerminalManager(tmuxPath);
  const nextPort = process.env.PORT || "3000";
  const broadcaster = new SessionBroadcaster(nextPort);

  const wss = new WebSocketServer({ noServer: true });

  let nextWsId = 0;
  wss.on("connection", (ws) => {
    const wsId = (nextWsId += 1);
    console.log("[MuxServer] New mux connection");
    logPty("ws_connect", { wsId, clients: wss.clients.size });

    const subscriptions = new Map<string, () => void>();
    let sessionUnsubscribe: (() => void) | null = null;
    let missedPongs = 0;
    const MAX_MISSED_PONGS = 3;

    // Heartbeat: send native WebSocket ping every 15s.
    // Browsers automatically respond to native pings with pong frames —
    // no application-level code is needed on the client side.
    const heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        // Send the ping first so it counts as a sent-but-unanswered probe
        ws.ping();
        missedPongs += 1;
        if (missedPongs >= MAX_MISSED_PONGS) {
          console.log("[MuxServer] Too many missed pongs, terminating connection");
          ws.terminate();
        }
      }
    }, 15_000);

    // Native pong resets the missed counter
    ws.on("pong", () => {
      missedPongs = 0;
    });

    /**
     * Handle incoming messages
     */
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString("utf8")) as ClientMessage;

        if (msg.ch === "system") {
          if (msg.type === "ping") {
            const pong: ServerMessage = { ch: "system", type: "pong" };
            ws.send(JSON.stringify(pong));
          }
        } else if (msg.ch === "terminal") {
          const { id, type } = msg;
          const projectId = "projectId" in msg ? msg.projectId : undefined;
          const subscriptionKey = projectId ? `${projectId}:${id}` : id;

          try {
            if (type === "open") {
              // Validate session exists
              terminalManager.open(id, projectId, "tmuxName" in msg ? msg.tmuxName : undefined);

              // Send opened confirmation (idempotent — safe to send on re-open)
              const openedMsg: ServerMessage = {
                ch: "terminal",
                id,
                type: "opened",
                ...(projectId && { projectId }),
              };
              ws.send(JSON.stringify(openedMsg));

              // Subscribe and send history buffer only for new subscribers.
              // Skipping the buffer on re-open prevents duplicate output when
              // MuxProvider re-sends open for all terminals on reconnect.
              if (!subscriptions.has(subscriptionKey)) {
                // Send buffered history to catch up the new subscriber
                const buffer = terminalManager.getBuffer(id, projectId);
                if (buffer) {
                  const bufferMsg: ServerMessage = {
                    ch: "terminal",
                    id,
                    type: "data",
                    data: buffer,
                    ...(projectId && { projectId }),
                  };
                  ws.send(JSON.stringify(bufferMsg));
                }
                const unsub = terminalManager.subscribe(
                  id,
                  projectId,
                  (data) => {
                    const dataMsg: ServerMessage = {
                      ch: "terminal",
                      id,
                      type: "data",
                      data,
                      ...(projectId && { projectId }),
                    };
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(JSON.stringify(dataMsg));
                    }
                  },
                  (exitCode) => {
                    const exitedMsg: ServerMessage = {
                      ch: "terminal",
                      id,
                      type: "exited",
                      code: exitCode,
                      ...(projectId && { projectId }),
                    };
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(JSON.stringify(exitedMsg));
                    }
                  },
                );
                subscriptions.set(subscriptionKey, unsub);
              }
            } else if (type === "data" && "data" in msg) {
              terminalManager.write(id, msg.data, projectId);
            } else if (type === "resize" && "cols" in msg && "rows" in msg) {
              terminalManager.resize(id, msg.cols, msg.rows, projectId);
            } else if (type === "close") {
              // Unsubscribe this client only — TerminalManager is shared across
              // all mux connections so we must not kill the PTY here.
              const unsub = subscriptions.get(subscriptionKey);
              if (unsub) {
                unsub();
                subscriptions.delete(subscriptionKey);
              }
            }
          } catch (err) {
            if (ws.readyState === WebSocket.OPEN) {
              const errorMsg: ServerMessage = {
                ch: "terminal",
                id,
                type: "error",
                message: err instanceof Error ? err.message : String(err),
                ...(projectId && { projectId }),
              };
              ws.send(JSON.stringify(errorMsg));
            }
          }
        } else if (msg.ch === "subscribe") {
          if (msg.topics.includes("sessions") && !sessionUnsubscribe) {
            sessionUnsubscribe = broadcaster.subscribe(
              (sessions) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                if (ws.bufferedAmount > WS_BUFFER_HIGH_WATERMARK) {
                  console.warn("[MuxServer] Skipping session snapshot — socket backpressured");
                  return;
                }
                const snapMsg: ServerMessage = { ch: "sessions", type: "snapshot", sessions };
                ws.send(JSON.stringify(snapMsg));
              },
              (error) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                const errMsg: ServerMessage = { ch: "sessions", type: "error", error };
                ws.send(JSON.stringify(errMsg));
              },
            );
          }
        }
      } catch (err) {
        console.error("[MuxServer] Failed to parse message:", err);
        const errorMsg: ServerMessage = {
          ch: "system",
          type: "error",
          message: "Invalid message format",
        };
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(errorMsg));
        }
      }
    });

    /**
     * Handle connection close
     */
    ws.on("close", () => {
      console.log("[MuxServer] Mux connection closed");
      clearInterval(heartbeatInterval);
      sessionUnsubscribe?.();
      sessionUnsubscribe = null;
      const subCountBefore = subscriptions.size;
      for (const unsub of subscriptions.values()) {
        unsub();
      }
      subscriptions.clear();
      logPty("ws_close", {
        wsId,
        clients: wss.clients.size,
        unsubbed: subCountBefore,
      });
    });

    // In the ws library, "error" is always followed by "close", so the close
    // handler below handles all cleanup.  Log the error here and nothing more.
    ws.on("error", (err) => {
      console.error("[MuxServer] WebSocket error:", err.message);
    });
  });

  console.log("[MuxServer] Mux WebSocket server created (noServer mode)");

  const getDebugSnapshot = (): MuxDebugSnapshot => {
    const inner = terminalManager.getDebugSnapshot();
    return { ...inner, wsClients: wss.clients.size };
  };

  return { wss, getDebugSnapshot };
}
