# IFCH-01: Artifact SSA (Static Single Assignment) System

## Status: 🟢 **FEASIBLE (HIGH PRIORITIY)**

## 1. The Core Objective
To replace the traditional model of **shared mutable artifacts** (where agents "edit" files in place) with an **SSA-driven versioned model**. Every agent operation creates a new, immutable subscripted version of an artifact, which is then explicitly "used" by downstream agents in a Directed Acyclic Graph (DAG).

## 2. Feasibility Breakdown by Layer

### Layer L3 (Planning Intelligence)
*   **The Task**: L3 must not only decompose tasks but also assign **subscripted identifiers** (e.g., `auth.py@v1`) to every input and output in the DAG.
*   **Feasibility**: **High**. LLMs (Opus/Sonnet) are highly capable of generating and tracking structured identifiers when provided with a strict schema (e.g., JSON-mode). Dominance Frontier calculation for $\phi$-node (merge) placement is a standard graph algorithm that can be implemented as a deterministic L3-post-processing step.

### Layer L4 (Agent Orchestration)
*   **The Task**: The **Event Bus** must route events containing explicit version metadata (`TASK_COMPLETED: {file: "X", version: "v2", previous: "v1"}`).
*   **Feasibility**: **High**. This is a simple schema update to the `event_bus_schema.md`. The orchestration logic effectively becomes a **Dataflow Processor**, matching "ready" versions to waiting consumers.

### Layer L5 (Execution Environment)
*   **The Task**: L5 must enforce **single-write semantics**. An agent should only be able to write to its assigned output version and should have read-only access to its input versions.
*   **Feasibility**: **Medium/High**. Can be implemented via Docker volume mounting or ephemeral Git worktrees. Each "Agent Pod" is given a sandbox where the target file exists only as a "new definition." Attempting to mutate a base-version file triggers a sandbox violation.

### Layer L2 (Context Sovereignty)
*   **The Task**: L2 must serve context from a **version-indexed store**. It must also perform "Dead Artifact Elimination" by tracking which versions no longer have downstream consumers.
*   **Feasibility**: **High**. L2 already manages a cache. Moving from `key=filename` to `key=(filename, version)` is a low-complexity state change. Liveness tracking is a simple reference-counting mechanism derived from the L3 DAG.

## 3. Implementation Blueprint (Phase 1 → Phase 2)

### Level 1: SSA-Aware L3 (The "Naming" Phase)
-   Modify L3's prompt to include the subscripting requirement.
-   L3 generates a **Dependency Manifest** for every node.
-   **Output**: A DAG where `node[i].outputs` are unique `artifact@v[i]` strings.

### Level 2: Versioned Sandboxing (The "Enforcement" Phase)
-   In L5, every agent work session is initialized with its specific inputs.
-   The session's only writable output is the assigned version path.
-   **Result**: Zero race conditions between parallel agents.

### Level 3: $\phi$-Node Orchestration (The "Integration" Phase)
-   Implement the $\phi$-node as an **Integration Agent**.
-   When the DAG shows `auth@v3 = φ(auth@v1, auth@v2)`, L4 triggers a specialized merge agent.
-   The merge agent receives both `v1` and `v2` as context and outputs `v3`.

## 4. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Storage Bloat**: Thousands of artifact versions consume disk space. | **L2 Dead Artifact Elimination**: Automatically prune old versions that aren't on any branch's critical path. |
| **L3 Naming Errors**: LLM loses track of version subscripts in large DAGs. | **L3-Validator**: A deterministic graph-checker that validates the "Static Single Assignment" invariant before `DAG_LOCKED`. |
| **Increased Latency**: $\phi$-nodes add "integration delay" to parallel tiers. | **Fast-Track φ**: If file impact sets are disjoint, the $\phi$-node becomes an "identity merge" (concatenation/no-op) which executes in <1s. |

## 5. Feasibility Verdict
The **SSA-Artifact Model** is the single most important architectural "guardrail" for APEX. It transforms the chaotic problem of multi-agent consistency into a structured **Compiler IR problem**. 

**Recommendation**: Elevate this to **CORE SPEC** for Phase 2.
