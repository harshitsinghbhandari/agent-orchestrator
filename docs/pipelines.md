# Pipelines

Pipelines let a project define a repeatable multi-stage review/build workflow
that runs against a session's workspace. A pipeline definition is a DAG of
stages (an agent review, a shell command, or a builtin router/compose step)
triggered by git events or run manually. A run drives the DAG to completion,
looping through multiple rounds of feedback until a typed exit predicate
resolves the run to `done` or `stalled`. Definitions are first-class,
CRUD-authored YAML, validated server-side and stored in SQLite; each run
snapshots the definition it was triggered from.

## Enabling the feature

Pipelines are off by default and experimental. There are two ways to turn them
on; a persisted setting for normal use, and an env override for dev/CI.

**Settings toggle (recommended).** In the desktop app open Global settings and
flip **Pipelines → Enabled**, then Save. The choice persists in the daemon's own
store (a `pipelines.enabled` row in the `app_settings` table under `~/.ao`), so
it survives restarts and applies no matter who launches the daemon (the Electron
supervisor or a headless `ao start`). Saving restarts the daemon so the change
takes effect immediately, and the sidebar's Pipelines entry appears once the
daemon is back.

**`AO_PIPELINES` env override (dev/CI).** Set `AO_PIPELINES` in the daemon's
environment before it boots, following the same on/off convention as AO's other
`AO_*` toggles: `on`/`true`/`1`/`yes` enable it, `off`/`false`/`0`/`no` disable
it.

**Precedence.** When `AO_PIPELINES` is set (to on OR off) it wins and the
persisted setting is ignored — it is a hard override. When `AO_PIPELINES` is
unset, the persisted `pipelines.enabled` setting decides. With neither set,
pipelines stay off.

When pipelines are off (whichever source resolved it):

- The Pipelines entry is hidden from the sidebar nav.
- Every `/api/v1/pipelines/*` route returns 501.
- No per-project pipeline engines start, and the CDC trigger bridge does not
  subscribe to PR events.

The settings endpoint itself (`/api/v1/settings/pipelines`) is never gated by
the flag, so the toggle is always reachable.

```bash
# dev/CI override; forces pipelines on regardless of the persisted setting
AO_PIPELINES=on ao start
```

> Note: a headless `ao start` daemon the desktop app merely attached to (rather
> than spawned) is not restarted by the Settings toggle. The setting is still
> persisted and applies the next time that daemon boots.

## Authoring a definition

A definition is a single YAML document: one pipeline per document (there is
no map-of-pipelines file format). `id` is never part of the authored YAML;
the store assigns it on save. `scope` defaults to `worker` and is the only
scope v1 accepts (`orchestrator` and `workstream` are reserved for a later
phase).

```yaml
name: pr-review
stages:
  - name: review
    trigger:
      on: [pr.opened, pr.updated]
    executor:
      kind: agent
      plugin: claude-code
      mode: review
    task:
      prompt: Review the diff for correctness and style issues.
    policy:
      stallWindow: 2

  - name: gate
    trigger:
      on: [manual]
    dependsOn: [review]
    routes:
      when:
        kind: no_open_findings
        stage: review
    executor:
      kind: builtin
      name: compose

exitPredicates:
  done:
    kind: and
    predicates:
      - kind: all_pass
        stages: [review, gate]
      - kind: finding_count_below
        stage: review
        severity: error
        max: 1
  stalled:
    kind: or
    predicates:
      - kind: loop_rounds_at_least
        n: 5
      - kind: not
        predicate:
          kind: stage_verdict
          stage: gate
          verdict: pass
```

Key fields, by section:

- **Stage**: `name`, `trigger.on`, `executor`, `task` (`prompt` /
  `outputSchema` / `inputs`), `policy` (`blocksMerge`, `stallWindow`),
  `budget` (`maxUsd`, `maxDurationMs`), `timeoutMs`, `retries`,
  `maxLoopRounds`, `dependsOn`, `routes.when`, `workspace`
  (`shared-ro` or `isolated-rw`).
- **Executor kinds**: `agent` (requires `plugin` and `mode`, `mode` is one of
  `review`/`code`/`answer`), `command` (requires `command`, plus optional
  `args`/`env`/`cwd`), `builtin` (requires `name`, one of `router`/
  `compose`). Fields from another kind are rejected, not silently dropped.
- **Pipeline-level**: `maxConcurrentStages` (defaults to 1, i.e. serial),
  `allowForkPRs` (defaults to false; gates `command` stages on fork PRs),
  `exitPredicates.{done,stalled,blocksMerge}`.

