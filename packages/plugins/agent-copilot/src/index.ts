import {
  DEFAULT_READY_THRESHOLD_MS,
  DEFAULT_ACTIVE_WINDOW_MS,
  shellEscape,
  readLastJsonlEntry,
  normalizeAgentPermissionMode,
  readLastActivityEntry,
  checkActivityLogState,
  getActivityFallbackState,
  recordTerminalActivity,
  type Agent,
  type AgentSessionInfo,
  type AgentLaunchConfig,
  type ActivityState,
  type ActivityDetection,
  type CostEstimate,
  type PluginModule,
  type ProjectConfig,
  type RuntimeHandle,
  type Session,
  type WorkspaceHooksConfig,
} from "@aoagents/ao-core";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// =============================================================================
// Plugin Manifest
// =============================================================================

export const manifest = {
  name: "copilot",
  slot: "agent" as const,
  description: "Agent plugin: GitHub Copilot CLI",
  version: "0.1.0",
  displayName: "GitHub Copilot",
};

// =============================================================================
// Trusted Folder Management
// =============================================================================

/**
 * Resolve Copilot's config directory.
 * Copilot honors COPILOT_HOME if set; otherwise defaults to ~/.copilot.
 */
function getCopilotConfigDir(): string {
  const fromEnv = process.env["COPILOT_HOME"];
  if (fromEnv && fromEnv.trim()) return fromEnv;
  return join(homedir(), ".copilot");
}

/**
 * Split Copilot's config.json content into a leading "//" comment block and
 * the JSON body. Copilot writes a "// This file is managed automatically"
 * header that strict JSON.parse() would reject.
 */
function splitCopilotConfig(raw: string): { header: string; body: string } {
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    if (trimmed === "" || trimmed.startsWith("//")) {
      i++;
      continue;
    }
    break;
  }
  const header = lines.slice(0, i).join("\n");
  const body = lines.slice(i).join("\n");
  return { header, body };
}

async function readCopilotConfig(
  configPath: string,
): Promise<{ header: string; config: Record<string, unknown> }> {
  let header = "";
  let config: Record<string, unknown> = {};

  try {
    const raw = await readFile(configPath, "utf-8");
    const split = splitCopilotConfig(raw);
    header = split.header;
    if (split.body.trim()) {
      const parsed: unknown = JSON.parse(split.body);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        config = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // ENOENT is fine (first run). Other errors (EACCES, malformed JSON) are
    // also recoverable — fall through with empty config so Copilot's
    // first-launch flow can repopulate it.
  }

  return { header, config };
}

function getTrustedFolders(config: Record<string, unknown>): string[] {
  const existing = config["trustedFolders"];
  return Array.isArray(existing)
    ? existing.filter((v): v is string => typeof v === "string")
    : [];
}

const ENSURE_TRUSTED_MAX_ATTEMPTS = 3;

/**
 * Add `workspacePath` to Copilot's `trustedFolders` list so the agent doesn't
 * block on the "Do you trust the files in this folder?" prompt at startup.
 *
 * Reads {COPILOT_HOME or ~/.copilot}/config.json, appends the path if missing,
 * and writes atomically via a temp file + rename. Preserves the leading
 * "// managed automatically" comment block.
 *
 * Concurrent-safe: re-reads the config immediately before writing and retries
 * if a verifying read shows our entry was clobbered. Without this, two sessions
 * launching simultaneously could each load the pre-existing list, append their
 * own path, and the second writer's atomic rename would lose the first one's
 * entry.
 */
async function ensureFolderTrusted(workspacePath: string): Promise<void> {
  const configDir = getCopilotConfigDir();
  const configPath = join(configDir, "config.json");

  await mkdir(configDir, { recursive: true });

  for (let attempt = 0; attempt < ENSURE_TRUSTED_MAX_ATTEMPTS; attempt++) {
    // Re-read on every attempt so we merge against the latest on-disk state.
    const { header, config } = await readCopilotConfig(configPath);
    const trusted = getTrustedFolders(config);
    if (trusted.includes(workspacePath)) return;

    const merged = [...trusted, workspacePath];
    const nextConfig: Record<string, unknown> = { ...config, trustedFolders: merged };

    const json = JSON.stringify(nextConfig, null, 2);
    const out = header ? `${header.trimEnd()}\n${json}\n` : `${json}\n`;

    const tmpPath = `${configPath}.tmp.${process.pid}.${Date.now()}.${attempt}`;
    await writeFile(tmpPath, out, "utf-8");
    await rename(tmpPath, configPath);

    // Verify a concurrent writer didn't clobber us. If it did, loop and merge.
    const verified = await readCopilotConfig(configPath);
    if (getTrustedFolders(verified.config).includes(workspacePath)) return;
  }
  // Best-effort: don't throw — folder trust is a UX optimization, not a
  // correctness requirement. The dialog will show but Copilot still launches.
}

// =============================================================================
// Copilot Session Discovery
// =============================================================================

/** Resolve the Copilot session-state dir at call time so COPILOT_HOME is honored. */
function getCopilotSessionsDir(): string {
  return join(getCopilotConfigDir(), "session-state");
}

/** TTL for session directory cache (ms). Prevents redundant filesystem scans
 *  when getActivityState and getSessionInfo are called in the same refresh cycle. */
const SESSION_DIR_CACHE_TTL_MS = 30_000;

/** Module-level session directory cache shared across the agent instance lifetime.
 *  Keyed by workspace path, stores the resolved session dir and an expiry timestamp. */
const sessionDirCache = new Map<string, { dir: string | null; expiry: number }>();

/** @internal Clear the session directory cache. Exported for testing only. */
export function _resetSessionDirCache(): void {
  sessionDirCache.clear();
}

interface CopilotWorkspaceYaml {
  id?: string;
  cwd?: string;
  git_root?: string;
  summary?: string;
  updated_at?: string;
}

/**
 * Parse a workspace.yaml file from a Copilot session directory.
 * Copilot writes simple key: value YAML — we parse it without a YAML library.
 */
function parseWorkspaceYaml(content: string): CopilotWorkspaceYaml {
  const result: CopilotWorkspaceYaml = {};
  for (const line of content.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key === "id") result.id = value;
    else if (key === "cwd") result.cwd = value;
    else if (key === "git_root") result.git_root = value;
    else if (key === "summary") result.summary = value;
    else if (key === "updated_at") result.updated_at = value;
  }
  return result;
}

