# ADR-003: Transport Abstraction

## Status
Proposed

## Context
The Runtime interface currently tightly couples the execution environment (e.g., Docker, Kubernetes, Tmux) with the orchestration layer. This prevents easily swapping the underlying transport layer.

## Decision
Refactor `packages/core/src/types.ts` to support generic transport abstractions (`LocalExec | DockerExec | SSHExec`).

## Implementation
- **Affected files**: `packages/core/src/types.ts`, `packages/core/src/session-manager.ts`
- **Estimated effort**: 2-3d
- **Prerequisites**: None
- **Definition of done**: `Runtime` interface allows different connection protocols dynamically.

## Consequences
- **Positive**: Allows scaling execution out of the local machine.
- **Negative**: Increases configuration complexity for end-users.
- **Risks**: Network flakiness on remote transports could cause session tracking errors.
