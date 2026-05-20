---
"@aoagents/ao-plugin-agent-codex": patch
"@aoagents/ao-core": patch
---

Emit Codex hook activity observations into AO's activity log and use them as session-scoped Codex activity signals without storing raw hook payloads.
Set `AO_CODEX_HOOK_ACTIVITY=0` to skip Codex hook enablement, installation, and trust setup.
