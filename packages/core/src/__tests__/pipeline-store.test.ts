import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  artifactsFilePath,
  asArtifactId,
  asPipelineId,
  asRunId,
  asStageRunId,
  createPipelineStore,
  loopFilePath,
  runFilePath,
  stageFilePath,
  type Artifact,
  type LoopState,
  type PersistedStageRun,
  type Pipeline,
  type RunState,
} from "../pipeline/index.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pipeline-store-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makePipeline(): Pipeline {
  return {
    id: asPipelineId("pl-1"),
    name: "default",
    stages: [
      {
        name: "review",
        trigger: { on: ["pr.opened"] },
        executor: { kind: "agent", plugin: "codex", mode: "review" },
        task: { prompt: "review the diff" },
      },
    ],
    maxConcurrentStages: 1,
  };
}

function makeRun(): RunState {
  return {
    runId: asRunId("run-1"),
    pipelineId: asPipelineId("pl-1"),
    pipelineName: "default",
    sessionId: "ses-1",
    pipelineConfigSnapshot: makePipeline(),
    headSha: "sha-aaa",
    loopState: "running",
    loopRounds: 1,
    stages: {
      review: {
        stageRunId: asStageRunId("sr-1"),
        status: "pending",
        attempt: 1,
        artifacts: [],
      },
    },
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
  };
}

describe("pipeline store — runs", () => {
  it("roundtrips a RunState through saveRun/loadRun", () => {
    const store = createPipelineStore(root);
    const run = makeRun();
    store.saveRun(run);
    expect(existsSync(runFilePath(root, run.runId))).toBe(true);
    expect(store.loadRun(run.runId)).toEqual(run);
  });

  it("returns null for unknown runId", () => {
    const store = createPipelineStore(root);
    expect(store.loadRun(asRunId("missing"))).toBeNull();
  });

  it("listRuns returns every saved run regardless of order", () => {
    const store = createPipelineStore(root);
    const a = makeRun();
    const b: RunState = { ...makeRun(), runId: asRunId("run-2"), loopState: "done" };
    store.saveRun(a);
    store.saveRun(b);
    const ids = store
      .listRuns()
      .map((r) => r.runId)
      .sort();
    expect(ids).toEqual([asRunId("run-1"), asRunId("run-2")].sort());
  });

  it("listRuns on an empty store returns an empty array (and creates layout)", () => {
    const store = createPipelineStore(root);
    expect(store.listRuns()).toEqual([]);
  });
});

describe("pipeline store — stages", () => {
  it("roundtrips a stage through saveStage/loadStage", () => {
    const store = createPipelineStore(root);
    const stage: PersistedStageRun = {
      runId: asRunId("run-1"),
      stageName: "review",
      stageRunId: asStageRunId("sr-1"),
      status: "running",
      attempt: 1,
      artifacts: [],
      startedAt: "2026-05-04T00:00:01.000Z",
    };
    store.saveStage(stage);
    expect(existsSync(stageFilePath(root, stage.stageRunId))).toBe(true);
    expect(store.loadStage(stage.stageRunId)).toEqual(stage);
  });
});

describe("pipeline store — artifacts (jsonl)", () => {
  function makeArtifact(idSuffix: string): Artifact {
    return {
      kind: "finding",
      filePath: "src/x.ts",
      startLine: 1,
      endLine: 2,
      title: `f-${idSuffix}`,
      description: "...",
      category: "general",
      severity: "info",
      confidence: 0.9,
      artifactId: asArtifactId(`art-${idSuffix}`),
      pipelineRunId: asRunId("run-1"),
      stageRunId: asStageRunId("sr-1"),
      stageName: "review",
      status: "open",
      createdAt: "2026-05-04T00:00:00.000Z",
    };
  }

  it("appends artifacts as JSONL and reads them back in order", () => {
    const store = createPipelineStore(root);
    const a = makeArtifact("1");
    const b = makeArtifact("2");
    store.appendArtifacts(asRunId("run-1"), asStageRunId("sr-1"), [a, b]);

    const path = artifactsFilePath(root, asRunId("run-1"), asStageRunId("sr-1"));
    const raw = readFileSync(path, "utf-8");
    expect(raw.split("\n").filter(Boolean)).toHaveLength(2);

    const out = store.listArtifacts(asRunId("run-1"), asStageRunId("sr-1"));
    expect(out.map((x) => x.artifactId)).toEqual([a.artifactId, b.artifactId]);
  });

  it("appendArtifacts is additive across calls", () => {
    const store = createPipelineStore(root);
    store.appendArtifacts(asRunId("run-1"), asStageRunId("sr-1"), [makeArtifact("1")]);
    store.appendArtifacts(asRunId("run-1"), asStageRunId("sr-1"), [makeArtifact("2")]);
    expect(store.listArtifacts(asRunId("run-1"), asStageRunId("sr-1"))).toHaveLength(2);
  });

  it("listArtifacts returns [] for missing files", () => {
    const store = createPipelineStore(root);
    expect(store.listArtifacts(asRunId("nope"), asStageRunId("nope"))).toEqual([]);
  });

  it("appendArtifacts with empty list is a no-op", () => {
    const store = createPipelineStore(root);
    store.appendArtifacts(asRunId("run-1"), asStageRunId("sr-1"), []);
    expect(store.listArtifacts(asRunId("run-1"), asStageRunId("sr-1"))).toEqual([]);
  });
});

describe("pipeline store — loops", () => {
  it("roundtrips a LoopState through saveLoopState/loadLoopState", () => {
    const store = createPipelineStore(root);
    const loop: LoopState = {
      sessionId: "ses-1",
      pipelineName: "default",
      loopState: "running",
      loopRounds: 2,
      lastSha: "sha-aaa",
      currentRunId: asRunId("run-1"),
      updatedAt: "2026-05-04T00:00:00.000Z",
    };
    store.saveLoopState(asRunId("run-1"), loop);
    expect(existsSync(loopFilePath(root, asRunId("run-1")))).toBe(true);
    expect(store.loadLoopState(asRunId("run-1"))).toEqual(loop);
  });

  it("returns null for missing loop state", () => {
    const store = createPipelineStore(root);
    expect(store.loadLoopState(asRunId("nope"))).toBeNull();
  });
});
