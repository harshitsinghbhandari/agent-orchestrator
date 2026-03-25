# Layer L8 — Observability

## Status
⚠️ **PARTIALLY SPECIFIED**
- SPEC sections: Distributed Tracing Trace-ID/Span-ID schema, Per-Task Cost Report, Per-Agent Performance Dashboard.
- UNDERSPECIFIED sections: **Circuit Breaker state transitions** (Closed → Open logic), Anomaly detection implementation location (Agent vs Collector), Metric scrape frequency justification.

## Purpose
The sensory memory and diagnostic layer. Provides full distributed tracing, cost-per-decision tracking, and anomaly detection to ensure system health and accountability.

## Inputs
- **Typed Events**: From the L4 Event Bus (all operations).
- **Model Usage**: Token counts and model IDs from L0.
- **System Metrics**: L5 Pod CPU/Memory, L4 latency.

## Outputs
- **Tracing Dashboard**: Visualization of the task execution span.
- **Anomaly Alerts**: Circuit breaker trips for looping or high-cost agents.
- **Aggregated Reports**: Per-project cost trends and quality pass rates.

## Internal Architecture

### 1. Unified Trace Schema (OTel-Compatible)
Every APEX event emits a span containing:
- `trace_id`: Task-level UUID.
- `span_id`: Operation UUID.
- `model_used`: ID from L0.
- `cost_usd`: Estimated cost.
- `critic_tier_results`: PASS/FAIL per tier.
- `tool_calls`: Metadata + results hash.

### 2. Anomaly Detection & Circuit Breakers
| Anomaly | Response |
|---|---|
| **Retry Loop** (>3) | Trip breaker; Activate Self-Healing or Human Gate. |
| **Cost Spike** (>3x) | Trip breaker; Request budget approval from dev. |
| **Hanging Node** (>10m) | Kill Pod; Re-spawn with lower model or shorter context. |

## Failure Modes
| Mode | Detection | Degradation | Recovery |
|---|---|---|---|
| **Collector Outage** | Span drop / Buffer overflow | Loss of audit/tracing data. | Buffering (local logs); Switch to emergency logging. |
| **False Anomaly Trigger** | Frequent circuit breaker trips | Task throttled/blocked unnecessarily. | Tune detection thresholds in L8 config. |
| **Cost Calculation Drift** | Pricing mismatch vs API | Inaccurate cost reporting. | Sync pricing JSON with official API rates weekly. |

## Resource Requirements
- **Compute**: Metric collection (low); Dashboard UI (medium).
- **Storage**: OTel Collector database (e.g., Prometheus/Jaeger).
- **Latency**: No-blocking span emission (<1ms).

## Dependencies
- OpenTelemetry Collector.
- Prometheus / Granfana (or equivalent).

## Phase Mapping
- **Phase 1**: Local trace logging (JSON) only.
- **Phase 3**: Full distributed platform dashboard and anomaly alerting.

## Open Questions
- Does Layer 8 use LangSmith (LangChain-specific) or a vendor-neutral OTel solution?
- Where are the circuit breaker state thresholds stored—centrally or in the L4 orchestrator?
- How is "Developer Trust" (from L7) reconciled with "Agent Quality pass rate" in L8?
