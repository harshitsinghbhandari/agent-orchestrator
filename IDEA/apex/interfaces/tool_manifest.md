# Tool Manifest Specification

## Status
⚠️ **PARTIALLY SPECIFIED**
- SPEC sections: Tool Categorization, Functional List (v1.0), Permission Classification.
- UNDERSPECIFIED sections: **Typed Input/Output Schemas** per tool, Side-effect analysis per tool, Failure return codes.

## Purpose
Defines the technical surface area available to Agent Instances. No agent can invoke a tool not listed in this manifest. Each tool carries an explicit permission level used for trust-gating in L5.

---

## Tool Categories & Functional Surface (v1.0)

### 1. Filesystem Tools (Perm: WRITE_STORAGE)
- `read_file`: Read contents of a specific file.
- `write_file`: Overwrite file contents (atomic).
- `edit_file`: Patch file via string-replace or line-diff (preferred).
- `list_directory`: Recursively list files.
- `delete_file`: **(Perm: DESTRUCTIVE)** Remove file. Requires manual permission flag.
- `watch_directory`: Stream FS events for a path (used by L1).

### 2. Analysis & LSP Tools (Perm: READ_CODEBASE)
- `search_codebase`: Semantic or project-wide grep search.
- `get_definition`: LSP: find definition of a symbol.
- `get_references`: LSP: find all uses of a symbol.
- `get_type_info`: LSP: resolve type of an expression.
- `dependency_graph`: L1: generate module-level graph delta.

### 3. Execution & Build Tools (Perm: EXEC_ENV)
- `bash`: Run shell commands with timeout + output capture.
- `run_tests`: Language-specific test runner (e.g., `jest`, `pytest`).
- `run_linter`: Language-specific linter (e.g., `eslint`).
- `security_scan`: Tier 4 scanning primitive (e.g., `semgrep`).
- `coverage_report`: Post-test coverage analysis.
- `profile_performance`: Tier 5 profiler (Phase 2+).

### 4. Git & Integration Tools (Perm: GIT_ADMIN)
- `git_status`: Current worktree status.
- `git_diff`: Uncommitted changes.
- `git_commit`: Create atomic commit with message.
- `git_push`: Push worktree state to remote.
- `git_branch`: Branch management.
- `git_worktree_add`: **(Perm: SYSTEM)** Create isolated agent workspace.
- `create_pr`: GitHub/Lab PR generation with description.

### 5. Memory & Intelligence Tools (Perm: BRAIN_READ/WRITE)
- `brain_read`: Query KI by namespace and task context.
- `brain_write`: Store new Decision/Failure/Pattern.
- `brain_query_semantic`: Vector-search across Brain knowledge.

### 6. Browser & Visual Tools (Perm: BROWSER_VISUAL - Phase 3)
- `browser_navigate`: Open URL in headless browser.
- `browser_screenshot`: Capture visual state artifact.
- `accessibility_audit`: Lighthouse-style visual audit.

---

## Tool Permission Model
Every tool is classified by its potential for system disruption:
- **READ_ONLY**: No side effects. Available to all agents.
- **WRITE_ONLY**: Modifies worktree. Requires Trust Score > 0.3.
- **DESTRUCTIVE**: Deletes data. Requires Trust Score > 0.6 + Human Gate (G1).
- **SYSTEM**: Modifies APEX state/infrastructure. Orchestrator only.

## Open Questions
- How are "composed tools" (meta-tools) represented in this manifest?
- What is the timeout behavior for long-running tools like `run_tests` (default 5m)?
- How are tool versioning/updates handled in ephemeral L5 pods?
