# Architecture Improvements Roadmap

## Critical Issues

Issues that **must** be fixed before any implementation begins. These block success or introduce unacceptable risk.

---

### Issue: Document Decomposition — Single Monolith Cannot Be Implemented
- **Location**: Entire APEX.md (772 lines, single file)
- **Problem**: A 772-line monolithic document with HTML-table-based diagrams is unsearchable, unversionable at the section level, and impossible for a team to work on concurrently. No implementer can build Layer 4 without re-reading Layers 1-3, because the interfaces between layers are embedded in prose, not declared in a structured format.
- **Impact**: Any team of >1 person will immediately diverge in interpretation. Parallel development is impossible without clear interface contracts. The document cannot serve as a living spec because edits to one section ripple through all others with no traceability.
- **Suggested Approach**: 
  1. Split into a directory structure: `apex/L0-intelligence-substrate.md`, `apex/L1-perception-engine.md`, …, `apex/L8-observability.md`, plus `apex/overview.md` and `apex/interfaces.md`.
  2. Each layer spec must declare: **Inputs** (what events/data it consumes, from which layers), **Outputs** (what events/data it emits, to which layers), **Failure Modes** (what happens when this layer fails), and **Resource Requirements** (CPU, memory, LLM calls, external services).
  3. Create an `apex/interfaces.md` that defines every inter-layer contract as a typed schema (TypeScript interfaces, JSON Schema, or Protobuf definitions).
  4. Add an `apex/adr/` directory for Architecture Decision Records using the [MADR format](https://adr.github.io/madr/).

---

### Issue: Semantic Merge Is Undefined — The Hardest Problem Is Hand-Waved
- **Location**: §5.3 (Parallel Execution Strategy), referenced in §8.4 Phase 3
- **Problem**: "Semantic merge (not textual) — understands intent of each diff" is stated as a capability but has zero specification. This is the single hardest engineering challenge in the entire architecture. Two agents may modify the same function for different purposes (e.g., Agent A adds error handling, Agent B changes the return type). Textual merge tools (git merge) will fail. The claimed "semantic merge" would need AST-level diff analysis, intent-aware conflict detection, and automated resolution — none of which exist as production tools.
- **Impact**: Without semantic merge, parallel execution collapses to sequential execution (agents cannot safely work on related code simultaneously). This invalidates APEX's core differentiator over existing agents.
- **Suggested Approach**: 
  1. Define merge scope constraints: restrict parallel agents to non-overlapping file sets (not just non-overlapping lines). This is achievable and eliminates most merge conflicts.
  2. For cases where file overlap is unavoidable, define a "merge arbiter" protocol: Agent A's output is committed first (priority by DAG ordering), Agent B rebases onto A's changes and re-runs its generation with A's diff as additional context.
  3. Only attempt true semantic merge for specific, well-understood patterns (e.g., import additions, which are commutative). Document these as "safe merge patterns."
  4. Relegate full semantic merge to a future version (v2.0+) with a dedicated research track.

---

### Issue: No MVP / Implementation Phasing — Cannot Build All 9 Layers Simultaneously
- **Location**: Entire document — no phasing, no "start here," no MVP definition
- **Problem**: The spec presents all 9 layers as equally required. No team can build L0-L8, 10 agent types, a 5-tier critic pipeline, an event bus, a brain storage system, an observability stack, and a zero-trust sandbox concurrently. The lack of implementation ordering means the first engineering decision ("what do we build first?") requires a separate planning exercise that the spec should have provided.
- **Impact**: Development will stall in the design phase as engineers argue about where to start. Resources will be spread thin. Nothing will reach production.
- **Suggested Approach**: Define three explicit phases:
  - **Phase 1 (Minimum Viable Agent)**: L3 (Planning — DAG construction for sequential tasks only), L4 (Orchestration — single agent, no parallelism), L5 (Execution — local only), L6 (Quality — Tiers 1+2 only). This gets a working single-agent system with basic quality checks.
  - **Phase 2 (Parallel + Memory)**: Add parallel execution (L4 multi-agent), L2 (Context Sovereignty — C1+C3+C5 layers only), L1 (Perception — LSP only, no action streaming), L6 Tiers 3-5.
  - **Phase 3 (Full Platform)**: L0 (model routing), L1 (full perception), L2 (all 5 context layers), L7 (human collaboration), L8 (observability), self-healing, brain storage.
  - Each phase must have: acceptance criteria, resource budget, and estimated timeline.

---

### Issue: Resource Requirements Not Quantified — Infrastructure Cost Is Unbounded
- **Location**: §2.1 (Perception Engine), §6.1 (Execution Environment), §8.1 (Background Operations), §10.1 (Observability)
- **Problem**: The background operations alone require: 5+ LSP servers, a real-time action stream processor, an embedding model running incrementally, Prometheus, an anomaly detection system, and a cost tracker — all running continuously before any task is submitted. Add ephemeral VMs for parallel execution, Kafka for the event bus, and multi-tier LLM calls for the critic pipeline, and the infrastructure cost per developer could exceed $500-1000/month.
- **Impact**: No organization will adopt a tool with unbounded infrastructure costs. The spec cannot be evaluated for ROI because costs are never estimated.
- **Suggested Approach**:
  1. Add a "Resource Profile" section to each layer spec with: compute requirements (CPU/memory), external service dependencies, estimated LLM token consumption per operation type, and estimated cost per 1000 tasks.
  2. Define three deployment profiles: **Local** (developer laptop, minimal cloud), **Team** (shared infrastructure, moderate cloud), **Enterprise** (full infrastructure). Each profile activates different layers/features.
  3. Add cost guardrails: per-task token budget, per-session cost cap, alert thresholds. Reference these in the Observability layer as enforceable limits, not just metrics.

---

### Issue: Inter-Layer Interface Contracts Are Missing
- **Location**: All layer boundaries (L1→L2, L2→L3, L3→L4, etc.)
- **Problem**: No layer defines its output schema. "Feeds into L2 Context Assembly" (§2.2) is a dependency arrow, not an interface. What data structure does L1 emit? What fields does L2 expect? What happens if L1 emits data that L2 doesn't understand? None of these questions are answerable from the current spec.
- **Impact**: Each layer will be implemented with ad-hoc interfaces. When two layers are built by different people (or at different times), they will not integrate without significant rework.
- **Suggested Approach**: For each layer boundary, define:
  ```
  Interface: L1 → L2
  Event Type: PERCEPTION_UPDATE
  Schema: {
    update_type: "lsp_symbol" | "file_change" | "action_event" | "graph_update",
    timestamp: ISO8601,
    payload: SymbolUpdate | FileChangeEvent | ActionEvent | GraphDelta,
    source_mode: "A" | "B" | "C",
    priority: 1-5
  }
  Contract: L2 MUST process PERCEPTION_UPDATE events within 100ms.
             L2 MAY discard events with priority < 3 when context window is >80% full.
  ```

---

### Issue: Failure Modes for Infrastructure Are Not Discussed
- **Location**: Entire document — no failure analysis for core infrastructure
- **Problem**: The spec discusses agent-level failures extensively (self-healing, critic failures, retry budgets) but never addresses infrastructure-level failures: event bus unavailability, brain storage corruption, LSP server crashes, VM provisioning failures, network partitions between local and cloud execution, embedding model latency spikes.
- **Impact**: The first infrastructure failure in production will cascade unpredictably because no degradation strategy exists. The system has no concept of "graceful degradation" — it's all-or-nothing.
- **Suggested Approach**:
  1. For each infrastructure dependency, define: failure detection method, degradation behavior, and recovery procedure.
  2. Example: "If the event bus is unavailable for >5s, agents switch to synchronous direct communication for in-progress tasks. No new tasks are accepted. Alert emitted."
  3. Example: "If LSP server crashes, Perception Engine Mode A is disabled. Agents fall back to text-based search (grep) for symbol resolution. Quality impact: Tier 3 critic may miss architectural violations."
  4. Define a "minimum viable infrastructure" set — the absolute minimum services required for the system to function at all (even at reduced capability).

---

## Medium Priority Issues

Issues that should be addressed soon. They degrade quality, maintainability, or scalability.

---

### Issue: Agent Responsibility Overlap — Critic Agent vs Security Agent vs Debugger Agent vs Self-Healing Agent
- **Location**: §5.1 (Agent Fleet), §7.1 (Critic Pipeline), §7.2 (Self-Healing)
- **Problem**: The Critic Agent runs Tier 4 (Security Surface) using "security_scan" tools. The Security Agent's role is "Vulnerability scanning, dependency audit, threat modeling" using "security_scan, dependency_audit, read_file." These appear to overlap — does the Critic Agent's Tier 4 invoke the Security Agent, or are they independent scans? Similarly, the Debugger Agent does "failure analysis and fix strategy generation" while the Self-Healing Agent does "diagnoses agent failures, adapts execution strategy." When does the Debugger activate vs the Self-Healing Agent?
- **Impact**: Ambiguous responsibility boundaries will cause either duplicated work (wasting LLM tokens and time) or gaps (each agent assuming the other handles a scenario).
- **Suggested Approach**:
  1. Make the Critic Agent a pure orchestrator for the 5 tiers. Tier 4 should *delegate* to the Security Agent, not duplicate its work. The Critic Agent's role becomes "orchestrate the pipeline; evaluate pass/fail for each tier."
  2. Merge the Debugger Agent into the Self-Healing Agent. The distinction between "failure analysis" and "diagnosis" is artificial. The Self-Healing Agent should have a `diagnose` mode (root cause analysis) and a `fix` mode (strategy adaptation). The current Debugger Agent's tools are a subset of Self-Healing Agent's tools.
  3. Document the activation rules explicitly: "Self-Healing Agent activates ONLY when the Critic Pipeline emits a FAIL event. Debugger mode is the first step. Fix mode follows."

---

### Issue: Event Bus Schema Is Incomplete
- **Location**: §5.2 (Event Bus Architecture)
- **Problem**: The event type enum lists 8 types but the architecture references behaviors that require additional types: `PERCEPTION_UPDATE`, `CONTEXT_REFRESHED`, `COST_THRESHOLD_EXCEEDED`, `CIRCUIT_BREAKER_TRIGGERED`, `AGENT_TRUST_UPDATED`, `ACK` (referenced by `requires_ack` field). The schema also lacks: `retry_count`, `parent_event_id` (for event chains), `timeout_ms` (for ACK deadlines), and `idempotency_key` (required for "at-least-once delivery with idempotent consumers").
- **Impact**: Implementers will ad-hoc extend the schema, creating inconsistencies. The "at-least-once with idempotent consumers" guarantee cannot be implemented without an idempotency key.
- **Suggested Approach**: 
  1. Define the complete event type taxonomy in a dedicated `apex/events.md` file.
  2. Add the missing fields: `idempotency_key` (SHA256 of source_agent + task_node_id + event_type + payload_hash), `retry_count`, `parent_event_id`, `timeout_ms`.
  3. Define event lifecycle: Created → Dispatched → Acknowledged → (Processed | Failed → DLQ).
  4. Define event ordering guarantees precisely: "Events are ordered per (task_id, source_agent) pair, not globally."

---

### Issue: Trust Scoring System Has No Specification
- **Location**: §6.2 (Zero-Trust Sandbox Model), Appendix D
- **Problem**: "Agent-to-agent trust scores (new agents start untrusted)" is stated but: what is the initial trust score? How does it increase? Can it decrease? What trust score threshold is required for different operations (write to critical paths, spawn sub-agents, access brain storage)? What prevents a compromised Self-Healing Agent from resetting its own trust score?
- **Impact**: Without a specified trust model, the zero-trust claim is marketing, not architecture. Implementers will either skip trust scoring entirely or implement an ad-hoc system that provides a false sense of security.
- **Suggested Approach**:
  1. Define trust as a numeric score [0.0, 1.0] with initial value 0.3.
  2. Trust increases by 0.05 per successful task completion (critic pipeline fully passed). Trust decreases by 0.15 per self-healing trigger. Trust floor: 0.1 (never fully distrusted).
  3. Trust thresholds: <0.3 = read-only access; 0.3-0.6 = write access with mandatory critic review; >0.6 = write access with auto-skip Gate 1; >0.8 = can spawn sub-agents.
  4. Trust scores are stored in the event log, not self-reported. The Observability Agent computes trust, agents cannot modify their own scores.

---

### Issue: Context Compression Strategy Is Undefined
- **Location**: §3.1 (Five-Layer Context Architecture)
- **Problem**: "Compressed to fit model context window using learned summarization model" appears once and is never elaborated. This is a critical capability — if context compression loses signal, the LLM will generate incorrect code. If it doesn't compress enough, the context window overflows. The term "learned summarization model" implies a trained model, but no training data source, architecture, or quality metric is defined.
- **Impact**: Context compression will be the difference between correct and incorrect agent behavior. Hand-waving it is a significant architectural risk.
- **Suggested Approach**:
  1. Start with a practical, non-ML approach: hierarchical summarization. Full code → function signatures + docstrings → module names. Apply progressively as context pressure increases.
  2. Define a "context budget" per LLM call: e.g., C1 gets 10% of window, C2 gets 15%, C3 gets 40%, C4 gets 15%, C5 gets 20%. Adjust dynamically based on task type.
  3. Implement context quality metrics: after compression, run a "relevant fact retrieval" test — can the LLM still answer specific questions about the compressed content? Track retrieval accuracy as a quality signal.
  4. Defer "learned summarization model" to v2.0. Use structured truncation for v1.0.

---

### Issue: Model Routing Is Statically Defined — No Dynamic Adaptation
- **Location**: §9.1 (Model Routing Decision Matrix)
- **Problem**: The routing matrix is a static lookup table. "Code generation (small)" always routes to Sonnet-class. But model performance varies by language (GPT-4o may outperform Claude Sonnet on Python; Gemini may outperform on Go). The "escalation trigger" (2 critic failures → upgrade model) is reactive, not predictive. No feedback loop exists between critic results and future routing decisions.
- **Impact**: Suboptimal model usage → higher costs and lower quality than achievable. The system will always use the same model for the same task type, regardless of historical success rates for that specific project/language/pattern combination.
- **Suggested Approach**:
  1. Replace the static matrix with a routing policy that considers: task type + language + historical critic pass rate for this (model, task_type, language) triple.
  2. Track per-model quality metrics in the observability layer: (model, task_type) → (pass_rate, avg_latency, avg_cost).
  3. Implement a simple bandit algorithm: explore (try alternative models 10% of the time) + exploit (use the highest-performing model 90% of the time).
  4. Keep the static matrix as the default/fallback when insufficient data exists for adaptive routing.

---

### Issue: HTML Table Formatting Makes Content Inaccessible
- **Location**: Entire document — pervasive use of `<p>` tags inside table cells
- **Problem**: Throughout the document, dense multi-paragraph content is stuffed into HTML table cells (e.g., §2.1, §4.3, §6.2, §9.2). This content is: invisible to grep/search tools, hard to diff in version control, inaccessible to screen readers, and unrenderable in many Markdown processors. The ASCII art diagrams (§1.1, §2.2, etc.) are inside single-column tables, adding unnecessary structural complexity.
- **Impact**: The document cannot be effectively searched, reviewed, or maintained. Contributing engineers will avoid editing it because the HTML formatting is fragile.
- **Suggested Approach**:
  1. Replace all HTML-table-based prose with standard Markdown sections. Each "column" in a two-column table becomes a subsection with a heading.
  2. Replace ASCII art diagrams with Mermaid diagrams. They render in GitHub, GitLab, and most Markdown tools. They are diffable and editable.
  3. Use proper Markdown tables only for genuinely tabular data (e.g., the agent fleet in §5.1, model routing matrix in §9.1).

---

## Nice-to-Have Enhancements

Optimizations, future-proofing, or quality-of-life improvements. Not blocking but valuable.

---

### Enhancement: Add Sequence Diagrams for Critical Flows
- **Location**: §8 (Complete Execution Flow)
- **Description**: Section 8 describes the end-to-end flow as narrative prose and a high-level block diagram. Adding UML sequence diagrams (in Mermaid) for the 3 most critical flows — (1) Happy path: task intake → plan → execute → commit, (2) Self-healing: critic failure → diagnosis → retry → success, (3) Parallel execution: DAG tier with merge — would make the temporal interactions between agents explicit and verifiable.
- **Benefit**: Sequence diagrams would expose interaction gaps, timing issues, and missing event types that prose descriptions hide. They would also serve as test specifications for integration testing.
- **Suggested Approach**: Use Mermaid `sequenceDiagram` syntax. Include: participant names (mapped to agents), all event types emitted, decision points (alt/else blocks), and loop boundaries (for retry logic).

---

### Enhancement: Define a Testing Strategy for the Architecture Itself
- **Location**: Not present — no section on testing the agent system
- **Description**: The spec describes how agents test user code (Tester Agent, critic pipeline) but never addresses how the agent system itself is tested. How do you verify that the event bus delivers messages correctly? How do you test that the self-healing loop terminates? How do you regression-test context compression quality?
- **Benefit**: An untested agent system will have bugs that silently degrade output quality. Users will blame the LLM when the bug is in the orchestration, context assembly, or event routing.
- **Suggested Approach**: Add an `apex/testing.md` that defines: unit test strategy per layer, integration test strategy per interface, end-to-end test scenarios (happy path, self-healing, parallel merge, cost limit exceeded), and chaos engineering tests (kill an agent mid-task, corrupt brain storage, inject latency into event bus).

---

### Enhancement: Add a Glossary of Terms
- **Location**: Not present
- **Description**: The document uses specialized terms inconsistently: "task node," "DAG node," "subtask" all appear to mean the same thing. "Agent pod," "agent instance," "agent" — what's the difference? "APEX Brain," "brain storage," "brain directory" — different names, same system? A glossary would eliminate ambiguity.
- **Benefit**: Every contributor to the project would share the same vocabulary. Review discussions would reference defined terms instead of arguing about semantics.
- **Suggested Approach**: Add an `apex/glossary.md` with: Term | Definition | First Used In | Example. Include at least: DAG node, agent pod, event, gate, tier, brain namespace, context layer, trust score, confidence score, risk score.

---

### Enhancement: Add Explicit Non-Goals
- **Location**: Executive Summary (§0)
- **Description**: The spec describes everything APEX *does* but never defines what it explicitly does *not* do. Does it handle multi-repo monorepo setups? Does it support collaborative multi-user sessions? Does it handle non-code artifacts (Terraform, Docker Compose, CI configs)? Can it work offline? Without non-goals, scope creep is inevitable.
- **Benefit**: Non-goals prevent well-intentioned feature additions that violate architectural assumptions. They also set realistic expectations for stakeholders.
- **Suggested Approach**: Add a "Non-Goals (v1.0)" section listing 5-10 explicit exclusions. Example: "Multi-user collaboration is a non-goal for v1.0. APEX assumes a single developer per session. Real-time collaboration features are deferred to v2.0+."

---

### Enhancement: Competitive Analysis Should Be Factual, Not Marketing
- **Location**: §12 (Architectural Superiority — Head-to-Head)
- **Description**: The comparison table systematically undersells competitors and oversells APEX. Examples: Claude Code is listed as having "None built-in" for critic/review — but it has built-in lint detection and iterative error fixing. Cursor is listed as "None" for observability — but it has usage tracking. APEX claims "unlimited pods" which is physically impossible. This comparison will damage credibility with any technically sophisticated reader.
- **Benefit**: An honest comparison builds trust. A biased one makes the entire document suspect.
- **Suggested Approach**: 
  1. Remove subjective superlatives ("unlimited," "best," "superior").
  2. Use verified, specific claims: "Up to N parallel agent pods (configurable, default 8)" instead of "unlimited pods."
  3. Acknowledge where competitors have caught up or have genuine advantages (e.g., Claude Code's local execution speed, Cursor's IDE integration depth).
  4. If the table must exist, add a "Last Verified" date and acknowledge it may be outdated.
