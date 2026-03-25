# [HISTORICAL VISION] **APEX**

> [!NOTE]
> This is a historical vision document. The current implementable specifications, split by architectural layers, can be found in the [apex/](../apex/README.md) directory.

## **ADAPTIVE PARALLEL EXECUTION AGENT**

*Architectural Execution Flow Specification*

Classification: Architecture Specification v1.0

*Architecture synthesized from: Claude Code · Jules · Cursor · Windsurf · Antigravity*

*Extended with: DAG Orchestration · Event-Sourced State · Constitutional Reasoning · Self-Healing Agents*


# **EXECUTIVE SUMMARY**

**APEX (Adaptive Parallel Execution Agent)** is an architectural framework that takes the best properties of every major AI coding agent — Claude Code, Jules, Cursor, Windsurf, and Antigravity — strips each to its essential genius, and builds a new system from those first principles.

**The problem with all existing agents:**

|<p>**What they each do well:**</p><p>- **Claude Code:** LSP precision + local execution speed</p><p>- **Jules:** Whole-codebase awareness + async VM isolation</p><p>- **Cursor:** Parallel agents + MoE model + rules system</p><p>- **Windsurf:** Real-time context flow + 4-layer assembly</p><p>- **Antigravity:** Artifact review + brain memory + browser</p>|<p>**What none of them solve:**</p><p>- No agent predicts what you need before you ask</p><p>- No agent has event-sourced rollback at every decision node</p><p>- No agent routes tasks via a full DAG with conditional branching</p><p>- No agent has constitutional safety baked into the reasoning layer</p><p>- No agent self-heals by diagnosing its own failure strategy, not just retrying</p>|
| :- | :- |

|**APEX CORE THESIS**|
| :- |
|APEX operates on three foundational principles that no existing agent has simultaneously achieved:|
||
|1\. OMNISCIENT CONTEXT — The agent knows the full codebase semantically, knows what you just did,|
|`   `knows what you are about to need, and has a persistent cross-session memory of every decision made.|
||
|2\. DAG-NATIVE EXECUTION — Tasks are not steps in a list. They are nodes in a directed acyclic graph.|
|`   `Every subtask has dependencies, parallelism potential, risk scores, and fallback paths defined before|
|`   `a single line of code is written.|
||
|3\. MULTI-TIER QUALITY SOVEREIGNTY — Five independent quality layers evaluate every code artifact: syntax,|
|`   `semantic correctness, architectural consistency, security surface, and performance implications.|
|`   `No output reaches the user that has not cleared all five tiers.|


# **1. ARCHITECTURE OVERVIEW — 9-LAYER STACK**

APEX is organized as a 9-layer stack. Each layer is independently operable, has a clearly defined interface to adjacent layers, and can be scaled or replaced without disrupting the system. Layers communicate via a typed event bus — no layer calls another layer's internals directly.

|**LAYER**|**NAME**|**PRIMARY FUNCTION**|**SOURCE INSPIRATION**|
| :- | :- | :- | :- |
|**L0**|Intelligence Substrate|Hybrid model routing: MoE for speed, frontier for depth|Cursor Composer 1 + Claude Opus|
|**L1**|Perception Engine|Real-time codebase ingestion, action tracking, visual input|Windsurf Flow + Claude Code LSP + Jules repo clone|
|**L2**|Context Sovereignty|5-layer weighted context assembly with TTL and compression|Windsurf 4-layer + Antigravity Brain + Claude MEMORY.md|
|**L3**|Planning Intelligence|DAG decomposition, risk scoring, plan artifact generation|Antigravity Plan Mode + Jules Perceive-Plan + Cursor Plan Mode|
|**L4**|Agent Orchestration|Specialized agent fleet with async message bus coordination|Antigravity Multi-Agent + Cursor Parallel + Jules Multi-Agent|
|**L5**|Execution Environment|Hybrid local + ephemeral cloud VM with zero-trust sandbox|Jules Cloud VM + Claude Code Local + Antigravity Dual Interface|
|**L6**|Quality Sovereignty|5-tier critic pipeline with self-healing failure diagnosis|Jules Critic Agent + Windsurf Auto-Fix + Cursor Error Detection|
|**L7**|Human Collaboration|Confidence-gated checkpoints, annotated artifact review|Antigravity Artifacts + Cursor Plan Review + Jules PR Review|
|**L8**|Observability|Full distributed tracing, cost per decision, anomaly detection|Production-grade: Prometheus + LangSmith + OpenTelemetry|

## **1.1 System Topology Diagram**

|`                    `┌─────────────────────────────────────────────────────┐|
| :- |
|`                    `│              USER / DEVELOPER INTERFACE              │|
|`                    `│  CLI  │  IDE Extension  │  Web Dashboard  │  API     │|
|`                    `└──────────────────────┬──────────────────────────────┘|
|`                                           `│ Task Request|
|`                                           `▼|
|`  `┌────────────────────────────────────────────────────────────────────────┐|
|`  `│                        APEX ORCHESTRATION CORE                         │|
|`  `│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │|
|`  `│  │  Perception  │  │   Planning   │  │  Execution   │                │|
|`  `│  │   Engine     │  │ Intelligence │  │  Coordinator │                │|
|`  `│  │  (L1)        │  │  (L3)        │  │  (L4+L5)     │                │|
|`  `│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                │|
|`  `│         │                 │                  │                        │|
|`  `│         └─────────────────┴──────────────────┘                        │|
|`  `│                           │ TYPED EVENT BUS                           │|
|`  `│         ┌─────────────────┴──────────────────┐                        │|
|`  `│         │                 │                  │                        │|
|`  `│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐                │|
|`  `│  │  Context     │  │   Quality    │  │  Human       │                │|
|`  `│  │  Sovereignty │  │  Sovereignty │  │ Collaboration│                │|
|`  `│  │  (L2)        │  │  (L6)        │  │  (L7)        │                │|
|`  `│  └──────────────┘  └──────────────┘  └──────────────┘                │|
|`  `└────────────────────────────────────────────────────────────────────────┘|
|`            `│                                            │|
|`            `▼                                            ▼|
|`  `┌─────────────────────┐                    ┌────────────────────────┐|
|`  `│ LOCAL RUNTIME        │                    │ CLOUD EXECUTION LAYER  │|
|`  `│ • LSP Server         │                    │ • Ephemeral VMs        │|
|`  `│ • File System        │◄──── Hybrid ──────►│ • Parallel Agent Pods  │|
|`  `│ • Git Operations     │       Sync          │ • Isolated Sandboxes   │|
|`  `│ • Terminal Shell     │                    │ • Kafka Event Bus      │|
|`  `└─────────────────────┘                    └────────────────────────┘|
|`                                   `│|
|`                                   `▼|
|`                    `┌──────────────────────────┐|
|`                    `│   OBSERVABILITY LAYER      │|
|`                    `│  Prometheus │ LangSmith    │|
|`                    `│  OpenTelemetry traces      │|
|`                    `│  Anomaly detection         │|
|`                    `└──────────────────────────┘|


