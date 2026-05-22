// =============================================================================
// SESSION
// =============================================================================

import type { RuntimeHandle } from "./runtime.js";
import type { AgentSessionInfo } from "./agent.js";
import type { PRInfo } from "./scm.js";

/** Unique session identifier, e.g. "my-app-1", "backend-12" */
export type SessionId = string;

export type SessionKind = "worker" | "orchestrator";

export type CanonicalSessionState =
  | "not_started"
  | "working"
  | "idle"
  | "needs_input"
  | "stuck"
  | "detecting"
  | "done"
  | "terminated";

export type CanonicalSessionReason =
  | "spawn_requested"
  | "agent_acknowledged"
  | "task_in_progress"
  | "pr_created"
  | "pr_closed_waiting_decision"
  | "fixing_ci"
  | "resolving_review_comments"
  | "awaiting_user_input"
  | "awaiting_external_review"
  | "research_complete"
  | "merged_waiting_decision"
  | "manually_killed"
  | "pr_merged"
  | "auto_cleanup"
  | "runtime_lost"
  | "agent_process_exited"
  | "probe_failure"
  | "error_in_process";

export type CanonicalPRState = "none" | "open" | "merged" | "closed";

export type CanonicalPRReason =
  | "not_created"
  | "in_progress"
  | "ci_failing"
  | "review_pending"
  | "changes_requested"
  | "approved"
  | "merge_ready"
  | "merged"
  | "closed_unmerged"
  | "cleared_on_restore";

export type CanonicalRuntimeState = "unknown" | "alive" | "exited" | "missing" | "probe_failed";

export type CanonicalRuntimeReason =
  | "spawn_incomplete"
  | "process_running"
  | "process_missing"
  | "tmux_missing"
  | "manual_kill_requested"
  | "pr_merged_cleanup"
  | "auto_cleanup"
  | "probe_error";

export interface SessionStateRecord {
  kind: SessionKind;
  state: CanonicalSessionState;
  reason: CanonicalSessionReason;
  startedAt: string | null;
  completedAt: string | null;
  terminatedAt: string | null;
  lastTransitionAt: string;
}

export interface PRStateRecord {
  state: CanonicalPRState;
  reason: CanonicalPRReason;
  number: number | null;
  url: string | null;
  lastObservedAt: string | null;
}

export interface RuntimeStateRecord {
  state: CanonicalRuntimeState;
  reason: CanonicalRuntimeReason;
  lastObservedAt: string | null;
  handle: RuntimeHandle | null;
  tmuxName: string | null;
}

export interface CanonicalSessionLifecycle {
  version: 2;
  session: SessionStateRecord;
  pr: PRStateRecord;
  runtime: RuntimeStateRecord;
}

/** Session lifecycle states */
export type SessionStatus =
  | "spawning"
  | "working"
  | "detecting"
  | "pr_open"
  | "ci_failed"
  | "review_pending"
  | "changes_requested"
  | "approved"
  | "mergeable"
  | "merged"
  | "cleanup"
  | "needs_input"
  | "stuck"
  | "errored"
  | "killed"
  | "idle"
  | "done"
  | "terminated";

/** Activity state as detected by the agent plugin */
export type ActivityState =
  | "active" // agent is processing (thinking, writing code)
  | "ready" // agent finished its turn, alive and waiting for input
  | "idle" // agent has been inactive for a while (stale)
  | "waiting_input" // agent is asking a question / permission prompt
  | "blocked" // agent hit an error or is stuck
  | "exited"; // agent process is no longer running

/** Activity state constants */
export const ACTIVITY_STATE = {
  ACTIVE: "active" as const,
  READY: "ready" as const,
  IDLE: "idle" as const,
  WAITING_INPUT: "waiting_input" as const,
  BLOCKED: "blocked" as const,
  EXITED: "exited" as const,
} satisfies Record<string, ActivityState>;

export type ActivitySignalState = "valid" | "stale" | "null" | "unavailable" | "probe_failure";

export type ActivitySignalSource = "native" | "terminal" | "hook" | "runtime" | "none";

export interface ActivitySignal {
  /** Confidence bucket for the activity probe result. */
  state: ActivitySignalState;
  /** The observed activity value, if one was surfaced. */
  activity: ActivityState | null;
  /** Timestamp that makes timing-based inferences safe, when available. */
  timestamp?: Date;
  /** Where the activity signal came from. */
  source: ActivitySignalSource;
  /** Optional extra detail for stale / failed probes. */
  detail?: string;
}

/** Result of activity detection, carrying both the state and an optional timestamp. */
export interface ActivityDetection {
  state: ActivityState;
  /** When activity was last observed (e.g., agent log file mtime) */
  timestamp?: Date;
}

/** A single entry in the AO activity JSONL log, written by agent plugins. */
export interface ActivityLogEntry {
  /** ISO 8601 timestamp */
  ts: string;
  /** Activity state derived from terminal output, agent-native data, or a platform-event hook */
  state: ActivityState;
  /**
   * Provenance of this entry:
   *   - "terminal": classified from terminal output (regex/heuristic; deprecated for hook-capable agents)
   *   - "native":   read from the agent's own JSONL/API
   *   - "hook":     emitted by an agent lifecycle hook (e.g. Claude Code's PermissionRequest, Stop, StopFailure)
   */
  source: "terminal" | "native" | "hook";
  /** Raw terminal snippet, hook event name, or other context that caused waiting_input/blocked (for debugging) */
  trigger?: string;
}

/** Default threshold (ms) before a "ready" session becomes "idle". */
export const DEFAULT_READY_THRESHOLD_MS = 300_000; // 5 minutes

