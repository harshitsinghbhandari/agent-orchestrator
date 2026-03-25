# Architecture Improvements Roadmap

## Critical Issues

### Issue: Zero Implementation Path — No Vertical Slice
- **Location**: `SUKUNA_FUSION_REPORT.md:Phase 4`, `IDEA/apex/PHASING.md:Phase 1`
- **Problem**: The Fusion proposes 10 Curse Documents spanning 9 layers, but there is no defined "minimum vertical slice" that demonstrates value with 2-3 layers working together. PHASING.md Phase 1 essentially re-describes what AO already does (sequential planning, local execution, basic quality checks). The first real value unlock (DAG parallelism, Brain memory) is Phase 2 — which has no timeline, no team estimate, and no prototype.
- **Impact**: Without a vertical slice, the project cannot attract contributors, cannot prove feasibility to stakeholders, and cannot iterate on real feedback. Every week spent writing more spec is a week further from reality.
- **Suggested Approach**:
  1. Define a **"Hello DAG" vertical slice**: Take a composite task (e.g., "add endpoint + write test + update docs"), decompose it into a 3-node DAG using the existing [decomposer.ts](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/decomposer.ts), add `depends_on` edges to the [TaskNode](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/decomposer.ts#21-33) interface, and run nodes 2+3 in parallel git worktrees.
  2. This requires touching only: [decomposer.ts](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/decomposer.ts) (add `depends_on` field), [session-manager.ts](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/session-manager.ts) (spawn concurrent sessions), and one new file `dag-scheduler.ts` (~200 lines for topological sort + tier identification).
  3. **No event bus needed.** Direct function calls between scheduler and session manager. The event bus is Phase 2.
  4. **Constraint**: This slice must work end-to-end in < 2 weeks or the architecture is over-specified.

---

### Issue: State Corruption from Flat-File Metadata Store
- **Location**: [packages/core/src/metadata.ts](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/metadata.ts), [packages/core/src/atomic-write.ts](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/atomic-write.ts), `SUKUNA_FUSION_REPORT.md:Curse Document #10`
- **Problem**: The entire system state lives in flat files under `~/.agent-orchestrator/`. [atomicWriteFileSync](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/atomic-write.ts#3-12) provides single-file atomicity but no cross-file transactions. Concurrent spawns and cleanups race on `readdirSync`. The Fusion report correctly diagnoses this but proposes "SQLite-over-Git" with a shadow repository — a solution more complex than the original problem.
- **Impact**: As concurrent agent count increases (even to 5+), metadata corruption becomes probabilistic, not theoretical. Session-to-PR mappings become unreliable. The `repairSessionMetadataOnRead` recovery function signals that corruption is a known, accepted state of affairs.
- **Suggested Approach**:
  1. Replace the flat-file store with **SQLite** (single file, ACID transactions, WAL mode for concurrent reads). This is the Fusion's own proposal but without the git-backed shadow repository (that's Phase 2 gilding).
  2. Migration: Keep the flat-file reading path for backward compatibility. Add a `metadata-v2.ts` that reads/writes to `~/.agent-orchestrator/{hash}/state.db`.
  3. Schema: `sessions` table with all current metadata fields + `created_at`, `updated_at` timestamps. Use `INSERT OR REPLACE` for atomic upserts.
  4. **Estimated effort**: 3-5 days for a senior developer. `better-sqlite3` is a zero-dependency, synchronous SQLite driver that matches AO's current synchronous metadata patterns.
  5. **Do NOT add git-backed snapshots yet.** That is a Phase 2 enhancement once the base store is proven.

---

### Issue: Absent Cost Model for Multi-Agent / Multi-Critic Architecture
- **Location**: `SUKUNA_FUSION_REPORT.md:Curse Documents #1, #2`, `IDEA/apex/layers/L6_quality_sovereignty.md:Resource Requirements`
- **Problem**: The Fusion proposes: drift validation every 5 tool calls (L0 Balanced), external activity verification via shadow monitors (L8), 5-tier sequential critic pipeline (L6), and self-healing diagnosis (L0 Deep). For a single 10-node DAG, the aggregate LLM call count is:
  - DAG planning: 2 calls (L0 Deep)
  - Per-node generation: 1 call × 10 = 10 calls (L0 Balanced)
  - Drift validation: 10 × (avg 10 tool calls / 5) × 1 call = 20 calls (L0 Balanced)
  - Quality pipeline: 10 × 3 LLM-based tiers = 30 calls (L0 Balanced + Deep)
  - Self-healing (assume 20% failure rate): 2 × 1 diagnosis + 2 × 1 retry = 4 calls (L0 Deep)
  - **Total: ~66 LLM calls per task.** At blended cost of $0.05/call = **$3.30 per task minimum.**
  - This is NEVER mentioned in the Fusion report.
- **Impact**: Without a cost model, the system will either be unaffordable for real use or will silently skip quality checks to save money, defeating the architecture's core thesis.
- **Suggested Approach**:
  1. Create a `COST_MODEL.md` in `IDEA/` that models per-task LLM call counts for each phase, by task complexity tier (Small/Medium/Large/XL).
  2. Integrate L8's `COST_THRESHOLD_EXCEEDED` circuit breaker from day one — not Phase 3.
  3. Define a `cost_budget_usd` field per DAG node in the L3 planning output. The scheduler refuses to dispatch if the aggregate node costs exceed the task budget.
  4. The L6 Quality Pipeline should support **tier-skipping** based on task risk score: Low-risk nodes skip T3 (Architectural) and T5 (Performance). This alone reduces per-node cost by 40%.

---

### Issue: Integration Dependency Chain with No Bootstrapping Strategy
- **Location**: `IDEA/apex/layers/L0-L8`, [IDEA/apex/PHASING.md](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/IDEA/apex/PHASING.md)
- **Problem**: L4 depends on L3 DAG. L3 depends on L1 Repo Graph. L6 depends on L2 Brain. L2 depends on L1 Perception Updates. This creates a total-order implementation chain: L0 → L1 → L2 → L3 → L4 → L5 → L6 → L7 → L8. No layer can function without the layers below it.
- **Impact**: This means you cannot build L4 orchestration without first building L1 perception, L2 context, and L3 planning. The minimum viable "APEX" is 5 layers deep. This is a 6-12 month effort for a 3-person team, minimum.
- **Suggested Approach**:
  1. **Stub the lower layers.** L1 Perception in Phase 1 is just `git diff --stat` + `find . -name '*.ts'`. L2 Context is just "read the file contents into the prompt." L3 Planning uses the existing [decomposer.ts](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/decomposer.ts) extended with a `depends_on` field.
  2. Define **"Layer Zero" implementations** for each layer: the simplest possible thing that satisfies the interface contract. Document these in a new `IDEA/apex/stubs/` directory.
  3. **Build from L5 up, not L0 down.** The user sees L5 (execution), L4 (orchestration), and L7 (human gates). The lower layers are plumbing. Stub the plumbing, build the experience.

---

## Medium Priority Issues

### Issue: Decomposer Produces Trees, Not DAGs
- **Location**: `packages/core/src/decomposer.ts:21-32`, `SUKUNA_FUSION_REPORT.md:Curse Document #9`
- **Problem**: The [TaskNode](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/decomposer.ts#21-33) interface has `children: TaskNode[]` but no `depends_on` field. The LLM-driven decomposition produces a tree (parent → children hierarchy) but cannot express cross-branch dependencies (e.g., "backend endpoint must be ready before frontend integration can start"). This means parallel execution is limited to sibling nodes, not arbitrary DAG topologies.
- **Impact**: For tasks where subtasks have cross-cutting dependencies (the majority of real-world composite tasks), the current tree structure forces either: (a) manual sequencing by the human, or (b) incorrect parallel execution.
- **Suggested Approach**:
  1. Add `depends_on: string[]` (list of `node_id`s) to the [TaskNode](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/decomposer.ts#21-33) interface.
  2. Add a second LLM pass after decomposition: given the flat list of subtasks + codebase file list, identify cross-dependencies. This is IFCH-02 Section E's "Two-Pass Planner" proposal — it's sound.
  3. Add a cycle-detection check (Kahn's algorithm) before accepting the DAG. Reject and re-plan if cycles are detected.
  4. **Estimated effort**: 1-2 days to extend the interface + LLM pass. 1 day for cycle detection + topological sort.

---

### Issue: Plugin Registry Cannot Extend at Runtime
- **Location**: `packages/core/src/plugin-registry.ts:26-54`, `SUKUNA_FUSION_REPORT.md:Curse Document #8`
- **Problem**: `BUILTIN_PLUGINS` is a static array. The [loadFromConfig](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/types.ts#1247-1252) method has a comment `// (future: support npm package names and local file paths)` that is unimplemented. Agents cannot request new tools during execution.
- **Impact**: Every new plugin (runtime, agent, tracker, notifier) requires a code change to [plugin-registry.ts](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/plugin-registry.ts) and a package rebuild. This makes the system rigid and unable to adapt to new agent types or tools without developer intervention.
- **Suggested Approach**:
  1. Implement the [loadFromConfig](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/types.ts#1247-1252) TODO: accept `plugins` entries in `agent-orchestrator.yaml` with `path: ./my-plugin.ts` or `package: @org/my-plugin` format.
  2. Use dynamic `import()` (already supported — the `doImport` parameter exists) to load plugins from configured paths.
  3. **Do NOT build a "marketplace" or "discovery engine" yet.** Runtime extensibility from config is the pragmatic step. Autonomous tool discovery is Phase 3 at earliest.

---

### Issue: No SCM Rate Limiting
- **Location**: [packages/core/src/lifecycle-manager.ts](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/lifecycle-manager.ts) (polling loop), `SUKUNA_FUSION_REPORT.md:Phase 1, Section 2`
- **Problem**: Every active session polls the SCM plugin for PR status. With GitHub's rate limit of 5000 req/hour (authenticated), 10 sessions polling every 30 seconds = 1200 req/hour just for status checks. Add CI, review, and merge checks, and you hit the limit in < 2 hours.
- **Impact**: GitHub rate limiting causes all sessions to lose visibility into PR state simultaneously. The orchestrator becomes blind.
- **Suggested Approach**:
  1. Implement a centralized `SCMRateLimiter` that wraps all SCM plugin calls. Use a simple token-bucket algorithm (10 tokens, refill 1/second, configurable).
  2. Share PR state across sessions targeting the same repo — one fetch, multiple consumers.
  3. Use GitHub webhooks (the [verifyWebhook](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/types.ts#528-532) + [parseWebhook](file:///Users/harshitsinghbhandari/Downloads/side-quests/composio/packages/core/src/types.ts#533-537) methods already exist in the SCM interface) to push PR state instead of polling. This reduces API calls by 90%+.

---

### Issue: Fusion Report's Curse Documents Lack Implementation Accountability
- **Location**: `SUKUNA_FUSION_REPORT.md:Phase 4 (all 10 Curse Documents)`
- **Problem**: Each Curse Document has four sections (① Weakness, ② Strength Gained, ③ APEX Layer, ④ Implementation Vector) but no: estimated effort, dependency list, definition of done, or success criteria. They are architectural intentions, not engineering plans.
- **Impact**: These documents will generate endless design discussions without converging on implementation because there is no shared definition of "done" for any Curse Document.
- **Suggested Approach**:
  1. Convert each Curse Document into a proper **Architecture Decision Record (ADR)** in `IDEA/apex/adr/` with: Status (proposed/accepted/implemented/deprecated), Context, Decision, Consequences, and Acceptance Criteria.
  2. Each ADR must include: affected files in `packages/core/src/`, estimated lines of code, prerequisite ADRs, and a "Spike" task that proves feasibility in < 3 days.
  3. Priority order for ADR conversion: #10 (SQLite store) → #9 (DAG planner) → #6 (Transport abstraction) → #1 (Drift validation) → rest.

---

## Nice-to-Have Enhancements

### Enhancement: PID Controller for Context Window (IFCH-03)
- **Location**: `IDEA/ifs/ifch3.md:Controller 1`
- **Description**: Replace the current heuristic context truncation with a PID controller that smoothly manages eviction pressure. The D-term fires preemptively on `PERCEPTION_UPDATE` events, preventing context spikes before they arrive. ~50 lines of pure math.
- **Benefit**: Eliminates oscillation in context management (evict too much → fetch it back → evict again). Provides a foundation for IFCH-04's rate-distortion curve integration in Phase 2.
- **Suggested Approach**: Implement as a standalone module `pid-controller.ts` in `packages/core/src/`. Expose `update(currentValue: number): number` with configurable Kp, Ki, Kd, windup clamp. Integrate with context assembly when L2 is built.

### Enhancement: NCD-Based Context Relevance Ranking (IFCH-04)
- **Location**: `IDEA/ifs/ifch4.md:Tool 2`
- **Description**: Use Normalized Compression Distance (`zstd`-based) for ranking context chunk relevance instead of embedding cosine similarity. NCD catches structural patterns (naming conventions, error-handling idioms) that embeddings miss.
- **Benefit**: More accurate context assembly with mathematical guarantees (63% submodularity bound). Low latency (~5ms for 200 chunks). No ML model required.
- **Suggested Approach**: Implement as a benchmark first — compare NCD ranking vs embedding cosine similarity on 50 real tasks. If NCD outperforms or matches embeddings with lower latency, adopt as default relevance ranker in L2.

### Enhancement: SSA Artifact Versioning Prototype (IFCH-01)
- **Location**: `IDEA/ifs/ifch1.md`
- **Description**: Prototype the SSA naming scheme: modify `TaskNode` to output `artifact@v{n}` identifiers, ensuring each agent operation produces a new subscripted version. This is purely a metadata/naming change in Phase 1 — no sandbox enforcement yet.
- **Benefit**: Establishes the foundation for multi-agent consistency without requiring the full L5 enforcement layer. If the naming alone reduces merge conflicts in parallel worktrees, the concept is validated.
- **Suggested Approach**: Extend `TaskNode` with `inputs: string[]` and `outputs: string[]` where values are `filename@v{n}` strings. Add a validation pass that checks the SSA invariant (each `filename@v{n}` is defined exactly once). This is <100 lines and can be tested against the existing decomposer output.

### Enhancement: Consolidate Specification Documents
- **Location**: `IDEA/apex/` (entire directory)
- **Description**: The IDEA directory contains 29 specification documents totaling ~75KB of markdown. Many cross-reference each other. There is no master index that shows implementation status, dependency order, or priority. The `README.md` navigation index is structural, not strategic.
- **Benefit**: A single "Implementation Status Dashboard" would allow contributors to see at a glance what is buildable, what is blocked, and what is research. Reduces the cognitive overhead of onboarding.
- **Suggested Approach**: Create `IDEA/STATUS.md` with a table: `| Document | Status | Dependencies | Phase | Effort | Owner |`. Populate from existing Status fields in each layer spec. Add a weekly review cycle to keep it current.

### Enhancement: Formalize the "Stub Layer" Pattern
- **Location**: New directory: `IDEA/apex/stubs/`
- **Description**: For each APEX layer (L0-L8), define the simplest possible implementation that satisfies the interface contract. Example: L1 Perception stub = `git diff --stat` + `find . -name '*.ts'` → output a file list. L2 Context stub = read files into prompt up to token limit.
- **Benefit**: Unlocks parallel development. Teams can build L4 orchestration against L3 stubs while L3 is being properly implemented. Eliminates the total-order dependency chain.
- **Suggested Approach**: For each layer, write a `L{n}_stub.ts` that exports the same interface as the full implementation but uses the simplest possible logic. Document the capabilities and limitations of each stub. Mark clearly which behaviors are "real" and which are "simulated."
