# L8 Observability Stub

## Concept
The simplest implementation of the Observability and Telemetry layer. Uses the existing local `observability.ts` structured JSON logger instead of a distributed tracing system like Jaeger or LangSmith.

## Implementation Strategy
Already implemented:
```typescript
// See packages/core/src/observability.ts
export function createProjectObserver(config, componentName) {
  // Writes to ~/.agent-orchestrator/.../observability/metrics.jsonl
}
```

## Limitations vs. Full L8 Spec
- No distributed trace ID propagation across multi-machine nodes.
- No real-time dashboard or time-series database integration (Prometheus/Grafana).
- No historical anomaly detection across hundreds of sessions.
