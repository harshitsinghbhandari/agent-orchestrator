# L6 Quality Stub

## Concept
The simplest implementation of the 5-Tier Quality Pipeline. Instead of deploying 5 separate LLM agents, this stub executes standard shell linters and type checkers (Tier 1 & 2 only) inside the worktree.

## Implementation Strategy
A basic verification script runner:
```typescript
export async function runQualityPipeline(workspacePath: string) {
  try {
    // Tier 1: Syntax
    await exec('eslint .', { cwd: workspacePath });
    // Tier 2: Types
    await exec('tsc --noEmit', { cwd: workspacePath });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
```

## Limitations vs. Full L6 Spec
- Missing Tiers 3 (Architectural), 4 (Security), and 5 (Performance).
- No integration with the Self-Healing flow (just fails and relies on DAG executor retry loop).
