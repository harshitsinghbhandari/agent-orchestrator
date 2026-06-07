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

import type { PluginRegistry, Session } from "../types.js";
import type { PipelineEffect, PipelineEvent } from "./events.js";
import { reduce } from "./reducer.js";
import type { PipelineStore } from "./store.js";
import {
  asRunId,
  asStageRunId,
  DEFAULT_PIPELINE_SCOPE,
  emptyEngineState,
  isTerminalLoopState,
  loopKey,
  type Artifact,
  type EngineState,
  type Pipeline,
  type PipelineScope,
  type PrContext,
  type RunId,
  type RunState,
  type RunSummary,
  type Stage,
  type StageRunId,
  type StageTriggerEvent,
  type TaskContext,
  type WorkstreamPredicateCtx,
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

/**
 * Routed-observation context the engine threads into `onObservation`. Pulled
 * from the run identified by `event.data.runId` when present so the consumer
 * (activity-event log, dashboard) can scope the observation to the right
 * session without re-deriving it.
 */
export interface ObservationContext {
  runId?: string;
  sessionId?: string;
  projectId?: string;
  pipelineName?: string;
}

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
  /**
   * Optional follow-up delivery. When the reducer emits SEND_FOLLOWUP, the
   * engine calls this so the appropriate agent plugin can drop the message
   * into the existing task (Codex: `codex exec --continue`). When omitted,
   * the effect is a no-op and the dashboard surfaces "chat unavailable".
   */
  followUp?: FollowUpDeliveryDeps;
  /** Optional initial state (e.g. restored from disk on startup). Defaults to empty. */
  initialState?: EngineState;
  /** Override clock for tests. */
  now?: () => number;
  /**
   * Routed every EMIT_OBSERVATION effect (#197 / 8c). Production callers
   * wire this to `recordActivityEvent` so pipeline observations surface in
   * `ao session show` and the dashboard. Tests can omit it for a no-op.
   *
   * Best-effort: thrown errors are swallowed so observation routing can
   * never crash the engine tick.
   */
  onObservation?: (
    event: { name: string; data: Record<string, unknown> },
    context: ObservationContext,
  ) => void;
  /**
   * Look up a worker session by id when building `PrContext` for agent
   * stages. Wired to `sessionManager.get` in production; absent in tests
   * that don't exercise PR-triggered runs.
   *
   * When omitted, agent stages still run — they just don't get a
   * `prContext` block in the prompt or a `checkoutSha` pin on the worktree,
   * which is the correct fallback for manual / orchestrator-triggered runs.
   */
  getSession?: (sessionId: string) => Promise<Session | null>;
}

/**
 * Deliver a follow-up message to an existing worker session. The engine asks
 * the session manager for the session, then forwards to the matching agent
 * plugin's `sendFollowUpToTask`. Implementations live in `cli/lib` (CLI) and
 * `web/lib` (web) so the engine itself stays free of plugin-registry I/O.
 */
