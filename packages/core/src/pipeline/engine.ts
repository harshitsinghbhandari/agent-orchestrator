/**
 * Pipeline engine — minimum wiring to drive the reducer + agent executor
 * end-to-end for v0.2.
 *
 * Responsibilities:
 *  - Hold engine state in memory (mirrors what's persisted by the store).
 *  - Translate `PipelineEffect`s coming out of the reducer into real I/O:
 *    persistence (PERSIST_RUN, PERSIST_LOOP_STATE, APPEND_ARTIFACTS) and
 *    stage execution (START_STAGE, CANCEL_STAGE).
 *  - On `tick()`, poll every running agent stage; when a stage completes,
 *    dispatch STAGE_COMPLETED back through the reducer.
 *
 * Out of scope for v0.2 (lands later in the pipeline cluster):
 *  - DAG / parallel scheduling (v1.1)
 *  - Command + builtin executors (v1.2)
 *  - SHA / merge-ready trigger detection
 *  - SCM webhook ingestion
 *
 * Tick frequency: there is no internal timer. The caller (lifecycle manager
 * piggybacks on its existing 5s SSE poll, per C-14) drives tick() — no new
 * polling loop is introduced.
 *
 * Concurrency: top-level `dispatch` and `tick` calls are serialized through
 * a single promise-chain lock so concurrent callers (e.g. `cancelRun()`
 * landing while a tick is mid-flight) cannot interleave reads/writes of the
 * in-memory `state`. The engine-internal saga (e.g. START_STAGE → STAGE_STARTED
 * → STAGE_FAILED) routes through `dispatchInline`, which bypasses the lock
 * because it's already running inside it.
 */

import { randomUUID } from "node:crypto";

import type { PluginRegistry } from "../types.js";
import type { PipelineEffect, PipelineEvent } from "./events.js";
import { reduce } from "./reducer.js";
import type { PipelineStore } from "./store.js";
import {
  asRunId,
  asStageRunId,
  emptyEngineState,
  isTerminalLoopState,
  loopKey,
  type Artifact,
  type EngineState,
  type Pipeline,
  type RunId,
  type RunState,
  type RunSummary,
  type Stage,
  type StageRunId,
  type StageTriggerEvent,
  type TaskContext,
} from "./types.js";
import { validatePipelineAgentModes, validatePipelineDag } from "./validation.js";
import {
  type AgentStageExecutor,
  type RunningAgentStage,
  type StartStageInput,
} from "./executors/agent.js";
import {
  dispatchBuiltin,
  type BuiltinDispatcherDeps,
} from "./executors/builtin/dispatcher.js";
import {
  type CommandStageExecutor,
  type RunningCommandStage,
  type StartCommandStageInput,
} from "./executors/command.js";

/**
 * Tagged inflight-handle union: stages launched by either the agent or
 * command executor land here. The kind discriminator picks the right
 * `pollStage` / `cancelStage` in `tick()` and CANCEL_STAGE.
 */
type InflightHandle =
  | { kind: "agent"; handle: RunningAgentStage }
  | { kind: "command"; handle: RunningCommandStage };

export interface PipelineEngineDeps {
  store: PipelineStore;
  registry: PluginRegistry;
  agentExecutor: AgentStageExecutor;
  /**
   * Optional command executor. When omitted, command-executor stages fail
   * with STAGE_FAILED — matches the pre-#194 behavior so tests that only
   * exercise agent/builtin stages need not wire it up.
   */
  commandExecutor?: CommandStageExecutor;
  /**
   * Optional dependencies for builtin executors (router/compose). When omitted,
   * any builtin-executor stage fails with STAGE_FAILED — matches the existing
   * "unsupported executor kind" behavior so callers that don't use builtins
   * (most v0.x tests) need not wire this up.
   */
  builtin?: BuiltinDispatcherDeps;
  /** Optional initial state (e.g. restored from disk on startup). Defaults to empty. */
  initialState?: EngineState;
  /** Override clock for tests. */
  now?: () => number;
}

export interface StartRunInput {
  pipeline: Pipeline;
  projectId: string;
  sessionId: string;
  /** Trigger event that caused this run; defaults to "manual". */
  trigger?: StageTriggerEvent;
  /** SHA tracked for `NEW_SHA_DETECTED` reconciliation. Use "manual" if unknown. */
  headSha: string;
  /** Optional issue id forwarded into spawned sessions. */
  issueId?: string;
}

export interface PipelineEngine {
  /** Current engine state (read-only snapshot). */
  state(): EngineState;

