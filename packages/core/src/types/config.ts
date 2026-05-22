// =============================================================================
// CONFIGURATION
// =============================================================================

import type { ObservabilityLevel } from "../observability.js";
import type { EventPriority } from "./events.js";
import type { ReactionConfig } from "./reactions.js";

/**
 * Power management configuration.
 * Controls system sleep behavior while AO is running.
 */
export interface PowerConfig {
  /**
   * Prevent macOS idle sleep while AO is running.
   * Uses `caffeinate -i -w <pid>` to hold an assertion.
   * Defaults to true on macOS, no-op on other platforms.
   */
  preventIdleSleep: boolean;
}

/** Lifecycle-level orchestration configuration. */
export interface LifecycleConfig {
  /**
   * When a session's PR is detected as merged, automatically tear down the
   * tmux runtime, remove the worktree, and archive the session metadata.
   * Defaults to true so `ao status` does not retain stale merged entries.
   */
  autoCleanupOnMerge: boolean;
  /**
   * Maximum time (ms) to wait after a session enters `merged` before forcing
   * cleanup regardless of agent activity. If the agent becomes idle sooner,
   * cleanup happens then. Defaults to 5 minutes.
   */
  mergeCleanupIdleGraceMs: number;
}

export interface ObservabilityConfig {
  /** Minimum structured log level to persist/mirror. Defaults to "warn". */
  logLevel: ObservabilityLevel;
  /** Mirror structured observability logs to stderr. Defaults to false. */
  stderr: boolean;
}

/** Top-level orchestrator configuration (from agent-orchestrator.yaml) */
export interface OrchestratorConfig {
  /** Optional JSON Schema hint for editor autocomplete/validation. */
  "$schema"?: string;

  /**
   * Path to the config file (set automatically during load).
   * Used for hash-based directory structure.
   * All paths are auto-derived from this location.
   */
  configPath: string;

  /** Web dashboard port (defaults to 3000) */
  port?: number;

  /** Terminal WebSocket server port (defaults to 3001) */
  terminalPort?: number;

  /** Direct terminal WebSocket server port (defaults to 3003) */
  directTerminalPort?: number;

  /** Milliseconds before a "ready" session becomes "idle" (default: 300000 = 5 min) */
  readyThresholdMs: number;

  /** Power management settings (idle sleep prevention, etc.). Populated with defaults post-validation. */
  power?: PowerConfig;

  /**
   * Lifecycle-level orchestration settings. Populated with defaults by Zod
   * when loaded from YAML, but typed as optional so hand-constructed test
   * configs remain valid. Consumers should destructure with defaults rather
   * than dereferencing directly. Mirrors the `power?` pattern above.
   */
  lifecycle?: LifecycleConfig;

  /**
   * Process observability settings. Populated with defaults by Zod when loaded
   * from YAML, but optional for hand-constructed tests.
   */
  observability?: ObservabilityConfig;

  /** Default plugin selections */
  defaults: DefaultPlugins;

  /** Installer-managed external plugin descriptors */
  plugins?: InstalledPluginConfig[];

  /** Project configurations */
  projects: Record<string, ProjectConfig>;

  /** Dashboard UI configuration */
  dashboard?: DashboardConfig;

  /** Notification channel configs */
  notifiers: Record<string, NotifierConfig>;

  /** Notification routing by priority */
  notificationRouting: Record<EventPriority, string[]>;

  /** Default reaction configs */
  reactions: Record<string, ReactionConfig>;

  /**
   * Internal: External plugin entries collected from inline tracker/scm/notifier configs.
   * Used by plugin-registry for manifest validation. Set automatically during config validation.
   */
  _externalPluginEntries?: ExternalPluginEntryRef[];
}

export interface DegradedProjectEntry {
  projectId: string;
  path: string;
  resolveError: string;
}

export interface LoadedConfig extends OrchestratorConfig {
  degradedProjects: Record<string, DegradedProjectEntry>;
}

/**
 * Structured location of an external plugin config.
 * Used to update config with manifest.name after loading (avoids parsing dotted strings).
 */
export type ExternalPluginLocation =
  | { kind: "project"; projectId: string; configType: "tracker" | "scm" }
  | { kind: "notifier"; notifierId: string };

