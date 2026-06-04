/**
 * Pure pipeline reducer.
 *
 * Signature: `reduce(state, event) → { state, effects }`. The reducer is
 * synchronous and pure — never reads the clock, never performs I/O. Every
 * event carries `now` so the driver stamps timestamps at enqueue time.
 *
 * Effects are intent-only — the engine (lands in a later sub-task) is
 * responsible for executing them and feeding results back as new events.
 *
 * Event/effect shapes live in events.ts; common helpers live in
 * reducer-helpers.ts.
 */

import { scheduleAfterChange } from "./dag.js";
import type { PipelineEffect, PipelineEvent, ReducerResult } from "./events.js";
import { evaluate, isV0Default } from "./predicate-evaluator.js";
import {
  deriveLoopStateFromRun,
  invalidTransition,
  iso,
  materializeArtifact,
  patchRun,
  replaceRun,
  terminateRun,
  terminateRunFromState,
} from "./reducer-helpers.js";
import {
  type Artifact,
  type ArtifactId,
  type ArtifactInput,
  type ArtifactStatus,
  type EngineState,
  type LoopStateName,
  type Pipeline,
  type Predicate,
  type PredicateCtx,
  type RunId,
  type RunState,
  type RunTerminationReason,
  type StageRunId,
  type StageState,
  type StageTriggerEvent,
  type Verdict,
  isTerminalLoopState,
  loopKey,
} from "./types.js";

export function reduce(state: EngineState, event: PipelineEvent): ReducerResult {
  switch (event.type) {
    case "TRIGGER_FIRED":
      return reduceTriggerFired(state, event);
    case "STAGE_STARTED":
      return reduceStageStarted(state, event);
    case "STAGE_COMPLETED":
      return reduceStageCompleted(state, event);
    case "STAGE_FAILED":
      return reduceStageFailed(state, event);
    case "NEW_SHA_DETECTED":
      return reduceNewShaDetected(state, event);
    case "RUN_CANCELLED":
      return reduceRunCancelled(state, event);
    case "RUN_RESUMED":
      return reduceRunResumed(state, event);
    case "CONFIG_CHANGED":
      return reduceConfigChanged(state, event);
    case "ARTIFACT_STATUS_CHANGED":
      return reduceArtifactStatusChanged(state, event);
    case "USER_FOLLOWUP":
      return reduceUserFollowup(state, event);
    case "FOLLOWUP_REPLY":
      return reduceFollowupReply(state, event);
    case "TICK":
      return { state, effects: [] };
  }
}

interface TriggerFiredEvent {
  now: number;
  trigger: StageTriggerEvent;
  sessionId: string;
  pipeline: Pipeline;
  headSha: string;
  runId: RunId;
  stageRunIds: Record<string, StageRunId>;
}

