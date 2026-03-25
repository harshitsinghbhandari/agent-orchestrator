# Event Bus Schema Specification

## Status
⚠️ **PARTIALLY SPECIFIED**
- SPEC sections: Typed Event Schema, Root Taxonomy (v1.0), Priority Levels.
- UNDERSPECIFIED sections: Idempotency Key Generation Algorithm, Event Schema Versioning Strategy, Dead-Letter Queue (DLQ) processing policy.

## Typed Event Schema (Root)
Every event emitted to the APEX bus MUST follow this rigid schema to ensure inter-agent portability.

```json
{
  "event_id": "evt_sha256_unique",
  "event_type": "ENUM_TYPE",
  "source_agent": "agent_id_prefix | 'system' | 'orchestrator'",
  "target_agent": "agent_id_prefix | 'broadcast' | 'human_gateway'",
  "task_id": "task_uuid",
  "dag_node_id": "T4_unique_node_identifier",
  "parent_event_id": "parent_evt_sha256 | null",
  "trace_id": "span_uuid",
  "timestamp": "ISO8601",
  "priority": "1-5",
  "requires_ack": "boolean",
  "timeout_ms": "integer | null",
  "idempotency_key": "sha256_of_source_task_node_type_payload",
  "retry_count": "integer",
  "payload": {
    "DATA": "STRUCT_JSON"
  }
}
```

---

## Event Taxonomy (v1.0)

### 1. Task Lifecycle Events
- `TASK_RECEIVED`: Entry point for user request.
- `TASK_CLASSIFIED`: Intent + Complexity + Entry Points defined.
- `DAG_LOCKED`: Immutable execution contract finalized.
- `TASK_ASSIGNED`: Node dispatched to an Agent Pod.
- `TASK_STARTED`: Agent Pod has initialized and started work.
- `TASK_PROGRESS`: Visual feedback for human (e.g., % complete).
- `TASK_COMPLETED`: Final artifact ready for Critic (includes diff/hash).
- `TASK_FAILED`: Unrecoverable node error; triggers DLQ.
- `FINAL_COMMIT_READY`: Integrated result passed all 5 tiers.

### 2. Review & Interaction Events
- `HUMAN_GATE_TRIGGERED`: Block for human approval.
- `REVIEW_REQUESTED`: Review payload ready for human gate.
- `REVIEW_APPROVED`: Human approves; DAG node advances.
- `REVIEW_REJECTED`: Human rejects; contains feedback blob.
- `AMBIGUITY_DETECTED`: L3 confidence low; requires clarification.

### 3. State & Context Events
- `PERCEPTION_UPDATE`: New symbols/graph deltas from L1.
- `CONTEXT_REFRESHED`: Context Assembly (C1-C5) re-cached in L2.
- `BRAIN_WRITE`: New Decision/Failure/Pattern KI recorded.
- `AGENT_TRUST_UPDATED`: Agent instance score increment/decrement.

### 4. System & Quality Events
- `CRITIC_VERDICT`: T1-T5 PASS/FAIL/WARNING result.
- `SELF_HEAL_INITIATED`: Failure diagnosis protocol started.
- `DIAGNOSIS_READY`: Root cause + fix strategy found.
- `COST_THRESHOLD_EXCEEDED`: Circuit breaker trigger for budget.
- `CIRCUIT_BREAKER_TRIGGERED`: Anomaly detection trip (L8).
- `ACK`: Mandatory acknowledgment for `requires_ack` events.

---

## Priority & Delivery Guarantees
- **Priority 1 (Critical)**: `TASK_FAILED`, `CIRCUIT_BREAKER_TRIGGERED`, `ACK`. High-priority delivery (<10ms).
- **Priority 3 (Default)**: Most task lifecycle and logic events.
- **Priority 5 (Low)**: `PERCEPTION_UPDATE`. Can be debounced or discarded during load.

- **Guarantees**: At-least-once delivery with ordered processing per `(task_id, source_agent)`.

## Open Questions
- How are large file diffs handled in `TASK_COMPLETED` payloads? (Reference vs Inline)
- What is the persistence model for the event bus history (event sourcing)?
- How do we handle schema evolution between v1.0 and v2.0 without breaking running tasks?
