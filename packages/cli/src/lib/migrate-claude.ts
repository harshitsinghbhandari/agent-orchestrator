/**
 * `ao migrate` — Claude transcript relocation (#2129, §9).
 *
 * Only claude-code orchestrators need this: codex/opencode resume by the global
 * id already carried in `agent_session_id`. We copy the legacy transcript to the
 * slug the rewrite/Claude will compute for the orchestrator worktree, so the
 * resumed orchestrator keeps its context.
 *
 * Slug helpers are imported from the claude-code plugin (the CLI already depends
 * on it) so the `\\`->`/` + `[^a-zA-Z0-9-]` normalization is never re-copied.
 */

import { homedir } from "node:os";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  resolveWorkspaceForClaude,
  toClaudeProjectPath,
} from "@aoagents/ao-plugin-agent-claude-code";

export interface TranscriptCopyPlan {
  projectId: string;
  uuid: string;
  /** ~/.claude/projects/<sourceSlug>/<uuid>.jsonl */
  sourcePath: string;
  /** ~/.claude/projects/<destSlug>/<uuid>.jsonl */
  destPath: string;
}

export interface TranscriptPlanArgs {
  dataDir: string;
  projectId: string;
  prefix: string;
  /** Legacy worktree path on disk (exists; realpath-resolved for the source slug). */
  worktree: string;
  uuid: string;
  /** Override the Claude projects dir (tests). Defaults to ~/.claude/projects. */
  claudeProjectsDir?: string;
}

/**
 * Compute the source + destination transcript paths.
 *
 * Source slug realpath-resolves the legacy worktree (it exists on disk).
 * Destination slug uses the LITERAL orchestrator-worktree template
 * `{dataDir}/worktrees/{projectId}/orchestrator/{prefix}-orchestrator` with NO
 * realpath — that dir does not exist yet (the rewrite creates it on first
 * resume) and ~/.ao/data is confirmed not a symlink, so the literal-path slug
 * matches what the rewrite/Claude will compute.
 */
export async function planTranscriptCopy(args: TranscriptPlanArgs): Promise<TranscriptCopyPlan> {
  const claudeProjectsDir = args.claudeProjectsDir ?? join(homedir(), ".claude", "projects");

  const sourceSlug = toClaudeProjectPath(await resolveWorkspaceForClaude(args.worktree));
  const destTemplate = join(
    args.dataDir,
    "worktrees",
    args.projectId,
    "orchestrator",
    `${args.prefix}-orchestrator`,
  );
  const destSlug = toClaudeProjectPath(destTemplate);

  return {
    projectId: args.projectId,
    uuid: args.uuid,
    sourcePath: join(claudeProjectsDir, sourceSlug, `${args.uuid}.jsonl`),
    destPath: join(claudeProjectsDir, destSlug, `${args.uuid}.jsonl`),
  };
}

export type TranscriptCopyOutcome = "copied" | "already-present" | "source-missing";

/**
 * Execute a transcript copy. Idempotent: an existing destination is left as-is
 * (already-present); a missing source is skipped silently (source-missing).
 * Only "copied" increments `relocatedTranscripts` in the summary.
 */
export function relocateTranscript(plan: TranscriptCopyPlan): TranscriptCopyOutcome {
  if (existsSync(plan.destPath)) return "already-present";
  if (!existsSync(plan.sourcePath)) return "source-missing";
  mkdirSync(dirname(plan.destPath), { recursive: true });
  copyFileSync(plan.sourcePath, plan.destPath);
  return "copied";
}
