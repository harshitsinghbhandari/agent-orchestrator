# L4 Orchestration Stub

## Concept
The simplest implementation of the Orchestration layer. Uses the Phase 1 `dag-executor.ts` to spin up parallel sessions based on the L3 DAG.

## Implementation Strategy
Already implemented in Phase 1:
```typescript
// See packages/core/src/dag-executor.ts
// Computes DAG tiers using dag-scheduler.ts
// Executes nodes in each tier via Promise.all(sessionManager.spawn)
```

## Limitations vs. Full L4 Spec
- Hard-coded local concurrency instead of dynamic cloud worker provisioning.
- Does not use the Unified Typed Event Bus for dispatching.
- No intelligent rate-distortion curve optimization.