function reduceTriggerFired(state: EngineState, event: TriggerFiredEvent): ReducerResult {
  const { sessionId, pipeline, headSha, runId, stageRunIds, trigger, now } = event;
  const key = loopKey(sessionId, pipeline.name);

  if (state.currentRunByLoop[key] && state.runs[state.currentRunByLoop[key]]) {
    // Active run already in flight for this loop — driver must cancel via
    // NEW_SHA_DETECTED or RUN_CANCELLED before a new run can start.
    return { state, effects: [] };
  }

  const stages = buildInitialStageStates(pipeline, stageRunIds);
  if (!stages) {
    return invalidTransition(state, "TRIGGER_FIRED missing stageRunIds for one or more stages");
  }

  const priorRound = state.historySummaries[key]?.length ?? 0;
  const isContinuation = trigger === "pr.updated" || trigger === "manual";
  const loopRounds = isContinuation ? priorRound + 1 : Math.max(priorRound, 1);

  const initialRunState: RunState = {
    runId,
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    sessionId,
    pipelineConfigSnapshot: pipeline,
    headSha,
    loopState: "running",
    loopRounds,
    stages,
    createdAt: iso(now),
    updatedAt: iso(now),
  };

  // Run the DAG scheduler once at trigger time so that:
  //  - stages whose `routes` reference *no upstream* (vacuous predicates) get
  //    a single skip decision instead of sitting pending forever, and
  //  - parallel-startable stages emit START_STAGE in one shot rather than
  //    waiting for the next reducer step.
  const sched = scheduleAfterChange(initialRunState, now);
  const runState = sched.run;

  // Cascade-skipping into a fully-terminal pipeline at trigger time is
  // possible only with degenerate predicates (e.g. `anyFailed: []`). When it
  // happens, terminate the run cleanly instead of leaving an orphaned record.
  if (sched.allTerminal) {
    const stateWithRun: EngineState = {
      ...state,
      runs: { ...state.runs, [runId]: runState },
      currentRunByLoop: { ...state.currentRunByLoop, [key]: runId },
    };
    const preceding: PipelineEffect[] = [
      {
        type: "EMIT_OBSERVATION",
        event: {
          name: "pipeline.run.created",
          data: { runId, pipelineName: pipeline.name, sessionId, trigger, headSha, loopRounds },
        },
      },
      ...skipObservations(runState.runId, sched.newlySkipped, runState),
    ];
    const decision = decideRunExit(runState, stateWithRun);
    return terminateRunFromState(
      stateWithRun,
      runState,
      decision.reason,
      now,
      decision.loopState,
      preceding,
    );
  }

  const nextState: EngineState = {
    ...state,
    runs: { ...state.runs, [runId]: runState },
    currentRunByLoop: { ...state.currentRunByLoop, [key]: runId },
  };

  const effects: PipelineEffect[] = [
    { type: "PERSIST_RUN", runState },
    {
      type: "PERSIST_LOOP_STATE",
      runId,
      loopState: deriveLoopStateFromRun(runState, now),
    },
    ...sched.startEffects,
    {
      type: "EMIT_OBSERVATION",
      event: {
        name: "pipeline.run.created",
        data: {
          runId,
          pipelineName: pipeline.name,
          sessionId,
          trigger,
          headSha,
          loopRounds,
        },
      },
    },
    ...skipObservations(runState.runId, sched.newlySkipped, runState),
  ];

  return { state: nextState, effects };
}

/**
 * Build "pipeline.stage.terminated" observations for stages that just got
 * skipped via the DAG scheduler. Mirrors the shape emitted by
 * `finalizeStageCompletion` so consumers don't need a per-source schema.
 */
function skipObservations(runId: RunId, skippedNames: string[], run: RunState): PipelineEffect[] {
  return skippedNames.map((stageName) => ({
    type: "EMIT_OBSERVATION" as const,
    event: {
      name: "pipeline.stage.terminated",
      data: {
        runId,
        stageName,
        status: "skipped" as const,
        artifactCount: run.stages[stageName]?.artifacts.length ?? 0,
      },
    },
  }));
}

interface StageStartedEvent {
  now: number;
  runId: RunId;
  stageName: string;
}

function reduceStageStarted(state: EngineState, event: StageStartedEvent): ReducerResult {
  const { runId, stageName, now } = event;
  const run = state.runs[runId];
  if (!run) return invalidTransition(state, `STAGE_STARTED for unknown runId=${runId}`);

  const stage = run.stages[stageName];
  if (!stage) return invalidTransition(state, `STAGE_STARTED for unknown stage=${stageName}`);
  if (stage.status !== "pending") {
    return invalidTransition(
      state,
      `STAGE_STARTED requires pending; got ${stage.status} for ${stageName}`,
    );
  }

  const updatedStage: StageState = { ...stage, status: "running", startedAt: iso(now) };
  const updatedRun = patchRun(run, { [stageName]: updatedStage }, now);

  return {
    state: replaceRun(state, updatedRun),
    effects: [
      { type: "PERSIST_RUN", runState: updatedRun },
      {
        type: "EMIT_OBSERVATION",
        event: {
          name: "pipeline.stage.started",
          // `stageRunId` rotates on every retry/revival, so it's the only
          // field that uniquely identifies *this* execution. `attempt` is
          // not enough now that outdated revival keeps the counter
          // unchanged — two `stage.started` events for the same
          // (runId, stageName) can otherwise share the same attempt.
          data: {
            runId,
            stageName,
            stageRunId: stage.stageRunId,
            attempt: stage.attempt,
          },
        },
      },
    ],
  };
}

