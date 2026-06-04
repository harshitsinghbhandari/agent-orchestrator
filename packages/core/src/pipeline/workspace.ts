/**
 * Workspace classes for pipeline stages (#197 / 8a).
 *
 * Two classes:
 *
 *   - `shared-ro` (default for `agent`/`builtin`): the stage executes against
 *     one detached worktree that's shared by every shared-ro stage in the run.
 *     Agent/builtin stages are not expected to mutate the workspace — only to
 *     read it and emit findings/artifacts via the engine's normal channels.
 *     `WorkspaceGuard` exists to catch accidental mutations: it snapshots
 *     `git status --porcelain` before the stage and verifies it's unchanged
 *     afterwards. Mismatches surface as `pipeline.workspace.guard_warning`
 *     observations (warn, not error) so the run still completes.
 *
 *   - `isolated-rw` (default for `command`): the stage gets a fresh detached
 *     worktree at the run's SHA. The worktree is owned by the stage and
 *     destroyed on terminal status. Command stages routinely run arbitrary
 *     shell that writes files — they cannot share storage with concurrent
 *     stages without race risk, hence the per-stage isolation.
 *
 * The guard is intentionally observational. It exists so the engine can warn
 * operators that a stage is mis-classified (a "shared-ro" stage that mutates
 * should really be declared "isolated-rw") without breaking the run.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { Stage } from "./types.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;

export type WorkspaceClass = "shared-ro" | "isolated-rw";

/**
 * Resolve the effective workspace class for a stage. Stages may declare it
 * explicitly via `Stage.workspace`; otherwise the default is `shared-ro` for
 * `agent`/`builtin` and `isolated-rw` for `command`.
 */
export function resolveWorkspaceClass(stage: Stage): WorkspaceClass {
  if (stage.workspace) return stage.workspace;
  if (stage.executor.kind === "command") return "isolated-rw";
  return "shared-ro";
}

/**
 * Snapshot of a worktree's mutation state. The hash is over the deterministic
 * output of `git status --porcelain=v1 -z` — porcelain v1 is stable across git
 * versions and `-z` removes locale-dependent quoting. We never compare the raw
 * output (it can be megabytes of churn from a large WIP), only the digest.
 */
export interface WorkspaceSnapshot {
  hash: string;
  /** ISO timestamp of when the snapshot was taken. */
  takenAt: string;
}

/**
 * Compute a hash of `git status --porcelain` for the given worktree. Used
 * before/after each `shared-ro` stage so the engine can warn when the stage
 * mutated state it shouldn't have.
 *
 * Returns `null` when git is unavailable or the directory isn't a git
 * worktree — the guard degrades gracefully in non-git contexts (tests,
 * malformed setups) rather than failing the stage.
 */
export async function snapshotWorkspace(
  workspacePath: string,
): Promise<WorkspaceSnapshot | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      {
        cwd: workspacePath,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        // `-z` output can be binary-ish; capture as a buffer to avoid utf-8
        // re-encoding surprises. Node's exec defaults to maxBuffer=1MB which
        // is fine: we're hashing a status diff, not file contents.
        encoding: "buffer",
      },
    );
    const hash = createHash("sha256").update(stdout).digest("hex").slice(0, 16);
    return { hash, takenAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

export interface GuardCheckResult {
  /** True when before/after snapshots match (or either is unavailable). */
  ok: boolean;
  before: WorkspaceSnapshot | null;
  after: WorkspaceSnapshot | null;
}

/**
 * Verify a workspace was not mutated between two snapshots. When either
 * snapshot is `null` (git unavailable, etc.) the result is considered `ok` so
 * the guard never escalates a degraded environment into a warning.
 */
export function verifyWorkspaceUnchanged(
  before: WorkspaceSnapshot | null,
  after: WorkspaceSnapshot | null,
): GuardCheckResult {
  const ok = !before || !after || before.hash === after.hash;
  return { ok, before, after };
}

/**
 * Build the observation payload emitted when a shared-ro stage mutated the
 * workspace. Kept as a pure helper so callers don't reinvent the schema
 * and so tests can assert on the shape without touching git.
 */
export function buildGuardWarning(input: {
  runId: string;
  stageRunId: string;
  stageName: string;
  workspacePath: string;
  check: GuardCheckResult;
}): { name: string; data: Record<string, unknown> } {
  return {
    name: "pipeline.workspace.guard_warning",
    data: {
      runId: input.runId,
      stageRunId: input.stageRunId,
      stageName: input.stageName,
      workspacePath: input.workspacePath,
      beforeHash: input.check.before?.hash ?? null,
      afterHash: input.check.after?.hash ?? null,
    },
  };
}

/**
 * Create a detached git worktree at `headSha` rooted at `path`. Used by
 * `isolated-rw` stages so each one gets a fresh, owned checkout that can be
 * thrown away at terminal status without disturbing sibling stages.
 *
 * `repoPath` is the source repository's worktree (typically the run's
 * shared-ro worktree, which is itself a worktree off the project repo). The
 * new worktree is created with `--detach` so it carries no branch name and
 * can never collide with anything else.
 */
export async function createIsolatedWorktree(input: {
  repoPath: string;
  worktreePath: string;
  headSha: string;
}): Promise<void> {
  const parent = dirname(input.worktreePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  // `git worktree add --detach <path> <sha>` is the canonical way to spin up
  // a throwaway worktree at a specific commit — it never creates a branch
  // and `git worktree remove` reclaims everything when we're done.
  await execFileAsync(
    "git",
    ["worktree", "add", "--detach", input.worktreePath, input.headSha],
    { cwd: input.repoPath, timeout: GIT_TIMEOUT_MS, windowsHide: true },
  );
}

/**
 * Tear down a worktree created via `createIsolatedWorktree`. Best-effort —
 * a missing worktree is a no-op so callers don't need to track ownership
 * across crashes.
 */
export async function destroyIsolatedWorktree(input: {
  repoPath: string;
  worktreePath: string;
}): Promise<void> {
  try {
    await execFileAsync(
      "git",
      ["worktree", "remove", "--force", input.worktreePath],
      { cwd: input.repoPath, timeout: GIT_TIMEOUT_MS, windowsHide: true },
    );
  } catch {
    // `git worktree remove` will fail if the worktree was never registered
    // (e.g. caller called us speculatively). Fall through to the rmSync below.
  }
  if (existsSync(input.worktreePath)) {
    try {
      rmSync(input.worktreePath, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; nothing actionable if the OS refuses.
    }
  }
}

/**
 * Compute a stable filesystem path for an isolated-rw worktree under the
 * pipeline's per-run scratch root. Keeping the layout convention here so the
 * engine and tests agree on where to create / destroy.
 */
export function isolatedWorktreePath(
  scratchRoot: string,
  runId: string,
  stageRunId: string,
): string {
  return join(scratchRoot, runId, stageRunId);
}
