// =============================================================================
// SESSION METADATA
// =============================================================================

import type { CanonicalSessionLifecycle } from "./session.js";
import type { RuntimeHandle } from "./runtime.js";

/**
 * Session metadata stored as JSON files under projects/{projectId}/sessions/.
 *
 * Session files are named with user-facing session IDs (e.g., "ao-1.json").
 * The tmuxName field matches the session ID (e.g., "ao-1") — no hash prefix.
 */
export interface SessionMetadata {
  worktree: string;
  branch: string;
  status: string;
  lifecycle?: CanonicalSessionLifecycle;
  tmuxName?: string; // Tmux session name (matches session ID, e.g. "ao-1")
  issue?: string;
  issueTitle?: string; // Issue title for event enrichment
  pr?: string;
  prAutoDetect?: boolean;
  summary?: string;
  project?: string;
  agent?: string; // Agent plugin name (e.g. "codex", "claude-code") — persisted for lifecycle
  createdAt?: string;
  runtimeHandle?: RuntimeHandle;
  restoredAt?: string;
  role?: string; // "orchestrator" for orchestrator sessions
  dashboard?: {
    port?: number;
    terminalWsPort?: number;
    directTerminalWsPort?: number;
  };
  opencodeSessionId?: string;
  claudeSessionUuid?: string;
  codexThreadId?: string;
  codexModel?: string;
  restoreFallbackReason?: string;
  pinnedSummary?: string; // First quality summary, pinned for display stability
  userPrompt?: string; // Prompt used when spawning without a tracker issue
  /**
   * Human-readable display name for the session.
   *
   * Populated automatically at spawn time from the best available task context
   * (issue title, user prompt, or orchestrator system prompt). Can be
   * overwritten later via the dashboard rename UI — the session ID (`ao-N`)
   * remains the canonical identifier; only display surfaces are affected.
   *
   * Whether this value should beat PR/issue titles in the dashboard depends
   * on `displayNameUserSet` — auto-derived values stay below live tracker
   * signals, user-set values win over them.
   */
  displayName?: string;
  /**
   * Set to `true` when the user explicitly renamed the session via the
   * dashboard. The dashboard fallback chain promotes `displayName` above
   * PR/issue titles only when this flag is true, so an auto-derived spawn-time
   * `displayName` doesn't shadow a live PR title for sessions the user never
   * touched.
   */
  displayNameUserSet?: boolean;
}
