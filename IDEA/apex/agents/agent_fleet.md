# Agent Fleet Specification

## Status
⚠️ **PARTIALLY SPECIFIED**
- SPEC sections: Agent Role Definitions, Resolved Responsibility Matrix, Phase Activation.
- UNDERSPECIFIED sections: **Trust Score Decay/Increment Logic**, Concurrency scaling per developer session, Agent Spawn cost-optimization strategy.

## Purpose
Defines the specialized agent instances that inhabit the APEX system. Each agent has a single responsibility, a specific set of tool grants, and a numeric **Trust Score** tracked by L4.

---

## Resolved Agent Responsibility Matrix
This section resolves the overlaps identified in the audit.

| Agent | Responsibility | Key Tool Grant | Activation |
|---|---|---|---|
| **Architect** | DAG construction, Risk analysis, Conflict resolution. | `brain_read`, `dependency_graph` | Phase 2 |
| **Generator** | Logic implementation and code writing. | `write_file`, `edit_file`, `bash` | Phase 1 |
| **Critic** | T1-T5 pipeline orchestration; Logic validation. | `run_tests`, `run_linter` | Phase 1 |
| **Self-Healing** | Failure diagnosis (L6.2) and strategy adaptation. | `brain_write`, `get_definition` | Phase 2 |
| **Security Agent** | Tier 4 vulnerability scans and audit. | `security_scan`, `dep_audit` | Phase 2 |
| **Tester Agent** | Test generation and Tier 5 performance Prof. | `coverage_report`, `performance` | Phase 2 |
| **Commit Agent** | Final integration, atomic commits, PR generation. | `git_commit`, `create_pr` | Phase 1 |
| **Browser Agent** | UI/E2E testing and visual verification. | `browser_navigate`, `screenshot` | Phase 3 |

---

## The Trust Score System (L4/L5)

To prevent prompt injection hijacking and ensure architectural stability, every agent instance has a **Trust Score** [0.0 - 1.0].

### Trust Levels
- **0.0 - 0.2 (Untrusted)**: New or custom agents. Read-only permissions.
- **0.3 - 0.5 (Standard)**: Generator/Critic default. Can write to worktrees.
- **0.6 - 0.8 (Reliable)**: High-performing agents. Can access `decisions/` Brain namespace.
- **0.9 - 1.0 (System)**: Architect/Commit agents. Can perform `git_push` and PR creation.

### Score Calibration (v1.0)
- **Increment**: +0.05 per successful DAG node completion (T1-T5 pass).
- **Decrement**: -0.15 per Self-Healing trigger or Critic FAIL (Logic tier).
- **Hard Block**: Score < 0.1 resets agent instance and triggers `HUMAN_GATE_TRIGGERED`.

---

## Specialist Fleet Specification

### Architect Agent (L3/L4)
- **Function**: Decomposes `TASK_RECEIVED` into `EXECUTION_DAG`.
- **Primary Tool**: `brain_read`, `dependency_graph`.
- **Model Preference**: Deep (Opus-class).

### Generator Agent (L5/L6)
- **Function**: Writes the code artifacts requested by the DAG.
- **Primary Tool**: `edit_file`, `bash`.
- **Model Preference**: Balanced (Sonnet-class).

### Critic Agent (L6)
- **Function**: Runs the 5-tier pipeline sequentiality.
- **Primary Tool**: Orchestration of `linter`, `test_runner`, `security_scanner`.
- **Model Preference**: Balanced/Deep (Sonnet/Opus).

---

## Open Questions
- How do we protect against "Critic Collusion" if Generator and Critic share an LLM session?
- What are the cost implications of spawning 8 specialized agents vs 1 generalist agent?
- Can a custom agent (Level 3 Extensibility) overwrite its own tool grants?
