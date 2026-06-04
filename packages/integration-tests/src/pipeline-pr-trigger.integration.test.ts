/**
 * Integration test for issue #192:
 *
 *   "open a PR on a session → assert a pr.opened-triggered pipeline reaches
 *    `done` end-to-end"
 *
 * This wires the same primitives `ao start` does — store, engine,
 * lifecycle-manager, plugin registry — and drives a real poll cycle. The SCM
 * plugin is mocked to surface a PR on a particular poll, which simulates the
 * remote git host advertising a newly-opened PR. The agent executor is a stub
 * so no actual session is spawned; the test asserts the run progresses through
 * TRIGGER_FIRED → START_STAGE → tick() → STAGE_COMPLETED → loopState=done.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLifecycleManager,
  createPipelineEngine,
  createPipelineStore,
  hydrateEngineState,
  type AgentStageExecutor,
  type Agent,
  type ActivityState,
  type ConfiguredPipeline,
  type LifecycleManager,
  type OpenCodeSessionManager,
  type OrchestratorConfig,
  type PipelineEngine,
  type PluginManifest,
  type PluginRegistry,
  type PREnrichmentData,
  type PRInfo,
  type Runtime,
  type RunningAgentStage,
  type RunState,
  type SCM,
  type Session,
  type StageOutcome,
  type StartStageInput,
} from "@aoagents/ao-core";

const PROJECT_ID = "test-project";
const SESSION_ID = "ao-pipe-1";
const PIPELINE_NAME = "review";

function buildPipeline(): ConfiguredPipeline {
  return {
    name: PIPELINE_NAME,
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
    projects: {
      [PROJECT_ID]: {
        name: PROJECT_ID,
        repo: "org/test-project",
        path: "/tmp/proj",
        defaultBranch: "main",
        sessionPrefix: "ao",
        scm: { plugin: "github" },
        pipelines: {
          [PIPELINE_NAME]: buildPipeline(),
        },
      },
    },
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

interface StubExecutor extends AgentStageExecutor {
  setNextOutcome(outcome: StageOutcome): void;
  inflightCount(): number;
}

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

function makePR(): PRInfo {
  return {
    number: 99,
    url: "https://github.com/org/test-project/pull/99",
    title: "Add feature",
    owner: "org",
    repo: "test-project",
    branch: "feat/x",
    baseBranch: "main",
    isDraft: false,
    isFromFork: false,
  };
}

function makeSession(pr: PRInfo): Session {
  // session.pr is set from the start so populatePREnrichmentCache fills the
  // batch cache (including headSha) BEFORE checkSession runs. lifecycle.pr
  // is still "none" — flips to "open" inside determineStatus on the first
  // poll, which is the transition the bridge fires on. This models the
  // "PR is opened and observed in the same poll" case end-to-end.
  const lifecycle = {
    version: 2 as const,
    session: {
      kind: "worker" as const,
      state: "working" as const,
      reason: "task_in_progress" as const,
      startedAt: new Date().toISOString(),
      completedAt: null,
      terminatedAt: null,
      lastTransitionAt: new Date().toISOString(),
    },
    pr: {
      state: "none" as const,
      reason: "not_created" as const,
      number: null,
      url: null,
      lastObservedAt: null,
    },
    runtime: {
      state: "alive" as const,
      reason: "process_running" as const,
      lastObservedAt: new Date().toISOString(),
      handle: { id: "rt-1", runtimeName: "stub", data: {} },
      tmuxName: null,
    },
  };
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    status: "working",
    activity: "active",
    activitySignal: {
      state: "valid",
      activity: "active",
      timestamp: new Date(),
      source: "native",
    },
    lifecycle,
    branch: "feat/x",
    issueId: null,
    pr,
    workspacePath: "/tmp/ws",
    runtimeHandle: { id: "rt-1", runtimeName: "stub", data: {} },
    agentInfo: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    metadata: { project: PROJECT_ID, status: "working", worktree: "/tmp/ws" },
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

function buildStubAgent(): Agent {
  return {
    name: "stub-agent",
    processName: "stub-agent",
    getLaunchCommand: () => "stub-agent --start",
    getEnvironment: () => ({}),
    detectActivity: () => "active" as ActivityState,
    getActivityState: async () => ({ state: "active" as ActivityState }),
    isProcessRunning: async () => true,
    getSessionInfo: async () => null,
  };
}

function buildStubRuntime(): Runtime {
  return {
    name: "stub",
    create: async () => ({ id: "rt-1", runtimeName: "stub", data: {} }),
    destroy: async () => undefined,
    sendMessage: async () => undefined,
    getOutput: async () => "",
    isAlive: async () => true,
  };
}

function buildStubSCM(pr: PRInfo, headSha: string): SCM {
  return {
    name: "github",
    detectPR: vi.fn().mockResolvedValue(pr),
    getPRState: async () => "open",
    mergePR: async () => undefined,
    closePR: async () => undefined,
    getCIChecks: async () => [],
    getCISummary: async () => "passing",
    getReviews: async () => [],
    getReviewDecision: async () => "none",
    getPendingComments: async () => [],
    getMergeability: async () => ({
      mergeable: false,
      ciPassing: true,
      approved: false,
      noConflicts: true,
      blockers: [],
    }),
    enrichSessionsPRBatch: vi.fn().mockImplementation(async (prs: PRInfo[]) => {
      const result = new Map<string, PREnrichmentData>();
      for (const p of prs) {
        result.set(`${p.owner}/${p.repo}#${p.number}`, {
          state: "open",
          ciStatus: "passing",
          reviewDecision: "none",
          mergeable: false,
          headSha,
        });
      }
      return result;
    }),
  };
}

function buildRegistry(scm: SCM, agentManifest: PluginManifest): PluginRegistry {
  const agent = buildStubAgent();
  const runtime = buildStubRuntime();
  return {
    register: () => {},
    get: (slot: string, name?: string) => {
      if (slot === "scm") return scm;
      if (slot === "agent") {
        if (!name || name === agent.name) return agent;
      }
      if (slot === "runtime") return runtime;
      return null;
    },
    list: (slot: string) => {
      if (slot === "agent") return [agentManifest];
      return [];
    },
    loadBuiltins: async () => {},
    loadFromConfig: async () => {},
  } as PluginRegistry;
}

function buildSessionManager(session: Session): OpenCodeSessionManager {
  return {
    list: vi.fn().mockResolvedValue([session]),
    get: vi.fn().mockResolvedValue(session),
    spawn: async () => {
      throw new Error("stub spawn — should not be called");
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
    send: async () => undefined,
    claimPR: async () => {
      throw new Error("stub claimPR — should not be called");
    },
    remap: async () => "",
    listCached: async () => [session],
    invalidateCache: () => {},
  } as OpenCodeSessionManager;
}

async function waitForRunDone(
  engine: PipelineEngine,
  timeoutMs: number,
): Promise<RunState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = engine.state();
    for (const run of Object.values(state.runs)) {
      if (
        run.pipelineName === PIPELINE_NAME &&
        run.sessionId === SESSION_ID &&
        run.loopState === "done"
      ) {
        return run;
      }
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `Timed out waiting for run.loopState=done; current=${JSON.stringify(
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

describe("pipeline trigger bridge (PR opened → engine starts run → done)", () => {
  let tmpRoot: string;
  let lifecycle: LifecycleManager | null = null;
  let engine: PipelineEngine | null = null;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "ao-pipe-pr-trigger-"));
  });

  afterEach(async () => {
    if (lifecycle) {
      lifecycle.stop();
      lifecycle = null;
    }
    if (engine) {
      await engine.shutdown().catch(() => undefined);
      engine = null;
    }
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("opens a PR on a session → bridge fires pr.opened → run reaches done end-to-end", async () => {
    const pr = makePR();
    const config = buildConfig(join(tmpRoot, "agent-orchestrator.yaml"));
    const session = makeSession(pr);
    const scm = buildStubSCM(pr, "sha-init");
    const registry = buildRegistry(scm, buildAgentManifest());
    const sessionManager = buildSessionManager(session);
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
      projectId: PROJECT_ID,
      pipelineEngine: engine,
    });

    // First check populates the PR enrichment cache and triggers the bridge.
    // The bridge calls engine.startRun, which calls START_STAGE, which calls
    // the stub executor. After this, exactly one inflight stage exists.
    await lifecycle.check(SESSION_ID);
    expect(executor.inflightCount()).toBe(1);

    // Verify the run came from the right trigger.
    const runsBefore = Object.values(engine.state().runs);
    expect(runsBefore).toHaveLength(1);
    expect(runsBefore[0].headSha).toBe("sha-init");
    expect(runsBefore[0].sessionId).toBe(SESSION_ID);
    expect(runsBefore[0].pipelineName).toBe(PIPELINE_NAME);

    // Tell the stub executor the next poll completes the stage; start the
    // lifecycle's 50ms poll loop so engine.tick() observes the outcome and
    // drives the reducer to STAGE_COMPLETED → loopState=done.
    executor.setNextOutcome({ status: "completed", artifacts: [] });
    lifecycle.start(50);

    const finalRun = await waitForRunDone(engine, 5_000);
    expect(finalRun.loopState).toBe("done");
    expect(finalRun.stages["lint"]?.status).toBe("succeeded");
    expect(executor.inflightCount()).toBe(0);

    // Persistence round-trip: a fresh store reads back the same terminal run.
    const reloaded = store.loadRun(finalRun.runId);
    expect(reloaded?.loopState).toBe("done");
  });
});
