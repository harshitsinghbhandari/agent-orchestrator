# APEX Decomposition Guide

## The Problem

APEX.md is a 772-line monolith that tries to be a vision document, a technical specification, a marketing pitch, and a project configuration file simultaneously. It fails at all four. Claude wrote it in a single generative pass — which means it optimized for *coherent reading*, not *implementable building*. The result is a document that sounds impressive but collapses the moment you ask "okay, what do I build first?"

This guide defines exactly how to dismantle it into files that can each be audited, challenged, and either promoted to **SPEC** (implementable) or demoted to **UNDERSPECIFIED** (needs research before it can be built).

---

## Ground Rules

> [!IMPORTANT]
> **Rule 1: Audit before writing.** Every section extracted from APEX.md must be brutally audited *before* it becomes its own file. Do not copy-paste Claude's prose and call it a spec. Dissect it. What is real? What is hallucinated ambition? What is missing?

> [!IMPORTANT]
> **Rule 2: Every file earns its existence.** If a file cannot answer "What does this component consume? What does it produce? How does it fail?" — it is not a spec. It is a wish. Label it accordingly.

> [!IMPORTANT]
> **Rule 3: No file exceeds 200 lines.** If it does, it's trying to do too much. Split further.

---

## Target Directory Structure

```
apex/
├── README.md                          # Project overview, navigation index
├── GLOSSARY.md                        # Canonical term definitions
├── NON_GOALS.md                       # What APEX v1.0 explicitly will NOT do
├── PHASING.md                         # MVP roadmap: Phase 1 → 2 → 3
│
├── layers/
│   ├── L0_intelligence_substrate.md   # Model routing & constitutional reasoning
│   ├── L1_perception_engine.md        # Codebase ingestion & action streaming
│   ├── L2_context_sovereignty.md      # 5-layer context assembly & brain storage
│   ├── L3_planning_intelligence.md    # DAG construction & plan artifacts
│   ├── L4_agent_orchestration.md      # Agent fleet & event bus
│   ├── L5_execution_environment.md    # Local/cloud routing & sandbox model
│   ├── L6_quality_sovereignty.md      # 5-tier critic pipeline & self-healing
│   ├── L7_human_collaboration.md      # Confidence gates & artifact review
│   └── L8_observability.md            # Tracing, anomaly detection, cost tracking
│
├── interfaces/
│   ├── event_bus_schema.md            # Complete typed event taxonomy
│   ├── layer_contracts.md             # Input/output contracts between all layers
│   └── tool_manifest.md              # Complete tool surface with permissions
│
├── agents/
│   └── agent_fleet.md                 # All agent types, responsibilities, trust model
│
├── flows/
│   ├── happy_path.md                  # End-to-end: request → commit (no failures)
│   ├── self_healing_flow.md           # Critic failure → diagnosis → retry → success
│   └── parallel_execution_flow.md     # DAG tier parallelism → merge → advance
│
└── adr/
    ├── 001_dag_over_list.md           # Why DAG instead of linear task lists
    ├── 002_event_sourced_state.md      # Why event sourcing for agent state
    ├── 003_five_tier_critics.md        # Why 5 independent quality tiers
    ├── 004_zero_trust_agents.md        # Why agents don't trust each other
    └── 005_constitutional_reasoning.md # Why constraints at inference time
```

**Total files: 24**

---

## File-by-File Specification

### Tier 1: Foundation Files (Create First)

These files define the vocabulary, scope, and roadmap. Everything else references them.

---

