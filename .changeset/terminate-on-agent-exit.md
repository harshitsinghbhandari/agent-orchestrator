---
"@aoagents/ao-core": patch
---

fix(core): auto-terminate sessions when the agent exits but the runtime stays alive

Previously, when an agent process exited while its tmux runtime stayed alive (keep-alive shell), the lifecycle treated `runtime=alive` + `process=dead` as a signal disagreement, ran the detecting cycle, and parked the session at `stuck`/`probe_failure` indefinitely — leaving it lingering on the dashboard sidebar. When the native activity signal and the process probe both agree the agent has exited, the session now terminates directly with reason `agent_process_exited`. Closes #1933 and #1966.
