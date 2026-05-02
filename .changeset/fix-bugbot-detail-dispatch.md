---
"@aoagents/ao-core": minor
---

Enrich lifecycle events with PR/issue context for webhook consumers. All events now carry `data.context` with `pr` (url, title, number, branch), `issueId`, `issueTitle`, `summary`, and `branch` when available, plus `data.schemaVersion: 2`.

Additional changes:

- Persist `issueTitle` in session metadata during spawn so it survives across restarts and is available for event enrichment.
- Refactor `executeReaction()` to accept a `Session` object instead of separate `sessionId`/`projectId` arguments.
- Add `maybeDispatchCIFailureDetails()` — when a session enters `ci_failed`, the agent receives a follow-up message with the failed check names and URLs (deduped via fingerprint so subsequent polls don't re-send the same failure set).
- `bugbot-comments` reaction dispatches an enriched message listing every automated comment inline, so the agent doesn't need to re-fetch via `gh api`.