/**
 * Find the Copilot session directory whose workspace.yaml cwd or git_root
 * matches the given workspace path. Returns the most recently modified match.
 * Results are cached to avoid scanning every poll cycle.
 */
async function findCopilotSessionDir(workspacePath: string): Promise<string | null> {
  const cached = sessionDirCache.get(workspacePath);
  if (cached && Date.now() < cached.expiry) {
    return cached.dir;
  }

  const result = await scanForSessionDir(workspacePath);
  sessionDirCache.set(workspacePath, {
    dir: result,
    expiry: Date.now() + SESSION_DIR_CACHE_TTL_MS,
  });
  return result;
}

async function scanForSessionDir(workspacePath: string): Promise<string | null> {
  const sessionsDir = getCopilotSessionsDir();
  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch {
    return null;
  }

  let bestMatch: { dir: string; mtime: number } | null = null;

  for (const entry of entries) {
    const sessionDir = join(sessionsDir, entry);
    const yaml = await readWorkspaceYaml(sessionDir);
    if (!yaml) continue;

    if (yaml.cwd === workspacePath || yaml.git_root === workspacePath) {
      try {
        const s = await stat(sessionDir);
        if (!bestMatch || s.mtimeMs > bestMatch.mtime) {
          bestMatch = { dir: sessionDir, mtime: s.mtimeMs };
        }
      } catch {
        // Skip if stat fails
      }
    }
  }

  return bestMatch?.dir ?? null;
}

/**
 * Read and parse the workspace.yaml in a Copilot session directory.
 * Returns null on missing/unreadable file. Shared between session discovery,
 * getSessionInfo, and getRestoreCommand to avoid duplicating the read.
 */
async function readWorkspaceYaml(sessionDir: string): Promise<CopilotWorkspaceYaml | null> {
  const yamlPath = join(sessionDir, "workspace.yaml");
  try {
    const content = await readFile(yamlPath, "utf-8");
    return parseWorkspaceYaml(content);
  } catch {
    return null;
  }
}

// =============================================================================
// events.jsonl Parsing (for getSessionInfo cost tracking)
// =============================================================================

interface CopilotEventLine {
  type?: string;
  data?: {
    content?: string;
    sessionId?: string;
    outputTokens?: number;
    totalPremiumRequests?: number;
    modelMetrics?: Record<
      string,
      {
        requests?: { count?: number; cost?: number };
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
          reasoningTokens?: number;
        };
      }
    >;
    shutdownType?: string;
    // tool.execution_complete fields
    success?: boolean;
    error?: string;
  };
}

