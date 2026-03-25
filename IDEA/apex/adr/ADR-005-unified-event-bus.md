# ADR-005: Unified Typed Event Bus

## Status
Proposed

## Context
Component interactions in the orchestrator rely heavily on synchronous function calls.

## Decision
Adopt a typed event bus to decouple layers and support async, distributed components.

## Implementation
- **Affected files**: `packages/core/src/event-bus.ts`
- **Estimated effort**: 7-10d
- **Prerequisites**: None
- **Definition of done**: Core events transition to an event-driven architecture with DLQ support.

## Consequences
- **Positive**: Decouples services, provides native observability.
- **Negative**: Increases system latency.
- **Risks**: Event bus becomes a single point of failure.
