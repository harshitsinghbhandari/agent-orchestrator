# Refactoring Impro Roadmap

## Critical Refactors

### Refactor: Decompose `lifecycle-manager.ts`
- **Location**: `src/lifecycle-manager.ts` (lines 1-922)
- **Problem**: Single 900+ line file handles state determination, reaction execution, review backlog management, and notification dispatching. Violates Single Responsibility Principle and has estimated cyclomatic complexity of 50+ in `determineStatus`.
- **Impact**: Hard to test, maintain, and extend. Any change to reactions, notifications, or state detection requires modifying the same file. High risk of regressions.
- **Suggested Approach**:
  1. Extract `determineStatus` into dedicated `session-state-detector.ts` with clear responsibilities
  2. Extract reaction execution into `reaction-executor.ts` with `executeReaction` and escalation logic
  3. Extract review backlog handling into `review-backlog-manager.ts` with `maybeDispatchReviewBacklog`
  4. Keep orchestration/polling logic in `lifecycle-manager.ts` as thin coordinator
  5. Each module should have <300 lines and focused imports

```typescript
// Proposed: session-state-detector.ts
export interface SessionStateDetector {
  determineStatus(session: Session): Promise<SessionStatus>;
}

// Proposed: reaction-executor.ts
export interface ReactionExecutor {
  execute(sessionId: SessionId, reactionKey: string): Promise<ReactionResult>;
}
```

---

### Refactor: Consolidate Metadata Operations
- **Location**: `src/metadata.ts`, `src/recovery/actions.ts`, `src/lifecycle-manager.ts`
- **Problem**: Metadata updates scattered across multiple files with similar patterns:
  - Reading, merging, writing in separate calls
  - Inconsistent error handling (some silent, some throw)
  - Different validation approaches
- **Impact**: Bug fixes require touching multiple files. Risk of metadata corruption if updates are partially applied. Missing validation in some paths.
- **Suggested Approach**:
  1. Create `metadata-service.ts` with unified API:
```typescript
export interface MetadataService {
  get(sessionId: SessionId): Promise<SessionMetadata | null>;
  update(sessionId: SessionId, updates: Partial<SessionMetadata>): Promise<void>;
  archive(sessionId: SessionId): Promise<void>;
  transitionStatus(sessionId: SessionId, from: SessionStatus, to: SessionStatus): Promise<boolean>;
}
```
  2. Add transaction-like semantics for multi-field updates
  3. Centralize validation in one place
  4. Replace direct `updateMetadata` calls with service method calls

---

### Refactor: Standardize Error Handling
- **Location**: `src/lifecycle-manager.ts` (lines 271, 305-308), `src/recovery/actions.ts` (lines 123-126), `src/observability.ts` (lines 319-330)
- **Problem**: Inconsistent error handling:
  - Some `catch` blocks silently swallow errors
  - Some rethrow with context
  - Some just preserve current state
  - No structured logging of errors
- **Impact**: Debugging production issues is difficult. Silent failures hide bugs. No observability into error rates.
- **Suggested Approach**:
  1. Create `errors.ts` with typed error classes:
```typescript
export class SessionError extends Error {
  constructor(message: string, public readonly sessionId: SessionId, cause?: Error) {
    super(message);
    this.cause = cause;
  }
}
export class RecoveryError extends SessionError {}
export class MetadataError extends SessionError {}
```
  2. Create `error-handler.ts` with consistent handling strategies:
```typescript
export type ErrorStrategy = 'log-and-continue' | 'preserve-state' | 'escalate';
export function handleError(error: unknown, context: ErrorContext, strategy: ErrorStrategy): void;
```
  3. Add structured logging to all catch blocks
  4. Make silent catches explicit with comments explaining why

---

## Medium Priority Improvements

### Refactor: Extract Configuration Constants
- **Location**: `src/lifecycle-manager.ts`, `src/tmux.ts`, `src/observability.ts`
- **Problem**: Magic numbers and timeouts scattered throughout codebase:
  - `tmux.ts:133` - 100ms delay
  - `lifecycle-manager.ts:166-169` - 1000ms paste delay
  - `observability.ts:134-136` - TRACE_LIMIT: 80, SESSION_LIMIT: 200
