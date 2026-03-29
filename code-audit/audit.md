# Code Quality Audit Report

## Executive Summary
- **Overall Score**: 742/1000
- **Maintainability Verdict**: Requires Refactoring
- **Primary Strengths**: Strong TypeScript typing, modular architecture with clear separation of concerns, comprehensive error handling patterns, well-documented function purposes
- **Critical Weaknesses**: Complex nested conditionals in `lifecycle-manager.ts`, duplicate metadata handling patterns, inconsistent error handling (some silent catches), large functions exceeding 100 lines, missing input validation at module boundaries

---

## File/Component Scores

| File/Path | Score /100 | Assessment |
|-----------|------------|------------|
| `src/index.ts` | 95 | Clean barrel file with well-organized exports |
| `src/atomic-write.ts` | 92 | Simple, focused, atomic implementation |
| `src/config-generator.ts` | 85 | Good parsing logic, minor regex complexity |
| `src/feedback-tools.ts` | 78 | Solid validation, some repetitive patterns |
| `src/global-pause.ts` | 98 | Minimal, purposeful, well-typed |
| `src/key-value.ts` | 95 | Simple parser with good edge case handling |
| `src/lifecycle-manager.ts` | 58 | Complex nested logic, needs decomposition |
| `src/metadata.ts` | 72 | Duplicated patterns, inconsistent validation |
| `src/observability.ts` | 76 | Good structure, some long functions |
| `src/opencode-session-id.ts` | 98 | Focused validation, single responsibility |
| `src/orchestrator-prompt.ts` | 82 | Good separation, could extract templates |
| `src/orchestrator-session-strategy.ts` | 95 | Simple normalization with clear fallbacks |
| `src/paths.ts` | 88 | Good path utilities, minor repetition |
| `src/plugin-registry.ts` | 80 | Clean registry pattern, could use stronger typing |
| `src/prompt-builder.ts` | 85 | Well-structured layer composition |
| `src/tmux.ts` | 82 | Good async patterns, hardcoded delays need config |
| `src/utils.ts` | 78 | Mix of unrelated utilities, needs split |
| `src/scm-webhook-utils.ts` | 90 | Focused utilities, minimal scope |
| `src/agent-selection.ts` | 85 | Good resolution logic, some optional chaining chains |
| `src/recovery/actions.ts` | 72 | Duplicate patterns, could use base class |
| `src/recovery/manager.ts` | 75 | Good orchestration, some repetitive switch patterns |
| `src/recovery/types.ts` | 92 | Comprehensive type definitions |
| `src/recovery/validator.ts` | 78 | Good validation, some unreachable branches |
| `src/recovery/scanner.ts` | 88 | Clean scanning logic |
| `src/recovery/logger.ts` | 85 | Simple logging, good formatting |
| `src/utils/validation.ts` | 90 | Focused validation utilities |
| `src/utils/pr.ts` | 95 | Simple parsing with good fallbacks |
| `src/utils/session-from-metadata.ts` | 80 | Good construction, complex inline PR handling |

---

## Detailed Findings

### Complexity & Duplication

#### Critical: `lifecycle-manager.ts` - Excessive Cognitive Complexity (lines 212-365)
The `determineStatus` function spans 150+ lines with deeply nested conditionals:

```typescript
// lifecycle-manager.ts:212-365
async function determineStatus(session: Session): Promise<SessionStatus> {
  // 6 levels of nesting with multiple early returns
  // Mixed concerns: PR detection, CI status, activity checking
}
```

**Impact**: Difficult to test individual branches, high cyclomatic complexity (estimated 15+), violates Single Responsibility Principle.

#### High: Duplicate Metadata Updates Pattern
Similar metadata update patterns appear in multiple files:

- `metadata.ts:updateMetadata` (lines 153-178)
- `recovery/actions.ts` update calls (lines 44-50, 140-144, 184-189)
- `lifecycle-manager.ts:updateSessionMetadata` (lines 511-529)

```typescript
// Repeated pattern across files:
updateMetadata(sessionsDir, sessionId, {
  status: "stuck",
  escalatedAt: now,
  // ...
});
```

**Impact**: Changes to metadata format require updates in 5+ locations. Risk of inconsistency.

#### Medium: `observability.ts` - Long Function Chain
`createProjectObserver` returns an object with methods that each do multiple things:
- `recordOperation` handles metric updates, trace storage, and logging (lines 335-412)
- `setHealth` has similar dual responsibility (lines 415-443)

#### Low: Minor Duplication in Path Generation
`paths.ts` has repetitive `join(getProjectBaseDir(...), "subdir")` patterns that could use a helper.

---

### Style & Convention Adherence

#### Consistent TypeScript Usage
- Strong typing throughout with explicit interfaces
- Good use of `readonly` and type narrowing
- Consistent use of `const` assertions for type inference

#### Naming Conventions
- **Good**: `createXxx` factory functions, `isXxx` boolean getters
- **Inconsistent**: Mix of `get` and `read` prefixes for similar operations
  - `getSessionsDir` vs `readMetadata` vs `getProjectBaseDir`
  - `readLastJsonlEntry` (utils.ts:115) - breaks naming pattern

#### Export Patterns
- Clean barrel file (`index.ts`) with logical grouping
- Some internal utilities exported that should be package-private

