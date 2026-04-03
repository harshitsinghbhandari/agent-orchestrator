/**
 * Voice Copilot WebSocket Server
 *
 * Standalone server that:
 * 1. Accepts browser WebSocket connections
 * 2. Subscribes to AO SSE events
 * 3. Maintains Gemini Live API session
 * 4. Relays audio to browser
 * 5. Handles function calls for queries
 */

import { WebSocketServer, WebSocket } from "ws";
import {
  GoogleGenAI,
  Modality,
  Type,
  type Session,
  type LiveServerMessage,
  type FunctionDeclaration,
} from "@google/genai";

// V2 function declarations using proper SDK types
const V2_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "list_sessions",
    description: "List active agent sessions with their current status",
    parameters: {
      type: Type.OBJECT,
      properties: {
        status: {
          type: Type.STRING,
          enum: ["working", "stuck", "needs_input", "pr_open", "approved", "all"],
          description: "Filter by session status. Use 'all' to list all sessions.",
        },
      },
    },
  },
  {
    name: "get_session_summary",
    description: "Get summary of what a specific agent session is working on",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionId: {
          type: Type.STRING,
          description: "Session ID like 'ao-94'",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "get_ci_failures",
    description:
      "Get failed CI checks for a session's PR. Use this when asked about CI failures, what broke, or why CI is failing.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionId: {
          type: Type.STRING,
          description:
            "Session ID like 'ao-94'. If omitted, uses the last-discussed session from context.",
        },
      },
    },
  },
  {
    name: "get_review_comments",
    description:
      "Get pending/unresolved review comments for a session's PR. Use this when asked about review feedback or comments.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionId: {
          type: Type.STRING,
          description:
            "Session ID like 'ao-94'. If omitted, uses the last-discussed session from context.",
        },
      },
    },
  },
  {
    name: "get_session_changes",
    description:
      "Get what changed in a session: files modified, lines added/deleted, commit summary. Use this when asked about changes or diffs.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionId: {
          type: Type.STRING,
          description:
            "Session ID like 'ao-94'. If omitted, uses the last-discussed session from context.",
        },
      },
    },
  },
];

const SYSTEM_INSTRUCTION = `You are the voice interface for Agent Orchestrator (AO), a system that manages parallel AI coding agents.

Your role:
- Announce important events concisely (CI failures, review requests, stuck sessions, merge-ready PRs)
- Answer questions about session status and agent activity
- Keep responses brief and actionable — this is spoken audio, not text
- Use session IDs like "ao-94" consistently
- When listing multiple sessions, group by urgency
- If you don't know something, say so and suggest checking the dashboard

Event announcements should be:
- Clear and concise (under 15 seconds of speech)
- Action-oriented ("Session ao-94 needs your attention — CI is failing")
- Not repetitive (don't re-explain what the user already knows)

Conversation context:
- After discussing a specific session, remember it for follow-up queries
- When asked "what failed?" or "show me the comments" without a session ID, use the last-discussed session
- If no session was previously discussed, ask the user to specify one

Available functions:
- list_sessions: List sessions, optionally filtered by status
- get_session_summary: Get detailed summary of a specific session
- get_ci_failures: Get failed CI checks for a session's PR
- get_review_comments: Get unresolved review comments for a session's PR
- get_session_changes: Get what changed in a session (additions, deletions, PR info)

When using functions:
- Always call the function first, then speak based on the results
- For follow-up queries, you can omit the session ID to use the previously discussed session`;

// Dedupe state
const DEDUPE_WINDOW_MS = 30_000;
const recentEvents = new Map<string, number>();

const SPEAKABLE_EVENTS = [
  "ci.failing",
  "review.changes_requested",
  "session.stuck",
  "session.needs_input",
  "merge.ready",
];

function shouldSpeak(sessionId: string, eventType: string): boolean {
  if (!SPEAKABLE_EVENTS.includes(eventType)) return false;
  const now = Date.now();
  const key = `${sessionId}:${eventType}`;
  const lastSeen = recentEvents.get(key);
  if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) return false;
  recentEvents.set(key, now);
  return true;
}

