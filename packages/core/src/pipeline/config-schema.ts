/**
 * Zod schema for `pipelines:` blocks in agent-orchestrator.yaml.
 *
 * Mirrors the runtime Pipeline / Stage types in pipeline/types.ts so that
 * `loadConfig()` can surface configured pipelines to the CLI (`ao pipeline list`,
 * `ao pipeline run`).
 *
 * The PipelineId is derived from the map key used in YAML rather than being
 * spelled in each entry — it's branded at the boundary in
 * `configuredPipelineToRuntime`.
 */

import { z } from "zod";

import { asPipelineId, type Pipeline, type Stage, type StageExecutor, type TaskMode } from "./types.js";

const TaskModeSchema = z.enum(["review", "code", "answer"]);

const StageTriggerSchema = z.object({
  on: z.array(
    z.enum(["pr.opened", "pr.updated", "pr.merge_ready", "pr.merged", "manual"]),
  ),
});

const AgentExecutorSchema = z.object({
  kind: z.literal("agent"),
  plugin: z.string(),
  mode: TaskModeSchema,
  config: z.record(z.unknown()).optional(),
});

const CommandExecutorSchema = z.object({
  kind: z.literal("command"),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

const StageExecutorSchema = z.discriminatedUnion("kind", [
  AgentExecutorSchema,
  CommandExecutorSchema,
]);

const TaskSpecSchema = z.object({
  prompt: z.string().optional(),
  outputSchema: z.record(z.unknown()).optional(),
  inputs: z.record(z.unknown()).optional(),
});

const StagePolicySchema = z.object({
  blocksMerge: z.boolean().optional(),
  stallWindow: z.number().int().nonnegative().optional(),
});

const StageBudgetSchema = z.object({
  maxUsd: z.number().nonnegative().optional(),
  maxDurationMs: z.number().int().nonnegative().optional(),
});

const StageSchema = z.object({
  name: z.string().min(1),
  trigger: StageTriggerSchema,
  executor: StageExecutorSchema,
  task: TaskSpecSchema.default({}),
  policy: StagePolicySchema.optional(),
  budget: StageBudgetSchema.optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
  retries: z.number().int().nonnegative().optional(),
  maxLoopRounds: z.number().int().positive().optional(),
});

/**
 * Pipeline config without its branded id — id is derived from the YAML map key.
 * `name` defaults to that same key when omitted.
 */
export const ConfiguredPipelineSchema = z.object({
  name: z.string().min(1).optional(),
  stages: z.array(StageSchema).min(1),
  maxConcurrentStages: z.number().int().positive().optional(),
});

export type ConfiguredPipeline = z.infer<typeof ConfiguredPipelineSchema>;

export const PipelinesConfigSchema = z.record(z.string().min(1), ConfiguredPipelineSchema);

export type PipelinesConfig = z.infer<typeof PipelinesConfigSchema>;

/** Convert a parsed YAML pipeline entry into a runtime Pipeline (branded id). */
export function configuredPipelineToRuntime(
  key: string,
  configured: ConfiguredPipeline,
): Pipeline {
  const stages = configured.stages.map((stage): Stage => {
    const executor: StageExecutor =
      stage.executor.kind === "agent"
        ? {
            kind: "agent",
            plugin: stage.executor.plugin,
            mode: stage.executor.mode as TaskMode,
            ...(stage.executor.config !== undefined ? { config: stage.executor.config } : {}),
          }
        : {
            kind: "command",
            command: stage.executor.command,
            ...(stage.executor.args !== undefined ? { args: stage.executor.args } : {}),
            ...(stage.executor.env !== undefined ? { env: stage.executor.env } : {}),
            ...(stage.executor.cwd !== undefined ? { cwd: stage.executor.cwd } : {}),
          };

    return {
      name: stage.name,
      trigger: { on: [...stage.trigger.on] },
      executor,
      task: { ...stage.task },
      ...(stage.policy ? { policy: { ...stage.policy } } : {}),
      ...(stage.budget ? { budget: { ...stage.budget } } : {}),
      ...(stage.timeoutMs !== undefined ? { timeoutMs: stage.timeoutMs } : {}),
      ...(stage.retries !== undefined ? { retries: stage.retries } : {}),
      ...(stage.maxLoopRounds !== undefined ? { maxLoopRounds: stage.maxLoopRounds } : {}),
    };
  });

  return {
    id: asPipelineId(key),
    name: configured.name ?? key,
    stages,
    ...(configured.maxConcurrentStages !== undefined
      ? { maxConcurrentStages: configured.maxConcurrentStages }
      : {}),
  };
}
