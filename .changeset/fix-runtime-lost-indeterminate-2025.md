---
"@aoagents/ao-core": patch
---

fix(core): terminate runtime-lost sessions when the agent process probe is indeterminate (#2025)

When a tmux session vanished, `runtime.isAlive` reported a clean dead but the agent's tmux-based `isProcessRunning` threw and was mapped to `INDETERMINATE`. The lifecycle poll short-circuited on the indeterminate probe with `skipMetadataWrite`, never reaching `resolveProbeDecision`, so the session froze forever in `detecting`/`runtime_lost` on the dashboard sidebar. The poll now treats an indeterminate agent probe as dead when the runtime is authoritatively dead (a process inside a gone tmux session cannot be alive), letting the session resolve terminal. The `#1838` false-termination protection is preserved — this only fires on an authoritative dead runtime, and the recent-liveness guard still keeps a genuinely-working agent in `detecting`.