interface StageCompletedEvent {
  now: number;
  runId: RunId;
  stageName: string;
  verdict?: Verdict;
  artifacts: ArtifactInput[];
}

function reduceStageCompleted(state: EngineState, event: StageCompletedEvent): ReducerResult {
  const { runId, stageName, verdict, artifacts: artifactInputs, now } = event;
  const run = state.runs[runId];
  if (!run) return invalidTransition(state, `STAGE_COMPLETED for unknown runId=${runId}`);

  const stage = run.stages[stageName];
  if (!stage) return invalidTransition(state, `STAGE_COMPLETED for unknown stage=${stageName}`);
  if (stage.status !== "running") {
    return invalidTransition(
      state,
      `STAGE_COMPLETED requires running; got ${stage.status} for ${stageName}`,
    );
  }

  const newArtifacts = artifactInputs.map((input, idx) =>
    materializeArtifact(input, runId, stage.stageRunId, stageName, idx, now),
  );
  const updatedStage: StageState = {
    ...stage,
    status: "succeeded",
    completedAt: iso(now),
    verdict,
    artifacts: [...stage.artifacts, ...newArtifacts.map((a) => a.artifactId)],
  };

  return finalizeStageCompletion(state, run, stageName, updatedStage, newArtifacts, now);
}

interface StageFailedEvent {
  now: number;
  runId: RunId;
  stageName: string;
  errorMessage: string;
}

function reduceStageFailed(state: EngineState, event: StageFailedEvent): ReducerResult {
  const { runId, stageName, errorMessage, now } = event;
  const run = state.runs[runId];
  if (!run) return invalidTransition(state, `STAGE_FAILED for unknown runId=${runId}`);

  const stage = run.stages[stageName];
  if (!stage) return invalidTransition(state, `STAGE_FAILED for unknown stage=${stageName}`);
  if (stage.status !== "running" && stage.status !== "pending") {
    return invalidTransition(
      state,
      `STAGE_FAILED requires running|pending; got ${stage.status} for ${stageName}`,
    );
  }

  const updatedStage: StageState = {
    ...stage,
    status: "failed",
    completedAt: iso(now),
    errorMessage,
  };

  return finalizeStageCompletion(state, run, stageName, updatedStage, [], now);
}

interface NewShaEvent {
  now: number;
  sessionId: string;
  pipelineName: string;
  sha: string;
}

function reduceNewShaDetected(state: EngineState, event: NewShaEvent): ReducerResult {
  const { sessionId, pipelineName, sha, now } = event;
  const key = loopKey(sessionId, pipelineName);
  const runId = state.currentRunByLoop[key];
  if (!runId) return { state, effects: [] };

  const run = state.runs[runId];
  if (!run || run.headSha === sha) return { state, effects: [] };

  // Run becomes outdated; loop key is freed so the driver can spawn a new
  // TRIGGER_FIRED for the new SHA.
  return terminateRun(state, run, "outdated", now, "terminated");
}

interface RunCancelledEvent {
  now: number;
  runId: RunId;
  reason: RunTerminationReason;
}

function reduceRunCancelled(state: EngineState, event: RunCancelledEvent): ReducerResult {
  const { runId, reason, now } = event;
  const run = state.runs[runId];
  if (!run) return invalidTransition(state, `RUN_CANCELLED for unknown runId=${runId}`);
  if (run.loopState !== "running" && run.loopState !== "awaiting_context") {
    return invalidTransition(
      state,
      `RUN_CANCELLED requires running|awaiting_context; got ${run.loopState}`,
    );
  }

  const runFinalState: LoopStateName = reason === "stage_failure" ? "stalled" : "terminated";
  return terminateRun(state, run, reason, now, runFinalState);
}

