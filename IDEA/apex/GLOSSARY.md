# APEX Glossary

## Hierarchies and Entities

### Task Entities
- **Task**: The top-level developer request (e.g., "Implement OAuth2").
- **DAG Node**: A single, atomic operation within a task's Directed Acyclic Graph (DAG). It represents a discrete work unit with defined dependencies, risk scores, and parallelism potential.
- **Subtask**: (Deprecated) Use **DAG Node** instead.

### Agent Entities
- **Agent Type**: A role definition (e.g., "Architect Agent"). It specifies a capability surface, a set of allowed tools, and a default model tier.
- **Agent Instance**: A specific execution of an agent type. It has a unique `agent_id`, a `trust_score`, and an assigned `DAG Node`.
- **Agent Pod**: The ephemeral runtime environment (Docker container or KVM) in which an **Agent Instance** executes. It is destroyed post-task.

### Storage Entities
- **APEX Brain**: The project's persistent, cross-session knowledge store. It is organized into versioned namespaces: `decisions/`, `failures/`, `patterns/`, `dependencies/`, and `preferences/`.
- **Knowledge Item (KI)**: A single entry in the APEX Brain.
- **Session Context**: The transient, memory-only state of a single developer task, organized into **Context Tiers** C1-C5.

---

## Technical Terms

- **Context Tier**: A specific layer in the 5-layer weighted context assembly system (C1-C5).
- **System Layer**: One of the 9 foundational layers of the APEX architecture (L0-L8).
- **Event**: A JSON-serializable structured message emitted to the **Typed Event Bus**. APEX uses events for all inter-layer and inter-agent communication.
- **Quality Tier**: A sequential stage in the 5-tier critic pipeline (Syntax, Semantic, Architectural, Security, Performance).
- **Critic**: A specialized **Agent Instance** responsible for evaluating an artifact against a **Quality Tier**.
- **Human Gate**: A blocking checkpoint in the DAG that requires manual developer approval or feedback.
- **Plan Document**: The visual representation and detailed data structure of a task's execution DAG, rendered for human review.
- **Code Artifact**: A developer-authored file revision produced by a **Generator Agent**.
- **Trust Score**: A numeric value [0.0, 1.0] assigned to an **Agent Instance** based on historical performance, used to gate access to critical tools.
- **Risk Score**: A numeric value [0.0, 1.0] assigned to a **DAG Node** indicating its potential for architectural disruption or security impact.
- **Confidence Score**: An agent's self-assessed certainty [0.0, 1.0] for a specific output, used to trigger **Human Gates**.
- **Semantic Merge**: An (Aspirational) process that merges code changes based on intent and AST structure rather than textual diffs.
