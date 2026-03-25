# Comparative Analysis: Current Orchestrator vs. APEX Architecture

## 1. Core Paradigm Shift

| Feature | Current Agent Orchestrator (AO) | APEX (Adaptive Parallel Execution) |
|---|---|---|
| **Primary Goal** | Managing multiple agents in parallel. | Autonomous high-fidelity software engineering. |
| **Logic Model** | Tool-centric (CLI/Dashboard wrapper). | 9-Layer Sovereignty Stack (Abstraction-first). |
| **Task Management** | Session-based (linear execution per agent). | DAG-native (dependency-aware graph execution). |
| **Isolation** | Git Worktrees (Manual or semi-automated). | Ephemeral Pods + Worktrees (Fully automated). |
| **Quality Control** | CI logs + basic tool feedback. | 5-Tier Multi-Critic Pipeline (L6 Sovereignty). |
| **Human Interface** | Supervision (watching logs on dashboard). | Confidence-Gated Collaboration (G1-G4 Gates). |
| **Memory** | None (ephemeral sessions). | **The Brain (L2)**: Persistent cross-session knowledge. |

---

## 2. Intelligence & Perception (L0-L1)
- **Current AO**: Relies on independent agents (Claude, Aider) to handle perception. It acts as the "shell".
- **APEX**: Introduces an **Intelligence Substrate (L0)** that routes tasks to different models based on complexity and a **Perception Engine (L1)** for deep, real-time codebase ingestion (LSP/Graph).

## 3. Context & Knowledge (L2)
- **Current AO**: Context is limited to what the specific agent (e.g., Claude Code) retrieves during its session. No shared memory across different issues/PRs.
- **APEX**: Implements **Context Sovereignty (L2)** with a 5-layer weighted stack (C1-C5). It remembers architectural decisions (`/decisions/`) and historical failures (`/failures/`) to prevent regression.

## 4. Orchestration & Execution (L3-L5)
- **Current AO**: Excellent at "launching" and "tracking" agents. Uses `tmux` to keep sessions alive.
- **APEX**: Moves orchestration into an **Asynchronous Typed Event Bus (L4)**. It doesn't just "start an agent"; it manages the state transition of every task node in a global execution graph.

## 5. Quality & Human Oversight (L6-L7)
- **Current AO**: Relies on the user ("You supervise from one dashboard"). If CI fails, AO can re-trigger, but it lack a structured internal "critic" system.
- **APEX**: Has an internal **Quality Sovereignty (L6)** layer that acts as its own reviewer before even showing code to a human. **Human Collaboration (L7)** is only triggered when confidence drops below a threshold.

## 6. Observability (L8)
- **Current AO**: Dashboard shows logs and status.
- **APEX**: Implements distributed tracing and cost/anomaly detection, treating every agent action as a traceable event.