  /**
   * Validate the pipeline against the plugin registry, then dispatch a
   * TRIGGER_FIRED event. Throws PipelineConfigError on validation failure.
   * Returns the allocated run id.
   */
  startRun(input: StartRunInput): Promise<RunId>;

  /**
   * Drive forward any in-flight agent stages. Serialized against `dispatch`
   * and `cancelRun` so concurrent callers cannot race state mutations.
   */
  tick(): Promise<void>;

  /**
   * Dispatch a single event through the reducer and execute its effects.
   * Exposed for tests and for callers that want to inject events directly
   * (e.g. CONFIG_CHANGED from a config watcher). Serialized.
   */
  dispatch(event: PipelineEvent): Promise<void>;

  /** Cancel an in-flight run via RUN_CANCELLED. Idempotent. */
  cancelRun(runId: RunId, reason?: "manual_cancel" | "config_change"): Promise<void>;

  /**
   * Reconcile after a process restart: every persisted stage left in `running`
   * status has no inflight handle in this process, so dispatch STAGE_FAILED for
   * each so the run can either advance or terminate as `stalled`. Safe to call
   * multiple times — re-dispatches are no-ops once the stage is terminal.
   */
  reconcileInflightStages(): Promise<void>;

  /**
   * Clean shutdown: cancel every non-terminal run via RUN_CANCELLED (which
   * routes CANCEL_STAGE effects through the agent executor) so in-flight
   * stages are torn down and final state is persisted. After shutdown, the
   * engine should not be ticked or dispatched into.
   */
  shutdown(): Promise<void>;
}

/**
 * Rebuild engine state from the flat-file store. Used so a freshly constructed
 * engine sees existing runs / loop pointers / history rather than starting from
 * `emptyEngineState()` (which would defeat the reducer's collision guards).
 *
 * Terminal runs go into `historySummaries`; the latest non-terminal run on each
 * loop key wins `currentRunByLoop`. The returned state is structurally equal to
 * what the reducer would have produced via replay, modulo finding fingerprints
 * — those are recomputed on demand by stalled-detection in v0.x.
 */
export function hydrateEngineState(store: PipelineStore): EngineState {
  const runs: Record<string, RunState> = {};
  const currentRunByLoop: Record<string, RunId> = {};
  const historySummaries: Record<string, RunSummary[]> = {};

  const sorted = [...store.listRuns()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const run of sorted) {
    runs[run.runId] = run;
    const key = loopKey(run.sessionId, run.pipelineName);

    if (isTerminalLoopState(run.loopState)) {
      const list = historySummaries[key] ?? [];
      list.push({
        runId: run.runId,
        loopState: run.loopState,
        ...(run.terminationReason ? { terminationReason: run.terminationReason } : {}),
        headSha: run.headSha,
        loopRounds: run.loopRounds,
        fingerprints: [],
        createdAt: run.createdAt,
      });
      historySummaries[key] = list;
    } else {
      currentRunByLoop[key] = run.runId;
    }
  }

  return { runs, currentRunByLoop, historySummaries };
}

