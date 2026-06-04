/**
 * Internal helpers for the pipeline reducer.
 *
 * Pure: every function takes timestamps as parameters; nothing here reads the
 * clock or performs I/O. Split out from reducer.ts to keep individual files
 * within the project's 400-LOC ceiling.
 */

import type { PipelineEffect, ReducerResult } from "./events.js";
import { computeFindingFingerprint } from "./migrate.js";
import {
  type Artifact,
  type ArtifactInput,
  type EngineState,
  type LoopState,
  type LoopStateName,
  type RunId,
  type RunState,
  type RunSummary,
  type RunTerminationReason,
  type StageRunId,
  type StageState,
  isTerminalLoopState,
  isTerminalStageStatus,
  loopKey,
} from "./types.js";

export function iso(now: number): string {
  return new Date(now).toISOString();
}

export function patchRun(
  run: RunState,
  stageDelta: Record<string, StageState>,
  now: number,
): RunState {
  return {
    ...run,
    stages: { ...run.stages, ...stageDelta },
    updatedAt: iso(now),
  };
}

export function replaceRun(state: EngineState, run: RunState): EngineState {
  return { ...state, runs: { ...state.runs, [run.runId]: run } };
}

export function deriveLoopStateFromRun(run: RunState, now: number): LoopState {
  return {
    sessionId: run.sessionId,
    pipelineName: run.pipelineName,
    loopState: run.loopState,
    loopRounds: run.loopRounds,
    lastSha: run.headSha,
    currentRunId: isTerminalLoopState(run.loopState) ? undefined : run.runId,
    updatedAt: iso(now),
  };
}

export function summarizeRun(run: RunState): RunSummary {
  // Deduplicate + sort so summaries are comparable across runs regardless of
  // discovery order. `run.fingerprints` is appended to as artifacts arrive in
  // `finalizeStageCompletion`; it may be undefined on runs that pre-date the
  // fingerprint wiring (8b / #197).
  const unique = [...new Set(run.fingerprints ?? [])].sort();
  return {
    runId: run.runId,
    loopState: run.loopState,
    terminationReason: run.terminationReason,
    headSha: run.headSha,
    loopRounds: run.loopRounds,
    fingerprints: unique,
    createdAt: run.createdAt,
  };
}

export function materializeArtifact(
  input: ArtifactInput,
  runId: RunId,
  stageRunId: StageRunId,
  stageName: string,
  index: number,
  now: number,
): Artifact {
  const artifactId = `${stageRunId}-${index}` as Artifact["artifactId"];
  const base = {
    ...input,
    artifactId,
    pipelineRunId: runId,
    stageRunId,
    stageName,
    status: "open",
    createdAt: iso(now),
  } as Artifact;
  // Finding artifacts carry a stable fingerprint computed from the stage name
  // + structural identity (filePath, anchor, category, title). This is what
  // (a) lets dismissals match across runs (existing behavior via migrate.ts)
  // and (b) drives stallWindow convergence detection (8b).
  if (input.kind === "finding") {
    return { ...base, fingerprint: computeFindingFingerprint(input, stageName) };
  }
  return base;
}

export function invalidTransition(state: EngineState, message: string): ReducerResult {
  return {
    state,
    effects: [
      {
        type: "EMIT_OBSERVATION",
        event: { name: "pipeline.invalid_transition", data: { message } },
      },
    ],
  };
}

export function terminateRunFromState(
  state: EngineState,
  run: RunState,
  reason: RunTerminationReason,
  now: number,
  finalLoopState: LoopStateName,
  preceding: PipelineEffect[],
): ReducerResult {
  const cancelEffects: PipelineEffect[] = [];
  const terminatedStages: Record<string, StageState> = {};
  for (const [name, stage] of Object.entries(run.stages)) {
    if (!isTerminalStageStatus(stage.status)) {
      terminatedStages[name] = {
        ...stage,
        status: stage.status === "running" ? "outdated" : "skipped",
        completedAt: iso(now),
      };
      if (stage.status === "running") {
        cancelEffects.push({
          type: "CANCEL_STAGE",
          runId: run.runId,
          stageRunId: stage.stageRunId,
          stageName: name,
        });
      }
    } else {
      terminatedStages[name] = stage;
    }
  }

  const finalRun: RunState = {
    ...run,
    stages: terminatedStages,
    loopState: finalLoopState,
    terminationReason: reason,
    updatedAt: iso(now),
  };

  const key = loopKey(run.sessionId, run.pipelineName);
  const summaries = [...(state.historySummaries[key] ?? []), summarizeRun(finalRun)];

  // Drop currentRunByLoop only when this run was the active one.
  const nextCurrent: Record<string, RunId> = {};
  for (const [k, v] of Object.entries(state.currentRunByLoop)) {
    if (k === key && v === run.runId) continue;
    nextCurrent[k] = v;
  }

  const nextState: EngineState = {
    ...state,
    runs: { ...state.runs, [run.runId]: finalRun },
    currentRunByLoop: nextCurrent,
    historySummaries: { ...state.historySummaries, [key]: summaries },
  };

  const effects: PipelineEffect[] = [
    ...preceding,
    ...cancelEffects,
    { type: "PERSIST_RUN", runState: finalRun },
    {
      type: "PERSIST_LOOP_STATE",
      runId: run.runId,
      loopState: deriveLoopStateFromRun(finalRun, now),
    },
    {
      type: "EMIT_OBSERVATION",
      event: {
        name: "pipeline.run.terminated",
        data: {
          runId: run.runId,
          pipelineName: run.pipelineName,
          reason,
          loopState: finalLoopState,
        },
      },
    },
  ];

  return { state: nextState, effects };
}

export function terminateRun(
  state: EngineState,
  run: RunState,
  reason: RunTerminationReason,
  now: number,
  runFinalState: LoopStateName,
): ReducerResult {
  return terminateRunFromState(state, run, reason, now, runFinalState, []);
}
