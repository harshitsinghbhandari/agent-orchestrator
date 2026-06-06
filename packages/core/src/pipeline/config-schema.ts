/**
 * Zod schema for `pipelines:` blocks in agent-orchestrator.yaml.
 *
 * Mirrors the runtime Pipeline / Stage types in pipeline/types.ts so that
 * `loadConfig()` can surface configured pipelines to the CLI (`ao pipeline list`,
 * `ao pipeline run`).
 *
 * The PipelineId is derived from the map key used in YAML rather than being
 * spelled in each entry — it's branded at the boundary in
 * `configuredPipelineToRuntime`.
 */

import { z } from "zod";

import { findFirstStageCycle } from "./dag.js";
import { predicateReferencedStages } from "./predicate-evaluator.js";
import {
  asPipelineId,
  DEFAULT_PIPELINE_SCOPE,
  ORCHESTRATOR_TRIGGER_EVENTS,
  WORKSTREAM_TRIGGER_EVENTS,
  type ExitPredicates,
  type Pipeline,
  type PipelineScope,
  type Predicate,
  type Stage,
  type StageExecutor,
  type StageRoutes,
  type StageTriggerEvent,
  type TaskMode,
} from "./types.js";

/** True when pipeline-v3 (orchestrator / workstream scopes) is opted in. */
export function isPipelineV3Enabled(): boolean {
  return process.env["AO_PIPELINE_V3"] === "1";
}

const TaskModeSchema = z.enum(["review", "code", "answer"]);

const StageTriggerSchema = z.object({
  on: z.array(
    z.enum([
      "pr.opened",
      "pr.updated",
      "pr.merge_ready",
      "pr.merged",
      "manual",
      "orchestrator.started",
      "orchestrator.manual",
      "workstream.created",
      "workstream.worker_pr_opened",
      "workstream.worker_pr_updated",
      "workstream.all_pr_opened",
      "workstream.worker_pr_merged",
      "workstream.all_merged",
      "workstream.any_stalled",
      "workstream.manual",
    ]),
  ),
});

const PipelineScopeSchema = z.enum(["worker", "orchestrator", "workstream"]);

const LoopStateNameSchema = z.enum([
  "running",
  "awaiting_context",
  "done",
  "stalled",
  "terminated",
]);

const WorkstreamMemberPRStateSchema = z.enum(["none", "open", "merged", "closed"]);

const AgentExecutorSchema = z.object({
  kind: z.literal("agent"),
  plugin: z.string(),
  mode: TaskModeSchema,
  config: z.record(z.unknown()).optional(),
});

