# ADR-007: Passive Intent Inference

## Status
Proposed

## Context
Developers must explicitly declare tasks.

## Decision
Capture terminal history and stream local intent using a low-latency small ML model to predict what the user is working on.

## Implementation
- **Affected files**: `packages/core/src/terminal-capture.ts`
- **Estimated effort**: 14d
- **Prerequisites**: ADR-005
- **Definition of done**: Predictive intent is streamed into the L2 context window automatically.

## Consequences
- **Positive**: Zero-touch context population.
- **Negative**: Requires continuous ML inference.
- **Risks**: Privacy and security concerns streaming terminal output to models.
