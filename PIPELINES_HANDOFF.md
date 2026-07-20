# Pipelines + Visual Editor — Handoff

For a fresh orchestrator session (Harshit is the user; you are AO orchestrator `agent-orchestrator-29` or its successor). This captures current state, how the feature actually works (so you can answer his questions), the workflow, and open gaps.

## 1. Current state

- **Everything lives on the fork branch `pipelines`** (`origin` = `harshitsinghbhandari/agent-orchestrator`). Tip as of handoff: `64b074550`. Your local `main` does NOT have it, do `git fetch origin && git log origin/pipelines`.
- **SECRET FROM UPSTREAM** (`AgentWrapper`): zero issues/PRs/comments/refs there, ever. All issues/PRs/discussions are on the fork, label `pipelines-v1`.
- Shipped behind the **`AO_PIPELINES` flag** (default off), toggled from the app's **Settings** (persisted in the daemon's SQLite under `~/.ao`; env var is a dev/CI override).
- Two fork dogfood releases cut: `desktop-v0.10.20`, `desktop-v0.10.21` (tag-only, branch not moved).
- **Workflow is now DEV MODE**: Harshit runs the app from source (`cd frontend && npm run build:daemon && npm run dev`) on the `pipelines` branch and `git pull`s fixes. Do NOT cut a release per fix; only when he asks for a shareable build.

## 2. What was built (all merged on `pipelines`)

