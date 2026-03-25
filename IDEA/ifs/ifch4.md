# IFCH-04: Information Theory for L2 Context Sovereignty

## Status: 🟡 **FEASIBLE (HIGH LEVERAGE — PHASE 2 TARGET)**

## 1. The Core Objective
To replace the **heuristic C1-C5 weighted context assembly** in Layer L2 with an **information-theoretic framework**. The current weighted scheme is tuned by intuition and doesn't generalize across codebases. The replacement uses four distinct tools from information theory—each solving a different sub-problem of context assembly—with provable performance guarantees.

The four problems and the tools that solve them:

| Problem | Tool |
|---|---|
| How many tokens should this task get? | Rate-Distortion Theory (knee detection) |
| Which context chunks are most relevant? | Normalized Compression Distance (NCD) |
| Is more context actually helping? | Conditional Entropy / Submodular Information Gain |
| Is the assembled context sufficient at all? | Cross-Entropy Perplexity Gate |

---

## 2. Tool-by-Tool Feasibility

### Tool 1: Rate-Distortion Theory → Optimal Token Budget
**Theory**: The Rate-Distortion function D(R) is a curve relating context token budget (rate R) to agent performance degradation (distortion D). The curve has a "knee" — the point of maximum curvature — where marginal returns from additional context sharply diminish. Operating at the knee is the theoretically optimal token budget for a given task.

**APEX Mapping**: L8 accumulates empirical data points `(token_count, L6_quality_score, task_type)` from every completed task. It fits a monotone decreasing curve per task class using **isotonic regression**. The knee is found analytically:

```
κ(R) = |D''(R)| / (1 + D'(R)²)^(3/2)
knee  = argmax_R κ(R)
```

The knee value becomes the **PID setpoint** for Controller 1 (IFCH-03), replacing the static 72% target with a dynamically computed, task-class-specific optimal.

**Feasibility**: **High for Phase 2, Low for Phase 1**. In Phase 1, L8 has no historical data to fit curves against. The rate-distortion system bootstraps from static defaults and gradually becomes data-driven as more tasks are completed (target: accurate curves after 100+ tasks per class). Isotonic regression is a lightweight, deterministic algorithm—no ML model required.

**Implementation cost**: L8 background job, ~100 lines. Zero impact on hot path.

---

### Tool 2: Normalized Compression Distance → Relevance Ranking
**Theory**: NCD measures shared information between two strings using a real compressor (e.g., `zstd`) as a proxy for Kolmogorov complexity:

```
NCD(x, y) = (C(xy) - min(C(x), C(y))) / max(C(x), C(y))
```

NCD = 0 means identical structure; NCD = 1 means completely unrelated. It catches structural patterns that embedding cosine similarity misses: shared naming conventions, shared error-handling idioms, shared AST patterns.

**APEX Mapping**: L2's relevance scoring for candidate context chunks is:
1. Build a task descriptor string `T = task_type + target_files + description + DAG_metadata`.
2. For each candidate chunk `C`, compute `NCD(T, C)`.
3. Rank candidates ascending by NCD (lowest = most structurally relevant).
4. Admit chunks in order until budget is reached.

**Key implementation detail**: Use `zstd` with a **shared dictionary** trained on the codebase at project ingestion time (L1). The shared dictionary encodes the codebase's common patterns, making marginal NCD differences between chunks more precise. Without a shared dictionary, generic coding patterns confound the signal.

**Feasibility**: **High for Phase 2**. `zstd` is a mature library. NCD computation is microseconds per chunk. The shared dictionary training runs once during `L1_INDEX_COMPLETE` event. Total overhead per context assembly: ~5-20ms for a 200-chunk candidate pool.

**Limitation**: NCD is language-agnostic but not AST-aware. For code, it treats the file as a string. This is a reasonable approximation for most cases; structural/AST-aware similarity remains a Phase 3 enhancement.

---

### Tool 3: Conditional Information Gain → Redundancy Suppression
**Theory**: Once a context set `S` is partially assembled, the marginal value of adding chunk `C` is not `NCD(T, C)` but the **conditional NCD** — how much `C` reduces uncertainty given what's already in `S`:

```
NCD(T, C | S) = (C(T+S+C) - C(T+S)) / C(C)
```

The numerator measures the additional compression gained by adding `C` to an already-compressed `(T+S)` block. If `C` is redundant with `S`, the compressor already captured that structure — the numerator is near zero.

**The theoretical guarantee (Submodularity)**: The information gain function `I(T; C | S)` is submodular in `S`. This means the greedy algorithm (always admit the chunk with the highest current conditional NCD) achieves at least `(1 - 1/e) ≈ 63%` of the information content of the optimal subset. This 63% bound holds regardless of codebase size or structure — it's a universal guarantee.

**APEX Mapping**: L2's admission loop is updated from "rank once by plain NCD" to an **incremental greedy loop**:
```
S = {}
while budget_remaining > 0:
    best_chunk = argmin_{C in candidates} NCD(T, C | S)
    S = S ∪ {best_chunk}
    candidates = candidates \ {best_chunk}
```

At each step, NCD scores for remaining candidates are updated with the newly admitted chunk. This ensures redundant duplicates are naturally de-prioritized without explicit deduplication.