function cleanupDedupeCache(): void {
  const now = Date.now();
  for (const [key, timestamp] of recentEvents.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentEvents.delete(key);
    }
  }
}

// Session state tracking for change detection
interface SessionState {
  id: string;
  status: string;
  activity: string | null;
  ciStatus: string | null;
  reviewDecision: string | null;
  isMergeable: boolean;
}

const previousSessionStates = new Map<string, SessionState>();

interface DashboardCICheck {
  name: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  url?: string;
}

interface DashboardUnresolvedComment {
  url: string;
  path: string;
  author: string;
  body: string;
}

interface DashboardSession {
  id: string;
  projectId: string;
  status: string;
  activity: string | null;
  issueLabel: string | null;
  summary: string | null;
  pr?: {
    number: number;
    url: string;
    title: string;
    branch: string;
    baseBranch: string;
    state: string;
    additions: number;
    deletions: number;
    ciStatus: string;
    ciChecks: DashboardCICheck[];
    reviewDecision: string;
    mergeability: {
      mergeable: boolean;
    };
    unresolvedThreads: number;
    unresolvedComments: DashboardUnresolvedComment[];
  } | null;
}

function detectStateChanges(session: DashboardSession): string[] {
  const events: string[] = [];
  const prev = previousSessionStates.get(session.id);
  const curr: SessionState = {
    id: session.id,
    status: session.status,
    activity: session.activity,
    ciStatus: session.pr?.ciStatus ?? null,
    reviewDecision: session.pr?.reviewDecision ?? null,
    isMergeable: session.pr?.mergeability?.mergeable ?? false,
  };

  if (curr.ciStatus === "failing" && prev?.ciStatus !== "failing") {
    events.push("ci.failing");
  }
  if (curr.reviewDecision === "changes_requested" && prev?.reviewDecision !== "changes_requested") {
    events.push("review.changes_requested");
  }
  if (curr.status === "stuck" && prev?.status !== "stuck") {
    events.push("session.stuck");
  }
  if (
    (curr.status === "needs_input" || curr.activity === "waiting_input" || curr.activity === "blocked") &&
    prev?.status !== "needs_input" && prev?.activity !== "waiting_input" && prev?.activity !== "blocked"
  ) {
    events.push("session.needs_input");
  }
  if (curr.isMergeable && !prev?.isMergeable) {
    events.push("merge.ready");
  }

  previousSessionStates.set(session.id, curr);
  return events;
}

function generateEventMessage(eventType: string, session: DashboardSession): string {
  const label = session.issueLabel
    ? `Session ${session.id} for ${session.issueLabel}`
    : `Session ${session.id}`;

  switch (eventType) {
    case "ci.failing":
      return `${label} has failing CI checks. The PR needs attention.`;
    case "review.changes_requested":
      return `${label} has review comments requesting changes.`;
    case "session.stuck":
      return `${label} appears to be stuck. The agent hasn't made progress recently.`;
    case "session.needs_input":
      return `${label} is waiting for your input. The agent needs human intervention.`;
    case "merge.ready":
      return `${label} is ready to merge. The PR is approved and CI is green.`;
    default:
      return `${label} has an update.`;
  }
}

// Conversation context for V2 session tracking
interface ConversationContext {
  lastSessionId: string | null;
  lastUpdatedAt: number;
}

// Server state
interface VoiceServerState {
  browserClient: WebSocket | null;
  geminiSession: Session | null;
  sseAbortController: AbortController | null;
  isConnected: boolean;
  sessions: DashboardSession[];
  context: ConversationContext;
}

const state: VoiceServerState = {
  browserClient: null,
  geminiSession: null,
  sseAbortController: null,
  isConnected: false,
  sessions: [],
  context: {
    lastSessionId: null,
    lastUpdatedAt: Date.now(),
  },
};