/**
 * Reference to an external plugin config (from inline tracker/scm/notifier configs).
 * Used for manifest.name validation during plugin loading.
 */
export interface ExternalPluginEntryRef {
  /** Where this config came from (for error messages) */
  source: string;
  /** Structured location for updating config (avoids parsing source string) */
  location: ExternalPluginLocation;
  /** The slot this plugin fills */
  slot: "tracker" | "scm" | "notifier";
  /** npm package name (if specified) */
  package?: string;
  /** Local path (if specified) */
  path?: string;
  /**
   * Expected plugin name (manifest.name).
   * Only set when user explicitly specified `plugin` field.
   * When undefined, any manifest.name is accepted and config is updated with it.
   */
  expectedPluginName?: string;
}

/**
 * Dashboard attention zone display mode.
 *
 * - "simple" (default): collapses the 5 detailed zones into 4 by merging
 *   REVIEW + RESPOND into a single ACTION column. The card-level badges
 *   still expose the underlying state (ci_failed, needs_input, changes_requested).
 * - "detailed": preserves the original 5-zone Kanban layout for power users
 *   who want REVIEW and RESPOND as distinct columns.
 */
export type DashboardAttentionZoneMode = "simple" | "detailed";

export interface DashboardConfig {
  /** Attention zone layout (defaults to "simple") */
  attentionZones?: DashboardAttentionZoneMode;
}

export interface DefaultPlugins {
  runtime: string;
  agent: string;
  workspace: string;
  notifiers: string[];
  orchestrator?: {
    agent?: string;
  };
  worker?: {
    agent?: string;
  };
}

export type InstalledPluginSource = "registry" | "npm" | "local";

export interface InstalledPluginConfig {
  /** Stable logical plugin name used in config and CLI UX */
  name: string;

  /** Where the plugin should be resolved from */
  source: InstalledPluginSource;

  /** Package name for registry/npm-managed plugins */
  package?: string;

  /** Requested version/range for installer-managed plugins */
  version?: string;

  /** Filesystem path for local plugins */
  path?: string;

  /** Installer-managed enable flag (defaults to true) */
  enabled?: boolean;
}

export interface RoleAgentConfig {
  agent?: string;
  agentConfig?: AgentSpecificConfig;
}

export interface ProjectConfig {
  /** Display name */
  name: string;

  /** Repository path for the configured SCM provider, e.g. "owner/repo" or "group/subgroup/repo" (optional — omitted when no remote detected) */
  repo?: string;

  /** Local path to the repo */
  path: string;

  resolveError?: string;

  /** Default branch (main, master, next, develop, etc.) */
  defaultBranch: string;

  /** Session name prefix (e.g. "app" → "app-1", "app-2") */
  sessionPrefix: string;

  /** Whether this project is active in portfolio and dashboard surfaces */
  enabled?: boolean;

  /** Override default runtime */
  runtime?: string;

  /** Override default agent */
  agent?: string;

  /** Override default workspace */
  workspace?: string;

  /** Environment variables forwarded into worker session runtimes (AO_* internals always win) */
  env?: Record<string, string>;

  /** Issue tracker configuration */
  tracker?: TrackerConfig;

  /** SCM configuration (usually inferred from repo) */
  scm?: SCMConfig;

  /** Files/dirs to symlink into workspaces */
  symlinks?: string[];

  /** Commands to run after workspace creation */
  postCreate?: string[];

  /** Agent-specific configuration */
  agentConfig?: AgentSpecificConfig;

  orchestrator?: RoleAgentConfig;

  worker?: RoleAgentConfig;

  /** Per-project reaction overrides */
  reactions?: Record<string, Partial<ReactionConfig>>;

  /** Inline rules/instructions passed to every agent prompt */
  agentRules?: string;

  /** Path to a file containing agent rules (relative to project path) */
  agentRulesFile?: string;

  /** Rules for the orchestrator agent (stored, reserved for future use) */
  orchestratorRules?: string;

  orchestratorSessionStrategy?:
    | "reuse"
    | "delete"
    | "ignore"
    | "delete-new"
    | "ignore-new"
    | "kill-previous";

  opencodeIssueSessionStrategy?: "reuse" | "delete" | "ignore";
}

