# Layer L3 — Planning Intelligence

## Status
⚠️ **PARTIALLY SPECIFIED**
- SPEC sections: Intent Classifier [Feature | Bug Fix | Refactor | Test | Docs], Complexity Routing (Fast vs Plan Mode), Plan Artifact structure.
- UNDERSPECIFIED sections: **DAG Construction Algorithm** (prompting/logic for decomposition is missing), Risk Scoring methodology (unquantified scale), Fallback selecting logic per node.

## Purpose
The primary reasoning engine of APEX. Decomposes high-level requests into an executable Directed Acyclic Graph (DAG) with explicit dependencies, parallelism flags, and risk assessments.

## Inputs
- **User Request**: Raw developer intent.
- **Context Payload (C1-C5)**: From L2.
- **LSP State**: From L1 (entry points and symbols).

## Outputs
- **Plan Document**: Human-readable DAG for review (Phase 3).
- **Execution DAG**: Immutable contract for Layer L4 (Tier 0-N nodes).

## Internal Architecture

### 1. Intent Classifier & Complexity Routing
- **Small/Medium Tasks**: Route to **Fast Mode** (no formal plan document).
- **Large/XL Tasks**: Route to **Plan Mode** (full DAG artifact generation and human review).

### 2. DAG Construction Protocol
Each node in the DAG must declare:
- `node_id`: Unique identifier.
- `depends_on`: List of `node_id`s.
- `parallelizable`: Boolean flag.
- `risk_score`: [0.0 - 1.0] assessment.
- `agent_type`: Assigned specialist agent (from `agent_fleet.md`).
- `fallback_path`: Alternative node/strategy if primary fails.

## Failure Modes
| Mode | Detection | Degradation | Recovery |
|---|---|---|---|
| **Cyclical DAG** | Static analysis at build time | Plan cannot execute. | Re-run Architect Agent with loop-prevention constraints. |
| **Incorrect Decomposition** | Critic failures (L6) or human rejection | Incomplete implementation across nodes. | Refine plan artifacts based on feedback; re-decomposed. |
| **Ambiguity (<85% conf)** | In-inference confidence flag | Execution of wrong intent. | Trigger Human Gate (L7) for clarification. |

## Resource Requirements
- **LLM Calls**: 1-2 calls per task (Opus-class).
- **Compute**: Graph topological sort (negligible).

## Dependencies
- LLM (L0 Deep tier).
- Repository graph state (L1).

## Phase Mapping
- **Phase 1**: Sequential planning only (no DAG).
- **Phase 2**: Full DAG construction with parallelism metadata.
- **Phase 3**: Plan Artifacts with Mermaid visualization and interactive human review.

## Open Questions
- What formal graph specification (e.g., DOT/JSON) is used for the DAG?
- How is the "risk score" calculated—is it purely based on file impact count?
- How does the Architect Agent model "parallelism potential" for overlapping files?
