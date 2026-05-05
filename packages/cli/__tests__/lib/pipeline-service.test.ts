import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asPipelineId,
  asRunId,
  asStageRunId,
  type Artifact,
  type ConfiguredPipeline,
  type LoopState,
  type PersistedStageRun,
  type Pipeline,
  type PipelineStore,
  type PluginRegistry,
  type RunState,
} from "@aoagents/ao-core";

import {
  cancelRun,
  describeRun,
  describeStage,
  listConfiguredPipelines,
  listRuns,
  migrateStore,
  readStageArtifacts,
  resolveConfiguredPipeline,
  resumeRun,
  triggerRun,
} from "../../src/lib/pipeline-service.js";

function createMockStore(): {
  store: PipelineStore;
  state: {
    runs: Map<string, RunState>;
    stages: Map<string, PersistedStageRun>;
    artifacts: Map<string, Artifact[]>;
    loops: Map<string, LoopState>;
  };
} {
  const state = {
    runs: new Map<string, RunState>(),
    stages: new Map<string, PersistedStageRun>(),
    artifacts: new Map<string, Artifact[]>(),
    loops: new Map<string, LoopState>(),
  };

  const store: PipelineStore = {
    saveRun: vi.fn((run) => {
      state.runs.set(run.runId, run);
    }),
    loadRun: vi.fn((runId) => state.runs.get(runId) ?? null),
    listRuns: vi.fn(() => [...state.runs.values()]),
    saveStage: vi.fn((stage) => {
      state.stages.set(stage.stageRunId, stage);
    }),
    loadStage: vi.fn((stageRunId) => state.stages.get(stageRunId) ?? null),
    appendArtifacts: vi.fn((runId, stageRunId, artifacts) => {
      const key = `${runId}:${stageRunId}`;
      const existing = state.artifacts.get(key) ?? [];
      state.artifacts.set(key, [...existing, ...artifacts]);
    }),
    listArtifacts: vi.fn((runId, stageRunId) => {
      return state.artifacts.get(`${runId}:${stageRunId}`) ?? [];
    }),
    saveLoopState: vi.fn((runId, loop) => {
      state.loops.set(runId, loop);
    }),
    loadLoopState: vi.fn((runId) => state.loops.get(runId) ?? null),
  };

  return { store, state };
}

function makeConfiguredPipeline(
  overrides?: Partial<ConfiguredPipeline>,
): ConfiguredPipeline {
  return {
    name: "review",
    stages: [
      {
        name: "review-stage",
        trigger: { on: ["pr.opened", "pr.updated"] },
        executor: { kind: "agent", plugin: "claude-code", mode: "review" },
        task: { prompt: "Review this PR" },
      },
    ],
    ...overrides,
  };
}

function makeMockRegistry(modes: string[] = ["review", "code", "answer"]): PluginRegistry {
  return {
    list: vi.fn((_slot: string) => [
      {
        name: "claude-code",
        slot: "agent",
        description: "mock",
        version: "0.0.0",
        supportedTaskModes: modes,
      },
    ]),
    get: vi.fn(),
    create: vi.fn(),
  } as unknown as PluginRegistry;
}

const mockConfig = {
  port: 3000,
  defaults: {
    runtime: "tmux",
    agent: "claude-code",
    workspace: "worktree",
    notifiers: [],
    orchestrator: undefined,
    worker: undefined,
  },
  plugins: [],
  projects: {
    proj: {
      name: "Project",
      path: "/tmp/proj",
      defaultBranch: "main",
      sessionPrefix: "p",
      pipelines: {
        review: makeConfiguredPipeline(),
        nightly: makeConfiguredPipeline({
          name: "nightly",
          stages: [
            {
              name: "summary",
              trigger: { on: ["manual"] },
              executor: { kind: "agent", plugin: "claude-code", mode: "answer" },
              task: { prompt: "summarize" },
            },
          ],
        }),
      },
    },
  },
  notifiers: {},
  power: { preventIdleSleep: false },
  lifecycle: { autoCleanupOnMerge: true, mergeCleanupIdleGraceMs: 300_000 },
  readyThresholdMs: 300_000,
} as unknown as Parameters<typeof listConfiguredPipelines>[0];

