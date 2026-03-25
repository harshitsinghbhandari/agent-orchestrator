# L1 Perception Stub

## Concept
The simplest possible implementation that satisfies the L1 Perception interface. Instead of running a persistent daemon tracking continuous event streams (AST changes, LSP definitions), this stub computes a static "snapshot" of the repository state on demand.

## Implementation Strategy
A single function that gathers critical metadata:
```typescript
export async function computePerceptionSnapshot(workspacePath: string) {
  // 1. High-level structure
  const fileList = await exec('find . -type f -name "*.{ts,js,py,go,rs,md}"');

  // 2. Recent activity
  const gitDiff = await exec('git diff --stat HEAD~1');
  const recentCommits = await exec('git log -n 5 --oneline');

  return { fileList, gitDiff, recentCommits };
}
```

## Limitations vs. Full L1 Spec
- Not continuous (no `PERCEPTION_UPDATE` events emitted to Event Bus).
- No AST or LSP symbol extraction.
- Does not support "Mode C: Intent Inference".