interface RunResumedEvent {
  now: number;
  runId: RunId;
  stageRunIds: Record<string, StageRunId>;
}

/**
 * Resume a stalled/failed run: reset every `failed` stage back to `pending`
 * with a fresh stageRunId (and incremented `attempt`, capped by stage.retries
 * when set), then re-arm the loop pointer so the engine picks the run up on
 * its next tick. No-op when the run has nothing to resume.
 */
function reduceRunResumed(state: EngineState, event: RunResumedEvent): ReducerResult {
  const { runId, stageRunIds, now } = event;
  const run = state.runs[runId];
  if (!run) return invalidTransition(state, `RUN_RESUMED for unknown runId=${runId}`);

  // Resume only applies to runs that have stopped advancing. The CLI rejects
  // non-terminal runs at the service layer; this guard catches direct
  // dispatch (tests, future config-watcher) so the reducer never re-arms a
  // run the engine still considers active.
  if (!isTerminalLoopState(run.loopState)) {
    return invalidTransition(
      state,
      `RUN_RESUMED requires a terminal loop state; got ${run.loopState} for ${runId}`,
    );
  }

  // Refuse to resume when another run already owns the loop key. Without
  // this guard, resuming an old stalled run after a fresh trigger has
  // claimed the loop would silently dispossess the active run of its loop
  // pointer — NEW_SHA_DETECTED, CONFIG_CHANGED, and the triggerRun guard
  // would then track the wrong run.
  const key = loopKey(run.sessionId, run.pipelineName);
  const activeRunId = state.currentRunByLoop[key];
  if (activeRunId !== undefined && activeRunId !== runId) {
    return invalidTransition(
      state,
      `RUN_RESUMED for ${runId} but loop "${key}" is already owned by active run ${activeRunId}; cancel that run before resuming the older one`,
    );
  }

  // `failed` stages are real retries — bump attempt and consume the
  // `stage.retries` budget. `outdated` stages were running when an external
  // event (NEW_SHA_DETECTED, CONFIG_CHANGED, parallel-sibling failure)
  // forced `terminateRunFromState` to cancel them; that's not a stage
  // failure, so reviving them must NOT consume the retry cap. They keep
  // their attempt counter and just get a fresh stageRunId for the next run.
  const failedStageNames = Object.entries(run.stages)
    .filter(([, s]) => s.status === "failed")
    .map(([name]) => name);
  const outdatedStageNames = Object.entries(run.stages)
    .filter(([, s]) => s.status === "outdated")
    .map(([name]) => name);
  if (failedStageNames.length === 0 && outdatedStageNames.length === 0) {
    // Nothing to resume. Keep the state unchanged so the caller can no-op too.
    return { state, effects: [] };
  }

  const stageRetriesByName = new Map<string, number | undefined>();
  for (const stage of run.pipelineConfigSnapshot.stages) {
    stageRetriesByName.set(stage.name, stage.retries);
  }

  const stageDelta: Record<string, StageState> = {};

  // Real retries: bump attempt, check the retries cap.
  for (const name of failedStageNames) {
    const fresh = stageRunIds[name];
    if (!fresh) {
      return invalidTransition(
        state,
        `RUN_RESUMED missing stageRunId for failed stage "${name}"`,
      );
    }
    const prior = run.stages[name];
    const cap = stageRetriesByName.get(name);
    if (cap !== undefined && prior.attempt >= cap + 1) {
      return invalidTransition(
        state,
        `RUN_RESUMED would exceed stage.retries=${cap} for "${name}" (attempt=${prior.attempt})`,
      );
    }
    stageDelta[name] = {
      stageRunId: fresh,
      status: "pending",
      attempt: prior.attempt + 1,
      artifacts: [],
    };
  }

  // External cancellations: don't bump attempt, don't check cap.
  for (const name of outdatedStageNames) {
    const fresh = stageRunIds[name];
    if (!fresh) {
      return invalidTransition(
        state,
        `RUN_RESUMED missing stageRunId for outdated stage "${name}"`,
      );
    }
    const prior = run.stages[name];
    stageDelta[name] = {
      stageRunId: fresh,
      status: "pending",
      attempt: prior.attempt,
      artifacts: [],
    };
  }

  // Also revive any stages that `terminateRunFromState` cascade-skipped when
  // the run failed — they never got an execution attempt, so they keep their
  // existing stageRunId and attempt counter. Without this, a failure in a
  // DAG would permanently lose every downstream branch on resume because
  // `scheduleAfterChange` only considers `pending` stages.
  //
  // `scheduleAfterChange` runs after this delta is applied, so any stage
  // whose `routes` predicate is genuinely unsatisfied gets re-skipped — we
  // don't accidentally revive predicate-driven skips.
  for (const [name, prior] of Object.entries(run.stages)) {
    if (prior.status !== "skipped") continue;
    if (stageDelta[name]) continue;
    stageDelta[name] = {
      stageRunId: prior.stageRunId,
      status: "pending",
      attempt: prior.attempt,
      artifacts: prior.artifacts,
    };
  }

  const updatedRun: RunState = {
    ...run,
    stages: { ...run.stages, ...stageDelta },
    loopState: "running",
    updatedAt: iso(now),
  };
  delete (updatedRun as { terminationReason?: RunTerminationReason }).terminationReason;

  // After re-arming failed/outdated stages, run the DAG scheduler so
  // re-pending stages start in dependsOn order rather than declaration
  // order. Resumes never terminate the run on their own (we just
  // transitioned back to `running`), so we ignore `sched.allTerminal`.
  const sched = scheduleAfterChange(updatedRun, now);
  const finalRun = sched.run;

  const nextState: EngineState = {
    ...state,
    runs: { ...state.runs, [runId]: finalRun },
    currentRunByLoop: { ...state.currentRunByLoop, [key]: runId },
  };

  const effects: PipelineEffect[] = [
    { type: "PERSIST_RUN", runState: finalRun },
    {
      type: "PERSIST_LOOP_STATE",
      runId,
      loopState: deriveLoopStateFromRun(finalRun, now),
    },
    ...sched.startEffects,
    ...skipObservations(runId, sched.newlySkipped, finalRun),
    {
      type: "EMIT_OBSERVATION",
      event: {
        name: "pipeline.run.resumed",
        data: {
          runId,
          pipelineName: run.pipelineName,
          stageNames: [...failedStageNames, ...outdatedStageNames],
        },
      },
    },
  ];

  return { state: nextState, effects };
}

