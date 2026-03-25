# Layer L6 — Quality Sovereignty

## Status
⚠️ **PARTIALLY SPECIFIED**
- SPEC sections: 5-Tier Critic Pipeline (Syntax, Semantic, Architectural, Security, Performance), Self-Healing Diagnosis Protocol (Pattern match → Root cause → Adaptation → Memory).
- UNDERSPECIFIED sections: **Tier Timeout Budgets** (unbounded latents), Partial-Pass Thresholds (WARNING vs FAIL), Tier Ordering Justification (security vs syntax priority).

## Purpose
The immune system of APEX. Ensures all generated code artifacts meet high-fidelity architectural and security standards before integration. Failure triggers a diagnostic self-healing loop rather than a simple retry.

## Inputs
- **Code Artifact**: From L5 Generator Agent.
- **Task Intent**: From L3 DAG Node.
- **Architectural Rules**: From L2 Brain namespaces.

## Outputs
- **Critic Verdict**: PASS, FAIL, or WARNING per tier.
- **Self-Healing Strategy**: Adaptive prompt or context for re-generation.

## Internal Architecture

### 1. The 5-Tier Critic Pipeline
| Tier | Responsibility | Toolset |
|---|---|---|
| **T1: Syntax** | AST parsing, linting, type-checking. | `eslint`, `tsc`, `pylint`. |
| **T2: Semantic** | Logic verification against task intent. | Critic Agent (Logic Review). |
| **T3: Architectural** | Consistency with Brain decisions. | Architect Agent (Rule check). |
| **T4: Security** | SAST, dependency audit, secrets scan. | `semgrep`, `bandit`, `trufflehog`. |
| **T5: Performance** | Big-O estimation, DB query analysis. | Performance profilers, DB EXPLAIN. |

### 2. Self-Healing Protocol
1. **Match Pattern**: Query Brain `failures/` for known fixes.
2. **Root Cause**: Trace back to DAG node decision.
3. **Adapt Strategy**: Rewrite prompt, add context, or decompose further.
4. **Update Memory**: Log failure result to prevent recurrence.

## Failure Modes
| Mode | Detection | Degradation | Recovery |
|---|---|---|---|
| **Endless Retry Loop** | Counter threshold (>3) | Task stalls indefinitely. | Escalate to Human Gate (L7) for manual fix. |
| **False Pass (T1-T5)** | Regression in Phase 4 integration | Bug reaches main branch. | Mark as "Architectural Debt" in Brain; re-run Tier. |
| **Diagnosis Hallucination** | Repeated failure at same node | Waste of tokens (Opus-class). | Switch to higher-tier model or trigger Human Review. |

## Resource Requirements
- **LLM Calls**: 1-5 calls per artifact (Tier 2/3/Self-Healing require Deep models).
- **Latency**: Cumulative latency of 5 sequential quality tiers.
- **Cost**: Potentially the most expensive layer in the stack.

## Dependencies
- LLM (L0 Deep & Balanced tiers).
- L2 Brain (Failures/Decisions namespaces).

## Phase Mapping
- **Phase 1**: Tiers 1-2 only; simple retry.
- **Phase 2**: Full 5-tier pipeline and pattern-based self-healing.

## Open Questions
- Can Tier 4 (Security) and Tier 1 (Syntax) run in parallel?
- What are the "Partial Pass" (WARNING) criteria for non-blocking issues?
- How do we protect against "Critic Collusion" when Generator and Critic use the same model?