export interface FollowUpDeliveryDeps {
  /**
   * Deliver the message. Implementation MUST:
   *   - resolve the session by id;
   *   - confirm the worker workspace still exists (worker-alive pre-send);
   *   - call the agent plugin's `sendFollowUpToTask`;
   *   - throw on missing workspace so the engine can surface
   *     `pipeline.followup.workspace_gone` and the dashboard returns 410.
   */
  deliver(input: {
    sessionId: string;
    runId: RunId;
    stageRunId: StageRunId;
    stageName: string;
    pipelineName: string;
    message: string;
    reviewerId?: string;
  }): Promise<{ reply?: string }>;
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
  /**
   * Pipeline-v3 workstream snapshot (issue #199). Required for workstream-
   * scoped pipelines so the reducer, predicate evaluator, and router can
   * resolve workstream identity and member state from the RunState.
   */
  workstream?: WorkstreamPredicateCtx;
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
      // Fingerprints are persisted on RunState since #197 (8b). Older
      // RunStates without the field round-trip as an empty set — convergence
      // detection will just see them as "different from the current run" and
      // stay quiet, which is the right safety default.
      const fingerprints = [...new Set(run.fingerprints ?? [])].sort();
      list.push({
        runId: run.runId,
        loopState: run.loopState,
        ...(run.terminationReason ? { terminationReason: run.terminationReason } : {}),
        headSha: run.headSha,
        loopRounds: run.loopRounds,
        fingerprints,
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
  const { store, registry, agentExecutor, commandExecutor, builtin, followUp, now = Date.now } =
    deps;
  const onObservation = deps.onObservation;
  const getSession = deps.getSession;

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

      case "UPDATE_ARTIFACT_STATUS":
        store.updateArtifactStatus(
          effect.runId,
          effect.stageRunId,
          effect.artifactId,
          effect.status,
        );
        break;

      case "APPEND_THREAD_MESSAGE":
        store.appendThreadMessage(effect.runId, effect.stageRunId, {
          role: effect.role,
          content: effect.content,
          ts: new Date(now()).toISOString(),
          ...(effect.reviewerId ? { reviewerId: effect.reviewerId } : {}),
        });
        break;

      case "SEND_FOLLOWUP":
        await deliverFollowUp(effect);
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
        const prContext = await buildPrContext(run);
        const startInput: StartStageInput = {
          pipelineName: run.pipelineName,
          projectId: meta?.projectId ?? "",
          runId: effect.runId,
          stageRunId: effect.stageRunId,
          stage: effect.stage,
          loopRound: run.loopRounds,
          ...(meta?.issueId ? { issueId: meta.issueId } : {}),
          ...(prContext ? { prContext } : {}),
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
        if (onObservation) {
          // Enrich with session/project context from the run identified in
          // the observation payload (when present) so consumers don't have
          // to re-derive it. Pure lookup — no state mutation.
          const dataRunId = typeof effect.event.data["runId"] === "string"
            ? (effect.event.data["runId"] as string)
            : undefined;
          const ctx: ObservationContext = {};
          if (dataRunId) {
            ctx.runId = dataRunId;
            const run = state.runs[dataRunId as RunId];
            if (run) {
              ctx.sessionId = run.sessionId;
              ctx.pipelineName = run.pipelineName;
            }
            const meta = runMetadata.get(dataRunId as RunId);
            if (meta) ctx.projectId = meta.projectId;
          }
          try {
            onObservation(effect.event, ctx);
          } catch {
            // Best-effort — never let a routing failure break the engine.
          }
        }
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
  /**
   * Build a PrContext for the agent executor from `run.headSha` and the
   * worker session's PRInfo (#215). Returns `undefined` when:
   *   - `getSession` wasn't wired (test / non-PR engine),
   *   - the worker session is gone (e.g. cancelled between dispatch + tick),
   *   - `run.headSha` is the sentinel "manual" used by orchestrator-triggered
   *     and manual runs that aren't pinned to a real commit,
   *
   * which is the right fallback: those runs have no SHA to pin to and no PR
   * to describe, so the executor falls back to the pre-#215 behavior (worktree
   * on `session/<id>`, no PR Context block in the prompt).
   *
   * Best-effort: failures are swallowed so prContext stays absent rather than
   * crashing the stage.
   */
  async function buildPrContext(run: RunState): Promise<PrContext | undefined> {
    if (!getSession) return undefined;
    if (!run.headSha || run.headSha === "manual") return undefined;

    let session: Session | null;
    try {
      session = await getSession(run.sessionId);
    } catch {
      return undefined;
    }
    if (!session) return undefined;

    const pr = session.pr;
    const ctx: PrContext = { headSha: run.headSha };
    if (pr) {
      ctx.prNumber = pr.number;
      ctx.url = pr.url;
      ctx.headBranch = pr.branch;
      ctx.baseBranch = pr.baseBranch;
      // `isFromFork` is `boolean | null` on PRInfo; thread through verbatim
      // so the prompt can reflect "fork status unknown" when the SCM plugin
      // can't tell.
      ctx.isFromFork = pr.isFromFork;
    }
    return ctx;
  }

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

    const scope: PipelineScope = run.pipelineConfigSnapshot.scope ?? DEFAULT_PIPELINE_SCOPE;
    // Workstream scope: SEND_TO_AGENT targets the workstream's orchestrator,
    // never the synthetic workstream session id. Orchestrator scope already
    // has `linkedSessionId === orchestratorSessionId`. Worker scope leaves
    // the field unset so the router uses `linkedSessionId`. (#199)
    const routingTargetSessionId =
      scope === "workstream" ? run.workstream?.orchestratorSessionId : undefined;
    const ctx: TaskContext = {
      pipelineName: run.pipelineName,
      runId: run.runId,
      stageRunId,
      stage,
      linkedSessionId: run.sessionId,
      scope,
      ...(routingTargetSessionId ? { routingTargetSessionId } : {}),
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

  async function deliverFollowUp(effect: {
    runId: RunId;
    stageRunId: StageRunId;
    stageName: string;
    sessionId: string;
    message: string;
    reviewerId?: string;
  }): Promise<void> {
    if (!followUp) {
      await executeEffect({
        type: "EMIT_OBSERVATION",
        event: {
          name: "pipeline.followup.unavailable",
          data: {
            runId: effect.runId,
            stageRunId: effect.stageRunId,
            stageName: effect.stageName,
            sessionId: effect.sessionId,
          },
        },
      });
      return;
    }

    const run = state.runs[effect.runId];
    const pipelineName = run?.pipelineName ?? "";
    try {
      const result = await followUp.deliver({
        sessionId: effect.sessionId,
        runId: effect.runId,
        stageRunId: effect.stageRunId,
        stageName: effect.stageName,
        pipelineName,
        message: effect.message,
        ...(effect.reviewerId ? { reviewerId: effect.reviewerId } : {}),
      });
      if (result.reply !== undefined && result.reply.length > 0) {
        await dispatchInline({
          type: "FOLLOWUP_REPLY",
          now: now(),
          runId: effect.runId,
          stageRunId: effect.stageRunId,
          stageName: effect.stageName,
          reply: result.reply,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await executeEffect({
        type: "EMIT_OBSERVATION",
        event: {
          name: "pipeline.followup.delivery_failed",
          data: {
            runId: effect.runId,
            stageRunId: effect.stageRunId,
            stageName: effect.stageName,
            sessionId: effect.sessionId,
            error: message,
          },
        },
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
            for (const obs of outcome.observations ?? []) {
              await executeEffect({ type: "EMIT_OBSERVATION", event: obs });
            }
          } else {
            await dispatchInline({
              type: "STAGE_FAILED",
              now: now(),
              runId: handle.runId,
              stageName: handle.stageName,
              errorMessage: outcome.errorMessage,
            });
            for (const obs of outcome.observations ?? []) {
              await executeEffect({ type: "EMIT_OBSERVATION", event: obs });
            }
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
            for (const extra of outcome.extraObservations ?? []) {
              await executeEffect({ type: "EMIT_OBSERVATION", event: extra });
            }
          } else {
            await dispatchInline({
              type: "STAGE_FAILED",
              now: now(),
              runId: handle.runId,
              stageName: handle.stageName,
              errorMessage: outcome.errorMessage,
            });
            for (const extra of outcome.extraObservations ?? []) {
              await executeEffect({ type: "EMIT_OBSERVATION", event: extra });
            }
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
        ...(input.workstream ? { workstream: input.workstream } : {}),
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
