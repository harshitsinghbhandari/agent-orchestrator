/**
 * Pipeline core types — branded IDs, configuration shapes, runtime state,
 * artifacts, and the three-tier exit model (stage / run / loop).
 *
 * v0.1 scope: pure data shapes only. No I/O, no executors. Consumed by the
 * reducer (pipeline/reducer.ts) and the flat-file store (pipeline/store.ts).
 *
 * Design decisions locked from cluster planning (see issue #1627):
 *  - No Agent.executeTask plugin contract; stages run via existing session machinery.
 *  - Findings via convention: stages drop {workspacePath}/.ao/pipeline-findings.jsonl.
 *  - supportedTaskModes is a manifest field on agent plugins, not an interface method.
 *  - maxLoopRounds is per-stage, not pipeline-global.
 *  - maxConcurrentStages defaults to 1 in v0.
 *  - command executor stages are NOT talk-to-able.
 */

// ============================================================================
// Branded IDs
// ============================================================================

export type PipelineId = string & { readonly __brand: "PipelineId" };
export type RunId = string & { readonly __brand: "RunId" };
export type StageRunId = string & { readonly __brand: "StageRunId" };
export type ArtifactId = string & { readonly __brand: "ArtifactId" };

export const asPipelineId = (id: string): PipelineId => id as PipelineId;
export const asRunId = (id: string): RunId => id as RunId;
export const asStageRunId = (id: string): StageRunId => id as StageRunId;
export const asArtifactId = (id: string): ArtifactId => id as ArtifactId;

// ============================================================================
// Pipeline configuration
// ============================================================================

/** Modes an agent plugin advertises in its manifest's `supportedTaskModes` field. */
export type TaskMode = "review" | "code" | "answer";

export type StageTriggerEvent =
  | "pr.opened"
  | "pr.updated"
  | "pr.merge_ready"
  | "pr.merged"
  | "manual";

export interface StageTrigger {
  on: StageTriggerEvent[];
}

export interface AgentExecutor {
  kind: "agent";
  /** Plugin name from the agent slot registry (e.g. "claude-code", "codex"). */
  plugin: string;
  /** Must appear in the plugin manifest's `supportedTaskModes`. */
  mode: TaskMode;
  config?: Record<string, unknown>;
}

export interface CommandExecutor {
  kind: "command";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Working directory relative to the stage workspace. */
  cwd?: string;
}

/**
 * Engine-internal executor. Builtins run inside the engine process — they
 * do not spawn a session or shell out. Today: `router` (delivers upstream
 * findings to the linked worker session) and `compose` (merges upstream
 * artifacts into a single JSON artifact).
 *
 * Builtins must never mutate the pipeline store directly. They return
 * artifacts/observations through the dispatcher's outcome shape, and the
 * engine's normal STAGE_COMPLETED path is the only writer.
 */
export interface BuiltinExecutor {
  kind: "builtin";
  name: "router" | "compose";
  config?: Record<string, unknown>;
}

export type StageExecutor = AgentExecutor | CommandExecutor | BuiltinExecutor;

export interface TaskSpec {
  /** Prompt text injected into the spawned agent session, or main script body for command. */
  prompt?: string;
  /** Optional schema describing the expected JSON outputs of the stage. */
  outputSchema?: Record<string, unknown>;
  /** Free-form named inputs available to the stage. */
  inputs?: Record<string, unknown>;
}

export interface StagePolicy {
  blocksMerge?: boolean;
  /** Convergence window: number of recent runs whose findings must be unchanged. */
  stallWindow?: number;
}

export interface StageBudget {
  maxUsd?: number;
  maxDurationMs?: number;
}

/**
 * Legacy v1.1 hardcoded predicate forms. New configs should use the typed
 * `Predicate` DSL; these three kinds remain accepted at the schema layer and
 * are normalized into their typed equivalents at config load:
 *  - `allSucceeded` → `all_pass`
 *  - `anySucceeded` → `any_pass`
 *  - `anyFailed`    → `or` of `stage_verdict: "fail"` per listed stage
 *
 * Runtime code (reducer, evaluator) handles both shapes so manually
 * constructed `Pipeline` values that still use the legacy shapes keep
 * working without a migration.
 */
