import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockConfigRef, mockStore } = vi.hoisted(() => ({
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

import { Command } from "commander";
import { registerStage } from "../../src/commands/stage.js";
import {
  asPipelineId,
  asRunId,
  asStageRunId,
  type Artifact,
  type Pipeline,
} from "@aoagents/ao-core";

let program: Command;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockConfigRef.current = {
    port: 3000,
    defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
    plugins: [],
    projects: {
      "my-app": {
        name: "App",
        path: "/tmp/app",
        defaultBranch: "main",
        sessionPrefix: "app",
      },
    },
    notifiers: {},
    power: { preventIdleSleep: false },
    lifecycle: { autoCleanupOnMerge: true, mergeCleanupIdleGraceMs: 300_000 },
    readyThresholdMs: 300_000,
  } as Record<string, unknown>;

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
  ]) {
    fn.mockReset();
  }

  program = new Command();
  program.exitOverride();
  registerStage(program);

  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ao stage show", () => {
  it("renders the stage detail with artifacts", async () => {
    const stageRunId = asStageRunId("sr1");
    const runId = asRunId("r1");
    mockStore.loadStage.mockReturnValue({
      stageRunId,
      runId,
      stageName: "review-stage",
      status: "succeeded",
      attempt: 0,
      artifacts: [],
    });
    mockStore.loadRun.mockReturnValue({
      runId,
      pipelineId: asPipelineId("review"),
      pipelineName: "review",
      sessionId: "s",
      pipelineConfigSnapshot: {} as Pipeline,
      headSha: "deadbeef",
      loopState: "done",
      loopRounds: 0,
      stages: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
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
    mockStore.listArtifacts.mockReturnValue([finding]);

    await program.parseAsync(["node", "test", "stage", "show", "sr1"]);
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("review-stage");
    expect(out).toContain("succeeded");
    expect(out).toContain("issue");
    expect(out).toContain("src/x.ts:1");
  });

  it("emits JSON with --json", async () => {
    mockStore.loadStage.mockReturnValue({
      stageRunId: asStageRunId("sr1"),
      runId: asRunId("r1"),
      stageName: "review-stage",
      status: "succeeded",
      attempt: 0,
      artifacts: [],
    });
    mockStore.loadRun.mockReturnValue(null);
    mockStore.listArtifacts.mockReturnValue([]);

    await program.parseAsync(["node", "test", "stage", "show", "sr1", "--json"]);
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.stage.stageName).toBe("review-stage");
    expect(parsed.artifacts).toEqual([]);
  });

  it("exits 1 when stage is not found", async () => {
    mockStore.loadStage.mockReturnValue(null);
    await expect(
      program.parseAsync(["node", "test", "stage", "show", "missing"]),
    ).rejects.toThrow(/process.exit/);
    const err = consoleErrSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(err).toContain("Stage not found");
  });
});
