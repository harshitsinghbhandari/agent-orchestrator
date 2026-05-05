import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockConfigRef, mockStore, mockRegistry } = vi.hoisted(() => ({
  mockConfigRef: { current: null as Record<string, unknown> | null },
  mockStore: {
    saveRun: vi.fn(),
    loadRun: vi.fn(),
    listRuns: vi.fn(),
    saveStage: vi.fn(),
    loadStage: vi.fn(),
    appendArtifacts: vi.fn(),
    listArtifacts: vi.fn(),
    saveLoopState: vi.fn(),
    loadLoopState: vi.fn(),
  },
  mockRegistry: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@aoagents/ao-core")>();
  return {
    ...actual,
    loadConfig: () => mockConfigRef.current,
    createPipelineStore: () => mockStore,
    getProjectPipelinesDir: () => "/tmp/pipelines",
  };
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getPluginRegistry: async () => mockRegistry,
}));

vi.mock("../../src/lib/running-state.js", () => ({
  getRunning: async () => null,
}));

import { Command } from "commander";
import { registerPipeline } from "../../src/commands/pipeline.js";
import {
  asPipelineId,
  asRunId,
  asStageRunId,
  type Pipeline,
  type RunState,
} from "@aoagents/ao-core";

let program: Command;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrSpy: ReturnType<typeof vi.spyOn>;

const sampleConfig = () => ({
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
    "my-app": {
      name: "App",
      path: "/tmp/app",
      defaultBranch: "main",
      sessionPrefix: "app",
      pipelines: {
        review: {
          name: "review",
          stages: [
            {
              name: "review-stage",
              trigger: { on: ["pr.opened"] },
              executor: { kind: "agent", plugin: "claude-code", mode: "review" },
              task: { prompt: "Review" },
            },
          ],
        },
      },
    },
  },
  notifiers: {},
  power: { preventIdleSleep: false },
  lifecycle: { autoCleanupOnMerge: true, mergeCleanupIdleGraceMs: 300_000 },
  readyThresholdMs: 300_000,
});

beforeEach(() => {
  mockConfigRef.current = sampleConfig() as Record<string, unknown>;

  for (const fn of [
    mockStore.saveRun,
    mockStore.loadRun,
    mockStore.listRuns,
    mockStore.saveStage,
    mockStore.loadStage,
    mockStore.appendArtifacts,
    mockStore.listArtifacts,
    mockStore.saveLoopState,
    mockStore.loadLoopState,
    mockRegistry.list,
    mockRegistry.get,
    mockRegistry.create,
  ]) {
    fn.mockReset();
  }

  mockStore.listRuns.mockReturnValue([]);
  mockStore.listArtifacts.mockReturnValue([]);
  mockStore.loadLoopState.mockReturnValue(null);
  mockRegistry.list.mockImplementation((slot: string) =>
    slot === "agent"
      ? [
          {
            name: "claude-code",
            slot: "agent",
            description: "",
            version: "0.0.0",
            supportedTaskModes: ["review", "code", "answer"],
          },
        ]
      : [],
  );

  program = new Command();
  program.exitOverride();
  registerPipeline(program);

  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ao pipeline list", () => {
  it("emits configured pipelines as JSON when --json is passed", async () => {
    await program.parseAsync(["node", "test", "pipeline", "list", "--json"]);
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.projectId).toBe("my-app");
    expect(parsed.pipelines).toHaveLength(1);
    expect(parsed.pipelines[0].pipelineId).toBe("review");
    expect(parsed.pipelines[0].triggers).toEqual(["pr.opened"]);
  });

  it("renders a friendly summary for terminals", async () => {
    await program.parseAsync(["node", "test", "pipeline", "list"]);
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("review");
    expect(out).toContain("1 stage(s)");
  });

  it("reports (no pipelines configured) when project has none", async () => {
    const cfg = sampleConfig();
    cfg.projects["my-app"].pipelines = undefined as unknown as typeof cfg.projects["my-app"]["pipelines"];
    mockConfigRef.current = cfg as Record<string, unknown>;
    await program.parseAsync(["node", "test", "pipeline", "list"]);
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("no pipelines configured");
  });
});