/** Default window (ms) for "active" state — activity newer than this is "active", older is "ready". */
export const DEFAULT_ACTIVE_WINDOW_MS = 30_000; // 30 seconds

/** Session status constants */
export const SESSION_STATUS = {
  SPAWNING: "spawning" as const,
  WORKING: "working" as const,
  DETECTING: "detecting" as const,
  PR_OPEN: "pr_open" as const,
  CI_FAILED: "ci_failed" as const,
  REVIEW_PENDING: "review_pending" as const,
  CHANGES_REQUESTED: "changes_requested" as const,
  APPROVED: "approved" as const,
  MERGEABLE: "mergeable" as const,
  MERGED: "merged" as const,
  CLEANUP: "cleanup" as const,
  NEEDS_INPUT: "needs_input" as const,
  STUCK: "stuck" as const,
  ERRORED: "errored" as const,
  IDLE: "idle" as const,
  KILLED: "killed" as const,
  DONE: "done" as const,
  TERMINATED: "terminated" as const,
} satisfies Record<string, SessionStatus>;

/** Statuses that indicate the session is in a terminal (dead) state. */
export const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "killed",
  "terminated",
  "done",
  "cleanup",
  "errored",
  "merged",
]);

/** Activity states that indicate the session is no longer running. */
export const TERMINAL_ACTIVITIES: ReadonlySet<ActivityState> = new Set(["exited"]);

/** Statuses that must never be restored. */
export const NON_RESTORABLE_STATUSES: ReadonlySet<SessionStatus> = new Set([]);

/** Check if a session is in a terminal (dead) state. */
export function isTerminalSession(session: {
  status: SessionStatus;
  activity: ActivityState | null;
  lifecycle?: CanonicalSessionLifecycle;
}): boolean {
  if (session.lifecycle) {
    return (
      session.lifecycle.session.state === "done" ||
      session.lifecycle.session.state === "terminated" ||
      session.lifecycle.pr.state === "merged" ||
      session.lifecycle.runtime.state === "missing" ||
      session.lifecycle.runtime.state === "exited"
    );
  }
  return (
    TERMINAL_STATUSES.has(session.status) ||
    (session.activity !== null && TERMINAL_ACTIVITIES.has(session.activity))
  );
}

/** Check if a session can be restored. */
export function isRestorable(session: {
  status: SessionStatus;
  activity: ActivityState | null;
  lifecycle?: CanonicalSessionLifecycle;
}): boolean {
  if (session.lifecycle) {
    return (
      isTerminalSession(session) &&
      !NON_RESTORABLE_STATUSES.has(session.status)
    );
  }
  return isTerminalSession(session) && !NON_RESTORABLE_STATUSES.has(session.status);
}

/** A running agent session */
export interface Session {
  /** Unique session ID, e.g. "my-app-3" */
  id: SessionId;

  /** Which project this session belongs to */
  projectId: string;

  /** Current lifecycle status */
  status: SessionStatus;

  /** Activity state from agent plugin (null = not yet determined) */
  activity: ActivityState | null;

  /** Explicit confidence/availability contract for the current activity signal. */
  activitySignal: ActivitySignal;

  /** Canonical lifecycle truth persisted in metadata. */
  lifecycle: CanonicalSessionLifecycle;

  /** Git branch name */
  branch: string | null;

  /** Issue identifier (if working on an issue) */
  issueId: string | null;

  /** PR info (once PR is created) */
  pr: PRInfo | null;

  /** Workspace path on disk */
  workspacePath: string | null;

  /** Runtime handle for communicating with the session */
  runtimeHandle: RuntimeHandle | null;

  /** Agent session info (summary, cost, etc.) */
  agentInfo: AgentSessionInfo | null;

  /** When the session was created */
  createdAt: Date;

  /** Last activity timestamp */
  lastActivityAt: Date;

  /** When this session was last restored (undefined if never restored) */
  restoredAt?: Date;

  /** Metadata key-value pairs */
  metadata: Record<string, string>;
}

export function isOrchestratorSession(
  session: { id: SessionId; metadata?: Record<string, string> },
  sessionPrefix?: string,
  allSessionPrefixes?: string[],
): boolean {
  if (session.metadata?.["role"] === "orchestrator") {
    return true;
  }
  if (!sessionPrefix) {
    return false;
  }
  const escaped = sessionPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (session.id === `${sessionPrefix}-orchestrator`) {
    return true;
  }
  if (!new RegExp(`^${escaped}-orchestrator-\\d+$`).test(session.id)) {
    return false;
  }
  // Guard against cross-project false positives: if the session ID is a plain
  // numbered worker for any other known prefix (e.g. prefix "app-orchestrator"
  // matches "app-orchestrator-1" as a worker), it is not an orchestrator.
  if (allSessionPrefixes) {
    for (const prefix of allSessionPrefixes) {
      if (prefix === sessionPrefix) continue;
      if (
        new RegExp(
          `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`,
        ).test(session.id)
      ) {
        return false;
      }
    }
  }
  return true;
}

/** Config for creating a new session */
export interface SessionSpawnConfig {
  projectId: string;
  issueId?: string;
  branch?: string;
  prompt?: string;
  /** Override the agent plugin for this session (e.g. "codex", "claude-code") */
  agent?: string;
  /** Override the OpenCode subagent for this session (e.g. "sisyphus", "oracle") */
  subagent?: string;
}

/** Config for creating an orchestrator session */
export interface OrchestratorSpawnConfig {
  projectId: string;
  systemPrompt?: string;
  /** Override the agent plugin for this orchestrator (e.g. "codex", "claude-code", "opencode") */
  agent?: string;
}