# **2. LAYER 1 — PERCEPTION ENGINE**

**Design Principle:** The agent must know everything about the codebase before the developer has to explain anything. Perception happens continuously, not on-demand. Knowledge is pre-built, not fetched at query time.

## **2.1 Tri-Mode Codebase Ingestion**

APEX uses three simultaneous ingestion methods that run in parallel on system startup and update incrementally on every file change:

|<p>**Mode A: LSP Semantic Analysis**</p><p>Language Server Protocol server runs as a background process. Builds a live semantic map of the entire codebase — every symbol, import, type, reference, and definition. Updates in real-time on file save. Provides sub-100ms symbol resolution.</p><p>**From:** Claude Code LSP integration</p><p>**Elevated by:** Multi-language LSP federation (TypeScript, Python, Go, Rust, Java LSPs running in parallel)</p>|<p>**Mode B: Whole-Repo Graph Ingestion**</p><p>At task initiation, APEX builds a full dependency graph of the repository. Not just file-level — module-level, service-level, and cross-repo if multi-repo context is available. Identifies anti-patterns, circular dependencies, and dead code zones before the task begins.</p><p>**From:** Jules whole-codebase awareness</p><p>**Elevated by:** Persistent across sessions; incremental diff-based graph updates, not full reclones</p>|
| :- | :- |

**Mode C: Real-Time Action Stream**

Every developer action is streamed into the perception engine continuously: file opens, edits, cursor position, terminal commands executed, test results, clipboard contents, navigation history, and browser interactions. This stream is processed by an intent inference model that maintains a live prediction of what the developer is trying to accomplish — so the agent never needs to be told twice.

**From:** Windsurf's Flow paradigm (tracking all actions including clipboard, terminal, navigation)

**Elevated by:** Intent inference layer — the agent derives 'what you are trying to do' from behavior, not just from explicit requests

## **2.2 Real-Time Perception Flow**

|` `FILE SYSTEM EVENTS ──►┐|
| :- |
|` `TERMINAL OUTPUT  ──►  │|
|` `CURSOR MOVEMENT  ──►  │    ┌─────────────────────────────────┐|
|` `CLIPBOARD CHANGE ──►  ├───►│   ACTION STREAM PROCESSOR       │|
|` `BROWSER STATE    ──►  │    │   • Debounce (50ms windows)     │|
|` `TEST RESULTS     ──►  │    │   • Dedup + prioritize          │|
|` `GIT EVENTS       ──►  │    │   • Tag with context tags       │|
|` `LSP DIAGNOSTICS  ──►  │    │   • Intent inference model      │|
|` `MCP SERVER DATA  ──►┘    └──────────────┬──────────────────┘|
|`                                          `│|
|`                          `┌───────────────▼──────────────────┐|
|`                          `│     LIVE WORLD MODEL              │|
|`                          `│  • Current developer intent       │|
|`                          `│  • Active code region             │|
|`                          `│  • Recent failure patterns        │|
|`                          `│  • Dependency graph state         │|
|`                          `│  • Test coverage map              │|
|`                          `└───────────────┬──────────────────┘|
|`                                          `│|
|`                              `Feeds into L2 Context Assembly|


# **3. LAYER 2 — CONTEXT SOVEREIGNTY**

**Design Principle:** Context is not assembled once per request. It is a living, weighted, TTL-managed structure that is continuously updated by the Perception Engine and compressed intelligently before each LLM invocation. Stale context expires. High-signal context is promoted.

## **3.1 Five-Layer Context Architecture**

|`  `┌─────────────────────────────────────────────────────────────────────────┐|
| :- |
|`  `│  LAYER C5: TASK CONTEXT (highest priority, lowest TTL)                  │|
|`  `│  • Current user request  • Active error messages  • Pending diffs       │|
|`  `│  TTL: Cleared per task                                                  │|
|`  `├─────────────────────────────────────────────────────────────────────────┤|
|`  `│  LAYER C4: ACTION CONTEXT (live, rolling window)                        │|
|`  `│  • Last 50 developer actions  • Terminal history  • Navigation path     │|
|`  `│  TTL: Rolling 30-minute window, compressed every 10 actions             │|
|`  `├─────────────────────────────────────────────────────────────────────────┤|
|`  `│  LAYER C3: SEMANTIC CONTEXT (query-time retrieval)                      │|
|`  `│  • RAG over codebase embeddings  • M-Query (multi-vector semantic)      │|
|`  `│  • Relevant code snippets scored by task relevance (top-K, re-ranked)   │|
|`  `│  TTL: Refreshed per LLM call, top-16 chunks, BM25 + dense hybrid       │|
|`  `├─────────────────────────────────────────────────────────────────────────┤|
|`  `│  LAYER C2: SESSION MEMORY (persistent within project)                   │|
|`  `│  • APEX.md — project encyclopedia (fetched as needed, never appended)  │|
|`  `│  • Decision log — every architectural choice + rationale                │|
|`  `│  • Failed attempts — stored to prevent repetition                       │|
|`  `│  TTL: Project lifetime, summarized monthly                              │|
|`  `├─────────────────────────────────────────────────────────────────────────┤|
|`  `│  LAYER C1: IDENTITY CONTEXT (lowest priority, permanent)                │|
|`  `│  • Tech stack rules  • Coding conventions  • Architectural constraints  │|
|`  `│  • Team preferences fetched from APEX.md (never in system prompt)       │|
|`  `│  TTL: Never expires unless explicitly changed                           │|
|`  `└─────────────────────────────────────────────────────────────────────────┘|
||
|`  `Assembly order per LLM call: C1 → C2 (on-demand lookup) → C3 → C4 → C5|
|`  `Compressed to fit model context window using learned summarization model|

