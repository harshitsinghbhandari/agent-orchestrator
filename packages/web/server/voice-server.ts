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

// Import from library modules instead of duplicating code
import { shouldSpeak, cleanupDedupeCache } from "../src/lib/voice-dedupe.js";
import { validateToken } from "../src/lib/voice-token.js";
import {
  executeFunctionCall,
  createConversationContext,
  type ConversationContext,
} from "../src/lib/voice-functions.js";
import { requestMerge } from "../src/lib/pending-merges.js";
import type { DashboardSession, DashboardOrchestratorLink } from "../src/lib/types.js";

// V4 function declarations using proper SDK types
const V4_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
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
  // V3 functions
  {
    name: "send_message_to_session",
    description:
      "Send a message or command to an agent session. Use this when the user wants to tell an agent to do something, like 'tell ao-25 to fix linting', 'ask ao-94 to add tests', or 'tell the orchestrator to spawn an agent'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionId: {
          type: Type.STRING,
          description:
            "Session ID like 'ao-94' or 'orchestrator' for the orchestrator session. If omitted, uses the focused or last-discussed session.",
        },
        message: {
          type: Type.STRING,
          description:
            "The message to send to the agent. Should be a clear instruction or question.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "focus_session",
    description:
      "Set the focused session for subsequent commands. Use this when the user says 'focus on ao-25' or 'switch to ao-94'. The focused session becomes the default target for commands.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionId: {
          type: Type.STRING,
          description: "Session ID to focus on, like 'ao-94'.",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "follow_session",
    description:
      "Start following a session to receive proactive updates about its progress. Use this when the user says 'follow ao-25' or 'track ao-94'. Following a session means you'll announce CI failures, review comments, and other important events for that session.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionId: {
          type: Type.STRING,
          description: "Session ID to follow, like 'ao-94'. Pass 'none' to stop following.",
        },
      },
      required: ["sessionId"],
    },
  },
  // V4 functions
  {
    name: "merge_pr",
    description:
      "Merge a PR for a session. IMPORTANT: This is a destructive action. Always ask for confirmation first by saying something like 'Are you sure you want to merge PR 15 for session ao-25? Say yes to confirm or no to cancel.' Only proceed after explicit user confirmation.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionId: {
          type: Type.STRING,
          description:
            "Session ID like 'ao-94'. If omitted, uses the focused or last-discussed session.",
        },
        confirmed: {
          type: Type.BOOLEAN,
          description:
            "Whether the user has confirmed the merge. Must be true to proceed. If false or omitted, ask for confirmation first.",
        },
      },
    },
  },
  {
    name: "pause_notifications",
    description:
      "Pause automatic voice notifications/announcements. Use this when the user says 'pause notifications', 'mute', 'be quiet', or 'stop announcing'. You can still respond to direct questions.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "resume_notifications",
    description:
      "Resume automatic voice notifications/announcements. Use this when the user says 'resume notifications', 'unmute', or 'start announcing again'.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

const SYSTEM_INSTRUCTION = `You are the voice interface for Agent Orchestrator (AO), a system that manages parallel AI coding agents.

Your role:
- Announce important events concisely (CI failures, review requests, stuck sessions, merge-ready PRs)
- Answer questions about session status and agent activity
- Send commands to agents when the user asks (e.g., "tell ao-25 to fix linting")
- Merge PRs when requested (with confirmation)
- Keep responses brief and actionable — this is spoken audio, not text
- Use session IDs like "ao-94" consistently
- When listing multiple sessions, group by urgency
- If you don't know something, say so and suggest checking the dashboard

Orchestrator sessions:
- There's a special "orchestrator" session (e.g., "ao-orchestrator") that manages other agents
- Users can send messages to the orchestrator using "tell the orchestrator to...", "orchestrator, spawn an agent", etc.
- When the user says "orchestrator" without a prefix, match it to the session ending in "-orchestrator"
- The orchestrator can spawn new agents, check status, and coordinate tasks

Event announcements should be:
- Clear and concise (under 15 seconds of speech)
- Action-oriented ("Session ao-94 needs your attention — CI is failing")
- Not repetitive (don't re-explain what the user already knows)

Conversation context:
- After discussing a specific session, remember it for follow-up queries
- When asked "what failed?" or "show me the comments" without a session ID, use the last-discussed session
- If no session was previously discussed, ask the user to specify one

Focus and Follow modes:
- When the user says "focus on ao-25", set that as the focused session
- When the user says "follow ao-25", start tracking that session for proactive updates
- The focused session becomes the default target for all commands until changed
- When following a session, proactively announce important events for that session

Merge PR workflow (V4):
- When the user says "merge ao-25" or "merge PR 15", ALWAYS ask for confirmation first
- Say something like: "Are you sure you want to merge PR 15 for session ao-25? Say yes to confirm or no to cancel."
- Only call merge_pr with confirmed=true after the user explicitly says "yes", "confirm", or similar
- If the user says "no" or "cancel", acknowledge and do not merge
- Before merging, verify the PR is approved and CI is passing

Notification control (V4):
- Users can pause notifications with "pause notifications", "mute", "be quiet"
- Users can resume with "resume notifications", "unmute", "start announcing"
- When paused, you will not announce events automatically but will still respond to direct questions

Available functions:
- list_sessions: List sessions, optionally filtered by status
- get_session_summary: Get detailed summary of a specific session
- get_ci_failures: Get failed CI checks for a session's PR
- get_review_comments: Get unresolved review comments for a session's PR
- get_session_changes: Get what changed in a session (additions, deletions, PR info)
- send_message_to_session: Send a message/command to an agent (e.g., "fix linting", "add tests")
- focus_session: Set the focused session for subsequent commands
- follow_session: Start/stop following a session for proactive updates
- merge_pr: Merge a PR (requires confirmation)
- pause_notifications: Pause automatic announcements
- resume_notifications: Resume automatic announcements

When using functions:
- Always call the function first, then speak based on the results
- For follow-up queries, you can omit the session ID to use the focused or previously discussed session
- When sending messages to agents, confirm the action was taken
- For merge_pr, ALWAYS ask for confirmation before calling with confirmed=true`;

// Note: shouldSpeak, cleanupDedupeCache, and DEDUPE_WINDOW_MS are imported from voice-dedupe.ts

// Session state tracking for change detection (server-specific with Map)
interface SessionState {
  id: string;
  status: string;
  activity: string | null;
  ciStatus: string | null;
  reviewDecision: string | null;
  isMergeable: boolean;
}

const previousSessionStates = new Map<string, SessionState>();

// Note: DashboardSession is imported from ../src/lib/types

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

// Note: ConversationContext is imported from ../src/lib/voice-functions

// V4: Cost tracking state
interface CostTracking {
  audioMinutesSent: number;
  audioMinutesReceived: number;
  sessionStartTime: number;
  lastResetTime: number;
}

// Server state
interface VoiceServerState {
  browserClient: WebSocket | null;
  geminiSession: Session | null;
  sseAbortController: AbortController | null;
  isConnected: boolean;
  sessions: DashboardSession[];
  context: ConversationContext;
  lastErrorSentAt?: number;
  // V4: Cost tracking
  costTracking: CostTracking;
  // V4: Session resumption
  geminiSessionHandle: string | null;
  connectionAttempts: number;
}

const state: VoiceServerState = {
  browserClient: null,
  geminiSession: null,
  sseAbortController: null,
  isConnected: false,
  sessions: [],
  context: createConversationContext(),
  lastErrorSentAt: 0,
  costTracking: {
    audioMinutesSent: 0,
    audioMinutesReceived: 0,
    sessionStartTime: Date.now(),
    lastResetTime: Date.now(),
  },
  geminiSessionHandle: null,
  connectionAttempts: 0,
};

// Browser → Server message types
interface BrowserMessage {
  type: "connect" | "disconnect" | "query" | "audio";
  text?: string;
  // V3: Audio data for voice input
  data?: string; // Base64 encoded PCM audio
  mimeType?: string; // e.g., "audio/pcm;rate=16000"
  // V4: Ephemeral token for authentication
  token?: string;
}

// Note: validateToken is imported from ../src/lib/voice-token

// Server → Browser message types
interface ServerMessage {
  type: "status" | "audio" | "error" | "text" | "action" | "interrupt";
  status?: "connecting" | "connected" | "disconnected" | "error";
  data?: string; // Base64 audio or text content
  mimeType?: string;
  error?: string;
  // V3: Action result (e.g., message sent to session)
  action?: {
    type: "send_message" | "merge_pr";
    sessionId: string;
    success: boolean;
    error?: string;
    prNumber?: number;
  };
  // V4: Context updates for the browser
  context?: {
    focusedSessionId?: string | null;
    followingSessionId?: string | null;
    notificationsPaused?: boolean;
  };
  // V4: Cost tracking for the browser
  costTracking?: {
    audioMinutesSent: number;
    audioMinutesReceived: number;
    sessionDurationMinutes: number;
  };
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

/**
 * Convert an orchestrator link to a minimal DashboardSession for voice functions.
 * Orchestrators don't have PRs or the full session data, so we create a minimal representation.
 */
function orchestratorToSession(orchestrator: DashboardOrchestratorLink): DashboardSession {
  return {
    id: orchestrator.id,
    projectId: orchestrator.projectId,
    status: "working",
    activity: "active",
    branch: null,
    issueId: null,
    issueUrl: null,
    issueLabel: orchestrator.projectName,
    issueTitle: `${orchestrator.projectName} Orchestrator`,
    summary: `Orchestrator session for ${orchestrator.projectName}`,
    summaryIsFallback: true,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    pr: null,
    userPrompt: null,
    metadata: { role: "orchestrator" },
  };
}

async function fetchSessions(): Promise<DashboardSession[]> {
  try {
    const port = process.env["PORT"] || "3000";
    const res = await fetch(`http://localhost:${port}/api/sessions`);
    if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
    const data = (await res.json()) as {
      sessions?: DashboardSession[];
      orchestrators?: DashboardOrchestratorLink[];
    };

    // Combine worker sessions with orchestrator sessions
    const workerSessions = data.sessions || [];
    const orchestratorSessions = (data.orchestrators || []).map(orchestratorToSession);

    return [...workerSessions, ...orchestratorSessions];
  } catch (error) {
    console.error("[voice] Failed to fetch sessions:", error);
    return state.sessions; // Return cached sessions
  }
}

// Note: Handler functions are imported from ../src/lib/voice-functions
// The imported executeFunctionCall handles all function routing

async function handleGeminiMessage(message: LiveServerMessage): Promise<void> {
  // Handle audio/text output
  if (message.serverContent?.modelTurn?.parts) {
    console.log(`[voice] Gemini model turn received with ${message.serverContent.modelTurn.parts.length} parts`);
    for (const part of message.serverContent.modelTurn.parts) {
      if (part.inlineData?.data && part.inlineData?.mimeType) {
        // V4: Track received audio cost (Gemini output at 24kHz)
        const durationMs = calculateAudioDurationMs(part.inlineData.data, part.inlineData.mimeType, "received");
        trackAudioCost("received", durationMs);

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
      console.log(`[voice] Executing function: ${fc.name}`, fc.args);
      const funcResult = executeFunctionCall(fc.name, (fc.args as Record<string, unknown>) ?? {}, state.sessions, state.context);
      const { result, sessionId, setFocusedSessionId, setFollowingSessionId, setNotificationsPaused, action } = funcResult;

      // Update conversation context if a session was resolved
      if (sessionId) {
        state.context.lastSessionId = sessionId;
        state.context.lastUpdatedAt = Date.now();
        console.log(`[voice] Context updated: lastSessionId = ${sessionId}`);
      }

      // V3: Update focus/follow state
      if (setFocusedSessionId !== undefined) {
        state.context.focusedSessionId = setFocusedSessionId;
        console.log(`[voice] Context updated: focusedSessionId = ${setFocusedSessionId}`);
      }
      if (setFollowingSessionId !== undefined) {
        state.context.followingSessionId = setFollowingSessionId;
        console.log(`[voice] Context updated: followingSessionId = ${setFollowingSessionId}`);
      }

      // V4: Update notifications paused state
      if (setNotificationsPaused !== undefined) {
        state.context.notificationsPaused = setNotificationsPaused;
        console.log(`[voice] Context updated: notificationsPaused = ${setNotificationsPaused}`);
      }

      // Send context update to browser if any context changed
      if (setFocusedSessionId !== undefined || setFollowingSessionId !== undefined || setNotificationsPaused !== undefined) {
        sendToBrowser({
          type: "status",
          status: "connected",
          context: {
            focusedSessionId: state.context.focusedSessionId,
            followingSessionId: state.context.followingSessionId,
            notificationsPaused: state.context.notificationsPaused,
          },
        });
      }

      // V3: Handle actions (send message to session)
      if (action?.type === "send_message" && action.message) {
        await handleSendMessageAction(action.sessionId, action.message);
      }

      // V4: Handle merge action (uses pending merge flow)
      if (action?.type === "request_merge" && action.prNumber) {
        // Create a pending merge request instead of immediate merge
        const pending = requestMerge(action.sessionId, action.prNumber);
        console.log(`[voice] Created pending merge: ${pending.id} for PR #${action.prNumber}`);

        // Notify browser about the pending merge
        sendToBrowser({
          type: "action",
          action: {
            type: "merge_pr",
            sessionId: action.sessionId,
            prNumber: action.prNumber,
            success: true,
          },
        });
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

// V4: Rate limiting for send_message actions
const MESSAGE_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const MAX_MESSAGES_PER_MINUTE = 10;
const messageRateLimits = new Map<string, number[]>();

function checkMessageRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const times = (messageRateLimits.get(sessionId) || []).filter(
    (t) => now - t < MESSAGE_RATE_LIMIT_WINDOW_MS
  );

  if (times.length >= MAX_MESSAGES_PER_MINUTE) {
    return false;
  }

  times.push(now);
  messageRateLimits.set(sessionId, times);
  return true;
}

/**
 * V3: Send a message to a session via the dashboard API
 * V4: Rate limited to 10 messages per minute per session
 */
async function handleSendMessageAction(sessionId: string, message: string): Promise<void> {
  // V4: Check rate limit
  if (!checkMessageRateLimit(sessionId)) {
    console.log(`[voice] Rate limited: too many messages to ${sessionId}`);
    sendToBrowser({
      type: "action",
      action: {
        type: "send_message",
        sessionId,
        success: false,
        error: "Rate limited: too many messages. Please wait a minute.",
      },
    });
    return;
  }

  const port = process.env["PORT"] || "3000";
  try {
    console.log(`[voice] Sending message to session ${sessionId}: ${message}`);
    const res = await fetch(`http://localhost:${port}/api/sessions/${encodeURIComponent(sessionId)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[voice] Failed to send message to ${sessionId}:`, errorText);
      sendToBrowser({
        type: "action",
        action: {
          type: "send_message",
          sessionId,
          success: false,
          error: errorText || "Failed to send message",
        },
      });
      return;
    }

    console.log(`[voice] Message sent successfully to ${sessionId}`);
    sendToBrowser({
      type: "action",
      action: {
        type: "send_message",
        sessionId,
        success: true,
      },
    });
  } catch (error) {
    console.error(`[voice] Error sending message to ${sessionId}:`, error);
    sendToBrowser({
      type: "action",
      action: {
        type: "send_message",
        sessionId,
        success: false,
        error: String(error),
      },
    });
  }
}

// Note: handleSendMessageAction is called by executeFunctionCall output

// V4: Constants for reconnection
const MAX_RECONNECTION_ATTEMPTS = 3;
const RECONNECTION_BASE_DELAY_MS = 1000;

// V4: Constants for context window compression / session management
const PROACTIVE_RECONNECT_THRESHOLD_MS = 14 * 60 * 1000; // Reconnect at 14 minutes
let sessionLimitCheckInterval: NodeJS.Timeout | null = null;

/**
 * V4: Calculate audio duration from PCM data
 * PCM format: 16-bit samples, mono channel
 * Duration = (bytes / 2) / sampleRate
 *
 * Sample rates:
 * - Sent audio (mic): 16kHz - optimized for voice
 * - Received audio (Gemini): 24kHz - Gemini's native output rate
 */
function calculateAudioDurationMs(
  base64Data: string,
  mimeType: string,
  direction: "sent" | "received" = "received"
): number {
  try {
    const bytes = Buffer.from(base64Data, "base64").length;
    // Extract sample rate from mimeType (e.g., "audio/pcm;rate=16000")
    const rateMatch = mimeType.match(/rate=(\d+)/);
    // Default rate depends on direction: sent=16kHz (mic), received=24kHz (Gemini)
    const defaultRate = direction === "sent" ? 16000 : 24000;
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : defaultRate;
    const samples = bytes / 2; // 16-bit = 2 bytes per sample
    return (samples / sampleRate) * 1000;
  } catch {
    return 0;
  }
}

/**
 * V4: Track audio cost and send updates to browser
 */
function trackAudioCost(type: "sent" | "received", durationMs: number): void {
  const durationMinutes = durationMs / 60000;

  if (type === "sent") {
    state.costTracking.audioMinutesSent += durationMinutes;
  } else {
    state.costTracking.audioMinutesReceived += durationMinutes;
  }

  // Send cost update every 10 seconds of audio or when significant
  const totalMinutes = state.costTracking.audioMinutesSent + state.costTracking.audioMinutesReceived;
  if (totalMinutes > 0 && Math.floor(totalMinutes * 6) !== Math.floor((totalMinutes - durationMinutes) * 6)) {
    sendCostUpdate();
  }
}

/**
 * V4: Send cost update to browser
 */
function sendCostUpdate(): void {
  const sessionDurationMinutes = (Date.now() - state.costTracking.sessionStartTime) / 60000;
  sendToBrowser({
    type: "status",
    status: "connected",
    costTracking: {
      audioMinutesSent: Math.round(state.costTracking.audioMinutesSent * 100) / 100,
      audioMinutesReceived: Math.round(state.costTracking.audioMinutesReceived * 100) / 100,
      sessionDurationMinutes: Math.round(sessionDurationMinutes * 100) / 100,
    },
  });
}

/**
 * V4: Check if session is approaching limit and reconnect proactively
 */
function checkSessionLimit(): void {
  if (!state.isConnected || !state.costTracking.sessionStartTime) return;

  const sessionDuration = Date.now() - state.costTracking.sessionStartTime;
  if (sessionDuration >= PROACTIVE_RECONNECT_THRESHOLD_MS) {
    console.log(
      `[voice] Session approaching 15-min limit (${Math.round(sessionDuration / 60000)}min), reconnecting proactively`,
    );

    // Reset cost tracking for new session
    state.costTracking.sessionStartTime = Date.now();

    // Disconnect and reconnect
    disconnectFromGemini().then(() => {
      if (state.browserClient?.readyState === WebSocket.OPEN) {
        connectToGemini();
      }
    });
  }
}

/**
 * V4: Start session limit check interval
 */
function startSessionLimitCheck(): void {
  if (sessionLimitCheckInterval) {
    clearInterval(sessionLimitCheckInterval);
  }
  // Check every minute
  sessionLimitCheckInterval = setInterval(checkSessionLimit, 60000);
}

/**
 * V4: Stop session limit check interval
 */
function stopSessionLimitCheck(): void {
  if (sessionLimitCheckInterval) {
    clearInterval(sessionLimitCheckInterval);
    sessionLimitCheckInterval = null;
  }
}

async function connectToGemini(): Promise<void> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    sendToBrowser({ type: "error", error: "GEMINI_API_KEY not configured" });
    return;
  }

  sendToBrowser({ type: "status", status: "connecting" });
  state.connectionAttempts++;
  state.costTracking.sessionStartTime = Date.now();

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
        tools: [{ functionDeclarations: V4_FUNCTION_DECLARATIONS }],
      },
      callbacks: {
        onopen: () => {
          state.isConnected = true;
          state.connectionAttempts = 0; // Reset on successful connection
          // V4: Start session limit check
          startSessionLimitCheck();
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
          console.log("[voice] Disconnected from Gemini Live API");

          // V4: Attempt to reconnect if browser is still connected
          if (state.browserClient?.readyState === WebSocket.OPEN) {
            attemptReconnection();
          } else {
            sendToBrowser({ type: "status", status: "disconnected" });
          }
        },
      },
    });
  } catch (error) {
    console.error("[voice] Failed to connect to Gemini:", error);
    sendToBrowser({ type: "error", error: String(error) });

    // V4: Attempt to reconnect on connection failure
    if (state.browserClient?.readyState === WebSocket.OPEN) {
      attemptReconnection();
    }
  }
}

