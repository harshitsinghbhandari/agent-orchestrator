// =============================================================================
// AGENT — Plugin Slot 2
// =============================================================================

import type { SessionId, Session, ActivityState, ActivityDetection } from "./session.js";
import type { RuntimeHandle } from "./runtime.js";
import type { ProjectConfig, AgentPermissionInput } from "./config.js";
import type { PreflightContext } from "./plugin.js";

/**
 * Agent adapter for a specific AI coding tool.
 * Knows how to launch, detect activity, and extract session info.
 */

export const PROCESS_PROBE_INDETERMINATE = "indeterminate" as const;

export type ProcessProbeResult = boolean | typeof PROCESS_PROBE_INDETERMINATE;

export function isProcessProbeIndeterminate(
  result: ProcessProbeResult,
): result is typeof PROCESS_PROBE_INDETERMINATE {
  return result === PROCESS_PROBE_INDETERMINATE;
}

export interface Agent {
  readonly name: string;

  /** Process name to look for (e.g. "claude", "codex", "aider") */
  readonly processName: string;

  /**
   * How the initial user prompt is delivered.
   * Defaults to inline, meaning the agent embeds the prompt in getLaunchCommand().
   * Use post-launch for interactive CLIs that must start first and receive input over stdin.
   */
  readonly promptDelivery?: "inline" | "post-launch";

  /** Get the shell command to launch this agent */
  getLaunchCommand(config: AgentLaunchConfig): string;

  /** Get environment variables for the agent process */
  getEnvironment(config: AgentLaunchConfig): Record<string, string>;

  /**
   * Detect what the agent is currently doing from terminal output.
   * @deprecated Use getActivityState() instead - this uses hacky terminal parsing.
   */
  detectActivity(terminalOutput: string): ActivityState;

  /**
   * Get current activity state using agent-native mechanism (JSONL, SQLite, etc.).
   * This is the preferred method for activity detection.
   * @param readyThresholdMs - ms before "ready" becomes "idle" (default: DEFAULT_READY_THRESHOLD_MS)
   */
  getActivityState(session: Session, readyThresholdMs?: number): Promise<ActivityDetection | null>;

  /**
   * Check if agent process is running (given runtime handle).
   *
   * Returns "indeterminate" when the probe could not reliably determine
   * liveness (for example, `ps`/`tmux` timed out or failed). Callers must
   * treat that as no verdict, not as a missing process.
   */
  isProcessRunning(handle: RuntimeHandle): Promise<ProcessProbeResult>;

  /** Extract information from agent's internal data (summary, cost, session ID) */
  getSessionInfo(session: Session): Promise<AgentSessionInfo | null>;

  /**
   * Optional: get a launch command that resumes a previous session.
   * Returns null if no previous session is found (caller falls back to getLaunchCommand).
   */
  getRestoreCommand?(session: Session, project: ProjectConfig): Promise<string | null>;

  /**
   * Optional: run setup BEFORE the agent process is launched.
   *
   * Use this when a plugin needs to observe state that the agent itself will
   * mutate at startup. Captured *after* the workspace exists but *before*
   * `runtime.create()` spawns the agent — so the snapshot is taken cleanly,
   * with no race against the agent's own initialization writes.
   *
   * Receives only the workspace path because the full Session object (with
   * runtime handle, lifecycle, etc.) does not exist yet at this point.
   */
  preLaunchSetup?(workspacePath: string): Promise<void>;

  /** Optional: run setup after agent is launched (e.g. configure MCP servers) */
  postLaunchSetup?(session: Session): Promise<void>;

  /**
   * Optional: Set up agent-specific hooks/config in the workspace for automatic metadata updates.
   * Called once per workspace during ao start and when creating new worktrees.
   *
   * Each agent plugin implements this for their own config format:
   * - Claude Code: writes .claude/settings.json with PostToolUse hook
   * - Codex: whatever config mechanism Codex uses
   * - Aider: .aider.conf.yml or similar
   * - OpenCode: its own config
   *
   * CRITICAL: The dashboard depends on metadata being auto-updated when agents
   * run git/gh commands. Without this, PRs created by agents never show up.
   */
  setupWorkspaceHooks?(workspacePath: string, config: WorkspaceHooksConfig): Promise<void>;

  /**
   * Optional: Record an activity observation to the session's JSONL activity log.
   * Called by the lifecycle manager during each poll cycle with captured terminal output.
   *
   * Plugins classify the terminal output (via detectActivity) and append a JSONL entry
   * to `{session.workspacePath}/.ao/activity.jsonl`. The next `getActivityState()` call
   * reads from this file to detect states like `waiting_input` and `blocked`.
   *
   * Agents with native JSONL (Claude Code, Codex) should NOT implement this — their
   * `getActivityState` already reads richer data from the agent's own session files.
   */
  recordActivity?(session: Session, terminalOutput: string): Promise<void>;

  /**
   * Optional: validate that this agent's prerequisites are present before
   * it is exercised by `ao spawn`. Throw with an actionable error message.
   */
  preflight?(context: PreflightContext): Promise<void>;
}

export interface AgentLaunchConfig {
  sessionId: SessionId;
  projectConfig: ProjectConfig;
  /**
   * Per-session workspace path. Differs from `projectConfig.path` when the
   * workspace plugin (e.g. worktree mode) creates an isolated checkout per
   * session. Plugins that need the agent's actual cwd — for cwd-derived
   * lookups, --work-dir flags, file-based discovery — must use this when
   * present. Falls back to `projectConfig.path` when undefined (clone-mode
   * workspaces, or plugins not yet plumbing it through).
   */
  workspacePath?: string;
  issueId?: string;
  prompt?: string;
  permissions?: AgentPermissionInput;
  model?: string;
  /**
   * System prompt to pass to the agent for orchestrator context.
   * - Claude Code: --append-system-prompt
   * - Codex: --system-prompt or AGENTS.md
   * - Aider: --system-prompt flag
   * - OpenCode: equivalent mechanism
   *
   * For short prompts only. For long prompts, use systemPromptFile instead
   * to avoid shell/tmux truncation issues.
   */
  systemPrompt?: string;
  /**
   * Path to a file containing the system prompt.
   * Preferred over systemPrompt for long prompts (e.g. orchestrator prompts)
   * because inlining 2000+ char prompts in shell commands causes truncation.
   *
   * When set, takes precedence over systemPrompt.
   * - Claude Code: --append-system-prompt "$(cat /path/to/file)"
   * - Codex/Aider: similar shell substitution
   */
  systemPromptFile?: string;
  /**
   * Specialized OpenCode subagent to use (e.g., sisyphus, oracle, librarian).
   * Requires oh-my-opencode to be installed.
   * Use --subagent flag to select the subagent.
   */
  subagent?: string;
}

export interface WorkspaceHooksConfig {
  /** Data directory where session metadata files are stored */
  dataDir: string;
  /** Optional session ID (may not be known at workspace setup time) */
  sessionId?: string;
}

export interface AgentSessionInfo {
  /** Agent's auto-generated summary of what it's working on */
  summary: string | null;
  /** True when summary is a fallback (e.g. truncated first user message), not a real agent summary */
  summaryIsFallback?: boolean;
  /** Agent's internal session ID (for resume) */
  agentSessionId: string | null;
  /** Agent-owned metadata worth persisting for later restore. */
  metadata?: Record<string, string>;
  /** Estimated cost so far */
  cost?: CostEstimate;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}