describe("ao pipeline runs", () => {
  it("filters by --pipeline + --status and outputs JSON", async () => {
    const baseRun = (overrides: Partial<RunState>): RunState => ({
      runId: asRunId("r"),
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
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
    mockStore.listRuns.mockReturnValue([
      baseRun({ runId: asRunId("a") }),
      baseRun({ runId: asRunId("b"), loopState: "done", createdAt: "2024-02-01T00:00:00Z" }),
      baseRun({ runId: asRunId("c"), pipelineName: "other" }),
    ]);
    await program.parseAsync([
      "node",
      "test",
      "pipeline",
      "runs",
      "--pipeline",
      "review",
      "--status",
      "running",
      "--json",
    ]);
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.runs.map((r: RunState) => r.runId)).toEqual(["a"]);
  });

  it("respects --limit", async () => {
    const baseRun = (id: string, ts: string): RunState => ({
      runId: asRunId(id),
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: {} as Pipeline,
      headSha: "deadbeef",
      loopState: "running",
      loopRounds: 0,
      stages: {},
      createdAt: ts,
      updatedAt: ts,
    });
    mockStore.listRuns.mockReturnValue([
      baseRun("a", "2024-01-01T00:00:00Z"),
      baseRun("b", "2024-02-01T00:00:00Z"),
      baseRun("c", "2024-03-01T00:00:00Z"),
    ]);
    await program.parseAsync(["node", "test", "pipeline", "runs", "--limit", "2", "--json"]);
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.runs.map((r: RunState) => r.runId)).toEqual(["c", "b"]);
  });
});

describe("ao pipeline show", () => {
  it("prints run detail with hydrated stages and loop", async () => {
    const runId = asRunId("r1");
    const stageRunId = asStageRunId("sr1");
    mockStore.loadRun.mockReturnValue({
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
          status: "running",
          attempt: 0,
          artifacts: [],
        },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    mockStore.listArtifacts.mockReturnValue([]);

    await program.parseAsync(["node", "test", "pipeline", "show", "r1"]);
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Run r1");
    expect(out).toContain("review-stage");
  });

  it("exits 1 when run is not found", async () => {
    mockStore.loadRun.mockReturnValue(null);
    await expect(
      program.parseAsync(["node", "test", "pipeline", "show", "missing"]),
    ).rejects.toThrow(/process.exit/);
    const err = consoleErrSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(err).toContain("Run not found");
  });
});

describe("ao pipeline run", () => {
  it("triggers a manual run for a configured pipeline and persists run state", async () => {
    await program.parseAsync(["node", "test", "pipeline", "run", "review", "--json"]);
    expect(mockStore.saveRun).toHaveBeenCalled();
    const persisted = mockStore.saveRun.mock.calls[0][0] as RunState;
    expect(persisted.pipelineName).toBe("review");
    expect(persisted.loopState).toBe("running");

    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.runId).toMatch(/^run-/);
    expect(parsed.pipelineName).toBe("review");
  });

  it("rejects unknown pipelines", async () => {
    await expect(
      program.parseAsync(["node", "test", "pipeline", "run", "missing"]),
    ).rejects.toThrow(/process.exit/);
    expect(mockStore.saveRun).not.toHaveBeenCalled();
    const err = consoleErrSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(err).toMatch(/Pipeline "missing" is not configured/);
  });
});

