/**
 * Coverage for the v2 reducer events that back the Pipeline Workbench:
 * ARTIFACT_STATUS_CHANGED, USER_FOLLOWUP, FOLLOWUP_REPLY.
 *
 * Pure reducer assertions only — no engine, no store I/O. Web-side effect
 * routing lives in packages/web/src/lib/pipelines.ts and is covered by the
 * component tests.
 */
import { describe, expect, it } from "vitest";

import {
  asPipelineId,
  asRunId,
  asStageRunId,
  emptyEngineState,
  reduce,
  type EngineState,
  type Pipeline,
  type PipelineEvent,
  type ArtifactId,
  type StageRunId,
} from "../pipeline/index.js";

const NOW = 1_700_000_000_000;

function makePipeline(): Pipeline {
  return {
    id: asPipelineId("pl-1"),
    name: "default",
    stages: [
      {
        name: "review",
        trigger: { on: ["pr.opened"] },
        executor: { kind: "agent", plugin: "codex", mode: "review" },
        task: { prompt: "review" },
      },
    ],
    maxConcurrentStages: 1,
  };
}

function bootstrapRunWithFinding(): EngineState {
  const runId = asRunId("run-1");
  const stageRunIds = { review: asStageRunId("sr-1") };
  const trigger: PipelineEvent = {
    type: "TRIGGER_FIRED",
    now: NOW,
    trigger: "pr.opened",
    sessionId: "ses-1",
    pipeline: makePipeline(),
    headSha: "sha-aaa",
    runId,
    stageRunIds,
  };
  const after = reduce(emptyEngineState(), trigger).state;
  const started = reduce(after, {
    type: "STAGE_STARTED",
    now: NOW,
    runId,
    stageName: "review",
  });
  const finished = reduce(started.state, {
    type: "STAGE_COMPLETED",
    now: NOW,
    runId,
    stageName: "review",
    verdict: "neutral",
    artifacts: [
      {
        kind: "finding",
        filePath: "src/foo.ts",
        startLine: 5,
        endLine: 7,
        title: "use const",
        description: "...",
        category: "style",
        severity: "info",
        confidence: 0.8,
      },
    ],
  });
  return finished.state;
}

describe("pipeline reducer — v2 workbench events", () => {
  it("ARTIFACT_STATUS_CHANGED emits UPDATE_ARTIFACT_STATUS + PERSIST_RUN and mirrors run.findings", () => {
    const state = bootstrapRunWithFinding();
    const run = Object.values(state.runs)[0];
    const finding = run.findings?.[0];
    expect(finding?.status).toBe("open");
    const result = reduce(state, {
      type: "ARTIFACT_STATUS_CHANGED",
      now: NOW + 1,
      runId: run.runId,
      stageRunId: run.stages.review.stageRunId,
      artifactId: finding!.artifactId as ArtifactId,
      status: "dismissed",
      actor: "app-rev-1",
    });
    const types = result.effects.map((e) => e.type);
    expect(types).toContain("UPDATE_ARTIFACT_STATUS");
    expect(types).toContain("PERSIST_RUN");
    expect(types).toContain("EMIT_OBSERVATION");
    const nextRun = result.state.runs[run.runId];
    expect(nextRun.findings?.[0].status).toBe("dismissed");
  });

  it("USER_FOLLOWUP is rejected on a terminal run", () => {
    const state = bootstrapRunWithFinding();
    const run = Object.values(state.runs)[0];
    // Single-stage pipeline auto-terminates after STAGE_COMPLETED.
    expect(run.loopState).toBe("done");
    const result = reduce(state, {
      type: "USER_FOLLOWUP",
      now: NOW + 1,
      runId: run.runId,
      stageRunId: run.stages.review.stageRunId,
      stageName: "review",
      message: "hi",
    });
    const types = result.effects.map((e) => e.type);
    expect(types).toContain("EMIT_OBSERVATION");
    expect(types).not.toContain("APPEND_THREAD_MESSAGE");
    expect(types).not.toContain("SEND_FOLLOWUP");
  });

  it("USER_FOLLOWUP on a running run emits APPEND_THREAD_MESSAGE + SEND_FOLLOWUP + observation", () => {
    const runId = asRunId("run-2");
    const stageRunIds: Record<string, StageRunId> = {
      a: asStageRunId("sr-a"),
      b: asStageRunId("sr-b"),
    };
    const pipeline: Pipeline = {
      ...makePipeline(),
      stages: [
        {
          name: "a",
          trigger: { on: ["pr.opened"] },
          executor: { kind: "agent", plugin: "codex", mode: "review" },
          task: { prompt: "a" },
        },
        {
          name: "b",
          trigger: { on: ["pr.opened"] },
          executor: { kind: "agent", plugin: "codex", mode: "review" },
          task: { prompt: "b" },
          dependsOn: ["a"],
        },
      ],
    };
    const after = reduce(emptyEngineState(), {
      type: "TRIGGER_FIRED",
      now: NOW,
      trigger: "pr.opened",
      sessionId: "ses-2",
      pipeline,
      headSha: "sha-xx",
      runId,
      stageRunIds,
    }).state;
    const result = reduce(after, {
      type: "USER_FOLLOWUP",
      now: NOW + 1,
      runId,
      stageRunId: stageRunIds.a,
      stageName: "a",
      message: "more context please",
      reviewerId: "ses-rev-1",
    });
    const types = result.effects.map((e) => e.type);
    expect(types).toContain("APPEND_THREAD_MESSAGE");
    expect(types).toContain("SEND_FOLLOWUP");
    expect(types).toContain("EMIT_OBSERVATION");
  });

  it("FOLLOWUP_REPLY appends the agent message to the thread", () => {
    const state = bootstrapRunWithFinding();
    const run = Object.values(state.runs)[0];
    const result = reduce(state, {
      type: "FOLLOWUP_REPLY",
      now: NOW + 2,
      runId: run.runId,
      stageRunId: run.stages.review.stageRunId,
      stageName: "review",
      reply: "ack",
    });
    const append = result.effects.find((e) => e.type === "APPEND_THREAD_MESSAGE");
    if (append?.type !== "APPEND_THREAD_MESSAGE") throw new Error("expected append");
    expect(append.role).toBe("agent");
    expect(append.content).toBe("ack");
  });
});
