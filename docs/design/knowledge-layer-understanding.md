# AO Knowledge Layer — Current Understanding

Date: 2026-05-10

This document captures the current understanding of the proposed AO memory / knowledge layer before implementation begins.

## Status

- **Designed, not implemented**
- No PR
- No branch in this repo
- No issue in this repo
- No code changes in this repo yet

The design was originally driven by Adil on April 4 and approved by Dhruv around April 5. Implementation has not been picked up yet.

## Sources reviewed

### External design artifacts

- Public design repo: `github.com/i-trytoohard/ao-knowledge-layer`
- Design doc: `~/.ao-knowledge-layer-design.md`
- Local skill reference: `~/.hermes/skills/github/ao-knowledge-layer/SKILL.md`

### Local code reviewed

- `packages/core/src/lifecycle-manager.ts`
- `packages/core/src/session-manager.ts`
- `packages/core/src/prompt-builder.ts`
- `packages/core/src/paths.ts`
- `packages/core/src/types.ts`
- existing prompt-builder tests and session-manager lifecycle tests

## What the design proposes

The design defines a three-layer memory hierarchy:

| Layer | Scope | Purpose | Status |
|---|---|---|---|
| L1 — Session Artifacts | Per-session | Raw outcomes and metadata captured at session termination | Not implemented |
| L2 — Project Knowledge | Per-project | Curated gotchas, artifact index, file affinity, agent performance | Not implemented |
| L3 — Global/User Profile | Cross-project | Environment facts and behavioral preferences across projects | Not implemented |

### Intended flow

1. A session terminates.
2. A session artifact is captured.
3. Project knowledge is derived from that artifact.
4. Global/user profile is updated asynchronously from accumulated project artifacts.
5. Future prompt assembly injects the relevant knowledge back into the agent context.

## What exists in the code today

### Prompt assembly already has a layered structure

`packages/core/src/prompt-builder.ts` already composes prompts in layers:

1. Base agent prompt
2. Project context
3. User rules
4. Task prompt

That gives us a natural seam for memory injection later, but there is no knowledge layer yet.

### Session termination already has a strong teardown seam

`packages/core/src/session-manager.ts:kill()` is the strongest integration point for termination-time capture because:

- it has access to the raw session metadata
- it runs before workspace destruction
- it is used for both manual kills and some automated cleanup paths

### Lifecycle polling still exists, but the design doc line reference is stale

The design references `lifecycle-manager.ts` around `~1076`, but in the current code that region is not the primary terminal-transition seam anymore.

The real lifecycle transition path is later in the file, where status transitions are detected and session cleanup can be triggered.

### Paths are already project-scoped

`packages/core/src/paths.ts` already distinguishes:

- project root
- sessions directory
- worktrees directory
- feedback reports

That makes a knowledge/profile directory addition straightforward.

## Confirmed hook points

### 1) `session-manager.ts:kill()`

Relevant region:

- starts around `packages/core/src/session-manager.ts:2023`
- runtime and workspace teardown happen after the raw session lookup
- metadata is updated near the end of the function

Why this is a good hook:

- captures the race where lifecycle polling never observes the final state
- still has access to worktree state before deletion
- can be made best-effort so termination does not depend on memory capture success

### 2) `lifecycle-manager.ts` terminal transition path

Relevant region:

- transition logic around `packages/core/src/lifecycle-manager.ts:2377-2500`
- cleanup path around `packages/core/src/lifecycle-manager.ts:2588-2591`

Why this is a good hook:

- it sees transitions detected by polling
- it can capture richer termination context than `kill()` alone
- it remains useful for sessions that end naturally rather than through explicit kill

### 3) `prompt-builder.ts`

Relevant region:

- `packages/core/src/prompt-builder.ts:180-204`

Why this is a good hook:

- it is the place where project/session context becomes agent-facing prompt text
- it can inject knowledge sections without changing the rest of session orchestration

## Important correction to the original line references

The design skill file still cites the old “terminal state transition hook” line numbers from a previous code shape.

Current understanding:

- the general hook locations are still valid
- the exact line numbers in the skill file are stale
- `kill()` is mandatory for Phase 1 because it covers the race the lifecycle poller can miss

## My current opinion on the right starting slice

I do **not** think the right first slice is “L1 only” if that means write-once archival with no replay.

