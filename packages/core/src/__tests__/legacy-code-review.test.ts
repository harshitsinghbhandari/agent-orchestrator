/**
 * Tests for the legacy `codeReview:` → single-stage pipeline migration shim
 * (issue #193).
 *
 * Covers:
 *   - Synthesis of the `legacy-code-review` pipeline from a `codeReview:` block.
 *   - Hard error when both `codeReview:` and `pipelines:` are present.
 *   - Fingerprint scoping (stage = `review`) — the property that lets prior
 *     dismissals carry forward to post-migration artifacts.
 *   - `migrateStore` idempotency.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateConfig } from "../config.js";
import {
  LEGACY_CODE_REVIEW_PIPELINE_NAME,
  LEGACY_CODE_REVIEW_STAGE_NAME,
  synthesizeLegacyCodeReviewPipeline,
} from "../config-schema.js";
import {
  asPipelineId,
  asRunId,
  asStageRunId,
  computeFindingFingerprint,
  createPipelineStore,
  migrateStore,
  type Artifact,
  type Pipeline,
  type RunState,
} from "../pipeline/index.js";

// ============================================================================
// Synthesis
// ============================================================================

describe("legacy codeReview shim — synthesis", () => {
  it("synthesizes a single-stage `legacy-code-review` pipeline with the locked shape", () => {
    const pipeline = synthesizeLegacyCodeReviewPipeline({});

    expect(pipeline.name).toBe(LEGACY_CODE_REVIEW_PIPELINE_NAME);
    expect(pipeline.stages).toHaveLength(1);

    const stage = pipeline.stages[0];
    expect(stage.name).toBe(LEGACY_CODE_REVIEW_STAGE_NAME);
    expect(stage.trigger.on).toEqual(["pr.opened", "pr.updated"]);
    expect(stage.executor.kind).toBe("agent");
    if (stage.executor.kind !== "agent") throw new Error("non-agent executor");
    expect(stage.executor.mode).toBe("review");
    expect(stage.executor.plugin).toBe("claude-code");
  });

  it("respects agent / model / prompt overrides from the legacy block", () => {
    const pipeline = synthesizeLegacyCodeReviewPipeline({
      agent: "codex",
      model: "o4",
      prompt: "Review for security issues only.",
    });

    const stage = pipeline.stages[0];
    if (stage.executor.kind !== "agent") throw new Error("non-agent executor");
    expect(stage.executor.plugin).toBe("codex");
    expect(stage.executor.config).toEqual({ model: "o4" });
    expect(stage.task.prompt).toBe("Review for security issues only.");
  });

  it("installs the synthesized pipeline under project.pipelines at config load", () => {
    const config = validateConfig({
      projects: {
        web: {
          path: "/repos/web",
          repo: "acme/web",
          codeReview: { agent: "claude-code" },
          storageKey: "storage-web",
        },
      },
    });

    const project = config.projects["web"];
    expect(project.pipelines).toBeDefined();
    expect(Object.keys(project.pipelines ?? {})).toEqual([
      LEGACY_CODE_REVIEW_PIPELINE_NAME,
    ]);

    // `codeReview:` is stripped after synthesis — downstream only sees `pipelines:`.
    expect((project as { codeReview?: unknown }).codeReview).toBeUndefined();

    const synthesized = project.pipelines?.[LEGACY_CODE_REVIEW_PIPELINE_NAME];
    expect(synthesized?.stages[0]?.name).toBe(LEGACY_CODE_REVIEW_STAGE_NAME);
  });
});

// ============================================================================
// Conflict check
// ============================================================================

describe("legacy codeReview shim — conflict with pipelines:", () => {
  it("hard-errors when a project defines both `codeReview:` and `pipelines:`", () => {
    const raw = {
      projects: {
        web: {
          path: "/repos/web",
          repo: "acme/web",
          storageKey: "storage-web",
          codeReview: { agent: "claude-code" },
          pipelines: {
            review: {
              stages: [
                {
                  name: "review",
                  trigger: { on: ["pr.opened"] },
                  executor: { kind: "agent", plugin: "claude-code", mode: "review" },
                  task: { prompt: "review" },
                },
              ],
            },
          },
        },
      },
    };

    expect(() => validateConfig(raw)).toThrow(
      /defines both `codeReview:` and `pipelines:`/,
    );
  });

  it("does NOT error when `pipelines:` is present but `codeReview:` is absent", () => {
    expect(() =>
      validateConfig({
        projects: {
          web: {
            path: "/repos/web",
            repo: "acme/web",
            storageKey: "storage-web",
            pipelines: {
              review: {
                stages: [
                  {
                    name: "review",
                    trigger: { on: ["pr.opened"] },
                    executor: { kind: "agent", plugin: "claude-code", mode: "review" },
                    task: { prompt: "review" },
                  },
                ],
              },
            },
          },
        },
      }),
    ).not.toThrow();
  });
});

// ============================================================================
// Fingerprint scoping & migrateStore
// ============================================================================

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "migrate-store-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makePipeline(): Pipeline {
  return {
    id: asPipelineId(LEGACY_CODE_REVIEW_PIPELINE_NAME),
    name: LEGACY_CODE_REVIEW_PIPELINE_NAME,
    stages: [
      {
        name: LEGACY_CODE_REVIEW_STAGE_NAME,
        trigger: { on: ["pr.opened", "pr.updated"] },
        executor: { kind: "agent", plugin: "claude-code", mode: "review" },
        task: {},
      },
    ],
    maxConcurrentStages: 1,
  };
}

function makeRun(): RunState {
  return {
    runId: asRunId("run-1"),
    pipelineId: asPipelineId(LEGACY_CODE_REVIEW_PIPELINE_NAME),
    pipelineName: LEGACY_CODE_REVIEW_PIPELINE_NAME,
    sessionId: "ses-1",
    pipelineConfigSnapshot: makePipeline(),
    headSha: "sha-aaa",
    loopState: "running",
    loopRounds: 1,
    stages: {
      [LEGACY_CODE_REVIEW_STAGE_NAME]: {
        stageRunId: asStageRunId("sr-1"),
        status: "succeeded",
        attempt: 1,
        artifacts: [],
      },
    },
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
  };
}

function makeFinding(
  artifactId: string,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    kind: "finding",
    filePath: "src/auth.ts",
    startLine: 10,
    endLine: 20,
    title: "Missing input validation",
    description: "Validate the token format before parsing.",
    category: "security",
    severity: "warning",
    confidence: 0.8,
    anchorSignature: "verifyToken",
    artifactId: artifactId as Artifact["artifactId"],
    pipelineRunId: asRunId("run-1"),
    stageRunId: asStageRunId("sr-1"),
    stageName: LEGACY_CODE_REVIEW_STAGE_NAME,
    status: "open",
    createdAt: "2026-05-04T00:00:00.000Z",
    ...overrides,
  } as Artifact;
}

describe("computeFindingFingerprint", () => {
  it("scopes the fingerprint by stage name so the same finding under a different stage hashes differently", () => {
    const finding = makeFinding("a-1");
    const a = computeFindingFingerprint(
      finding as Artifact & { kind: "finding" },
      "review",
    );
    const b = computeFindingFingerprint(
      finding as Artifact & { kind: "finding" },
      "audit",
    );
    expect(a).not.toBe(b);
  });

  it("is stable across calls with the same inputs", () => {
    const finding = makeFinding("a-1");
    const a = computeFindingFingerprint(
      finding as Artifact & { kind: "finding" },
      "review",
    );
    const b = computeFindingFingerprint(
      finding as Artifact & { kind: "finding" },
      "review",
    );
    expect(a).toBe(b);
  });
});

describe("migrateStore", () => {
  it("backfills missing fingerprints on findings, scoped by their stage name", () => {
    const store = createPipelineStore(root);
    const run = makeRun();
    store.saveRun(run);
    const a = makeFinding("a-1");
    const b = makeFinding("a-2", { startLine: 50, endLine: 55, title: "Another issue" });
    store.appendArtifacts(run.runId, asStageRunId("sr-1"), [a, b]);

    const result = migrateStore(store);

    expect(result.migrated).toBe(2);
    expect(result.filesRewritten).toBe(1);

    const migrated = store.listArtifacts(run.runId, asStageRunId("sr-1"));
    expect(migrated).toHaveLength(2);
    for (const artifact of migrated) {
      if (artifact.kind !== "finding") throw new Error("expected finding");
      expect(artifact.fingerprint).toBeDefined();
      expect(artifact.fingerprint).toBe(
        computeFindingFingerprint(artifact, LEGACY_CODE_REVIEW_STAGE_NAME),
      );
    }
  });

  it("is idempotent — a second run is a no-op", () => {
    const store = createPipelineStore(root);
    const run = makeRun();
    store.saveRun(run);
    store.appendArtifacts(run.runId, asStageRunId("sr-1"), [makeFinding("a-1")]);

    const first = migrateStore(store);
    expect(first.migrated).toBe(1);

    const before = store.listArtifacts(run.runId, asStageRunId("sr-1"));
    const second = migrateStore(store);
    const after = store.listArtifacts(run.runId, asStageRunId("sr-1"));

    expect(second.migrated).toBe(0);
    expect(second.filesRewritten).toBe(0);
    expect(after).toEqual(before);
  });

  it("preserves fingerprints already set — carries forward dismissals across migration", () => {
    const store = createPipelineStore(root);
    const run = makeRun();
    store.saveRun(run);
    const pre = computeFindingFingerprint(
      makeFinding("a-1") as Artifact & { kind: "finding" },
      LEGACY_CODE_REVIEW_STAGE_NAME,
    );
    store.appendArtifacts(run.runId, asStageRunId("sr-1"), [
      makeFinding("a-1", { fingerprint: pre, status: "dismissed" }),
    ]);

    const result = migrateStore(store);
    expect(result.migrated).toBe(0);

    const after = store.listArtifacts(run.runId, asStageRunId("sr-1"));
    expect(after).toHaveLength(1);
    if (after[0].kind !== "finding") throw new Error("expected finding");
    expect(after[0].fingerprint).toBe(pre);
    expect(after[0].status).toBe("dismissed");
  });

  it("leaves JSON artifacts untouched (no fingerprint scheme for non-finding kinds)", () => {
    const store = createPipelineStore(root);
    const run = makeRun();
    store.saveRun(run);
    const jsonArtifact: Artifact = {
      kind: "json",
      data: { score: 0.5 },
      artifactId: "j-1" as Artifact["artifactId"],
      pipelineRunId: asRunId("run-1"),
      stageRunId: asStageRunId("sr-1"),
      stageName: LEGACY_CODE_REVIEW_STAGE_NAME,
      status: "open",
      createdAt: "2026-05-04T00:00:00.000Z",
    } as Artifact;
    store.appendArtifacts(run.runId, asStageRunId("sr-1"), [jsonArtifact]);

    const result = migrateStore(store);
    expect(result.migrated).toBe(0);
    expect(store.listArtifacts(run.runId, asStageRunId("sr-1"))).toEqual([jsonArtifact]);
  });

  it("reports zero migrated when the store is empty", () => {
    const store = createPipelineStore(root);
    const result = migrateStore(store);
    expect(result.migrated).toBe(0);
    expect(result.filesRewritten).toBe(0);
    expect(result.message).toMatch(/already migrated/);
  });
});
