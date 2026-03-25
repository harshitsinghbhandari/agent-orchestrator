# ADR-006: AST-Aware Semantic Merge

## Status
Proposed

## Context
Parallel execution in identical repositories leads to massive Git merge conflicts if agents touch overlapping files.

## Decision
Implement semantic merge resolution using AST patches rather than Git line diffs.

## Implementation
- **Affected files**: `packages/core/src/merge-resolver.ts`
- **Estimated effort**: 10-15d
- **Prerequisites**: ADR-002
- **Definition of done**: Sibling nodes mutating the same file structure correctly interleave logic safely.

## Consequences
- **Positive**: Enables massive vertical scaling of agent pipelines.
- **Negative**: Extemely complex implementation across multiple languages.
- **Risks**: Silent AST corruption on edge cases.
