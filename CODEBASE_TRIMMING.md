# CODEBASE_TRIMMING

## Executive Summary

Agent Orchestrator is carrying substantially more surface area than its core use case requires. The core product is straightforward:

1. Spawn an agent against a GitHub issue
2. Put it in an isolated workspace
3. Track PR / CI / review state
4. Let a human inspect or intervene when needed

Everything beyond that should be judged by whether it improves those four loops. Right now, a large part of the codebase does not.

My estimate:

- **Remove immediately:** about **25-30% of plugin code** with low product risk
- **Simplify heavily:** another **15-20% of plugin code**
- **Remove or quarantine dead side systems:** about **1.2k lines** in recovery/feedback/duplicate utilities with no meaningful runtime integration
- **Overall repo reduction target:** **15-20% near-term**, **25%+ after consolidation**

The biggest problem is not just size. It is that AO has too many identity and execution paths:

- `sessionId` vs `tmuxName` vs `runtimeHandle.id`
- direct runtime liveness vs agent activity heuristics
- multiple workspace strategies
- multiple notifier channels
- multiple tracker / SCM combinations
- OpenCode-specific remap / reuse / restore logic

That complexity is directly aligned with the current reliability issues.

## Plugin-By-Plugin Analysis

### 1. Runtime

| Plugin | Recommendation | Why |
| --- | --- | --- |
| `runtime-tmux` | **Keep** | This is the real product path. README, setup, dashboard, and terminal tooling all assume tmux-first behavior. |
| `runtime-process` | **Simplify or demote to test-only** | Useful for tests, but it adds a second execution model with different lifecycle semantics, detached process-group handling, different stdin behavior, and separate failure modes. It is a reliability tax. |

Assessment:

- `runtime-tmux` is the real runtime.
- `runtime-process` is valuable as a harness, not as a first-class product path.
- The current core pays the price for both by handling bootstrap, liveness, send, restore, and kill across both runtimes.

Recommendation:

- Keep `tmux` as the only supported production runtime.
- Move `process` behind a test/dev flag or out of the bundled default install.

### 2. Agent

| Plugin | Recommendation | Why |
| --- | --- | --- |
| `agent-claude-code` | **Keep** | Default path, deeply integrated, large but clearly used. |
| `agent-codex` | **Keep, simplify** | Important second agent, but too much code is devoted to session file scanning and special handling. |
| `agent-opencode` | **Simplify hard or externalize** | OpenCode adds a disproportionate amount of remap/reuse/restore/session-discovery logic across core and web. |
| `agent-aider` | **Remove from bundled core** | Real but secondary. Better as a community/external plugin than a default dependency. |
| `agent-cursor` | **Remove from bundled core** | Lowest-signal agent in the repo. Present in code, but not part of the main product story or examples. |

Assessment:

- The codebase is effectively optimized for Claude Code and Codex.
- OpenCode is not “just another agent”; it forces custom session mapping, restore, and UI behavior.
- Aider and Cursor increase matrix size without clearly increasing product sharpness.

Recommendation:

- First-class bundled agents: `claude-code`, `codex`
- Optional / external: `opencode`, `aider`, `cursor`

### 3. Workspace

| Plugin | Recommendation | Why |
| --- | --- | --- |
| `workspace-worktree` | **Keep** | Matches the product story and is the default. |
| `workspace-clone` | **Remove** | Duplicative isolation model. Similar create/list/restore/destroy lifecycle, different failure surface, little evidence that it is worth the ongoing cost. |

Assessment:

- `workspace-worktree` and `workspace-clone` solve the same problem.
- Clone mode is slower, larger on disk, and duplicates branch/bootstrap/restore paths.
- The default product narrative is explicitly “one git worktree per agent.”

Recommendation:

- Standardize on worktrees.
- If clone mode is still wanted for edge environments, move it out of the core bundle.

### 4. Tracker

| Plugin | Recommendation | Why |
| --- | --- | --- |
| `tracker-github` | **Keep** | Default path, aligned with SCM and issue flow. |
| `tracker-linear` | **Keep only if AO remains a multi-tracker product** | It is the only non-GitHub tracker with real depth, but it is large and introduces direct API + Composio transport complexity. |
| `tracker-gitlab` | **Remove** | Theoretical more than practical. Also notably absent from bundled CLI dependencies despite being listed as built-in. |

Assessment:

- AO’s strongest path is GitHub issues -> GitHub PRs.
- Linear is plausible, but only if there is a real product commitment to it.
- GitLab tracker support is not convincing enough to justify a permanent maintenance burden.

Recommendation:

- Core support: GitHub
- Optional: Linear
- Remove: GitLab tracker

### 5. SCM

