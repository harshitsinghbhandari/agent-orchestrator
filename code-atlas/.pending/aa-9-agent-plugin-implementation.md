---
title: "Implementing an Agent Plugin"
discoveredIn: aa-9
updated: "2025-04-12"
relatedFlows: []
---

## Overview

Agent plugins define how AO interacts with AI coding tools (Claude Code, Codex, Aider, OpenCode). This flow covers the required interface and common patterns.

## Directory Structure

```
packages/plugins/agent-{name}/
├── package.json          # @aoagents/ao-plugin-agent-{name}
├── tsconfig.json
└── src/
    ├── index.ts          # Plugin implementation
    └── __tests__/
        └── index.test.ts
```

## Required Exports

```typescript
// index.ts
import type { PluginModule, Agent } from "@aoagents/ao-core";

export const manifest = {
  name: "my-agent",           // Must match package suffix
  slot: "agent" as const,     // Literal type required
  description: "My AI agent",
  version: "0.1.0",
};

export function create(config?: Record<string, unknown>): Agent {
  return { /* Agent interface methods */ };
}

export function detect(): boolean {
  // Check if agent binary is available
  return existsSync("/path/to/agent");
}

export default { manifest, create, detect } satisfies PluginModule<Agent>;
```

## Critical Methods

### getLaunchCommand(config)

Returns the shell command to start the agent:
```typescript
getLaunchCommand(config: AgentLaunchConfig): string {
  const args = ["--dangerously-skip-permissions"];
  if (config.prompt) args.push("-p", shellEscape(config.prompt));
  return `my-agent ${args.join(" ")}`;
}
```

### isProcessRunning(handle)

**CRITICAL:** Must correctly identify the agent process.

```typescript
async isProcessRunning(handle: RuntimeHandle): Promise<boolean> {
  // For tmux: get TTY, search ps output
  // Regex must match ALL variants of the binary name!
  const patterns = [
    /\bmy-agent\b/i,
    /\.my-agent\b/i,      // Dot-prefixed wrappers
    /my-agent-cli/i,      // Alternative names
  ];
  // ...
}
```

**Common mistake:** Regex too strict, doesn't match actual binary.

### getActivityState(session)

Returns current activity with required state progression:

```
spawning → active ↔ ready → idle → exited
                ↘ waiting_input / blocked ↗
```

Implementation pattern:
```typescript
async getActivityState(session, thresholdMs?): Promise<ActivityDetection | null> {
  // 1. Check process (but see #95 for why this should change)
  if (!await this.isProcessRunning(handle)) return { state: "exited" };

  // 2. Check for actionable states (waiting_input, blocked)
  const activity = await checkActivityLogState(session.workspacePath);
  if (activity) return activity;

  // 3. Check native signal (agent's own JSONL/API)
  // 4. Fallback to AO activity JSONL
  return getActivityFallbackState(activityResult, activeWindowMs, thresholdMs);
}
```

### setupWorkspaceHooks(workspacePath, sessionId)

**CRITICAL for dashboard PR tracking.** Two patterns:

1. **Agent-native hooks** (Claude Code): Write to `.claude/settings.json`
2. **PATH wrappers** (others): Call `setupPathWrapperWorkspace(workspacePath)`

Without this, PRs created by agents won't appear in dashboard.

## Environment Requirements

All agents must set in `getEnvironment()`:
- `AO_SESSION_ID` — Required
- `AO_ISSUE_ID` — Optional
- Prepend `~/.ao/bin` to PATH (for wrapper agents)

## Testing Checklist

- [ ] `isProcessRunning` matches real binary names
- [ ] `getActivityState` returns all 6 states over lifecycle
- [ ] `setupWorkspaceHooks` enables PR tracking
- [ ] Tests cover regex patterns with real binary paths
