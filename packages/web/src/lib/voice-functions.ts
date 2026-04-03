/**
 * Voice function implementations for Gemini Live API.
 *
 * MVP functions:
 * - list_sessions: List active agent sessions with their current status
 * - get_session_summary: Get summary of what a specific agent session is working on
 *
 * V2 functions:
 * - get_ci_failures: Get failed CI checks for a session's PR
 * - get_review_comments: Get pending review comments for a session's PR
 * - get_session_changes: Get what changed in a session (files, additions/deletions)
 *
 * V3 functions:
 * - send_message_to_session: Send a message/command to a specific agent session
 * - focus_session: Set the focused session for follow-up commands
 * - follow_session: Start following a session (sets focus + announces updates)
 */

import { getAttentionLevel, type DashboardSession, type AttentionLevel } from "./types";

// =============================================================================
// CONVERSATION CONTEXT (V2)
// =============================================================================

/**
 * Conversation context for session resolution.
 * Tracks the last-discussed session to enable follow-up queries without repeating session IDs.
 * V3: Adds focus/follow mode for targeted session interactions.
 */
export interface ConversationContext {
  /** Last discussed session ID (set after each function that resolves a session) */
  lastSessionId: string | null;
  /** Timestamp of the last context update */
  lastUpdatedAt: number;
  /** V3: Focused session ID (user explicitly said "focus on X") */
  focusedSessionId: string | null;
  /** V3: Following session ID (actively tracking updates for this session) */
  followingSessionId: string | null;
}

/**
 * Create a new empty conversation context
 */
export function createConversationContext(): ConversationContext {
  return {
    lastSessionId: null,
    lastUpdatedAt: Date.now(),
    focusedSessionId: null,
    followingSessionId: null,
  };
}

/**
 * Result from a voice function, includes the response text and optional session ID for context updates.
 */
export interface FunctionResult {
  /** The response text to send to Gemini */
  result: string;
  /** Session ID to update context with (null if no session was resolved) */
  sessionId: string | null;
  /** V3: Set the focused session (user said "focus on X") */
  setFocusedSessionId?: string | null;
  /** V3: Set the following session (user said "follow X") */
  setFollowingSessionId?: string | null;
  /** V3: Action to perform (send message to session) */
  action?: {
    type: "send_message";
    sessionId: string;
    message: string;
  };
}

/**
 * Find a session by ID (supports exact, case-insensitive, and partial matching)
 */
function findSessionById(sessionId: string, sessions: DashboardSession[]): DashboardSession | null {
  // Try exact match first
  let session = sessions.find((s) => s.id === sessionId);
  if (session) return session;

  // Try case-insensitive match
  session = sessions.find((s) => s.id.toLowerCase() === sessionId.toLowerCase());
  if (session) return session;

  // Try partial match (e.g., "94" matches "ao-94")
  session = sessions.find((s) => s.id.endsWith(sessionId) || s.id.includes(sessionId));
  return session ?? null;
}

/**
 * Resolve a session from args or context.
 * Returns the session and any error message.
 * V3: Now checks focusedSessionId before lastSessionId.
 */
function resolveSession(
  sessionId: string | undefined,
  sessions: DashboardSession[],
  context: ConversationContext,
): { session: DashboardSession | null; error: string | null } {
  // If session ID provided, use it
  if (sessionId) {
    const session = findSessionById(sessionId, sessions);
    if (!session) {
      return { session: null, error: `Session ${sessionId} not found. Use list_sessions to see available sessions.` };
    }
    return { session, error: null };
  }

  // V3: Try focused session first (user explicitly said "focus on X")
  if (context.focusedSessionId) {
    const session = findSessionById(context.focusedSessionId, sessions);
    if (session) {
      return { session, error: null };
    }
    // Focused session no longer exists - don't error, fall through to lastSessionId
  }

  // Try to use context
  if (context.lastSessionId) {
    const session = findSessionById(context.lastSessionId, sessions);
    if (session) {
      return { session, error: null };
    }
    // Context session no longer exists
    return {
      session: null,
      error: `The previous session (${context.lastSessionId}) is no longer available. Please specify a session ID.`,
    };
  }

  // No session ID and no context
  return {
    session: null,
    error: "No session specified and no previous session in context. Please specify a session ID like 'ao-94'.",
  };
}

