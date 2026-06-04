/**
 * Tests for fingerprint wiring + stall-window convergence (#197 / 8b).
 *
 * - Finding artifacts get a stable fingerprint at materialize time (no longer
 *   only set by the migration backfill).
 * - `summarizeRun` returns sorted+deduped fingerprints from the run.
 * - A run whose history shows `stallWindow` consecutive identical fingerprint
 *   sets terminates as `converged` → `stalled` rather than `done`.
 */

import { describe, expect, it } from "vitest";

import {
  asPipelineId,
  asRunId,
  asStageRunId,
  computeFindingFingerprint,
  emptyEngineState,
  loopKey,
  reduce,
  type ArtifactInput,
  type EngineState,
  type Pipeline,
  type PipelineEvent,
  type RunId,
  type Stage,
  type StageRunId,
} from "../pipeline/index.js";

const NOW = 1_700_000_000_000;

function makeStage(name: string, overrides: Partial<Stage> = {}): Stage {
  return {
    name,
    trigger: { on: ["pr.opened", "pr.updated", "manual"] },
    executor: { kind: "agent", plugin: "codex", mode: "review" },
    task: { prompt: name },
    ...overrides,
  };
}

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: asPipelineId("pl-1"),
    name: "default",
    stages: [makeStage("review")],
    maxConcurrentStages: 1,
    ...overrides,
  };
}

type Finding = Extract<ArtifactInput, { kind: "finding" }>;

function finding(over: Partial<Finding> = {}): Finding {
  return {
    kind: "finding",
    filePath: "src/x.ts",
    startLine: 10,
    endLine: 12,
    title: "Possible null deref",
    description: "x might be null",
    category: "correctness",
    severity: "warning",
    confidence: 0.8,
    ...over,
  };
}

function runRound(
  state: EngineState,
  opts: {
    runId: RunId;
    artifacts: ArtifactInput[];
    sessionId?: string;
    headSha?: string;
    trigger?: PipelineEvent["type"] extends infer T ? T : never;
    pipeline?: Pipeline;
  },
): EngineState {
  const pipeline = opts.pipeline ?? makePipeline();
  const stageRunIds: Record<string, StageRunId> = Object.fromEntries(
    pipeline.stages.map((s) => [s.name, asStageRunId(`${opts.runId}-${s.name}`)]),
  );

  let next = reduce(state, {
    type: "TRIGGER_FIRED",
    now: NOW,
    trigger: "pr.updated",
    sessionId: opts.sessionId ?? "ses-1",
    pipeline,
    headSha: opts.headSha ?? "sha-aaa",
    runId: opts.runId,
    stageRunIds,
  }).state;

  for (const stage of pipeline.stages) {
    next = reduce(next, {
      type: "STAGE_STARTED",
      now: NOW + 1,
      runId: opts.runId,
      stageName: stage.name,
    }).state;
    next = reduce(next, {
      type: "STAGE_COMPLETED",
      now: NOW + 2,
      runId: opts.runId,
      stageName: stage.name,
      artifacts: opts.artifacts,
    }).state;
  }
  return next;
}

