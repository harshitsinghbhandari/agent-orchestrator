# ADR-003: 5-Tier Critic Pipeline for Quality Sovereignty

## Status
✅ **ACCEPTED**

## Context
A single "Critic Agent" must simultaneously evaluate multiple conflicting concerns (syntax, logic, architecture, security, performance). This leads to **Conflation Analysis**: the agent might prioritize code style over a security vulnerability or logic flaw. In existing systems, critics are often:
- **Biased**: Too lenient on logic if the code "looks" correct.
- **Inconsistent**: Different models provide different quality scores for the same code.
- **Surface-Level**: Reviewing code after generation is complete misses the underlying reasoning.

## Decision
APEX will enforce a **5-Tier Sequential Critic Pipeline**. Every code artifact must pass each independent tier before it can advance in the DAG.
- **T1: Syntactic Integrity** (Deterministic - Linters/TSC)
- **T2: Semantic Correctness** (LLM-based Logic Review)
- **T3: Architectural Consistency** (Brain Policy Check)
- **T4: Security Surface** (SAST/Secrets Scan)
- **T5: Performance Implications** (Big-O Estimation)

## Tier Ordering Rationale
The tiers are ordered based on **Resource Cost** and **Dependency Complexity**:
1. **Low-Cost / High-Signal (T1)**: Linting can fail early (<100ms) and for free.
2. **Core Intent (T2)**: If it doesn't solve the task, further checks are irrelevant.
3. **Internal Policy (T3)**: Consistency with project-specific patterns.
4. **Safety & Security (T4)**: Critical but requires complex tool scans and expert context.
5. **Optimization (T5)**: Performance regressing can often be warning-only (Phase 4).

## Alternatives Considered
- **Single Critic Loop**: Simple but prone to conflation and hallucination.
- **Parallel Critics**: Faster but risks missing syntax errors when analyzing architecture.
- **Human-Only Review**: Accurate but not scalable for autonomous agents.

## Consequences
- **Positive**: High-fidelity quality guarantees, isolated failure modes, and systematic self-healing.
- **Negative**: Increased latency (minutes per task) and higher token costs due to sequential checks.
- **Neutral**: Requires the **Self-Healing Agent (L6.2)** to be aware of which tier failed.

## Implementation Notes
- **Failure Short-Circuit**: If T1 fails, T2-T5 are never triggered.
- **Tier Orchestration**: The **Critic Agent** is a pure orchestrator of the 5-Tier pipeline.
- **Consistency**: Tiers 2-5 use the **Deep model tier (L0)** for reasoning.