// Browser → Server message types
interface BrowserMessage {
  type: "connect" | "disconnect" | "query";
  text?: string;
}

// Server → Browser message types
interface ServerMessage {
  type: "status" | "audio" | "error" | "text";
  status?: "connecting" | "connected" | "disconnected" | "error";
  data?: string; // Base64 audio or text content
  mimeType?: string;
  error?: string;
}

function sendToBrowser(message: ServerMessage): void {
  if (state.browserClient?.readyState === WebSocket.OPEN) {
    if (message.type === "audio") {
      // Don't log full audio data, just size
      console.log(`[voice] Sending audio to browser (${message.data?.length ?? 0} bytes)`);
    } else {
      console.log(`[voice] Sending to browser:`, JSON.stringify(message));
    }
    state.browserClient.send(JSON.stringify(message));
  }
}

async function fetchSessions(): Promise<DashboardSession[]> {
  try {
    const port = process.env["PORT"] || "3000";
    const res = await fetch(`http://localhost:${port}/api/sessions`);
    if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
    const data = (await res.json()) as { sessions?: DashboardSession[] };
    return data.sessions || [];
  } catch (error) {
    console.error("[voice] Failed to fetch sessions:", error);
    return state.sessions; // Return cached sessions
  }
}

function getAttentionLevel(session: DashboardSession): string {
  if (["merged", "killed", "cleanup", "done", "terminated"].includes(session.status)) {
    return "done";
  }
  if (session.pr?.mergeability?.mergeable) return "merge";
  if (["stuck", "needs_input", "errored"].includes(session.status)) return "respond";
  if (session.activity === "waiting_input" || session.activity === "blocked") return "respond";
  if (session.pr?.ciStatus === "failing" || session.pr?.reviewDecision === "changes_requested") {
    return "review";
  }
  if (session.status === "review_pending") return "pending";
  return "working";
}

function handleListSessions(args: { status?: string }): string {
  const sessions = state.sessions;
  let filtered = sessions;

  if (args.status && args.status !== "all") {
    filtered = sessions.filter((s) => {
      switch (args.status) {
        case "working": return s.status === "working" || s.activity === "active";
        case "stuck": return s.status === "stuck" || s.activity === "idle";
        case "needs_input": return s.status === "needs_input" || s.activity === "waiting_input";
        case "pr_open": return s.status === "pr_open" || s.status === "review_pending";
        case "approved": return s.status === "approved" || s.pr?.reviewDecision === "approved";
        default: return true;
      }
    });
  }

  if (filtered.length === 0) {
    return args.status ? `No sessions match "${args.status}".` : "No active sessions.";
  }

  const lines = [`Found ${filtered.length} session${filtered.length === 1 ? "" : "s"}.`];
  for (const s of filtered) {
    const label = s.issueLabel ? ` (${s.issueLabel})` : "";
    const summary = s.summary ? ` — ${s.summary.slice(0, 60)}` : "";
    lines.push(`• ${s.id}${label}: ${s.status}${summary}`);
  }
  return lines.join("\n");
}

function handleGetSessionSummary(args: { sessionId: string }): string {
  const session = state.sessions.find(
    (s) => s.id === args.sessionId ||
      s.id.toLowerCase() === args.sessionId.toLowerCase() ||
      s.id.endsWith(args.sessionId)
  );

  if (!session) {
    return `Session ${args.sessionId} not found.`;
  }

  const lines = [
    `Session ${session.id}${session.issueLabel ? ` (${session.issueLabel})` : ""}`,
    `Status: ${session.status}`,
    `Attention: ${getAttentionLevel(session)}`,
  ];

  if (session.activity) lines.push(`Activity: ${session.activity}`);
  if (session.summary) lines.push(`Summary: ${session.summary}`);

  if (session.pr) {
    lines.push(`PR: #${session.pr.number} — ${session.pr.title}`);
    lines.push(`CI: ${session.pr.ciStatus}, Review: ${session.pr.reviewDecision}`);
  }

  return lines.join("\n");
}

