/**
 * Pipeline subsystem — public re-exports.
 *
 * Consumers import from `@aoagents/ao-core` or, for granular bundles,
 * `@aoagents/ao-core/pipeline` (when an export entry is added).
 */

export * from "./types.js";
export type { PipelineEvent, PipelineEffect, ReducerResult } from "./events.js";
export { reduce } from "./reducer.js";
export { createPipelineStore, type PipelineStore, type PersistedStageRun } from "./store.js";
export {
  pipelineLayout,
  runFilePath,
  stageFilePath,
  artifactsDirForRun,
  artifactsFilePath,
  loopFilePath,
  type PipelineLayout,
} from "./paths.js";

export {
  PipelineConfigError,
  getSupportedTaskModes,
  validatePipelineAgentModes,
  validatePipelineDag,
} from "./validation.js";

export { findFirstStageCycle, scheduleAfterChange, type ScheduleResult } from "./dag.js";

export {
  evaluate as evaluatePredicate,
  isV0Default,
  predicateReferencedStages,
} from "./predicate-evaluator.js";

export { buildStagePrompt, type StagePromptInput } from "./stage-prompt.js";

export {
  createAgentExecutor,
  AgentExecutorSpawnError,
  STAGE_FINDINGS_RELATIVE_PATH,
  type AgentStageExecutor,
  type AgentExecutorDeps,
  type RunningAgentStage,
  type StageOutcome,
  type StartStageInput,
  dispatchBuiltin,
  UnknownBuiltinExecutorError,
  runRouter,
  runCompose,
  type BuiltinDispatcherDeps,
  type BuiltinDispatchObservation,
  type BuiltinDispatchOutcome,
  type RouterDeps,
  type RouterObservation,
  type RouterOutcome,
  type ComposeOutcome,
  createCommandExecutor,
  COMMAND_KILL_GRACE_MS,
  COMMAND_OUTPUT_CAP_BYTES,
  type CommandExecutorDeps,
  type CommandStageExecutor,
  type CommandStageOutcome,
  type CommandTaskOutcome,
  type CommandTaskResult,
  type CommandObservation,
  type RunningCommandStage,
  type StartCommandStageInput,
} from "./executors/index.js";

export {
  createPipelineEngine,
  hydrateEngineState,
  type PipelineEngine,
  type PipelineEngineDeps,
  type StartRunInput,
} from "./engine.js";

export {
  ConfiguredPipelineSchema,
  PipelinesConfigSchema,
  configuredPipelineToRuntime,
  type ConfiguredPipeline,
  type PipelinesConfig,
} from "./config-schema.js";

export {
  computeFindingFingerprint,
  migrateStore,
  type MigrateResult,
} from "./migrate.js";

export {
  resolveWorkspaceClass,
  snapshotWorkspace,
  verifyWorkspaceUnchanged,
  buildGuardWarning,
  createIsolatedWorktree,
  destroyIsolatedWorktree,
  isolatedWorktreePath,
  type WorkspaceClass,
  type WorkspaceSnapshot,
  type GuardCheckResult,
} from "./workspace.js";
