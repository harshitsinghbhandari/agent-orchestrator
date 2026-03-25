# IFCH-03: PID Control Theory for Cross-Layer Resource Management

## Status: 🟢 **FEASIBLE (HIGH PRIORITY — PHASE 1 CANDIDATE)**

## 1. The Core Objective
To replace APEX's current **threshold-based resource reactions** ("if context > 80%, evict") with **PID (Proportional-Integral-Derivative) controllers** — continuous, smooth feedback loops that govern three distinct resource dimensions across L2, L4, and L5. This prevents the well-known failure mode of "bang-bang control": oscillation caused by drastic on/off reactions in systems with inertia.

The critical architectural insight: APEX has inertia. You cannot instantly clear context, instantly kill in-flight agents, or instantly provision sandbox capacity. Any control mechanism that ignores inertia will oscillate.

---

## 2. The Three PID Controllers

### Controller 1: Context Window Pressure (L2)
**Controlled Variable**: `context_utilization` — fraction of token budget occupied.
**Setpoint**: 72% (leaves 28% headroom for the current agent's output).
**Actuator**: L2's eviction priority and admission threshold.

```
error(t)            = context_utilization(t) - 0.72
eviction_pressure   = Kp·e(t) + Ki·Σe(t) + Kd·(e(t) - e(t-1))
```

The **D term** is the highest-leverage element here. L2 subscribes to the event bus and can observe `PERCEPTION_UPDATE` events from L1 **before** the ingestion data arrives. The derivative fires preemptively, and L2 starts eviction before the pressure spike materializes.

**Integral Windup Guard** (mandatory): The integral accumulates when context is persistently over-budget. Without a cap, it causes over-correction — evicting genuinely live artifacts. Implementation: clamp `Σe(t)` to `[-windup_max, +windup_max]`. Emit a `COST_THRESHOLD_EXCEEDED` event to L8 when the clamp fires.

**Tuning Starting Point**: Kp = 0.4, Ki = 0.1, Kd = 0.6 (high derivative, low integral — prioritize predictive over historical, because context spikes are fast).

---

### Controller 2: Agent Dispatch Rate (L4)
**Controlled Variable**: `queue_depth` — number of ready-but-unassigned DAG tasks.
**Setpoint**: `target_depth` — a target queue depth (e.g., 2 × worker_count).
**Actuator**: L4's dispatch rate from the DAG frontier.

```
error(t)      = queue_depth(t) - target_depth
dispatch_rate = base_rate - (Kp·e + Ki·Σe + Kd·Δe)
```

**The critical failure mode this prevents**: When L6 begins returning failures rapidly, failed tasks are re-queued, causing `queue_depth` to spike. Without PID dampening, L4 dispatches aggressively to "clear" the queue, swamping all workers with retries simultaneously. The D term fires the moment the queue depth *rate of change* accelerates — L4 slows dispatch before the swamp, buying L3 time to replan.

**Feedforward Term** (from L3 DAG): L3 publishes frontier expansion events (`DAG_LOCKED`, containing the planned tier widths). L4's controller adds a predictive term:

```
u_total       = u_PID + K_ff × predicted_tier_width
```

This explicitly anticipates load spikes from planned parallelism rather than just reacting post-hoc.

**Tuning Starting Point**: Kp = 0.5, Ki = 0.05, Kd = 0.8 (aggressive derivative for fast queue depth rate-of-change detection, minimal integral to avoid windup from sustained L6 failure storms).

---

### Controller 3: Sandbox Resource Utilization (L5)
**Controlled Variable**: `sandbox_utilization` — aggregate CPU+memory across all active pods.
**Setpoint**: 75% utilization ceiling (prevents OOM kills and timeout cascades).
**Actuator**: L4's sandbox spawn rate.

```
error(t)   = sandbox_utilization(t) - 0.75
spawn_rate = base_spawn - (Kp·e + Ki·Σe + Kd·Δe)
```

This controller has the **longest time constant** — cloud sandbox provisioning has 15–30 second latency. Standard tuning adjustments for high-inertia systems:
- Lower Kp (avoid overshooting before the sandbox has actually provisioned).
- Higher I time constant (accumulate error slowly).
- Aggressive D with a longer lookback window (30s vs 5s for the other controllers).

**Feedforward Term**: Same as Controller 2 — L3's planned parallelism width predicts upcoming sandbox demand. L5 can begin pre-provisioning cloud instances during the `DAG_LOCKED → TASK_ASSIGNED` gap.

---

## 3. Stability Analysis (Nyquist Criterion)

The following feedback loop exists in APEX and must be analyzed for stability:

```
L6 failures → L3 replanning → larger DAG frontier →
more L4 dispatch → more L5 load → more L6 failures
```

This loop has two properties that, if unmanaged, guarantee oscillation or divergence:
1. **Gain > 1**: A single L6 failure can generate 2–3 retry tasks (amplification).
2. **Delay**: The full replan → dispatch → execute → validate cycle takes 30–120 seconds.

The **Nyquist Stability Criterion** applied: the loop gain must be less than 1 at the frequency where phase shift reaches 180°. For APEX, this means:

**Architectural requirement**: L3's replanning must include a **damping term**. When replanning after a failure, the new DAG frontier must NOT expand to maximum parallelism immediately. It must expand proportionally to current available worker headroom (reported by L4/L5 controllers as shadow prices).

This is formalized in the `SELF_HEAL_INITIATED` flow: the self-healing agent's "Adapt Strategy" output includes a `max_frontier_width` parameter set by L4's current dispatch budget, not by L3's theoretical optimal.

---

## 4. Implementation Blueprint (Phased)

### Phase 1 (MVP): Controller 1 + Safety Guard
- Implement Controller 1 (L2 context window PID) with integral windup guard.
- Use static tuning (Kp=0.4, Ki=0.1, Kd=0.6) — tuned empirically in first 50 tasks.
- Replace all context threshold checks with `eviction_pressure` signal.

### Phase 2: Controllers 2 & 3 + Feedforward
- Implement Controller 2 (L4 dispatch PID) with feedforward from `DAG_LOCKED` events.
- Implement Controller 3 (L5 sandbox PID) with cloud pre-provisioning.
- L8 begins collecting Kp/Ki/Kd performance histograms for future auto-tuning.

### Phase 3: Auto-Tuning via Ziegler-Nichols
- L8 runs online Ziegler-Nichols parameter estimation on live PID signals.
- Gains are updated per task class (bug fix vs. arch refactor have different dynamics).

---

## 5. Implementation Complexity Assessment

| Component | Lines of Code (est.) | Dependencies |
|---|---|---|
| PID core implementation | ~50 | None (pure math) |
| Integral windup guard | ~10 | None |
| Event bus feedforward hooks | ~30 | L3 DAG frontier events |
| L8 PID metrics recorder | ~40 | L8 observability layer |
| **Total** | **~130** | Minimal |

PID control is one of the most well-understood control mechanisms in engineering. The implementation is trivial; the value is in **replacing heuristic thresholds with principled, self-stabilizing feedback**.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Integral Windup**: Persistent overload causes the integral to accumulate, leading to over-eviction of live context. | Hard clamp on integral term + alert to L8. |
| **Derivative Noise**: Context utilization signals are noisy; derivative of noisy signals amplifies noise. | Apply a **low-pass filter** to the error signal before computing the derivative term. Use EMA (Exponential Moving Average) smoothing. |
| **Wrong Tuning**: Initial Kp/Ki/Kd values cause oscillation before auto-tuning kicks in. | Start with Phase 1 conservative values. Phase 1 uses only Controller 1 with a conservative Kp. Oscillation in context eviction is recoverable (worst case: some live context evicted, agent re-fetches). |

---

## 7. Feasibility Verdict
PID control is **the single lowest-cost, highest-impact engineering concept** from the research chats. It requires ~130 lines of pure arithmetic code and provides:

1. Eliminates oscillation in context management, dispatch, and sandbox provisioning.
2. Is theoretically grounded (Nyquist stability criterion).
3. Complements the SSA artifact system (IFCH-01) — stable resource management is necessary for SSA's multi-version context store to not blow up under load.

**Recommendation**: Elevate to **CORE SPEC for Phase 1**. Implement Controller 1 (L2 context) immediately. Controllers 2 and 3 in Phase 2.