interface ConfigChangedEvent {
  now: number;
  sessionId: string;
  pipelineName: string;
}

function reduceConfigChanged(state: EngineState, event: ConfigChangedEvent): ReducerResult {
  const { sessionId, pipelineName, now } = event;
  const key = loopKey(sessionId, pipelineName);
  const runId = state.currentRunByLoop[key];
  if (!runId) return { state, effects: [] };
  const run = state.runs[runId];
  if (!run) return { state, effects: [] };

  return terminateRun(state, run, "config_change", now, "terminated");
}

function buildInitialStageStates(
  pipeline: Pipeline,
  stageRunIds: Record<string, StageRunId>,
): Record<string, StageState> | null {
  const out: Record<string, StageState> = {};
  for (const stage of pipeline.stages) {
    const stageRunId = stageRunIds[stage.name];
    if (!stageRunId) return null;
    out[stage.name] = {
      stageRunId,
      status: "pending",
      attempt: 1,
      artifacts: [],
    };
  }
  return out;
}

function finalizeStageCompletion(
  state: EngineState,
  run: RunState,
  stageName: string,
  updatedStage: StageState,
  newArtifacts: Artifact[],
  now: number,
): ReducerResult {
  // Accumulate finding fingerprints onto the run so `summarizeRun` can return
  // them at termination (#197 / 8b). We append rather than recompute so the
  // reducer never re-reads stored artifacts.
  const newFingerprints: string[] = [];
  for (const a of newArtifacts) {
    if (a.kind === "finding" && a.fingerprint) newFingerprints.push(a.fingerprint);
  }
  const runWithFingerprints: RunState =
    newFingerprints.length > 0
      ? { ...run, fingerprints: [...(run.fingerprints ?? []), ...newFingerprints] }
      : run;
  // Mirror finding artifacts onto run.findings for the predicate evaluator
  // (#196) — `patchRunWithFindings` is a no-op when there are no findings.
  const updatedRun = patchRunWithFindings(
    patchRun(runWithFingerprints, { [stageName]: updatedStage }, now),
    newArtifacts,
  );

  const effects: PipelineEffect[] = [];

  if (newArtifacts.length > 0) {
    effects.push({
      type: "APPEND_ARTIFACTS",
      runId: run.runId,
      stageRunId: updatedStage.stageRunId,
      artifacts: newArtifacts,
    });
  }

  effects.push({
    type: "EMIT_OBSERVATION",
    event: {
      name: "pipeline.stage.terminated",
      data: {
        runId: run.runId,
        stageName,
        status: updatedStage.status,
        verdict: updatedStage.verdict,
        artifactCount: updatedStage.artifacts.length,
      },
    },
  });

  // Failure-tolerant scheduling: STAGE_FAILED no longer immediately
  // terminates the run. `scheduleAfterChange` cascade-skips stages whose
  // `dependsOn` is no longer satisfiable AND starts any recovery branch
  // whose `routes` predicate now matches the failure. The run only
  // terminates when every stage has reached a terminal status (then we
  // evaluate `exitPredicates` / v0 fallback to choose `done` vs `stalled`).
  const sched = scheduleAfterChange(updatedRun, now);
  effects.push(...skipObservations(run.runId, sched.newlySkipped, sched.run));

  if (sched.allTerminal) {
    // 8b — convergence detection runs BEFORE the regular exit decision. When
    // the prior `stallWindow - 1` runs in history all expose the same
    // finding-fingerprint set as the just-completed run, terminate as
    // `converged` → `stalled` so an agent ping-ponging on the same issues
    // doesn't loop forever. Convergence overrides both `exitPredicates` and
    // the v0 default — by definition the loop has hit a fixpoint, regardless
    // of whether stages individually succeeded.
    if (isConverged(state, sched.run)) {
      return terminateRunFromState(
        replaceRun(state, sched.run),
        sched.run,
        "converged",
        now,
        "stalled",
        effects,
      );
    }
    const decision = decideRunExit(sched.run, state);
    return terminateRunFromState(
      replaceRun(state, sched.run),
      sched.run,
      decision.reason,
      now,
      decision.loopState,
      effects,
    );
  }

  effects.unshift({ type: "PERSIST_RUN", runState: sched.run });
  effects.push(...sched.startEffects);

  return { state: replaceRun(state, sched.run), effects };
}