/**
 * Find a session by ID (supports exact, case-insensitive, and partial matching)
 */
function findSessionById(sessionId: string): DashboardSession | null {
  // Try exact match first
  let session = state.sessions.find((s) => s.id === sessionId);
  if (session) return session;

  // Try case-insensitive match
  session = state.sessions.find((s) => s.id.toLowerCase() === sessionId.toLowerCase());
  if (session) return session;

  // Try partial match (e.g., "94" matches "ao-94")
  session = state.sessions.find((s) => s.id.endsWith(sessionId) || s.id.includes(sessionId));
  return session ?? null;
}

/**
 * Resolve a session from args or context.
 */
function resolveSession(sessionId: string | undefined): { session: DashboardSession | null; error: string | null } {
  if (sessionId) {
    const session = findSessionById(sessionId);
    if (!session) {
      return { session: null, error: `Session ${sessionId} not found. Use list_sessions to see available sessions.` };
    }
    return { session, error: null };
  }

  // Try context
  if (state.context.lastSessionId) {
    const session = findSessionById(state.context.lastSessionId);
    if (session) {
      return { session, error: null };
    }
    return {
      session: null,
      error: `The previous session (${state.context.lastSessionId}) is no longer available. Please specify a session ID.`,
    };
  }

  return {
    session: null,
    error: "No session specified and no previous session in context. Please specify a session ID like 'ao-94'.",
  };
}

/**
 * Handle get_ci_failures function (V2)
 */
function handleGetCIFailures(args: { sessionId?: string }): { result: string; sessionId: string | null } {
  const { session, error } = resolveSession(args.sessionId);
  if (error || !session) {
    return { result: error ?? "Session not found.", sessionId: null };
  }

  if (!session.pr) {
    return { result: `Session ${session.id} doesn't have a PR yet.`, sessionId: session.id };
  }

  const pr = session.pr;
  const failedChecks = pr.ciChecks.filter((c) => c.status === "failed");

  if (failedChecks.length === 0) {
    if (pr.ciStatus === "passing") {
      return { result: `No CI failures in session ${session.id}. All ${pr.ciChecks.length} checks are passing.`, sessionId: session.id };
    }
    if (pr.ciStatus === "pending") {
      return { result: `CI is still running for session ${session.id}. ${pr.ciChecks.length} checks in progress.`, sessionId: session.id };
    }
    return { result: `No CI checks found for session ${session.id}.`, sessionId: session.id };
  }

  const lines: string[] = [];
  lines.push(`Found ${failedChecks.length} failing CI check${failedChecks.length === 1 ? "" : "s"} for session ${session.id}:`);
  for (const check of failedChecks) {
    lines.push(`\n• ${check.name}`);
    if (check.url) lines.push(`  URL: ${check.url}`);
  }
  const passingCount = pr.ciChecks.filter((c) => c.status === "passed").length;
  const pendingCount = pr.ciChecks.filter((c) => c.status === "pending" || c.status === "running").length;
  lines.push(`\nSummary: ${failedChecks.length} failed, ${passingCount} passed, ${pendingCount} pending`);

  return { result: lines.join("\n"), sessionId: session.id };
}

/**
 * Handle get_review_comments function (V2)
 */
