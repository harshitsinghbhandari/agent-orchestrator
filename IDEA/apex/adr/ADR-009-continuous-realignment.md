# ADR-009: Continuous Intent Realignment

## Status
Proposed

## Context
Agents often start with good intent but lose track of high-level goals.

## Decision
Checkpoints every N steps to validate current trajectory against original success criteria.

## Implementation
- **Affected files**: `packages/core/src/lifecycle-manager.ts`
- **Estimated effort**: 5-7d
- **Prerequisites**: ADR-004
- **Definition of done**: Validation step guarantees realignment dynamically.

## Consequences
- **Positive**: Tighter control loops.
- **Negative**: Inference overhead.
- **Risks**: Slows down fast workflows unnecessarily.
