# ADR-010: State Corruption

## Status
Implemented

## Context
Concurrent processes write metadata overlapping each other because single-file atomic renames do not provide cross-file transactionality.

## Decision
Migrate metadata storage to SQLite Database (Covered under ADR-001).

## Implementation
- **Affected files**: `packages/core/src/db.ts`
- **Estimated effort**: 3-5d
- **Prerequisites**: None
- **Definition of done**: Cross-file transactions are managed securely.

## Consequences
- **Positive**: Solved.
- **Negative**: Binary dependency.
- **Risks**: Resolved via WAL mode.