| Plugin | Recommendation | Why |
| --- | --- | --- |
| `scm-github` | **Keep** | Core to the product. |
| `scm-gitlab` | **Remove** | Large, parallel implementation with its own webhook handling, tests, and edge cases. Also listed as built-in but not bundled in CLI dependencies. |

Assessment:

- `scm-github` is essential.
- `scm-gitlab` duplicates a large integration surface for marginal value.
- The CLI dependency mismatch is a red flag: AO advertises GitLab SCM as built-in, but `packages/cli/package.json` does not ship it.

Recommendation:

- Make GitHub the only first-class SCM in core.
- Move GitLab support to an external package if it must exist.

### 6. Notifier

| Plugin | Recommendation | Why |
| --- | --- | --- |
| `notifier-desktop` | **Keep** | Best default. Local, simple, low ceremony. |
| `notifier-webhook` | **Keep** | Lowest-common-denominator integration point; can replace many bespoke channels. |
| `notifier-slack` | **Simplify into webhook or keep as one opinionated preset** | Useful, but overlaps heavily with generic webhook delivery. |
| `notifier-discord` | **Remove** | Another webhook-shaped notifier with custom formatting and retry logic. |
| `notifier-composio` | **Remove** | Adds SDK/runtime complexity for something a webhook already solves more simply. |
| `notifier-openclaw` | **Remove from core bundle** | AO has setup, doctor, credential resolution, installer metadata, and docs specifically for one niche notifier. This is disproportionate. |

Assessment:

- Six notifier paths is classic feature bloat.
- The product needs at most:
  - one local notifier
  - one generic remote notifier
  - maybe one popular opinionated preset

Recommendation:

- Keep `desktop`
- Keep `webhook`
- Optionally keep `slack`
- Remove `discord`, `composio`, `openclaw`

### 7. Terminal

| Plugin | Recommendation | Why |
| --- | --- | --- |
| `terminal-web` | **Keep** | The dashboard is a core product surface. |
| `terminal-iterm2` | **Remove from core bundle** | macOS-only, AppleScript-heavy, and not necessary if the web terminal exists. |

Assessment:

- The web terminal is enough for a modern orchestration product.
- iTerm2 support is convenience, not core.

Recommendation:

- Make web terminal the default and only built-in terminal path.
- Move iTerm2 integration to an optional add-on.

### 8. Lifecycle

| Component | Recommendation | Why |
| --- | --- | --- |
| Core lifecycle manager | **Keep, but shrink aggressively** | Essential, but too broad: state machine, PR batching, reaction engine, notification routing, review backlog dedupe, observability, and transition suppression all live in one place. |

Assessment:

- Lifecycle is not pluggable, but it behaves like a giant plugin host.
- It is where feature accretion has accumulated.
- It should be a smaller, stricter state machine with fewer inputs.

Recommendation:

- Keep lifecycle in core.
- Remove optional behavior before trying to “improve” it.

## Feature Removal Recommendations

### 1. Cut Notification Channels Down to 2-3

Current state:

- Built-in notifiers: `desktop`, `slack`, `discord`, `webhook`, `composio`, `openclaw`

Recommendation:

- Keep: `desktop`, `webhook`
- Optional: `slack`
- Remove: `discord`, `composio`, `openclaw`

Impact:

- Reduces plugin count, test count, docs, setup flows, doctor checks, and credential handling
- Removes OpenClaw-specific CLI scaffolding (`ao setup openclaw`, doctor integration, credential resolution)
- Shrinks one of the widest “nice to have” surfaces in the repo

### 2. Standardize on One Terminal Experience

Current state:

- `terminal-web`
- `terminal-iterm2`
- Web server also carries direct terminal WebSocket infrastructure and mux logic

Recommendation:

- Keep only the web terminal as a product feature
- Move iTerm2 integration out of the bundle

Impact:

- Removes AppleScript code and macOS-only behavior
- Makes docs and support less OS-dependent
- Keeps human inspection on the same surface as the dashboard

### 3. Collapse Workspace Strategy to Worktrees

Recommendation:

- Remove `workspace-clone`

Impact:

- Eliminates duplicate create/list/exists/restore/destroy logic
- Eliminates a second set of bootstrap and cleanup edge cases
- Aligns the codebase with the README promise: one git worktree per agent

### 4. Narrow Tracker + SCM to GitHub-First

Recommendation:

- First-class only: GitHub tracker + GitHub SCM
- Optional: Linear tracker if there is actual demand
- Remove GitLab tracker and SCM from the core bundle

Impact:

- Simplifies issue, PR, CI, review, and webhook assumptions
- Removes the “matrix product” problem where every state path has to work across multiple platforms
- Eliminates bundled-vs-advertised mismatch for GitLab plugins

### 5. Externalize Secondary Agents

Recommendation:

- Bundle only `claude-code` and `codex`
- Externalize `aider`, `cursor`, and likely `opencode`

