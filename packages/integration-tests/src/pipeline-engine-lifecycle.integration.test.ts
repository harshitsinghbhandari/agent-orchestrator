/**
 * Integration test for the v0.2 acceptance criterion of issue #191:
 *
 *   "start orchestrator, hand-fire TRIGGER_FIRED, observe a single-stage agent
 *    pipeline run reach `done`."
 *
 * This test wires up the same primitives `ao start` does (createPipelineStore,
 * createPipelineEngine, createLifecycleManager with `pipelineEngine` attached),
 * runs the lifecycle poll loop on a tight interval, hand-fires a TRIGGER_FIRED
 * event into the engine, and asserts the run reaches a terminal `done` loop
 * state through the live polling path — not through any direct reducer
 * invocation. The agent executor is a stub (no real session is spawned) so the
 * test stays in-process and fast.
 *
 * What this exercises end-to-end:
 *  - LifecycleManager.pollAll() invokes engine.tick() each cycle.
 *  - engine.tick() polls the inflight stage and dispatches STAGE_COMPLETED.
 *  - The reducer transitions a 1-stage pipeline to loopState=done.
 *  - engine.shutdown() persists state cleanly on stop.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  asPipelineId,
  asRunId,
  asStageRunId,
  createLifecycleManager,
  createPipelineEngine,
  createPipelineStore,
  hydrateEngineState,
  type AgentStageExecutor,
  type ArtifactInput,
  type LifecycleManager,
  type OpenCodeSessionManager,
  type OrchestratorConfig,
  type Pipeline,
  type PipelineEngine,
  type PluginManifest,
  type PluginRegistry,
  type RunningAgentStage,
  type RunState,
  type StageOutcome,
  type StartStageInput,
} from "@aoagents/ao-core";

const PIPELINE_NAME = "ci";
const SESSION_ID = "test-session";

/** Minimal config — only the keys lifecycle-manager actually reads on a no-session poll. */
function buildConfig(configPath: string): OrchestratorConfig {
  return {
    configPath,
    readyThresholdMs: 300_000,
    defaults: {
      runtime: "process",
      agent: "stub-agent",
      workspace: "worktree",
      notifiers: [],
    },
    projects: {},
    notifiers: {},
    notificationRouting: {
      urgent: [],
      action: [],
      warning: [],
      info: [],
    },
    reactions: {},
  };
}

function buildRegistry(agentManifest: PluginManifest): PluginRegistry {
  return {
    register: () => {},
    get: () => null,
    list: (slot) => (slot === "agent" ? [agentManifest] : []),
    loadBuiltins: async () => {},
    loadFromConfig: async () => {},
  } as PluginRegistry;
}

/**
 * `lifecycle-manager` calls `sessionManager.list(projectId)` on every poll.
 * Returning [] short-circuits all session enrichment so the loop simply runs
 * its tail — including `engine.tick()`.
 */
function buildSessionManager(): OpenCodeSessionManager {
  return {
    list: async () => [],
    get: async () => null,
    spawn: async () => {
      throw new Error("stub spawn — should not be called in this test");
    },
    spawnOrchestrator: async () => {
      throw new Error("stub spawnOrchestrator — should not be called");
    },
    ensureOrchestrator: async () => {
      throw new Error("stub ensureOrchestrator — should not be called");
    },
    restore: async () => {
      throw new Error("stub restore — should not be called");
    },
    kill: async () => ({ cleaned: false, alreadyTerminated: true }),
    cleanup: async () => ({ killed: [], skipped: [], errors: [] }),
    send: async () => {},
    claimPR: async () => {
      throw new Error("stub claimPR — should not be called");
    },
    remap: async () => "",
    listCached: async () => [],
    invalidateCache: () => {},
  } as OpenCodeSessionManager;
}

interface StubExecutor extends AgentStageExecutor {
  setNextOutcome(outcome: StageOutcome): void;
  inflightCount(): number;
}

/**
 * Stub agent executor — captures `startStage` inputs, returns the configured
 * `nextOutcome` from `pollStage`, and counts inflight handles. No real session
 * is spawned.
 */
function buildStubExecutor(): StubExecutor {
  let nextOutcome: StageOutcome = { status: "running" };
  const inflight = new Set<string>();

  return {
    setNextOutcome: (o) => {
      nextOutcome = o;
    },
    inflightCount: () => inflight.size,
    async startStage(input: StartStageInput): Promise<RunningAgentStage> {
      inflight.add(input.stageRunId);
      return {
        runId: input.runId,
        stageRunId: input.stageRunId,
        stageName: input.stage.name,
        sessionId: `mock-${input.stageRunId}`,
        workspacePath: "/tmp/mock-workspace",
        startedAt: Date.now(),
        input,
      };
    },
    async pollStage(handle: RunningAgentStage): Promise<StageOutcome> {
      if (nextOutcome.status !== "running") {
        inflight.delete(handle.stageRunId);
      }
      return nextOutcome;
    },
    async cancelStage(handle: RunningAgentStage): Promise<void> {
      inflight.delete(handle.stageRunId);
    },
  };
}

function buildAgentManifest(): PluginManifest {
  return {
    name: "stub-agent",
    slot: "agent",
    description: "integration-test stub agent",
    version: "0.0.0",
    supportedTaskModes: ["review"],
  };
}

/** Pipeline with a single agent stage in `review` mode. */
function buildPipeline(): Pipeline {
  return {
    id: asPipelineId("pl-ci"),
    name: PIPELINE_NAME,
    maxConcurrentStages: 1,
    stages: [
      {
        name: "lint",
        trigger: { on: ["pr.opened"] },
        executor: { kind: "agent", plugin: "stub-agent", mode: "review" },
        task: { prompt: "lint" },
      },
    ],
  };
}