## **3.2 The APEX Brain — Cross-Session Persistent Memory**

The APEX Brain is a versioned knowledge store that survives across all sessions. It is organized into five namespaces, each with its own write policy and read access pattern:

|**Namespace**|**What Is Stored**|**Written By**|**Read Priority**|
| :- | :- | :- | :- |
|**decisions/**|Architectural choices + full rationale, timestamp, author agent|Architect Agent on every design decision|HIGH — prevents architectural drift|
|**failures/**|Every failed approach + why it failed + what was tried next|Self-Healing Agent after diagnosis|HIGH — prevents repeat failures|
|**patterns/**|Idiomatic code patterns identified in this codebase|Perception Engine on ingestion|MEDIUM — style consistency|
|**dependencies/**|Known library behaviors, version quirks, incompatibilities|Execution Agent when encountered|MEDIUM — reduces hallucination|
|**preferences/**|Developer workflow preferences, accepted/rejected suggestions|Human Collaboration Layer on feedback|LOW — comfort, not correctness|


# **4. LAYER 3 — PLANNING INTELLIGENCE**

**Design Principle:** No code is written until the plan is a graph. Tasks are not checklists. Every subtask carries a dependency set, a risk score, an estimated token cost, a parallelism flag, and a fallback path. Planning is the most important phase — execution is just plan replay with real-time adaptation.

## **4.1 Task Intake & Intent Decomposition**

|` `USER REQUEST RECEIVED|
| :- |
|`         `│|
|`         `▼|
|` `┌────────────────────────────────────────────────────────────┐|
|` `│  INTENT CLASSIFIER                                          │|
|` `│  • Classify: [Feature | Bug Fix | Refactor | Test | Docs]  │|
|` `│  • Estimate complexity: [Small | Medium | Large | XL]       │|
|` `│  • Identify entry points in codebase (from LSP + Brain)     │|
|` `│  • Pull relevant decisions/ from APEX Brain                 │|
|` `│  • Detect ambiguity — if confidence < 85%, trigger clarify  │|
|` `└────────────────────────────┬───────────────────────────────┘|
|`                              `│|
|`         `┌────────────────────▼───────────────────────┐|
|`         `│ COMPLEXITY ROUTING                          │|
|`         `│                                             │|
|`   `[Small/Medium]                               [Large/XL]|
|`         `│                                             │|
|`         `▼                                             ▼|
|`  `FAST MODE: Skip plan       PLAN MODE: Full DAG generation|
|`  `artifact. Execute with     + human artifact review required|
|`  `inline critic checks       before any execution begins|

## **4.2 DAG Construction — The Execution Graph**

This is APEX's defining architectural advance over all existing agents. Where every other agent decomposes tasks into ordered steps (a list), APEX constructs a true Directed Acyclic Graph where subtasks declare their dependencies, parallelism potential, risk levels, and fallback paths explicitly.

|` `EXAMPLE: 'Add OAuth2 authentication to the API'|
| :- |
||
|` `DAG STRUCTURE:|
||
|`  `[T0: Explore auth module]  ◄─── No dependencies, run immediately|
|`          `│|
|`  `[T1: Design schema]  ◄─── Depends on T0, sequential|
|`          `│|
|`  `┌───────┴────────────────────────┐|
|`  `│                                │|
|` `[T2: DB migrations]            [T3: Token service]   ◄── Parallel! Both depend on T1|
|`  `│                                │|
|`  `└───────┬────────────────────────┘|
|`          `│ (both must complete)|
|`  `┌───────┴──────────────────────────────────┐|
|`  `│                  │                        │|
|` `[T4: API routes]  [T5: Middleware]  [T6: Client SDK]  ◄── 3-way parallel, depend on T2+T3|
|`  `│                  │                        │|
|`  `└──────────────────┴────────────────────────┘|
|`                     `│|
|`             `[T7: Integration tests]|
|`                     `│|
|`             `[T8: Security audit]  ◄── Critic Agent, independent of T7|
|`                     `│|
|`             `[T9: PR + Documentation]  ◄── Depends on T7 pass + T8 pass|
||
|` `Each node carries: {risk\_score, token\_estimate, parallelizable, fallback\_path, assigned\_agent}|

## **4.3 Plan Artifact & Human Review Protocol**

For any task classified Large or XL, APEX generates a rich Plan Artifact before any code is written. This artifact is interactive — the developer can highlight sections, leave inline comments, reject subtasks, or propose alternatives. The agent revises the plan and re-presents before executing.

|<p>**Plan Artifact Contents:**</p><p>- **DAG Visualization** — rendered as Mermaid diagram</p><p>- **Risk Matrix** — per subtask risk scores</p><p>- **File Impact List** — every file to be touched</p><p>- **Architectural Decisions** — why this approach vs alternatives</p><p>- **Test Strategy** — what will be tested, how</p><p>- **Rollback Plan** — how to undo if anything fails</p><p>- **Confidence Score** — agent's self-assessed certainty</p>|<p>**Human Review Gates:**</p><p>- **Gate 1** — Plan approval before execution starts</p><p>- **Gate 2** — Diff review before each major commit</p><p>- **Gate 3** — Security audit review before merge</p><p>- **Gate 4** — Final PR review with auto-generated description</p><p></p><p>**Auto-Skip Gates when:**</p><p>- Task confidence > 95% AND risk score < 0.2</p><p>- Developer has enabled 'trust mode' for this scope</p><p>- Task is classified Small with no schema/API changes</p>|
| :- | :- |


# **5. LAYER 4 — AGENT ORCHESTRATION**

**Design Principle:** APEX deploys a fleet of specialized agents that communicate via an async typed event bus — never by direct function calls. Each agent has a single responsibility, a declared capability surface, and a trust score. The Orchestrator routes work to agents based on capability + availability + current load, not hardcoded assignment.

## **5.1 The Agent Fleet**

|**Agent Name**|**Primary Role**|**Tools Available**|**Can Spawn Sub-Agents?**|
| :- | :- | :- | :- |
|**Architect Agent**|DAG construction, risk scoring, architectural decisions|read\_codebase, LSP, APEX Brain, plan\_artifact|Yes → Specialist Agents|
|**Generator Agent**|Code writing and implementation|write\_file, edit\_file, LSP, bash, search\_codebase|No|
|**Critic Agent**|5-tier quality review of all generated code|read\_file, run\_tests, run\_linter, security\_scan|Yes → Diagnostic Agent|
|**Debugger Agent**|Failure analysis and fix strategy generation|bash, read\_file, run\_tests, APEX Brain failures/|No|
|**Tester Agent**|Test generation, test execution, coverage analysis|write\_file, run\_tests, read\_file, coverage\_report|No|
|**Security Agent**|Vulnerability scanning, dependency audit, threat modeling|security\_scan, dependency\_audit, read\_file|No|
|**Browser Agent**|E2E testing, visual regression, UI validation|browser\_navigate, screenshot, form\_fill, accessibility\_audit|No|
|**Commit Agent**|Git operations, PR generation, changelog writing|git\_\*, write\_file (PR description)|No|
|**Self-Healing Agent**|Diagnoses agent failures, adapts execution strategy|All read tools + APEX Brain + event\_bus|Yes → any agent|
|**Observability Agent**|Metrics collection, anomaly detection, cost tracking|prometheus\_push, trace\_emit, alert\_trigger|No|

## **5.2 Event Bus Architecture — Inter-Agent Communication**

No agent calls another agent directly. All communication passes through a typed event bus. This is the fundamental architectural decision that makes APEX horizontally scalable, debuggable, and resilient. Every event is logged, replayable, and auditable.

|` `TYPED EVENT SCHEMA:|
| :- |
||
|` `{|
|`   `"event\_id": "evt\_sha256\_unique",|
|`   `"event\_type": "TASK\_ASSIGNED" | "TASK\_COMPLETED" | "TASK\_FAILED" ||
|`                 `"REVIEW\_REQUESTED" | "REVIEW\_APPROVED" | "REVIEW\_REJECTED" ||
|`                 `"HUMAN\_GATE\_TRIGGERED" | "SELF\_HEAL\_INITIATED" | ...|
|`   `"source\_agent": "architect\_agent",|
|`   `"target\_agent": "generator\_agent" | "broadcast",|
|`   `"task\_node\_id": "T4",   // DAG node reference|
|`   `"payload": { ... },|
|`   `"timestamp": "ISO8601",|
|`   `"trace\_id": "span\_id\_for\_distributed\_tracing",|
|`   `"priority": 1-5,|
|`   `"requires\_ack": true|
|` `}|
||
|` `EVENT BUS GUARANTEES:|
|`  `• At-least-once delivery with idempotent consumers|
|`  `• Message ordering preserved per task DAG node|
|`  `• Dead letter queue for failed deliveries (triggers Self-Healing Agent)|
|`  `• Full replay from any checkpoint (event sourcing)|

## **5.3 Parallel Execution Strategy**

The Orchestrator analyses the DAG and identifies all subtasks that can execute in parallel (no shared dependencies, no conflicting file writes). Each parallel subtask is assigned to a dedicated agent instance running in an isolated git worktree, eliminating merge conflicts during execution.

|` `PARALLEL EXECUTION FLOW:|
| :- |
||
|` `DAG Analysis → Identify parallelizable nodes|
|`       `│|
|`       `▼|
|` `For each parallel set:|
|`   `1. Create git worktree (isolated branch state)|
|`   `2. Spawn agent pod in isolated sandbox|
|`   `3. Assign task node + context subset|
|`   `4. Agents execute concurrently (no shared state)|
|`   `5. Each agent emits TASK\_COMPLETED event with diff|
|`       `│|
|`       `▼|
|` `MERGE COORDINATOR:|
|`   `• Waits for all parallel nodes in same DAG tier to complete|
|`   `• Semantic merge (not textual) — understands intent of each diff|
|`   `• Detects semantic conflicts (two agents editing same logic differently)|
|`   `• Conflict → escalate to Architect Agent → resolve → re-merge|
|`       `│|
|`       `▼|
|` `Commit merged result → advance DAG to next tier|


# **6. LAYER 5 — EXECUTION ENVIRONMENT**

**Design Principle:** Execution happens in the right place — local for speed and file access, cloud for isolation and long-running parallel tasks. The routing decision is automatic, based on task type and risk score. Security is zero-trust: every agent pod is sandboxed, every operation is audited, and no persistent access survives task completion.

## **6.1 Hybrid Execution Routing**

|`  `TASK ARRIVES FOR EXECUTION|
| :- |
|`         `│|
|`         `▼|
|`  `┌────────────────────────────────────────────────────────┐|
|`  `│          EXECUTION ROUTER (automatic decision)          │|
|`  `└──────────────────────────┬─────────────────────────────┘|
|`                             `│|
|`          `┌──────────────────┼────────────────────┐|
|`          `│                  │                    │|
|`          `▼                  ▼                    ▼|
|`   `LOCAL EXECUTION     CLOUD VM              BROWSER AGENT|
|`   `(≤ 500ms tasks)     (any task)            (UI/E2E tasks)|
|`         `│                  │                    │|
|`   `• File reads        • Isolated VM         • Playwright|
|`   `• LSP queries        • Ephemeral (destroyed  • Screenshot|
|`   `• Quick edits          after task)          • Accessibility|
|`   `• Git operations    • Full repo clone      • Performance|
|`   `• Test runs         • Build + test env       profiling|
|`   `• Linting           • Parallel instances|
|`         `│                  │                    │|
|`         `└──────────────────┴────────────────────┘|
|`                            `│|
|`                     `Results returned via|
|`                     `typed event bus|

## **6.2 Zero-Trust Sandbox Model**

|<p>**Every Agent Pod:**</p><p>- Runs in ephemeral container (Docker/K8s pod)</p><p>- No persistent filesystem access after task ends</p><p>- Network access: only declared MCP endpoints</p><p>- No cross-agent shared memory (only event bus)</p><p>- File deletions require explicit permission flag</p><p>- All operations written to immutable audit log</p><p>- CPU + memory hard limits per agent type</p><p>- Secrets injected via vault, never in env vars</p>|<p>**Security Guarantees:**</p><p>- Principle of least privilege per agent</p><p>- Cross-VM contamination impossible (destroyed on completion)</p><p>- User identity propagated through all agent calls</p><p>- Data never leaves declared cloud region</p><p>- All LLM calls audited for prompt injection attempts</p><p>- MCP server authentication via signed JWTs</p><p>- Agent-to-agent trust scores (new agents start untrusted)</p>|
| :- | :- |

## **6.3 Tool Manifest — Complete APEX Tool Surface**

APEX exposes a richer tool surface than any existing agent, organized by category. Tools are not statically defined — the Architect Agent can compose meta-tools (sequences of primitives) and register them in the tool manifest for reuse within a session.

|` `FILESYSTEM TOOLS:   read\_file, write\_file, edit\_file (str\_replace),|
| :- |
|`                     `delete\_file (requires permission), list\_directory,|
|`                     `watch\_directory (streaming), create\_directory|
||
|` `ANALYSIS TOOLS:     search\_codebase (semantic), find\_references (LSP),|
|`                     `get\_definition (LSP), get\_type\_info (LSP),|
|`                     `dependency\_graph, detect\_antipatterns, dead\_code\_scan|
||
|` `EXECUTION TOOLS:    bash (with timeout + output capture), run\_tests,|
|`                     `build\_project, run\_linter, security\_scan,|
|`                     `coverage\_report, profile\_performance|
||
|` `GIT TOOLS:          git\_status, git\_diff, git\_commit, git\_push,|
|`                     `git\_branch, git\_checkout, git\_merge,|
|`                     `create\_pr (with auto-description), git\_worktree\_\*|
||
|` `BROWSER TOOLS:      browser\_navigate, browser\_screenshot, browser\_click,|
|`                     `browser\_fill\_form, browser\_wait\_for, accessibility\_audit,|
|`                     `visual\_regression\_check, performance\_profile|
||
|` `MEMORY TOOLS:       brain\_read (namespace, query), brain\_write,|
|`                     `brain\_query\_semantic, session\_context\_get,|
|`                     `session\_context\_set, compress\_context|
||
|` `ORCHESTRATION TOOLS:spawn\_agent (type, task, context), send\_event,|
|`                     `wait\_for\_event, create\_human\_gate, approve\_gate,|
|`                     `reject\_gate\_with\_feedback|
||
|` `META TOOLS:         compose\_tool (sequence of primitives → named tool),|
|`                     `register\_tool (add to manifest), invoke\_mcp (server, tool)|


# **7. LAYER 6 — QUALITY SOVEREIGNTY**

**Design Principle:** Quality is not a post-processing step. It is an architectural property. Every code artifact must pass through five independent quality tiers before it can advance in the DAG. Failure at any tier does not trigger a simple retry — it triggers a diagnostic procedure that updates the failure memory and adapts the generation strategy.

## **7.1 The Five-Tier Critic Pipeline**

|`  `GENERATED CODE ARTIFACT|
| :- |
|`         `│|
|`         `▼|
|`  `┌────────────────────────────────────────────────────────────────┐|
|`  `│  TIER 1: SYNTACTIC INTEGRITY                                    │|
|`  `│  • Parse-level validation (AST construction must succeed)       │|
|`  `│  • Linting (ESLint, Pylint, golangci-lint per language)         │|
|`  `│  • Type checking (TSC strict mode, mypy, etc.)                  │|
|`  `│  • Auto-fix applied for deterministic issues (auto-lint)        │|
|`  `│  FAIL: Return to Generator Agent with structured diff report    │|
|`  `└──────────────────────────────┬─────────────────────────────────┘|
|`                                 `│ PASS|
|`  `┌──────────────────────────────▼─────────────────────────────────┐|
|`  `│  TIER 2: SEMANTIC CORRECTNESS                                   │|
|`  `│  • Logic verification against task intent                       │|
|`  `│  • Algorithm correctness review by Critic Agent (LLM)           │|
|`  `│  • Import completeness check (no hallucinated dependencies)     │|
|`  `│  • API contract compliance (does it match declared interfaces?)  │|
|`  `│  FAIL: Trigger Debugger Agent with structured diagnosis         │|
|`  `└──────────────────────────────┬─────────────────────────────────┘|
|`                                 `│ PASS|
|`  `┌──────────────────────────────▼─────────────────────────────────┐|
|`  `│  TIER 3: ARCHITECTURAL CONSISTENCY                              │|
|`  `│  • Does this code follow patterns in decisions/ brain?          │|
|`  `│  • Does it introduce prohibited patterns?                       │|
|`  `│  • Does it maintain separation of concerns?                     │|
|`  `│  • Cross-file consistency (all consumers of new API updated?)   │|
|`  `│  FAIL: Escalate to Architect Agent for realignment             │|
|`  `└──────────────────────────────┬─────────────────────────────────┘|
|`                                 `│ PASS|
|`  `┌──────────────────────────────▼─────────────────────────────────┐|
|`  `│  TIER 4: SECURITY SURFACE                                       │|
|`  `│  • SAST scan (Semgrep, Bandit, or equivalent)                   │|
|`  `│  • Dependency vulnerability check (CVE database)                │|
|`  `│  • Secret detection (no hardcoded credentials)                  │|
|`  `│  • Input validation + injection risk assessment                 │|
|`  `│  FAIL: Block + alert developer + write to failures/ brain      │|
|`  `└──────────────────────────────┬─────────────────────────────────┘|
|`                                 `│ PASS|
|`  `┌──────────────────────────────▼─────────────────────────────────┐|
|`  `│  TIER 5: PERFORMANCE IMPLICATIONS                               │|
|`  `│  • Big-O complexity estimation for new algorithms               │|
|`  `│  • Database query plan analysis (N+1 detection)                 │|
|`  `│  • Memory allocation patterns (leaks, unbounded growth)         │|
|`  `│  • Regression vs benchmarks (if prior benchmarks exist)         │|
|`  `│  FAIL: Flag as WARNING if minor, BLOCK if regression detected   │|
|`  `└──────────────────────────────┬─────────────────────────────────┘|
|`                                 `│ ALL TIERS PASSED|
|`                                 `▼|
|`                     `Code advances in DAG → next node|

## **7.2 Self-Healing — The Diagnosis Loop**

When the Critic Pipeline produces a failure, APEX does not simply re-run the Generator Agent with the error message appended. The Self-Healing Agent performs a structured diagnosis before any retry is attempted. This eliminates the retry loops that plague all existing agents.

|`  `CRITIC PIPELINE FAILURE|
| :- |
|`         `│|
|`         `▼|
|`  `┌───────────────────────────────────────────────────────┐|
|`  `│  SELF-HEALING AGENT — DIAGNOSIS PROTOCOL              │|
|`  `│                                                        │|
|`  `│  Step 1: PATTERN MATCHING                              │|
|`  `│    Query failures/ brain: 'Has this exact failure      │|
|`  `│    pattern been seen before? What fixed it?'           │|
|`  `│    → If match found with >80% confidence: apply fix   │|
|`  `│                                                        │|
|`  `│  Step 2: ROOT CAUSE ANALYSIS                           │|
|`  `│    Trace failure back through DAG to originating node  │|
|`  `│    Was it a bad plan decision? Bad generation?         │|
|`  `│    Bad context? Tool output misinterpretation?         │|
|`  `│                                                        │|
|`  `│  Step 3: STRATEGY ADAPTATION                           │|
|`  `│    Based on root cause, choose adaptation:             │|
|`  `│    • Rewrite prompt with explicit constraints added    │|
|`  `│    • Fetch additional context from brain/codebase     │|
|`  `│    • Decompose task further (break into smaller steps) │|
|`  `│    • Switch to higher-capability model for this node  │|
|`  `│    • Escalate to human gate (if 3 retries failed)     │|
|`  `│                                                        │|
|`  `│  Step 4: MEMORY UPDATE                                 │|
|`  `│    Write failure + diagnosis + resolution to failures/ │|
|`  `│    brain so this exact failure never repeats           │|
|`  `└───────────────────────────────────────────────────────┘|


# **8. THE COMPLETE APEX EXECUTION FLOW — END TO END**

This section traces a single request through the entire APEX stack, from user input to committed code. Every step is labeled with the responsible component and the event emitted.

## **8.1 Phase 0: Continuous Background Operations**

These run before any task is requested, always-on:

|` `[BACKGROUND — ALWAYS RUNNING]|
| :- |
||
|`  `Perception Engine:|
|`    `• LSP servers running for all detected languages|
|`    `• Action stream processor buffering developer events|
|`    `• Codebase embeddings kept fresh (incremental on file save)|
|`    `• Intent inference model running on action stream|
||
|`  `Context Sovereignty:|
|`    `• Context layers C1-C4 pre-assembled and cached|
|`    `• APEX Brain indexed and queryable|
|`    `• TTL-expired context flushed and re-populated|
||
|`  `Observability Agent:|
|`    `• Prometheus metrics scraped every 15s|
|`    `• Anomaly detection on agent latency + error rates|
|`    `• Cost tracker accumulating per-session token spend|

## **8.2 Phase 1: Task Intake**

1. **User submits request** via CLI / IDE / Web. Event: TASK\_RECEIVED emitted to bus.
1. **Intent Classifier runs** — classifies task type + complexity. Pulls C1 and C2 context from brain.
1. **Ambiguity Check:** If confidence < 85%, HUMAN\_GATE triggered. Developer clarifies.
1. **Complexity Router** — routes to Fast Mode or Plan Mode based on classification.

## **8.3 Phase 2: Planning (Plan Mode only)**

1. **Architect Agent activated.** Reads full C1+C2+C3 context. Pulls relevant decisions/ from brain.
1. **DAG Construction:** Decomposes task into nodes. Assigns dependencies, risk scores, parallelism flags, agent assignments.
1. **Plan Artifact generated:** DAG diagram, risk matrix, file impact list, test strategy, rollback plan.
1. **HUMAN\_GATE\_TRIGGERED** (if XL task or risk score > 0.5). Developer reviews artifact, leaves comments.
1. **Plan revised** if feedback received. Loop until REVIEW\_APPROVED event.
1. **Approved DAG locked** — becomes immutable execution contract. Saved to session context.

## **8.4 Phase 3: Parallel Execution**

1. **Orchestrator reads DAG.** Identifies Tier 0 nodes (no dependencies). Spawns agent pods.
1. **Each agent pod:** git worktree created. Context subset assembled from C1-C5. Task node assigned.
1. **Agents execute concurrently.** Each emits TOOL\_CALL events (logged to trace). Each tool call logged to audit trail.
1. **Code generated by Generator Agent.** TASK\_CODE\_READY event emitted.
1. **Critic Pipeline activated:** 5 tiers run sequentially. CRITIC\_RESULT event emitted per tier.
1. **If any tier FAILS:** Self-Healing Agent diagnoses. Adapts strategy. Generator Agent re-runs with adaptation.
1. **All tiers PASS:** TASK\_COMPLETED event emitted with diff payload.
1. **When all parallel nodes in a DAG tier complete:** Merge Coordinator runs semantic merge.
1. **Next DAG tier unlocked.** Repeat until all DAG nodes completed.

## **8.5 Phase 4: Final Integration & Commit**

1. **Integration Tests run** by Tester Agent across full codebase (not just changed files).
1. **Security Agent** runs full repo scan. Any HIGH severity issues block commit, trigger HUMAN\_GATE.
1. **Browser Agent** runs E2E tests if UI was modified. Screenshots captured as evidence artifacts.
1. **Performance regression check** — compare to baseline benchmarks if they exist.
1. **HUMAN\_GATE\_TRIGGERED** — developer reviews final diff. Can approve, reject, or request modifications.
1. **Commit Agent** creates atomic commit with auto-generated conventional commit message.
1. **PR created** with auto-generated description: what changed, why, test evidence, risk level, rollback steps.
1. **Observability Agent** logs task summary: total tokens, cost, latency, agent utilization, quality tier pass rates.

## **8.6 Complete Flow Diagram**

|` `USER REQUEST|
| :- |
|`     `│|
|`     `▼|
|` `[L1: PERCEPTION] ──► Live world model updated continuously|
|`     `│|
|` `[L2: CONTEXT] ──► 5-layer context assembled, weighted, compressed|
|`     `│|
|` `[L3: PLANNING] ──► Intent classified → DAG constructed → Plan artifact|
|`     `│                    │|
|`     `│              [HUMAN GATE 1: Plan approval]|
|`     `│|
|` `[L4: ORCHESTRATION] ──► Parallel agent pods spawned per DAG tier|
|`     `│                    │|
|`     `│              ┌─────┴──────────────────────┐|
|`     `│          [Pod 1]    [Pod 2]    [Pod 3]  ...[Pod N]|
|`     `│           Gen→Critic  Gen→Critic  Gen→Critic|
|`     `│              └─────┬──────────────────────┘|
|`     `│              Semantic merge (per DAG tier)|
|`     `│|
|` `[L5: EXECUTION] ──► Local / Cloud VM / Browser (auto-routed)|
|`     `│                    │|
|`     `│         [L6: QUALITY] ──► 5-tier critic per artifact|
|`     `│                              │|
|`     `│                    [Self-Heal if fail] ──► Diagnose → Adapt → Retry|
|`     `│|
|` `[L7: HUMAN COLLABORATION] ──► Diff review gate before commit|
|`     `│|
|` `[COMMIT + PR] ──► Conventional commit + auto PR description|
|`     `│|
|` `[L8: OBSERVABILITY] ──► Full trace logged, cost tracked, anomalies checked|
|`     `│|
|`     `▼|
|` `TASK COMPLETE ──► Developer notified (async, non-blocking)|


# **9. LAYER 0 — INTELLIGENCE SUBSTRATE & MODEL ROUTING**

**Design Principle:** No single model is optimal for every task. APEX routes every agent invocation to the most cost-effective model capable of handling that specific operation with the required quality level. The routing decision is made by a lightweight classifier that considers task complexity, required reasoning depth, latency constraints, and cost budget.

## **9.1 Model Routing Decision Matrix**

|**Task Type**|**Default Model**|**Escalation Trigger**|**Degradation Trigger**|
| :- | :- | :- | :- |
|**Intent classification**|Haiku-class (fast)|Ambiguity score > 0.7|N/A — keep fast|
|**Context retrieval/ranking**|Embedding model|Never (deterministic)|N/A|
|**Code generation (small)**|Sonnet-class (balanced)|2 critic failures|Task complexity < L|
|**Code generation (large)**|Opus-class (deep)|Never (already max)|Task complexity < M|
|**Architectural planning**|Opus-class (deep)|N/A — always max|N/A|
|**Critic (Tier 1-2)**|Sonnet-class|Security or perf flagged|Tier 1 only → Haiku|
|**Critic (Tier 3-5)**|Opus-class|N/A|N/A|
|**Self-healing diagnosis**|Opus-class|N/A|N/A — correctness critical|
|**Git/commit operations**|Haiku-class|PR description > 5 files|N/A|
|**Browser agent commands**|Vision-capable Sonnet|Screenshot analysis needed|N/A|

## **9.2 Constitutional Reasoning Layer**

Every LLM invocation in APEX passes through a Constitutional Reasoning wrapper — a thin layer that injects reasoning constraints before the prompt is sent and validates the output against those constraints before it is returned to the calling agent. This is not a post-hoc filter; it is integrated into the inference call.

|<p>**Reasoning Constraints (Pre-Call):**</p><p>- 'If uncertain about an API's behavior, search before generating'</p><p>- 'If confidence < 80% on any claim, emit an uncertainty flag'</p><p>- 'Never hallucinate imports — verify against dependency graph'</p><p>- 'Prefer existing patterns in decisions/ brain over new ones'</p><p>- 'If a security implication is detected, flag before proceeding'</p><p>- 'Never generate secrets, credentials, or PII in output'</p>|<p>**Output Validation (Post-Call):**</p><p>- Structured output schema enforcement (JSON-mode where applicable)</p><p>- Uncertainty flag extraction — feeds into confidence score</p><p>- Hallucination detector — cross-references imports against known deps</p><p>- Secret scanner — blocks any output containing credential patterns</p><p>- Injection detector — blocks outputs that attempt to escape agent context</p>|
| :- | :- |


# **10. LAYER 8 — OBSERVABILITY & PRODUCTION READINESS**

**Design Principle:** An agent that cannot explain itself cannot be trusted in production. Every decision APEX makes — every tool call, every model invocation, every critic verdict, every self-healing action — is emitted as a structured trace event. Developers can replay any task, inspect any decision point, and audit any agent action.

## **10.1 Distributed Tracing Architecture**

|` `EVERY APEX OPERATION EMITS:|
| :- |
||
|` `Span: {|
|`   `trace\_id: "task-level UUID",|
|`   `span\_id: "operation UUID",|
|`   `parent\_span\_id: "calling operation UUID",|
|`   `operation: "GENERATOR\_AGENT.write\_file",|
|`   `agent\_id: "generator\_001",|
|`   `dag\_node: "T4",|
|`   `model\_used: "claude-sonnet-4",|
|`   `prompt\_tokens: 4820,|
|`   `completion\_tokens: 1200,|
|`   `latency\_ms: 1840,|
|`   `cost\_usd: 0.0024,|
|`   `critic\_tier\_results: ["PASS", "PASS", "FAIL@T3", ...],|
|`   `self\_heal\_triggered: false,|
|`   `tool\_calls: [{name, args\_hash, result\_hash, duration\_ms}],|
|`   `confidence\_score: 0.92|
|` `}|
||
|` `Aggregated into:|
|`   `• Per-task cost + quality report|
|`   `• Per-agent performance dashboard|
|`   `• Per-project trend analysis|
|`   `• Anomaly alerts (looping agents, cost spikes, quality degradation)|

## **10.2 Anomaly Detection & Circuit Breakers**

|**Anomaly Pattern**|**Detection Method**|**Response**|
| :- | :- | :- |
|**Agent retry loop (>3 retries on same node)**|Event count on task node ID|Self-Healing Agent takes over. Human gate if 5+ retries.|
|**Token cost spike (>3x baseline for task type)**|Cost threshold per task class|Alert + ask developer to approve budget extension|
|**Quality degradation trend (critic pass rate falling)**|Rolling average over 10 tasks|Alert + suggest model upgrade or context cleanup|
|**Hallucinated import (unknown package referenced)**|Dependency graph lookup|Immediate block + Debugger Agent activated|
|**Semantic conflict in parallel merge**|Diff intersection analysis|Pause merge + escalate to Architect Agent|
|**Security finding (HIGH severity)**|Tier 4 critic SAST result|Hard block on commit + mandatory human gate|


# **11. CONFIGURATION & EXTENSIBILITY**

## **11.1 APEX.md — The Project Encyclopedia**

APEX.md is the evolution of Claude Code's CLAUDE.md, Jules' AGENTS.md, and Cursor's .cursorrules — unified and extended. It is never appended to the system prompt. Sections are fetched on-demand as named lookups by the relevant agent (Architect for architecture/, Tester for testing/, Security for security/, etc.).

|` `APEX.md STRUCTURE:|
| :- |
||
|` `## architecture/|
|`   `[Fetched by Architect Agent on every planning phase]|
|`   `Tech stack decisions, service boundaries, prohibited patterns,|
|`   `deployment topology, cross-service contracts|
||
|` `## conventions/|
|`   `[Fetched by Generator Agent before every code write]|
|`   `Naming conventions, file structure rules, import order,|
|`   `error handling patterns, logging patterns|
||
|` `## testing/|
|`   `[Fetched by Tester Agent on test generation]|
|`   `Test framework, coverage requirements, test data patterns,|
|`   `mocking strategies, test naming conventions|
||
|` `## security/|
|`   `[Fetched by Security Agent on every scan]|
|`   `Approved libraries, prohibited functions, auth patterns,|
|`   `data classification rules, required headers|
||
|` `## agents/|
|`   `[Role assignments, agent-specific constraints]|
|`   `Which agents are active, their permission levels,|
|`   `custom tool compositions for this project|
||
|` `## external/|
|`   `[MCP server declarations]|
|`   `Jira endpoint, Slack workspace, Datadog instance,|
|`   `Custom APIs the agent can call during task execution|

## **11.2 Extensibility — Custom Agents & Tool Composition**

APEX is extensible at three levels:

1. **Level 1 — APEX.md configuration:** No code required. Configure agent behavior, rules, and MCP connections declaratively.
1. **Level 2 — Tool Composition:** Use the compose\_tool meta-tool to define reusable sequences of primitives. These become project-scoped tools available to any agent.
1. **Level 3 — Custom Agent Types:** Define a new agent with a YAML specification: capabilities, tool manifest, model preference, context requirements. Register it in APEX.md agents/ section. The Orchestrator will route to it when appropriate.


# **12. ARCHITECTURAL SUPERIORITY — HEAD-TO-HEAD**

|**Capability**|**Claude Code**|**Jules**|**Cursor**|**Windsurf**|**Antigravity**|**APEX**|
| :- | :- | :- | :- | :- | :- | :- |
|**Codebase awareness**|LSP (live)|Full repo clone|Embeddings|RAG + real-time flow|Git worktrees|LSP + graph + embeddings (tri-mode, live)|
|**Context assembly**|MEMORY.md + LSP|Full repo parse|.cursorrules lookup|4-layer weighted|Brain directory|5-layer TTL-weighted + compression|
|**Task decomposition**|Linear steps|PPEE loop (linear)|Plan mode (list)|Todo list (linear)|Plan artifact (list)|True DAG with risk scores + parallelism flags|
|**Parallel execution**|Subagents (basic)|Multi-VM (per task)|Up to 8 git worktrees|Dual planning/execution|5-8 agents|DAG-gated parallelism, unlimited pods, semantic merge|
|**Critic/review**|None built-in|Critic agent (1-tier)|Error detection|Auto-lint|Code review in plan|5-tier independent critic pipeline|
|**Self-healing**|Simple retry|Loop-back|Iterative refinement|Iterative refinement|Agent retry|Diagnosis + strategy adaptation + brain write|
|**Memory persistence**|MEMORY.md (session)|AGENTS.md (project)|.cursorrules (static)|Memories + rules|Brain directory|5-namespace versioned brain, cross-session semantic query|
|**Security model**|None (local)|VM per task|Optional cloud sandbox|None (local)|Audit logs|Zero-trust per-pod + constitutional layer + prompt injection detection|
|**Human collaboration**|Ask user|PR review|Plan review + diff|Diff review|Annotated artifacts|Confidence-gated multi-point gates with inline artifact commenting|
|**Observability**|None|Browser notifications|None|None|Audit logs|Full distributed tracing, cost/quality dashboards, anomaly detection|
|**Failure memory**|None|None|None|None|Brain (partial)|Structured failures/ namespace, used in every self-heal diagnosis|
|**Model routing**|Claude only|Gemini 3 Pro|Multi-model|Multi-model|Multi-model|Dynamic per-operation routing with escalation + degradation policies|


# **APPENDIX — KEY DESIGN DECISIONS**

## **A. Why a DAG instead of a list?**
Every existing agent decomposes tasks into ordered steps. This is fundamentally a list, even when it looks like a tree. A list assumes that all parallelism opportunities must be discovered at runtime by the executing agent. A DAG encodes the parallelism structure at planning time — before execution begins — making the execution deterministic, faster (parallel where possible), and auditable.

## **B. Why event-sourced state?**
Traditional agent systems lose state on failure. Event-sourced state means that every agent action is an event appended to an immutable log. The state of any agent at any point in time can be reconstructed by replaying events. This enables: full audit trails, point-in-time rollback, replay-based debugging, and zero data loss on agent failure.

## **C. Why 5 quality tiers instead of a single critic?**
A single critic agent suffers from conflation — it must simultaneously evaluate syntax correctness, logical correctness, architectural consistency, security implications, and performance. These are fundamentally different reasoning tasks requiring different context. Separating them into 5 independent tiers means each tier is optimized for its specific concern, runs in the right context, and can fail independently without blocking unrelated checks.

## **D. Why zero-trust between agents?**
Agent-to-agent trust in current systems is implicit — if an agent is spawned, it is trusted. APEX assigns trust scores to agent instances that start low and increase based on verified task completion history. A newly spawned agent with no track record cannot write to critical paths without an additional verification step. This prevents prompt injection attacks that target agent-to-agent communication channels.

## **E. Why constitutional reasoning at the inference layer?**
Post-hoc output filtering (adding a checker after the model generates) has a fundamental flaw: the model's generation process is already complete by the time the filter runs. Constitutional constraints injected before generation shift the probability distribution of the output toward compliant tokens during generation — not after. The result is fewer violations, not just faster detection of violations.



**APEX — Adaptive Parallel Execution Agent**

*Architectural Execution Flow Specification v1.0*

APEX Architecture Spec v1.0  |  Page 
