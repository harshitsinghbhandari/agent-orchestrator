# SURGICAL IMPLEMENTATION PROMPT — Agent Orchestrator Architecture Upgrade

## CONTEXT

You are working on the **Agent Orchestrator (AO)** codebase. This is a TypeScript monorepo (pnpm workspaces) that orchestrates AI coding agents across git worktrees with a plugin-based architecture (8 plugin slots: Runtime, Agent, Workspace, Tracker, SCM, Notifier, Terminal, Lifecycle).

An architecture audit has been completed. The audit identified 4 critical issues, 4 medium-priority issues, and 5 enhancements. You must implement them **in the exact order specified below** — the order reflects dependency chains. Do NOT skip ahead.

**Read these files first before writing any code:**
- `ARCHITECTURE.md` — Current system architecture
- `packages/core/src/types.ts` — All plugin interfaces and type definitions
- `packages/core/src/session-manager.ts` — Session CRUD, spawn, cleanup logic
- `packages/core/src/lifecycle-manager.ts` — Polling loop, state machine, reactions
- `packages/core/src/decomposer.ts` — LLM-driven task decomposition (tree-based)
- `packages/core/src/metadata.ts` — Flat-file metadata read/write
- `packages/core/src/atomic-write.ts` — Atomic file writes
- `packages/core/src/plugin-registry.ts` — Plugin loading and registration
- `packages/core/src/config.ts` — Zod schemas and config derivation
- `IDEA/apex/PHASING.md` — Phase 1-3 roadmap
- `IDEA/ifs/ifch1.md` — SSA Artifact System feasibility
- `IDEA/ifs/ifch3.md` — PID Control Theory feasibility
- `audit.md` — Architecture audit
- `improvements.md` — Improvements to be made
- `implementation_prompt.md` — this prompt
---

## PHASE 1: CRITICAL FIXES (Do these first, in order)

### TASK 1: Replace Flat-File Metadata Store with SQLite
**Priority**: P0 — Blocks everything else
**Files to modify**: `packages/core/src/metadata.ts`, `packages/core/src/atomic-write.ts`
**New files**: `packages/core/src/metadata-v2.ts`, `packages/core/src/db.ts`
**Dependency to add**: `better-sqlite3` + `@types/better-sqlite3`

