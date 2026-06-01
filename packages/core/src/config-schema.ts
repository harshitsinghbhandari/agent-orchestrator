/**
 * Legacy `codeReview:` config shim.
 *
 * Upstream's pre-pipelines world had a top-level `codeReview:` block per
 * project. v0 of the pipelines epic (this branch) collapses that surface
 * onto the single-stage pipeline path so the engine has one code path,
 * not two.
 *
 * This module defines:
 *   - LegacyCodeReviewSchema — Zod for the optional `codeReview:` YAML block
 *   - synthesizeLegacyCodeReviewPipeline — turns it into a ConfiguredPipeline
 *
 * The synthesized pipeline is named `legacy-code-review` and contains a
 * single stage named `review`. The stage name is part of every
 * artifact fingerprint, so naming it `review` is what lets dismissals
 * recorded against the legacy code-review keep matching new pipeline
 * artifacts after migration.
 */

import { z } from "zod";

import type { ConfiguredPipeline } from "./pipeline/config-schema.js";

/** Map-key the synthesized pipeline is registered under in `project.pipelines`. */
export const LEGACY_CODE_REVIEW_PIPELINE_NAME = "legacy-code-review";

/** Name of the single stage inside the synthesized pipeline. Used for fingerprint scoping. */
export const LEGACY_CODE_REVIEW_STAGE_NAME = "review";

/** Default agent plugin if the legacy block omits one. */
const DEFAULT_LEGACY_AGENT = "claude-code";

/**
 * Schema for the legacy `codeReview:` block. Intentionally permissive
 * (passthrough) — upstream configs may carry fields we don't surface yet,
 * and silently dropping them on synthesis is preferable to refusing to load.
 */
export const LegacyCodeReviewSchema = z
  .object({
    /** Agent plugin name (e.g. "claude-code"). Defaults to "claude-code". */
    agent: z.string().min(1).optional(),
    /** Optional model override (passed through to the agent executor config). */
    model: z.string().min(1).optional(),
    /** Optional prompt body injected into the review stage's task. */
    prompt: z.string().optional(),
  })
  .passthrough();

export type LegacyCodeReview = z.infer<typeof LegacyCodeReviewSchema>;

/**
 * Turn a legacy `codeReview:` block into a one-stage ConfiguredPipeline.
 *
 * Locked decisions (from issue #193 acceptance):
 *   - pipeline name: "legacy-code-review"
 *   - stage name:    "review"            (fingerprint scope key)
 *   - trigger.on:    ["pr.opened", "pr.updated"]
 *   - executor.mode: "review"
 */
export function synthesizeLegacyCodeReviewPipeline(
  legacy: LegacyCodeReview,
): ConfiguredPipeline {
  const plugin = legacy.agent ?? DEFAULT_LEGACY_AGENT;
  const executorConfig: Record<string, unknown> = {};
  if (legacy.model !== undefined) executorConfig["model"] = legacy.model;

  return {
    name: LEGACY_CODE_REVIEW_PIPELINE_NAME,
    stages: [
      {
        name: LEGACY_CODE_REVIEW_STAGE_NAME,
        trigger: { on: ["pr.opened", "pr.updated"] },
        executor: {
          kind: "agent",
          plugin,
          mode: "review",
          ...(Object.keys(executorConfig).length > 0 ? { config: executorConfig } : {}),
        },
        task: legacy.prompt !== undefined ? { prompt: legacy.prompt } : {},
      },
    ],
  };
}