**Feasibility**: **High for Phase 2**. The incremental loop adds O(N) NCD computations per chunk admitted. For a 200-chunk pool with a 20-chunk budget, this is 200 + 180 + 160... = ~2000 NCD computations. At microseconds each: <5ms total. Negligible.

---

### Tool 4: Cross-Entropy Perplexity Gate → Context Sufficiency Check
**Theory**: The cross-entropy `H(T, S)` measures how well the assembled context `S` "models" the task `T`. High cross-entropy means the context is a poor model of the task — the agent will have high residual entropy and is likely to hallucinate.

**APEX Mapping**: Before dispatching a task to L5, L2 runs a **perplexity check** using a small local model (e.g., `Phi-3-mini` running locally — a haiku-class model, not the full L0 stack):

1. Compute perplexity of the task descriptor `T` conditioned on the assembled context `S`.
2. If `perplexity > threshold_per_task_class` (calibrated from L8 data): emit `CONTEXT_INSUFFICIENT` event.
3. L3 can then decompose the task further (smaller scope = less context needed), or L7 is flagged for human clarification.

This is **the most architecturally significant addition** from Information Theory because it creates a formal, principled definition of "the agent has enough context to proceed" — something entirely absent from the current APEX spec.

**Feasibility**: **Medium-High for Phase 2**. Requires a small local model for perplexity estimation. `Phi-3-mini` or `Qwen2.5-0.5B` can run on CPU in <100ms. This adds latency to the context assembly pipeline but prevents costly L6 failures that would cost far more.

**Threshold Calibration**: L8 correlates historical `(perplexity, L6_pass_rate)` pairs and identifies the perplexity value above which the L6 pass rate drops below 70%. This threshold is a live L8 metric, automatically recalibrated as the system observes more tasks.

---

## 3. Replacement of C1-C5 Weights

The current L2 spec's `C1-C5` weight hierarchy (`C1=User Intent, C2=Recent Activity, ...`) is preserved as a **pre-filtering step** that narrows the candidate pool before formal NCD ranking:

| Old Spec | New Role |
|---|---|
| C1: User Intent | Determines `T` (task descriptor for NCD). |
| C2: Recent Activity | Priority pre-filter: recent files enter candidate pool first. |
| C3: Brain Patterns | Priority pre-filter: previously effective patterns enter first. |
| C4: Codebase Map | General candidate pool (LSP graph, symbol index). |
| C5: Action Context | SSA use-def chain entries (from IFCH-01) — highest priority, always admitted. |

The C1-C5 system now defines **candidate pool priority**, not final selection weights. Final selection is always by conditional NCD, ensuring information-theoretic optimality within each pool.

---

## 4. Implementation Blueprint (Phased)

### Phase 1 (MVP): Static Budget + Plain NCD
- Implement plain `NCD(T, C)` using `zstd` for chunk relevance ranking.
- L1 project ingestion triggers `zstd` dictionary training.
- Context budget remains static (task class defaults: 20K tokens for bug fixes, 60K for module refactors).

### Phase 2 (Full): Conditional NCD + Perplexity Gate + Rate-Distortion Curves
- Switch L2 admission loop from plain NCD to conditional NCD (incremental greedy).
- Deploy small local model for perplexity gate.
- L8 begins collecting `(token_count, L6_score, task_type)` tuples.
- After 100+ tasks/class: activate rate-distortion knee detection for dynamic budget setting.

### Phase 3: Online Learning of Task-Class Curves
- L8 refits isotonic regression curves continuously.
- Knee detection updates PID setpoints dynamically.

---

## 5. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **zstd Dictionary Staleness**: Codebase evolves; shared dictionary becomes stale. | Re-trigger dictionary training on `PERCEPTION_UPDATE` events above a structural change threshold (e.g., >10% file churn). |
| **Perplexity Gate False Positives**: Gate blocks a task that would have succeeded. | Gate emits `CONTEXT_INSUFFICIENT` as a **soft signal**, not a hard block. L3 decides whether to decompose further or proceed with a `LOW_CONFIDENCE_DISPATCH` flag. |
| **Isotonic Regression Cold Start**: Phase 1 has no curves, Phase 2 has sparse data. | Bootstrap curves with conservative defaults. Confidence intervals on curves determine when the dynamic knee overrides the static default (minimum 30 samples per task class). |
| **NCD Doesn't Model Semantics**: Structurally similar but semantically irrelevant code (e.g., similar boilerplate) scores well. | Use NCD as primary signal, embedding similarity as a secondary "semantic veto" for obvious false positives. |

---

## 6. Feasibility Verdict
Information theory replaces the current C1-C5 heuristic with a system that has:
- **Mathematical performance guarantees** (63% of optimal information content).
- **Task-adaptive token budgets** (rate-distortion knee).
- **A formal "context insufficient" gate** (cross-entropy perplexity).
- **Emergent redundancy suppression** (conditional NCD naturally drops duplicates).

The implementation path is concrete, incremental, and derisked by the existing L8 observability infrastructure.

**Recommendation**: NCD scoring is **Phase 2 SPEC**. The perplexity gate is **Phase 2 SPEC** with a soft-signal implementation. Rate-distortion curve learning activates automatically as L8 accumulates data. No Phase 1 dependencies.
