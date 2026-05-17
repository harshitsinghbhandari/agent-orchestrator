---
"@aoagents/ao-core": minor
"@aoagents/ao-web": minor
---

feat: "Launch Orchestrator (clean context)" button on the per-project orchestrator page

Adds a new dashboard action that always replaces the project's canonical orchestrator with a fresh one — killing any existing orchestrator, deleting its metadata, and spawning a new session with no carryover state. Backed by a new `SessionManager.relaunchOrchestrator(config)` method that ignores `orchestratorSessionStrategy`. Closes #1900 and #1080.
