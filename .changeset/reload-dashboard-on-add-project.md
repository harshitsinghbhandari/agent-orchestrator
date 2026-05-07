---
"@aoagents/ao-cli": patch
---

Fix dashboard 404 after adding a project from the "AO is already running" menu. The CLI now notifies the running daemon to reload its cached config so the new project's page is reachable immediately.