**Requirements**:
1. Create `packages/core/src/db.ts` that:
   - Exports a `getDatabase(projectBaseDir: string)` function returning a `better-sqlite3` Database instance
   - Database file location: `{projectBaseDir}/state.db`
   - Enables WAL mode on creation (`PRAGMA journal_mode=WAL`)
   - Runs a migration on first open that creates the `sessions` table with columns matching the current `Session` interface fields in `types.ts` (id TEXT PRIMARY KEY, projectId TEXT, status TEXT, activity TEXT, branch TEXT, issueId TEXT, prUrl TEXT, prNumber INTEGER, workspacePath TEXT, runtimeHandleJson TEXT, agentInfoJson TEXT, createdAt TEXT, lastActivityAt TEXT, restoredAt TEXT, metadataJson TEXT)
   - Uses `INSERT OR REPLACE` for upserts
   - All operations are synchronous (matches AO's current synchronous metadata patterns)

2. Create `packages/core/src/metadata-v2.ts` that exports the same interface as `metadata.ts` but reads/writes to SQLite:
   - `readSessionMetadata(projectBaseDir: string, sessionId: string): SessionMetadata | null`
   - `writeSessionMetadata(projectBaseDir: string, sessionId: string, data: SessionMetadata): void`
   - `listSessionIds(projectBaseDir: string): string[]`
   - `deleteSessionMetadata(projectBaseDir: string, sessionId: string): void`
   - `reserveSessionId(projectBaseDir: string, prefix: string): string` — use a SQL transaction with `INSERT` to atomically reserve (replaces the `O_EXCL` filesystem lock)

3. Update `session-manager.ts` to use `metadata-v2.ts` instead of `metadata.ts`. Keep `metadata.ts` as-is for backward-compatibility — add a one-time migration function `migrateV1ToV2(projectBaseDir: string)` in `db.ts` that reads all existing flat files from `{projectBaseDir}/sessions/` and inserts them into SQLite.

4. Remove the `repairSessionMetadataOnRead` function calls from `session-manager.ts` — SQLite's ACID guarantees make reactive repair unnecessary.

5. **Do NOT add git-backed shadow repository.** That is a future enhancement.

**Validation**: All existing tests in `packages/core/src/__tests__/` must pass. Write new tests for `db.ts` and `metadata-v2.ts` covering: concurrent writes, reservation collision, migration from flat files.

---

### TASK 2: Extend Decomposer from Tree to DAG
**Priority**: P0 — Required for parallel execution
**Files to modify**: `packages/core/src/decomposer.ts`
**New files**: `packages/core/src/dag-scheduler.ts`

**Requirements**:
1. Extend the `TaskNode` interface in `decomposer.ts`:
   ```typescript
   export interface TaskNode {
     id: string;
     depth: number;
     description: string;
     kind?: TaskKind;
     status: TaskStatus;
     lineage: string[];
     children: TaskNode[];
     depends_on: string[];      // NEW: list of node_id strings this task depends on
     inputs: string[];           // NEW: SSA-style artifact identifiers, e.g. "auth.py@v1"
     outputs: string[];          // NEW: SSA-style artifact identifiers, e.g. "auth.py@v2"
     risk_score?: number;        // NEW: 0.0 - 1.0 risk assessment
     parallelizable?: boolean;   // NEW: can run concurrently with siblings
     result?: string;
     issueId?: string;
     sessionId?: string;
   }
   ```

2. Add a **second LLM pass** after decomposition in the `planTree` function. After children are created, make a new LLM call with this system prompt:
   ```
   You are a dependency analyzer for software subtasks. Given a list of subtasks and a codebase context, identify which subtasks depend on which others.

   Respond with a JSON object mapping task IDs to arrays of dependency task IDs.
   Example: {"1.2": ["1.1"], "1.3": ["1.1", "1.2"]}
   Tasks with no dependencies should map to an empty array.
   Only include real dependencies — do NOT make every task depend on the previous one.
   ```
   Apply the returned dependencies to the `depends_on` fields of each child node.

3. Add a **cycle detection** function using Kahn's algorithm:
   ```typescript
   export function validateDAG(nodes: TaskNode[]): { valid: boolean; cycle?: string[] }
   ```
   Call this after dependency analysis. If a cycle is detected, re-run the dependency analysis with an additional constraint: "The following dependency graph contained a cycle: {cycle}. Remove the edge that is least critical."

4. Create `packages/core/src/dag-scheduler.ts` (~200 lines):
   ```typescript
   export interface DAGTier {
     tier: number;
     nodes: TaskNode[];
   }

   /** Perform topological sort and group nodes into parallelizable tiers */
   export function computeTiers(root: TaskNode): DAGTier[]

   /** Get the critical path (longest path through the DAG) */
   export function criticalPath(root: TaskNode): TaskNode[]

   /** Get all nodes that are ready to execute (all dependencies met) */
   export function getReadyNodes(root: TaskNode): TaskNode[]

   /** Mark a node as completed and return newly unblocked nodes */
   export function completeNode(root: TaskNode, nodeId: string): TaskNode[]
   ```

5. Add `risk_score` estimation: after decomposition, make a lightweight LLM call (Haiku-class) that takes each subtask description + file list and returns a 0.0-1.0 risk score. Store in `risk_score` field.

**Validation**: Write tests for cycle detection, tier computation, critical path, and the ready-node resolver. Test with at least 3 DAG topologies: linear chain, diamond (A→B,C→D), and wide parallel (A→B,C,D,E→F).

---

### TASK 3: Build the Vertical Slice — Parallel DAG Execution
**Priority**: P0 — First proof of APEX feasibility
**Files to modify**: `packages/core/src/session-manager.ts`, `packages/core/src/lifecycle-manager.ts`
**New files**: `packages/core/src/dag-executor.ts`

**Requirements**:
1. Create `packages/core/src/dag-executor.ts` that:
   - Takes a `DecompositionPlan` with the DAG-extended `TaskNode`s
   - Uses `dag-scheduler.ts` to compute tiers
   - For each tier, spawns concurrent sessions (one per node) using the existing `session-manager.spawn()`
   - Each session gets: the node's `description` as prompt, `lineage` and `siblings` context (already supported by `SessionSpawnConfig`)
   - Waits for all nodes in a tier to reach terminal status before advancing to the next tier
   - If a node fails and retry count < 3: re-spawn with the failure context appended to the prompt
   - If a node fails and retry count >= 3: pause the entire DAG and emit a notification via the Notifier plugin
   - Tracks overall DAG state: `executing`, `paused`, `completed`, `failed`

2. Add a new CLI command or extend the existing `ao spawn` to support a `--decompose` flag:
   ```
   ao spawn integrator INT-100 --decompose
   ```
   This triggers: decompose → (optional human approval) → DAG execution.

3. **Constraint**: Do NOT build an event bus. Use direct async function calls between the executor and session manager. The event bus is a Phase 2 concern.

4. **Constraint**: Use the existing workspace plugin's `create()` method to make isolated git worktrees per concurrent session. This is already supported.

5. Add a simple **file-level isolation check**: before dispatching a tier, verify that no two nodes in the tier target the same file. If overlap is detected, serialize those specific nodes (move one to the next tier). Use a heuristic: ask the LLM "which files will this task modify?" with a Haiku-class model during DAG planning.

**Validation**: End-to-end test with a mock agent that: (a) a 3-node linear DAG executes sequentially, (b) a diamond DAG executes tier 0, then tier 1 in parallel, then tier 2, (c) a failure in tier 1 triggers retry and then human notification.

---

### TASK 4: Create the Cost Model
**Priority**: P0 — Without this, the system is financially blind
**New files**: `packages/core/src/cost-tracker.ts`, `IDEA/COST_MODEL.md`

**Requirements**:
1. Create `IDEA/COST_MODEL.md` documenting the expected per-task cost breakdown:
   | Task Complexity | Planning Calls | Generation Calls | Quality Calls | Self-Heal Calls | Total Calls | Est. Cost |
   |---|---|---|---|---|---|---|
   | Small (atomic) | 1 (classify) | 1 | 2 (T1-T2) | 0 | 4 | $0.20 |
   | Medium (3-node DAG) | 3 (classify+decompose+deps) | 3 | 6 (T1-T2 × 3) | 1 | 13 | $0.65 |
   | Large (7-node DAG) | 5 | 7 | 14 | 2 | 28 | $1.40 |
   | XL (15-node DAG) | 8 | 15 | 30 | 5 | 58 | $2.90 |

2. Create `packages/core/src/cost-tracker.ts`:
   ```typescript
   export interface CostEntry {
     sessionId: string;
     nodeId: string;
     operation: 'planning' | 'generation' | 'quality' | 'self_heal';
     model: string;
     inputTokens: number;
     outputTokens: number;
     estimatedCostUsd: number;
     timestamp: Date;
   }

   export interface CostBudget {
     maxCostUsd: number;
     currentCostUsd: number;
     remaining: number;
     entries: CostEntry[];
   }

   export class CostTracker {
     constructor(budgetUsd: number);
     record(entry: Omit<CostEntry, 'timestamp'>): void;
     getBudget(): CostBudget;
     isOverBudget(): boolean;
     /** Circuit breaker: returns true if cost rate exceeds 3x average */
     isCostAnomaly(): boolean;
   }
   ```

3. Integrate `CostTracker` into the DAG executor: create one tracker per `DecompositionPlan` with a configurable budget (default: plan complexity × $0.50). If `isOverBudget()` returns true, pause execution and notify.

4. Store cost data in the SQLite database (from Task 1): add a `cost_entries` table.

**Validation**: Unit tests for budget tracking, anomaly detection, and over-budget behavior.

---

## PHASE 2: MEDIUM PRIORITY (After Phase 1 is complete and tested)

### TASK 5: Implement SCM Rate Limiter
**Files to modify**: `packages/core/src/lifecycle-manager.ts`
**New files**: `packages/core/src/rate-limiter.ts`

**Requirements**:
1. Create a token-bucket rate limiter in `packages/core/src/rate-limiter.ts`:
   ```typescript
   export class TokenBucketRateLimiter {
     constructor(maxTokens: number, refillRatePerSecond: number);
     async acquire(count?: number): Promise<void>; // blocks until tokens available
     tryAcquire(count?: number): boolean; // non-blocking
   }
   ```
2. Wrap all SCM plugin calls in `lifecycle-manager.ts` with the rate limiter.
3. Default: 10 tokens max, refill 1 token/second (= max 60 requests/minute, well under GitHub's 5000/hour).
4. Share PR state across sessions targeting the same repo — cache `getPRState` results for 30 seconds.

---

### TASK 6: Implement Runtime loadFromConfig
**Files to modify**: `packages/core/src/plugin-registry.ts`

**Requirements**:
1. Implement the existing TODO in `loadFromConfig`:
   ```typescript
   // In agent-orchestrator.yaml:
   // plugins:
   //   - package: "@org/my-runtime-plugin"
   //   - path: "./plugins/my-custom-agent.ts"
   ```
2. For `package:` entries: use dynamic `import(packageName)`.
3. For `path:` entries: resolve relative to the config file location, then `import(absolutePath)`.
4. Validate that loaded modules conform to the `PluginModule` interface (has `manifest` and `create`).
5. Log warnings for plugins that fail to load (don't crash).

---

### TASK 7: Convert Curse Documents to ADRs
**New files**: `IDEA/apex/adr/ADR-001-sqlite-metadata.md` through `ADR-010-state-corruption.md`

**Requirements**:
For each of the 10 Curse Documents in `SUKUNA_FUSION_REPORT.md`, create an ADR with this structure:
```markdown
# ADR-{NNN}: {Title}

## Status
{Proposed | Accepted | Implemented | Deprecated}

## Context
{The problem statement from ① WEAKNESS REMOVED — keep the technical analysis, remove the theatrical language}

## Decision
{The solution from ② STRENGTH GAINED — rewritten as a concrete engineering decision}

## Implementation
- **Affected files**: {list of files in packages/core/src/}
- **Estimated effort**: {days}
- **Prerequisites**: {list of ADR-NNN that must be completed first}
- **Definition of done**: {specific acceptance criteria}

## Consequences
- **Positive**: {benefits}
- **Negative**: {tradeoffs, maintenance burden}
- **Risks**: {from the original Curse Document analysis}
```

Priority order: ADR-001 (SQLite store, Task 1 — mark as Implemented), ADR-002 (DAG planner, Task 2), ADR-003 (Transport abstraction), ADR-004 (Drift validation), ADR-005 remaining in order.

---

### TASK 8: Create Implementation Status Dashboard
**New files**: `IDEA/STATUS.md`

**Requirements**:
Create a single-page status dashboard:
```markdown
# APEX Implementation Status

| # | Component | Source Doc | Status | Phase | Effort | Dependencies | Owner |
|---|-----------|-----------|--------|-------|--------|-------------|-------|
| 1 | SQLite Metadata Store | Curse Doc #10 | ✅ Implemented | 1 | 3-5d | None | — |
| 2 | DAG-Aware Decomposer | Curse Doc #9 | ✅ Implemented | 1 | 3-5d | None | — |
| 3 | Parallel DAG Executor | Curse Doc #9 + L4 | ✅ Implemented | 1 | 5-7d | #2 | — |
| ... | ... | ... | ... | ... | ... | ... | ... |
```

Include all 10 Curse Documents, all 9 layer specs, all 4 IFS chapters. Update status as tasks complete.

---

## PHASE 3: ENHANCEMENTS (After Phase 2 is stable)

### TASK 9: PID Controller Module
**New files**: `packages/core/src/pid-controller.ts`

Implement per IFCH-03 spec:
```typescript
export class PIDController {
  constructor(config: { kp: number; ki: number; kd: number; setpoint: number; windupMax: number });
  update(currentValue: number, dt: number): number;
  reset(): void;
}
```
Default tuning for context pressure: Kp=0.4, Ki=0.1, Kd=0.6, setpoint=0.72, windupMax=5.0.
Include EMA low-pass filter on error signal before derivative computation (smoothing factor α=0.3).
~50 lines of pure math. Zero external dependencies.

### TASK 10: SSA Artifact Naming Prototype
**Files to modify**: `packages/core/src/decomposer.ts`

Extend decomposition LLM prompt to output `inputs`/`outputs` per node using `filename@v{n}` format. Add a validation function:
```typescript
export function validateSSAInvariant(nodes: TaskNode[]): { valid: boolean; violations: string[] }
```
that checks: each `filename@v{n}` appears in exactly one node's `outputs`. This is metadata only — no sandbox enforcement yet.

### TASK 11: Layer Stubs Directory
**New files**: `IDEA/apex/stubs/L1_stub.md` through `L8_stub.md`

For each APEX layer, document the simplest possible implementation that satisfies the interface:
- L1 Perception Stub: `git diff --stat` + `find . -name '*.{ts,py,go}'` → file list
- L2 Context Stub: Read file contents into prompt, truncate at token limit
- L3 Planning Stub: Current `decomposer.ts` with DAG extensions (Task 2)
- L4 Orchestration Stub: `dag-executor.ts` (Task 3)
- L5 Execution Stub: Current `tmux` runtime + `worktree` workspace
- L6 Quality Stub: `eslint` + `tsc` (Tier 1 only) — run as shell commands in worktree
- L7 Human Stub: Current `Notifier` plugin
- L8 Observability Stub: Current `observability.ts`

---

## EXECUTION RULES

1. **Order matters.** Task N depends on Task N-1. Do not parallelize across phases.
2. **Test before moving on.** Each task must have passing tests before starting the next.
3. **No new dependencies except `better-sqlite3`.** Do not add Redis, Kafka, Docker SDKs, or any infrastructure dependencies. This is Phase 1 — local only.
4. **No event bus.** Use direct function calls. The typed event bus is a Phase 2 concern.
5. **Keep changes backward-compatible.** The existing `ao spawn`, `ao list`, `ao attach`, `ao kill` commands must continue to work unchanged. New DAG features are opt-in via `--decompose` flag.
6. **Commit after each task.** Each task should be a single, reviewable PR-sized commit with a descriptive message.
7. **Write JSDoc comments.** Every new exported function needs a one-line JSDoc. No exceptions.
8. **Match existing code style.** Use the existing `eslint.config.js` and `.prettierrc`. Run `pnpm lint` and `pnpm format` before committing.
9. **File size limits.** No single new file should exceed 400 lines. If it does, split into modules.
10. **Log your cost.** At the end of implementation, report: total files created, total files modified, total lines added, total lines removed, and estimated time per task.