#### 1. `README.md`
- **Purpose**: Navigation hub. A developer opens this first and knows where everything lives.
- **Source material**: APEX.md §0 (Executive Summary), §1 (Architecture Overview)
- **What to extract**: The 9-layer stack table, the core thesis (3 principles), the system topology diagram (redrawn as Mermaid)
- **What to audit**:
  - The 3 principles ("Omniscient Context", "DAG-Native Execution", "Multi-Tier Quality Sovereignty") — are these achievable or aspirational? Label each as **SPEC** or **ASPIRATIONAL**.
  - The system topology diagram — does it match what the layer specs actually describe? (Spoiler from the audit: it doesn't fully. The diagram shows Kafka in cloud; the specs never commit to Kafka.)
- **What to cut**: All marketing language. All competitor comparisons. All "APEX is the first to..." claims.
- **Status classification**: Mostly **SPEC** — this is structural, not implementational.

---

#### 2. `GLOSSARY.md`
- **Purpose**: Canonical definitions for every term used across all files.
- **Source material**: Extracted from the full APEX.md by identifying every term used inconsistently.
- **What to audit**: Nothing to audit — this is created fresh. But you must resolve these ambiguities from APEX.md:

| Ambiguous Usage in APEX.md | Decision Required |
|---|---|
| "task node" vs "DAG node" vs "subtask" | Pick ONE term. Define it. |
| "agent pod" vs "agent instance" vs "agent" | Define the hierarchy: agent type → agent instance → agent pod (runtime container) |
| "APEX Brain" vs "brain storage" vs "brain directory" vs "brain" | Pick ONE. Define namespace structure. |
| "context layer" (C1-C5) vs "architecture layer" (L0-L8) | Must be unambiguous. "Context tier" vs "System layer"? |
| "confidence score" vs "risk score" vs "trust score" | Three different scores. Define each, define range, define who computes it. |
| "critic" vs "quality tier" vs "review" | Critic = agent. Quality tier = pipeline stage. Review = human action. Make explicit. |
| "event" vs "message" vs "signal" | One term: "event." Kill the others. |
| "plan artifact" vs "artifact" (general) | "Plan document" vs "code artifact"? Disambiguate. |

- **Status classification**: **SPEC** — this is definitional, fully within our control.

---

#### 3. `NON_GOALS.md`
- **Purpose**: What APEX v1.0 will explicitly NOT attempt. This is a scope firewall.
- **Source material**: Inferred from APEX.md's silence on topics it should have addressed.
- **What to include** (proposed, audit each for agreement):
  1. Multi-user collaborative sessions (one developer per session)
  2. Non-code artifact generation (Terraform, Docker Compose, CI/CD configs) — code-only in v1.0
  3. Multi-repository coordination (single repo only)
  4. Offline operation (cloud services required for full functionality)
  5. Custom model fine-tuning (uses off-the-shelf models only)
  6. Full semantic merge (file-level isolation for parallel agents in v1.0)
  7. Real-time intent inference from behavior streams (explicit task requests only in v1.0)
  8. Production deployment of generated code (APEX generates, human deploys)
  9. Cross-language transpilation
  10. Self-modification of the agent system itself
- **Status classification**: **SPEC** — these are decisions, not implementations.

---

#### 4. `PHASING.md`
- **Purpose**: Defines what gets built in which order. The most important file in the entire decomposition.
- **Source material**: Not in APEX.md (this is its greatest failure). Created from the audit's feasibility analysis.
- **What to audit**: Each phase must be independently valuable. A developer using Phase 1 alone must get real work done.
- **Structure**:

```
## Phase 1: Single-Agent with Quality Checks (MVP)
  Target: A working agent that takes a task, plans it (linear, no DAG),
          executes it (local only), and runs 2 quality tiers (syntax + semantic).
  Layers activated: L3 (simplified), L4 (single agent), L5 (local only), L6 (Tiers 1-2)
  Files required: L3, L4, L5, L6, tool_manifest, agent_fleet (Generator + Critic only)
  What is DEFERRED: DAG parallelism, cloud VMs, Tiers 3-5, brain storage,
                     perception engine, observability, human gates

## Phase 2: Multi-Agent with Memory
  Target: Parallel agent execution with persistent memory and full quality pipeline.
  Layers activated: + L1 (LSP only), L2 (C1+C3+C5), L4 (multi-agent), L6 (all 5 tiers)
  Depends on: Phase 1 fully working and tested
  What is DEFERRED: Action streaming, intent inference, cloud VMs, observability dashboard

## Phase 3: Full Platform
  Target: The full APEX vision with cloud execution, observability, and human collaboration.
  Layers activated: All
  Depends on: Phase 2 stable for 30+ days
  What is DEFERRED: "Learned summarization model," full semantic merge, adaptive model routing
```

- **Status classification**: **SPEC** after audit, but the phase boundaries may shift as layer specs reveal hidden dependencies.

---

### Tier 2: Layer Specifications (The Core)

Each layer file follows an identical internal structure. This consistency is non-negotiable.

#### Mandatory Section Template for Every Layer File

Every file in `layers/` MUST contain these sections, in this order:

```markdown
# Layer LX — [Name]

## Status
[SPEC | PARTIALLY SPECIFIED | UNDERSPECIFIED]
- SPEC sections: [list]
- UNDERSPECIFIED sections: [list, with what's missing]

## Purpose
[2-3 sentences. What this layer does. Not what it aspires to. What it DOES.]

## Inputs
[Typed schema of what this layer consumes, from which layer/component]

## Outputs
[Typed schema of what this layer produces, to which layer/component]

## Internal Architecture
[How this layer works internally. Diagrams in Mermaid. Data flow. State management.]

## Failure Modes
[What happens when this layer breaks. For each failure mode:
 - Detection: How is it detected?
 - Degradation: What capability is lost?
 - Recovery: How does the system recover?]

## Resource Requirements
[CPU, memory, external services, LLM calls per operation, estimated cost]

## Dependencies
[What external systems/services this layer requires]

## Phase Mapping
[Which phase (from PHASING.md) activates this layer, and at what capability level]

## Open Questions
[Unresolved design decisions that block implementation]
```

---

#### 5. `layers/L0_intelligence_substrate.md`
- **Source**: APEX.md §9 (Layer 0)
- **What is SPEC-ready**:
  - The concept of per-operation model routing (not one model for everything)
  - Escalation triggers (critic failures → upgrade model)
  - The idea of constitutional constraints injected pre-generation
- **What is UNDERSPECIFIED** (mark explicitly):
  - The routing matrix is Anthropic-specific (Haiku/Sonnet/Opus). Needs abstraction to model tiers (fast/balanced/deep) with provider-agnostic mapping.
  - "Constitutional Reasoning Layer" — Appendix E claims it shifts token probability distributions during generation. This is NOT achievable via prompt wrapping. The spec must clarify: is this a system prompt with constraints (achievable) or a custom inference modification (requires model-level access, not feasible for v1.0)?
  - No latency budgets per model tier
  - No fallback chain if preferred model is unavailable (rate limited, API down)
  - Degradation triggers (when to use a cheaper model) have no criteria
- **Audit focus**: Is constitutional reasoning real architecture or Claude hallucinating a capability it wishes it had?

---

#### 6. `layers/L1_perception_engine.md`
- **Source**: APEX.md §2 (Layer 1)
- **What is SPEC-ready**:
  - Mode A (LSP Semantic Analysis) — this is proven technology. LSP servers exist for all major languages. Running one per language is standard.
  - Mode B (Whole-Repo Graph) — dependency graph construction is achievable with existing tools (tree-sitter, import analysis).
  - The debounced action stream processor concept (50ms windows, dedup, prioritize)
- **What is UNDERSPECIFIED**:
  - "Multi-language LSP federation" — How many languages simultaneously? What's the memory cost? (Each LSP server is 200-500MB RAM.)
  - Mode C (Real-Time Action Stream) — "Intent inference model that maintains a live prediction of what the developer is trying to accomplish." This is an unsolved research problem. Mark as **DEFERRED to Phase 3** or **RESEARCH NEEDED**.
  - "Live World Model" — What is the data structure? How large does it get? What's the eviction policy?
  - Clipboard monitoring has privacy implications. Needs explicit opt-in.
- **Audit focus**: Mode A is real. Mode B is achievable. Mode C is science fiction in its current description. Separate ruthlessly.

---

#### 7. `layers/L2_context_sovereignty.md`
- **Source**: APEX.md §3 (Layer 2)
- **What is SPEC-ready**:
  - The 5-layer context stack (C1-C5) with different TTLs and priorities — this is the best-designed component in the entire monolith
  - The assembly order (C1 → C2 → C3 → C4 → C5)
  - The Brain namespace structure (decisions/, failures/, patterns/, dependencies/, preferences/)
  - TTL policies per layer
- **What is UNDERSPECIFIED**:
  - "Compressed to fit model context window using learned summarization model" — What model? How trained? What quality guarantees? **Mark as UNDERSPECIFIED.** Substitute with: "hierarchical truncation — full code → signatures → names, applied progressively as context budget is consumed."
  - Context budget allocation per layer — no percentages defined
  - Brain write conflict resolution — two agents write to decisions/ simultaneously. Who wins?
  - Brain versioning — is it append-only? Can entries be corrected? What's the storage format?
  - "M-Query (multi-vector semantic)" in C3 — this term appears once and is never defined
- **Audit focus**: The 5-layer model is genuinely good. The compression and Brain storage are where Claude got lazy.

---

#### 8. `layers/L3_planning_intelligence.md`
- **Source**: APEX.md §4 (Layer 3)
- **What is SPEC-ready**:
  - Intent classification into [Feature | Bug Fix | Refactor | Test | Docs] — achievable with a prompted LLM
  - Complexity estimation [Small | Medium | Large | XL] — achievable
  - Fast Mode vs Plan Mode routing — sound design decision
  - The concept of a Plan Artifact with DAG visualization, risk matrix, and file impact list
  - Human review gates with auto-skip conditions
- **What is UNDERSPECIFIED**:
  - **The DAG construction algorithm itself.** This is the single most important capability in APEX and it has zero specification. HOW does the Architect Agent decompose "Add OAuth2 authentication" into 10 nodes with correct dependencies? What prompt? What context? What validation ensures the DAG is acyclic and complete? The OAuth2 example is illustrative, not implementable.
  - Risk scoring — the spec mentions risk scores but never defines the scale, the inputs, or the calculation. What makes a task risk 0.5 vs 0.8?
  - Token cost estimation per DAG node — mentioned but not specified. How accurate must it be? What happens when the estimate is wrong?
  - Fallback paths per node — mentioned in the DAG node schema but no fallback selection logic is defined
  - The 85% confidence threshold for ambiguity detection — where does this number come from? How is confidence calculated?
- **Audit focus**: DAG-native planning is APEX's crown jewel. If this layer's spec isn't airtight, nothing else matters. Spend the most time here.

---

#### 9. `layers/L4_agent_orchestration.md`
- **Source**: APEX.md §5 (Layer 4)
- **What is SPEC-ready**:
  - The principle that agents communicate only via event bus (no direct calls) — architecturally sound
  - The concept of isolated git worktrees per parallel agent — proven pattern
  - At-least-once delivery with DLQ — standard message queue pattern
- **What is UNDERSPECIFIED**:
  - **Semantic merge** — referenced 3 times, defined 0 times. Must be either specified or replaced with "file-level isolation" (agents cannot touch the same file in parallel). **This is the highest-priority UNDERSPECIFIED item in the entire architecture.**
  - Agent fleet responsibilities overlap (see audit: Critic vs Security Agent, Debugger vs Self-Healing Agent). Must be resolved before implementation.
  - Orchestrator's DAG tier scheduling algorithm — how does it decide which tier to advance? What if one parallel node finishes in 5 seconds and another takes 5 minutes?
  - Event bus technology choice — Kafka? Redis Streams? In-process queue? Each has vastly different operational requirements.
  - Maximum concurrent agents — "unlimited pods" is not a spec. Define: default 4, max 8, configurable.
- **Audit focus**: The event bus is the nervous system of APEX. If it's wrong, everything is wrong.

---

#### 10. `layers/L5_execution_environment.md`
- **Source**: APEX.md §6 (Layer 5)
- **What is SPEC-ready**:
  - The concept of hybrid local/cloud execution routing — sound
  - The routing criteria (task type + risk score) — reasonable
  - Zero-trust per-pod isolation with no persistent state — good security posture
  - Tool manifest organization by category
- **What is UNDERSPECIFIED**:
  - Container orchestration — Docker? K8s? Firecracker? Each has different capabilities and overhead.
  - VM provisioning time — spinning up an ephemeral VM takes 10-60 seconds. Is this acceptable? Pre-warmed pool? How many?
  - Network model — how does a cloud VM access the developer's local repo? Git clone? Sync daemon? NFS mount? Each has different latency and consistency characteristics.
  - "≤500ms tasks" routing to local — how is execution time estimated *before* execution? What if the estimate is wrong?
  - Meta-tool composition ("compose_tool") — intriguing but undefined. What's the composition language? How are composed tools validated? Can composed tools call other composed tools (recursion)?
  - Secrets management — "injected via vault" — which vault? HashiCorp Vault? Cloud KMS? How are secrets rotated?
- **Audit focus**: This layer has the most infrastructure decisions hiding behind hand-waves. Each UNDERSPECIFIED item is a multi-week engineering decision.

---

#### 11. `layers/L6_quality_sovereignty.md`
- **Source**: APEX.md §7 (Layer 6)
- **What is SPEC-ready**:
  - The 5-tier sequential pipeline concept — architecturally sound
  - Each tier's responsibilities are clearly defined (syntax, semantic, architectural, security, performance)
  - The Self-Healing Agent's 4-step diagnosis protocol (pattern matching → root cause → strategy adaptation → memory update) — the most detailed workflow in the entire monolith
  - Failure memory writes to Brain namespace — good design
- **What is UNDERSPECIFIED**:
  - Tier timeout budgets — each tier has no time limit. A malicious or confused LLM could spin indefinitely on Tier 2 or 3.
  - Partial pass handling — what if Tier 3 flags a WARNING but not a FAIL? Does the code advance? The spec only handles binary PASS/FAIL.
  - Tier ordering justification — why syntax before semantic? Why not run Tier 4 (security) first, since security-critical code should never be generated regardless of other tiers?
  - Self-healing retry budget — "if 3 retries failed" escalate to human. But 3 retries × 5 tiers × Opus-class models = potentially $10+ in LLM costs per failure. Is this acceptable?
  - Inter-tier dependencies — does Tier 3 (architectural consistency) need the results from Tier 1 and 2? Or does each tier operate on the raw code independently?
- **Audit focus**: This is the second most important layer (after L3). The Self-Healing protocol is APEX's strongest original idea — make sure the spec doesn't dilute it.

---

#### 12. `layers/L7_human_collaboration.md`
- **Source**: APEX.md §4.3 and §8.5 (scattered — L7 has no dedicated section in the monolith!)
- **What is SPEC-ready**:
  - 4 human gates (plan approval, diff review, security review, PR review)
  - Auto-skip conditions (confidence >95%, risk <0.2, trust mode, small task)
  - Plan Artifact as the review medium (DAG diagram, risk matrix, file impact, rollback plan)
- **What is UNDERSPECIFIED**:
  - **L7 doesn't have its own section in APEX.md.** It's distributed across §4.3 and §8.5. This is itself a red flag — Claude treated human collaboration as a subsystem of planning, not an independent architectural concern.
  - Gate timeout — what if the developer doesn't respond for an hour? Day? Does the task idle? Auto-cancel?
  - Partial approval — can a developer approve some subtasks and reject others? How does this affect the DAG?
  - Inline commenting on plan artifacts — mentioned but no protocol for how comments are processed back into plan revision
  - "Trust mode" — what scope? Per-project? Per-session? Per-task-type? Can it be revoked mid-task?
  - Notification mechanism — CLI prompt? IDE notification? Email? Slack webhook? Multiple channels?
- **Audit focus**: This layer is the weakest in the monolith because Claude didn't give it a real section. It needs the most original work.

---

#### 13. `layers/L8_observability.md`
- **Source**: APEX.md §10 (Layer 8)
- **What is SPEC-ready**:
  - Structured span schema with trace_id, span_id, agent_id, DAG node reference, model used, token counts, cost — well-defined
  - Anomaly detection patterns table (6 patterns with detection methods and responses)
  - Aggregation targets (per-task cost report, per-agent dashboard, per-project trends)
- **What is UNDERSPECIFIED**:
  - The span schema is essentially rebranded OpenTelemetry. Should this just USE OpenTelemetry? Why reinvent?
  - Circuit breaker behavior — the anomaly detection table says "Self-Healing Agent takes over" for retry loops, but doesn't define circuit breaker state transitions (closed → open → half-open).
  - Dashboard technology — "Prometheus + LangSmith" — is this the actual stack or an example? If actual, LangSmith is LangChain-specific. Is APEX tied to LangChain?
  - Cost tracking granularity — per-model-call? Per-agent? Per-DAG-node? Per-task? All of these? Storage implications?
  - Anomaly detection implementation — "rolling average over 10 tasks" — is this computed in-agent, in Prometheus, or in a separate service?
  - Alert routing — who receives alerts? Developer only? Team lead? Where? How?
- **Audit focus**: This layer is mostly standard infrastructure observability. The APEX-specific parts (agent anomaly detection, cost tracking per DAG node) need specification. The generic parts (Prometheus, OTel) should be acknowledged as "use existing tooling" rather than re-specified.

---

### Tier 3: Cross-Cutting Specifications

These files define things that span multiple layers.

---

#### 14. `interfaces/event_bus_schema.md`
- **Source**: APEX.md §5.2
- **Purpose**: Complete typed event taxonomy. Every event type that can flow through the bus.
- **What to audit**: The current schema has 8 event types. The architecture implies at least 15-20. List ALL of them.
- **What is UNDERSPECIFIED**: Idempotency key strategy, ACK event type, ordering guarantees per partition key, DLQ processing policy, event schema versioning.
- **Status**: **PARTIALLY SPECIFIED** — the schema is a starting point, not a complete spec.

---

#### 15. `interfaces/layer_contracts.md`
- **Source**: Doesn't exist in APEX.md — must be created from scratch.
- **Purpose**: For every pair of adjacent layers, define: what data crosses the boundary, in what format, with what latency expectation, and what happens if the other side is unavailable.
- **Structure**: One section per boundary: L0↔L-all (model calls), L1→L2, L2→L3, L3→L4, L4→L5, L5→L6, L6→L4 (feedback), L6→L7 (human gate), L7→L4 (gate result), L4→L8 (observability events).
- **Status**: **UNDERSPECIFIED** — 100% new work. APEX.md provides zero interface contracts.

---

#### 16. `interfaces/tool_manifest.md`
- **Source**: APEX.md §6.3
- **Purpose**: Complete tool surface with per-tool: name, input schema, output schema, side effects, required permissions, which agents can invoke it.
- **What to audit**: The current tool list has ~50 tools across 7 categories. For each tool, ask: is this a real tool or a wish? (e.g., `detect_antipatterns` — what antipatterns? How? Against what ruleset?)
- **What is UNDERSPECIFIED**: No tool has an input/output schema. No tool has a permission model. No tool has a failure mode.
- **Status**: **PARTIALLY SPECIFIED** — tool names exist, everything else is missing.

---

#### 17. `agents/agent_fleet.md`
- **Source**: APEX.md §5.1
- **Purpose**: Complete specification of every agent type: responsibilities, tools, trust model, spawn rules, concurrency limits.
- **What to audit**:
  - Resolve the overlaps identified in the audit (Critic ↔ Security, Debugger ↔ Self-Healing)
  - Define trust scoring: initial score, increment/decrement rules, threshold requirements per operation type
  - Define which agents exist in Phase 1, Phase 2, Phase 3
  - For each agent: max concurrent instances, memory budget, model tier requirement
- **Status**: **PARTIALLY SPECIFIED** — the fleet table exists but is a roster, not a spec.

---

### Tier 4: Flow Specifications

These files describe how the layers interact for specific scenarios.

---

#### 18. `flows/happy_path.md`
- **Source**: APEX.md §8 (Complete Execution Flow)
- **Purpose**: The end-to-end flow with no failures. Request → classify → plan → execute → critic (all pass) → commit.
- **Format**: Mermaid sequence diagram + prose walkthrough. Every event emitted must be named from `event_bus_schema.md`.
- **Status**: **PARTIALLY SPECIFIED** — §8 describes this in narrative form but doesn't use typed events.

---

#### 19. `flows/self_healing_flow.md`
- **Source**: APEX.md §7.2
- **Purpose**: Critic failure → Self-Healing diagnosis → strategy adaptation → retry → success (or escalation to human).
- **Must define**: Max retries per tier, max retries per DAG node, cost cap per self-healing cycle, when to give up.
- **Status**: **PARTIALLY SPECIFIED** — the 4-step diagnosis is described but the boundaries (when to stop, cost limits) are missing.

---

#### 20. `flows/parallel_execution_flow.md`
- **Source**: APEX.md §5.3, §8.4
- **Purpose**: How parallel DAG tiers work. Worktree creation → agent pod spawning → concurrent execution → merge → advance.
- **Must resolve**: The semantic merge problem (or explicitly replace with file-level isolation for v1.0).
- **Status**: **UNDERSPECIFIED** — this flow cannot be specified until the merge strategy is decided.

---

### Tier 5: Architecture Decision Records

These files preserve the *why* behind design choices. They use the [MADR format](https://adr.github.io/madr/).

---

#### 21-25. `adr/001_dag_over_list.md` through `adr/005_constitutional_reasoning.md`
- **Source**: APEX.md Appendix A-E
- **Purpose**: Convert the 5 informal design rationales into structured ADRs.
- **MADR format per file**:
  ```
  # ADR-NNN: [Title]
  
  ## Status
  [Proposed | Accepted | Deprecated | Superseded]
  
  ## Context
  [What is the problem we're solving?]
  
  ## Decision
  [What did we decide?]
  
  ## Alternatives Considered
  [What else could we have done? Why didn't we?]
  
  ## Consequences
  [What are the positive and negative implications?]
  
  ## Implementation Notes
  [How does this decision constrain the implementation?]
  ```
- **What to audit per ADR**:
  - ADR-001 (DAG over list): Solid reasoning. Promote to **Accepted**.
  - ADR-002 (Event-sourced state): Sound, but the spec never actually implements event replay. Add a note: "Event replay is specified but not yet designed."
  - ADR-003 (Five-tier critics): Solid reasoning, but the tier ordering rationale is missing. Add it.
  - ADR-004 (Zero-trust agents): Good principle, but the trust scoring is unimplemented. Status: **Proposed** (not Accepted until trust scoring is specified).
  - ADR-005 (Constitutional reasoning): The rationale claims model-level integration. The implementation describes prompt wrapping. These are different things. Must resolve the contradiction. Status: **Proposed** with revision needed.

---

## Decomposition Execution Protocol

When you sit down to actually write each file, follow this exact protocol:

### Step 1: Extract
Pull the relevant sections from APEX.md into a scratch buffer. Do not edit yet.

### Step 2: Audit (Sukuna Phase)
For each claim in the extracted content, ask:
1. **Is this specific enough to implement?** → If no, mark as **UNDERSPECIFIED**.
2. **Is this technically feasible with current technology?** → If no, mark as **RESEARCH NEEDED** or **DEFERRED**.
3. **Is this consistent with other layer specs?** → If contradicts, flag and resolve.
4. **Does this have a failure mode?** → If not discussed, add one.
5. **What's the cost?** → If not quantified, estimate or mark as **COST UNKNOWN**.

### Step 3: Classify Each Section
Every section in the file gets one of these labels:

| Label | Meaning | Action |
|---|---|---|
| **✅ SPEC** | Specific enough to implement. Feasible. Consistent. | Write the spec as-is with typed schemas. |
| **⚠️ UNDERSPECIFIED** | The idea is sound but critical details are missing. | Write what's known. List exactly what's missing under an "Open Questions" heading. |
| **🔬 RESEARCH NEEDED** | The capability requires investigation before it can be specified. | Write the goal. List candidate approaches. Define a spike/PoC to evaluate. |
| **🚫 DEFERRED** | Not in scope for v1.0. May be infeasible entirely. | Write a one-paragraph description of what this would be. Reference the Non-Goals. |
| **💀 HALLUCINATED** | Claude wrote something that sounds good but is not achievable or meaningful. | Delete it. Do not preserve hallucinated capabilities in the spec. |

### Step 4: Write
Using the mandatory section template, write the file. Every claim is either backed by the classification label or removed.

### Step 5: Cross-Reference
After the file is written, verify:
- Every input references a layer that actually produces that output
- Every output is consumed by a layer that actually expects it
- Every tool referenced exists in `tool_manifest.md`
- Every event referenced exists in `event_bus_schema.md`
- Every agent referenced exists in `agent_fleet.md`
- Every term used is defined in `GLOSSARY.md`

---

## Priority Order for File Creation

Not all 24 files are equally important. Build them in this order:

| Priority | Files | Rationale |
|---|---|---|
| **P0 (Day 1)** | `GLOSSARY.md`, `NON_GOALS.md`, `PHASING.md` | These constrain everything else. Without them, every subsequent file is unbounded. |
| **P1 (Week 1)** | `L3_planning_intelligence.md`, `L6_quality_sovereignty.md`, `agent_fleet.md` | The brain and the immune system. If planning and quality are wrong, nothing else matters. |
| **P2 (Week 2)** | `L4_agent_orchestration.md`, `event_bus_schema.md`, `layer_contracts.md` | The nervous system. Agents need a bus and contracts before they can operate. |
| **P3 (Week 3)** | `L5_execution_environment.md`, `tool_manifest.md`, `L2_context_sovereignty.md` | The body. Where code runs, what tools exist, what context feeds the brain. |
| **P4 (Week 4)** | `L1_perception_engine.md`, `L0_intelligence_substrate.md`, `L7_human_collaboration.md`, `L8_observability.md` | The senses and the mirror. Important but depend on the core being solid first. |
| **P5 (Ongoing)** | `flows/*.md`, `adr/*.md`, `README.md` | Cross-cutting docs that improve as the layer specs mature. |

---

## Success Criteria

The decomposition is **complete** when:

1. [ ] Every file follows the mandatory section template
2. [ ] Every claim is labeled ✅ SPEC, ⚠️ UNDERSPECIFIED, 🔬 RESEARCH NEEDED, 🚫 DEFERRED, or 💀 HALLUCINATED
3. [ ] Zero terms are used without a GLOSSARY.md entry
4. [ ] Every inter-layer boundary has a typed contract in `layer_contracts.md`
5. [ ] Every event type is defined in `event_bus_schema.md`
6. [ ] `PHASING.md` maps every layer/component to a phase with acceptance criteria
7. [ ] A new engineer can read `README.md` → `PHASING.md` → any layer spec and know exactly what to build, what's proven, and what's still open — without reading the original 772-line monolith
8. [ ] The original [APEX.md](file:///Users/harshitsinghbhandari/Downloads/main-quests/koc/APEX.md) is archived (not deleted) as a historical vision document with a note: "This is the original vision. The implementable specifications are in `apex/`."

---

> [!CAUTION]
> **Do not fall into Claude's trap of writing beautiful, coherent prose that sounds like a spec but isn't one.** Every sentence in every file must either define a typed interface, state a constraint with a number, list a failure mode with a recovery strategy, or be marked UNDERSPECIFIED. If it does none of these things, it is marketing copy. Delete it.