describe("ao pipeline cancel", () => {
  it("dispatches RUN_CANCELLED and persists the terminal state", async () => {
    const runId = asRunId("r1");
    const run: RunState = {
      runId,
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: {
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
      },
      headSha: "deadbeef",
      loopState: "running",
      loopRounds: 0,
      stages: {
        "review-stage": {
          stageRunId: asStageRunId("sr1"),
          status: "running",
          attempt: 1,
          artifacts: [],
        },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    // hydrateEngineState reads listRuns; loadRun is read by cancelRun directly.
    mockStore.listRuns.mockReturnValue([run]);
    mockStore.loadRun.mockReturnValue(run);
    await program.parseAsync(["node", "test", "pipeline", "cancel", "r1"]);
    expect(mockStore.saveRun).toHaveBeenCalled();
    const persisted = mockStore.saveRun.mock.calls[0][0] as RunState;
    expect(persisted.loopState).toBe("terminated");
    expect(persisted.terminationReason).toBe("manual_cancel");
  });

  it("warns instead of cancelling on a stalled run and suggests resume", async () => {
    const runId = asRunId("r1");
    const run: RunState = {
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
    };
    mockStore.listRuns.mockReturnValue([run]);
    mockStore.loadRun.mockReturnValue(run);
    await program.parseAsync(["node", "test", "pipeline", "cancel", "r1"]);
    expect(mockStore.saveRun).not.toHaveBeenCalled();
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("already in a terminal state");
    expect(out).toContain("ao pipeline resume");
  });
});

describe("ao pipeline resume", () => {
  it("resets failed stages back to pending via the reducer", async () => {
    const runId = asRunId("r1");
    const stageRunId = asStageRunId("sr1");
    const run: RunState = {
      runId,
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: {
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
      },
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
    };
    mockStore.listRuns.mockReturnValue([run]);
    mockStore.loadRun.mockReturnValue(run);
    await program.parseAsync(["node", "test", "pipeline", "resume", "r1"]);
    expect(mockStore.saveRun).toHaveBeenCalled();
    const persisted = mockStore.saveRun.mock.calls[0][0] as RunState;
    expect(persisted.loopState).toBe("running");
    expect(persisted.stages["review-stage"]?.status).toBe("pending");
  });

  it("warns when retries cap prevents any stage from being reset", async () => {
    const runId = asRunId("r1");
    // retries=0 → cap=1 attempt; attempt=1 means already at cap
    const run: RunState = {
      runId,
      pipelineId: asPipelineId("p"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: {
        id: asPipelineId("p"),
        name: "review",
        stages: [
          {
            name: "review-stage",
            trigger: { on: ["manual"] },
            executor: { kind: "agent", plugin: "claude-code", mode: "review" },
            task: {},
            retries: 0,
          },
        ],
      },
      headSha: "deadbeef",
      loopState: "stalled",
      terminationReason: "stage_failure",
      loopRounds: 1,
      stages: {
        "review-stage": {
          stageRunId: asStageRunId("sr1"),
          status: "failed",
          attempt: 1,
          artifacts: [],
        },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    mockStore.listRuns.mockReturnValue([run]);
    mockStore.loadRun.mockReturnValue(run);
    await program.parseAsync(["node", "test", "pipeline", "resume", "r1"]);
    expect(mockStore.saveRun).not.toHaveBeenCalled();
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("retry cap exceeded");
  });

  it("rejects resume on non-terminal runs", async () => {
    const runId = asRunId("r1");
    const run: RunState = {
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
          stageRunId: asStageRunId("sr1"),
          status: "failed",
          attempt: 1,
          artifacts: [],
        },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    mockStore.listRuns.mockReturnValue([run]);
    mockStore.loadRun.mockReturnValue(run);
    await expect(
      program.parseAsync(["node", "test", "pipeline", "resume", "r1"]),
    ).rejects.toThrow(/process.exit/);
    expect(mockStore.saveRun).not.toHaveBeenCalled();
    const err = consoleErrSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(err).toMatch(/not a terminal state/);
  });
});

describe("ao pipeline migrate", () => {
  it("prints a no-op message", async () => {
    await program.parseAsync(["node", "test", "pipeline", "migrate"]);
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toMatch(/v0\.3/);
  });
});
