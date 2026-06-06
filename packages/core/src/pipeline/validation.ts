/**
 * Pipeline configuration validation.
 *
 * Two checks today:
 *  - `validatePipelineAgentModes` — every agent stage routes to a registered
 *    plugin whose manifest advertises the requested `task.mode`.
 *  - `validatePipelineDag` — the dependsOn + routes-refs graph is acyclic.
 *    Zod already enforces this at config load via `superRefine`; the runtime
 *    check guards programmatic Pipelines that bypass Zod (e.g. callers that
 *    construct a `Pipeline` directly and hand it to `engine.startRun`).
 *
 * Failures throw PipelineConfigError with a message that names the offending
 * stage and pipeline — the engine never advances a misconfigured pipeline.
 */

import type { PluginManifest, PluginRegistry } from "../types.js";
import { findFirstStageCycle } from "./dag.js";
import type { Pipeline, TaskMode } from "./types.js";

export class PipelineConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineConfigError";
  }
}

/**
 * Resolve the `supportedTaskModes` advertised by an agent plugin's manifest.
 * Returns `null` when the plugin is not registered (caller decides whether a
 * missing plugin is a hard error — usually it is at config load).
 */
export function getSupportedTaskModes(
  registry: PluginRegistry,
  agentName: string,
): TaskMode[] | null {
  const manifests = registry.list("agent");
  const manifest = manifests.find((m: PluginManifest) => m.name === agentName);
  if (!manifest) return null;
  return manifest.supportedTaskModes ?? [];
}

/**
 * Validate that every agent-stage in a pipeline routes to a registered agent
 * plugin whose manifest advertises the requested `task.mode`.
 *
 * Throws PipelineConfigError on the first failure. Caller is expected to wrap
 * pipelines individually so error messages can include pipeline context.
 */
export function validatePipelineAgentModes(pipeline: Pipeline, registry: PluginRegistry): void {
  for (const stage of pipeline.stages) {
    if (stage.executor.kind !== "agent") continue;
    const { plugin: agentName, mode } = stage.executor;

    const supported = getSupportedTaskModes(registry, agentName);
    if (supported === null) {
      throw new PipelineConfigError(
        `Pipeline "${pipeline.name}" stage "${stage.name}" references unknown agent plugin "${agentName}".`,
      );
    }

    if (!supported.includes(mode)) {
      throw new PipelineConfigError(
        `Pipeline "${pipeline.name}" stage "${stage.name}" requires agent "${agentName}" to support task mode "${mode}", but its manifest declares supportedTaskModes=[${supported
          .map((m) => `"${m}"`)
          .join(", ")}].`,
      );
    }
  }
}

/**
 * Reject a runtime `Pipeline` whose `dependsOn` + `routes.when.stages` graph
 * contains a cycle. Zod already enforces this at config load, but programmatic
 * callers (tests, future engine consumers, in-process pipeline construction)
 * skip Zod and would otherwise deadlock the run silently — every cycle member
 * would stay `pending` forever because `arePreconditionsTerminal` is false
 * for every node in the cycle.
 *
 * Throws `PipelineConfigError` on the first cycle found. Self-loops are not
 * surfaced here; the schema-level explicit self-reference checks own that
 * error path.
 */
export function validatePipelineDag(pipeline: Pipeline): void {
  const cycle = findFirstStageCycle(pipeline.stages);
  if (cycle) {
    throw new PipelineConfigError(
      `Pipeline "${pipeline.name}" has a stage dependency cycle: ${cycle.join(" → ")}.`,
    );
  }
}