function handleGetReviewComments(args: { sessionId?: string }): { result: string; sessionId: string | null } {
  const { session, error } = resolveSession(args.sessionId);
  if (error || !session) {
    return { result: error ?? "Session not found.", sessionId: null };
  }

  if (!session.pr) {
    return { result: `Session ${session.id} doesn't have a PR yet.`, sessionId: session.id };
  }

  const pr = session.pr;
  const comments = pr.unresolvedComments;

  if (comments.length === 0) {
    if (pr.reviewDecision === "approved") {
      return { result: `No pending review comments for session ${session.id}. PR is approved!`, sessionId: session.id };
    }
    if (pr.reviewDecision === "changes_requested") {
      return { result: `Session ${session.id} has changes requested but no specific comments are available.`, sessionId: session.id };
    }
    return { result: `No review comments found for session ${session.id}.`, sessionId: session.id };
  }

  const lines: string[] = [];
  lines.push(`Found ${comments.length} unresolved review comment${comments.length === 1 ? "" : "s"} for session ${session.id}:`);
  for (const comment of comments) {
    lines.push(`\n• From ${comment.author}:`);
    if (comment.path) lines.push(`  File: ${comment.path}`);
    const body = comment.body.length > 200 ? comment.body.slice(0, 197) + "..." : comment.body;
    lines.push(`  "${body}"`);
  }

  return { result: lines.join("\n"), sessionId: session.id };
}

/**
 * Handle get_session_changes function (V2)
 */
function handleGetSessionChanges(args: { sessionId?: string }): { result: string; sessionId: string | null } {
  const { session, error } = resolveSession(args.sessionId);
  if (error || !session) {
    return { result: error ?? "Session not found.", sessionId: null };
  }

  if (!session.pr) {
    return { result: `Session ${session.id} doesn't have a PR yet. No changes to report.`, sessionId: session.id };
  }

  const pr = session.pr;
  const lines: string[] = [];
  lines.push(`Changes in session ${session.id}:`);
  lines.push(`\nPR: #${pr.number} — ${pr.title}`);
  lines.push(`Branch: ${pr.branch} → ${pr.baseBranch}`);
  lines.push(`\nStats: +${pr.additions} additions, -${pr.deletions} deletions`);
  const net = pr.additions - pr.deletions;
  lines.push(`Net change: ${net >= 0 ? "+" : ""}${net} lines`);
  if (session.summary) {
    const summary = session.summary.length > 150 ? session.summary.slice(0, 147) + "..." : session.summary;
    lines.push(`\nSummary: ${summary}`);
  }
  lines.push(`\nPR Status: ${pr.state}`);
  lines.push(`CI: ${pr.ciStatus}`);
  lines.push(`Review: ${pr.reviewDecision}`);

  return { result: lines.join("\n"), sessionId: session.id };
}

/**
 * Execute a function call (V2 with context support)
 */
function executeFunctionCall(name: string, args: Record<string, unknown>): { result: string; sessionId: string | null } {
  console.log(`[voice] Executing function: ${name}`, args);
  let result: string;
  switch (name) {
    case "list_sessions":
      return { result: handleListSessions(args as { status?: string }), sessionId: null };

    case "get_session_summary": {
      const sessionId = (args as { sessionId: string }).sessionId;
      const session = findSessionById(sessionId);
      return { result: handleGetSessionSummary(args as { sessionId: string }), sessionId: session?.id ?? null };
    }

    case "get_ci_failures":
      return handleGetCIFailures(args as { sessionId?: string });

    case "get_review_comments":
      return handleGetReviewComments(args as { sessionId?: string });

    case "get_session_changes":
      return handleGetSessionChanges(args as { sessionId?: string });

    default:
      result = { result: `Unknown function: ${name}. Available: list_sessions, get_session_summary, get_ci_failures, get_review_comments, get_session_changes.`, sessionId: null };
  }
  console.log(`[voice] Function ${name} result:`, result.slice(0, 100) + (result.length > 100 ? "..." : ""));
  return result;
}

