# Layer Contracts Specification

## Status
⚠️ **UNDERSPECIFIED**
- 100% new work (not in original monolith).
- SPEC sections: Conceptual Boundary Mappings.
- UNDERSPECIFIED sections: **Precise Typed Interfaces** for all 10 boundaries, Latency SLAs, Error Handling Protocols.

## Purpose
Establises the rigid technical boundaries between architectural layers. Every inter-layer interaction must use these contracts to prevent coupling and ensure component swap-ability.

---

## Technical Boundary Definitions (v1.0)

### 1. Model Inference Contract (L0 ↔ ALL)
- **Producer**: Any Agent Instance.
- **Consumer**: L0 Intelligence Substrate.
- **Contract**: 
  - Request: `(prompt, tier_preference, stop_sequences, json_schema)`.
  - Response: `(structured_output, confidence_score, token_usage, latency_ms)`.
  - SLA: Tier-dependent latency (Fast <2s, Balanced <10s, Deep <60s).

### 2. Perception ↔ Context Contract (L1 → L2)
- **Producer**: L1 Perception Engine.
- **Consumer**: L2 Context Sovereignty.
- **Contract**: 
  - Event: `PERCEPTION_UPDATE`.
  - Schema: `(update_type: 'symbol'|'graph'|'action', delta_blob, timestamp)`.
  - Frequency: Debounced every 100ms.

### 3. Context ↔ Plan Contract (L2 → L3)
- **Producer**: L2 Context Sovereignty.
- **Consumer**: L3 Planning Intelligence.
- **Contract**: 
  - Request: `(query_namespace, task_scope, context_depth)`.
  - Response: `(assembled_c1_c5_payload, brain_decisions_subset)`.
  - Constraint: Payload must not exceed model context window limit.

### 4. Plan ↔ Execution Contract (L3 → L4)
- **Producer**: L3 Planning Intelligence.
- **Consumer**: L4 Agent Orchestration.
- **Contract**: 
  - Payload: `EXECUTION_DAG` (topological sort of nodes).
  - Schema: `(node_id, agent_type, depends_on, risk_score, tool_grant_list)`.

### 5. Execution ↔ Environment Contract (L4 → L5)
- **Producer**: L4 Agent Orchestration.
- **Consumer**: L5 Execution Environment.
- **Contract**: 
  - Command: `AGENT_SPAWN(type, node_id, clone_ref)`.
  - Response: `AUDIT_LOG_STREAM`, `FILE_DIFF_READY`.
  - Constraint: All file changes must be emitted as `diff` events.

### 6. Quality ↔ Orchestration Contract (L6 → L4)
- **Producer**: L6 Quality Sovereignty.
- **Consumer**: L4 Agent Orchestration.
- **Contract**: 
  - Result: `CRITIC_VERDICT(tier_id, status: PASS/FAIL/WARN, evidence_blob)`.
  - Logic: L4 cannot advance a DAG node until all 5 Tiers in L6 result in PASS.

### 7. Human ↔ Orchestration Contract (L7 → L4)
- **Producer**: L7 Human Collaboration.
- **Consumer**: L4 Agent Orchestration.
- **Contract**: 
  - Signal: `GATE_RESOLVED(gate_id, result: APPROVED/REJECTED, feedback_text)`.

### 8. Observability ↔ System Contract (ALL → L8)
- **Producer**: Any Layer / Agent Instance.
- **Consumer**: L8 Observability.
- **Contract**: 
  - Trace: `SPAN_EVENT`, `METRIC_GAUGE`.
  - Schema: OpenTelemetry v1.0 standard.

---

## Error Handling Protocols
- **Timeout**: If a contract partner does not respond within SLA, the caller emits `SYSTEM_TIMEOUT` to L4.
- **Malformed Data**: Handled at Layer Entry points (Validator pattern); emits `CONTRACT_VIOLATION`.

## Open Questions
- What serialization format (JSON, Protocol Buffers, Avro) is used for high-frequency contracts (L1 → L2)?
- How are "contracts" enforced at build-time vs runtime?
- Who owns the centralized schema registry for these contracts?
