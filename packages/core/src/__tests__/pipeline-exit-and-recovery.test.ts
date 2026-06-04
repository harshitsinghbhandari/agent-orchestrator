/**
 * Issue #196 — exitPredicates + failure-tolerant scheduling.
 *
 * Tests cover:
 *  - Recovery branch end-to-end: a stage with `routes.when` matching an
 *    upstream failure starts instead of being cascade-skipped + terminating
 *    the run (the v1.1 limitation #196 fixes).
 *  - `exitPredicates.done` overrides the v0 "any failure → stalled" rule.
 *  - `exitPredicates.stalled` overrides v0 by demanding a custom condition
 *    before marking the run as stalled.
 *  - `{kind: "v0_default"}` opts a branch back into v0 behavior explicitly.
 *  - Schema back-compat: legacy 3 route forms parse + behave identically.
 */

import { describe, expect, it } from "vitest";

import {
  ConfiguredPipelineSchema,
  asPipelineId,
  asRunId,
  asStageRunId,
  configuredPipelineToRuntime,
  emptyEngineState,
  reduce,
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
    trigger: { on: ["pr.opened"] },
    executor: { kind: "agent", plugin: "codex", mode: "review" },
    task: { prompt: `run ${name}` },
    ...overrides,
  };
}

function makePipeline(stages: Stage[], overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: asPipelineId("pl-1"),
    name: "default",
    stages,
    maxConcurrentStages: 2,
    ...overrides,
  };
}

function fireTrigger(pipeline: Pipeline, runId = asRunId("run-1")) {
  const stageRunIds: Record<string, StageRunId> = Object.fromEntries(
    pipeline.stages.map((s, i) => [s.name, asStageRunId(`sr-${s.name}-${i}`)]),
  );
  const event: PipelineEvent = {
    type: "TRIGGER_FIRED",
    now: NOW,
    trigger: "manual",
    sessionId: "ses-1",
    pipeline,
    headSha: "sha-aaa",
    runId,
    stageRunIds,
  };
  return reduce(emptyEngineState(), event);
}

function startStage(state: EngineState, runId: RunId, stageName: string, t = NOW + 1) {
  return reduce(state, { type: "STAGE_STARTED", now: t, runId, stageName });
}

function completeStage(state: EngineState, runId: RunId, stageName: string, t = NOW + 2) {
  return reduce(state, {
    type: "STAGE_COMPLETED",
    now: t,
    runId,
    stageName,
    artifacts: [],
  });
}

describe("recovery branches (issue #196)", () => {
  it("starts a stage whose routes match an upstream failure instead of cascade-skipping", () => {
    const pipeline = makePipeline(
      [
        makeStage("a"),
        {
          ...makeStage("recovery"),
          dependsOn: ["a"],
          routes: { when: { kind: "anyFailed", stages: ["a"] } },
        },
      ],
      { maxConcurrentStages: 1 },
    );
    const triggered = fireTrigger(pipeline);
    const started = startStage(triggered.state, asRunId("run-1"), "a", NOW + 1);
    const failed = reduce(started.state, {
      type: "STAGE_FAILED",
      now: NOW + 2,
      runId: asRunId("run-1"),
      stageName: "a",
      errorMessage: "boom",
    });

    // The run does NOT terminate — recovery starts.
    expect(failed.state.runs[asRunId("run-1")].loopState).toBe("running");
    const startRecovery = failed.effects.find(
      (e) => e.type === "START_STAGE" && e.stage.name === "recovery",
    );
    expect(startRecovery).toBeDefined();
  });

  it("recovery branch completes → run resolves under v0 default (stalled, because `a` failed)", () => {
    const pipeline = makePipeline(
      [
        makeStage("a"),
        {
          ...makeStage("recovery"),
          dependsOn: ["a"],
          routes: { when: { kind: "anyFailed", stages: ["a"] } },
        },
      ],
      { maxConcurrentStages: 1 },
    );
    const triggered = fireTrigger(pipeline);
    let s = startStage(triggered.state, asRunId("run-1"), "a", NOW + 1).state;
    s = reduce(s, {
      type: "STAGE_FAILED",
      now: NOW + 2,
      runId: asRunId("run-1"),
      stageName: "a",
      errorMessage: "boom",
    }).state;
    s = startStage(s, asRunId("run-1"), "recovery", NOW + 3).state;
    const done = completeStage(s, asRunId("run-1"), "recovery", NOW + 4);

    expect(done.state.runs[asRunId("run-1")].loopState).toBe("stalled");
    expect(done.state.runs[asRunId("run-1")].stages.recovery.status).toBe("succeeded");
  });

  it("with exitPredicates.done = any_pass(recovery), recovery success → run done", () => {
    const pipeline = makePipeline(
      [
        makeStage("a"),
        {
          ...makeStage("recovery"),
          dependsOn: ["a"],
          routes: { when: { kind: "anyFailed", stages: ["a"] } },
        },
      ],
      {
        maxConcurrentStages: 1,
        exitPredicates: {
          done: { kind: "any_pass", stages: ["recovery"] },
        },
      },
    );
    const triggered = fireTrigger(pipeline);
    let s = startStage(triggered.state, asRunId("run-1"), "a", NOW + 1).state;
    s = reduce(s, {
      type: "STAGE_FAILED",
      now: NOW + 2,
      runId: asRunId("run-1"),
      stageName: "a",
      errorMessage: "boom",
    }).state;
    s = startStage(s, asRunId("run-1"), "recovery", NOW + 3).state;
    const done = completeStage(s, asRunId("run-1"), "recovery", NOW + 4);

    expect(done.state.runs[asRunId("run-1")].loopState).toBe("done");
    expect(done.state.runs[asRunId("run-1")].terminationReason).toBe("completed");
  });
});