async function handleGeminiMessage(message: LiveServerMessage): Promise<void> {
  // Handle audio/text output
  if (message.serverContent?.modelTurn?.parts) {
    console.log(`[voice] Gemini model turn received with ${message.serverContent.modelTurn.parts.length} parts`);
    for (const part of message.serverContent.modelTurn.parts) {
      if (part.inlineData?.data && part.inlineData?.mimeType) {
        sendToBrowser({
          type: "audio",
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType,
        });
      }
      if (part.text) {
        console.log(`[voice] Gemini text: ${part.text}`);
        sendToBrowser({
          type: "text",
          data: part.text,
        });
      }
    }
  }

  // Handle interruptions
  if (message.serverContent?.interrupted) {
    console.log("[voice] Gemini interrupted - clearing browser queue");
    sendToBrowser({ type: "status", status: "error", error: "Interrupted" }); // Hook can interpret status "error" as clear queue
  }

  // Handle function calls
  if (message.toolCall?.functionCalls) {
    console.log(`[voice] Gemini requested ${message.toolCall.functionCalls.length} function calls`);
    for (const fc of message.toolCall.functionCalls) {
      if (!fc.name || !fc.id) continue;

      // Refresh sessions before function call
      state.sessions = await fetchSessions();
      const { result, sessionId } = executeFunctionCall(fc.name, (fc.args as Record<string, unknown>) ?? {});

      // Update conversation context if a session was resolved (V2)
      if (sessionId) {
        state.context.lastSessionId = sessionId;
        state.context.lastUpdatedAt = Date.now();
        console.log(`[voice] Context updated: lastSessionId = ${sessionId}`);
      }

      if (state.geminiSession) {
        console.log(`[voice] Sending tool response for ${fc.name} (${fc.id})`);
        await state.geminiSession.sendToolResponse({
          functionResponses: [
            {
              id: fc.id,
              name: fc.name,
              response: { result },
            },
          ],
        });
      }
    }
  }
}

async function connectToGemini(): Promise<void> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    sendToBrowser({ type: "error", error: "GEMINI_API_KEY not configured" });
    return;
  }

  sendToBrowser({ type: "status", status: "connecting" });

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Using gemini-3.1-flash-live-preview as recommended by SKILL.md
    state.geminiSession = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        tools: [{ functionDeclarations: V2_FUNCTION_DECLARATIONS }],
      },
      callbacks: {
        onopen: () => {
          state.isConnected = true;
          sendToBrowser({ type: "status", status: "connected" });
          console.log("[voice] Connected to Gemini Live API (3.1 Flash)");
        },
        onmessage: handleGeminiMessage,
        onerror: (error) => {
          console.error("[voice] Gemini error:", error);
          sendToBrowser({ type: "error", error: String(error) });
        },
        onclose: () => {
          state.isConnected = false;
          state.geminiSession = null;
          sendToBrowser({ type: "status", status: "disconnected" });
          console.log("[voice] Disconnected from Gemini Live API");
        },
      },
    });
  } catch (error) {
    console.error("[voice] Failed to connect to Gemini:", error);
    sendToBrowser({ type: "error", error: String(error) });
  }
}

async function disconnectFromGemini(): Promise<void> {
  if (state.geminiSession) {
    try {
      await state.geminiSession.close();
    } catch {
      // Ignore close errors
    }
    state.geminiSession = null;
  }
  state.isConnected = false;
  sendToBrowser({ type: "status", status: "disconnected" });
}

async function sendTextToGemini(text: string): Promise<void> {
  if (!state.geminiSession || !state.isConnected) {
    sendToBrowser({ type: "error", error: "Not connected to Gemini" });
    return;
  }

  console.log(`[voice] Sending query to Gemini via sendRealtimeInput: ${text}`);
  // Using sendRealtimeInput for live text as recommended by SKILL.md
  await state.geminiSession.sendRealtimeInput({ text });
}

async function injectEvent(message: string): Promise<void> {
  if (!state.geminiSession || !state.isConnected) {
    console.log(`[voice] Skipping event injection (Gemini not connected): ${message}`);
    return;
  }

  console.log(`[voice] Injecting AO event into Gemini via sendRealtimeInput: ${message}`);
  // Using sendRealtimeInput for live text as recommended by SKILL.md
  await state.geminiSession.sendRealtimeInput({ text: `[AO Event] ${message}` });
}

