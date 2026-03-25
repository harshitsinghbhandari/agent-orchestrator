# L5 Execution Stub

## Concept
The simplest implementation of the Execution Environment layer. Uses the current tmux + Git worktree plugins instead of isolated Docker pods or Kubernetes jobs.

## Implementation Strategy
Already implemented via existing AO plugins:
- `Runtime`: `@composio/ao-plugin-runtime-tmux`
- `Workspace`: `@composio/ao-plugin-workspace-worktree`

## Limitations vs. Full L5 Spec
- No true container isolation (relies on filesystem isolation).
- Cannot scale horizontally across machines.
- No resource (CPU/Memory) usage tracking or quota enforcement.
