# ADR-004: Drift Validation

## Status
Proposed

## Context
Long-running agents may deviate from the original success criteria defined in the DAG plan.

## Decision
Implement a Drift Validator that compares action context against DAG success criteria every 5 tool calls with a semantic similarity score.

## Implementation
- **Affected files**: `packages/core/src/lifecycle-manager.ts`, `packages/core/src/decomposer.ts`
- **Estimated effort**: 5-7d
- **Prerequisites**: ADR-002
- **Definition of done**: Agent is paused if drift score drops below the confidence threshold.

## Consequences
- **Positive**: Prevents agents from wasting budget on unrelated rabbit holes.
- **Negative**: Adds 20% overhead on inference costs.
- **Risks**: High false-positive rates could erroneously interrupt valid exploratory coding paths.
