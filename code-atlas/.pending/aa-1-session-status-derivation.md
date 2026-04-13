---
title: Session Status Derivation Pipeline
discoveredIn: aa-1
updated: 2026-04-13T00:00:00.000Z
relatedFlows:
  - session-spawn-flow
  - liveness-detection-architecture
---

## Overview

`packages/core/src/lifecycle-manager.ts` contains the real status machine for live sessions, but the logic is not a clean state table. It is an ordered derivation pipeline where unrelated fact domains can overwrite each other. This flow explains the current order of operations so future debugging and redesign work has one place to point to.

## Entry Point

**Location:** `packages/core/src/lifecycle-manager.ts`

The polling loop calls `determineStatus(session)` for each non-terminal or recently-transitioned session. That function returns a single `SessionStatus`, which is then persisted to metadata and emitted as an event if it changed.

## Current Derivation Order

The current implementation is effectively:

1. Resolve project + selected agent plugin
2. Infer whether runtime identity is stable enough to probe
3. Check `runtime.isAlive(handle)`
4. Record terminal output into activity logs when possible
5. Call `agent.getActivityState(session)`
6. Fall back to terminal parsing + `agent.isProcessRunning(handle)`
7. Auto-detect PR from branch if missing
8. Query PR state / CI / review / mergeability
9. Run stuck detection from idle timestamps
10. Default to `working` or preserve some existing states on probe failure

This is not a pure state transition table. It is “first decisive branch wins”.

## Why This Matters

Several unrelated subsystems can return a terminal answer:

- runtime liveness
- activity detection
- process detection
- PR closure

Because they run in one ordered pipeline, the final status depends as much on ordering as on truth.

## Important Decision Points

### 1. Runtime Probe

If `runtime.isAlive(handle)` returns false and the session is considered safe to probe, the function returns `killed` immediately.

Implication:

- runtime reachability is currently allowed to terminate the session before agent-native activity or PR state are consulted

### 2. Activity Probe

If `agent.getActivityState()` returns:

- `waiting_input` => `needs_input`
- `exited` => `killed`
- `idle` or `blocked` with timestamp => capture timestamp for possible `stuck`

Implication:

- activity is not just descriptive; it can currently terminate the session

### 3. Terminal Fallback

If `getActivityState()` returns `null`, lifecycle falls back to:

- raw terminal parsing for `waiting_input`
- `agent.isProcessRunning(handle)` for `killed`

Implication:

- null does not mean “unknown”; it means “use weaker heuristics”

### 4. PR Overlay

If a PR is present or auto-detected, PR state can override the earlier work/liveness interpretation:

- merged => `merged`
- closed => `killed`
- failing CI => `ci_failed`
- changes requested => `changes_requested`
- approved => `approved`
- mergeable => `mergeable`

Implication:

- PR state is currently treated as part of the same status truth as runtime/process state

### 5. Stuck Detection

If earlier activity produced an idle timestamp and the configured threshold is exceeded, the result becomes `stuck`.

Implication:

- “stuck” is derived late from age, not from a first-class fact domain

## Behavior on Probe Failure

The function has several `catch` paths that preserve existing `needs_input` or `stuck` status rather than coercing back to `working`. This is a useful guardrail, but it is also a signal that the model is compensating for unreliable probes with status-specific exceptions.

## Known Structural Problems

1. Ordered checks are masquerading as a coherent state machine.
2. The same status enum carries workflow phase, attention, and terminal outcome.
3. Activity and liveness are not separated.
4. `null` activity causes fallback to weaker probes instead of preserving uncertainty.
5. PR closure maps directly to `killed`, which conflates policy with fact.

## Debugging Checklist

When a status looks wrong, inspect these in order:

1. `session.metadata` for `runtimeHandle`, `tmuxName`, and persisted status
2. runtime plugin `isAlive()` behavior for the exact handle being used
3. agent plugin `getActivityState()` result
4. terminal fallback path: `detectActivity()` and `isProcessRunning()`
5. PR enrichment / `detectPR()` / `getPRState()` result
6. stuck-threshold configuration and idle timestamp source

## Why This Flow Should Exist in Atlas

The spawn flow and liveness architecture docs explain pieces of the problem, but neither explains how those pieces are composed into one status answer. This flow is the missing map for anyone changing or debugging `determineStatus()`.