Impact:

- Smaller bundled install
- Fewer launch/restore/activity-detection variants
- Lower probability that a core session-manager change breaks a niche agent

### 6. Remove Non-Core Side Systems

The following should be cut or moved behind experimental flags:

- `packages/core/src/recovery/*`
- `packages/core/src/feedback-tools.ts`
- `packages/web/src/lib/session-project.ts` (duplicate utility)
- Voice copilot stack in web (`packages/web/server/voice-server.ts`, `packages/web/src/lib/voice-functions.ts`, `packages/web/src/hooks/useVoiceCopilot.ts`, `packages/web/src/components/VoicePanel.tsx`) unless voice is a funded product priority

Impact:

- Removes dead or low-signal code
- Shrinks maintenance burden outside the main orchestrator loop
- Reduces the amount of web-only product experimentation embedded in the same repo as critical lifecycle code

## Code Consolidation Opportunities

### 1. Session Identity Must Collapse to One Authority

Today AO spreads identity across:

- session ID
- tmux session name
- runtime handle ID
- project prefix inference
- archived metadata
- OpenCode remapping

This is the root of too much complexity in:

- `packages/core/src/session-manager.ts`
- `packages/core/src/lifecycle-manager.ts`
- `packages/core/src/paths.ts`
- `packages/core/src/utils.ts`
- web API routes that call `resolveProjectIdForSessionId()`

Recommendation:

- Make metadata the only source of truth
- Every session operation should resolve by `(projectId, sessionId)` or by a persisted session index
- Stop inferring project ownership from prefixes in API routes
- Treat `tmuxName` as runtime-private, not a first-class cross-layer identity

### 2. Replace Special Prompt Delivery Modes with One Contract

Current complexity:

- agent launch commands sometimes inline prompts
- Claude uses `promptDelivery: "post-launch"`
- session-manager contains readiness polling and retry loops just to send the initial prompt
- metadata tracks `promptDelivered=pending|true|false`

Recommendation:

- Standardize on one startup contract:
  - either all agents receive prompt via stdin after startup
  - or all agents receive prompt via temp file / argument before startup

Do not support both.

Why:

- This will remove a fragile branch from `spawn`, `send`, and restore logic.
- It directly reduces the chance of issue #91 recurring.

### 3. Merge Webhook-Like Notifiers

`slack`, `discord`, `webhook`, and `openclaw` are mostly formatting and transport variations on the same concept.

Recommendation:

- Create one generic HTTP notifier with:
  - templates
  - headers
  - retries
  - optional provider presets

That is much smaller than maintaining four bespoke plugins plus setup flows.

### 4. Stop Shipping “Built-In” Plugins That Are Not Actually Bundled

`packages/core/src/plugin-registry.ts` lists GitLab tracker and SCM as built-in, but `packages/cli/package.json` does not depend on:

- `@aoagents/ao-plugin-tracker-gitlab`
- `@aoagents/ao-plugin-scm-gitlab`

That mismatch is a product smell.

Recommendation:

- If a plugin is “built-in”, ship it
- If it is not shipped, do not present it as built-in

### 5. Delete Dormant Recovery and Feedback Subsystems

Findings:

- `packages/core/src/recovery/*` appears unused outside its own tests
- `packages/core/src/feedback-tools.ts` is exported and documented, but not integrated into orchestrator runtime flows
- `packages/web/src/lib/session-project.ts` duplicates a utility that already exists in core

Recommendation:

- Delete recovery if there is no active operator workflow using it
- Delete feedback tools or move them to a separate internal package
- Delete duplicate utilities immediately

### 6. Break Up the Giant Files Only After Cutting Features

Largest implementation hotspots include:

- `packages/core/src/session-manager.ts` — 2795 lines
- `packages/core/src/lifecycle-manager.ts` — 1569 lines
- `packages/core/src/types.ts` — 1614 lines
- `packages/cli/src/commands/start.ts` — 1526 lines
- `packages/plugins/scm-github/src/index.ts` — 1063 lines
- `packages/plugins/scm-gitlab/src/index.ts` — 831 lines
- `packages/plugins/agent-claude-code/src/index.ts` — 889 lines
- `packages/plugins/tracker-linear/src/index.ts` — 723 lines

Recommendation:

- Do not start with file splitting.
- First remove feature branches and plugin variants.
- Then split remaining files along clean boundaries:
  - session identity / metadata
  - spawn / restore / send
  - lifecycle polling / reactions / notifications
  - GitHub issue tracking vs PR/CI/review enrichment

## Dead Code and Low-Signal Surface

### Likely Dead or Dormant

1. `packages/core/src/recovery/*`

- Large subsystem with types, scanner, validator, actions, logger, and manager
- No meaningful runtime usage found outside its own test coverage

2. `packages/core/src/feedback-tools.ts`

