# ADR-002: DAG-Aware Decomposer

## Status
Implemented

## Context
The task decomposer (`decomposer.ts`) builds a tree of tasks using hierarchical depth. This cannot express cross-branch dependencies (e.g., "frontend requires backend endpoint"). A flat tree limits parallel execution only to explicitly independent sibling nodes, stalling otherwise parallelizable work.

## Decision
Extend the decomposer to output a Directed Acyclic Graph (DAG) instead of a simple tree. Add a second LLM pass that maps node dependencies (`depends_on`). Add cycle detection (Kahn's algorithm) and fallback re-planning.

## Implementation
- **Affected files**: `packages/core/src/decomposer.ts`, `packages/core/src/dag-scheduler.ts`, `packages/core/src/dag-executor.ts`
- **Estimated effort**: 3-5d
- **Prerequisites**: ADR-001
- **Definition of done**: Parallel execution schedules correctly according to arbitrary DAG topologies.

## Consequences
- **Positive**: Correct concurrent scheduling of complex tasks without blocking on unrelated subtasks.
- **Negative**: Adds a second LLM pass to planning.
- **Risks**: Cycle detection failures could cause infinite planning loops if the LLM refuses to break a cycle.
