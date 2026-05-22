// =============================================================================
// WORKSPACE — Plugin Slot 3
// =============================================================================

import type { SessionId } from "./session.js";
import type { ProjectConfig } from "./config.js";
import type { PreflightContext } from "./plugin.js";

/**
 * Workspace manages code isolation — how each session gets its own copy of the repo.
 */
export interface Workspace {
  readonly name: string;

  /** Create an isolated workspace for a session */
  create(config: WorkspaceCreateConfig): Promise<WorkspaceInfo>;

  /** Destroy a workspace */
  destroy(workspacePath: string): Promise<void>;

  /** List existing workspaces for a project */
  list(projectId: string): Promise<WorkspaceInfo[]>;

  /**
   * Optional: find a pre-existing AO-managed workspace that already tracks the
   * requested branch and can be adopted instead of creating a fresh workspace.
   */
  findManagedWorkspace?(config: WorkspaceCreateConfig): Promise<WorkspaceInfo | null>;

  /** Optional: run hooks after workspace creation (symlinks, installs, etc.) */
  postCreate?(info: WorkspaceInfo, project: ProjectConfig): Promise<void>;

  /** Optional: check if a workspace exists and is a valid git repo */
  exists?(workspacePath: string): Promise<boolean>;

  /** Optional: restore a workspace (e.g. recreate a worktree for an existing branch) */
  restore?(config: WorkspaceCreateConfig, workspacePath: string): Promise<WorkspaceInfo>;

  /**
   * Optional: validate that this workspace's prerequisites (e.g. git in PATH,
   * write access to the worktree root) are present before `ao spawn`.
   */
  preflight?(context: PreflightContext): Promise<void>;
}

export interface WorkspaceCreateConfig {
  projectId: string;
  project: ProjectConfig;
  sessionId: SessionId;
  branch: string;
  /** Override the base directory for worktrees (e.g. V2 project-scoped dir). */
  worktreeDir?: string;
}

export interface WorkspaceInfo {
  path: string;
  branch: string;
  sessionId: SessionId;
  projectId: string;
}