describe("listConfiguredPipelines", () => {
  it("returns one entry per pipeline with stage count and triggers", () => {
    const result = listConfiguredPipelines(mockConfig, "proj");
    expect(result).toEqual([
      {
        pipelineId: "review",
        name: "review",
        stageCount: 1,
        triggers: ["pr.opened", "pr.updated"],
      },
      {
        pipelineId: "nightly",
        name: "nightly",
        stageCount: 1,
        triggers: ["manual"],
      },
    ]);
  });

  it("returns [] when project is missing or has no pipelines", () => {
    expect(listConfiguredPipelines(mockConfig, "missing")).toEqual([]);
    const noPipelinesConfig = {
      ...mockConfig,
      projects: { ...mockConfig.projects, other: { ...mockConfig.projects.proj, pipelines: undefined } },
    } as typeof mockConfig;
    expect(listConfiguredPipelines(noPipelinesConfig, "other")).toEqual([]);
  });
});

describe("resolveConfiguredPipeline", () => {
  it("converts a configured pipeline to a runtime Pipeline (branded id, stages mapped)", () => {
    const pipeline = resolveConfiguredPipeline(mockConfig, "proj", "review");
    expect(pipeline.id).toBe(asPipelineId("review"));
    expect(pipeline.name).toBe("review");
    expect(pipeline.stages).toHaveLength(1);
    expect(pipeline.stages[0]?.executor.kind).toBe("agent");
  });

  it("throws on unknown pipeline name", () => {
    expect(() => resolveConfiguredPipeline(mockConfig, "proj", "missing")).toThrow(
      /Pipeline "missing" is not configured/,
    );
  });
});

