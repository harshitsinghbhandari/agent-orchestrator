---
"@aoagents/ao-cli": minor
"@aoagents/ao-core": patch
---

Add `ao reset` command to wipe a project's local AO state. Removes the project's V2 storage directory (sessions, worktrees, feedback reports, orchestrator runtime), unregisters the project from the global config + portfolio preferences, and prunes the project's rows from the activity events SQLite log. Refuses to run while `ao start` is serving the targeted project. Supports `[project]` positional, `-p <id>`, `--all`, and `--yes`.

Core: adds `deleteEventsForProject(projectId): number` to `events-db.ts` so callers can remove a single project's activity events without touching unrelated rows.