async function waitForRunDone(
  engine: PipelineEngine,
  pipelineName: string,
  sessionId: string,
  timeoutMs: number,
): Promise<RunState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = engine.state();
    for (const run of Object.values(state.runs)) {
      if (
        run.pipelineName === pipelineName &&
        run.sessionId === sessionId &&
        run.loopState === "done"
      ) {
        return run;
      }
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for run.loopState=done; ` +
      `current=${JSON.stringify(
        Object.values(engine.state().runs).map((r) => ({
          id: r.runId,
          loop: r.loopState,
          stages: Object.fromEntries(
            Object.entries(r.stages).map(([n, s]) => [n, s.status]),
          ),
        })),
      )}`,
  );
}

describe("pipeline engine wired into lifecycle manager (live poll path)", () => {
  let tmpRoot: string;
  let lifecycle: LifecycleManager | null = null;
  let engine: PipelineEngine | null = null;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "ao-pipe-lifecycle-"));
  });

  afterEach(async () => {
    if (lifecycle) {
      lifecycle.stop();
      lifecycle = null;
    }
    if (engine) {
      await engine.shutdown().catch(() => {});
      engine = null;
    }
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("TRIGGER_FIRED → live engine.tick() through lifecycle poll → run reaches done", async () => {
    const config = buildConfig(join(tmpRoot, "agent-orchestrator.yaml"));
    const registry = buildRegistry(buildAgentManifest());
    const sessionManager = buildSessionManager();
    const executor = buildStubExecutor();
    const store = createPipelineStore(join(tmpRoot, "pipelines"));

    engine = createPipelineEngine({
      store,
      registry,
      agentExecutor: executor,
      initialState: hydrateEngineState(store),
    });
    await engine.reconcileInflightStages();

    lifecycle = createLifecycleManager({
      config,
      registry,
      sessionManager,
      projectId: "test-project",
      pipelineEngine: engine,
    });

    // Tick every 50ms so the test completes quickly. The lifecycle manager
    // drives engine.tick() from inside pollAll(); the engine itself doesn't
    // install a timer (per C-14).
    lifecycle.start(50);

    // Hand-fire TRIGGER_FIRED — the user-facing "test seam" called out in #191.
    // We don't go through `engine.startRun` because that helper also threads
    // projectId/issueId; this lower-level path proves the reducer + tick loop
    // alone is enough to drive a run to completion.
    const pipeline = buildPipeline();
    const runId = asRunId("run-integration-1");
    const stageRunIds = { lint: asStageRunId("sr-integration-1") };
    await engine.dispatch({
      type: "TRIGGER_FIRED",
      now: Date.now(),
      trigger: "pr.opened",
      sessionId: SESSION_ID,
      pipeline,
      headSha: "abc123",
      runId,
      stageRunIds,
    });

    // After dispatch, the engine has marked the stage running and started it
    // through the stub executor. Confirm one handle is in flight before we
    // ask the executor to report completion.
    expect(executor.inflightCount()).toBe(1);

    // Flip the stub to "completed". The next `engine.tick()` (driven by the
    // 50ms lifecycle poll) will see this outcome and dispatch STAGE_COMPLETED,
    // which the reducer will fold into a `done` loop state for the run.
    const artifacts: ArtifactInput[] = [{ kind: "json", data: { ok: true } }];
    executor.setNextOutcome({ status: "completed", artifacts });

    const finalRun = await waitForRunDone(engine, PIPELINE_NAME, SESSION_ID, 5_000);
    expect(finalRun.loopState).toBe("done");
    expect(finalRun.stages["lint"]?.status).toBe("succeeded");
    expect(executor.inflightCount()).toBe(0);

    // Persistence round-trip: a fresh store reads back the same terminal run.
    const reloaded = store.loadRun(finalRun.runId);
    expect(reloaded?.loopState).toBe("done");
    expect(reloaded?.stages["lint"]?.status).toBe("succeeded");
  });

  it("engine.shutdown() cancels in-flight runs and persists terminal state", async () => {
    const config = buildConfig(join(tmpRoot, "agent-orchestrator.yaml"));
    const registry = buildRegistry(buildAgentManifest());
    const sessionManager = buildSessionManager();
    const executor = buildStubExecutor();
    const store = createPipelineStore(join(tmpRoot, "pipelines"));

    engine = createPipelineEngine({
      store,
      registry,
      agentExecutor: executor,
      initialState: hydrateEngineState(store),
    });

    lifecycle = createLifecycleManager({
      config,
      registry,
      sessionManager,
      projectId: "test-project",
      pipelineEngine: engine,
    });
    lifecycle.start(50);

    const pipeline = buildPipeline();
    const runId = asRunId("run-shutdown-1");
    await engine.dispatch({
      type: "TRIGGER_FIRED",
      now: Date.now(),
      trigger: "pr.opened",
      sessionId: SESSION_ID,
      pipeline,
      headSha: "abc456",
      runId,
      stageRunIds: { lint: asStageRunId("sr-shutdown-1") },
    });
    expect(executor.inflightCount()).toBe(1);

    // Stop the poll loop and tear the engine down WITHOUT advancing the stub
    // to "completed". The engine should cancel via RUN_CANCELLED, which the
    // reducer routes through CANCEL_STAGE → stub.cancelStage.
    lifecycle.stop();
    lifecycle = null;
    await engine.shutdown();

    const reloaded = store.loadRun(runId);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.loopState).toBe("terminated");
    expect(reloaded?.terminationReason).toBe("manual_cancel");
    expect(executor.inflightCount()).toBe(0);
  });
});