export type StageRoutePredicate =
  | { kind: "allSucceeded"; stages: string[] }
  | { kind: "anySucceeded"; stages: string[] }
  | { kind: "anyFailed"; stages: string[] };

/**
 * Typed predicate DSL — the canonical shape for routes activation and the
 * `exitPredicates` (done / stalled / blocksMerge) decisions.
 *
 * Evaluated by `predicate-evaluator.ts` over a `PredicateCtx` of
 * `{ run, history, findings }`. The evaluator is pure (no I/O) so the same
 * predicate can be assessed at scheduling time (dag.ts, with only `run`),
 * at exit time (reducer.ts, with full ctx), or at observation time.
 *
 * Semantics for stage-set predicates (`all_pass`, `any_pass`, `majority_pass`)
 * treat "pass" as `status === "succeeded"`, matching the legacy
 * `allSucceeded`/`anySucceeded` behavior. Verdict-based judgement uses the
 * separate `stage_verdict` kind so the two axes don't collide.
 */
export type Predicate =
  | { kind: "all_pass"; stages: string[] }
  | { kind: "any_pass"; stages: string[] }
  | { kind: "majority_pass"; stages: string[] }
  | { kind: "no_open_findings"; stage?: string }
  | {
      kind: "finding_count_below";
      max: number;
      stage?: string;
      severity?: Severity;
    }
  | { kind: "loop_rounds_at_least"; n: number }
  | { kind: "stage_retried_at_least"; stage: string; n: number }
  | { kind: "stage_verdict"; stage: string; verdict: Verdict }
  | { kind: "and"; predicates: Predicate[] }
  | { kind: "or"; predicates: Predicate[] }
  | { kind: "not"; predicate: Predicate }
  | { kind: "v0_default" };

/**
 * Any predicate shape the engine accepts at runtime — the typed `Predicate`
 * DSL plus the legacy `StageRoutePredicate` forms for back-compat with
 * hand-constructed `Pipeline` values.
 */
export type AnyPredicate = Predicate | StageRoutePredicate;

export interface StageRoutes {
  /** Evaluated once every referenced upstream stage reaches a terminal state. */
  when: AnyPredicate;
}

export interface ExitPredicates {
  /** Run terminates as `done` when this predicate is true after every stage is terminal. */
  done?: Predicate;
  /** Run terminates as `stalled` when this predicate is true after every stage is terminal. */
  stalled?: Predicate;
  /**
   * Engine-level "this run blocks merge". Not enforced inside the reducer;
   * the SCM integration consults the evaluator with the run's current
   * snapshot to decide whether to surface a merge block.
   */
  blocksMerge?: Predicate;
}

export interface Stage {
  name: string;
  trigger: StageTrigger;
  executor: StageExecutor;
  task: TaskSpec;
  policy?: StagePolicy;
  budget?: StageBudget;
  /** ISO 8601 duration string or millisecond count. Engine treats as advisory. */
  timeoutMs?: number;
  retries?: number;
  /** Per-stage loop cap (locked decision: not pipeline-global). */
  maxLoopRounds?: number;
  /**
   * Stage names this stage waits for before it can be evaluated. Default `[]`.
   * The named stages must reach a terminal status before the scheduler
   * considers this stage. Unknown names and cycles are rejected at config load.
   */
  dependsOn?: string[];
  /**
   * Conditional activation predicate. When set and the predicate evaluates to
   * `false` (after every referenced upstream stage is terminal), this stage is
   * marked `skipped` instead of being started. When unset, the default is
   * "all `dependsOn` stages must have succeeded".
   */
  routes?: StageRoutes;
}