The smallest useful tracer bullet is:

1. capture one versioned session artifact at termination
2. read one small project-scoped signal back into the next prompt
3. gate the whole feature behind a flag

That proves the architecture without forcing the full three-layer system into production too early.

### Why not start with full L2/L3?

Because L2 and L3 introduce the hardest unknowns too early:

- schema lock-in
- prompt budget pressure
- derived knowledge correctness
- cross-project privacy
- async update complexity

### Why not start with archival-only L1?

Because archival alone does not prove the value chain:

termination → capture → storage → retrieval → prompt effect

The architecture’s point is not just to store memories. It is to make them influence future sessions.

## Highest-risk parts of the spec

### 1) Schema lock-in

The proposed artifact and profile shapes are opinionated. If they ship without explicit versioning and compatibility handling, the project may freeze the schema too early.

### 2) Prompt budget creep

The design wants a 2000-token budget for knowledge sections, but the current prompt builder has no budget enforcement for that layer.

If history, gotchas, and related files are all injected together, they can crowd out task context.

### 3) Termination latency

Capture must happen before `workspace.destroy()`, but kill paths must remain fast and best-effort.

If capture blocks or fails, session termination should still complete.

### 4) Cross-project privacy

L3 behavior/profile data is the most sensitive part of the design. It crosses project boundaries and can reveal patterns that should not be surfaced broadly without strong controls.

### 5) Concurrent writes / atomicity

Multiple sessions can terminate close together.

Append-only JSONL is manageable, but derived JSON files need careful atomic write behavior.

## Concrete Phase 1 proposal

### Goal

Prove the memory loop with the smallest meaningful slice:

- capture a versioned artifact on termination
- persist it to a project-scoped knowledge directory
- inject one small knowledge section into the next prompt

### Scope

#### Include

- L1 artifact capture
- a project knowledge directory
- prompt replay of one small, bounded snippet
- feature flag gating
- tests for the termination path and prompt injection

#### Defer

- L3 global/user profile
- async background behavior extraction
- file-affinity clustering
- embeddings / semantic retrieval
- manual knowledge editing UX
- any large prompt-reranking system

### Suggested files to change

- `packages/core/src/paths.ts`
  - add knowledge/profile path helpers
- `packages/core/src/knowledge.ts` new
  - artifact schema v1
  - write/read helpers
  - small selector for prompt replay
- `packages/core/src/session-manager.ts`
  - capture artifact before workspace destruction
- `packages/core/src/prompt-builder.ts`
  - inject a gated knowledge section
- `packages/core/src/types.ts`
  - add new types for artifacts / knowledge records
- tests:
  - `packages/core/src/__tests__/knowledge.test.ts` or equivalent
  - `packages/core/src/__tests__/session-manager/lifecycle.test.ts`
  - `packages/core/src/__tests__/prompt-builder.test.ts`

### Suggested rollout

Use a feature flag:

- `AO_ENABLE_KNOWLEDGE_LAYER=1`

Start disabled by default.
Dogfood on one project.
Only expand once capture and replay are stable.

## Suggested test strategy

1. **Termination capture occurs before workspace destruction**
   - Assert capture runs while the worktree still exists.
   - Assert workspace destroy happens afterward.

2. **Capture is best-effort**
   - If capture fails, kill still succeeds.

3. **Artifact is versioned**
   - Include schema version in the stored artifact.

4. **Prompt injection is bounded**
   - Feature flag off: no knowledge section.
   - Feature flag on: knowledge section appears.
   - Prompt still respects a bounded size policy.

5. **Empty-store behavior is a no-op**
   - No knowledge data should not change baseline prompt output.

## Open questions

1. What exact artifact schema do we want in v1?
2. What is the minimum useful knowledge snippet for Phase 1?
3. Should replay come from the latest artifact, or a filtered subset?
4. Should the feature flag live in env only, or also in config?
5. What is the right path layout for project knowledge?
6. Should lifecycle-manager also emit artifact capture for natural completion, or is kill-path capture enough for Phase 1?

## Bottom line

Current understanding:

- the design is coherent and already approved
- the repo has the right seams
- `kill()` is the critical first hook
- prompt-builder is the second seam
- the smallest useful implementation is capture + replay behind a flag, not full L1/L2/L3 on day one