const CommandExecutorSchema = z.object({
  kind: z.literal("command"),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

const BuiltinExecutorSchema = z.object({
  kind: z.literal("builtin"),
  name: z.enum(["router", "compose"]),
  config: z.record(z.unknown()).optional(),
});

const StageExecutorSchema = z.discriminatedUnion("kind", [
  AgentExecutorSchema,
  CommandExecutorSchema,
  BuiltinExecutorSchema,
]);

const TaskSpecSchema = z.object({
  prompt: z.string().optional(),
  outputSchema: z.record(z.unknown()).optional(),
  inputs: z.record(z.unknown()).optional(),
});

const StagePolicySchema = z.object({
  blocksMerge: z.boolean().optional(),
  stallWindow: z.number().int().nonnegative().optional(),
});

const StageBudgetSchema = z.object({
  maxUsd: z.number().nonnegative().optional(),
  maxDurationMs: z.number().int().nonnegative().optional(),
});

const VerdictSchema = z.enum(["pass", "fail", "neutral"]);
const SeveritySchema = z.enum(["error", "warning", "info"]);

/**
 * Recursive Zod schema for the typed `Predicate` DSL plus the legacy three
 * `StageRoutePredicate` shapes. The legacy shapes are accepted at parse
 * time and TRANSFORMED into their typed equivalents — runtime code only
 * ever sees the canonical `Predicate` form coming out of config load.
 *
 * Transformation:
 *  - `allSucceeded` → `all_pass`
 *  - `anySucceeded` → `any_pass`
 *  - `anyFailed`    → `or` of per-stage `stage_verdict: "fail"`
 *
 * `z.lazy` powers the recursion for `and` / `or` / `not`. The discriminator
 * stays on `kind`, but we use `z.union` (not `discriminatedUnion`) because
 * `z.lazy` cannot participate in discriminatedUnion's eager analysis.
 */
const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("all_pass"), stages: z.array(z.string().min(1)).min(1) }),
    z.object({ kind: z.literal("any_pass"), stages: z.array(z.string().min(1)).min(1) }),
    z.object({ kind: z.literal("majority_pass"), stages: z.array(z.string().min(1)).min(1) }),
    z.object({
      kind: z.literal("no_open_findings"),
      stage: z.string().min(1).optional(),
    }),
    z.object({
      kind: z.literal("finding_count_below"),
      max: z.number().int().nonnegative(),
      stage: z.string().min(1).optional(),
      severity: SeveritySchema.optional(),
    }),
    z.object({
      kind: z.literal("loop_rounds_at_least"),
      n: z.number().int().positive(),
    }),
    z.object({
      kind: z.literal("stage_retried_at_least"),
      stage: z.string().min(1),
      n: z.number().int().positive(),
    }),
    z.object({
      kind: z.literal("stage_verdict"),
      stage: z.string().min(1),
      verdict: VerdictSchema,
    }),
    z.object({ kind: z.literal("and"), predicates: z.array(PredicateSchema).min(1) }),
    z.object({ kind: z.literal("or"), predicates: z.array(PredicateSchema).min(1) }),
    z.object({ kind: z.literal("not"), predicate: PredicateSchema }),
    z.object({ kind: z.literal("v0_default") }),
    z.object({
      kind: z.literal("all_workstream_workers_in_state"),
      states: z.array(WorkstreamMemberPRStateSchema).min(1),
    }),
    z.object({
      kind: z.literal("all_workstream_workers_match"),
      pipeline: z.string().min(1),
      loopStates: z.array(LoopStateNameSchema).min(1),
    }),
    z.object({
      kind: z.literal("workstream_member_count"),
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative().optional(),
    }),
  ]),
);

/**
 * Accept either the typed Predicate DSL or one of the legacy three shapes
 * (`allSucceeded` / `anySucceeded` / `anyFailed`). Both are accepted at
 * parse time; the route normalizer below normalizes legacy → typed before
 * the runtime Pipeline is constructed.
 */
const LegacyRoutePredicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allSucceeded"), stages: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("anySucceeded"), stages: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("anyFailed"), stages: z.array(z.string().min(1)).min(1) }),
]);

const RoutePredicateSchema = z.union([PredicateSchema, LegacyRoutePredicateSchema]);

const StageRoutesSchema = z.object({
  when: RoutePredicateSchema,
});

const ExitPredicatesSchema = z.object({
  done: PredicateSchema.optional(),
  stalled: PredicateSchema.optional(),
  blocksMerge: PredicateSchema.optional(),
});

const StageSchema = z.object({
  name: z.string().min(1),
  trigger: StageTriggerSchema,
  executor: StageExecutorSchema,
  task: TaskSpecSchema.default({}),
  policy: StagePolicySchema.optional(),
  budget: StageBudgetSchema.optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
  retries: z.number().int().nonnegative().optional(),
  maxLoopRounds: z.number().int().positive().optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  routes: StageRoutesSchema.optional(),
});

/**
 * Pipeline config without its branded id — id is derived from the YAML map key.
 * `name` defaults to that same key when omitted.
 *
 * Cross-stage validations (unknown `dependsOn`/`routes` references, self-refs,
 * and cycles in the combined `dependsOn`+`routes` graph) run via `superRefine`
 * so they surface alongside the normal Zod errors at config load — operators
 * see one consolidated failure instead of a runtime deadlock later.
 *
 * Cycle detection treats both `dependsOn` and `routes.when.stages` as graph
 * edges because the runtime scheduler waits for both before evaluating a
 * stage (`arePreconditionsTerminal` in dag.ts). A routes-only cycle would
 * otherwise leave every stage in the cycle stuck `pending` forever.
 */