/**
 * Append new finding artifacts to `run.findings` (#196). JSON-kind artifacts
 * are not mirrored — the predicate DSL's findings-aware kinds reason about
 * the finding subtype only.
 */
function patchRunWithFindings(run: RunState, artifacts: Artifact[]): RunState {
  const findings = artifacts.filter((a) => a.kind === "finding");
  if (findings.length === 0) return run;
  return { ...run, findings: [...(run.findings ?? []), ...findings] };
}

interface ExitDecision {
  reason: RunTerminationReason;
  loopState: LoopStateName;
}

/**
 * Decide how the run terminates once every stage is in a terminal status.
 *
 * Order of consideration:
 *  1. `pipeline.exitPredicates.done` (if set and not `v0_default`): when it
 *     evaluates `true`, terminate as `done`/`completed`.
 *  2. `pipeline.exitPredicates.stalled` (if set and not `v0_default`): when
 *     it evaluates `true`, terminate as `stalled`/`stage_failure`.
 *  3. v0 default: any `failed` stage → `stalled`/`stage_failure`, else `done`/`completed`.
 *
 * The reducer is pure — it consults `state.historySummaries` for the run's
 * loop key so `loop_rounds_at_least` and history-aware composites have a
 * real ledger rather than an empty snapshot.
 *
 * NOTE: convergence detection (#197 / 8b) fires BEFORE this in the caller.
 * A `converged` decision short-circuits before we reach the exit-predicate
 * pipeline, so this function only sees runs that haven't hit a fixpoint.
 */
