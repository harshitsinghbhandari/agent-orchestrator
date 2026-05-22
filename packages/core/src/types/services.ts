// =============================================================================
// SERVICE INTERFACES (core, not pluggable)
// =============================================================================

import type {
  SessionId,
  Session,
  SessionStatus,
  SessionSpawnConfig,
  OrchestratorSpawnConfig,
} from "./session.js";
import type { PRInfo } from "./scm.js";
import type { OrchestratorConfig } from "./config.js";
import type { PluginModule, PluginSlot, PluginManifest } from "./plugin.js";

/**
 * Why a session was killed. Recorded as the lifecycle reason so observability
 * can distinguish human action from automated teardown (e.g. PR merge cleanup).
 */
export type LifecycleKillReason = "manually_killed" | "pr_merged" | "auto_cleanup";

/**
 * Outcome of a kill() call. `cleaned` means resources were torn down this
 * invocation; `alreadyTerminated` means the session was already archived and
 * kill() was a no-op. Callers can use this to avoid double-notifying.
 */
export interface KillResult {
  cleaned: boolean;
  alreadyTerminated: boolean;
}

export interface KillOptions {
  purgeOpenCode?: boolean;
  reason?: LifecycleKillReason;
}

/** Session manager — CRUD for sessions */
export interface SessionManager {
  spawn(config: SessionSpawnConfig): Promise<Session>;
  spawnOrchestrator(config: OrchestratorSpawnConfig): Promise<Session>;
  ensureOrchestrator(config: OrchestratorSpawnConfig): Promise<Session>;
  /**
   * Replace the canonical orchestrator with a fresh one. If an orchestrator
   * already exists for the project, it is killed, its metadata deleted, and a
   * new orchestrator spawned with no carryover state. Ignores
   * `orchestratorSessionStrategy` — replacement is the whole point.
   */
  relaunchOrchestrator(config: OrchestratorSpawnConfig): Promise<Session>;
  restore(sessionId: SessionId): Promise<Session>;
  list(projectId?: string): Promise<Session[]>;
  get(sessionId: SessionId): Promise<Session | null>;
  kill(sessionId: SessionId, options?: KillOptions): Promise<KillResult>;
  cleanup(
    projectId?: string,
    options?: { dryRun?: boolean; purgeOpenCode?: boolean },
  ): Promise<CleanupResult>;
  send(sessionId: SessionId, message: string): Promise<void>;
  claimPR(sessionId: SessionId, prRef: string, options?: ClaimPROptions): Promise<ClaimPRResult>;
}

/** OpenCode-specific session manager with remap capability */
export interface OpenCodeSessionManager extends SessionManager {
  /** Remap session to OpenCode session ID, returns the mapped OpenCode session ID */
  remap(sessionId: SessionId, force?: boolean): Promise<string>;
  listCached(projectId?: string): Promise<Session[]>;
  invalidateCache(): void;
}

export interface ClaimPROptions {
  assignOnGithub?: boolean;
  takeover?: boolean;
}

export interface ClaimPRResult {
  sessionId: SessionId;
  projectId: string;
  pr: PRInfo;
  branchChanged: boolean;
  githubAssigned: boolean;
  githubAssignmentError?: string;
  takenOverFrom: SessionId[];
}

/** Type guard to check if a SessionManager supports OpenCode-specific remap operation */
export function isOpenCodeSessionManager(sm: SessionManager): sm is OpenCodeSessionManager {
  return typeof (sm as OpenCodeSessionManager).remap === "function";
}

export interface CleanupResult {
  killed: string[];
  skipped: string[];
  errors: Array<{ sessionId: string; error: string }>;
}

/** Lifecycle manager — state machine + reaction engine */
export interface LifecycleManager {
  /** Start the lifecycle polling loop */
  start(intervalMs?: number): void;

  /** Stop the lifecycle polling loop */
  stop(): void;

  /** Get current state for all sessions */
  getStates(): Map<SessionId, SessionStatus>;

  /** Force-check a specific session now */
  check(sessionId: SessionId): Promise<void>;
}

/** Plugin registry — discovery + loading */
export interface PluginRegistry {
  /** Register a plugin, optionally with config to pass to create() */
  register(plugin: PluginModule, config?: Record<string, unknown>): void;

  /** Get a plugin by slot and name */
  get<T>(slot: PluginSlot, name: string): T | null;

  /** List plugins for a slot */
  list(slot: PluginSlot): PluginManifest[];

  /** Load built-in plugins, optionally with orchestrator config for plugin settings */
  loadBuiltins(
    config?: OrchestratorConfig,
    importFn?: (pkg: string) => Promise<unknown>,
  ): Promise<void>;

  /** Load plugins from config (npm packages, local paths) */
  loadFromConfig(
    config: OrchestratorConfig,
    importFn?: (pkg: string) => Promise<unknown>,
  ): Promise<void>;
}