/**
 * V4: Attempt to reconnect to Gemini with exponential backoff
 * Preserves context across reconnections
 */
async function attemptReconnection(): Promise<void> {
  if (state.connectionAttempts >= MAX_RECONNECTION_ATTEMPTS) {
    console.log(`[voice] Max reconnection attempts (${MAX_RECONNECTION_ATTEMPTS}) reached`);
    sendToBrowser({ type: "status", status: "disconnected" });
    sendToBrowser({
      type: "error",
      error: "Connection lost. Please reconnect manually.",
    });
    state.connectionAttempts = 0;
    return;
  }

  const delay = RECONNECTION_BASE_DELAY_MS * Math.pow(2, state.connectionAttempts);
  console.log(
    `[voice] Attempting reconnection ${state.connectionAttempts + 1}/${MAX_RECONNECTION_ATTEMPTS} in ${delay}ms`,
  );

  sendToBrowser({
    type: "status",
    status: "connecting",
    context: {
      focusedSessionId: state.context.focusedSessionId,
      followingSessionId: state.context.followingSessionId,
      notificationsPaused: state.context.notificationsPaused,
    },
  });

  await new Promise((resolve) => setTimeout(resolve, delay));

  // Check if browser is still connected before attempting reconnection
  if (state.browserClient?.readyState === WebSocket.OPEN) {
    await connectToGemini();
  }
}

