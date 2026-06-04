export {
  createAgentExecutor,
  AgentExecutorSpawnError,
  STAGE_FINDINGS_RELATIVE_PATH,
  FINDINGS_FILE_SIZE_CAP_BYTES,
  type AgentStageExecutor,
  type AgentExecutorDeps,
  type AgentExecutorObservation,
  type RunningAgentStage,
  type StageOutcome,
  type StartStageInput,
} from "./agent.js";

export {
  dispatchBuiltin,
  UnknownBuiltinExecutorError,
  type BuiltinDispatcherDeps,
  type BuiltinDispatchObservation,
  type BuiltinDispatchOutcome,
} from "./builtin/dispatcher.js";
export {
  runRouter,
  type RouterDeps,
  type RouterObservation,
  type RouterOutcome,
} from "./builtin/router.js";
export { runCompose, type ComposeOutcome } from "./builtin/compose.js";

export {
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
} from "./command.js";