/**
 * Parse the events.jsonl file and extract cost/usage data.
 * Reads only the tail to handle large files efficiently.
 */
async function parseEventsJsonlTail(
  filePath: string,
  maxBytes = 131_072,
): Promise<CopilotEventLine[]> {
  let content: string;
  let offset: number;
  try {
    const { size = 0 } = await stat(filePath);
    offset = Math.max(0, size - maxBytes);
    if (offset === 0) {
      content = await readFile(filePath, "utf-8");
    } else {
      const { open } = await import("node:fs/promises");
      const handle = await open(filePath, "r");
      try {
        const length = size - offset;
        const buffer = Buffer.allocUnsafe(length);
        await handle.read(buffer, 0, length, offset);
        content = buffer.toString("utf-8");
      } finally {
        await handle.close();
      }
    }
  } catch {
    return [];
  }

  const firstNewline = content.indexOf("\n");
  const safeContent = offset > 0 && firstNewline >= 0 ? content.slice(firstNewline + 1) : content;
  const lines: CopilotEventLine[] = [];
  for (const line of safeContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        lines.push(parsed as CopilotEventLine);
      }
    } catch {
      // Skip malformed lines
    }
  }
  return lines;
}

/**
 * Inspect the last line of events.jsonl to detect a failed tool execution.
 * `readLastJsonlEntry()` only returns `type`, so we re-read the tail when the
 * type is `tool.execution_complete` and check `data.success`/`data.error`.
 * Used by getActivityState to distinguish "blocked" from "active/ready/idle".
 */
async function isFailedToolExecution(eventsPath: string): Promise<boolean> {
  // Re-read the tail (tiny — last line is small) and parse the final entry.
  const lines = await parseEventsJsonlTail(eventsPath, 16_384);
  const last = lines.at(-1);
  if (!last || last.type !== "tool.execution_complete") return false;

  const data = last.data;
  if (!data) return false;
  // success: false → permission denied, command failed, etc.
  // error: present → also a failure signal.
  return data.success === false || typeof data.error === "string";
}

/** Extract cost/usage from parsed events.jsonl lines */
function extractCopilotCost(lines: CopilotEventLine[]): CostEstimate | undefined {
  // Prefer the session.shutdown event with aggregate modelMetrics
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line?.type === "session.shutdown" && line.data?.modelMetrics) {
      let inputTokens = 0;
      let outputTokens = 0;

      for (const metrics of Object.values(line.data.modelMetrics)) {
        const usage = metrics.usage;
        if (usage) {
          inputTokens += (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0);
          outputTokens += (usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0);
        }
      }

      if (inputTokens > 0 || outputTokens > 0) {
        // Copilot is subscription-based — report token counts but no USD cost
        return { inputTokens, outputTokens, estimatedCostUsd: 0 };
      }
    }
  }

  // Fallback: sum outputTokens from individual assistant.message events
  let totalOutputTokens = 0;
  for (const line of lines) {
    if (
      line?.type === "assistant.message" &&
      typeof line.data?.outputTokens === "number"
    ) {
      totalOutputTokens += line.data.outputTokens;
    }
  }

  if (totalOutputTokens > 0) {
    return { inputTokens: 0, outputTokens: totalOutputTokens, estimatedCostUsd: 0 };
  }

  return undefined;
}

// =============================================================================
// Process Detection
// =============================================================================

/**
 * TTL cache for `ps -eo pid,tty,args` output. Without this, listing N sessions
 * would spawn N concurrent `ps` processes. The cache ensures `ps` is called at
 * most once per TTL window regardless of how many sessions are being enriched.
 */
let psCache: { output: string; timestamp: number; promise?: Promise<string> } | null = null;
const PS_CACHE_TTL_MS = 5_000;

/** @internal Exported for testing only. */
export { ensureFolderTrusted as _ensureFolderTrusted };

/** Reset the ps cache. Exported for testing only. */
export function resetPsCache(): void {
  psCache = null;
}

async function getCachedProcessList(): Promise<string> {
  const now = Date.now();
  if (psCache && now - psCache.timestamp < PS_CACHE_TTL_MS) {
    if (psCache.promise) return psCache.promise;
    return psCache.output;
  }

  const promise = execFileAsync("ps", ["-eo", "pid,tty,args"], {
    timeout: 5_000,
  }).then(({ stdout }) => {
    if (psCache?.promise === promise) {
      psCache = { output: stdout, timestamp: Date.now() };
    }
    return stdout;
  });

  psCache = { output: "", timestamp: now, promise };

  try {
    return await promise;
  } catch {
    if (psCache?.promise === promise) {
      psCache = null;
    }
    return "";
  }
}