describe("triggerRun", () => {
  it("validates the pipeline against the registry and persists initial run state", () => {
    const { store, state } = createMockStore();
    const registry = makeMockRegistry();
    const pipeline = resolveConfiguredPipeline(mockConfig, "proj", "review");

    const runId = triggerRun(store, registry, pipeline, {}, () => 1_700_000_000_000);

    expect(runId).toMatch(/^run-/);
    expect(state.runs.size).toBe(1);
    const run = state.runs.get(runId)!;
    expect(run.pipelineName).toBe("review");
    expect(run.loopState).toBe("running");
    expect(Object.keys(run.stages)).toEqual(["review-stage"]);
    expect(state.loops.size).toBe(1);
    expect(state.stages.size).toBe(1);
  });

  it("throws PipelineConfigError when an agent doesn't support the requested mode", () => {
    const { store } = createMockStore();
    const registry = makeMockRegistry(["code"]); // no "review"
    const pipeline = resolveConfiguredPipeline(mockConfig, "proj", "review");
    expect(() => triggerRun(store, registry, pipeline)).toThrow(
      /supportedTaskModes/i,
    );
  });

  it("rejects with LoopAlreadyActiveError when an active run already owns the loop key", async () => {
    const { LoopAlreadyActiveError } = await import("../../src/lib/pipeline-service.js");
    const { store, state } = createMockStore();
    const registry = makeMockRegistry();
    const pipeline = resolveConfiguredPipeline(mockConfig, "proj", "review");

    triggerRun(store, registry, pipeline);
    expect(state.runs.size).toBe(1);

    let captured: unknown;
    try {
      triggerRun(store, registry, pipeline);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(LoopAlreadyActiveError);
    expect(state.runs.size).toBe(1); // still only one run
  });
});

describe("listRuns", () => {
  it("filters by pipeline + status and sorts newest first", () => {
    const { store, state } = createMockStore();
    const baseRun = (overrides: Partial<RunState>): RunState => ({
      runId: asRunId("r"),
      pipelineId: asPipelineId("p"),
      pipelineName: "p",
      sessionId: "s",
      pipelineConfigSnapshot: {} as Pipeline,
      headSha: "deadbeef",
      loopState: "running",
      loopRounds: 0,
      stages: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      ...overrides,
    });

    state.runs.set(
      "a",
      baseRun({ runId: asRunId("a"), pipelineName: "review", createdAt: "2024-01-01" }),
    );
    state.runs.set(
      "b",
      baseRun({
        runId: asRunId("b"),
        pipelineName: "review",
        loopState: "done",
        createdAt: "2024-02-01",
      }),
    );
    state.runs.set(
      "c",
      baseRun({ runId: asRunId("c"), pipelineName: "other", createdAt: "2024-03-01" }),
    );

    const all = listRuns(store);
    expect(all.map((r) => r.runId)).toEqual(["c", "b", "a"]);

    const review = listRuns(store, { pipeline: "review" });
    expect(review.map((r) => r.runId)).toEqual(["b", "a"]);

    const running = listRuns(store, { status: "running" });
    expect(running.map((r) => r.runId)).toEqual(["c", "a"]);
  });
});

describe("describeRun / describeStage / readStageArtifacts", () => {
  it("hydrates stages with their artifacts", () => {
    const { store, state } = createMockStore();
    const runId = asRunId("r1");
    const stageRunId = asStageRunId("sr1");
    state.runs.set(runId, {
      runId,
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: {} as Pipeline,
      headSha: "deadbeef",
      loopState: "running",
      loopRounds: 0,
      stages: {
        "review-stage": {
          stageRunId,
          status: "succeeded",
          attempt: 0,
          artifacts: [],
        },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    state.stages.set(stageRunId, {
      stageRunId,
      runId,
      stageName: "review-stage",
      status: "succeeded",
      attempt: 0,
      artifacts: [],
    });

    const finding: Artifact = {
      kind: "finding",
      filePath: "src/x.ts",
      startLine: 1,
      endLine: 2,
      title: "issue",
      description: "desc",
      category: "security",
      severity: "warning",
      confidence: 0.8,
      artifactId: "a1" as Artifact["artifactId"],
      pipelineRunId: runId,
      stageRunId,
      stageName: "review-stage",
      status: "open",
      createdAt: "2024-01-01T00:00:00Z",
    };
    state.artifacts.set(`${runId}:${stageRunId}`, [finding]);

    const detail = describeRun(store, runId);
    expect(detail.run.runId).toBe(runId);
    expect(detail.stages).toHaveLength(1);
    expect(detail.stages[0]?.artifacts).toEqual([finding]);

    const stageDetail = describeStage(store, stageRunId);
    expect(stageDetail.stage.stageRunId).toBe(stageRunId);
    expect(stageDetail.artifacts).toEqual([finding]);

    expect(readStageArtifacts(store, stageRunId)).toEqual([finding]);
  });

  it("describeRun throws on unknown runId", () => {
    const { store } = createMockStore();
    expect(() => describeRun(store, asRunId("nope"))).toThrow(/Run not found/);
  });

  it("describeStage throws on unknown stageRunId", () => {
    const { store } = createMockStore();
    expect(() => describeStage(store, asStageRunId("nope"))).toThrow(/Stage not found/);
  });
});

describe("cancelRun", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T00:00:00Z"));
  });

  it("dispatches RUN_CANCELLED through the reducer and persists effects", () => {
    const { store, state } = createMockStore();
    const runId = asRunId("r1");
    const stageRunId = asStageRunId("sr1");
    const snapshot: Pipeline = {
      id: asPipelineId("p"),
      name: "review",
      stages: [
        {
          name: "review-stage",
          trigger: { on: ["manual"] },
          executor: { kind: "agent", plugin: "claude-code", mode: "review" },
          task: {},
        },
      ],
    };
    state.runs.set(runId, {
      runId,
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: snapshot,
      headSha: "deadbeef",
      loopState: "running",
      loopRounds: 0,
      stages: {
        "review-stage": {
          stageRunId,
          status: "running",
          attempt: 1,
          artifacts: [],
        },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });

    const { run, alreadyTerminal } = cancelRun(store, runId);
    expect(alreadyTerminal).toBe(false);
    expect(run.loopState).toBe("terminated");
    expect(run.terminationReason).toBe("manual_cancel");
    expect(state.loops.get(runId)?.loopState).toBe("terminated");
  });

  it("is idempotent on already-terminal runs (returns alreadyTerminal=true)", () => {
    const { store, state } = createMockStore();
    const runId = asRunId("r1");
    const original: RunState = {
      runId,
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: {} as Pipeline,
      headSha: "deadbeef",
      loopState: "done",
      loopRounds: 0,
      stages: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    state.runs.set(runId, original);
    const { run, alreadyTerminal } = cancelRun(store, runId);
    expect(alreadyTerminal).toBe(true);
    expect(run).toBe(original);
    expect(state.loops.size).toBe(0);
  });

  it("flags stalled runs as alreadyTerminal so the CLI can suggest resume", () => {
    const { store, state } = createMockStore();
    const runId = asRunId("r1");
    state.runs.set(runId, {
      runId,
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: {} as Pipeline,
      headSha: "deadbeef",
      loopState: "stalled",
      terminationReason: "stage_failure",
      loopRounds: 1,
      stages: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    const { run, alreadyTerminal } = cancelRun(store, runId);
    expect(alreadyTerminal).toBe(true);
    expect(run.loopState).toBe("stalled");
  });

  it("throws on unknown runId", () => {
    const { store } = createMockStore();
    expect(() => cancelRun(store, asRunId("missing"))).toThrow(/Run not found/);
  });
});

describe("resumeRun", () => {
  function snapshotWithRetries(retries?: number): Pipeline {
    return {
      id: asPipelineId("p"),
      name: "review",
      stages: [
        {
          name: "review-stage",
          trigger: { on: ["manual"] },
          executor: { kind: "agent", plugin: "claude-code", mode: "review" },
          task: {},
          ...(retries !== undefined ? { retries } : {}),
        },
      ],
    };
  }

  it("resets failed stages to pending and re-arms the loop pointer", () => {
    const { store, state } = createMockStore();
    const runId = asRunId("r1");
    const stageRunId = asStageRunId("sr1");
    state.runs.set(runId, {
      runId,
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: snapshotWithRetries(2),
      headSha: "deadbeef",
      loopState: "stalled",
      terminationReason: "stage_failure",
      loopRounds: 1,
      stages: {
        "review-stage": {
          stageRunId,
          status: "failed",
          attempt: 1,
          artifacts: [],
          errorMessage: "boom",
        },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });

    const { run, resetStages } = resumeRun(store, runId, () => 1_700_000_000_000);
    expect(resetStages).toEqual(["review-stage"]);
    expect(run.loopState).toBe("running");
    expect(run.terminationReason).toBeUndefined();
    expect(run.stages["review-stage"]?.status).toBe("pending");
    expect(run.stages["review-stage"]?.attempt).toBe(2);
    // New stageRunId minted by the service (so the next attempt's artifacts
    // don't collide with the previous attempt's).
    expect(run.stages["review-stage"]?.stageRunId).not.toBe(stageRunId);
    expect(state.loops.get(runId)?.loopState).toBe("running");
  });

  it("rejects resume on non-terminal runs (would double-spawn under v0.4)", () => {
    const { store, state } = createMockStore();
    const runId = asRunId("r1");
    state.runs.set(runId, {
      runId,
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: snapshotWithRetries(),
      headSha: "deadbeef",
      loopState: "running",
      loopRounds: 0,
      stages: {
        "review-stage": {
          stageRunId: asStageRunId("sr1"),
          status: "failed",
          attempt: 1,
          artifacts: [],
          errorMessage: "boom",
        },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    expect(() => resumeRun(store, runId)).toThrow(
      /not a terminal state/,
    );
  });

  it("refuses to bump attempt past stage.retries", () => {
    const { store, state } = createMockStore();
    const runId = asRunId("r1");
    state.runs.set(runId, {
      runId,
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: snapshotWithRetries(1), // 1 retry → cap = 2 attempts
      headSha: "deadbeef",
      loopState: "stalled",
      terminationReason: "stage_failure",
      loopRounds: 1,
      stages: {
        "review-stage": {
          stageRunId: asStageRunId("sr1"),
          status: "failed",
          attempt: 2, // already at the cap
          artifacts: [],
          errorMessage: "boom",
        },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    // The reducer rejects (logs a console warning) and the run stays stalled.
    const { run, resetStages } = resumeRun(store, runId);
    expect(resetStages).toEqual(["review-stage"]); // listed but no state change
    expect(run.loopState).toBe("stalled");
    expect(run.stages["review-stage"]?.status).toBe("failed");
  });

  it("returns unchanged when no stages are failed", () => {
    const { store, state } = createMockStore();
    const runId = asRunId("r1");
    state.runs.set(runId, {
      runId,
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: snapshotWithRetries(),
      headSha: "deadbeef",
      loopState: "done",
      loopRounds: 0,
      stages: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    const { resetStages } = resumeRun(store, runId);
    expect(resetStages).toEqual([]);
    expect(state.loops.size).toBe(0);
  });

  it("throws on unknown runId", () => {
    const { store } = createMockStore();
    expect(() => resumeRun(store, asRunId("missing"))).toThrow(/Run not found/);
  });
});

describe("migrateStore", () => {
  it("returns a no-op result for the v0.3 schema", () => {
    const { store } = createMockStore();
    const result = migrateStore(store);
    expect(result.migrated).toBe(0);
    expect(result.message).toMatch(/v0\.3/);
  });
});
