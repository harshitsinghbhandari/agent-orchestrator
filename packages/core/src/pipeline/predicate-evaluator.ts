/**
 * Pure predicate evaluator for the typed Predicate DSL.
 *
 * Used by:
 *  - The DAG scheduler (`dag.ts`) to decide whether a stage's `routes.when`
 *    predicate is satisfied and the stage should run vs skip.
 *  - The reducer (`reducer.ts`) to decide the run's exit state (`done` /
 *    `stalled`) and merge-block status when `pipeline.exitPredicates` is
 *    configured.
 *
 * Purity: no I/O, no Date.now(), no module-level state. Every input is in
 * `PredicateCtx`. Stages referenced by name are looked up in `ctx.run.stages`;
 * unknown names degrade to `false` for positive checks (we never green-light
 * on missing data) but `not()` flips that to `true` — config validation
 * catches dangling names at load time so the runtime never sees them.
 */

import type {
  AnyPredicate,
  Artifact,
  Predicate,
  PredicateCtx,
  Severity,
  StageState,
  Verdict,
} from "./types.js";

/**
 * Evaluate a predicate against a snapshot context. Returns `true` when the
 * predicate is satisfied. `v0_default` always returns `false` — the reducer
 * detects that kind and falls through to the hardcoded v0 rules instead of
 * relying on this return value.
 */
export function evaluate(predicate: AnyPredicate, ctx: PredicateCtx): boolean {
  const normalized = normalizeLegacy(predicate);
  return evaluateTyped(normalized, ctx);
}

/**
 * Collect every stage name a predicate references. Used by config-load cycle
 * detection and engine-side preflight validation so unknown stages surface
 * before the predicate is ever evaluated at runtime.
 */
export function predicateReferencedStages(predicate: AnyPredicate): string[] {
  const out = new Set<string>();
  visitTyped(normalizeLegacy(predicate), (p) => {
    switch (p.kind) {
      case "all_pass":
      case "any_pass":
      case "majority_pass":
        for (const s of p.stages) out.add(s);
        break;
      case "stage_verdict":
      case "stage_retried_at_least":
        out.add(p.stage);
        break;
      case "no_open_findings":
      case "finding_count_below":
        if (p.stage) out.add(p.stage);
        break;
      default:
        break;
    }
  });
  return [...out];
}

/**
 * `true` when the predicate is `{kind: "v0_default"}` at the top level. The
 * reducer consults this to decide whether the configured branch is asking
 * for the v0 hardcoded rule (e.g. `exitPredicates.done = {kind: "v0_default"}`).
 * Composite predicates that embed `v0_default` inside an `and`/`or`/`not`
 * branch return `false` here — those are treated as ordinary predicates
 * whose `v0_default` leaf evaluates to `false`.
 */
export function isV0Default(predicate: AnyPredicate): boolean {
  return "kind" in predicate && predicate.kind === "v0_default";
}

function evaluateTyped(predicate: Predicate, ctx: PredicateCtx): boolean {
  switch (predicate.kind) {
    case "all_pass":
      return predicate.stages.every((name) => isSucceeded(ctx.run.stages[name]));
    case "any_pass":
      return predicate.stages.some((name) => isSucceeded(ctx.run.stages[name]));
    case "majority_pass": {
      if (predicate.stages.length === 0) return false;
      const passed = predicate.stages.filter((name) => isSucceeded(ctx.run.stages[name])).length;
      return passed * 2 > predicate.stages.length;
    }
    case "no_open_findings":
      return countFindings(ctx.findings, predicate.stage, undefined) === 0;
    case "finding_count_below":
      return countFindings(ctx.findings, predicate.stage, predicate.severity) < predicate.max;
    case "loop_rounds_at_least":
      return ctx.run.loopRounds >= predicate.n;
    case "stage_retried_at_least": {
      const stage = ctx.run.stages[predicate.stage];
      if (!stage) return false;
      return stage.attempt >= predicate.n;
    }
    case "stage_verdict": {
      const stage = ctx.run.stages[predicate.stage];
      if (!stage) return false;
      return effectiveVerdict(stage) === predicate.verdict;
    }
    case "and":
      return predicate.predicates.every((p) => evaluateTyped(p, ctx));
    case "or":
      return predicate.predicates.some((p) => evaluateTyped(p, ctx));
    case "not":
      return !evaluateTyped(predicate.predicate, ctx);
    case "v0_default":
      return false;
  }
}

function visitTyped(predicate: Predicate, fn: (p: Predicate) => void): void {
  fn(predicate);
  if (predicate.kind === "and" || predicate.kind === "or") {
    for (const child of predicate.predicates) visitTyped(child, fn);
  } else if (predicate.kind === "not") {
    visitTyped(predicate.predicate, fn);
  }
}

/**
 * Normalize the legacy 3-kind `StageRoutePredicate` shape into the typed
 * `Predicate` DSL so the evaluator has a single switch to maintain.
 *
 * `allSucceeded` / `anySucceeded` map straight onto `all_pass` / `any_pass`
 * (the legacy semantics were always "status === succeeded"). `anyFailed`
 * maps to `or` of `stage_verdict: fail` per listed stage — `effectiveVerdict`
 * already treats `status === "failed"` as verdict "fail" so the runtime
 * behavior is preserved.
 */
function normalizeLegacy(predicate: AnyPredicate): Predicate {
  if (!("kind" in predicate)) {
    return predicate as Predicate;
  }
  switch (predicate.kind) {
    case "allSucceeded":
      return { kind: "all_pass", stages: predicate.stages };
    case "anySucceeded":
      return { kind: "any_pass", stages: predicate.stages };
    case "anyFailed":
      return {
        kind: "or",
        predicates: predicate.stages.map((stage) => ({
          kind: "stage_verdict",
          stage,
          verdict: "fail",
        })),
      };
    default:
      return predicate as Predicate;
  }
}

function isSucceeded(stage: StageState | undefined): boolean {
  return stage?.status === "succeeded";
}

/**
 * Map a stage's lifecycle status onto a Verdict so `stage_verdict` queries
 * work even for stages that didn't carry an explicit `verdict` field:
 *  - explicit `verdict` always wins
 *  - `succeeded` ⇒ "pass"
 *  - `failed`    ⇒ "fail"
 *  - everything else (pending/running/skipped/outdated) ⇒ "neutral"
 */
function effectiveVerdict(stage: StageState): Verdict {
  if (stage.verdict) return stage.verdict;
  if (stage.status === "succeeded") return "pass";
  if (stage.status === "failed") return "fail";
  return "neutral";
}

function countFindings(
  findings: ReadonlyArray<Artifact>,
  stageName: string | undefined,
  severity: Severity | undefined,
): number {
  let count = 0;
  for (const a of findings) {
    if (a.kind !== "finding") continue;
    if (a.status !== "open") continue;
    if (stageName && a.stageName !== stageName) continue;
    if (severity && a.severity !== severity) continue;
    count += 1;
  }
  return count;
}
