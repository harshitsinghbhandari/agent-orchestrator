/**
 * Event and effect (command) shapes consumed by the pipeline reducer.
 *
 * The reducer is pure: events carry `now` (driver-stamped), and the engine
 * executes effects after each `reduce()` call.
 */

import type {
  Artifact,
  ArtifactId,
  ArtifactInput,
  ArtifactStatus,
  EngineState,
  LoopState,
  Pipeline,
  RunId,
  RunState,
  RunTerminationReason,
  Stage,
  StageRunId,
  StageTriggerEvent,
  Verdict,
  WorkstreamPredicateCtx,
} from "./types.js";

/** Stable identity for a stage-run follow-up thread. */
export interface ThreadKey {
  runId: RunId;
  stageRunId: StageRunId;
}

interface EventBase {
  /** Driver-stamped timestamp (epoch ms). Reducer must not read the clock. */
  now: number;
}

export type PipelineEvent =
  | (EventBase & {
      type: "TRIGGER_FIRED";
      trigger: StageTriggerEvent;
      sessionId: string;
      pipeline: Pipeline;
      headSha: string;
      /** Driver-allocated run id; reducer uses verbatim. */
      runId: RunId;
      /** Driver-allocated stage run ids, keyed by stage name. */
      stageRunIds: Record<string, StageRunId>;
      /**
       * Pipeline-v3 workstream snapshot (issue #199). Frozen onto the new
       * RunState so the reducer/dag/router can resolve workstream context
       * without re-querying the lifecycle manager mid-run.
       */
      workstream?: WorkstreamPredicateCtx;
    })
  | (EventBase & {
      type: "STAGE_STARTED";
      runId: RunId;
      stageName: string;
    })
  | (EventBase & {
      type: "STAGE_COMPLETED";
      runId: RunId;
      stageName: string;
      verdict?: Verdict;
      artifacts: ArtifactInput[];
    })
  | (EventBase & {
      type: "STAGE_FAILED";
      runId: RunId;
      stageName: string;
      errorMessage: string;
    })
  | (EventBase & {
      type: "NEW_SHA_DETECTED";
      sessionId: string;
      pipelineName: string;
      sha: string;
    })
  | (EventBase & {
      type: "RUN_CANCELLED";
      runId: RunId;
      reason: RunTerminationReason;
    })
  | (EventBase & {
      type: "RUN_RESUMED";
      runId: RunId;
      /**
       * Driver-allocated stage run ids for the failed stages being re-armed.
       * Required so the new attempt has a fresh, non-colliding stageRunId.
       */
      stageRunIds: Record<string, StageRunId>;
    })
  | (EventBase & {
      type: "CONFIG_CHANGED";
      sessionId: string;
      pipelineName: string;
    })
  | (EventBase & {
      type: "ARTIFACT_STATUS_CHANGED";
      runId: RunId;
      stageRunId: StageRunId;
      artifactId: ArtifactId;
      status: ArtifactStatus;
      /** Optional human label, e.g. reviewer id, for audit observation. */
      actor?: string;
    })
  | (EventBase & {
      type: "USER_FOLLOWUP";
      runId: RunId;
      stageRunId: StageRunId;
      stageName: string;
      message: string;
      /** Reviewer surface id for thread persistence + observation. */
      reviewerId?: string;
    })
  | (EventBase & {
      type: "FOLLOWUP_REPLY";
      runId: RunId;
      stageRunId: StageRunId;
      stageName: string;
      reply: string;
    })
  | (EventBase & { type: "TICK" });

export type PipelineEffect =
  | { type: "START_STAGE"; runId: RunId; stageRunId: StageRunId; stage: Stage }
  | { type: "CANCEL_STAGE"; runId: RunId; stageRunId: StageRunId; stageName: string }
  | { type: "PERSIST_RUN"; runState: RunState }
  | { type: "PERSIST_LOOP_STATE"; runId: RunId; loopState: LoopState }
  | {
      type: "APPEND_ARTIFACTS";
      runId: RunId;
      stageRunId: StageRunId;
      artifacts: Artifact[];
    }
  | {
      type: "UPDATE_ARTIFACT_STATUS";
      runId: RunId;
      stageRunId: StageRunId;
      artifactId: ArtifactId;
      status: ArtifactStatus;
    }
  | {
      type: "APPEND_THREAD_MESSAGE";
      runId: RunId;
      stageRunId: StageRunId;
      role: "user" | "agent" | "system";
      content: string;
      reviewerId?: string;
    }
  | {
      type: "SEND_FOLLOWUP";
      runId: RunId;
      stageRunId: StageRunId;
      stageName: string;
      sessionId: string;
      message: string;
      reviewerId?: string;
    }
  | {
      type: "EMIT_OBSERVATION";
      event: { name: string; data: Record<string, unknown> };
    };

export interface ReducerResult {
  state: EngineState;
  effects: PipelineEffect[];
}