export interface TrackerConfig {
  /**
   * Plugin name (manifest.name). Required when using built-in plugins.
   * Optional when `package` or `path` is specified (will be inferred from manifest).
   * When both plugin and package/path are specified, manifest.name must match plugin.
   *
   * POST-VALIDATION INVARIANT: After validateConfig(), this field is ALWAYS populated.
   * Either from user input, inferred from repo (github/gitlab), or auto-generated from
   * package/path via generateTempPluginName(). The optional typing exists for raw config
   * input before validation. Downstream code can safely assume non-null after validation.
   */
  plugin?: string;
  /** npm package name for external plugins (e.g. "@acme/ao-plugin-tracker-jira") */
  package?: string;
  /** Local filesystem path for external plugins (relative to config file or absolute) */
  path?: string;
  /** Plugin-specific config (e.g. teamId for Linear) */
  [key: string]: unknown;
}

export interface SCMConfig {
  /**
   * Plugin name (manifest.name). Required when using built-in plugins.
   * Optional when `package` or `path` is specified (will be inferred from manifest).
   * When both plugin and package/path are specified, manifest.name must match plugin.
   *
   * POST-VALIDATION INVARIANT: After validateConfig(), this field is ALWAYS populated.
   * Either from user input, inferred from repo (github/gitlab), or auto-generated from
   * package/path via generateTempPluginName(). The optional typing exists for raw config
   * input before validation. Downstream code can safely assume non-null after validation.
   */
  plugin?: string;
  /** npm package name for external plugins (e.g. "@acme/ao-plugin-scm-bitbucket") */
  package?: string;
  /** Local filesystem path for external plugins (relative to config file or absolute) */
  path?: string;
  webhook?: SCMWebhookConfig;
  [key: string]: unknown;
}

export interface SCMWebhookConfig {
  enabled?: boolean;
  path?: string;
  secretEnvVar?: string;
  signatureHeader?: string;
  eventHeader?: string;
  deliveryHeader?: string;
  maxBodyBytes?: number;
}

export interface NotifierConfig {
  /**
   * Plugin name (manifest.name). Required when using built-in plugins.
   * Optional when `package` or `path` is specified (will be inferred from manifest).
   * When both plugin and package/path are specified, manifest.name must match plugin.
   *
   * POST-VALIDATION INVARIANT: After validateConfig(), this field is ALWAYS populated.
   * Either from user input or auto-generated from package/path via generateTempPluginName().
   * The optional typing exists for raw config input before validation.
   * Downstream code can safely assume non-null after validation.
   */
  plugin?: string;
  /** npm package name for external plugins (e.g. "@acme/ao-plugin-notifier-teams") */
  package?: string;
  /** Local filesystem path for external plugins (relative to config file or absolute) */
  path?: string;
  [key: string]: unknown;
}

export interface AgentSpecificConfig {
  permissions?: AgentPermissionMode;
  model?: string;
  orchestratorModel?: string;
  [key: string]: unknown;
}

export interface OpenCodeAgentConfig extends AgentSpecificConfig {
  opencodeSessionId?: string;
}

/**
 * Canonical cross-agent permission policy mode.
 *
 * Semantics:
 * - permissionless: run without interactive permission prompts (most permissive mode).
 * - default: use the agent's normal/default permission model.
 * - auto-edit: automatically approve edit actions where the agent supports granular approval policies.
 * - suggest: conservative mode that asks for approval on higher-risk/untrusted actions where supported.
 *
 * Note: Not every agent exposes all granular policies; plugins map these modes to
 * their closest supported behavior.
 */
export type AgentPermissionMode = "permissionless" | "default" | "auto-edit" | "suggest";

/** Backward-compatible legacy alias accepted in config parsing. */
export type LegacyAgentPermissionMode = "skip";

/** Raw permission input (supports legacy aliases). */
export type AgentPermissionInput = AgentPermissionMode | LegacyAgentPermissionMode;

/** Normalize legacy aliases to canonical permission modes. */
export function normalizeAgentPermissionMode(
  mode: string | undefined,
): AgentPermissionMode | undefined {
  if (!mode) return undefined;
  if (
    mode !== "permissionless" &&
    mode !== "default" &&
    mode !== "auto-edit" &&
    mode !== "suggest"
  ) {
    if (mode === "skip") return "permissionless";
    return undefined;
  }
  return mode;
}