/**
 * Check if a process named "copilot" is running in the given runtime handle's context.
 * Copilot is a native binary — it appears directly as "copilot" in ps output.
 */
async function findCopilotProcess(handle: RuntimeHandle): Promise<number | null> {
  try {
    if (handle.runtimeName === "tmux" && handle.id) {
      const { stdout: ttyOut } = await execFileAsync(
        "tmux",
        ["list-panes", "-t", handle.id, "-F", "#{pane_tty}"],
        { timeout: 5_000 },
      );
      const ttys = ttyOut
        .trim()
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
      if (ttys.length === 0) return null;

      const psOut = await getCachedProcessList();
      if (!psOut) return null;

      const ttySet = new Set(ttys.map((t) => t.replace(/^\/dev\//, "")));
      // Match "copilot" as a word boundary — prevents false positives on
      // names like "copilot-something" or paths that merely contain the substring.
      const processRe = /(?:^|\/)copilot(?:\s|$)/;
      for (const line of psOut.split("\n")) {
        const cols = line.trimStart().split(/\s+/);
        if (cols.length < 3 || !ttySet.has(cols[1] ?? "")) continue;
        const args = cols.slice(2).join(" ");
        if (processRe.test(args)) {
          return parseInt(cols[0] ?? "0", 10);
        }
      }
      return null;
    }

    // For process runtime, check if the PID stored in handle data is alive
    const rawPid = handle.data["pid"];
    const pid = typeof rawPid === "number" ? rawPid : Number(rawPid);
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return pid;
      } catch (err: unknown) {
        if (err instanceof Error && "code" in err && err.code === "EPERM") {
          return pid;
        }
        return null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// Terminal Output Patterns for detectActivity
// =============================================================================

/** Classify Copilot CLI's activity state from terminal output (pure, sync). */
function classifyTerminalOutput(terminalOutput: string): ActivityState {
  if (!terminalOutput.trim()) return "idle";

  const lines = terminalOutput.trim().split("\n");
  const lastLine = lines[lines.length - 1]?.trim() ?? "";

  // If the prompt is visible, the agent is idle
  if (/^[>$#]\s*$/.test(lastLine)) return "idle";

  // Check the bottom of the buffer for Copilot's TUI permission prompts
  const tail = lines.slice(-5).join("\n");
  if (/Do you want to allow this\?/i.test(tail)) return "waiting_input";
  if (/Do you trust the files in this folder\?/i.test(tail)) return "waiting_input";
  if (/\u2191\u2193 to navigate/i.test(tail)) return "waiting_input";

  // Everything else is active
  return "active";
}

// =============================================================================
// Copilot events.jsonl Event Type Mapping
// =============================================================================

/**
 * Map a Copilot events.jsonl event type to an activity state.
 * Returns null for unknown types (caller handles default).
 */
function mapCopilotEventType(
  eventType: string,
): "active" | "ready" | "blocked" | "exited" | null {
  switch (eventType) {
    // Active states — agent is working
    case "session.start":
    case "session.model_change":
    case "user.message":
    case "assistant.turn_start":
    case "tool.execution_start":
      return "active";

    // Ready states — turn completed, waiting for next input
    case "assistant.turn_end":
    case "assistant.message":
      return "ready";

    // Exited — session ended
    case "session.shutdown":
      return "exited";

    // tool.execution_complete with success=false maps to blocked,
    // but that requires inspecting the data field, not just the type.
    // Handled separately in getActivityState.

    default:
      return null;
  }
}

// =============================================================================
// Agent Implementation
// =============================================================================

function createCopilotAgent(): Agent {
  return {
    name: "copilot",
    processName: "copilot",
    promptDelivery: "inline",

    getLaunchCommand(config: AgentLaunchConfig): string {
      const parts: string[] = ["copilot"];

      const permissionMode = normalizeAgentPermissionMode(config.permissions);
      if (permissionMode === "permissionless") {
        parts.push("--allow-all", "--no-ask-user");
      } else if (permissionMode === "auto-edit") {
        parts.push("--allow-tool=write", "--allow-tool='shell(git:*)'");
      } else if (permissionMode === "suggest") {
        parts.push("--mode", "plan");
      }

      if (config.model) {
        parts.push("--model", shellEscape(config.model));
      }

      // Prevent update prompts during agent execution
      parts.push("--no-auto-update");

      // Copilot has no separate `--system-prompt` flag, so we prepend the
      // system prompt onto the user prompt via shell substitution. This keeps
      // long system prompts out of the tmux command buffer (the file is
      // dereferenced at exec time) and matches the pattern used by claude-code.
      const buildPrompt = (): string | null => {
        if (config.systemPromptFile) {
          // $(cat file) ; printf '\n\n' ; <user prompt>
          const promptSuffix = config.prompt ? config.prompt : "";
          // Use printf for portable newlines; fall back to empty user prompt.
          return `"$(cat ${shellEscape(config.systemPromptFile)}; printf '\\n\\n'; printf %s ${shellEscape(promptSuffix)})"`;
        }
        if (config.systemPrompt) {
          const combined = config.prompt
            ? `${config.systemPrompt}\n\n${config.prompt}`
            : config.systemPrompt;
          return shellEscape(combined);
        }
        if (config.prompt) {
          return shellEscape(config.prompt);
        }
        return null;
      };

      const promptArg = buildPrompt();
      if (promptArg) {
        // -i keeps Copilot interactive after the prompt is delivered.
        parts.push("-i", promptArg);
      }

      return parts.join(" ");
    },

    getEnvironment(config: AgentLaunchConfig): Record<string, string> {
      const env: Record<string, string> = {};

      env["AO_SESSION_ID"] = config.sessionId;

      if (config.issueId) {
        env["AO_ISSUE_ID"] = config.issueId;
      }

      // Prevent auto-update prompts during execution
      env["COPILOT_AUTO_UPDATE"] = "false";

      return env;
    },

    detectActivity(terminalOutput: string): ActivityState {
      return classifyTerminalOutput(terminalOutput);
    },

    async isProcessRunning(handle: RuntimeHandle): Promise<boolean> {
      const pid = await findCopilotProcess(handle);
      return pid !== null;
    },

    async getActivityState(
      session: Session,
      readyThresholdMs?: number,
    ): Promise<ActivityDetection | null> {
      const threshold = readyThresholdMs ?? DEFAULT_READY_THRESHOLD_MS;

      // 1. PROCESS CHECK — always first
      const exitedAt = new Date();
      if (!session.runtimeHandle) return { state: "exited", timestamp: exitedAt };
      const running = await this.isProcessRunning(session.runtimeHandle);
      if (!running) return { state: "exited", timestamp: exitedAt };

      if (!session.workspacePath) return null;

      // 2. ACTIONABLE STATES — check AO activity JSONL for waiting_input/blocked
      //    Copilot's native events.jsonl does NOT contain waiting_input events.
      //    Permission prompts only appear in terminal output (TUI dialogs).
      const activityResult = await readLastActivityEntry(session.workspacePath);
      const activityState = checkActivityLogState(activityResult);
      if (activityState) return activityState;

      // 3. NATIVE SIGNAL — read last entry from Copilot's events.jsonl
      const sessionDir = await findCopilotSessionDir(session.workspacePath);
      if (sessionDir) {
        const eventsPath = join(sessionDir, "events.jsonl");
        const entry = await readLastJsonlEntry(eventsPath);
        if (entry) {
          const ageMs = Date.now() - entry.modifiedAt.getTime();
          const timestamp = entry.modifiedAt;
          const activeWindowMs = Math.min(DEFAULT_ACTIVE_WINDOW_MS, threshold);

          // tool.execution_complete with success=false signals a tool failure
          // (permission denied, error, etc). readLastJsonlEntry only returns
          // the type, so we re-read the last line to inspect data.success/error.
          if (entry.lastType === "tool.execution_complete") {
            if (await isFailedToolExecution(eventsPath)) {
              return { state: "blocked", timestamp };
            }
            // Successful tool completion — treat as active (just finished work)
            // with age decay.
            if (ageMs <= activeWindowMs) return { state: "active", timestamp };
            return { state: ageMs > threshold ? "idle" : "ready", timestamp };
          }

          const mappedState = entry.lastType
            ? mapCopilotEventType(entry.lastType)
            : null;

          if (mappedState === "exited") {
            return { state: "exited", timestamp };
          }

          if (mappedState === "active") {
            if (ageMs <= activeWindowMs) return { state: "active", timestamp };
            return { state: ageMs > threshold ? "idle" : "ready", timestamp };
          }

          if (mappedState === "ready") {
            return { state: ageMs > threshold ? "idle" : "ready", timestamp };
          }

          // Unknown event type — use age-based classification
          if (ageMs <= activeWindowMs) return { state: "active", timestamp };
          return { state: ageMs > threshold ? "idle" : "ready", timestamp };
        }
      }

      // 4. JSONL ENTRY FALLBACK — use AO activity JSONL with age-based decay
      const activeWindowMs = Math.min(DEFAULT_ACTIVE_WINDOW_MS, threshold);
      const fallback = getActivityFallbackState(activityResult, activeWindowMs, threshold);
      if (fallback) return fallback;

      return null;
    },

    async recordActivity(session: Session, terminalOutput: string): Promise<void> {
      if (!session.workspacePath) return;
      await recordTerminalActivity(session.workspacePath, terminalOutput, (output: string) =>
        this.detectActivity(output),
      );
    },

    async getSessionInfo(session: Session): Promise<AgentSessionInfo | null> {
      if (!session.workspacePath) return null;

      const sessionDir = await findCopilotSessionDir(session.workspacePath);
      if (!sessionDir) return null;

      const yaml = await readWorkspaceYaml(sessionDir);
      if (!yaml) return null;

      // Use basename() so the fallback works on Windows separators too.
      const agentSessionId = yaml.id ?? (basename(sessionDir) || null);

      // Read events.jsonl for cost tracking
      const eventsPath = join(sessionDir, "events.jsonl");
      const events = await parseEventsJsonlTail(eventsPath);
      const cost = extractCopilotCost(events);

      // Summary from workspace.yaml
      const summary = yaml.summary ?? null;

      return {
        summary,
        summaryIsFallback: !yaml.summary,
        agentSessionId,
        cost,
      };
    },

    async getRestoreCommand(session: Session, project: ProjectConfig): Promise<string | null> {
      if (!session.workspacePath) return null;

      const sessionDir = await findCopilotSessionDir(session.workspacePath);
      if (!sessionDir) return null;

      const yaml = await readWorkspaceYaml(sessionDir);
      if (!yaml) return null;

      const sessionId = yaml.id;
      if (!sessionId) return null;

      const parts: string[] = ["copilot", `--resume=${shellEscape(sessionId)}`];

      const permissionMode = normalizeAgentPermissionMode(project.agentConfig?.permissions);
      if (permissionMode === "permissionless") {
        parts.push("--allow-all", "--no-ask-user");
      } else if (permissionMode === "auto-edit") {
        parts.push("--allow-tool=write", "--allow-tool='shell(git:*)'");
      } else if (permissionMode === "suggest") {
        parts.push("--mode", "plan");
      }

      if (project.agentConfig?.model) {
        parts.push("--model", shellEscape(project.agentConfig.model as string));
      }

      parts.push("--no-auto-update");

      return parts.join(" ");
    },

    async setupWorkspaceHooks(
      workspacePath: string,
      _config: WorkspaceHooksConfig,
    ): Promise<void> {
      // Pre-trust the workspace in {COPILOT_HOME or ~/.copilot}/config.json so
      // Copilot doesn't block at launch on the "Do you trust the files in this
      // folder?" TUI prompt. PATH wrappers (~/.ao/bin/gh, ~/.ao/bin/git) are
      // installed separately by session-manager for all agents.
      //
      // Best-effort: if the config write fails (filesystem error, permission
      // denied), swallow the error rather than aborting session spawn — the
      // user will see the trust dialog but the session will still launch.
      try {
        await ensureFolderTrusted(workspacePath);
      } catch {
        // Trusted-folder management is a UX optimization, not a correctness
        // requirement. Don't fail the spawn over it.
      }
    },

    async postLaunchSetup(session: Session): Promise<void> {
      // Re-ensure folder trust in case the workspace directory was created
      // after setupWorkspaceHooks ran (e.g. worktree timing). Same best-effort
      // semantics as setupWorkspaceHooks.
      if (!session.workspacePath) return;
      try {
        await ensureFolderTrusted(session.workspacePath);
      } catch {
        // See setupWorkspaceHooks comment.
      }
    },
  };
}

// =============================================================================
// Plugin Export
// =============================================================================

export function create(): Agent {
  return createCopilotAgent();
}

export function detect(): boolean {
  try {
    execFileSync("copilot", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export default { manifest, create, detect } satisfies PluginModule<Agent>;