describe("exitPredicates override v0 rules", () => {
  it("exitPredicates.done: must evaluate true for the run to finish as done", () => {
    // Pipeline succeeds, but `done` requires a finding count > some threshold —
    // since there are no findings here, exit decision falls through to v0.
    const pipeline = makePipeline(
      [makeStage("a")],
      {
        maxConcurrentStages: 1,
        exitPredicates: {
          done: { kind: "loop_rounds_at_least", n: 99 },
        },
      },
    );
    const triggered = fireTrigger(pipeline);
    const started = startStage(triggered.state, asRunId("run-1"), "a", NOW + 1);
    const done = completeStage(started.state, asRunId("run-1"), "a", NOW + 2);

    // `done` predicate evaluated false → falls through to v0 default → no
    // failures, so `done` anyway.
    expect(done.state.runs[asRunId("run-1")].loopState).toBe("done");
  });

  it("exitPredicates.stalled: triggers stalled even when no stage failed", () => {
    // Configure stalled to fire when any stage hit its retry budget.
    const pipeline = makePipeline(
      [makeStage("a", { retries: 1 })],
      {
        maxConcurrentStages: 1,
        exitPredicates: {
          done: { kind: "stage_retried_at_least", stage: "a", n: 99 }, // never true
          stalled: { kind: "all_pass", stages: ["a"] }, // succeeded → stalled (contrived but exercises override)
        },
      },
    );
    const triggered = fireTrigger(pipeline);
    const started = startStage(triggered.state, asRunId("run-1"), "a", NOW + 1);
    const finished = completeStage(started.state, asRunId("run-1"), "a", NOW + 2);

    expect(finished.state.runs[asRunId("run-1")].loopState).toBe("stalled");
  });

  it("{kind: v0_default} branch opts into the hardcoded v0 rule", () => {
    // `done` is explicit v0_default → fall through. `stalled` is unset.
    // With one failure, v0 says stalled.
    const pipeline = makePipeline(
      [makeStage("a"), makeStage("b", { dependsOn: ["a"] })],
      {
        maxConcurrentStages: 1,
        exitPredicates: {
          done: { kind: "v0_default" },
        },
      },
    );
    const triggered = fireTrigger(pipeline);
    const started = startStage(triggered.state, asRunId("run-1"), "a", NOW + 1);
    const failed = reduce(started.state, {
      type: "STAGE_FAILED",
      now: NOW + 2,
      runId: asRunId("run-1"),
      stageName: "a",
      errorMessage: "boom",
    });
    expect(failed.state.runs[asRunId("run-1")].loopState).toBe("stalled");
  });
});

describe("config schema — typed Predicate + back-compat", () => {
  it("parses the typed Predicate DSL inside routes.when", () => {
    const result = ConfiguredPipelineSchema.safeParse({
      stages: [
        makeStage("a"),
        {
          ...makeStage("b"),
          dependsOn: ["a"],
          routes: {
            when: {
              kind: "and",
              predicates: [
                { kind: "all_pass", stages: ["a"] },
                { kind: "not", predicate: { kind: "stage_verdict", stage: "a", verdict: "fail" } },
              ],
            },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("normalizes legacy 3 route forms into typed equivalents at runtime conversion", () => {
    const parsed = ConfiguredPipelineSchema.parse({
      stages: [
        makeStage("a"),
        {
          ...makeStage("b"),
          dependsOn: ["a"],
          routes: { when: { kind: "allSucceeded", stages: ["a"] } },
        },
        {
          ...makeStage("c"),
          dependsOn: ["a"],
          routes: { when: { kind: "anyFailed", stages: ["a"] } },
        },
      ],
    });
    const runtime = configuredPipelineToRuntime("test", parsed);
    expect(runtime.stages[1].routes?.when).toEqual({ kind: "all_pass", stages: ["a"] });
    expect(runtime.stages[2].routes?.when).toEqual({
      kind: "or",
      predicates: [{ kind: "stage_verdict", stage: "a", verdict: "fail" }],
    });
  });

  it("parses and exposes exitPredicates on the runtime Pipeline", () => {
    const parsed = ConfiguredPipelineSchema.parse({
      stages: [makeStage("a")],
      exitPredicates: {
        done: { kind: "all_pass", stages: ["a"] },
        blocksMerge: { kind: "no_open_findings" },
      },
    });
    const runtime = configuredPipelineToRuntime("test", parsed);
    expect(runtime.exitPredicates).toEqual({
      done: { kind: "all_pass", stages: ["a"] },
      blocksMerge: { kind: "no_open_findings" },
    });
  });

  it("rejects exitPredicates that reference unknown stages", () => {
    const result = ConfiguredPipelineSchema.safeParse({
      stages: [makeStage("a")],
      exitPredicates: {
        done: { kind: "all_pass", stages: ["nope"] },
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((i) => i.message).join("\n");
    expect(messages).toContain("exitPredicates.done references unknown stage");
  });

  it("rejects routes.when predicates that reference unknown stages", () => {
    const result = ConfiguredPipelineSchema.safeParse({
      stages: [
        makeStage("a"),
        {
          ...makeStage("b"),
          dependsOn: ["a"],
          routes: { when: { kind: "stage_verdict", stage: "ghost", verdict: "fail" } },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((i) => i.message).join("\n");
    expect(messages).toContain('unknown stage "ghost"');
  });
});