/**
 * Truncate text for voice output (keeps it brief for TTS)
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}

// =============================================================================
// FUNCTION DECLARATIONS
// =============================================================================

/**
 * Function declarations for Gemini Live API
 */
export const MVP_TOOLS = [
  {
    name: "list_sessions",
    description: "List active agent sessions with their current status",
    parameters: {
      type: "object" as const,
      properties: {
        status: {
          type: "string" as const,
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
      type: "object" as const,
      properties: {
        sessionId: {
          type: "string" as const,
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
      type: "object" as const,
      properties: {
        sessionId: {
          type: "string" as const,
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
      type: "object" as const,
      properties: {
        sessionId: {
          type: "string" as const,
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
      type: "object" as const,
      properties: {
        sessionId: {
          type: "string" as const,
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
      "Send a message or command to an agent session. Use this when the user wants to tell an agent to do something, like 'tell ao-25 to fix linting' or 'ask ao-94 to add tests'.",
    parameters: {
      type: "object" as const,
      properties: {
        sessionId: {
          type: "string" as const,
          description:
            "Session ID like 'ao-94'. If omitted, uses the focused or last-discussed session.",
        },
        message: {
          type: "string" as const,
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
      type: "object" as const,
      properties: {
        sessionId: {
          type: "string" as const,
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
      type: "object" as const,
      properties: {
        sessionId: {
          type: "string" as const,
          description: "Session ID to follow, like 'ao-94'. Pass null or 'none' to stop following.",
        },
      },
      required: ["sessionId"],
    },
  },
];

/**
 * Session filter status (maps to session statuses + special values)
 */
type FilterStatus = "working" | "stuck" | "needs_input" | "pr_open" | "approved" | "all";

/**
 * Minimal session info for voice response
 */
interface SessionInfo {
  id: string;
  status: string;
  attentionLevel: AttentionLevel;
  summary: string | null;
  issueLabel: string | null;
}

/**
 * Filter sessions by status
 */
function filterSessionsByStatus(
  sessions: DashboardSession[],
  status?: FilterStatus,
): DashboardSession[] {
  if (!status || status === "all") {
    return sessions;
  }

  return sessions.filter((session) => {
    switch (status) {
      case "working":
        return (
          session.status === "working" ||
          session.status === "spawning" ||
          session.activity === "active"
        );
      case "stuck":
        return session.status === "stuck" || session.activity === "idle";
      case "needs_input":
        return (
          session.status === "needs_input" ||
          session.activity === "waiting_input" ||
          session.activity === "blocked"
        );
      case "pr_open":
        return session.status === "pr_open" || session.status === "review_pending";
      case "approved":
        return (
          session.status === "approved" ||
          session.status === "mergeable" ||
          (session.pr?.reviewDecision === "approved" && session.pr?.ciStatus === "passing")
        );
      default:
        return true;
    }
  });
}

/**
 * Convert a session to minimal voice info
 */
function toSessionInfo(session: DashboardSession): SessionInfo {
  return {
    id: session.id,
    status: session.status,
    attentionLevel: getAttentionLevel(session),
    summary: session.summary,
    issueLabel: session.issueLabel,
  };
}

/**
 * Handle list_sessions function call
 *
 * @param args Function arguments from Gemini
 * @param sessions Current session list (fetched from API)
 * @returns Human-readable response string
 */
export function handleListSessions(
  args: { status?: FilterStatus },
  sessions: DashboardSession[],
): string {
  const filtered = filterSessionsByStatus(sessions, args.status);

  if (filtered.length === 0) {
    if (args.status && args.status !== "all") {
      return `No sessions match the filter "${args.status}".`;
    }
    return "No active sessions found.";
  }

  // Group by attention level for better voice output
  const byAttention = new Map<AttentionLevel, SessionInfo[]>();
  for (const session of filtered) {
    const info = toSessionInfo(session);
    const existing = byAttention.get(info.attentionLevel) ?? [];
    existing.push(info);
    byAttention.set(info.attentionLevel, existing);
  }

  // Build response
  const lines: string[] = [];
  const totalCount = filtered.length;
  lines.push(`Found ${totalCount} session${totalCount === 1 ? "" : "s"}.`);

  // Priority order for voice
  const attentionOrder: AttentionLevel[] = [
    "merge",
    "respond",
    "review",
    "pending",
    "working",
    "done",
  ];

  for (const level of attentionOrder) {
    const sessionsAtLevel = byAttention.get(level);
    if (!sessionsAtLevel || sessionsAtLevel.length === 0) continue;

    const levelLabel = getLevelLabel(level);
    lines.push(`\n${levelLabel}:`);

    for (const session of sessionsAtLevel) {
      const label = session.issueLabel ? ` (${session.issueLabel})` : "";
      const summaryPart = session.summary ? ` — ${truncateSummary(session.summary)}` : "";
      lines.push(`• ${session.id}${label}: ${session.status}${summaryPart}`);
    }
  }

  return lines.join("\n");
}

/**
 * Handle get_session_summary function call
 *
 * @param args Function arguments from Gemini
 * @param sessions Current session list (fetched from API)
 * @returns Human-readable response string
 */
export function handleGetSessionSummary(
  args: { sessionId: string },
  sessions: DashboardSession[],
): string {
  const sessionId = args.sessionId;

  // Try exact match first
  let session = sessions.find((s) => s.id === sessionId);

  // Try case-insensitive match
  if (!session) {
    session = sessions.find((s) => s.id.toLowerCase() === sessionId.toLowerCase());
  }

  // Try partial match (e.g., "94" matches "ao-94")
  if (!session) {
    session = sessions.find(
      (s) => s.id.endsWith(sessionId) || s.id.includes(sessionId),
    );
  }

  if (!session) {
    return `Session ${sessionId} not found. Use list_sessions to see available sessions.`;
  }

  const lines: string[] = [];

  // Basic info
  const label = session.issueLabel ? ` (${session.issueLabel})` : "";
  lines.push(`Session ${session.id}${label}`);
  lines.push(`Status: ${session.status}`);
  lines.push(`Attention level: ${getLevelLabel(getAttentionLevel(session))}`);

  if (session.activity) {
    lines.push(`Activity: ${session.activity}`);
  }

  // Summary
  if (session.summary) {
    lines.push(`\nSummary: ${session.summary}`);
  } else {
    lines.push(`\nNo summary available.`);
  }

  // PR info
  if (session.pr) {
    const pr = session.pr;
    lines.push(`\nPR: #${pr.number} — ${pr.title}`);
    lines.push(`URL: ${pr.url}`);
    lines.push(`CI: ${pr.ciStatus}`);
    lines.push(`Review: ${pr.reviewDecision}`);

    if (pr.unresolvedThreads > 0) {
      lines.push(`Unresolved comments: ${pr.unresolvedThreads}`);
    }

    if (pr.mergeability.mergeable) {
      lines.push(`Ready to merge: yes`);
    } else if (pr.mergeability.blockers.length > 0) {
      lines.push(`Blockers: ${pr.mergeability.blockers.join(", ")}`);
    }
  } else {
    lines.push(`\nNo PR created yet.`);
  }

  return lines.join("\n");
}

/**
 * Handle get_ci_failures function call
 *
 * @param args Function arguments from Gemini
 * @param sessions Current session list
 * @param context Conversation context for session resolution
 * @returns Human-readable response string and resolved session ID
 */
export function handleGetCIFailures(
  args: { sessionId?: string },
  sessions: DashboardSession[],
  context: ConversationContext,
): FunctionResult {
  const { session, error } = resolveSession(args.sessionId, sessions, context);
  if (error || !session) {
    return { result: error ?? "Session not found.", sessionId: null };
  }

  if (!session.pr) {
    return {
      result: `Session ${session.id} doesn't have a PR yet.`,
      sessionId: session.id,
    };
  }

  const pr = session.pr;
  const failedChecks = pr.ciChecks.filter((c) => c.status === "failed");

  if (failedChecks.length === 0) {
    if (pr.ciStatus === "passing") {
      return {
        result: `No CI failures in session ${session.id}. All ${pr.ciChecks.length} checks are passing.`,
        sessionId: session.id,
      };
    }
    if (pr.ciStatus === "pending") {
      return {
        result: `CI is still running for session ${session.id}. ${pr.ciChecks.length} checks in progress.`,
        sessionId: session.id,
      };
    }
    return {
      result: `No CI checks found for session ${session.id}.`,
      sessionId: session.id,
    };
  }

  const lines: string[] = [];
  lines.push(`Found ${failedChecks.length} failing CI check${failedChecks.length === 1 ? "" : "s"} for session ${session.id}:`);

  for (const check of failedChecks) {
    lines.push(`\n• ${check.name}`);
    if (check.url) {
      lines.push(`  URL: ${check.url}`);
    }
  }

  // Add summary
  const passingCount = pr.ciChecks.filter((c) => c.status === "passed").length;
  const pendingCount = pr.ciChecks.filter((c) => c.status === "pending" || c.status === "running").length;
  lines.push(`\nSummary: ${failedChecks.length} failed, ${passingCount} passed, ${pendingCount} pending`);

  return { result: lines.join("\n"), sessionId: session.id };
}

/**
 * Handle get_review_comments function call
 *
 * @param args Function arguments from Gemini
 * @param sessions Current session list
 * @param context Conversation context for session resolution
 * @returns Human-readable response string and resolved session ID
 */
export function handleGetReviewComments(
  args: { sessionId?: string },
  sessions: DashboardSession[],
  context: ConversationContext,
): FunctionResult {
  const { session, error } = resolveSession(args.sessionId, sessions, context);
  if (error || !session) {
    return { result: error ?? "Session not found.", sessionId: null };
  }

  if (!session.pr) {
    return {
      result: `Session ${session.id} doesn't have a PR yet.`,
      sessionId: session.id,
    };
  }

  const pr = session.pr;
  const comments = pr.unresolvedComments;

  if (comments.length === 0) {
    if (pr.reviewDecision === "approved") {
      return {
        result: `No pending review comments for session ${session.id}. PR is approved!`,
        sessionId: session.id,
      };
    }
    if (pr.reviewDecision === "changes_requested") {
      return {
        result: `Session ${session.id} has changes requested but no specific comments are available.`,
        sessionId: session.id,
      };
    }
    return {
      result: `No review comments found for session ${session.id}.`,
      sessionId: session.id,
    };
  }

  const lines: string[] = [];
  lines.push(`Found ${comments.length} unresolved review comment${comments.length === 1 ? "" : "s"} for session ${session.id}:`);

  for (const comment of comments) {
    lines.push(`\n• From ${comment.author}:`);
    if (comment.path) {
      lines.push(`  File: ${comment.path}`);
    }
    // Truncate long comments for voice output
    const body = truncateText(comment.body, 200);
    lines.push(`  "${body}"`);
  }

  return { result: lines.join("\n"), sessionId: session.id };
}

/**
 * Handle get_session_changes function call
 *
 * @param args Function arguments from Gemini
 * @param sessions Current session list
 * @param context Conversation context for session resolution
 * @returns Human-readable response string and resolved session ID
 */
export function handleGetSessionChanges(
  args: { sessionId?: string },
  sessions: DashboardSession[],
  context: ConversationContext,
): FunctionResult {
  const { session, error } = resolveSession(args.sessionId, sessions, context);
  if (error || !session) {
    return { result: error ?? "Session not found.", sessionId: null };
  }

  if (!session.pr) {
    return {
      result: `Session ${session.id} doesn't have a PR yet. No changes to report.`,
      sessionId: session.id,
    };
  }

  const pr = session.pr;
  const lines: string[] = [];

  lines.push(`Changes in session ${session.id}:`);
  lines.push(`\nPR: #${pr.number} — ${pr.title}`);
  lines.push(`Branch: ${pr.branch} → ${pr.baseBranch}`);
  lines.push(`\nStats: +${pr.additions} additions, -${pr.deletions} deletions`);

  // Calculate net change
  const net = pr.additions - pr.deletions;
  const netLabel = net >= 0 ? `+${net}` : `${net}`;
  lines.push(`Net change: ${netLabel} lines`);

  // Add summary if available
  if (session.summary) {
    lines.push(`\nSummary: ${truncateText(session.summary, 150)}`);
  }

  // Add status info
  lines.push(`\nPR Status: ${pr.state}`);
  lines.push(`CI: ${pr.ciStatus}`);
  lines.push(`Review: ${pr.reviewDecision}`);

  return { result: lines.join("\n"), sessionId: session.id };
}

/**
 * Get human-readable label for attention level
 */
function getLevelLabel(level: AttentionLevel): string {
  switch (level) {
    case "merge":
      return "Ready to merge";
    case "respond":
      return "Needs response";
    case "review":
      return "Needs review";
    case "pending":
      return "Pending";
    case "working":
      return "Working";
    case "done":
      return "Done";
    default:
      return level;
  }
}

/**
 * Truncate summary for voice output
 */
function truncateSummary(summary: string, maxLength = 80): string {
  if (summary.length <= maxLength) {
    return summary;
  }
  return summary.slice(0, maxLength - 3) + "...";
}

// =============================================================================
// V3 FUNCTIONS
// =============================================================================

/**
 * Handle send_message_to_session function call
 *
 * @param args Function arguments from Gemini
 * @param sessions Current session list
 * @param context Conversation context for session resolution
 * @returns Function result with action to send message
 */
export function handleSendMessageToSession(
  args: { sessionId?: string; message: string },
  sessions: DashboardSession[],
  context: ConversationContext,
): FunctionResult {
  const { session, error } = resolveSession(args.sessionId, sessions, context);
  if (error || !session) {
    return { result: error ?? "Session not found.", sessionId: null };
  }

  if (!args.message || args.message.trim().length === 0) {
    return {
      result: "No message provided. Please specify what you want to tell the agent.",
      sessionId: session.id,
    };
  }

  // Check if session is in a state that can receive messages
  const canReceive =
    session.activity === "active" ||
    session.activity === "ready" ||
    session.activity === "idle" ||
    session.activity === "waiting_input" ||
    session.status === "working" ||
    session.status === "pr_open" ||
    session.status === "review_pending";

  if (!canReceive) {
    return {
      result: `Session ${session.id} is in state "${session.status}" and may not be able to receive messages. The message will be queued.`,
      sessionId: session.id,
      action: {
        type: "send_message",
        sessionId: session.id,
        message: args.message.trim(),
      },
    };
  }

  return {
    result: `Sending message to session ${session.id}: "${truncateText(args.message, 100)}"`,
    sessionId: session.id,
    action: {
      type: "send_message",
      sessionId: session.id,
      message: args.message.trim(),
    },
  };
}

/**
 * Handle focus_session function call
 *
 * @param args Function arguments from Gemini
 * @param sessions Current session list
 * @returns Function result with focus update
 */
export function handleFocusSession(
  args: { sessionId: string },
  sessions: DashboardSession[],
): FunctionResult {
  const session = findSessionById(args.sessionId, sessions);
  if (!session) {
    return {
      result: `Session ${args.sessionId} not found. Use list_sessions to see available sessions.`,
      sessionId: null,
    };
  }

  const label = session.issueLabel ? ` (${session.issueLabel})` : "";
  const statusInfo = session.summary
    ? ` Currently: ${truncateText(session.summary, 60)}`
    : ` Status: ${session.status}`;

  return {
    result: `Now focused on session ${session.id}${label}.${statusInfo} All commands will target this session until you focus on another.`,
    sessionId: session.id,
    setFocusedSessionId: session.id,
  };
}

/**
 * Handle follow_session function call
 *
 * @param args Function arguments from Gemini
 * @param sessions Current session list
 * @returns Function result with follow update
 */
export function handleFollowSession(
  args: { sessionId: string },
  sessions: DashboardSession[],
): FunctionResult {
  // Handle "none" or "null" to stop following
  if (!args.sessionId || args.sessionId.toLowerCase() === "none" || args.sessionId.toLowerCase() === "null") {
    return {
      result: "Stopped following sessions. You won't receive proactive updates for any specific session.",
      sessionId: null,
      setFollowingSessionId: null,
      setFocusedSessionId: null, // Also clear focus when stopping follow
    };
  }

  const session = findSessionById(args.sessionId, sessions);
  if (!session) {
    return {
      result: `Session ${args.sessionId} not found. Use list_sessions to see available sessions.`,
      sessionId: null,
    };
  }

  const label = session.issueLabel ? ` (${session.issueLabel})` : "";
  const statusInfo = session.summary
    ? ` Working on: ${truncateText(session.summary, 60)}`
    : ` Status: ${session.status}`;

  return {
    result: `Now following session ${session.id}${label}.${statusInfo} I'll proactively announce CI failures, review comments, and other important events for this session.`,
    sessionId: session.id,
    setFocusedSessionId: session.id, // Following also sets focus
    setFollowingSessionId: session.id,
  };
}

/**
 * Execute a function call from Gemini (V3 - with context + focus/follow support)
 *
 * @param name Function name
 * @param args Function arguments
 * @param sessions Current session list
 * @param context Conversation context for session resolution
 * @returns Function result with session ID for context updates
 */
export function executeFunctionCall(
  name: string,
  args: Record<string, unknown>,
  sessions: DashboardSession[],
  context: ConversationContext,
): FunctionResult {
  switch (name) {
    case "list_sessions":
      // list_sessions doesn't set context (it lists many sessions)
      return {
        result: handleListSessions(args as { status?: FilterStatus }, sessions),
        sessionId: null,
      };

    case "get_session_summary": {
      // V1 function - wrap to return FunctionResult
      const sessionId = (args as { sessionId: string }).sessionId;
      const session = findSessionById(sessionId, sessions);
      return {
        result: handleGetSessionSummary(args as { sessionId: string }, sessions),
        sessionId: session?.id ?? null,
      };
    }

    case "get_ci_failures":
      return handleGetCIFailures(args as { sessionId?: string }, sessions, context);

    case "get_review_comments":
      return handleGetReviewComments(args as { sessionId?: string }, sessions, context);

    case "get_session_changes":
      return handleGetSessionChanges(args as { sessionId?: string }, sessions, context);

    // V3 functions
    case "send_message_to_session":
      return handleSendMessageToSession(
        args as { sessionId?: string; message: string },
        sessions,
        context,
      );

    case "focus_session":
      return handleFocusSession(args as { sessionId: string }, sessions);

    case "follow_session":
      return handleFollowSession(args as { sessionId: string }, sessions);

    default:
      return {
        result: `Unknown function: ${name}. Available functions: list_sessions, get_session_summary, get_ci_failures, get_review_comments, get_session_changes, send_message_to_session, focus_session, follow_session.`,
        sessionId: null,
      };
  }
}

// Re-export findSessionById for use in voice-server.ts
export { findSessionById };