export const ConfiguredPipelineSchema = z
  .object({
    name: z.string().min(1).optional(),
    /**
     * Pipeline-v3 scope (issue #199). Defaults to `"worker"`. Configs that
     * declare `"orchestrator"` or `"workstream"` require `AO_PIPELINE_V3=1`
     * — `configuredPipelineToRuntime` downgrades to `"worker"` when the
     * gate is off so existing v0/v1/v2 configs keep working.
     */
    scope: PipelineScopeSchema.optional(),
    stages: z.array(StageSchema).min(1),
    maxConcurrentStages: z.number().int().positive().optional(),
    exitPredicates: ExitPredicatesSchema.optional(),
  })
  .superRefine((pipeline, ctx) => {
    const stageNames = new Set(pipeline.stages.map((s) => s.name));

    // Duplicate stage names break dependency resolution and the reducer's
    // per-stage state map; reject early with a precise pointer.
    const seen = new Set<string>();
    for (let i = 0; i < pipeline.stages.length; i++) {
      const name = pipeline.stages[i].name;
      if (seen.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", i, "name"],
          message: `Duplicate stage name "${name}" — every stage in a pipeline must have a unique name.`,
        });
      }
      seen.add(name);
    }

    // dependsOn / routes references must point to known stage names.
    for (let i = 0; i < pipeline.stages.length; i++) {
      const stage = pipeline.stages[i];
      for (const dep of stage.dependsOn ?? []) {
        if (!stageNames.has(dep)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["stages", i, "dependsOn"],
            message: `Stage "${stage.name}" depends on unknown stage "${dep}".`,
          });
        }
        if (dep === stage.name) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["stages", i, "dependsOn"],
            message: `Stage "${stage.name}" cannot depend on itself.`,
          });
        }
      }
      const routes = stage.routes;
      if (routes) {
        for (const ref of predicateReferencedStages(routes.when)) {
          if (!stageNames.has(ref)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["stages", i, "routes", "when"],
              message: `Stage "${stage.name}" routes references unknown stage "${ref}".`,
            });
          }
          if (ref === stage.name) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["stages", i, "routes", "when"],
              message: `Stage "${stage.name}" cannot route to itself.`,
            });
          }
        }
      }
    }

    // exitPredicates references must point to known stage names too.
    if (pipeline.exitPredicates) {
      const branches: Array<{ key: keyof ExitPredicates; predicate?: Predicate }> = [
        { key: "done", predicate: pipeline.exitPredicates.done },
        { key: "stalled", predicate: pipeline.exitPredicates.stalled },
        { key: "blocksMerge", predicate: pipeline.exitPredicates.blocksMerge },
      ];
      for (const { key, predicate } of branches) {
        if (!predicate) continue;
        for (const ref of predicateReferencedStages(predicate)) {
          if (!stageNames.has(ref)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["exitPredicates", key],
              message: `exitPredicates.${key} references unknown stage "${ref}".`,
            });
          }
        }
      }
    }

    // Trigger ↔ scope consistency (pipeline-v3, issue #199): orchestrator
    // and workstream triggers can only appear on pipelines whose scope is
    // the matching kind. We do NOT cross-check `worker` against `pr.*`
    // triggers — those have always been the implicit default and remain
    // legal on worker pipelines.
    const declaredScope: PipelineScope = pipeline.scope ?? DEFAULT_PIPELINE_SCOPE;
    for (let i = 0; i < pipeline.stages.length; i++) {
      const stage = pipeline.stages[i];
      for (const evt of stage.trigger.on as StageTriggerEvent[]) {
        if (
          WORKSTREAM_TRIGGER_EVENTS.has(evt) &&
          declaredScope !== "workstream"
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["stages", i, "trigger", "on"],
            message: `Trigger "${evt}" requires \`scope: "workstream"\` on the pipeline.`,
          });
        }
        if (
          ORCHESTRATOR_TRIGGER_EVENTS.has(evt) &&
          declaredScope !== "orchestrator"
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["stages", i, "trigger", "on"],
            message: `Trigger "${evt}" requires \`scope: "orchestrator"\` on the pipeline.`,
          });
        }
      }
    }

    // Cycle detection over the combined dependsOn + routes-refs graph.
    // Iterative DFS; returns the first cycle found in declaration order so
    // the error reads naturally (e.g. "a → b → c → a"). Trivial self-loops
    // (`[X, X]`) are excluded — the explicit self-ref checks above already
    // report those with clearer messages.
    const cycle = findFirstStageCycle(pipeline.stages);
    if (cycle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stages"],
        message: `Pipeline has a stage dependency cycle: ${cycle.join(" → ")}.`,
      });
    }
  });

