/**
 * Pipeline configuration validation.
 *
 * Runs at config load (not at runtime). Today the only check is the
 * `supportedTaskModes` contract on agent stages: if a stage routes
 * `executor.kind === "agent"` with `mode = "review"`, the named agent plugin
 * must advertise `"review"` in its manifest's `supportedTaskModes`.
 *
 * Failures throw PipelineConfigError with a message that names the offending
 * stage, agent, and mode — the engine never sees a misconfigured pipeline.
 */

import type { PluginManifest, PluginRegistry } from "../types.js";
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