- **Impact**: Difficult to tune behavior without code changes. Inconsistent defaults across environments.
- **Suggested Approach**:
  1. Create `src/config/constants.ts`:
```typescript
export const TMUX_DELAYS = {
  ESCAPE_CLEAR_MS: 100,
  PASTE_SETTLE_MS: 1000,
} as const;

export const OBSERVABILITY_LIMITS = {
  TRACES: 80,
  SESSIONS: 200,
} as const;

export const LIFECYCLE_DEFAULTS = {
  POLL_INTERVAL_MS: 30_000,
} as const;
```
  2. Allow override via environment variables or config file

---

### Refactor: Split `utils.ts` Utility File
- **Location**: `src/utils.ts` (lines 1-152)
- **Problem**: Unrelated utilities mixed in one file:
  - Shell/AppleScript escaping
  - URL validation
  - HTTP retry logic
  - JSONL file reading
  - Config resolution
- **Impact**: Poor discoverability. Importing one function pulls in unrelated code. Hard to find related utilities.
- **Suggested Approach**:
  1. Split into focused modules:
     - `utils/shell.ts` - shell escaping utilities
     - `utils/http.ts` - HTTP retry utilities
     - `utils/file.ts` - file reading utilities
     - `utils/config.ts` - config resolution utilities
  2. Keep `utils.ts` as barrel file for backward compatibility
  3. Add deprecation warnings for direct imports from `utils.ts`

---

### Refactor: Improve Plugin Registry Type Safety
- **Location**: `src/plugin-registry.ts` (lines 81-138)
- **Problem**: `get<T>()` uses unchecked type assertion. Plugin loading has no runtime validation:
```typescript
get<T>(slot: PluginSlot, name: string): T | null {
  const entry = plugins.get(makeKey(slot, name));
  return entry ? (entry.instance as T) : null; // Unchecked cast!
}
```
- **Impact**: Runtime type mismatches cause confusing errors. No validation that loaded plugins conform to expected interfaces.
- **Suggested Approach**:
  1. Add runtime type checking via schema validation:
```typescript
import { z } from 'zod';

export function createPluginRegistry(): PluginRegistry {
  return {
    register(plugin: PluginModule, config?: Record<string, unknown>): void {
      // Validate manifest
      PluginManifestSchema.parse(plugin.manifest);
      // ...
    },
    // ...
  };
}
```
  2. Consider adding `getOrThrow<T>()` for required plugins
  3. Add plugin capability negotiation for version compatibility

---

### Refactor: Async File Operations in Metadata Module
- **Location**: `src/metadata.ts`, `src/recovery/logger.ts`
- **Problem**: Synchronous file operations (`writeFileSync`, `existsSync`, `readdirSync`) block the Node.js event loop:
```typescript
// metadata.ts:120
mkdirSync(dirname(path), { recursive: true });
atomicWriteFileSync(path, serializeMetadata(data));
```
- **Impact**: Degraded performance under load. Blocks other async operations during metadata operations.
- **Suggested Approach**:
  1. Replace with async equivalents:
```typescript
import { promises as fs } from 'node:fs';

export async function writeMetadata(
  dataDir: string,
  sessionId: SessionId,
  metadata: SessionMetadata,
): Promise<void> {
  const path = metadataPath(dataDir, sessionId);
  await fs.mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, serializeMetadata(data));
}
```
  2. Create async version of `atomicWriteFileSync`
  3. Update callers to handle async operations

---

### Refactor: Reduce Function Size in `lifecycle-manager.ts`
- **Location**: `src/lifecycle-manager.ts:535-684` (`maybeDispatchReviewBacklog`)
- **Problem**: 150-line function with complex conditional logic for managing review backlogs. High cognitive load to understand.
- **Impact**: Hard to test edge cases. Difficult to modify behavior without breaking existing functionality.
- **Suggested Approach**:
  1. Extract sub-functions:
     - `processPendingComments(session, comments): Promise<void>`
     - `processAutomatedComments(session, comments): Promise<void>`
  2. Create `ReviewBacklogState` interface to manage state:
