/**
 * Typed Predicate DSL coverage (issue #196):
 *  - Per-kind evaluation against a minimal `PredicateCtx`.
 *  - and/or/not composition, with short-circuit / nested behavior.
 *  - Back-compat: legacy `StageRoutePredicate` shapes evaluate as the
 *    equivalent typed predicate.
 *  - `v0_default` evaluates to `false` (so reducer falls back to v0 rules).
 *  - `predicateReferencedStages` walks recursive predicates correctly.
 */

import { describe, expect, it } from "vitest";

import {
  evaluate,
  isV0Default,
  predicateReferencedStages,
} from "../pipeline/predicate-evaluator.js";
import {
  asArtifactId,
  asPipelineId,
  asRunId,
  asStageRunId,
  type Artifact,
  type Predicate,
  type PredicateCtx,
  type RunState,
  type StageStatus,
  type Verdict,
} from "../pipeline/index.js";

function makeRun(
  stageSpecs: Array<{ name: string; status: StageStatus; verdict?: Verdict; attempt?: number }>,
  overrides: Partial<RunState> = {},
): RunState {
  const stages: RunState["stages"] = {};
  for (const spec of stageSpecs) {
    stages[spec.name] = {
      stageRunId: asStageRunId(`sr-${spec.name}`),
      status: spec.status,
      attempt: spec.attempt ?? 1,
      ...(spec.verdict !== undefined ? { verdict: spec.verdict } : {}),
      artifacts: [],
    };
  }
  return {
    runId: asRunId("run-1"),
    pipelineId: asPipelineId("pl-1"),
    pipelineName: "default",
    sessionId: "ses-1",
    pipelineConfigSnapshot: {
      id: asPipelineId("pl-1"),
      name: "default",
      stages: [],
    },
    headSha: "sha-aaa",
    loopState: "running",
    loopRounds: 1,
    stages,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeFinding(
  overrides: Partial<Artifact> & { stageName?: string } = {},
): Artifact {
  return {
    artifactId: asArtifactId("art-1"),
    pipelineRunId: asRunId("run-1"),
    stageRunId: asStageRunId("sr-review"),
    stageName: overrides.stageName ?? "review",
    kind: "finding",
    filePath: "src/x.ts",
    startLine: 1,
    endLine: 2,
    title: "Finding",
    description: "...",
    category: "general",
    severity: "warning",
    confidence: 0.7,
    status: "open",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  } as Artifact;
}

function ctx(run: RunState, findings: Artifact[] = []): PredicateCtx {
  return { run, history: [], findings };
}

describe("predicate evaluator — stage-set kinds", () => {
  it("all_pass: true only when every listed stage succeeded", () => {
    const run = makeRun([
      { name: "a", status: "succeeded" },
      { name: "b", status: "succeeded" },
      { name: "c", status: "skipped" },
    ]);
    expect(evaluate({ kind: "all_pass", stages: ["a", "b"] }, ctx(run))).toBe(true);
    expect(evaluate({ kind: "all_pass", stages: ["a", "b", "c"] }, ctx(run))).toBe(false);
  });

  it("any_pass: true when any listed stage succeeded", () => {
    const run = makeRun([
      { name: "a", status: "failed" },
      { name: "b", status: "succeeded" },
    ]);
    expect(evaluate({ kind: "any_pass", stages: ["a", "b"] }, ctx(run))).toBe(true);
    expect(evaluate({ kind: "any_pass", stages: ["a"] }, ctx(run))).toBe(false);
  });

  it("majority_pass: strict majority (>50%) of listed stages succeeded", () => {
    const run = makeRun([
      { name: "a", status: "succeeded" },
      { name: "b", status: "succeeded" },
      { name: "c", status: "failed" },
    ]);
    expect(evaluate({ kind: "majority_pass", stages: ["a", "b", "c"] }, ctx(run))).toBe(true);
    expect(
      evaluate(
        { kind: "majority_pass", stages: ["a", "b", "c", "d"] },
        ctx(makeRun([
          { name: "a", status: "succeeded" },
          { name: "b", status: "succeeded" },
          { name: "c", status: "failed" },
          { name: "d", status: "skipped" },
        ])),
      ),
    ).toBe(false); // 2/4 is not strict majority
    expect(evaluate({ kind: "majority_pass", stages: [] }, ctx(run))).toBe(false);
  });
});

describe("predicate evaluator — verdict and retries", () => {
  it("stage_verdict: matches explicit verdict over inferred", () => {
    const run = makeRun([
      { name: "a", status: "succeeded", verdict: "fail" },
      { name: "b", status: "failed" },
      { name: "c", status: "succeeded" },
    ]);
    expect(evaluate({ kind: "stage_verdict", stage: "a", verdict: "fail" }, ctx(run))).toBe(true);
    expect(evaluate({ kind: "stage_verdict", stage: "a", verdict: "pass" }, ctx(run))).toBe(false);
    // Failed stage with no explicit verdict → effective verdict "fail".
    expect(evaluate({ kind: "stage_verdict", stage: "b", verdict: "fail" }, ctx(run))).toBe(true);
    // Succeeded stage with no explicit verdict → effective verdict "pass".
    expect(evaluate({ kind: "stage_verdict", stage: "c", verdict: "pass" }, ctx(run))).toBe(true);
  });

  it("stage_retried_at_least: matches when attempt >= n", () => {
    const run = makeRun([{ name: "a", status: "failed", attempt: 3 }]);
    expect(evaluate({ kind: "stage_retried_at_least", stage: "a", n: 3 }, ctx(run))).toBe(true);
    expect(evaluate({ kind: "stage_retried_at_least", stage: "a", n: 4 }, ctx(run))).toBe(false);
  });

  it("loop_rounds_at_least: matches when run.loopRounds >= n", () => {
    const run = makeRun([{ name: "a", status: "succeeded" }], { loopRounds: 5 });
    expect(evaluate({ kind: "loop_rounds_at_least", n: 5 }, ctx(run))).toBe(true);
    expect(evaluate({ kind: "loop_rounds_at_least", n: 6 }, ctx(run))).toBe(false);
  });
});

describe("predicate evaluator — finding kinds", () => {
  const run = makeRun([{ name: "review", status: "succeeded" }]);
  const findings = [
    makeFinding({ artifactId: asArtifactId("a1"), severity: "error" }),
    makeFinding({ artifactId: asArtifactId("a2"), severity: "warning" }),
    makeFinding({ artifactId: asArtifactId("a3"), severity: "info" }),
    makeFinding({
      artifactId: asArtifactId("a4"),
      severity: "error",
      status: "dismissed",
    }),
  ];

  it("no_open_findings: counts only open findings", () => {
    expect(evaluate({ kind: "no_open_findings" }, ctx(run, []))).toBe(true);
    expect(evaluate({ kind: "no_open_findings" }, ctx(run, findings))).toBe(false);
  });

  it("no_open_findings (per-stage): scopes to one stage", () => {
    const stageFindings = [
      makeFinding({ stageName: "review", artifactId: asArtifactId("r1") }),
      makeFinding({ stageName: "lint", artifactId: asArtifactId("l1") }),
    ];
    expect(evaluate({ kind: "no_open_findings", stage: "lint" }, ctx(run, stageFindings))).toBe(
      false,
    );
    expect(evaluate({ kind: "no_open_findings", stage: "other" }, ctx(run, stageFindings))).toBe(
      true,
    );
  });

  it("finding_count_below: counts respecting severity filter", () => {
    expect(evaluate({ kind: "finding_count_below", max: 3 }, ctx(run, findings))).toBe(false);
    expect(evaluate({ kind: "finding_count_below", max: 4 }, ctx(run, findings))).toBe(true);
    expect(
      evaluate(
        { kind: "finding_count_below", max: 2, severity: "error" },
        ctx(run, findings),
      ),
    ).toBe(true); // only 1 open error (a4 is dismissed); 1 < 2
    expect(
      evaluate(
        { kind: "finding_count_below", max: 1, severity: "warning" },
        ctx(run, findings),
      ),
    ).toBe(false); // 1 open warning, max=1 is not strictly below
  });
});

describe("predicate evaluator — composition", () => {
  const run = makeRun([
    { name: "a", status: "succeeded" },
    { name: "b", status: "failed" },
  ]);

  it("and: every child must be true", () => {
    expect(
      evaluate(
        {
          kind: "and",
          predicates: [
            { kind: "any_pass", stages: ["a"] },
            { kind: "stage_verdict", stage: "b", verdict: "fail" },
          ],
        },
        ctx(run),
      ),
    ).toBe(true);
    expect(
      evaluate(
        {
          kind: "and",
          predicates: [
            { kind: "any_pass", stages: ["a"] },
            { kind: "stage_verdict", stage: "b", verdict: "pass" },
          ],
        },
        ctx(run),
      ),
    ).toBe(false);
  });

  it("or: any child true is enough", () => {
    expect(
      evaluate(
        {
          kind: "or",
          predicates: [
            { kind: "stage_verdict", stage: "a", verdict: "fail" },
            { kind: "stage_verdict", stage: "b", verdict: "fail" },
          ],
        },
        ctx(run),
      ),
    ).toBe(true);
  });

  it("not: inverts the inner predicate", () => {
    expect(
      evaluate({ kind: "not", predicate: { kind: "any_pass", stages: ["b"] } }, ctx(run)),
    ).toBe(true);
    expect(
      evaluate({ kind: "not", predicate: { kind: "any_pass", stages: ["a"] } }, ctx(run)),
    ).toBe(false);
  });

  it("nested and/or/not: works to arbitrary depth", () => {
    const pred: Predicate = {
      kind: "or",
      predicates: [
        {
          kind: "and",
          predicates: [
            { kind: "all_pass", stages: ["a"] },
            { kind: "not", predicate: { kind: "any_pass", stages: ["b"] } },
          ],
        },
        { kind: "stage_verdict", stage: "b", verdict: "fail" },
      ],
    };
    expect(evaluate(pred, ctx(run))).toBe(true);
  });
});

describe("predicate evaluator — back-compat with legacy 3 route forms", () => {
  const run = makeRun([
    { name: "a", status: "succeeded" },
    { name: "b", status: "failed" },
  ]);

  it("allSucceeded == all_pass", () => {
    expect(evaluate({ kind: "allSucceeded", stages: ["a"] }, ctx(run))).toBe(true);
    expect(evaluate({ kind: "allSucceeded", stages: ["a", "b"] }, ctx(run))).toBe(false);
  });

  it("anySucceeded == any_pass", () => {
    expect(evaluate({ kind: "anySucceeded", stages: ["a", "b"] }, ctx(run))).toBe(true);
    expect(evaluate({ kind: "anySucceeded", stages: ["b"] }, ctx(run))).toBe(false);
  });

  it("anyFailed: matches failed-by-status (no explicit verdict)", () => {
    // b has status=failed (no explicit verdict) — `effectiveVerdict` derives "fail".
    expect(evaluate({ kind: "anyFailed", stages: ["a", "b"] }, ctx(run))).toBe(true);
    expect(evaluate({ kind: "anyFailed", stages: ["a"] }, ctx(run))).toBe(false);
  });
});

describe("predicate evaluator — v0_default and references", () => {
  it("v0_default evaluates to false (reducer detects kind and falls through)", () => {
    const run = makeRun([{ name: "a", status: "succeeded" }]);
    expect(evaluate({ kind: "v0_default" }, ctx(run))).toBe(false);
    expect(isV0Default({ kind: "v0_default" })).toBe(true);
    expect(isV0Default({ kind: "all_pass", stages: ["a"] })).toBe(false);
  });

  it("predicateReferencedStages walks the tree and dedups", () => {
    const pred: Predicate = {
      kind: "and",
      predicates: [
        { kind: "all_pass", stages: ["a", "b"] },
        { kind: "or", predicates: [{ kind: "stage_verdict", stage: "b", verdict: "fail" }] },
        { kind: "not", predicate: { kind: "stage_retried_at_least", stage: "c", n: 2 } },
        { kind: "no_open_findings", stage: "d" },
        { kind: "loop_rounds_at_least", n: 1 },
      ],
    };
    expect(predicateReferencedStages(pred).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("predicateReferencedStages handles legacy shapes at the top level", () => {
    expect(predicateReferencedStages({ kind: "anyFailed", stages: ["x", "y"] }).sort()).toEqual([
      "x",
      "y",
    ]);
  });
});
