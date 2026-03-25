# IFCH-02: LP/IP Optimization Primitives for APEX

## Status: 🟡 **FEASIBLE (PHASE 2 — THEORY-BACKED HEURISTICS FIRST)**

## 1. The Core Objective
To apply concepts from **Linear Programming (LP)** and **Integer Programming (IP)**—dual variables, Benders decomposition, column generation, and Lagrangian relaxation—as formal backing for APEX's resource allocation, task scheduling, and quality tier orchestration decisions. The key discipline: use these concepts as the *theoretical foundation* for heuristics, not as live solvers running in the hot path.

---

## 2. Technique-by-Technique Feasibility

### A. Dual Variables as Shadow Prices (Event Bus Signal)
**Theory**: In LP duality, the shadow price of a constraint tells you the marginal cost of relaxing it by one unit. For APEX, each shared resource (context window, tool-call budget, latency) has a "shadow price" that changes as load changes.

**APEX Mapping**: The `event_bus_schema.md` is extended with a new event class: `RESOURCE_PRESSURE_SIGNAL`. Each layer that consumes a shared resource publishes its current shadow price estimate.

| Layer | Resource | Shadow Price Signal |
|---|---|---|
| **L2** | Context window tokens | `ctx_pressure: float [0.0–1.0]` |
| **L4** | Agent worker slots | `dispatch_headroom: int` |
| **L5** | Sandbox CPU+Memory | `sandbox_utilization: float` |
| **L6** | Critic compute budget | `critic_queue_depth: int` |

**Consuming Layer**: L3 (Planning) reads all shadow price signals before finalizing a DAG structure. High L2 context pressure → generate a coarser-grained DAG with fewer, larger nodes (less context switching). High L5 utilization → force sequential node execution.

**Feasibility**: **High**. Shadow prices are just float values; any layer can compute a heuristic approximation and publish it. No LP solver is required.

---

### B. Benders Decomposition → L6 Quality Tiers
**Theory**: Benders decomposes a large problem into a "master problem" (decides structure) and "subproblems" (validate feasibility). Subproblems report back "Benders cuts" that constrain future master decisions.

**APEX Mapping**: L6's "master problem" is the decision of *which tiers to run and in what order* for a given artifact. Each Tier (T1–T5) is a subproblem.

The Benders cuts become **Early-Exit Rules**:
- If T1 (Syntax) fails → emit a Benders cut: "this artifact node type always fails T2 under these conditions; skip T2."
- If T2 (Semantic) passes → inform T3 (Architectural) that "intent was verified: skip contract-level checks for this specific module."

These cuts are stored in the **APEX Brain (L2)** under a `critic_shortcuts/` namespace and reused across tasks.

**Feasibility**: **Medium-High**. This is implementable as a **rule-based "skip policy"** derived from historical failure patterns. True iterative Benders solving is too slow for hot paths, but pre-computed cuts stored in Brain are fast lookups.

**Risk**: False cuts (skipping a tier that should run) introduce technical debt. Mitigation: cuts have a **confidence score**; low-confidence cuts require a "confirm" vote from L6 before applying.

---

### C. Column Generation → Dynamic Agent Specialization (L4)
**Theory**: Column generation solves problems with exponentially many variables. A "pricing subproblem" decides whether a new variable (column) is worth adding.

**APEX Mapping**: L4's "restricted master problem" is the current set of agent types in `agent_fleet.md`. A "pricing subproblem" is a lightweight evaluator that asks: *"Given the current task's demand profile, is there a new agent specialization with negative reduced cost (i.e., it would be cheaper to create a specialist than to compose existing generalists)?"*

**Feasibility**: **Low-Medium for Phase 1; High for Phase 3**. In Phase 1, the agent fleet is static and this is not needed. In Phase 3, if APEX is running thousands of tasks, it can use historical data from L8 to detect "task shapes" that systematically underperform with existing agents and dynamically register new specialist agent types. This is a clean Phase 3 target.

---

### D. Lagrangian Relaxation → Soft Context Budget (L2)
**Theory**: Hard constraints that are difficult to enforce are moved into the objective with a penalty multiplier λ. Tuning λ online balances the tradeoff between constraint satisfaction and objective value.

**APEX Mapping**: The context window budget is a "hard" constraint that is in practice "soft"—some tasks genuinely need more context to avoid a costly L6 failure. Lagrangian relaxation formalizes this: L2 has a penalty parameter `λ_ctx` applied when context budget is exceeded.

```
Objective = Task_Quality - λ_ctx × max(0, token_count - budget)
```

L2 maximizes this objective per task. When L6 failure rates are high and correlated with context truncation, `λ_ctx` is decreased (relaxing the constraint). When costs are high, `λ_ctx` is increased.

**λ Tuning**: λ is updated online using a subgradient method. L8 provides the gradient signal: `Δλ = learning_rate × (failure_rate_correlation_with_truncation)`.

**Feasibility**: **High**. λ is a single float. The subgradient update is 2 arithmetic operations. This replaces the current heuristic "fill to 80%" rule with a principled, self-tuning soft constraint.

---

### E. LP Relaxation → Critical Path Analysis (L3)
**Theory**: The LP relaxation of a scheduling IP gives the critical path as a dual solution—for free.

**APEX Mapping**: L3 constructs the DAG. Before locking it, it runs a simple critical path calculation (longest-path through the DAG) to find the **latency bottleneck**. Any node on the critical path gets elevated priority in L4's dispatch queue.

**Feasibility**: **High**. Critical path analysis (via topological sort + backward pass) is O(N + E) and is already standard in project management software. This is a pure deterministic algorithm requiring no LLM call.

---

## 3. Implementation Blueprint (Phased)

### Phase 1 (MVP): Critical Path + Shadow Prices on Event Bus
- Add `RESOURCE_PRESSURE_SIGNAL` event type to `event_bus_schema.md`.
- L3 runs critical path analysis before emitting `DAG_LOCKED`.
- L2 adopts a `λ_ctx`-based soft budget with a fixed initial λ.

### Phase 2: Benders Cuts in Brain + Lagrangian λ Tuning
- L6 writes early-exit rules to `critic_shortcuts/` namespace in Brain.
- L8 runs subgradient updates for `λ_ctx` after each task completion.

### Phase 3: Column Generation for Agent Fleet Evolution
- L8 analyzes task performance histograms for underperforming task shapes.
- If a new "specialization zone" is detected, trigger `AGENT_FLEET_EXPAND` event.

---

## 4. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Stale Benders Cuts**: A cached "skip T3" rule fires on a new task type where T3 is critical. | Cuts include a `task_type_filter` and `confidence_score`. Low-confidence cuts require explicit re-validation. |
| **λ Instability**: Subgradient updates overshoot, causing oscillating context budgets. | Clamp `λ` to valid range `[λ_min, λ_max]` and use a decaying learning rate schedule. |
| **Shadow Price Noise**: Heuristic shadow prices are inaccurate and mislead L3. | Treat shadow prices as **soft guidance** with a discount factor. L3 cannot hard-block a DAG structure based solely on pressure signals. |

---

## 5. Feasibility Verdict
LP/IP theory provides a **principled language** for what APEX is already doing heuristically. The translation is:
- Shadow prices → Resource pressure events (implement in Phase 1).
- Lagrangian relaxation → Self-tuning `λ_ctx` for context budget (Phase 1).
- Benders cuts → Critic shortcut rules in Brain (Phase 2).
- Column generation → Agent fleet evolution (Phase 3).

**Recommendation**: Implement **SPEC** for Critical Path + Shadow Prices in Phase 1. Defer Benders and Column generation to Phase 2/3.