export interface Pipeline {
  id: PipelineId;
  name: string;
  stages: Stage[];
  /** Default 1 in v0; engine enforces serial execution when unset. */
  maxConcurrentStages?: number;
  /**
   * Opt-in to running `command`-executor stages for pull requests opened from
   * forks. Defaults to `false`. When `false`, fork-PR command stages are
   * skipped (outcome: `skipped`) before any subprocess is spawned. This is the
   * gate that prevents malicious PRs from executing arbitrary code in CI.
   *
   * Only applies to the `command` executor; `agent` and `builtin` executors
   * are unaffected (they don't shell out untrusted code from the PR).
   */
  allowForkPRs?: boolean;
  /**
   * Optional typed-predicate decisions for run exit and merge blocking. When
   * absent, the reducer falls back to the v0 hardcoded rules ("done" when
   * every stage reached a non-failed terminal status; "stalled" when any
   * stage failed). When any branch is set to `{kind: "v0_default"}`, it
   * explicitly opts into v0 behavior for that branch only.
   */
  exitPredicates?: ExitPredicates;
}

// ============================================================================
// Artifacts
// ============================================================================

export type Severity = "error" | "warning" | "info";

export type ArtifactStatus = "open" | "dismissed" | "sent_to_agent" | "resolved";

export interface FindingArtifactInput {
  kind: "finding";
  filePath: string;
  startLine: number;
  endLine: number;
  title: string;
  description: string;
  /** "security" | "correctness" | "style" | ... | "general". */
  category: string;
  severity: Severity;
  /** 0.0–1.0. */
  confidence: number;
  /** Structural anchor (function/class name) for fingerprint stability. */
  anchorSignature?: string;
}

export interface JsonArtifactInput {
  kind: "json";
  data: Record<string, unknown>;
}

export type ArtifactInput = FindingArtifactInput | JsonArtifactInput;

export type Artifact = ArtifactInput & {
  artifactId: ArtifactId;
  pipelineRunId: RunId;
  stageRunId: StageRunId;
  stageName: string;
  fingerprint?: string;
  status: ArtifactStatus;
  createdAt: string;
  sentToAgentAt?: string;
  /** Reducer-set when finding.confidence < pipeline/stage threshold. */
  belowConfidenceThreshold?: boolean;
};

/** Filename stages drop in {workspacePath}/.ao/ for findings discovery. */
export const PIPELINE_FINDINGS_FILENAME = "pipeline-findings.jsonl";

// ============================================================================
// Three-tier exit model
// ============================================================================
//
// Tier 1 — Stage exit: a single stage execution finishes (StageStatus terminal).
// Tier 2 — Run exit:   a pipeline run terminates (RunTerminationReason).
// Tier 3 — Loop exit:  the persistent per-session loop terminates (LoopState terminal).
//
// Each tier composes upward: a stage exit may cause a run exit, which may cause a
// loop exit. The reducer is the single point that performs these escalations.

export type StageStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "outdated";

export const TERMINAL_STAGE_STATUSES: readonly StageStatus[] = [
  "succeeded",
  "failed",
  "skipped",
  "outdated",
] as const;

export type Verdict = "pass" | "fail" | "neutral";

export type RunTerminationReason =
  | "completed"
  | "stage_failure"
  | "manual_cancel"
  | "config_change"
  | "outdated"
  | "worker_dead";

export type LoopStateName = "running" | "awaiting_context" | "done" | "stalled" | "terminated";

export const TERMINAL_LOOP_STATES: readonly LoopStateName[] = [
  "done",
  "stalled",
  "terminated",
] as const;

export function isTerminalStageStatus(s: StageStatus): boolean {
  return TERMINAL_STAGE_STATUSES.includes(s);
}

export function isTerminalLoopState(s: LoopStateName): boolean {
  return TERMINAL_LOOP_STATES.includes(s);
}

// ============================================================================
// Runtime state
// ============================================================================

