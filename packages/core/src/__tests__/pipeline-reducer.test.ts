import { describe, expect, it } from "vitest";

import {
  asPipelineId,
  asRunId,
  asStageRunId,
  emptyEngineState,
  loopKey,
  reduce,
  type ArtifactInput,
  type EngineState,
  type Pipeline,
  type PipelineEvent,
  type RunId,
  type StageRunId,
  type Stage,
  type StageTriggerEvent,
} from "../pipeline/index.js";

const NOW = 1_700_000_000_000;

function makeStage(name: string, overrides: Partial<Stage> = {}): Stage {
  return {
    name,
    trigger: { on: ["pr.opened", "pr.updated"] },
    executor: {
      kind: "agent",
      plugin: "codex",
      mode: "review",
    },
    task: { prompt: `run ${name}` },
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

function fireTrigger(
  state: EngineState,
  opts: {
    runId?: RunId;
    stageRunIds?: Record<string, StageRunId>;
    pipeline?: Pipeline;
    sessionId?: string;
    headSha?: string;
    trigger?: StageTriggerEvent;
    now?: number;
  } = {},
) {
  const pipeline = opts.pipeline ?? makePipeline();
  const runId = opts.runId ?? asRunId("run-1");
  const stageRunIds: Record<string, StageRunId> =
    opts.stageRunIds ??
    Object.fromEntries(
      pipeline.stages.map((s, i) => [s.name, asStageRunId(`${runId}-${s.name}-${i}`)]),
    );

  const event: PipelineEvent = {
    type: "TRIGGER_FIRED",
    now: opts.now ?? NOW,
    trigger: opts.trigger ?? "pr.opened",
    sessionId: opts.sessionId ?? "ses-1",
    pipeline,
    headSha: opts.headSha ?? "sha-aaa",
    runId,
    stageRunIds,
  };

  return reduce(state, event);
}

describe("pipeline reducer — TRIGGER_FIRED", () => {
  it("creates a run, persists it, and emits START_STAGE for the first stage", () => {
    const { state, effects } = fireTrigger(emptyEngineState());

    const runId = asRunId("run-1");
    expect(state.runs[runId]).toBeDefined();
    expect(state.runs[runId].loopState).toBe("running");
    expect(state.runs[runId].stages.review.status).toBe("pending");
    expect(state.currentRunByLoop[loopKey("ses-1", "default")]).toBe(runId);

    const types = effects.map((e) => e.type);
    expect(types).toContain("PERSIST_RUN");
    expect(types).toContain("PERSIST_LOOP_STATE");
    expect(types).toContain("START_STAGE");
    expect(types).toContain("EMIT_OBSERVATION");

    const startStage = effects.find((e) => e.type === "START_STAGE");
    if (startStage?.type !== "START_STAGE") throw new Error("expected START_STAGE");
    expect(startStage.stage.name).toBe("review");
  });

  it("ignores duplicate triggers when a run is already in flight for the loop", () => {
    const first = fireTrigger(emptyEngineState());
    const second = fireTrigger(first.state, { runId: asRunId("run-2") });
    expect(second.state.runs[asRunId("run-2")]).toBeUndefined();
    expect(second.effects).toEqual([]);
  });

  it("only schedules up to maxConcurrentStages effects", () => {
    const pipeline = makePipeline({
      stages: [makeStage("a"), makeStage("b"), makeStage("c")],
      maxConcurrentStages: 2,
    });
    const { effects } = fireTrigger(emptyEngineState(), { pipeline });
    const startEffects = effects.filter((e) => e.type === "START_STAGE");
    expect(startEffects).toHaveLength(2);
  });

  it("emits invalid_transition observation when stageRunIds are missing", () => {
    const pipeline = makePipeline({ stages: [makeStage("a"), makeStage("b")] });
    const { state, effects } = fireTrigger(emptyEngineState(), {
      pipeline,
      stageRunIds: { a: asStageRunId("sr-a") },
    });
    expect(state.runs).toEqual({});
    const obs = effects.find(
      (e) => e.type === "EMIT_OBSERVATION" && e.event.name === "pipeline.invalid_transition",
    );
    expect(obs).toBeDefined();
  });
});

describe("pipeline reducer — STAGE_STARTED / STAGE_COMPLETED", () => {
  it("transitions pending → running on STAGE_STARTED", () => {
    const triggered = fireTrigger(emptyEngineState());
    const { state } = reduce(triggered.state, {
      type: "STAGE_STARTED",
      now: NOW + 1,
      runId: asRunId("run-1"),
      stageName: "review",
    });
    expect(state.runs[asRunId("run-1")].stages.review.status).toBe("running");
    expect(state.runs[asRunId("run-1")].stages.review.startedAt).toBeDefined();
  });

  it("rejects STAGE_STARTED if stage isn't pending", () => {
    const triggered = fireTrigger(emptyEngineState());
    const started = reduce(triggered.state, {
      type: "STAGE_STARTED",
      now: NOW + 1,
      runId: asRunId("run-1"),
      stageName: "review",
    });
    const dup = reduce(started.state, {
      type: "STAGE_STARTED",
      now: NOW + 2,
      runId: asRunId("run-1"),
      stageName: "review",
    });
    expect(dup.state).toEqual(started.state);
    const obs = dup.effects.find(
      (e) => e.type === "EMIT_OBSERVATION" && e.event.name === "pipeline.invalid_transition",
    );
    expect(obs).toBeDefined();
  });

  it("STAGE_COMPLETED on the last stage transitions run to done with APPEND_ARTIFACTS", () => {
    const triggered = fireTrigger(emptyEngineState());
    const started = reduce(triggered.state, {
      type: "STAGE_STARTED",
      now: NOW + 1,
      runId: asRunId("run-1"),
      stageName: "review",
    });

    const findings: ArtifactInput[] = [
      {
        kind: "finding",
        filePath: "src/x.ts",
        startLine: 1,
        endLine: 2,
        title: "Possible null deref",
        description: "...",
        category: "correctness",
        severity: "warning",
        confidence: 0.8,
      },
    ];

    const { state, effects } = reduce(started.state, {
      type: "STAGE_COMPLETED",
      now: NOW + 2,
      runId: asRunId("run-1"),
      stageName: "review",
      verdict: "fail",
      artifacts: findings,
    });

    expect(state.runs[asRunId("run-1")].loopState).toBe("done");
    expect(state.runs[asRunId("run-1")].terminationReason).toBe("completed");

    const append = effects.find((e) => e.type === "APPEND_ARTIFACTS");
    if (append?.type !== "APPEND_ARTIFACTS") throw new Error("expected APPEND_ARTIFACTS");
    expect(append.artifacts).toHaveLength(1);
    expect(append.artifacts[0].status).toBe("open");
    expect(append.artifacts[0].pipelineRunId).toBe(asRunId("run-1"));

    expect(state.currentRunByLoop[loopKey("ses-1", "default")]).toBeUndefined();
    const summaries = state.historySummaries[loopKey("ses-1", "default")];
    expect(summaries).toHaveLength(1);
  });

  it("STAGE_COMPLETED on a non-final stage starts the next stage", () => {
    const pipeline = makePipeline({
      stages: [makeStage("a"), makeStage("b")],
      maxConcurrentStages: 1,
    });
    const triggered = fireTrigger(emptyEngineState(), { pipeline });
    const started = reduce(triggered.state, {
      type: "STAGE_STARTED",
      now: NOW + 1,
      runId: asRunId("run-1"),
      stageName: "a",
    });
    const { state, effects } = reduce(started.state, {
      type: "STAGE_COMPLETED",
      now: NOW + 2,
      runId: asRunId("run-1"),
      stageName: "a",
      artifacts: [],
    });

    expect(state.runs[asRunId("run-1")].loopState).toBe("running");
    expect(state.runs[asRunId("run-1")].stages.a.status).toBe("succeeded");
    expect(state.runs[asRunId("run-1")].stages.b.status).toBe("pending");

    const startB = effects.find(
      (e) => e.type === "START_STAGE" && e.stage.name === "b",
    );
    expect(startB).toBeDefined();
  });
});

describe("pipeline reducer — STAGE_FAILED", () => {
  it("marks the run stalled and freezes remaining stages", () => {
    const pipeline = makePipeline({
      stages: [makeStage("a"), makeStage("b")],
      maxConcurrentStages: 1,
    });
    const triggered = fireTrigger(emptyEngineState(), { pipeline });
    const started = reduce(triggered.state, {
      type: "STAGE_STARTED",
      now: NOW + 1,
      runId: asRunId("run-1"),
      stageName: "a",
    });
    const { state, effects } = reduce(started.state, {
      type: "STAGE_FAILED",
      now: NOW + 2,
      runId: asRunId("run-1"),
      stageName: "a",
      errorMessage: "boom",
    });

    expect(state.runs[asRunId("run-1")].loopState).toBe("stalled");
    expect(state.runs[asRunId("run-1")].terminationReason).toBe("stage_failure");
    expect(state.runs[asRunId("run-1")].stages.a.status).toBe("failed");
    expect(state.runs[asRunId("run-1")].stages.b.status).toBe("skipped");

    const obs = effects
      .filter((e) => e.type === "EMIT_OBSERVATION")
      .map((e) => (e.type === "EMIT_OBSERVATION" ? e.event.name : ""));
    expect(obs).toContain("pipeline.run.terminated");
  });
});

describe("pipeline reducer — NEW_SHA_DETECTED", () => {
  it("terminates an in-flight run as outdated and emits CANCEL_STAGE for running stages", () => {
    const triggered = fireTrigger(emptyEngineState());
    const started = reduce(triggered.state, {
      type: "STAGE_STARTED",
      now: NOW + 1,
      runId: asRunId("run-1"),
      stageName: "review",
    });
    const { state, effects } = reduce(started.state, {
      type: "NEW_SHA_DETECTED",
      now: NOW + 2,
      sessionId: "ses-1",
      pipelineName: "default",
      sha: "sha-bbb",
    });

    expect(state.runs[asRunId("run-1")].loopState).toBe("terminated");
    expect(state.runs[asRunId("run-1")].terminationReason).toBe("outdated");
    expect(state.runs[asRunId("run-1")].stages.review.status).toBe("outdated");
    expect(state.currentRunByLoop[loopKey("ses-1", "default")]).toBeUndefined();

    const cancel = effects.find((e) => e.type === "CANCEL_STAGE");
    expect(cancel).toBeDefined();
  });

  it("ignores when the SHA is unchanged", () => {
    const triggered = fireTrigger(emptyEngineState());
    const { state } = reduce(triggered.state, {
      type: "NEW_SHA_DETECTED",
      now: NOW + 1,
      sessionId: "ses-1",
      pipelineName: "default",
      sha: "sha-aaa",
    });
    expect(state).toEqual(triggered.state);
  });

  it("is a no-op when no run is active for the loop", () => {
    const { state, effects } = reduce(emptyEngineState(), {
      type: "NEW_SHA_DETECTED",
      now: NOW,
      sessionId: "ses-1",
      pipelineName: "default",
      sha: "sha-aaa",
    });
    expect(state).toEqual(emptyEngineState());
    expect(effects).toEqual([]);
  });
});

describe("pipeline reducer — RUN_CANCELLED / CONFIG_CHANGED", () => {
  it("RUN_CANCELLED with manual reason ends the run as terminated", () => {
    const triggered = fireTrigger(emptyEngineState());
    const { state } = reduce(triggered.state, {
      type: "RUN_CANCELLED",
      now: NOW + 1,
      runId: asRunId("run-1"),
      reason: "manual_cancel",
    });
    expect(state.runs[asRunId("run-1")].loopState).toBe("terminated");
    expect(state.runs[asRunId("run-1")].terminationReason).toBe("manual_cancel");
  });

  it("RUN_CANCELLED on already-terminal run is rejected", () => {
    const triggered = fireTrigger(emptyEngineState());
    const cancelled = reduce(triggered.state, {
      type: "RUN_CANCELLED",
      now: NOW + 1,
      runId: asRunId("run-1"),
      reason: "manual_cancel",
    });
    const dup = reduce(cancelled.state, {
      type: "RUN_CANCELLED",
      now: NOW + 2,
      runId: asRunId("run-1"),
      reason: "manual_cancel",
    });
    const obs = dup.effects.find(
      (e) => e.type === "EMIT_OBSERVATION" && e.event.name === "pipeline.invalid_transition",
    );
    expect(obs).toBeDefined();
  });

  it("CONFIG_CHANGED terminates the active run with config_change", () => {
    const triggered = fireTrigger(emptyEngineState());
    const { state } = reduce(triggered.state, {
      type: "CONFIG_CHANGED",
      now: NOW + 1,
      sessionId: "ses-1",
      pipelineName: "default",
    });
    expect(state.runs[asRunId("run-1")].loopState).toBe("terminated");
    expect(state.runs[asRunId("run-1")].terminationReason).toBe("config_change");
  });
});

describe("pipeline reducer — RUN_RESUMED", () => {
  function failStage(state: EngineState, runId: RunId, stageName: string): EngineState {
    const started = reduce(state, {
      type: "STAGE_STARTED",
      now: NOW + 1,
      runId,
      stageName,
    });
    const failed = reduce(started.state, {
      type: "STAGE_FAILED",
      now: NOW + 2,
      runId,
      stageName,
      errorMessage: "boom",
    });
    return failed.state;
  }

  it("re-arms a stalled run: failed stage → pending with fresh stageRunId, loop → running", () => {
    const triggered = fireTrigger(emptyEngineState());
    const stalled = failStage(triggered.state, asRunId("run-1"), "review");
    expect(stalled.runs[asRunId("run-1")].loopState).toBe("stalled");

    const { state, effects } = reduce(stalled, {
      type: "RUN_RESUMED",
      now: NOW + 3,
      runId: asRunId("run-1"),
      stageRunIds: { review: asStageRunId("sr-resume-1") },
    });

    const run = state.runs[asRunId("run-1")];
    expect(run.loopState).toBe("running");
    expect(run.terminationReason).toBeUndefined();
    expect(run.stages.review.status).toBe("pending");
    expect(run.stages.review.attempt).toBe(2);
    expect(run.stages.review.stageRunId).toBe("sr-resume-1");
    expect(run.stages.review.errorMessage).toBeUndefined();

    const types = effects.map((e) => e.type);
    expect(types).toContain("PERSIST_RUN");
    expect(types).toContain("PERSIST_LOOP_STATE");
    expect(types).toContain("START_STAGE");
    const obs = effects.find(
      (e) => e.type === "EMIT_OBSERVATION" && e.event.name === "pipeline.run.resumed",
    );
    expect(obs).toBeDefined();
  });

  it("rejects RUN_RESUMED that would exceed stage.retries", () => {
    const pipeline = makePipeline({
      stages: [makeStage("review", { retries: 0 })], // 0 retries → cap at 1 attempt
    });
    const triggered = fireTrigger(emptyEngineState(), { pipeline });
    const stalled = failStage(triggered.state, asRunId("run-1"), "review");
    // attempt is currently 1; retries=0 means cap is 1. Resume would bump to 2 → reject.

    const { state, effects } = reduce(stalled, {
      type: "RUN_RESUMED",
      now: NOW + 3,
      runId: asRunId("run-1"),
      stageRunIds: { review: asStageRunId("sr-resume-1") },
    });

    expect(state.runs[asRunId("run-1")].stages.review.status).toBe("failed");
    expect(state.runs[asRunId("run-1")].loopState).toBe("stalled");
    const obs = effects.find(
      (e) => e.type === "EMIT_OBSERVATION" && e.event.name === "pipeline.invalid_transition",
    );
    expect(obs).toBeDefined();
  });

  it("rejects RUN_RESUMED on unknown runId", () => {
    const { state, effects } = reduce(emptyEngineState(), {
      type: "RUN_RESUMED",
      now: NOW,
      runId: asRunId("missing"),
      stageRunIds: {},
    });
    expect(state).toEqual(emptyEngineState());
    const obs = effects.find(
      (e) => e.type === "EMIT_OBSERVATION" && e.event.name === "pipeline.invalid_transition",
    );
    expect(obs).toBeDefined();
  });
});

describe("pipeline reducer — purity", () => {
  it("does not mutate the input state on TRIGGER_FIRED", () => {
    const initial = emptyEngineState();
    const snapshot = JSON.parse(JSON.stringify(initial));
    fireTrigger(initial);
    expect(initial).toEqual(snapshot);
  });

  it("does not call Date.now() (events provide `now`)", () => {
    const realNow = Date.now;
    let called = 0;
    Date.now = () => {
      called += 1;
      return 0;
    };
    try {
      fireTrigger(emptyEngineState());
    } finally {
      Date.now = realNow;
    }
    expect(called).toBe(0);
  });
});

describe("pipeline reducer — loopRounds", () => {
  it("increments loopRounds when a continuation trigger fires after a prior run", () => {
    const first = fireTrigger(emptyEngineState());
    const started = reduce(first.state, {
      type: "STAGE_STARTED",
      now: NOW + 5,
      runId: asRunId("run-1"),
      stageName: "review",
    });
    const completed = reduce(started.state, {
      type: "STAGE_COMPLETED",
      now: NOW + 10,
      runId: asRunId("run-1"),
      stageName: "review",
      artifacts: [],
    });
    const second = fireTrigger(completed.state, {
      runId: asRunId("run-2"),
      trigger: "pr.updated",
      now: NOW + 100,
    });
    expect(second.state.runs[asRunId("run-2")].loopRounds).toBe(2);
  });

  it("does not increment on the first run for a loop", () => {
    const first = fireTrigger(emptyEngineState());
    expect(first.state.runs[asRunId("run-1")].loopRounds).toBe(1);
  });
});
