# `ao reset` — implementation notes

This doc explains what `ao reset` does, how it does it, what it intentionally
leaves alone, and the reasoning behind each design choice. Source lives at
`packages/cli/src/commands/reset.ts`. Tests at
`packages/cli/__tests__/commands/reset.test.ts`.

## What it solves

AO accumulates per-project state across several disjoint persistence layers:
the V2 storage directory, the global config registry, the portfolio
preferences file, and the shared activity-events SQLite log. Recovering from
a corrupted local state used to require manual `rm -rf` plus surgery on
`config.yaml` and `preferences.json`. `ao reset` does that cleanup
atomically per project, with a preview, a confirmation, and a session-kill
step so we don't pull files out from under a running agent.

## Surface

```
ao reset [project]
ao reset -p <project>
ao reset --all
ao reset --yes               # skip the confirmation prompt
```

Behaviors:

- No selector + single-project config → use that project.
- No selector + multi-project config → match the project whose `path`
  contains the current working directory (`findProjectForDirectory`). If no
  match, refuse with the list of valid project IDs.
- `[project]` and `-p <id>` are equivalent. Passing both with **different**
  values is rejected.
- `--all` cannot be combined with a positional project or `-p` — rejected.

## What it removes

For each targeted project, in order:

1. **Live sessions.** `SessionManager.list(projectId)` enumerates the
   project's sessions, then `SessionManager.kill(id)` is called per session.
   `kill()` synchronously destroys the runtime (tmux/process), removes the
   AO-managed worktree, deletes the agent's native session record (e.g.
   OpenCode), and writes a terminated lifecycle entry to metadata. Failures
   are swallowed per-session — a session that's already dead must not block
   a reset.
2. **V2 storage directory.** `getProjectDir(projectId)` →
   `~/.agent-orchestrator/projects/<projectId>/`. Removed via
   `rmSync(baseDir, { recursive: true, force: true })`. This is the bulk of
   the wipe — sessions, worktrees, feedback reports, orchestrator runtime
   state, agent JSONL logs, etc.
3. **Global config registry.** If `loadGlobalConfig().projects[projectId]`
   exists, `unregisterProject(projectId)` removes the entry and prunes
   `projectOrder`. Without this, the dashboard would re-discover the project
   on next launch and the user would see an "empty" project they thought
   they had wiped.
4. **Portfolio preferences.** `updatePreferences()` removes
   `prefs.projects[projectId]`, drops the project from `prefs.projectOrder`,
   and clears `prefs.defaultProjectId` if it pointed at the removed project.
5. **Activity events.** `deleteEventsForProject(projectId)` runs
   `DELETE FROM activity_events WHERE project_id = ?` against the shared
   SQLite log at `~/.agent-orchestrator/activity-events.db`. The DB is
   shared across projects, so per-project pruning is the only safe option.

Steps 3–5 are best-effort (try/catch). Reset is destructive by definition;
a corrupted global config or unavailable SQLite must not block disk
cleanup, which is the most user-visible outcome.

## What it intentionally does NOT remove

- **The repo on disk** (`projectConfig.path`) and the project's
  `agent-orchestrator.yaml`. Reset is for AO state, not the user's code.
- **Legacy V1 storage** (`~/.agent-orchestrator/<storageKey>/`) for projects
  that were migrated to V2. Reset operates on V2 paths only. Users who
  reset post-migration may have orphaned V1 dirs; cleaning these up is the
  V2 migration's responsibility, not reset's.
- **The shared observability directory**
  (`~/.agent-orchestrator/<hash>-observability/`). It can hold data for
  multiple projects sharing the same config file, so wiping it on a
  per-project reset would corrupt unrelated projects' history.
- **Bun temp dir** (`~/.agent-orchestrator/.bun-tmp/`). Shared, not
  project-scoped.

These exclusions are documented in the file-top docstring of `reset.ts` so
they don't drift from intent.

## Safety guards

### Don't reset under a live `ao start`

Before doing anything, `getRunning()` reads `~/.agent-orchestrator/running.json`
to find the currently-active `ao start` process. If the targeted project
appears in `running.projects`, reset refuses with a non-zero exit and a
suggestion to run `ao stop <project>` first.

