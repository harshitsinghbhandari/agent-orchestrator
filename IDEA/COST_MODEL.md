# Cost Model for APEX Agent Orchestrator

The system tracks LLM call costs across execution tiers. The estimated cost depends on the complexity of the DAG created by the L3 decomposer.

## Cost Breakdown by Task Complexity

| Task Complexity | Planning Calls | Generation Calls | Quality Calls | Self-Heal Calls | Total Calls | Est. Cost |
|---|---|---|---|---|---|---|
| Small (atomic) | 1 (classify) | 1 | 2 (T1-T2) | 0 | 4 | $0.20 |
| Medium (3-node DAG) | 3 (classify+decompose+deps) | 3 | 6 (T1-T2 × 3) | 1 | 13 | $0.65 |
| Large (7-node DAG) | 5 | 7 | 14 | 2 | 28 | $1.40 |
| XL (15-node DAG) | 8 | 15 | 30 | 5 | 58 | $2.90 |

**Notes:**
- **Planning Calls**: Includes atomic vs composite classification, tree decomposition, dependency analysis, and risk scoring.
- **Generation Calls**: Actual node execution by the L4 orchestration layer (1 per node).
- **Quality Calls**: L6 Quality Pipeline evaluating syntax (T1) and semantics (T2). Assumes lower risk nodes skip T3-T5.
- **Self-Heal Calls**: Number of retry loops (Opus-class diagnoses + retries) triggered per failed execution.

## Rate Limiting & Circuit Breakers

The system implements cost thresholds globally via the `CostTracker`:
1.  **Over-Budget Check**: Halts execution if accumulated estimated costs USD exceed the task budget.
2.  **Anomaly Detection**: Circuit breaker trips if the cost rate suddenly spikes (e.g. recent average > 3x historical average).
