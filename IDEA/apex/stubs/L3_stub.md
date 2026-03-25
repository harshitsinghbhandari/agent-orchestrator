# L3 Planning Stub

## Concept
The simplest implementation of the Planning layer. Uses the current `decomposer.ts` with the newly added DAG and SSA extensions from Phase 1. It does not perform continuous replanning or advanced Benders decomposition.

## Implementation Strategy
Already implemented in Phase 1:
```typescript
// See packages/core/src/decomposer.ts
// 1. classfiyTask (atomic vs composite)
// 2. decomposeTask (tree generation)
// 3. analyzeDependencies (DAG depends_on + SSA inputs/outputs mapping)
```

## Limitations vs. Full L3 Spec
- Still fundamentally top-down (tree-to-DAG), rather than a pure constraints-solver.
- Cannot actively replan mid-flight based on L6 failure events without completely restarting the tree branch.
- No LP optimization for worker routing.
