---
title: Session Spawn Flow
discoveredIn: aa-9
updated: 2026-04-12T09:55:59.935Z
relatedFlows:
  - liveness-detection-architecture
---

## Overview

Understanding the spawn flow is critical for debugging "session killed immediately after spawn" (#70) and "prompt not sent" (#91) issues.

## Spawn Sequence

```
ao spawn <issue-id>
    │
    ├─ 1. Validate issue exists (tracker.getIssue)
    │
    ├─ 2. Reserve session identity (atomic file lock)
    │      └─ Creates: ~/.agent-orchestrator/{hash}/sessions/{id}/
    │
    ├─ 3. Create workspace (worktree plugin)
    │      └─ git worktree add ~/.agent-orchestrator/{hash}/worktrees/{id}/
    │
    ├─ 4. Setup workspace hooks (agent.setupWorkspaceHooks)
    │      └─ Installs PATH wrappers or agent-native hooks
    │
    ├─ 5. Create runtime (runtime.create)
    │      └─ tmux new-session -d -s {tmuxName} -c {workspacePath}
    │
    ├─ 6. Write metadata (status: "spawning")
    │
    ├─ 7. Post-launch setup (agent.postLaunchSetup)
    │      └─ Agent-specific initialization
    │
    ├─ 8. Wait for agent ready (if promptDelivery: "post-launch")
    │      └─ Poll terminal output for agent prompt character
    │
    └─ 9. Send prompt (runtime.send → tmux send-keys)
```

**Code location:** `packages/core/src/session-manager.ts:1123-1480`

## Race Condition Window

Between steps 5-6 and step 9, the lifecycle manager may poll:

```
Step 5: Runtime created (tmux session exists)
Step 6: Metadata written (status: "spawning")
    │
    │  ← LIFECYCLE POLL HAPPENS HERE
    │     • runtime.isAlive() → true (tmux exists)
    │     • getActivityState() → null (no JSONL yet)
    │     • isProcessRunning() → false (agent not started)
    │     → Returns "killed" ← FALSE POSITIVE
    │
Step 9: Prompt sent (never happens, session already killed)
```

## Prompt Delivery Modes

Agents declare how they receive prompts:

| Mode | Behavior | Agents |
|------|----------|--------|
| `inline` | Prompt passed as CLI arg (`-p "..."`) | Codex |
| `post-launch` | Prompt sent via tmux after agent starts | Claude Code, Aider |

For `post-launch`, AO waits for the agent to show its prompt character before sending.

## Common Failures

### 1. Agent Not Ready When Prompt Sent

**Symptom:** Session created but agent has no instructions.
**Cause:** `tmux send-keys` is fire-and-forget; agent may not be listening.
**Debug:** Check terminal output — is the prompt visible?

### 2. Session Killed During Spawn

**Symptom:** Session immediately shows "killed" status.
**Cause:** Lifecycle poll during spawn window (see above).
**Debug:** Check timing — did poll happen before agent process started?

### 3. Workspace Hooks Not Installed

**Symptom:** Agent works but PRs don't appear in dashboard.
**Cause:** `setupWorkspaceHooks` failed silently.
**Debug:** Check `.ao/AGENTS.md` exists in workspace, or `.claude/settings.json` for Claude.

## Key Files

- `session-manager.ts:1123` — `spawn()` function entry
- `session-manager.ts:1298` — Runtime creation
- `session-manager.ts:1429` — Prompt delivery for post-launch agents
- `lifecycle-manager.ts:406` — Where false kills happen during spawn

## Related Issues

- #70: Session killed immediately after spawn
- #91: Spawn doesn't always send prompt
- #96: Add spawn confirmation loop (proposed fix)