function startSSESubscription(): void {
  if (state.sseAbortController) {
    state.sseAbortController.abort();
  }

  state.sseAbortController = new AbortController();
  const port = process.env["PORT"] || "3000";
  const sseUrl = `http://localhost:${port}/api/events`;

  console.log("[voice] Starting SSE subscription to", sseUrl);

  // Fetch loop for SSE (Node.js doesn't have EventSource)
  async function pollSSE(): Promise<void> {
    while (!state.sseAbortController?.signal.aborted) {
      try {
        const res = await fetch(sseUrl, {
          signal: state.sseAbortController?.signal,
          headers: { Accept: "text/event-stream" },
        });

        if (!res.ok || !res.body) {
          throw new Error(`SSE connection failed: ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              try {
                const event = JSON.parse(data) as { type?: string; sessions?: DashboardSession[] };
                console.log(`[voice] SSE event received: ${event.type ?? "unknown"}`);
                if (event.type === "snapshot" && event.sessions) {
                  await handleSSESnapshot(event.sessions);
                }
              } catch (err) {
                console.error("[voice] Failed to parse SSE JSON:", err);
              }
            }
          }
        }
      } catch (error: any) {
        if (error.name === "AbortError") break;
        if (state.sseAbortController?.signal.aborted) break;
        console.error("[voice] SSE error:", error);
        // Wait before retry
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  pollSSE().catch(console.error);
}

async function handleSSESnapshot(sessions: DashboardSession[]): Promise<void> {
  state.sessions = sessions;

  // Detect state changes and announce events
  for (const session of sessions) {
    const events = detectStateChanges(session);
    for (const eventType of events) {
      if (shouldSpeak(session.id, eventType)) {
        const message = generateEventMessage(eventType, session);
        console.log("[voice] Announcing:", message);
        await injectEvent(message);
      }
    }
  }

  // Periodic cleanup
  cleanupDedupeCache();
}

function stopSSESubscription(): void {
  if (state.sseAbortController) {
    state.sseAbortController.abort();
    state.sseAbortController = null;
  }
}

async function handleBrowserMessage(data: string): Promise<void> {
  try {
    const message = JSON.parse(data) as BrowserMessage;
    console.log(`[voice] Received from browser:`, message.type);

    switch (message.type) {
      case "connect":
        await connectToGemini();
        startSSESubscription();
        break;

      case "disconnect":
        console.log("[voice] Browser requested disconnect");
        stopSSESubscription();
        await disconnectFromGemini();
        break;

      case "query":
        if (message.text) {
          await sendTextToGemini(message.text);
        }
        break;
    }
  } catch (error) {
    console.error("[voice] Invalid message:", error);
    sendToBrowser({ type: "error", error: "Invalid message format" });
  }
}

// Start WebSocket server
const VOICE_PORT = parseInt(process.env["VOICE_PORT"] || "3002", 10);

const wss = new WebSocketServer({ port: VOICE_PORT });

wss.on("connection", async (ws) => {
  console.log("[voice] Browser connected");

  // Only allow one browser client at a time - must disconnect old session
  if (state.browserClient) {
    console.log("[voice] Closing existing browser connection");
    state.browserClient.close();
    state.browserClient = null;
    stopSSESubscription();
    await disconnectFromGemini();
  }
  
  state.browserClient = ws;

  ws.on("message", (data) => {
    handleBrowserMessage(data.toString()).catch(console.error);
  });

  ws.on("close", () => {
    console.log("[voice] Browser disconnected");
    if (state.browserClient === ws) {
      state.browserClient = null;
      stopSSESubscription();
      disconnectFromGemini().catch(console.error);
      // Reset conversation context (V2)
      state.context.lastSessionId = null;
      state.context.lastUpdatedAt = Date.now();
    }
  });

  ws.on("error", (error) => {
    console.error("[voice] WebSocket error:", error);
  });

  // Send initial status
  sendToBrowser({
    type: "status",
    status: state.isConnected ? "connected" : "disconnected",
  });
});

wss.on("error", (error) => {
  console.error("[voice] Server error:", error);
});

console.log(`[voice] Voice copilot server listening on port ${VOICE_PORT}`);