function decideRunExit(run: RunState, state: EngineState): ExitDecision {
  const exits = run.pipelineConfigSnapshot.exitPredicates;
  const ctx: PredicateCtx = {
    run,
    history: state.historySummaries[loopKey(run.sessionId, run.pipelineName)] ?? [],
    findings: run.findings ?? [],
  };

  const doneMatched = matchesConfiguredPredicate(exits?.done, ctx);
  if (doneMatched === true) {
    return { reason: "completed", loopState: "done" };
  }
  const stalledMatched = matchesConfiguredPredicate(exits?.stalled, ctx);
  if (stalledMatched === true) {
    return { reason: "stage_failure", loopState: "stalled" };
  }

  // Either no exitPredicates configured, both configured branches said
  // `false`, or one/both opted into `v0_default` explicitly. Fall through.
  return v0DefaultExitDecision(run);
}

/**
 * `undefined`/`v0_default` → `null` (caller falls through to v0 rules).
 * Any other predicate is evaluated normally and returns `true`/`false`.
 */
function matchesConfiguredPredicate(
  predicate: Predicate | undefined,
  ctx: PredicateCtx,
): boolean | null {
  if (!predicate) return null;
  if (isV0Default(predicate)) return null;
  return evaluate(predicate, ctx);
}

function v0DefaultExitDecision(run: RunState): ExitDecision {
  const anyFailed = Object.values(run.stages).some((s) => s.status === "failed");
  return anyFailed
    ? { reason: "stage_failure", loopState: "stalled" }
    : { reason: "completed", loopState: "done" };
}

/**
 * Convergence check (#197 / 8b): returns true when the prior `stallWindow - 1`
 * history summaries on this loop plus the just-completed run all expose the
 * same sorted-unique fingerprint set.
 *
 * `stallWindow` is per-stage. We take the max across stages with the policy
 * set; any stage with `stallWindow >= 2` activates the check. A value of 0
 * or 1 is meaningless (need at least two runs to detect repetition) so we
 * treat those as "disabled".
 */
function isConverged(state: EngineState, run: RunState): boolean {
  let window = 0;
  for (const stage of run.pipelineConfigSnapshot.stages) {
    const w = stage.policy?.stallWindow;
    if (typeof w === "number" && w > window) window = w;
  }
  if (window < 2) return false;

  const key = loopKey(run.sessionId, run.pipelineName);
  const history = state.historySummaries[key] ?? [];
  if (history.length < window - 1) return false;

  const current = [...new Set(run.fingerprints ?? [])].sort().join("|");
  const recent = history.slice(-(window - 1));
  for (const prior of recent) {
    const priorKey = [...new Set(prior.fingerprints)].sort().join("|");
    if (priorKey !== current) return false;
  }
  return true;
}

interface ArtifactStatusChangedEvent {
  now: number;
  runId: RunId;
  stageRunId: StageRunId;
  artifactId: ArtifactId;
  status: ArtifactStatus;
  actor?: string;
}

/**
 * Update a single artifact's status (dismiss / reopen / mark resolved). The
 * reducer mirrors the change into `run.findings` so the predicate evaluator
 * sees the current status without re-reading the store, then emits
 * `UPDATE_ARTIFACT_STATUS` so the engine rewrites the JSONL.
 *
 * `sent_to_agent` is set by the router builtin and the SEND_FOLLOWUP effect,
 * not by user actions. The reducer accepts it here so the engine can stamp
 * it through the same event channel.
 */
