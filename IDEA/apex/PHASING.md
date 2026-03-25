# APEX Phase 1-3 Implementation Roadmap

This document defines the 3-phase implementation roadmap for the APEX architecture. Each phase expands the agent's capability surface independently and serves as a foundation for subsequent tiers.

---

## Phase 1: Minimum Viable Agent (MVP)
**Focus**: A working single-agent system with basic quality checks.

### Target Capability
- Take a developer task and plan it (linear steps, no DAG).
- Execute the task sequentially on a local filesystem.
- Run the first 2 quality tiers (Syntax Integrity + Semantic Correctness).
- Create a basic PR description.

### System Configuration
- **Layers Active**: L3 (Planning), L4 (Orchestration - single-mode), L5 (Local Environment), L6 (Quality - Tiers 1-2).
- **Agents Active**: Generator Agent, Critic Agent (Tier 1-2 only), Commit Agent.
- **Infrastructure**: Local git, Local shell, Anthropic/OpenAI/Gemini API.

---

## Phase 2: Parallel Agent Pipeline & Brain Memory
**Focus**: Multi-agent parallelism, repository-scale context, and persistent memory.

### Target Capability
- Decompose complex tasks into Directed Acyclic Graphs (DAGs) with dependencies.
- Execute subtasks in parallel across multiple git worktrees.
- Activate all 5 context layers (C1-C5) for richer retrieval.
- Store architectural choices and failures in the APEX Brain (L2).
- Complete the 5-tier Quality Pipeline (Architectural, Security, Performance).

### System Configuration
- **Layers Active**: + L1 (Perception - LSP/Graph only), + L2 (Context Sovereignty), + L4 (Multi-Agent Orchestration), + L6 (5-Tier Critic Pipeline).
- **Agents Active**: + Architect Agent (DAG), + Security Agent (Tier 4), + Tester Agent (Tier 5).
- **Infrastructure**: Multiple git worktrees, Local Redis (for Brain/Context storage), Full LSP server support.

---

## Phase 3: Full Distributed Platform
**Focus**: Cloud execution, human gates, and production observability.

### Target Capability
- Automatically route tasks to ephmeral cloud VMs for isolation and scale.
- Implement multi-point Human Gates with interactive plan/diff review.
- Continuous action streaming (L1 - Mode C) for intent-aware context.
- Full distributed tracing and anomaly detection (L8).
- Self-healing diagnosis loops (L6.2) for failure recovery.

### System Configuration
- **Layers Active**: All layers L0 through L8.
- **Agents Active**: + Browser Agent, + Observability Agent, + Self-Healing Agent.
- **Infrastructure**: Kubernetes/Docker (for cloud VMs), Kafka/Redpanda (Event Bus), Prometheus/LangSmith (Tracing), Visual Verification (Playwright).

---

## Deferred / Research Features (v2.0+)
The following features are not part of the v1.0 specification and require dedicated research phases before being mapped to the implementation roadmap:
1. **Learned Context Summarization**: ML-based compression of long-context windows.
2. **True Semantic Merge**: AST-aware conflict resolution for parallel edits.
3. **Adaptive Model Routing**: Bandit-based selection of models based on historical pass rates.
4. **Multi-Repo Federation**: Refactoring across several repositories simultaneously.
5. **Passive Intent Inference**: Action stream processing for on-the-fly task generation.
