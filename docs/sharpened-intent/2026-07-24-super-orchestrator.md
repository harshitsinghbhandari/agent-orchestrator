# Super Orchestrator

## Intent, stated cleanly

A user-level singleton agent that sits above all AO projects so that a human never has to understand AO's project model (project vs workspace, git preconditions, validation errors) to use the app. It runs as a plain session at `~/.ao/data/super-orchestrator/` (no git, no worktree), auto-opens on a user's first run, and is reachable afterward via an orchestrator button next to the projects "+" in the sidebar. It has three jobs, in priority order:

1. **Intake.** Given a disk path, it inspects the folder, decides single repo vs workspace, and fixes preconditions itself via CLI: git init, .gitignore corrections, creating the GitHub repo, adding the origin remote, pushing, setting the branch. Every external or public-facing mutation is gated on a conversational yes from the user first. Then it registers the project through the existing add API and starts that project's orchestrator.
2. **Cross-project questions.** "How many PRs did we get", "where should a project like this be added", and similar holistic reads across all projects and sessions.
3. **Onboarding.** On first run it detects Claude/Codex/OpenCode; if none is found it asks the user which agent should be their First Agent, then spawns as that agent and explains AO conversationally.

The headline win is maximizing the first-run experience; the durable win is that project management and AO-wide questions have one obvious place to go.

## What it is / what it isn't

In scope (v1):

- Intake with consent-gated precondition fixing, ending in a registered project with a running orchestrator.
- Cross-project and cross-session read questions.
- Explaining AO to users; first-run harness detection and First Agent selection.
- `ao send` to project orchestrators (never to workers).
- Removing projects.
- Docs freshness check: reads its knowledge from `~/.ao/docs/`, verifies the version against `aoagents.dev/docs-version.json`, and asks the user to update the app when stale.

Explicitly out of scope (v1):

- Redirect or message forwarding between sessions. When asked something session-specific, it names the right orchestrator and tells the user to open it. Nothing more.
- Sending to workers, killing any session, spawning workers, writing code.
- Richer worker spawn topology; that stays the job of each project's orchestrator.
- Any isolation backend beyond what AO already has.
- Relaxing backend intake validation; the agent fixes preconditions, the rules stay.

## Assumptions surfaced and confirmed

- **Agent over wizard because the product is a moving target.** Workspace projects did not exist until recently and more concepts are coming. A deterministic wizard must be rebuilt per change; the agent scales by reading developer-maintained docs and executing them.
- **The docs are a load-bearing product artifact.** If they drift from actual validation rules the SO confidently walks users into errors, which is worse than the current UX. Keeping `~/.ao/docs/` current, with the version manifest at `aoagents.dev/docs-version.json`, is part of the definition of done for any feature that changes intake or project semantics, enforced by a docs validation script.
- **Consent model: it can do anything, but it asks first.** All public-facing or externally visible actions (creating GitHub repos, pushing, mutating the user's real folders) require a conversational yes before execution.
- **"Managed paths only" governs isolation, not intake.** Worktrees and session state stay under `~/.ao`; the SO editing the user's canonical folders (git init, .gitignore) is allowed because it is consent-gated setup, not isolation.
- **One orchestrator per project stays the invariant.** The SO sits above project orchestrators; it never replaces them.
- **The session/API schema stays backward compatible.** The SO must not require a project-less session row in a way that breaks the existing schema; intake is additive on the existing add API.
- **Multi-repo stays AO's nested workspace shape.** No superrepo-style sibling worktrees.

## Alternatives considered and rejected

- **A smarter deterministic intake wizard.** Rejected as the primary bet: it solves today's errors but must be redesigned every time project semantics change, and it cannot fix preconditions that need judgment plus CLI work (create repo, add remote, push, retry).
- **A new above-project session kind.** Rejected: schema change, violates the backward-compatibility hard line. The SO is a plain session at a fixed path instead.
- **Session router as a core feature.** Demoted out of v1: cross-session redirect was the original bonus pitch, but v1 only names the right orchestrator.
- **Agent-invented isolation (superrepo style).** Rejected: the daemon keeps materializing, tracking, restoring, and cleaning everything under managed paths.

## Small calls deferred

- Whether one yes covers an agent-proposed batch of commands or each external mutation asks individually.
- Default visibility (private vs public) when the SO creates a GitHub repo on the user's behalf.
- Exact copy and UX of the First Agent picker when no harness is found on the machine.
- Exact internal modeling of the SO session (for example a hidden singleton scratch-style project) as long as the API surface stays backward compatible.