describe("materializeArtifact attaches finding fingerprints", () => {
  it("finding artifacts carry a stable fingerprint after STAGE_COMPLETED", () => {
    const pipeline = makePipeline();
    const stageRunIds = { review: asStageRunId("sr-1") };
    let { state } = reduce(emptyEngineState(), {
      type: "TRIGGER_FIRED",
      now: NOW,
      trigger: "pr.opened",
      sessionId: "ses-1",
      pipeline,
      headSha: "sha-aaa",
      runId: asRunId("run-1"),
      stageRunIds,
    });
    state = reduce(state, {
      type: "STAGE_STARTED",
      now: NOW + 1,
      runId: asRunId("run-1"),
      stageName: "review",
    }).state;

    const fp = computeFindingFingerprint(finding(), "review");

    const result = reduce(state, {
      type: "STAGE_COMPLETED",
      now: NOW + 2,
      runId: asRunId("run-1"),
      stageName: "review",
      artifacts: [finding()],
    });

    const append = result.effects.find((e) => e.type === "APPEND_ARTIFACTS");
    if (append?.type !== "APPEND_ARTIFACTS") throw new Error("missing APPEND_ARTIFACTS");
    const stored = append.artifacts[0];
    if (stored.kind !== "finding") throw new Error("expected finding");
    expect(stored.fingerprint).toBe(fp);
  });

  it("json artifacts do not carry a fingerprint", () => {
    const pipeline = makePipeline();
    let { state } = reduce(emptyEngineState(), {
      type: "TRIGGER_FIRED",
      now: NOW,
      trigger: "pr.opened",
      sessionId: "ses-1",
      pipeline,
      headSha: "sha-aaa",
      runId: asRunId("run-1"),
      stageRunIds: { review: asStageRunId("sr-1") },
    });
    state = reduce(state, {
      type: "STAGE_STARTED",
      now: NOW + 1,
      runId: asRunId("run-1"),
      stageName: "review",
    }).state;

    const result = reduce(state, {
      type: "STAGE_COMPLETED",
      now: NOW + 2,
      runId: asRunId("run-1"),
      stageName: "review",
      artifacts: [{ kind: "json", data: { ok: true } }],
    });
    const append = result.effects.find((e) => e.type === "APPEND_ARTIFACTS");
    if (append?.type !== "APPEND_ARTIFACTS") throw new Error("missing APPEND_ARTIFACTS");
    const stored = append.artifacts[0];
    expect(stored.fingerprint).toBeUndefined();
  });
});

describe("stall-window convergence", () => {
  it("does NOT converge when stallWindow is unset", () => {
    let state = emptyEngineState();
    for (let i = 1; i <= 3; i++) {
      state = runRound(state, {
        runId: asRunId(`run-${i}`),
        artifacts: [finding({ title: "Same" })],
      });
    }
    // No stall window → every run terminates as `done`.
    const key = loopKey("ses-1", "default");
    const summaries = state.historySummaries[key]!;
    expect(summaries).toHaveLength(3);
    for (const s of summaries) {
      expect(s.loopState).toBe("done");
      expect(s.terminationReason).toBe("completed");
    }
  });

  it("terminates the third identical-fingerprint run as converged → stalled when stallWindow=3", () => {
    const pipeline = makePipeline({
      stages: [makeStage("review", { policy: { stallWindow: 3 } })],
    });
    let state = emptyEngineState();
    for (let i = 1; i <= 3; i++) {
      state = runRound(state, {
        runId: asRunId(`run-${i}`),
        artifacts: [finding({ title: "Same" })],
        pipeline,
      });
    }
    const key = loopKey("ses-1", "default");
    const summaries = state.historySummaries[key]!;
    expect(summaries).toHaveLength(3);
    // First two complete normally, third converges.
    expect(summaries[0]!.loopState).toBe("done");
    expect(summaries[1]!.loopState).toBe("done");
    expect(summaries[2]!.loopState).toBe("stalled");
    expect(summaries[2]!.terminationReason).toBe("converged");
    // The fingerprint must round-trip into summaries.
    expect(summaries[2]!.fingerprints).toHaveLength(1);
  });

  it("breaks convergence when fingerprints change between runs", () => {
    const pipeline = makePipeline({
      stages: [makeStage("review", { policy: { stallWindow: 2 } })],
    });
    let state = emptyEngineState();
    state = runRound(state, {
      runId: asRunId("run-1"),
      artifacts: [finding({ title: "A" })],
      pipeline,
    });
    state = runRound(state, {
      runId: asRunId("run-2"),
      artifacts: [finding({ title: "B" })],
      pipeline,
    });
    const key = loopKey("ses-1", "default");
    const summaries = state.historySummaries[key]!;
    // Different fingerprints across the two runs → no convergence trigger.
    expect(summaries.every((s) => s.loopState === "done")).toBe(true);
  });
});