async function disconnectFromGemini(): Promise<void> {
  // V4: Reset connection attempts on explicit disconnect
  state.connectionAttempts = MAX_RECONNECTION_ATTEMPTS; // Prevent auto-reconnect
  // V4: Stop session limit check
  stopSessionLimitCheck();
  if (state.geminiSession) {
    try {
      await state.geminiSession.close();
    } catch {
      // Ignore close errors
    }
    state.geminiSession = null;
  }
  state.isConnected = false;
  state.connectionAttempts = 0; // Reset for next manual connect
  sendToBrowser({ type: "status", status: "disconnected" });
}

async function sendTextToGemini(text: string): Promise<void> {
  if (!state.geminiSession || !state.isConnected) {
    const reason = !state.geminiSession ? "Session not initialized" : "Wait for 'connected' status";
    sendToBrowser({ type: "error", error: `Not connected to Gemini (${reason})` });
    return;
  }

  console.log(`[voice] Sending query to Gemini via sendRealtimeInput: ${text}`);
  // Using sendRealtimeInput for live text as recommended by SKILL.md
  await state.geminiSession.sendRealtimeInput({ text });
}

/**
 * V3: Send audio data to Gemini Live API
 */
async function sendAudioToGemini(audioData: string, mimeType: string): Promise<void> {
  if (!state.geminiSession || !state.isConnected) {
    // Basic rate limit for errors to browser
    const now = Date.now();
    if (!state.lastErrorSentAt || now - state.lastErrorSentAt > 3000) {
      state.lastErrorSentAt = now;
      const reason = !state.geminiSession ? "Session not initialized" : "Wait for 'connected' status";
      sendToBrowser({ type: "error", error: `Not connected to Gemini (${reason})` });
    }
    return;
  }

  // V4: Track audio cost (sent audio from mic at 16kHz)
  const durationMs = calculateAudioDurationMs(audioData, mimeType, "sent");
  trackAudioCost("sent", durationMs);

  // Send audio as realtime input
  // The SDK expects it in { audio: { data, mimeType } } format, NOT { media: ... }
  // data should be base64 string
  await state.geminiSession.sendRealtimeInput({
    audio: {
      data: audioData,
      mimeType: mimeType,
    },
  });
}