export type ConfiguredPipeline = z.infer<typeof ConfiguredPipelineSchema>;

export const PipelinesConfigSchema = z.record(z.string().min(1), ConfiguredPipelineSchema);

export type PipelinesConfig = z.infer<typeof PipelinesConfigSchema>;

/** Convert a parsed YAML pipeline entry into a runtime Pipeline (branded id). */
export function configuredPipelineToRuntime(key: string, configured: ConfiguredPipeline): Pipeline {
  const stages = configured.stages.map((stage): Stage => {
    let executor: StageExecutor;
    if (stage.executor.kind === "agent") {
      executor = {
        kind: "agent",
        plugin: stage.executor.plugin,
        mode: stage.executor.mode as TaskMode,
        ...(stage.executor.config !== undefined ? { config: stage.executor.config } : {}),
      };
    } else if (stage.executor.kind === "command") {
      executor = {
        kind: "command",
        command: stage.executor.command,
        ...(stage.executor.args !== undefined ? { args: stage.executor.args } : {}),
        ...(stage.executor.env !== undefined ? { env: stage.executor.env } : {}),
        ...(stage.executor.cwd !== undefined ? { cwd: stage.executor.cwd } : {}),
      };
    } else {
      executor = {
        kind: "builtin",
        name: stage.executor.name,
        ...(stage.executor.config !== undefined ? { config: stage.executor.config } : {}),
      };
    }

    const routes: StageRoutes | undefined = stage.routes
      ? { when: normalizeRoutePredicate(stage.routes.when) }
      : undefined;

    return {
      name: stage.name,
      trigger: { on: [...stage.trigger.on] },
      executor,
      task: { ...stage.task },
      ...(stage.policy ? { policy: { ...stage.policy } } : {}),
      ...(stage.budget ? { budget: { ...stage.budget } } : {}),
      ...(stage.timeoutMs !== undefined ? { timeoutMs: stage.timeoutMs } : {}),
      ...(stage.retries !== undefined ? { retries: stage.retries } : {}),
      ...(stage.maxLoopRounds !== undefined ? { maxLoopRounds: stage.maxLoopRounds } : {}),
      ...(stage.dependsOn !== undefined ? { dependsOn: [...stage.dependsOn] } : {}),
      ...(routes ? { routes } : {}),
    };
  });

  // Pipeline-v3 gate: orchestrator/workstream scopes are opt-in via
  // AO_PIPELINE_V3=1. When the flag is off, declared v3 scopes downgrade
  // to "worker" so existing v0/v1/v2 deployments keep their semantics —
  // the trigger/scope validation above still ran, so configs that mix
  // v3 triggers with the gate off would fail load. Configs that don't
  // touch v3 scopes are unaffected.
  const requestedScope: PipelineScope = configured.scope ?? DEFAULT_PIPELINE_SCOPE;
  const effectiveScope: PipelineScope =
    requestedScope === "worker" || isPipelineV3Enabled() ? requestedScope : "worker";

  return {
    id: asPipelineId(key),
    name: configured.name ?? key,
    ...(effectiveScope !== DEFAULT_PIPELINE_SCOPE ? { scope: effectiveScope } : {}),
    stages,
    ...(configured.maxConcurrentStages !== undefined
      ? { maxConcurrentStages: configured.maxConcurrentStages }
      : {}),
    ...(configured.exitPredicates ? { exitPredicates: { ...configured.exitPredicates } } : {}),
  };
}

/**
 * Normalize a parsed route predicate into the canonical typed `Predicate`
 * DSL. Legacy `StageRoutePredicate` shapes (`allSucceeded`/`anySucceeded`/
 * `anyFailed`) are rewritten into their typed equivalents so the runtime
 * Pipeline only ever holds typed predicates.
 */
function normalizeRoutePredicate(predicate: z.infer<typeof RoutePredicateSchema>): Predicate {
  switch (predicate.kind) {
    case "allSucceeded":
      return { kind: "all_pass", stages: [...predicate.stages] };
    case "anySucceeded":
      return { kind: "any_pass", stages: [...predicate.stages] };
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
      return predicate;
  }
}