**Pipelines v1** (backend + first UI), PRs #227,#231,#233,#232,#235,#239,#238,#243,#244,#245,#247:
T1 domain contract, T2 engine core (reducer+DAG+predicate evaluator), T3 SQLite store+CDC, T4 executors, T5 engine runtime (daemon actor loop), T6 CDC trigger bridge, T7 HTTP API, T8 `ao pipeline` CLI, T9 definitions UI (YAML editor), T10 runs UI (kanban), T11 flag+e2e. T12 (#249) Settings toggle for the flag.

**Visual editor**, PRs #251,#255,#256,#257,#260,#261,#263: V1 draft model+YAML codec+`/validate` endpoint+view shell, V2 canvas, V3 inspector, V4 predicate builder, V5 settings modal, V6 Canvas/Split/YAML sync+validation surfacing, V7 new-pipeline modal+templates+integration. V8 (#265) fix: stage identity by index (empty/dup names editable) + working delete.

Specs on the branch (fork-only, strip before any upstream PR): `PIPELINES_REIMPL_SPEC.md`, `VISUAL_EDITOR_SPEC.md`. Mockups at `~/Downloads/visual-pipeline-mockups/exports/`.

## 3. How it actually works (to answer his questions)

**A pipeline** = a DAG of stages, triggered by PR events or manual, looping until a typed exit predicate resolves the run `done`/`stalled`. Definitions are CRUD-authored (SQLite), stored as raw YAML + normalized JSON snapshot.

**Backend data flow** (`backend/internal/pipeline/`):
- `config.go` `ParseDefinition(yaml) -> *Pipeline` (validates: unique/non-empty names, per-kind executor fields, dependsOn refs + cycle detection `FindFirstStageCycle`, predicate refs). Returns `*ValidationError{Issues:[{Path,Message}]}`.
- `reducer.go` PURE `Reduce(state, event) -> (state, effects)`. Events (TRIGGER_FIRED, STAGE_STARTED/COMPLETED/FAILED, NEW_SHA_DETECTED, RUN_CANCELLED/RESUMED, CONFIG_CHANGED, ARTIFACT_STATUS_CHANGED, TICK) carry a driver-stamped `Now`. Effects (START_STAGE, CANCEL_STAGE, PERSIST_*, APPEND_ARTIFACTS, EMIT_OBSERVATION) are intents the engine executes.
- `scheduler.go` DAG: cascade-skip + slot-fill by `maxConcurrentStages`. IMPORTANT: per-stage `trigger.on` does NOT gate stage start within a run, it only tells the BRIDGE whether to create a run. Once a run exists, stages start by deps + `routes.when`.
- `predicate.go` + `evaluator.go`: the typed DSL (all/any/majority_pass, no_open_findings, finding_count_below, loop_rounds_at_least, stage_retried_at_least, stage_verdict, and/or/not).
- `engine/engine.go`: ONE actor goroutine per project (single-writer via a mailbox channel), executes effects against store + executors, ticks inflight handles, hydrates on boot. `engine/supervisor.go` = one engine per project. Wired in `backend/internal/daemon` (single seam `startPipelineEngine`, gated by the flag).
- `executors/`: agent (spawns a fresh session via session_manager, injects stage prompt, waits idle + `.ao/pipeline-findings.jsonl`, harvests, kills), command (shell + fork-PR gate), builtin router/compose. Behind a mockable `executors.Set`.
- `triggers/bridge.go` (T6): subscribes to the CDC broadcaster; derives pr.opened (pr_created), pr.updated/merge_ready/merged + new-SHA (pr_updated). merge_ready = PR open + CI not failing + review approved-or-none + mergeable. Fires only defs whose stages subscribe. New-SHA cancels stale run as outdated + rearms.
- Store `backend/internal/storage/sqlite`: tables `pipeline_definitions/runs/stage_runs/artifacts` (migration 0024), fork provenance `pr.is_from_fork` (0025), `pr_cdc_update` head_sha (0026), `app_settings` (0027). CDC triggers on `pipeline_*` tables emit events onto the existing `change_log` -> `/events` SSE stream (no bespoke pipeline SSE).
- API `backend/internal/httpd/controllers/pipelines.go` + service `service/pipeline/pipeline.go`: definitions CRUD, runs list/detail/cancel/resume, artifact, POST `/pipelines/validate` (dry-run), manual trigger POST `/pipelines/runs`. CLI `cli/pipeline.go` calls these.

**Findings contract**: agent stages report by writing JSONL findings to `.ao/pipeline-findings.jsonl` (rename-into-place); the file's EXISTENCE is the stage completion signal. Idle-without-file => stage fails. 5MB cap.

**Visual editor** (`frontend/src/renderer/`): the whole thing edits an in-memory `PipelineDraft` (`lib/pipeline-draft.ts`) that serializes to the SAME YAML the API takes (`serializeToYaml`/`parseYamlToDraft`; prune matches Go omitempty, keeps false/0). `hooks/usePipelineDraft.ts` debounce-calls `/validate`. `components/PipelineDefinitionsPage.tsx` hosts Canvas/Split/YAML toggle + inspector + settings modal + predicate builder + problems panel + save. Canvas `PipelineCanvas.tsx` (react-flow + dagre; node id = ARRAY INDEX, not name). Inspector `StageInspector.tsx`. Predicate builder `PredicateBuilder.tsx`/`PredicateBuilderModal.tsx` + `lib/predicate-text.ts` (compiled DSL). Settings `PipelineSettingsModal.tsx`. Templates `lib/pipeline-templates.ts`. Save serializes draft -> existing create/update endpoints.

## 4. KNOWN GAP Harshit just hit (likely his next questions)

**Agent-stage sessions get NO PR/diff context.** `executors/agent.go` `SpawnRequest` carries only ProjectID/IssueID/Prompt/Harness, the spawned review session is a fresh worktree off the project default, NOT the triggering PR's branch/SHA/diff. So "review the PR/diff" prompts are underspecified. Workarounds: self-contained prompts, or this is the obvious next fix (wire head SHA/branch/PR into the agent spawn so the stage session checks out the PR). If he wants it, spec + spawn a worker for it.

To try a run: `ao pipeline run <name> --project agent-orchestrator` (manual works even for pr.* defs). Watch in Runs tab or `ao pipeline runs/show`. The engine spawns the stage agents automatically; the user does not.

## 5. Open items

- `pipelines` is ~8 behind `upstream/main` (drifts continuously). Sync between batches. Harshit merges upstream->pipelines himself sometimes; conflicts are usually generated files (`openapi.yaml` via `go run ./cmd/genspec`, `frontend/src/api/schema.ts` via `openapi-typescript`) — REGENERATE, don't hand-merge.
- Eventual upstream PR: strip fork-only artifacts (`PIPELINES_REIMPL_SPEC.md`, `VISUAL_EDITOR_SPEC.md`, their `.prettierignore` entries).
- Phase 2 deferred: workstream fan-in, interactive followup thread, definition version history, agent-stage session badging, streaming command logs.

## 6. Workflow gotchas

- **Review pattern**: workers open PRs into `pipelines`; you review + squash-merge (they never self-merge). Same-account PRs can't be formally approved on GitHub -> use a comment-review then merge. VERIFY claims yourself (run the real Go validator/tests, check CI history) — do not trust "unrelated/pre-existing" without checking base CI.
- **`routeTree.gen.ts` is TRACKED again** (upstream re-added it); workers regenerate+commit it.
- **`ao spawn` dropped the `--name` flag** (CLI updated); spawn with `--project`/`--issue`/`--prompt` only.
- **Spawn instability**: workers sometimes launch in a deleted cwd (Bun ENOENT) or terminate immediately after a daemon restart; verify the pane is alive after spawn, respawn if dead.
- Worker prompts follow spec-and-ship TEMPLATE; they report via `ao send --session <orchestrator>`, escalate forks via `inform`.
- GitHub API from this box occasionally i/o-times-out; retry with backoff.

See also the persistent memory `project_pipelines_reimpl_direction.md`.