```typescript
interface ReviewBacklogState {
  pendingFingerprint: string;
  automatedFingerprint: string;
  lastDispatchHash: string;
}
```
  3. Use guard clauses to reduce nesting
  4. Add unit tests for each sub-function independently

---

## Nice-to-Have Enhancements

### Enhancement: Add JSDoc Documentation to Complex Functions
- **Location**: `src/lifecycle-manager.ts`, `src/recovery/validator.ts`, `src/agent-selection.ts`
- **Description**: Add comprehensive JSDoc comments explaining:
  - Purpose and responsibility
  - Parameter descriptions with types
  - Return value semantics
  - Side effects (file I/O, network calls)
  - Error conditions and thrown exceptions
- **Benefit**: Improved IDE autocomplete, better onboarding for new contributors, self-documenting code
- **Suggested Approach**:
```typescript
/**
 * Determines the current status of a session by checking runtime, agent activity, and PR state.
 *
 * @param session - The session to check
 * @returns Promise resolving to the determined status
 * @throws Never - errors are caught and current status is preserved
 *
 * @example
 * const status = await determineStatus(session);
 * // status will be one of: working, pr_open, ci_failed, review_pending, etc.
 */
async function determineStatus(session: Session): Promise<SessionStatus>
```

---

### Enhancement: Extract Configuration Schema to Zod
- **Location**: `src/config-generator.ts`, `src/types.ts`
- **Description**: Replace manual config parsing with Zod schemas for:
  - Runtime validation on config load
  - Better error messages for misconfiguration
  - Type inference from schema
- **Benefit**: Automatic type safety, better error messages, runtime validation
- **Suggested Approach**:
```typescript
import { z } from 'zod';

const ProjectConfigSchema = z.object({
  name: z.string(),
  repo: z.string(),
  path: z.string(),
  defaultBranch: z.string().default('main'),
  // ...
});

type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
```

---

### Enhancement: Add Metrics Collection Points
- **Location**: Throughout codebase
- **Description**: Add instrumentation points for:
  - Operation latencies (metadata reads/writes, tmux operations)
  - Error rates by category
  - State transition frequencies
  - Plugin load times
- **Benefit**: Production visibility, performance optimization targets, anomaly detection
- **Suggested Approach**:
```typescript
// Create metrics.ts
export const metrics = {
  metadataReadLatency: new Histogram('metadata_read_ms'),
  metadataWriteLatency: new Histogram('metadata_write_ms'),
  stateTransitions: new Counter('state_transitions_total', ['from', 'to']),
};
```

---

### Enhancement: Introduce Result Type for Error Handling
- **Location**: Files with error-prone operations
- **Description**: Use `Result<T, E>` pattern for operations that can fail:
  - `metadata.ts` operations
  - `recovery/actions.ts` operations
  - Plugin loading operations
- **Benefit**: Explicit error handling without exceptions, composable error handling, better type safety
- **Suggested Approach**:
```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export async function readMetadata(
  dataDir: string,
  sessionId: SessionId,
): Promise<Result<SessionMetadata, MetadataError>> {
  try {
    // ...
    return { ok: true, value: metadata };
  } catch (error) {
    return { ok: false, error: new MetadataError(sessionId, error) };
  }
}
```

---

### Enhancement: Improve Test Coverage for Edge Cases
- **Location**: `src/__tests__/` directory
- **Description**: Add tests for:
  - `lifecycle-manager.ts:determineStatus` state machine transitions
  - `recovery/validator.ts:classifySession` edge cases (partial states)
  - `metadata.ts` concurrent write scenarios
  - Error paths in `observability.ts`
- **Benefit**: Regression prevention, documentation of expected behavior, confidence in refactoring
- **Suggested Approach**:
  1. Create test file for each major module
  2. Use property-based testing for state machines
  3. Mock filesystem for metadata tests
  4. Add integration tests for recovery flows