---
title: "Liveness Detection Architecture"
discoveredIn: aa-9
updated: "2025-04-12"
relatedFlows: []
---

## Overview

Agent Orchestrator has THREE separate systems that determine if an agent is alive. Understanding their interaction is critical for debugging false 'exited' states.

## The Three Systems

### 1. Runtime.isAlive(handle)

**Location:** `packages/plugins/runtime-tmux/src/index.ts`

Checks if the tmux session exists:
```typescript
async isAlive(handle: RuntimeHandle): Promise<boolean> {
  const { stdout } = await execFileAsync("tmux", ["has-session", "-t", handle.id]);
  return true; // If command succeeds, session exists
}
```

**What it tells you:** The tmux session exists (not that the agent process is running inside it).

### 2. Agent.isProcessRunning(handle)

**Location:** Each agent plugin (e.g., `packages/plugins/agent-claude-code/src/index.ts:477-533`)

Checks if the agent process is running via `ps`:
```typescript
// Get TTY from tmux, then find process matching regex
const processRe = /(?:^|\/)claude(?:\s|$)/;
// Match against ps output filtered by TTY
```

**What it tells you:** A process matching the agent's name pattern is running on the tmux pane's TTY.

**Common failure:** Regex doesn't match actual binary name (e.g., `.claude`, `claude-code`).

### 3. Agent.getActivityState(session)

**Location:** Each agent plugin (e.g., `packages/plugins/agent-claude-code/src/index.ts:733-794`)

Returns activity state including `exited`:
```typescript
async getActivityState(session): Promise<ActivityDetection | null> {
  const running = await this.isProcessRunning(handle);
  if (!running) return { state: "exited" };  // Declares death!
  // ... check JSONL for activity ...
}
```

**What it tells you:** Combines process check with JSONL activity data.

## The Problem: No Consensus

Each system can independently declare death:

```typescript
// lifecycle-manager.ts:406-458
if (!runtime.isAlive(handle)) return "killed";           // System 1
if (activityState.state === "exited") return "killed";   // System 3 (calls System 2)
if (!agent.isProcessRunning(handle)) return "killed";    // System 2 (fallback)
```

If ANY check fails, the session is killed. No cross-verification.

## Debugging Checklist

When a session is falsely marked as `exited`/`killed`:

1. **Check tmux session exists:** `tmux has-session -t <session-id>`
2. **Check process is running:** `tmux list-panes -t <session-id> -F '#{pane_tty}'` then `ps -t <tty>`
3. **Check process name matches regex:** The regex in the agent plugin may not match the actual binary
4. **Check JSONL has recent activity:** Look at `~/.claude/projects/*/` for recent `.jsonl` files

## Related Issues

- #70: Session killed immediately after spawn
- #80: Orchestrator shows exited while working
- #95: Unify liveness detection (proposed fix)
