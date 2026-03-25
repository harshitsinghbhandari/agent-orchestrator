# Layer L4 — Agent Orchestration

## Status
⚠️ **PARTIALLY SPECIFIED**
- SPEC sections: Agent role separation (Architect, Generator, Critic, etc.), Isolated Git Worktree Strategy, Dead-Letter Queue (DLQ).
- UNDERSPECIFIED sections: **Semantic Merge** (deferred to v2.0), Orchestrator task scheduling algorithm, Trust Score decay/increment rules.

## Purpose
The nervous system of APEX. Routes DAG nodes to specialized agent instances, manages concurrent execution in isolated environments, and coordinates the merge of parallel diffs.

## Inputs
- **Execution DAG**: From L3.
- **Agent Availability**: Current load metrics from L8.
- **Task Events**: TASK_COMPLETED, TASK_FAILED, REVIEW_APPROVED.

## Outputs
- **Agent Commands**: Dispatched events to Layer L5 pods.
- **Merge Events**: Final integrated codebase state.

## Internal Architecture

### 1. The Agent Fleet
| Agent | Role |
|---|---|
| **Architect Agent** | DAG construction and risk scoring. |
| **Generator Agent** | Execution of code edits/writes. |
| **Critic Agent** | Mult-tier quality review (T1-T5). |
| **Self-Healing Agent** | Diagnosis and strategy adaptation. |

### 2. Parallel Execution Flow
1. **Analyze DAG**: Identify non-dependent nodes (Tier 0).
2. **Setup Worktrees**: Create isolated git worktrees per concurrent agent.
3. **Dispatch**: Assign nodes to pods via the Typed Event Bus.
4. **Coordinate Merge**: (Phase 2) Semantic or file-level merge of completed nodes.

## Failure Modes
| Mode | Detection | Degradation | Recovery |
|---|---|---|---|
| **Message Timeout** | Lack of ACK in event bus | Task stalls indefinitely. | Retry dispatch; if retry limit exceeded, trigger DLQ and Self-Healing. |
| **Agent Death** | Pod heartbeat loss | Node state becomes unknown. | Re-spawn agent pod and re-initiate task from last checkpoint. |
| **Merge Conflict** | Git merge tool error | Parallel state cannot integrate. | Escalate to Architect Agent for "Conflict Resolution Mode." |

## Resource Requirements
- **Compute**: Orchestration logic (low); agent pods (high - see L5).
- **Message Queue**: At-least-once delivery guarantee (e.g., Redis).
- **Latency**: Bus propagation <10ms.

## Dependencies
- Typed Event Bus implementation.
- Agent image/pod registry.

## Phase Mapping
- **Phase 1**: Single-agent execution (no parallelism).
- **Phase 2**: Multi-agent parallelism with isolated worktrees and file-level merge.
- **Version 2.0**: Advanced Semantic Merge.

## Open Questions
- What is the hard cap for concurrent agent pods per developer session?
- How is "Trust Score" persisted—is it per agent-type or per session?
- What are the precise event schemas for AGENT_SPAWN and MERGE_INITIATED?