export interface StageState {
  stageRunId: StageRunId;
  status: StageStatus;
  attempt: number;
  verdict?: Verdict;
  artifacts: ArtifactId[];
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface RunState {
  runId: RunId;
  pipelineId: PipelineId;
  pipelineName: string;
  sessionId: string;
  /** Frozen at run-create — config changes during a run terminate the run. */
  pipelineConfigSnapshot: Pipeline;
  headSha: string;
  loopState: LoopStateName;
  terminationReason?: RunTerminationReason;
  loopRounds: number;
  /** Keyed by stage name. v0 has at most one entry per stage. */
  stages: Record<string, StageState>;
  /**
   * Denormalized materialized findings for predicate evaluation. The reducer
   * appends new finding artifacts here as STAGE_COMPLETED events arrive so
   * the predicate evaluator (used at routes evaluation and exit decision
   * time) can answer `no_open_findings` / `finding_count_below` without
   * reading the store. JSON artifacts are not mirrored here — they aren't
   * findings. Capped only by what stages emit.
   */
  findings?: Artifact[];
  createdAt: string;
  updatedAt: string;
}

export interface LoopState {
  sessionId: string;
  pipelineName: string;
  loopState: LoopStateName;
  loopRounds: number;
  lastSha: string;
  currentRunId?: RunId;
  updatedAt: string;
}

/** Compact run record used for stalled-detection across runs. */
export interface RunSummary {
  runId: RunId;
  loopState: LoopStateName;
  terminationReason?: RunTerminationReason;
  headSha: string;
  loopRounds: number;
  /** Sorted list of artifact fingerprints from the run, used by convergence. */
  fingerprints: string[];
  createdAt: string;
}

/**
 * Engine-global state. Multiple in-flight runs may exist (e.g. an old run is
 * being torn down while a new SHA spawns its replacement), so we key by RunId.
 *
 * Two-level state: this top-level structure holds engine-global counters /
 * indices; per-run details live in the keyed RunState entries.
 */
export interface EngineState {
  runs: Record<RunId, RunState>;
  /** Loop key ("{sessionId}:{pipelineName}") → currently-active runId. */
  currentRunByLoop: Record<string, RunId>;
  /** Loop key → ordered history (oldest first), used by convergence detection. */
  historySummaries: Record<string, RunSummary[]>;
}

export function loopKey(sessionId: string, pipelineName: string): string {
  return `${sessionId}:${pipelineName}`;
}

export function emptyEngineState(): EngineState {
  return {
    runs: {},
    currentRunByLoop: {},
    historySummaries: {},
  };
}

// ============================================================================
// Predicate evaluation context
// ============================================================================

/**
 * Inputs to the typed-predicate evaluator (`predicate-evaluator.ts`). All
 * fields are read-only snapshots — the evaluator is pure and must never
 * mutate them.
 *
 * - `run` is the current run state being decided over (stages, attempts,
 *   loopRounds).
 * - `history` is the per-loop run summary ledger, oldest first. Predicates
 *   like cross-run stability checks consult this. Routes-time evaluation
 *   (in the scheduler) passes an empty array; only the reducer's exit
 *   decision has access to durable history.
 * - `findings` are the materialized finding artifacts the engine has
 *   accumulated for this run. `RunState.findings` is the canonical source.
 */
export interface PredicateCtx {
  run: RunState;
  history: ReadonlyArray<RunSummary>;
  findings: ReadonlyArray<Artifact>;
}

// ============================================================================
// Task contexts (passed to executors)
// ============================================================================

/**
 * Base context handed to any in-process executor. The agent / command
 * executors don't consume it today (they use their own input shapes), but
 * builtin executors do — and `BuiltinTaskContext` extends this so the
 * dispatcher can hand non-privileged data through to both router & compose.
 *
 * `inputs` is keyed by upstream stage name (from `stage.dependsOn`); the
 * engine pre-fetches those stages' artifacts from the store before invoking
 * the dispatcher so builtins never read storage directly.
 */
export interface TaskContext {
  pipelineName: string;
  runId: RunId;
  stageRunId: StageRunId;
  stage: Stage;
  /** The "linked worker" session this pipeline was triggered for. */
  linkedSessionId: string;
  /** Upstream stage artifacts, keyed by stage name. Empty record if no deps. */
  inputs: Record<string, Artifact[]>;
}

/**
 * Privileged context handed only to builtin executors via the builtin
 * dispatcher. The `sendToSession` capability is intentionally NOT exposed
 * to agent/command executors — sending messages to the linked worker is a
 * router-only operation that must route through the dispatcher.
 */
export interface BuiltinTaskContext extends TaskContext {
  sendToSession: (sessionId: string, message: string) => Promise<void>;
}