export function createPipelineEngine(deps: PipelineEngineDeps): PipelineEngine {
  const { store, registry, agentExecutor, commandExecutor, builtin, now = Date.now } = deps;

  let state: EngineState = deps.initialState ?? emptyEngineState();
  /**
   * stageRunId → executor handle for stages we own. Holds both agent and
   * command handles since `tick()` polls them identically (each handle
   * carries enough kind-discrimination via its `__kind` tag).
   */
  const inflight = new Map<StageRunId, InflightHandle>();
  /**
   * Side-table for projectId/issueId, keyed by RunId. The persisted RunState
   * shape was locked by v0.1 and doesn't carry these, so the engine threads
   * them out-of-band into START_STAGE inputs. Pruned by
   * `pruneTerminatedRunMetadata` after every dispatch.
   */
  const runMetadata = new Map<RunId, { projectId: string; issueId?: string }>();

  /**
   * Serialization lock for top-level dispatches. Each public dispatch chains
   * onto `lockTail`; engine-internal recursive dispatches use `dispatchInline`
   * directly because they're already running inside this lock.
   */
  let lockTail: Promise<void> = Promise.resolve();

  function withLock<T>(work: () => Promise<T>): Promise<T> {
    const result = lockTail.then(work);
    // Swallow errors on the chain so one failure doesn't poison subsequent
    // waiters; the original promise (`result`) still rejects to its caller.
    lockTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function dispatch(event: PipelineEvent): Promise<void> {
    // Defense-in-depth: any TRIGGER_FIRED that enters the engine — whether
    // via `startRun`, a test, or a future config-watcher injection — gets
    // the same validation `startRun` applies. Validates synchronously
    // before taking the lock so the error surfaces before any state moves.
    if (event.type === "TRIGGER_FIRED") {
      validatePipelineAgentModes(event.pipeline, registry);
      validatePipelineDag(event.pipeline);
    }
    return withLock(() => dispatchInline(event));
  }

  async function dispatchInline(event: PipelineEvent): Promise<void> {
    const result = reduce(state, event);
    state = result.state;
    for (const effect of result.effects) {
      await executeEffect(effect);
    }
    pruneTerminatedRunMetadata();
  }

  /**
   * Drop side-table entries for runs the reducer has already moved into a
   * terminal loop state. Without this, `runMetadata` grows for the lifetime of
   * the engine — one entry per pipeline run ever started — even though the
   * data is only consumed by START_STAGE on a non-terminal run.
   */
  function pruneTerminatedRunMetadata(): void {
    for (const runId of runMetadata.keys()) {
      const run = state.runs[runId];
      if (!run || isTerminalLoopState(run.loopState)) {
        runMetadata.delete(runId);
      }
    }
  }

  async function executeEffect(effect: PipelineEffect): Promise<void> {
    switch (effect.type) {
      case "PERSIST_RUN":
        store.saveRun(effect.runState);
        for (const [stageName, stageState] of Object.entries(effect.runState.stages)) {
          store.saveStage({ ...stageState, runId: effect.runState.runId, stageName });
        }
        break;

      case "PERSIST_LOOP_STATE":
        store.saveLoopState(effect.runId, effect.loopState);
        break;

      case "APPEND_ARTIFACTS":
        store.appendArtifacts(effect.runId, effect.stageRunId, effect.artifacts);
        break;

      case "START_STAGE": {
        const run = state.runs[effect.runId];
        if (!run) break;
        const kind = effect.stage.executor.kind;

        if (kind === "builtin") {
          await runBuiltinStage(run, effect.stage, effect.stageRunId);
          break;
        }

        if (kind === "command") {
          await startCommandStage(run, effect.stage, effect.stageRunId);
          break;
        }

        if (kind !== "agent") {
          // Exhaustiveness guard — a new StageExecutor kind would land here.
          await dispatchInline({
            type: "STAGE_FAILED",
            now: now(),
            runId: effect.runId,
            stageName: effect.stage.name,
            errorMessage: `Executor kind "${kind}" is not supported by the engine.`,
          });
          break;
        }

        // Mark the stage as running BEFORE starting the executor — failures
        // during spawn translate to STAGE_FAILED, which requires running|pending.
        await dispatchInline({
          type: "STAGE_STARTED",
          now: now(),
          runId: effect.runId,
          stageName: effect.stage.name,
        });

        const meta = runMetadata.get(run.runId);
        const startInput: StartStageInput = {
          pipelineName: run.pipelineName,
          projectId: meta?.projectId ?? "",
          runId: effect.runId,
          stageRunId: effect.stageRunId,
          stage: effect.stage,
          loopRound: run.loopRounds,
          ...(meta?.issueId ? { issueId: meta.issueId } : {}),
        };

        try {
          const handle = await agentExecutor.startStage(startInput);
          inflight.set(effect.stageRunId, { kind: "agent", handle });
        } catch (err) {
          await dispatchInline({
            type: "STAGE_FAILED",
            now: now(),
            runId: effect.runId,
            stageName: effect.stage.name,
            errorMessage:
              err instanceof Error ? err.message : `agent executor failed: ${String(err)}`,
          });
        }
        break;
      }

      case "CANCEL_STAGE": {
        const entry = inflight.get(effect.stageRunId);
        if (entry) {
          inflight.delete(effect.stageRunId);
          try {
            if (entry.kind === "agent") {
              await agentExecutor.cancelStage(entry.handle);
            } else if (commandExecutor) {
              await commandExecutor.cancelStage(entry.handle);
            }
          } catch {
            // Best-effort — handle may already be gone.
          }
        }
        break;
      }

      case "EMIT_OBSERVATION":
        // Engine doesn't own observation routing. v0.2 leaves this as a no-op;
        // a later sub-task (#1629/#1630) wires it into the activity-event log.
        break;
    }
  }

  /**
   * Execute a builtin (router / compose) stage end-to-end inside the engine:
   * mark STARTED, build the TaskContext from upstream artifacts, dispatch
   * through the builtin dispatcher, and synthesize STAGE_COMPLETED /
   * STAGE_FAILED based on the outcome.
   *
   * Builtins do not produce inflight handles — they complete synchronously
   * from `tick()`'s perspective. The dispatcher upcasts the TaskContext to a
   * BuiltinTaskContext; this engine code never constructs one directly so
   * `sendToSession` stays gated behind the dispatcher.
   */
  async function runBuiltinStage(
    run: RunState,
    stage: Stage,
    stageRunId: StageRunId,
  ): Promise<void> {
    if (stage.executor.kind !== "builtin") return; // type narrowing for downstream code
    const executor = stage.executor;

    if (!builtin) {
      await dispatchInline({
        type: "STAGE_FAILED",
        now: now(),
        runId: run.runId,
        stageName: stage.name,
        errorMessage: `Builtin executor "${executor.name}" requires PipelineEngineDeps.builtin to be configured.`,
      });
      return;
    }

    await dispatchInline({
      type: "STAGE_STARTED",
      now: now(),
      runId: run.runId,
      stageName: stage.name,
    });

    // Gather upstream artifacts from the store, keyed by upstream stage
    // name. `dependsOn` is the contract for what's visible to builtins —
    // routes-only refs are deliberately excluded (those are scheduling
    // predicates, not data bindings).
    const inputs: Record<string, Artifact[]> = {};
    for (const upstreamName of stage.dependsOn ?? []) {
      const upstream = run.stages[upstreamName];
      if (!upstream) continue;
      inputs[upstreamName] = store.listArtifacts(run.runId, upstream.stageRunId);
    }

    const ctx: TaskContext = {
      pipelineName: run.pipelineName,
      runId: run.runId,
      stageRunId,
      stage,
      linkedSessionId: run.sessionId,
      inputs,
    };

    let outcome;
    try {
      outcome = await dispatchBuiltin(ctx, executor, builtin);
    } catch (err) {
      await dispatchInline({
        type: "STAGE_FAILED",
        now: now(),
        runId: run.runId,
        stageName: stage.name,
        errorMessage:
          err instanceof Error
            ? err.message
            : `Builtin executor "${executor.name}" failed: ${String(err)}`,
      });
      return;
    }

    await dispatchInline({
      type: "STAGE_COMPLETED",
      now: now(),
      runId: run.runId,
      stageName: stage.name,
      verdict: outcome.verdict,
      artifacts: outcome.artifacts,
    });

    // Forward dispatcher observations through the same effect channel the
    // reducer uses for its own stage-lifecycle observations. The reducer
    // doesn't surface these itself — they're builtin-specific operational
    // signals (e.g. router skipped delivery because the worker is dead).
    for (const obs of outcome.observations) {
      await executeEffect({ type: "EMIT_OBSERVATION", event: obs });
    }
  }

  /**
   * Start a command-executor stage. Mirrors the agent-stage flow: mark
   * STAGE_STARTED before spawning so spawn failures can land as STAGE_FAILED,
   * then register the handle for later polling. Fork-PR gating is enforced
   * INSIDE the command executor (`startStage`), so a short-circuit lands
   * as a finalized `finalOutcome` on the returned handle and is picked up
   * on the next tick (or immediately if the engine's caller ticks after
   * every dispatch).
   */
  async function startCommandStage(
    run: RunState,
    stage: Stage,
    stageRunId: StageRunId,
  ): Promise<void> {
    if (stage.executor.kind !== "command") return; // type narrowing

    if (!commandExecutor) {
      await dispatchInline({
        type: "STAGE_FAILED",
        now: now(),
        runId: run.runId,
        stageName: stage.name,
        errorMessage: `Command stage "${stage.name}" requires PipelineEngineDeps.commandExecutor to be configured.`,
      });
      return;
    }

    await dispatchInline({
      type: "STAGE_STARTED",
      now: now(),
      runId: run.runId,
      stageName: stage.name,
    });

    const allowForkPRs = run.pipelineConfigSnapshot.allowForkPRs === true;
    const startInput: StartCommandStageInput = {
      pipelineName: run.pipelineName,
      runId: run.runId,
      stageRunId,
      stage,
      sessionId: run.sessionId,
      allowForkPRs,
    };

    try {
      const handle = await commandExecutor.startStage(startInput);
      inflight.set(stageRunId, { kind: "command", handle });
    } catch (err) {
      await dispatchInline({
        type: "STAGE_FAILED",
        now: now(),
        runId: run.runId,
        stageName: stage.name,
        errorMessage:
          err instanceof Error ? err.message : `command executor failed: ${String(err)}`,
      });
    }
  }

  async function tick(): Promise<void> {
    return withLock(async () => {
      if (inflight.size === 0) return;
      const entries = [...inflight.values()];
      for (const entry of entries) {
        if (entry.kind === "agent") {
          const handle = entry.handle;
          const outcome = await agentExecutor.pollStage(handle);
          if (outcome.status === "running") continue;

          inflight.delete(handle.stageRunId);

          if (outcome.status === "completed") {
            await dispatchInline({
              type: "STAGE_COMPLETED",
              now: now(),
              runId: handle.runId,
              stageName: handle.stageName,
              artifacts: outcome.artifacts,
            });
          } else {
            await dispatchInline({
              type: "STAGE_FAILED",
              now: now(),
              runId: handle.runId,
              stageName: handle.stageName,
              errorMessage: outcome.errorMessage,
            });
          }
        } else {
          // Command-stage poll. commandExecutor is non-null here because the
          // entry was only inserted by `startCommandStage` after verifying it.
          if (!commandExecutor) continue;
          const handle = entry.handle;
          const outcome = await commandExecutor.pollStage(handle);
          if (outcome.status === "running") continue;

          inflight.delete(handle.stageRunId);

          if (outcome.status === "completed") {
            await dispatchInline({
              type: "STAGE_COMPLETED",
              now: now(),
              runId: handle.runId,
              stageName: handle.stageName,
              verdict: outcome.verdict,
              artifacts: outcome.artifacts,
            });
            if (outcome.observation) {
              await executeEffect({ type: "EMIT_OBSERVATION", event: outcome.observation });
            }
          } else {
            await dispatchInline({
              type: "STAGE_FAILED",
              now: now(),
              runId: handle.runId,
              stageName: handle.stageName,
              errorMessage: outcome.errorMessage,
            });
          }
        }
      }
    });
  }

  async function startRun(input: StartRunInput): Promise<RunId> {
    // Validate exactly once. Calling `dispatch` here would re-validate
    // inside the lock, opening a window where the registry could mutate
    // between the two synchronous checks — if the second throws, the
    // `runMetadata.set` below would have already populated an orphan entry
    // with no matching run. Instead we validate up front and skip
    // `dispatch`'s validation by going through `withLock(dispatchInline)`
    // directly.
    validatePipelineAgentModes(input.pipeline, registry);
    validatePipelineDag(input.pipeline);

    const runId = asRunId(`run-${randomUUID()}`);
    const stageRunIds: Record<string, StageRunId> = {};
    for (const stage of input.pipeline.stages) {
      stageRunIds[stage.name] = asStageRunId(`sr-${randomUUID()}`);
    }

    // Stash projectId/issueId BEFORE dispatch so the START_STAGE effect — which
    // fires synchronously inside the same dispatch — can read them. The
    // persisted RunState shape was locked by v0.1, so we carry these out-of-band.
    runMetadata.set(runId, {
      projectId: input.projectId,
      issueId: input.issueId,
    });

    await withLock(() =>
      dispatchInline({
        type: "TRIGGER_FIRED",
        now: now(),
        trigger: input.trigger ?? "manual",
        sessionId: input.sessionId,
        pipeline: input.pipeline,
        headSha: input.headSha,
        runId,
        stageRunIds,
      }),
    );

    return runId;
  }

  async function cancelRun(
    runId: RunId,
    reason: "manual_cancel" | "config_change" = "manual_cancel",
  ): Promise<void> {
    if (!state.runs[runId]) return;
    await dispatch({ type: "RUN_CANCELLED", now: now(), runId, reason });
  }

  async function reconcileInflightStages(): Promise<void> {
    // Snapshot the candidates outside the lock — dispatch reacquires it.
    const candidates: Array<{ runId: RunId; stageName: string }> = [];
    for (const run of Object.values(state.runs)) {
      if (isTerminalLoopState(run.loopState)) continue;
      for (const [stageName, stage] of Object.entries(run.stages)) {
        if (stage.status === "running") {
          candidates.push({ runId: run.runId, stageName });
        }
      }
    }
    for (const { runId, stageName } of candidates) {
      await dispatch({
        type: "STAGE_FAILED",
        now: now(),
        runId,
        stageName,
        errorMessage:
          "Pipeline engine restarted while stage was running; in-flight executor handle is lost.",
      });
    }
  }

  async function shutdown(): Promise<void> {
    const nonTerminalRunIds: RunId[] = [];
    for (const run of Object.values(state.runs)) {
      if (!isTerminalLoopState(run.loopState)) {
        nonTerminalRunIds.push(run.runId);
      }
    }
    for (const runId of nonTerminalRunIds) {
      // cancelRun is a no-op on already-terminal runs and idempotent per the
      // reducer's RUN_CANCELLED guard, so we never double-cancel.
      await cancelRun(runId, "manual_cancel");
    }
  }

  return {
    state: () => state,
    startRun,
    tick,
    dispatch,
    cancelRun,
    reconcileInflightStages,
    shutdown,
  };
}