- Exported and documented, but not used by CLI, lifecycle, or web orchestration flows

3. `packages/web/src/lib/session-project.ts`

- Duplicates `resolveProjectIdForSessionId()` already available from core
- No non-test references found

### Low-Value Config Surface

The config schema is wider than the product needs. Candidates to remove or demote:

- `notificationRouting`
- `reactions` overrides at both global and per-project scope
- `orchestratorSessionStrategy`
- `opencodeIssueSessionStrategy`
- role-specific `orchestrator` / `worker` agent overrides
- multiple notifier aliases that resolve indirectly through plugin names

These are not all “dead”, but several of them exist to compensate for feature sprawl elsewhere.

### Packaging / Product Surface Smells

1. Built-in plugin declarations do not match bundled CLI dependencies
2. Plugin registry, CLI package list, docs, examples, and installer registry are not sharply aligned
3. The repo supports more combinations than it can realistically harden

## Reliability Improvements: What to Fix vs What to Remove

### Issue #91: spawn doesn't send prompt

Contributing complexity:

- mixed prompt delivery modes
- readiness polling before first prompt
- per-agent launch semantics
- post-launch retries and metadata bookkeeping

Recommendation:

- **Fix:** unify initial prompt delivery into one contract
- **Remove:** `promptDelivery` branching and `promptDelivered` bookkeeping if possible

If AO only supports one startup model, this class of bug becomes much smaller.

### Issue #80: false "exited" status

Contributing complexity:

- runtime liveness and agent activity are both allowed to declare death
- lifecycle converts `activity === "exited"` straight to `killed`
- list/get paths also mutate terminal state based on liveness heuristics
- startup and restore paths race against lifecycle polling

Recommendation:

- **Fix:** one source of truth for terminal death, with a startup grace period
- **Remove:** fallback heuristics that infer death from partial signals
- **Strongly consider removing:** `runtime-process` as a first-class runtime

### Issue #79: can't find session

Contributing complexity:

- project resolution by prefix
- multiple projects
- metadata lookup across active and archived directories
- session ID vs tmux name vs runtime handle translation
- OpenCode remap behavior

Recommendation:

- **Fix:** authoritative session index keyed by project + session ID
- **Remove:** prefix-based lookup in API routes
- **Remove or externalize:** OpenCode remap path if not core

### Issue #70: killed immediately after spawn

Contributing complexity:

- runtime bootstrap races
- lifecycle polling during spawn window
- prompt delivery readiness loops
- process-running checks before interactive startup settles

Recommendation:

- **Fix:** explicit bootstrap phase with a real readiness handshake
- **Remove:** eager death classification during spawn
- **Simplify:** trim runtimes and agents that need custom bootstrap logic

## Prioritized Action Plan

### Phase 1: Stop the Bleeding

1. Remove `workspace-clone`, `tracker-gitlab`, `scm-gitlab`, `notifier-discord`, `notifier-composio`, `notifier-openclaw`, and `terminal-iterm2` from the bundled product.
2. Externalize `agent-aider` and `agent-cursor`.
3. Delete `packages/core/src/recovery/*`, `packages/core/src/feedback-tools.ts`, and `packages/web/src/lib/session-project.ts` unless an active owner can point to production use.
4. Align docs, registry, and CLI dependencies so AO stops advertising unsupported built-ins.

### Phase 2: Reduce Reliability Risk

1. Collapse prompt startup to one model.
2. Collapse session identity to one authority.
3. Add a real spawn bootstrap state with grace-period semantics.
4. Make lifecycle death detection conservative and single-sourced.

### Phase 3: Narrow the Product

1. Make GitHub the default and only first-class tracker/SCM path.
2. Keep only `desktop` + `webhook` notifications, optionally `slack`.
3. Keep only `tmux` runtime, `worktree` workspace, `web` terminal, `claude-code` and `codex` agents as bundled paths.

### Phase 4: Refactor What Remains

After the cuts above:

1. Split `session-manager.ts` into identity, spawn/restore, and communication modules.
2. Split `lifecycle-manager.ts` into polling, state transitions, and reactions.
3. Split `types.ts` by concern instead of keeping every plugin and session type in one file.
4. Rebuild tests around the narrowed matrix instead of preserving today’s full combinatorial surface.

## Bottom Line

AO should choose whether it is:

- a hard, reliable GitHub-first orchestrator, or
- a generic plugin platform for every agent / tracker / terminal / notifier permutation

Right now it is trying to be both, and the codebase reflects that indecision.

The smallest reliable version of AO is:

- `tmux`
- `worktree`
- `claude-code` and `codex`
- `github` tracker + `github` SCM
- `desktop` + `webhook`
- `web` terminal

Everything else should justify itself against the reliability cost it creates. Most of it currently does not.
