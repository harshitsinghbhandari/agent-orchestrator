# Pipelines v1 — Reimplementation Spec

> **Status:** Execution complete. All 11 tasks (T1-T11) built and merged onto `pipelines` via AO workers, orchestrated from session `agent-orchestrator-29`; shipped behind the `AO_PIPELINES` flag (default off).
> **Target:** fork (`origin` = `harshitsinghbhandari/agent-orchestrator`) only. Integration branch: `pipelines` (kept rebased onto `upstream/main`). Task branches off `pipelines`, PRs into `pipelines`. Upstream (`AgentWrapper`) is untouched and must never learn about this work.
> **Behavioral source of truth:** git branch `origin/legacy-pipelines` (old pre-rewrite TypeScript monorepo; renamed from `pipelines` on 2026-07-03, which auto-closed old PR #211). It is a *reference spec*, **not** portable code.
> **Fork-only artifacts:** this spec file lives only on the `pipelines` branch and is removed before the final upstream PR.
> **Last updated:** 2026-07-15

---

## 0. TL;DR

Reimplement the old "pipelines" feature onto the current Go backend + Electron/React renderer. A **pipeline** is a DAG of **stages** (agent review / shell command / builtin router-compose) triggered by git events or manually, running multi-round feedback loops until a typed **exit predicate** resolves the run to `done` or `stalled`.

v1 adds what the old system never had: pipelines are **first-class, CRUD-authored definitions** stored in SQLite, edited through a **raw YAML config editor** so both humans and agents author the same artifact. Workstream fan-in and the interactive followup thread are deferred to phase 2.

The old design is a clean **pure-reducer + effects** architecture, which ports to Go almost 1:1. The work is 11 tasks across 6 dependency-ordered batches.

---

## 1. Why this is a port, not a merge

`origin/legacy-pipelines` was built on the **pre-rewrite TypeScript monorepo**:

- Structure: `packages/core`, `packages/cli`, `packages/web`, `packages/plugins`, `.changeset`, `.husky`, `eslint.config.js`.
- The feature is ~9–10 KLOC across `packages/core/src/pipeline/**`, `packages/cli`, `packages/web`.

Current `main` is the **Go rewrite**: `backend/` (Go) + `frontend/` (Electron/React). Different language, different architecture.

Consequences:
- **No merge, rebase, or cherry-pick path exists.** `origin/legacy-pipelines` is entirely in TypeScript on the old substrate; `main` is the rewrite.
- The old commit history is irrelevant. We care only about the **net final behavior**, captured in this doc + the file references in §7.
- `upstream/pipelines` is stale — a strict ancestor of `origin/legacy-pipelines`. The fork has the real work.

**How to read the old code:** the files are on the `origin/legacy-pipelines` branch, not the working tree. Use `git show origin/legacy-pipelines:<path>` and `git ls-tree origin/legacy-pipelines <path>`. Do **not** `git checkout` the branch into the Go working tree.

---

## 2. Goal

A pipeline sequences multiple **stages** across git events and manages multi-round feedback loops until convergence (`done`) or failure (`stalled`). Each run is a stateful DAG-scheduled execution tree where stages depend on each other, emit findings/artifacts, and gate outcomes via configurable typed **exit predicates**. Designed for AI-agent code review at scale.

The v1 addition: pipeline **definitions** become first-class, persisted, and CRUD-authored via a raw config editor — so a human or an agent (e.g. Claude) can write a pipeline as YAML and save it, instead of hand-editing a static config file.

---

## 3. Scope

### In scope (v1)
- Full port of the pure core: types, config schema, **complete** predicate DSL, DAG scheduler, reducer + effects, fingerprint dedup, hydrate-on-boot.
- Three executor kinds: **agent**, **command**, **builtin** (router + compose).
- Triggers: **manual + PR events** (`opened` / `updated` / `merge_ready` / `merged`) bridged from the CDC event bus; new-SHA cancels-and-rearms.
- **SQLite**-backed definitions, runs, stage_runs, artifacts.
- CRUD API + runs API + live updates via the existing CDC `/events` stream; `ao pipeline` CLI parity.
- UI: **Pipelines** section — **Definitions** tab (list + CodeMirror 6 YAML editor with schema validation) and **Runs** tab (5-column Workbench Kanban, live) + read-only run detail.
- Both workspace modes: `shared-ro` and `isolated-rw`.
- Shipped behind the **`AO_PIPELINES` env feature flag** (default off).

### Explicitly out of scope (deferred to phase 2)
- **Workstream fan-in** — the bridge, manager, workstream predicates, and `ws:` loop keys. (Newest, least-tested ~1K LOC in the old branch.)
- **Interactive per-stage followup thread** — the `USER_FOLLOWUP` / `awaiting_context` loop. Run detail is **read-only** in v1.
- **Definition version history** — edits overwrite; runs snapshot their config at trigger time.
- **File-based definition loading** — the old `pipelines:` blocks in `agent-orchestrator.yaml`. SQLite is the sole source of truth.
- **`migrate.ts` fingerprint backfill** and the **`v0_default`** exit-predicate placeholder — both dropped (greenfield, no data to migrate).
- **Legacy predicate normalization** (`allSucceeded` / `anyFailed` → typed) — dropped, no legacy configs on the fork.

---

## 4. Resolved decisions (the 22 forks)

| # | Decision | Resolution |
|---|----------|-----------|
| 1 | Predicate DSL breadth | Port the **full** typed DSL (all_pass/any_pass/majority_pass/no_open_findings/finding_count_below/loop_rounds_at_least/stage_verdict + and/or/not). |
| 2 | Editor format | **YAML** in the editor, validated against a JSON-schema mirror of the Go structs. |
| 3 | Legacy predicate normalization | **Drop** it. Greenfield. |
| 4 ⭐ | Definition source of truth | **SQLite only**, CRUD via UI/API. No file-based defs. |
| 5 | Executor kinds in v1 | **All three** (agent, command, builtin router/compose). |
| 6 ⭐ | Agent-executor ↔ session manager | Reuse the rewrite's session-manager to spawn a fresh session per agent stage, inject the stage prompt, harvest findings, kill. |
| 7 | Findings contract | Keep `.ao/pipeline-findings.jsonl` (5MB cap, torn-line tolerance). |
| 8 ⭐ | Trigger sources | **Manual + PR events**, bridged from the CDC event bus (see §4b) → `TRIGGER_FIRED`. |
| 9 | New-SHA handling | On new commit to an in-flight run's branch, cancel run as `outdated` and re-arm. |
| 10 | Reducer + effects pattern | **Preserve it** 1:1 in Go. |
| 11 ⭐ | Concurrency model | **One goroutine event-loop per project engine** (actor style, serialized mutation via channel), instantiated in daemon wiring. |
| 12 | Engine scope | **Per-project** engine, not global. |
| 13 | Fingerprint dedup + hydrate-on-boot | Keep both. |
| 14 ⭐ | Table strategy vs review pipeline | **New `pipeline_*` tables**, separate subsystem from the `internal/review` PR-review machinery. |
| 15 | UI navigation | New top-level **Pipelines** section — Definitions + Runs tabs, AO-styled. |
| 16 | Workbench | Port the 5-column Kanban grouped by `loopState`, live via the CDC events stream. |
| 17 | Editing a def while a run is live | Snapshot config per run at trigger; edits change only the next run. No version history. |
| 18 | Interactive followup thread | **Defer to phase 2.** Read-only run detail in v1. |
| 19 | Workspace modes | Support **both** `shared-ro` and `isolated-rw`. |
| 20 | CLI parity | **Include** `ao pipeline {list,runs,show,run,cancel,resume}`. |
| 21 | Cruft | **Drop** `migrate.ts` and the `v0_default` placeholder. |
| 22 | Feature flag | Ship the whole thing behind the **`AO_PIPELINES` env flag** until stable. |

---

## 4b. Build-time resolutions (orchestrator interview, resolved 2026-07-15)

All defaults approved by Harshit. These supersede anything they contradict elsewhere in this doc.

**Secrecy + sync protocol**
- Upstream (`AgentWrapper`) must never learn about this work: zero issues, PRs, comments, or references there. The fork is public; that visibility is accepted.
- The `pipelines` branch is rebased onto `upstream/main` directly (NOT onto fork `main`, which carries fork-only release-workflow commits) **between batches only**, never while a batch's PRs are in flight. Task branches are always cut from the freshly rebased `pipelines`.
- Task PRs are **squash-merged** into `pipelines` by the orchestrator (one commit per task).
- Prettier: resolved as moot on 2026-07-15. Upstream rewrote `prettier.yml` to be check-only on changed files (no auto-push format commits), so no workflow guard is needed. Task branches must be prettier-clean on the files they touch. This spec file is the only fork-only artifact to remove before the final upstream PR.

**Process**
- Tracking issues live on the fork, labeled `pipelines-v1`. One issue per task; PRs reference them.
- The orchestrator (AO session `agent-orchestrator-29`) reviews each task PR (correctness + over-engineering pass) and squash-merges; the human is pinged via `inform` only on product/design forks and batch completions.
- Workers never touch upstream, never file issues anywhere but the fork, and escalate un-specced forks via `inform` instead of guessing.

**Technical resolutions**
- **Triggers (T6):** subscribe to the CDC broadcaster (`backend/internal/cdc`), not the SCM observer directly. `pr_created`/`pr_updated` events already exist (`cdc/event.go`). `pr.merge_ready` is derived on `pr_updated` transitions as: PR open + CI not failing + review approved-or-none + mergeable (matches old TS `lifecycle-status-decisions.ts`). `pr.merged` derives from PR state. New-SHA detection also rides `pr_updated`.
- **Findings (T4):** keep the `.ao/pipeline-findings.jsonl` file harvest (5MB cap, torn-line tolerance). No submit-back API in v1; the divergence from `internal/review`'s submit API is accepted.
- **Live updates (T7/T10):** NO bespoke `/api/pipelines/events` SSE endpoint. Add SQLite CDC triggers on the `pipeline_*` tables so pipeline events ride the existing `change_log` → `/events` stream (`backend/internal/httpd/events.go`); the renderer reuses its single EventSource + query-invalidation transport (`frontend/src/renderer/lib/event-transport.ts`).
- **Feature flag (T11):** `AO_PIPELINES=on` env var (default off), following `backend/internal/config/config.go` conventions. Nav hidden and API not-implemented when off.
- **Editor (T9):** CodeMirror 6, not monaco. Server-side validation is the source of truth; the editor surfaces returned errors inline.
- **Agent-stage sessions (T4):** spawned via `session_manager.Spawn`, visible in the sidebar as normal sessions, auto-killed when the stage ends. Badging/grouping is phase 2.
- **Engine wiring (T5):** engines are instantiated per-project in daemon wiring (`backend/internal/daemon`), not in the `ao start` CLI (the daemon is what `ao start` launches).
- **Definition storage (T3):** two columns: raw YAML text as authored + validated normalized JSON snapshot. Runs snapshot the JSON form.

---

## 5. Core data model

The types to reproduce as Go structs/enums. Reference: `packages/core/src/pipeline/types.ts` (680 LOC), `config-schema.ts` (475 LOC), `events.ts` (168 LOC).

| Type | Shape (abbreviated) | Role |
|------|---------------------|------|
| **Pipeline** | `{ id, name, scope, stages[], maxConcurrentStages, allowForkPRs, exitPredicates, pipelineConfigSnapshot }` | Immutable config snapshot per run. `scope` ∈ {worker, orchestrator, workstream} — **v1 uses `worker` only**. `exitPredicates` control run termination. |
| **Stage** | `{ name, trigger, executor, task, policy, budget, timeoutMs, retries, maxLoopRounds, dependsOn[], routes, workspace }` | Unit of work. `executor` ∈ {agent, command, builtin}. `routes.when` is optional conditional activation (default: all `dependsOn` succeeded). `workspace` ∈ {shared-ro, isolated-rw}. |
| **StageTrigger** | `{ on: StageTriggerEvent[] }` | Firing events: `pr.{opened,updated,merge_ready,merged}`, `manual`. (`orchestrator.*` / `workstream.*` deferred.) |
| **StageExecutor** | `AgentExecutor \| CommandExecutor \| BuiltinExecutor` | Agent spawns a session; Command shells out; Builtin (router/compose) runs in-process. |
| **TaskSpec** | `{ prompt, outputSchema, inputs }` | Prompt/script body + optional JSON output schema + upstream inputs. |
| **Predicate** | discriminated union: `all_pass` \| `any_pass` \| `majority_pass` \| `no_open_findings` \| `finding_count_below` \| `loop_rounds_at_least` \| `stage_verdict` \| composites (`and`/`or`/`not`) | Pure DSL for stage activation (`routes.when`) and run exit (`exitPredicates`). Evaluated by a pure evaluator. |
| **RunState** | `{ runId, pipelineId, pipelineName, sessionId, pipelineConfigSnapshot, headSha, loopState, terminationReason, loopRounds, stages: {name→StageState}, findings[], fingerprints[], createdAt, updatedAt }` | Live run state; all transitions via the reducer. `loopState` ∈ {running, awaiting_context, done, stalled, terminated}. `findings` denormalized for predicate eval. |
| **StageState** | `{ stageRunId, status, attempt, verdict, artifacts[], startedAt, completedAt, errorMessage }` | Per-stage lifecycle. `status` ∈ {pending, running, succeeded, failed, skipped, outdated}. |
| **Artifact** | `{ kind: finding\|json, filePath?, startLine?, endLine?, title?, description?, category?, severity?, confidence?, anchorSignature?, data?, artifactId, pipelineRunId, stageRunId, stageName, fingerprint?, status, createdAt, sentToAgentAt?, belowConfidenceThreshold? }` | Findings are structured code findings with a stable `fingerprint` (stageName + filePath + category + title) for cross-round dedup. `status` ∈ {open, dismissed, sent_to_agent, resolved}. |
| **LoopState** | `{ sessionId, pipelineName, loopState, loopRounds, lastSha, currentRunId?, updatedAt }` | Persistent loop key `{sessionId}:{pipelineName}`. Tracks active run + convergence. |
| **RunSummary** | `{ runId, loopState, terminationReason?, headSha, loopRounds, fingerprints[], createdAt }` | Compact history record for stalled-detection + cross-run predicates. |
| **EngineState** | `{ runs: {RunId→RunState}, currentRunByLoop: {loopKey→RunId}, historySummaries: {loopKey→RunSummary[]} }` | Global in-memory state, persisted to store. |
| **PredicateCtx** | `{ run, history, findings, workstream? }` | Context for pure predicate evaluation. Routes-time has empty history; exit-time has full history. |
| **PipelineEffect** | START_STAGE, CANCEL_STAGE, PERSIST_RUN, PERSIST_LOOP_STATE, APPEND_ARTIFACTS, UPDATE_ARTIFACT_STATUS, APPEND_THREAD_MESSAGE, SEND_FOLLOWUP, EMIT_OBSERVATION | Intent-only commands; engine executes them, feeds results back as events. |
| **PipelineEvent** | TRIGGER_FIRED, STAGE_STARTED, STAGE_COMPLETED, STAGE_FAILED, NEW_SHA_DETECTED, RUN_CANCELLED, RUN_RESUMED, CONFIG_CHANGED, ARTIFACT_STATUS_CHANGED, USER_FOLLOWUP, FOLLOWUP_REPLY, TICK | State-transition inputs to the reducer. |

> **v1 simplification:** the `workstream` fields on `RunState`/`PredicateCtx`, the `orchestrator.*`/`workstream.*` triggers, `USER_FOLLOWUP`/`FOLLOWUP_REPLY` events, and `SEND_FOLLOWUP`/`APPEND_THREAD_MESSAGE` effects are **deferred**. Keep the enums extensible so phase 2 slots in without a rewrite.

---

## 6. Runtime architecture

Preserve the old design shape. It is a **pure reducer + effects executor**.

```
        CLI / Web API / CDC trigger bridge
                        │
                        ▼
        ┌─ Engine (per project, one goroutine) ───────────┐
        │  holds EngineState in memory                     │
        │  serialized mutation via channel (actor model)   │
        │                                                  │
        │  dispatch(event)                                 │
        │      ▼                                           │
        │  reduce(state, event) ── PURE ──► {state', effects[]}
        │      ▼                                           │
        │  execute effects:                                │
        │    START_STAGE ──► executor (agent/cmd/builtin)  │
        │    CANCEL_STAGE ──► kill handle                  │
        │    PERSIST_* ────► store (SQLite)                │
        │    EMIT_OBSERVATION ─► activity log              │
        │      ▼                                           │
        │  tick(): poll inflight handles → dispatch        │
        │          STAGE_COMPLETED / STAGE_FAILED          │
        └──────────────────────────────────────────────────┘
                        ▲             │
                        └── event feed loop ──┘
```

**Reducer** (`reducer.ts`, 949 LOC + `reducer-helpers.ts`, 233 LOC) — pure state machine:
- `TRIGGER_FIRED`: create RunState, snapshot pipeline config, run DAG scheduler, emit START_STAGE for eligible stages.
- `STAGE_STARTED` / `STAGE_COMPLETED` / `STAGE_FAILED`: update stage status; on completion materialize artifacts (compute fingerprints), run DAG scheduler for downstream, check exit predicates when all stages terminal.
- `NEW_SHA_DETECTED`: cancel current run as `outdated`, free loop key.
- `RUN_CANCELLED`: terminate run, emit CANCEL_STAGE for running stages.
- `RUN_RESUMED`: reset failed stages to pending with fresh stageRunIds (attempt++), re-arm loop key.
- `CONFIG_CHANGED`: terminate run as `config_change`.
- `ARTIFACT_STATUS_CHANGED`: update artifact status.

**DAG scheduler** (`dag.ts`, 257 LOC) — pure, called from reducer on TRIGGER_FIRED / STAGE_COMPLETED / RUN_RESUMED:
- Cascade-skip to fixpoint: mark `skipped` any pending stage whose preconditions are terminal and `routes.when` evaluates false.
- Slot filling: emit START_STAGE up to `maxConcurrentStages` (declaration order for tie-break).
- Cycle detection: `findFirstStageCycle` at config-load and runtime.

**Predicate evaluator** (`predicate-evaluator.ts`, 233 LOC) — pure, `evaluate(predicate, ctx) → bool`:
- `all_pass`/`any_pass`/`majority_pass`: stage status === succeeded.
- `no_open_findings`/`finding_count_below`: count findings by stage/severity from `ctx.findings`.
- `loop_rounds_at_least`/`stage_retried_at_least`: counter comparisons.
- `stage_verdict`: map status → verdict (succeeded→pass, failed→fail, else→neutral).

**Executors:**
- **Agent** (`executors/agent.ts`, 411 LOC): spawn a fresh session, inject stage prompt, wait for `idle` + findings file at `.ao/pipeline-findings.jsonl`, harvest findings (non-blocking JSONL parse, 5MB cap → truncation emits observation), kill session.
- **Command** (`executors/command.ts`, 560 LOC): shell out, stream stdout/stderr to activity log, return exit code. Fork-PR shell-out gated by `allowForkPRs` (default false).
- **Builtin/router** (`executors/builtin/router.ts`, 177 LOC): route upstream findings/JSON to the linked session.
- **Builtin/compose** (`executors/builtin/compose.ts`, 38 LOC): merge upstream artifacts into one JSON artifact.
- **Dispatcher** (`executors/builtin/dispatcher.ts`, 75 LOC): fetch upstream artifacts from store, invoke builtin, append results.

**Store** (`store.ts`, 281 LOC + `paths.ts`, 64 LOC) — old = flat-file JSONL; **v1 = SQLite**:
- Old layout (reference only): `runs/{id}.json`, `stages/{id}.json`, `artifacts/{runId}/{stageRunId}.jsonl`, `loops/{id}.json`.
- v1: `pipeline_*` tables (see §8, T3). Preserve read semantics: atomic updates, artifact append, torn-line tolerance is moot in SQLite.
- `hydrateEngineState`: rebuild in-memory state from the store on daemon boot.

---

## 7. Public surface to reproduce

### CLI (`packages/cli/src/commands/pipeline.ts`, 412 LOC + `lib/pipeline-service.ts`, 426 LOC)

| Command | Purpose |
|---------|---------|
| `ao pipeline list [--project ID] [--json]` | List configured pipelines for a project. |
| `ao pipeline runs [--project ID] [--pipeline NAME] [--status STATE] [--limit N] [--json]` | List runs (newest first), filterable. |
| `ao pipeline show <runId> [--project ID] [--json]` | Run detail: stages, artifacts, attempts, verdicts. |
| `ao pipeline run <pipeline-ref> [--project ID] [--session ID] [--head-sha SHA] [--json]` | Trigger a manual run. |
| `ao pipeline cancel <runId> [--project ID]` | Cancel in-flight run. |
| `ao pipeline resume <runId> [--project ID]` | Resume a stalled/failed run. |
| ~~`ao pipeline migrate`~~ | **Dropped** (greenfield). |

### HTTP API (`packages/web/src/app/api/pipelines/**`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/pipelines` | List pipeline **definitions** (**new** — CRUD surface). |
| POST | `/api/pipelines` | Create a definition. (**new**) |
| PUT | `/api/pipelines/:id` | Update a definition. (**new**) |
| DELETE | `/api/pipelines/:id` | Delete a definition. (**new**) |
| GET | `/api/pipelines/runs [?project=ID]` | List runs. |
| GET | `/api/pipelines/runs/:runId [?project=ID]` | Full run detail (stages, artifacts, thread counts). |
| POST | `/api/pipelines/runs/:runId/cancel` | Cancel run. |
| POST | `/api/pipelines/runs/:runId/resume` | Resume run. |
| GET | `/api/pipelines/runs/:runId/artifacts/:artifactId` | Fetch one artifact blob. |
| ~~GET~~ | ~~`/api/pipelines/events`~~ | **Dropped (§4b):** pipeline events ride the existing CDC `change_log` → `/events` SSE stream via triggers on the `pipeline_*` tables. |
| ~~GET/POST~~ | ~~`/api/pipelines/runs/:runId/stages/:stageRunId/thread`~~ | **Deferred** (followup thread → phase 2). |

> The `/api/pipelines` CRUD endpoints are **net-new** — the old system had no definition CRUD (defs lived in a static YAML file).

### UI (`packages/web/src/components/Pipeline*.tsx`, `hooks/usePipelineEvents.ts`, `app/pipelines/page.tsx`)

| Component | Responsibility |
|-----------|-----------------|
| **PipelineWorkbench** (149 LOC) | 5-column Kanban by `loopState` (running / awaiting_context / done / stalled / terminated). Live via CDC events, filter by pipeline name. |
| **PipelineRunCard** (113 LOC) | Card: runId, pipelineName, status, loopRounds, artifacts count, timestamp. |
| **PipelineFilterBar** (77 LOC) | Pipeline multiselect + "show dismissed" toggle. |
| **SessionPipelineStrip** (98 LOC) | Mini run summary in session detail. |
| **usePipelineEvents** (118 LOC) | Reference only — v1 replaces this with the renderer's existing CDC event transport + query invalidation. |
| **Definitions editor** | **Net-new**: CodeMirror 6 YAML editor + server-side schema validation + CRUD wiring. |

---

## 8. Task breakdown — stages & batches

Each task = one AO worker, TDD, its own tests. Batches are dependency-ordered: a batch starts only after the prior batch merges green. **New code lives under `backend/internal/pipeline/**` (Go) and `frontend/src/renderer/**` (UI).**

Every task's "Reference" column points at the `origin/legacy-pipelines` files to read via `git show origin/legacy-pipelines:<path>`.

### Batch 1 — Foundation (must land first)

**T1 · Domain contract + config schema**
- Build: Go types/enums/branded IDs for definitions, stages, triggers, executor kinds, the **full** predicate DSL, run/stage state, artifacts, events, effects. Config = YAML parse + JSON-schema mirror + `validation` (agent-mode check + DAG cycle detection).
- Keep enums extensible for deferred workstream/followup variants.
- Reference: `packages/core/src/pipeline/types.ts`, `config-schema.ts`, `validation.ts`, and the cycle-detection part of `dag.ts`.
- Tests: schema round-trip, invalid-config rejection, cycle detection.

### Batch 2 — Pure core + boundaries (parallel; all depend on T1)

**T2 · Engine core (pure, no I/O)**
- Build: `reducer` + `reducer-helpers` (patch/replace run, `materializeArtifact` fingerprinting, `terminateRun`, `summarizeRun`) + `dag` scheduler + `predicate-evaluator`.
- Reference: `reducer.ts`, `reducer-helpers.ts`, `dag.ts`, `predicate-evaluator.ts`, `events.ts`.
- Tests: reducer transition table (every event), DAG cascade-skip + slot-fill, predicate DSL table tests.

**T3 · Store (SQLite)**
- Build: `pipeline_*` migrations + sqlc queries + store CRUD. Tables: `pipeline_definitions`, `pipeline_runs`, `pipeline_stage_runs`, `pipeline_artifacts`. (`pipeline_thread_messages` deferred.) Definitions: raw YAML column + normalized JSON snapshot column (§4b). CDC triggers on `pipeline_*` tables into `change_log`.
- Reference: `store.ts`, `paths.ts` (for the data shapes and read semantics — layout is reinvented for SQLite). Follow existing conventions in `backend/internal/storage/sqlite`.
- Tests: save/load round-trip per entity, hydrate-state reconstruction, artifact append + status update, CDC trigger emission.

**T4 · Executors**
- Build: agent + command + builtin(router/compose) + dispatcher, behind a mockable executor interface wired to the session-manager. Findings harvest (`.ao/pipeline-findings.jsonl`, 5MB cap, torn-line tolerance). `allowForkPRs` gate on command executor.
- Reference: `executors/agent.ts`, `executors/command.ts`, `executors/builtin/{router,compose,dispatcher}.ts`, `executors/index.ts`, `stage-prompt.ts` (prompt injection).
- Tests: findings parse + cap, fork-PR gate, router routing target, compose merge.

### Batch 3 — Runtime (depends on Batch 2)

**T5 · Engine runtime**
- Build: per-project goroutine event-loop (actor, serialized via channel), effect execution, inflight/tick polling, `hydrateEngineState` on daemon boot, per-project instantiation in daemon wiring (`backend/internal/daemon`). Wires reducer + store + executors + observation sink.
- Reference: `engine.ts` (890 LOC) — the effect executor, lock/serialization, tick, dispatch, cancel, shutdown, hydrate.
- Tests: end-to-end single-stage run through the real loop (trigger → start → complete → exit predicate → done).

### Batch 4 — Edges (parallel; depend on T5)

**T6 · Triggers**
- Build: CDC-subscriber → `TRIGGER_FIRED` bridge (`pr.opened` from `pr_created`; `pr.updated`, `pr.merge_ready`, `pr.merged`, and `NEW_SHA_DETECTED` derived from `pr_updated` transitions per §4b), manual trigger path, cancel-and-rearm.
- Reference: old TS `lifecycle-status-decisions.ts` (merge_ready semantics). New event source: `backend/internal/cdc` broadcaster.
- Tests: PR-opened → run integration; new-SHA cancels + rearms; merge_ready transition detection.

**T7 · HTTP API**
- Build: CRUD `/api/pipelines` (definitions); runs list/detail/cancel/resume/artifacts. No bespoke SSE endpoint (§4b).
- Reference: `packages/web/src/lib/pipelines.ts` (507 LOC — list/describe/cancel/resume service logic), `packages/web/src/app/api/pipelines/**` route handlers. Follow `backend/internal/httpd/controllers` conventions.
- Tests: controller tests per endpoint.

### Batch 5 — Surfaces (parallel; depend on Batch 4)

**T8 · CLI**
- Build: `ao pipeline {list,runs,show,run,cancel,resume}` over the daemon HTTP API.
- Reference: `packages/cli/src/commands/pipeline.ts`, `packages/cli/src/lib/pipeline-service.ts`. Follow `backend/internal/cli` (cobra) conventions.
- Tests: command smoke tests (list/runs/show/run/cancel/resume).

**T9 · UI — Definitions**
- Build: Pipelines nav + **Definitions** tab: list + CodeMirror 6 YAML editor + server-side validation surfacing + CRUD wiring. AO design system.
- Reference: net-new (no old equivalent). Schema mirror from T1.
- Tests: editor validation surfaces errors, save/create/update/delete flow.

**T10 · UI — Runs**
- Build: **Runs** tab: Workbench Kanban by `loopState` + live updates via the existing CDC event transport + read-only run detail (stages + findings).
- Reference: `PipelineWorkbench.tsx`, `PipelineRunCard.tsx`, `PipelineFilterBar.tsx`, `app/pipelines/page.tsx`. Restyle to AO design system — do not copy the old CSS.
- Tests: component tests, Kanban grouping, live update via event transport.

### Batch 6 — Gate (depends on all)

**T11 · Feature flag + e2e**
- Build: `AO_PIPELINES` env flag gating the whole subsystem; docs; full integration test.
- Tests: PR opened → stages run → findings → exit predicate → `done`, behind the flag.

---

## 9. Port notes & gotchas

Carried from the reference-map analysis of `origin/legacy-pipelines`:

1. **Zod → Go validation.** `config-schema.ts` uses recursive `z.lazy()` for the Predicate union. Go needs hand-written recursive validation or a JSON-schema lib. This is the fiddliest port (T1).
2. **Discriminated unions.** TS `type Predicate = {kind: "all_pass"} | ...` is compiler-enforced. Go needs explicit type tags + runtime checks (sealed-interface or tagged-struct pattern).
3. **Pure evaluator must stay pure.** The DAG scheduler evaluates predicates at schedule time *without* full history — don't sneak a clock or `context.Context` into the evaluator.
4. **Promise serialization lock → goroutine/channel.** The old engine's `lockTail` promise chain guarantees no concurrent state mutation. The Go actor loop must preserve that single-writer invariant (T5, T11).
5. **SSE via CDC.** No hand-rolled streaming; correctness burden shifts to the CDC triggers in T3 and payload shape (T3/T10).
6. **Flat-file → SQLite.** The old JSONL layout scales poorly (N projects × runs = thousands of files). SQLite is the right call; preserve atomic-update + append semantics (T3).
7. **Executor spawning coupling.** Old executors reach directly into SessionManager. Define an executor interface + DI in Go (T4).
8. **Observation sink always attached.** `EMIT_OBSERVATION` was optional in tests — in Go, always wire the observation hook so activity logging never silently drops (T5).
9. **Worktree cleanup on crash.** `isolated-rw` stages create detached worktrees. Ensure teardown even if the engine crashes mid-run — a filesystem scan on boot, or tie lifetime to the session (T4/T5).
10. **Retry/attempt counting is subtle.** `stage.retries` caps attempts, but when to increment vs keep the same attempt on `outdated` revival is non-obvious — port `reducer-helpers` behavior carefully and test it (T2).

### Deliberately dropped (do not port)
- `migrate.ts` (fingerprint backfill) — no data to migrate.
- `v0_default` exit-predicate placeholder — greenfield.
- Legacy predicate normalization (`allSucceeded`/`anyFailed`).
- File-based `pipelines:` YAML loading from `agent-orchestrator.yaml`.

### Deferred to phase 2 (keep seams open)
- Workstream fan-in: `workstream-trigger-bridge.ts`, `workstream-manager.ts`, workstream predicates, `ws:` loop keys, `orchestrator.*`/`workstream.*` triggers.
- Interactive followup thread: `USER_FOLLOWUP`/`FOLLOWUP_REPLY` events, `SEND_FOLLOWUP`/`APPEND_THREAD_MESSAGE` effects, the `/stages/:id/thread` API, `awaiting_context` interactive loop.
- Definition version history.

---

## 10. Open decisions deferred to build time (small only)

- Exact SQLite column/index layout for `pipeline_*` tables (follow existing sqlc conventions).
- **Build-time rule:** any worker that hits a product/UX fork not covered here **stops and asks** (escalate via `inform`) — never guess.

---

## Appendix A — Full old-branch file reference

Read any of these with `git show origin/legacy-pipelines:<path>`.

**Core (`packages/core/src/pipeline/`)** — `types.ts` (680), `config-schema.ts` (475), `engine.ts` (890), `reducer.ts` (949), `reducer-helpers.ts` (233), `events.ts` (168), `dag.ts` (257), `predicate-evaluator.ts` (233), `validation.ts` (90), `store.ts` (281), `paths.ts` (64), `workspace.ts` (207), `stage-prompt.ts` (101), `migrate.ts` [drop], `index.ts`, `workstream-trigger-bridge.ts` (146) [defer]. Executors: `executors/agent.ts` (411), `executors/command.ts` (560), `executors/index.ts`, `executors/builtin/router.ts` (177), `executors/builtin/compose.ts` (38), `executors/builtin/dispatcher.ts` (75). Plus `packages/core/src/workstream-manager.ts` [defer].

**CLI (`packages/cli/src/`)** — `commands/pipeline.ts` (412), `lib/pipeline-service.ts` (426).

**Web (`packages/web/src/`)** — `lib/pipelines.ts` (507), `hooks/usePipelineEvents.ts` (118), `app/pipelines/page.tsx`, `app/api/pipelines/runs/route.ts`, `app/api/pipelines/events/route.ts`, `app/api/pipelines/runs/[runId]/route.ts`, `.../[runId]/cancel/route.ts`, `.../[runId]/resume/route.ts`, `.../[runId]/artifacts/[artifactId]/route.ts`, `.../[runId]/stages/[stageRunId]/thread/route.ts` [defer]. Components: `PipelineWorkbench.tsx` (149), `PipelineRunCard.tsx` (113), `PipelineFilterBar.tsx` (77), `SessionPipelineStrip.tsx` (98).

**Tests (read for behavioral intent, not porting verbatim)** — `packages/core/src/__tests__/pipeline-*.test.ts` (engine, reducer, dag, predicate-evaluator, exit-and-recovery, fingerprints, followup, observation-routing, robustness, stage-prompt, store, validation, workspace, command-executor, builtin-executors, agent-executor, lifecycle-pipeline-bridge), `packages/integration-tests/src/pipeline-*.integration.test.ts`, `packages/cli/__tests__/**`, `packages/web/src/components/__tests__/**`.

**New Go/renderer homes**
- Backend: `backend/internal/pipeline/{types,config,predicate,dag,reducer,engine,executors,store,triggers}` (new subsystem, separate from `internal/review`).
- Storage: `backend/internal/storage/sqlite/{migrations,queries,gen}` — `pipeline_*` tables + CDC triggers.
- API: `backend/internal/httpd/controllers` — pipelines controller.
- CLI: `backend/internal/cli/pipeline.go`.
- Trigger source: `backend/internal/cdc` broadcaster (existing) → bridge in `backend/internal/pipeline/triggers`.
- UI: `frontend/src/renderer/**` — Pipelines nav, Definitions editor (CodeMirror 6), Runs Workbench.
