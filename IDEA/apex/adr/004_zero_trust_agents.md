# ADR-004: Zero-Trust Model for Agent-to-Agent Communication

## Status
⚠️ **PROPOSED**

## Context
Agent-to-agent trust in current systems is implicit. If an agent is spawned, it is trusted. This creates:
- **Security Vulnerabilities**: A compromised agent can spawn sub-agents with elevated permissions.
- **Cascading Hallucinations**: One agent blindly accepting the output of another.
- **Poor Accountability**: No clear track record of an agent's reliability over time.

## Decision
APEX will enforce a **Zero-Trust Model** for all inter-agent and inter-layer operations.
- **Low Initial Trust**: Every new agent instance starts with a minimum `trust_score` (0.3).
- **Dynamic Scoring**: Trust scores are incremented based on **Critic Tier** pass rates and decremented for **Self-Healing** triggers.
- **Capability Gating**: High-risk operations (e.g., file deletion, Brain writes, spawning sub-agents) require a specific trust threshold (>0.6/0.8).
- **Audit Logging**: Every interaction is logged and validated as part of the `trace_id`.

## Alternatives Considered
- **Role-Based Access Control (RBAC)**: Static permissions based on agent type (Architect, Generator).
- **Implicit Trust**: Simple but lacks security and quality guarantees.
- **Manual Oversight (Human)**: Too slow for autonomous agent scaling.

## Consequences
- **Positive**: Prevents privilege escalation and prompt injection, improves agent accountability.
- **Negative**: Increases the complexity of the **Orchestrator (L4)** and requires persistent storage for trust scores.
- **Neutral**: Requires clear definitions for "Trust" in the **GLOSSARY**.

## Implementation Notes
- **Trust Storage**: Trust scores are stored in the **APEX Brain (L2)** under an `internal/` namespace.
- **Calculation**: Historical pass rates (Tier 2 and Tier 3) are the primary drivers of trust.
- **Reset**: Trust scores can be manually reset by the user via a `HUMAN_GATE`.