---

### Readability & Maintainability

#### Critical: Magic Numbers and Strings
Multiple hardcoded values without constants:

```typescript
// lifecycle-manager.ts:205
const stuckThresholdMs = parseDuration(thresholdStr);
if (stuckThresholdMs <= 0) return false;
// Where does "30_000" default come from?
pollTimer = setInterval(() => void pollAll(), intervalMs);
```

```typescript
// tmux.ts:133
await new Promise((resolve) => setTimeout(resolve, 100));
// Hardcoded 100ms delay - why?
```

```typescript
// observability.ts:134-136
const TRACE_LIMIT = 80;
const SESSION_LIMIT = 200;
// Good! These are extracted as constants
```

#### High: Missing Function Documentation
Several complex functions lack JSDoc comments:

- `lifecycle-manager.ts:determineStatus` - No documentation for complex state machine
- `recovery/validator.ts:classifySession` - Complex classification logic undocumented
- `agent-selection.ts:resolveAgentSelection` - Priority resolution rules unclear

#### Medium: Comment-to-Code Ratio
Some files over-comment obvious code:

```typescript
// metadata.ts:195-197
if (!latest) return null;
try {
  return parseKeyValueContent(readFileSync(join(archiveDir, latest), "utf-8"));
```

While complex logic in `lifecycle-manager.ts` has insufficient comments.

---

### Performance Anti-patterns

#### Medium: Synchronous File Operations
Multiple synchronous file operations in hot paths:

```typescript
// metadata.ts uses sync operations
writeFileSync(path, content, "utf-8");
existsSync(path);
readdirSync(dir);
```

**Impact**: Blocking event loop in Node.js. Should use async equivalents for production code.

#### Low: Repeated Object Iteration
In `observability.ts:readObservabilitySummary`, the same snapshot is iterated multiple times:

```typescript
// Lines 465-543: Multiple iterations over same objects
for (const [bucketKey, counter] of Object.entries(snapshot.metrics ?? {})) { ... }
for (const trace of snapshot.traces ?? []) { ... }
for (const health of Object.values(snapshot.health ?? {})) { ... }
for (const session of Object.values(snapshot.sessions ?? {})) { ... }
```

Could be consolidated into a single pass.

#### Low: Inefficient Map Key Construction
```typescript
// observability.ts:281-283
function metricBucketKey(metric: ObservabilityMetricName, projectId?: string): string {
  return `${projectId ?? "unknown"}::${metric}`;
}
```
Creates new strings for each call. Consider using tuples as Map keys for hot paths.

---

### Security & Error Handling

#### Critical: Silent Exception Swallowing
Multiple `catch` blocks silently ignore errors:

```typescript
// lifecycle-manager.ts:271
} catch {
  // On probe failure, preserve current stuck/needs_input state
}

// lifecycle-manager.ts:305-308
} catch {
  // SCM detection failed — will retry next poll
}

// tmux.ts:150-154
} finally {
  try {
    unlinkSync(tmpFile);
  } catch {
    /* ignore cleanup errors */
  }
}
```

**Impact**: Makes debugging difficult, hides potential issues. Should at least log errors.

#### High: Path Traversal Prevention
Good: `metadata.ts:50-56` validates session IDs against regex:

```typescript
const VALID_SESSION_ID = /^[a-zA-Z0-9_-]+$/;
function validateSessionId(sessionId: SessionId): void {
  if (!VALID_SESSION_ID.test(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
}
```

#### High: Command Injection Prevention
Good: `tmux.ts` uses `execFile` instead of `exec` to prevent shell injection:

```typescript
// tmux.ts:10-21
function tmux(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, { timeout: 10_000 }, (error, stdout, stderr) => {
```

#### Medium: Input Validation Gaps
- `config-generator.ts:parseRepoUrl` throws on invalid input but doesn't sanitize
- `feedback-tools.ts:persist` accepts any `FeedbackToolInput` without additional validation
- URL validation in `utils.ts:validateUrl` only checks protocol, not URL validity

---

### Type Safety Issues

#### Medium: Any Type Escapes
```typescript
// plugin-registry.ts:92-94
get<T>(slot: PluginSlot, name: string): T | null {
  const entry = plugins.get(makeKey(slot, name));
  return entry ? (entry.instance as T) : null;
  // Unchecked cast - assumes correct type
}
```

```typescript
// observability.ts:199
const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<ProcessObservabilitySnapshot>;
// Cast without validation
```

---

## Final Verdict

The `packages/core` package demonstrates solid TypeScript fundamentals with good modular architecture. However, the codebase shows signs of organic growth that has introduced complexity, particularly in:

1. **State Management** (`lifecycle-manager.ts`): The 900+ line file handles too many concerns and needs decomposition into focused modules.

2. **Error Handling**: Inconsistent patterns range from explicit throws to silent catches. A unified error handling strategy is needed.

3. **Metadata Layer**: Multiple files manipulate metadata directly. This should be consolidated behind a service layer.

4. **Testing Observability**: Several functions with side effects (file I/O, network calls) are tightly coupled, making unit testing difficult without mocking the filesystem.

**Recommendation**: Prioritize refactoring `lifecycle-manager.ts` and establishing consistent error handling before adding new features. The foundation is solid but needs consolidation.