async function injectEvent(message: string): Promise<void> {
  if (!state.geminiSession || !state.isConnected) {
    console.log(`[voice] Skipping event injection (Gemini not connected): ${message}`);
    return;
  }

  // V4: Check if notifications are paused
  if (state.context.notificationsPaused) {
    console.log(`[voice] Skipping event injection (notifications paused): ${message}`);
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
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") break;
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
    // Don't log audio data (too noisy)
    if (message.type !== "audio") {
      console.log(`[voice] Received from browser:`, message.type);
    }

    switch (message.type) {
      case "connect": {
        // V4: Validate token using voice-token.ts
        const validation = validateToken(message.token || "");
        if (!validation.valid) {
          console.log(`[voice] Token validation failed: ${validation.error}`);
          sendToBrowser({
            type: "error",
            error: `Authentication failed: ${validation.error}`,
          });
          return;
        }
        console.log("[voice] Token validated successfully");
        await connectToGemini();
        startSSESubscription();
        break;
      }

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

      // V3: Handle audio input from browser
      case "audio":
        if (message.data && message.mimeType) {
          await sendAudioToGemini(message.data, message.mimeType);
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
const HEARTBEAT_INTERVAL_MS = 30_000;

// Allowed origins for WebSocket connections
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  process.env["AO_ALLOWED_ORIGIN"],
].filter(Boolean) as string[];

const wss = new WebSocketServer({ port: VOICE_PORT });

wss.on("connection", async (ws, request) => {
  // V4: Origin checking
  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    console.log(`[voice] Rejected connection from origin: ${origin}`);
    ws.close(4003, "Origin not allowed");
    return;
  }

  console.log("[voice] Browser connected", origin ? `from ${origin}` : "");

  // Only allow one browser client at a time - must disconnect old session
  if (state.browserClient) {
    console.log("[voice] Closing existing browser connection");
    state.browserClient.close();
    state.browserClient = null;
    stopSSESubscription();
    await disconnectFromGemini();
  }

  state.browserClient = ws;

  // V4: Heartbeat to detect stale connections
  let isAlive = true;
  const heartbeat = setInterval(() => {
    if (!isAlive) {
      console.log("[voice] Client unresponsive, terminating");
      clearInterval(heartbeat);
      ws.terminate();
      return;
    }
    isAlive = false;
    ws.ping();
  }, HEARTBEAT_INTERVAL_MS);

  ws.on("pong", () => {
    isAlive = true;
  });

  ws.on("message", (data) => {
    handleBrowserMessage(data.toString()).catch(console.error);
  });

  ws.on("close", () => {
    console.log("[voice] Browser disconnected");
    clearInterval(heartbeat);
    if (state.browserClient === ws) {
      state.browserClient = null;
      stopSSESubscription();
      disconnectFromGemini().catch(console.error);
      // Reset conversation context (V4)
      state.context.lastSessionId = null;
      state.context.lastUpdatedAt = Date.now();
      state.context.focusedSessionId = null;
      state.context.followingSessionId = null;
      state.context.notificationsPaused = false;
    }
  });

  ws.on("error", (error) => {
    console.error("[voice] WebSocket error:", error);
    clearInterval(heartbeat);
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