function reduceArtifactStatusChanged(
  state: EngineState,
  event: ArtifactStatusChangedEvent,
): ReducerResult {
  const { runId, stageRunId, artifactId, status, actor, now } = event;
  const run = state.runs[runId];
  if (!run) return invalidTransition(state, `ARTIFACT_STATUS_CHANGED for unknown runId=${runId}`);

  const findings = run.findings ?? [];
  const idx = findings.findIndex((a) => a.artifactId === artifactId);
  let updatedRun: RunState;
  if (idx >= 0) {
    const next = findings.slice();
    next[idx] = { ...findings[idx], status };
    updatedRun = { ...run, findings: next, updatedAt: iso(now) };
  } else {
    updatedRun = { ...run, updatedAt: iso(now) };
  }

  const effects: PipelineEffect[] = [
    {
      type: "UPDATE_ARTIFACT_STATUS",
      runId,
      stageRunId,
      artifactId,
      status,
    },
    { type: "PERSIST_RUN", runState: updatedRun },
    {
      type: "EMIT_OBSERVATION",
      event: {
        name: "pipeline.artifact.status_changed",
        data: { runId, stageRunId, artifactId, status, ...(actor ? { actor } : {}) },
      },
    },
  ];

  return { state: replaceRun(state, updatedRun), effects };
}

interface UserFollowupEvent {
  now: number;
  runId: RunId;
  stageRunId: StageRunId;
  stageName: string;
  message: string;
  reviewerId?: string;
}

/**
 * Persist a user follow-up to the thread JSONL and emit a SEND_FOLLOWUP effect
 * for the engine to deliver to the agent. The reply lands later as
 * FOLLOWUP_REPLY (an event, not a synchronous return) so the engine doesn't
 * block the reducer on subprocess I/O.
 *
 * Guard: follow-up is only meaningful while the run is non-terminal and the
 * stage is in a state where the agent can still consume context (running
 * stages or terminal stages whose `loopState` is `awaiting_context`). The
 * reducer accepts both; the dashboard already filters by stage availability.
 */
function reduceUserFollowup(state: EngineState, event: UserFollowupEvent): ReducerResult {
  const { runId, stageRunId, stageName, message, reviewerId, now: _now } = event;
  const run = state.runs[runId];
  if (!run) return invalidTransition(state, `USER_FOLLOWUP for unknown runId=${runId}`);
  if (isTerminalLoopState(run.loopState)) {
    return invalidTransition(
      state,
      `USER_FOLLOWUP requires non-terminal run; got ${run.loopState} for ${runId}`,
    );
  }
  const stage = run.stages[stageName];
  if (!stage) {
    return invalidTransition(state, `USER_FOLLOWUP for unknown stage=${stageName}`);
  }

  const effects: PipelineEffect[] = [
    {
      type: "APPEND_THREAD_MESSAGE",
      runId,
      stageRunId,
      role: "user",
      content: message,
      ...(reviewerId ? { reviewerId } : {}),
    },
    {
      type: "SEND_FOLLOWUP",
      runId,
      stageRunId,
      stageName,
      sessionId: run.sessionId,
      message,
      ...(reviewerId ? { reviewerId } : {}),
    },
    {
      type: "EMIT_OBSERVATION",
      event: {
        name: "pipeline.followup.sent",
        data: {
          runId,
          stageRunId,
          stageName,
          sessionId: run.sessionId,
          ...(reviewerId ? { reviewerId } : {}),
        },
      },
    },
  ];

  return { state, effects };
}

interface FollowupReplyEvent {
  now: number;
  runId: RunId;
  stageRunId: StageRunId;
  stageName: string;
  reply: string;
}

function reduceFollowupReply(state: EngineState, event: FollowupReplyEvent): ReducerResult {
  const { runId, stageRunId, stageName, reply, now: _now } = event;
  const run = state.runs[runId];
  if (!run) return invalidTransition(state, `FOLLOWUP_REPLY for unknown runId=${runId}`);

  const effects: PipelineEffect[] = [
    {
      type: "APPEND_THREAD_MESSAGE",
      runId,
      stageRunId,
      role: "agent",
      content: reply,
    },
    {
      type: "EMIT_OBSERVATION",
      event: {
        name: "pipeline.followup.reply",
        data: { runId, stageRunId, stageName, sessionId: run.sessionId },
      },
    },
  ];

  return { state, effects };
}
