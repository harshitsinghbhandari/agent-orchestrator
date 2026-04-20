---
"@aoagents/ao-web": patch
---

Reduce direct-terminal mux noise by suppressing expected tmux session lookup misses, de-duplicating concurrent terminal opens, and retrying brief attach races before reporting a real terminal-open failure.
