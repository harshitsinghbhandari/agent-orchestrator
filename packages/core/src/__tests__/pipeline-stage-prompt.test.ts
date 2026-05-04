import { describe, expect, it } from "vitest";

import { buildStagePrompt, PIPELINE_FINDINGS_FILENAME, type Stage } from "../pipeline/index.js";

function reviewStage(overrides: Partial<Stage> = {}): Stage {
  return {
    name: "review",
    trigger: { on: ["pr.opened"] },
    executor: { kind: "agent", plugin: "codex", mode: "review" },
    task: { prompt: "review the diff" },
    ...overrides,
  };
}

describe("buildStagePrompt", () => {
  it("includes pipeline / stage / mode / loop round in the header", () => {
    const out = buildStagePrompt({
      pipelineName: "default",
      stage: reviewStage(),
      loopRound: 3,
    });
    expect(out).toContain("Pipeline: default");
    expect(out).toContain("Stage: review");
    expect(out).toContain("Mode: review");
    expect(out).toContain("Loop round: 3");
  });

  it("renders the stage task body when present", () => {
    const out = buildStagePrompt({
      pipelineName: "default",
      stage: reviewStage({ task: { prompt: "look for race conditions" } }),
    });
    expect(out).toContain("look for race conditions");
  });

  it("specs the atomic write contract for the findings file", () => {
    // Regression: the executor harvests on first sight of the final file,
    // so the prompt MUST tell the agent to write a tmp file then rename.
    // A torn jsonl write would otherwise be classified as `failed`.
    const out = buildStagePrompt({
      pipelineName: "default",
      stage: reviewStage(),
    });
    const path = `.ao/${PIPELINE_FINDINGS_FILENAME}`;
    expect(out).toContain(path);
    expect(out).toContain(`${path}.tmp`);
    expect(out.toLowerCase()).toContain("rename");
  });

  it("emits review-shape instructions for mode=review", () => {
    const out = buildStagePrompt({
      pipelineName: "default",
      stage: reviewStage(),
    });
    expect(out).toContain('kind: "finding"');
    expect(out).toContain("severity");
    expect(out).toContain("confidence");
  });

  it("emits json-shape instructions for mode=answer", () => {
    const out = buildStagePrompt({
      pipelineName: "default",
      stage: reviewStage({
        executor: { kind: "agent", plugin: "codex", mode: "answer" },
      }),
    });
    expect(out).toContain('kind: "json"');
    expect(out).toContain("outputSchema");
  });

  it("softens the blocks-merge wording (advisory, not enforcement)", () => {
    const out = buildStagePrompt({
      pipelineName: "default",
      stage: reviewStage({ policy: { blocksMerge: true } }),
    });
    expect(out).toContain("block merge");
    // The stale wording — "fail on critical findings" — implied an
    // engine-side enforcement that doesn't exist. Make sure it's gone.
    expect(out).not.toContain("fail on critical");
  });

  it("includes inputs as a fenced JSON block when present", () => {
    const out = buildStagePrompt({
      pipelineName: "default",
      stage: reviewStage({ task: { prompt: "x", inputs: { focus: "auth" } } }),
    });
    expect(out).toContain("## Inputs");
    expect(out).toContain('"focus": "auth"');
  });
});
