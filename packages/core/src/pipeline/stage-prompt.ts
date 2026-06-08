/**
 * Layer 4 of the prompt assembly: stage task descriptor + findings instructions.
 *
 * Layers 1–3 (base + config + rules) are produced by prompt-builder.ts at
 * session-spawn time. Layer 4 is pipeline-specific: it tells the agent which
 * stage it's executing, what mode it's running in, and where to drop
 * structured findings so the executor can harvest them.
 *
 * Returned as a single string the agent executor concatenates into the
 * spawn-time `prompt` field. Keep it terse — agents read it once.
 */

import { PIPELINE_FINDINGS_FILENAME, type PrContext, type Stage, type TaskMode } from "./types.js";

export interface StagePromptInput {
  pipelineName: string;
  stage: Stage;
  /** Loop counter from the engine — included so prompts surface progress. */
  loopRound?: number;
  /**
   * PR context the stage is executing against. Present for PR-triggered runs
   * (e.g. reviewer stages) — emitted as a `## PR Context` block so the agent
   * has the PR number, URL, head/base SHAs, branches, and a copy-pasteable
   * `git diff` command. Absent for manual / orchestrator-triggered runs that
   * are not scoped to a PR — in that case the block is omitted entirely.
   */
  prContext?: PrContext;
}

/**
 * Compose the Layer 4 prompt for a single stage execution.
 *
 * The findings file path is documented relative to the workspace root so the
 * agent doesn't need to know the absolute path.
 */
export function buildStagePrompt(input: StagePromptInput): string {
  const { pipelineName, stage, loopRound, prContext } = input;
  const mode = stage.executor.kind === "agent" ? stage.executor.mode : null;
  const lines: string[] = [];

  lines.push(`## Pipeline Stage`);
  lines.push(`Pipeline: ${pipelineName}`);
  lines.push(`Stage: ${stage.name}`);
  if (mode) lines.push(`Mode: ${mode}`);
  if (typeof loopRound === "number") lines.push(`Loop round: ${loopRound}`);
  if (stage.policy?.blocksMerge) {
    lines.push(`This stage's findings will block merge until they are resolved.`);
  }

  if (prContext) {
    lines.push(``);
    lines.push(`## PR Context`);
    lines.push(...formatPrContext(prContext));
  }

  if (stage.task.prompt) {
    lines.push(``);
    lines.push(`## Task`);
    lines.push(stage.task.prompt);
  }

  if (stage.task.inputs && Object.keys(stage.task.inputs).length > 0) {
    lines.push(``);
    lines.push(`## Inputs`);
    lines.push("```json");
    lines.push(JSON.stringify(stage.task.inputs, null, 2));
    lines.push("```");
  }

  lines.push(``);
  lines.push(`## Reporting Findings`);
  lines.push(formatFindingsInstructions(mode));

  return lines.join("\n");
}

function formatPrContext(ctx: PrContext): string[] {
  const lines: string[] = [];

  if (typeof ctx.prNumber === "number") lines.push(`PR: #${ctx.prNumber}`);
  if (ctx.url) lines.push(`URL: ${ctx.url}`);
  if (ctx.headBranch) lines.push(`Head branch: ${ctx.headBranch}`);
  if (ctx.baseBranch) lines.push(`Base branch: ${ctx.baseBranch}`);
  lines.push(`Head SHA: ${ctx.headSha}`);
  if (ctx.baseSha) lines.push(`Base SHA: ${ctx.baseSha}`);
  if (ctx.isFromFork === true) {
    lines.push(`Fork PR: yes (head branch lives on a fork of the base repo)`);
  }

  // Pin the diff target so the agent doesn't have to guess. Prefer the
  // explicit base SHA when present; otherwise use the base branch with
  // three-dot syntax (`base...HEAD`) so the diff is from the merge-base,
  // matching what GitHub shows in the PR's "Files changed" tab.
  const diffBase = ctx.baseSha ?? (ctx.baseBranch ? `origin/${ctx.baseBranch}` : null);
  if (diffBase) {
    lines.push(``);
    lines.push(
      `Your worktree is already checked out at the PR head SHA (\`${ctx.headSha}\`). ` +
        `Inspect the diff with:`,
    );
    lines.push("```bash");
    lines.push(`git diff ${diffBase}...HEAD`);
    lines.push("```");
  } else {
    lines.push(``);
    lines.push(
      `Your worktree is already checked out at the PR head SHA (\`${ctx.headSha}\`).`,
    );
  }

  return lines;
}

function formatFindingsInstructions(mode: TaskMode | null): string {
  const path = `.ao/${PIPELINE_FINDINGS_FILENAME}`;
  const tmpPath = `${path}.tmp`;
  const blocks: string[] = [];

  blocks.push(
    `When this stage is complete, write your findings to \`${path}\` (one JSON object per line, JSONL).`,
  );
  // Atomicity contract: the executor polls for the final file's existence
  // and parses it on first sight. A torn write (partial JSONL line) would
  // be classified as `failed` and stall the run. Mandate write-then-rename
  // so the executor only ever sees a fully-written file.
  blocks.push(
    `Write the JSONL to \`${tmpPath}\` first, then rename it to \`${path}\` so the orchestrator never observes a partial file (e.g. \`mv ${tmpPath} ${path}\`).`,
  );
  blocks.push(
    `The orchestrator harvests this file once you go idle — without it the stage cannot complete.`,
  );

  if (mode === "review") {
    blocks.push(
      `Each line must be a "finding" record with: { kind: "finding", filePath, startLine, endLine, title, description, category, severity ("error" | "warning" | "info"), confidence (0–1) }.`,
    );
  } else if (mode === "answer") {
    blocks.push(
      `Each line must be a "json" record: { kind: "json", data: { ... } } where \`data\` matches the task's outputSchema (if any).`,
    );
  } else {
    blocks.push(
      `Each line must be either a "finding" or a "json" record (see ArtifactInput in the orchestrator types).`,
    );
  }

  blocks.push(
    `If there are no findings, rename an empty file. The file's existence — not its contents — is the completion signal.`,
  );

  return blocks.join(" ");
}
