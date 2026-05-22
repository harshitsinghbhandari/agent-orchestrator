// =============================================================================
// PLUGIN SYSTEM
// =============================================================================

import type { ProjectConfig } from "./config.js";

/** Plugin slot types */
export type PluginSlot =
  | "runtime"
  | "agent"
  | "workspace"
  | "tracker"
  | "scm"
  | "notifier"
  | "terminal";

/** Plugin manifest — what every plugin exports */
export interface PluginManifest {
  /** Plugin name (e.g. "tmux", "claude-code", "github") */
  name: string;

  /** Which slot this plugin fills */
  slot: PluginSlot;

  /** Human-readable description */
  description: string;

  /** Version */
  version: string;

  /** Human-readable display name (e.g. "Claude Code") */
  displayName?: string;
}

/** What a plugin module must export */
export interface PluginModule<T = unknown> {
  manifest: PluginManifest;
  create(config?: Record<string, unknown>): T;

  /** Optional: detect whether this plugin's runtime/binary is available on the system. */
  detect?(): boolean;
}

/**
 * Context passed to a plugin's `preflight()` method.
 *
 * Describes the **intent** of the operation (what it will do), not the CLI
 * flags that triggered it. Plugins should never know about specific flag
 * names — translate flags into intent at the CLI boundary so adding a new
 * flag doesn't ripple into every plugin that cares about a related operation.
 */
export interface PreflightContext {
  /** The project the operation runs against. */
  project: ProjectConfig;

  /** What the operation will do. Plugins decide whether their prereqs apply. */
  intent: {
    /** Whether the spawn is for a worker session or the orchestrator. */
    role: "worker" | "orchestrator";

    /**
     * Whether the operation will exercise SCM PR-write paths
     * (e.g. claiming an existing PR for the new session). When false, an SCM
     * plugin's preflight can skip PR-write prereqs.
     */
    willClaimExistingPR: boolean;
  };
}