### Predicates

`routes.when` and `exitPredicates.*` share one typed predicate DSL:
`all_pass` / `any_pass` / `majority_pass` (each takes `stages: [...]`),
`no_open_findings` (optional `stage`), `finding_count_below` (`max`,
optional `stage`/`severity`), `loop_rounds_at_least` (`n`), the
`stage_retried_at_least` (`stage`, `n`), `stage_verdict` (`stage`,
`verdict`), and the composites `and` / `or` (`predicates: [...]`) and `not`
(`predicate: ...`). Every referenced stage name must exist in the same
definition; unknown kinds and cross-kind fields fail validation with a
path-scoped issue (e.g. `stages[1].routes.when: field "max" is not valid
for predicate kind "all_pass"`).

## Triggers

A stage fires on `manual` or on PR lifecycle events delivered through the
CDC event bus: `pr.opened`, `pr.updated`, `pr.merge_ready`, `pr.merged`.

- `pr.opened` fires on PR creation, `pr.updated` on every subsequent PR
  update.
- `pr.merge_ready` is derived, not a raw webhook event: it fires on the
  transition into "merge ready" (PR open, CI not failing, review
  approved-or-none, and mergeable). A PR first observed already in that
  state counts as a transition and fires once; it does not re-fire on
  later updates while it stays merge-ready.
- `pr.merged` fires the same way: once, on the transition into merged
  (including a PR first observed already merged).
- A new head SHA on an already-triggered PR cancels the stale in-flight run
  (marked `outdated`) and rearms the loop for the new SHA, riding the same
  `pr.updated` event.

## CLI commands

```
ao pipeline list [--project ID] [--json]
ao pipeline runs [--project ID] [--pipeline NAME] [--status STATE] [--limit N] [--json]
ao pipeline show <runId> [--project ID] [--json]
ao pipeline run <pipeline-ref> [--project ID] [--session ID] [--head-sha SHA] [--json]
ao pipeline cancel <runId> [--project ID]
ao pipeline resume <runId> [--project ID]
```

`--project` falls back to `AO_PROJECT_ID`, then the CLI's usual
cwd/session-based project resolution. `--status` filters `runs` by loop
state (`running`, `awaiting_context`, `done`, `stalled`, `terminated`).
`pipeline run` accepts either a pipeline id or its name.

```bash
ao pipeline runs --pipeline pr-review --status stalled
ao pipeline run pr-review --head-sha abc1234
ao pipeline resume run_01hz...
```

## Where findings land

An agent stage's session is expected to write findings to
`.ao/pipeline-findings.jsonl` inside the stage's workspace, one JSON object
per line. The executor harvests this file after the session goes idle,
streaming it up to a 5MB cap (a torn, unterminated final line is tolerated
and dropped; a malformed complete line fails the harvest). Each line is
either a `finding` or a free-form `json` artifact:

```json
{
	"kind": "finding",
	"filePath": "backend/internal/foo.go",
	"startLine": 12,
	"endLine": 18,
	"title": "Unchecked error",
	"description": "err is discarded",
	"category": "correctness",
	"severity": "warning",
	"confidence": 0.8
}
```

Finding fields: `filePath`, `startLine`, `endLine`, `title`, `description`,
`category` (free-form, e.g. `security`/`correctness`/`style`/`general`),
`severity` (`error`/`warning`/`info`), `confidence` (a float in `[0, 1]`),
and an optional `anchorSignature` used to keep the finding's fingerprint
stable across rounds. A `json`-kind artifact instead carries a `data`
object. All finding fields except `anchorSignature` are required on a
`finding`-kind line; a missing field or an out-of-range confidence fails
that record.

## UI overview

The Pipelines section (hidden entirely when pipelines are off — see Enabling the
feature) has two tabs:

- **Definitions**: a table of the project's stored pipelines plus a
  CodeMirror YAML editor for create/update. Validation happens
  server-side; the editor surfaces every returned issue inline rather than
  stopping at the first one.
- **Runs**: a 5-column Kanban workbench (Running, Awaiting context, Done,
  Stalled, Terminated) grouped by loop state, filterable by pipeline name,
  spanning every project. Runs update live over the existing CDC-backed
  event stream, the same transport the rest of the app uses for
  query invalidation, no separate SSE endpoint.

A run detail view is read-only: pipeline, session, loop state, rounds, head
SHA, per-stage status/verdict/attempt/artifacts, and the run's findings.
