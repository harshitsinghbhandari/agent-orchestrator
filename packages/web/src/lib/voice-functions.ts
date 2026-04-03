/**
 * Voice function implementations for Gemini Live API.
 *
 * MVP functions:
 * - list_sessions: List active agent sessions with their current status
 * - get_session_summary: Get summary of what a specific agent session is working on
 */

import { getAttentionLevel, type DashboardSession, type AttentionLevel } from "./types";

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

/**
 * Execute a function call from Gemini
 *
 * @param name Function name
 * @param args Function arguments
 * @param sessions Current session list
 * @returns Function result string
 */
export function executeFunctionCall(
  name: string,
  args: Record<string, unknown>,
  sessions: DashboardSession[],
): string {
  switch (name) {
    case "list_sessions":
      return handleListSessions(args as { status?: FilterStatus }, sessions);

    case "get_session_summary":
      return handleGetSessionSummary(args as { sessionId: string }, sessions);

    default:
      return `Unknown function: ${name}. Available functions: list_sessions, get_session_summary.`;
  }
}
