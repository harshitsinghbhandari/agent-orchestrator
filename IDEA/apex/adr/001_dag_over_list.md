# ADR-001: DAG (Directed Acyclic Graph) for Task Decomposition

## Status
✅ **ACCEPTED**

## Context
Traditional AI coding agents use linear step-by-step lists for task decomposition. This assumes that all subtasks are sequential and depends on the model to "guess" parallelism at runtime. This lack of structure leads to:
- Merge conflicts when multiple agents touch related code.
- Deterministic execution issues (ordering isn't enforced).
- Latency (unable to scale out across parallel cores/pods).

## Decision
APEX will use a **Directed Acyclic Graph (DAG)** as its fundamental planning primitive. Each task is decomposed into a set of nodes with:
- **Explicit Dependencies**: A node can only start if its parents are complete and merged.
- **Risk Assessment**: High-risk nodes can be serialized for safety.
- **Parallelism Strategy**: Nodes with no shared dependencies and disjoint file impact sets execute in parallel.

## Alternatives Considered
- **Linear Checklist**: Simple to implement but lacks scalability and coordination.
- **Hierarchical Tree**: Good for grouping but doesn't model cross-branch dependencies effectively.
- **Manual Control (Human)**: Too slow for autonomous agent execution.

## Consequences
- **Positive**: Enables safe concurrency, deterministic auditing, and predictable latency.
- **Negative**: Increases the complexity of the **Architect Agent (L3)** and require more initial planning tokens.
- **Neutral**: Requires the **Merge Coordinator (L4)** to be aware of the graph topology.

## Implementation Notes
- The DAG is represented as a JSON artifact containing a topological sort of nodes.
- Circular dependencies are prevented by static analysis before the `DAG_LOCKED` event.
- Visual review of the DAG is mandatory for Large/XL tasks in **Plan Mode**.
