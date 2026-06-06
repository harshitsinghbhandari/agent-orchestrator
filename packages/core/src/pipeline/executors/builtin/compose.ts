/**
 * Builtin executor: `compose`.
 *
 * Merges `ctx.inputs` (upstream stage artifacts keyed by stage name) into a
 * single JSON artifact. Used downstream of fan-out stages so a later stage
 * can consume one structured input instead of N per-stage artifact files.
 *
 * Like router, compose runs in the engine process and never writes to the
 * store directly — the engine threads the returned artifact through the
 * normal STAGE_COMPLETED path.
 */

import type { ArtifactInput, BuiltinTaskContext, Verdict } from "../../types.js";

export interface ComposeOutcome {
  artifacts: ArtifactInput[];
  verdict: Verdict;
}

export async function runCompose(ctx: BuiltinTaskContext): Promise<ComposeOutcome> {
  const stages: Record<string, unknown[]> = {};
  let totalArtifacts = 0;
  for (const [stageName, stageArtifacts] of Object.entries(ctx.inputs)) {
    stages[stageName] = stageArtifacts;
    totalArtifacts += stageArtifacts.length;
  }

  const artifact: ArtifactInput = {
    kind: "json",
    data: {
      composedFrom: Object.keys(stages),
      totalArtifacts,
      stages,
    },
  };

  return { artifacts: [artifact], verdict: "neutral" };
}