This guard exists because the orchestrator polls session metadata files in
the V2 storage dir on a 5-second cadence. Wiping the dir under it produces
EBUSY errors, half-killed sessions, and inconsistent dashboard state. The
fix is "stop first," not "make the daemon resilient to the rug being
pulled."

### Confirmation in interactive contexts only

The destructive prompt (`promptConfirm`) only fires for human callers
(`isHumanCaller()` from `caller-context.ts`). Non-human callers (CI, agent
spawn scripts) **must** pass `--yes`; reset refuses with a clear error
otherwise. The intent is symmetric with the rest of the CLI: anything
destructive that can't be undone requires explicit consent, and machines
don't get to give consent implicitly.

### Honest exit codes

The per-target loop tracks each `rmSync`'s outcome. If any target fails to
remove its directory, reset prints a `Reset finished with N failures`
summary listing each failure, then exits with code 1. This matters because
shell wrappers (CI pipelines, outer agents) treat exit code as the
authoritative signal — printing "✓ Reset complete" while exiting 0 after a
silent failure was the original bug this rework fixed.

## Output contract

Successful path:

```
The following project state will be deleted:

  my-app:
    /Users/<you>/.agent-orchestrator/projects/my-app/
      sessions (24.3 KB)
      worktrees (412.1 MB)
    + global registry entry + portfolio preferences

? This will permanently delete the above project state. Continue? (y/N)

Resetting my-app...
  Killed 2 live sessions
  ✓ Removed /Users/<you>/.agent-orchestrator/projects/my-app
  Unregistered from global config + portfolio preferences
  Removed 17 activity events

✓ Reset complete.
```

Failure path:

```
Resetting my-app...
  ✗ Failed to remove /Users/<you>/.agent-orchestrator/projects/my-app: EBUSY: resource busy

✗ Reset finished with 1 failure:
  - my-app: EBUSY: resource busy
```

Exit code: 0 on full success, 1 on any failure or refusal.

## Type usage

The action signature uses `LoadedConfig` (the runtime shape returned by
`loadConfig()`) instead of bare `OrchestratorConfig`. This keeps the
`configPath`/`degradedProjects` fields available to future callers without
re-typing. Helper functions that don't touch those fields take a plain
`projectId: string` to avoid coupling.

## Test isolation

The test file at `packages/cli/__tests__/commands/reset.test.ts` uses
`vi.mock("node:os", ...)` to redirect `homedir()` to a per-test tmpdir.
Setting `process.env.HOME` is **not sufficient** under Vitest — libuv
reads HOME via a path that doesn't always honor the test-time env mutation
on all platforms, and tests would silently touch the user's real
`~/.agent-orchestrator/projects/`. Mocking `homedir` is the only reliable
isolation. Globals (`loadGlobalConfig`, `updatePreferences`,
`deleteEventsForProject`) are mocked at the `@aoagents/ao-core` boundary so
the tests never touch the global registry or SQLite.

## Failure modes worth knowing

- **Worktree locked by an editor or attached terminal.** `SessionManager.kill`
  swallows workspace destroy errors silently. The subsequent `rmSync` then
  hits the locked path and fails. Today this surfaces as a per-target
  failure with a non-zero exit. A future enhancement would be to retry
  after a short backoff or surface the locking PID.
- **SQLite unavailable** (`better-sqlite3` failed to load). Activity event
  pruning is a no-op. Disk cleanup still happens.
- **Corrupted global config**. The `loadGlobalConfig` call is wrapped in
  try/catch. Reset proceeds and skips the unregister step.

## Why not extend the scope further?

The review caught a tension between "wipe everything project-related" and
"don't trash unrelated projects' data." The chosen line is: anything keyed
strictly by `projectId` (V2 dir, registry entry, prefs slot, events rows)
gets wiped. Anything shared across projects via a different key (the
observability hash, the bun temp dir, legacy storage that may belong to a
no-longer-configured project) is left alone. The docstring documents this
explicitly so future contributors don't accidentally widen the blast
radius.
