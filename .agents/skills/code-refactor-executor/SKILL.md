---
name: code-refactor-executor
description: Executes a multi-stage refactoring plan based on existing `audit.md` and `improvements.md` files. Reads the recommendations, scans the target source code, and builds an implementation roadmap before applying atomic code transformations.
---

## Overview

This skill is the "execution hand" for the `code-quality-audit` skill. It transforms strategic advice into concrete code changes by:
1. **Contextual Analysis**: Synthesizing the "Why" (from `audit.md`) and "How" (from `improvements.md`) with the current source code state.
2. **Implementation Planning**: Creating a detailed `refactor-plan.md` that outlines each atomic step.
3. **Safe Execution**: Applying changes only after user review and verifying each step with tests or build checks.

## Activation Rules

**Triggers ONLY when the user asks to:**
- "Implement the refactorings"
- "Execute the improvements roadmap"
- "Plan and apply refactors from the audit"
- "Fix the issues listed in improvements.md"

**Prerequisites:**
- `audit.md` and `improvements.md` must already exist in the workspace.
- Access to the source code files mentioned in the roadmap.

## Workflow

### Phase 1: Context Triangulation
- **Read Analysis**: Load `audit.md` and `improvements.md`.
- **Scan codebase**: Read the files and line numbers referenced in those documents. 
- **Verify Consistency**: Ensure the code logic matches the audit's observations. If the code has been significantly modified since the audit, inform the user and suggest a re-audit.

### Phase 2: Implementation Roadmap (`refactor-plan.md`)
Create a `refactor-plan.md` (if it doesn't already exist or if requested) with the following structure:

```markdown
# Implementation Plan: [Refactor Name/Batch]

## Summary
Brief description of the goals (e.g., "Untangling Auth Logic").

## Stages
### Stage 1: [Name]
- **Target Files**: [List paths]
- **Action**: [Brief description of the change]
- **Verification**: [Command to run, e.g., `npm test`]

### Stage 2: [Name]
...
```

**Present this plan to the user and wait for approval for individual stages or the whole batch.**

### Phase 3: Execution & Verification
For each approved stage:
1. **Apply Changes**: Use `replace_file_content` or `multi_replace_file_content` for atomic updates.
2. **Verify Integrity**: 
   - Run a syntax check or build (e.g., `tsc`, `go build`).
   - Run relevant tests (e.g., `pytest`, `jest`).
3. **Capture Regressions**: If a change breaks the build/test, revert immediately or fix it if the solution is obvious.
4. **Report Progress**: Inform the user which stages are complete.

## Standards for Implementation

- **Atomic Commits/Changes**: Don't refactor everything in one giant tool call. Group related changes into logical stages.
- **Maintain Consistency**: If you rename a symbol, search for and update all call sites across the project.
- **No Over-Engineering**: Stick to the "Suggested Approach" unless it's clearly incorrect for the current code.
- **Transparency**: Always explain *what* you are about to change before doing it.

## Quality Assurance

- Do not attempt to refactor without reading the source code first.
- If a suggested refactor in `improvements.md` is too vague, ask the user for clarification before planning.
- If no tests are available, manually verify the change by reading the resulting file.
