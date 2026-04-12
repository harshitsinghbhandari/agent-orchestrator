# Documentation Audit

Catalog scope:
- All `*.md` and `*.txt` files in the repository
- Textual documentation artifacts under `docs/` including `.html` and `.css`
- Config files with documentation-style headers/comments that act as docs (`.yaml`, `.toml`)
- Non-text image assets under `docs/assets/` and `docs/design/screenshots/` were not cataloged as documentation files

## Current

| File | Purpose | Last Updated |
|------|---------|--------------|
| `.gitleaks.toml` | Commented secret-scanning configuration that explains the repo's leak-prevention policy and allowlist behavior. | 2026-02-16 |
| `AGENTS.md` | Agent-facing quick reference for commands, architecture entry points, and key files. | 2026-04-09 |
| `CLAUDE.md` | Main project context document covering architecture, conventions, and plugin model. | 2026-04-11 |
| `CONTRIBUTING.md` | Contributor guide for bugs, PRs, plugin work, and repo conventions. | 2026-04-09 |
| `DESIGN.md` | Living design-system guidance for the dashboard's product context, visual direction, and UI principles. | 2026-04-11 |
| `README.md` | Top-level product overview, installation, usage, and feature guide. | 2026-04-10 |
| `SECURITY.md` | Security reporting policy and disclosure instructions. | 2026-02-18 |
| `SETUP.md` | Comprehensive install and setup guide for running AO. | 2026-04-11 |
| `TROUBLESHOOTING.md` | Troubleshooting reference for known runtime and environment issues. | 2026-02-18 |
| `VOICE_SETUP.md` | Setup and usage guide for the Voice Copilot feature. | 2026-04-09 |
| `changelog/hash-based-architecture-migration.md` | Migration guide for users moving to the hash-based project isolation architecture. | 2026-04-09 |
| `skills/agent-orchestrator/SKILL.md` | Skill definition and usage guide for operating on this codebase via the AO skill. | 2026-04-09 |
| `skills/agent-orchestrator/references/config.md` | Reference documentation for `agent-orchestrator.yaml` settings. | 2026-04-09 |
| `code-atlas/flows/implementing-an-agent-plugin.md` | Flow-oriented reference for building AO agent plugins. | 2026-04-12 |
| `code-atlas/flows/liveness-detection-architecture.md` | Current architecture explainer for AO's three liveness-detection systems. | 2026-04-12 |
| `code-atlas/flows/session-spawn-flow.md` | Current session spawn-flow explainer for debugging session creation behavior. | 2026-04-12 |
| `docs/CLI.md` | CLI command reference for operators and the orchestrator itself. | 2026-04-07 |
| `docs/DEVELOPMENT.md` | Development guide covering architecture, code conventions, and contributor patterns. | 2026-04-09 |
| `docs/PLUGIN_SPEC.md` | Runtime and packaging contract for AO plugins. | 2026-04-09 |
| `docs/VOICE_COPILOT_CHANGELOG.md` | Feature-level changelog tracking Voice Copilot iterations and fixes. | 2026-04-03 |
| `docs/observability.md` | Runtime observability reference for emitted signals, traces, and health surfaces. | 2026-03-12 |
| `docs/openclaw-plugin-setup.md` | Setup guide for connecting the OpenClaw plugin to AO. | 2026-03-26 |
| `examples/README.md` | Index and quick-start guide for example AO configuration files. | 2026-04-02 |
| `examples/auto-merge.yaml` | Commented example config for aggressive automation and auto-merge behavior. | 2026-02-18 |
| `examples/codex-integration.yaml` | Commented example config for using Codex as the agent backend. | 2026-02-18 |
| `examples/linear-team.yaml` | Commented example config for Linear-backed team workflows. | 2026-02-18 |
| `examples/multi-project.yaml` | Commented example config for running multiple projects with different settings. | 2026-02-18 |
| `examples/simple-github.yaml` | Commented minimal example config for a single GitHub project. | 2026-02-18 |
| `packages/ao/CHANGELOG.md` | Release history for the published `@composio/ao` package. | 2026-03-29 |
| `packages/cli/CHANGELOG.md` | Release history for the CLI package. | 2026-03-29 |
| `packages/cli/templates/rules/base.md` | Reusable base rule template injected into generated agent instructions. | 2026-02-16 |
| `packages/cli/templates/rules/go.md` | Go-specific coding rule template. | 2026-02-16 |
| `packages/cli/templates/rules/javascript.md` | JavaScript-specific coding rule template. | 2026-02-16 |
| `packages/cli/templates/rules/nextjs.md` | Next.js-specific coding rule template. | 2026-02-16 |
| `packages/cli/templates/rules/pnpm-workspaces.md` | pnpm workspace workflow rule template. | 2026-02-16 |
| `packages/cli/templates/rules/python.md` | Python-specific coding rule template. | 2026-02-16 |
| `packages/cli/templates/rules/react.md` | React-specific coding rule template. | 2026-02-16 |
| `packages/cli/templates/rules/typescript.md` | TypeScript-specific coding rule template. | 2026-02-16 |
| `packages/core/CHANGELOG.md` | Release history for the core package. | 2026-03-20 |
| `packages/core/README.md` | Package-level overview of AO core services, files, and responsibilities. | 2026-04-09 |
| `packages/plugins/agent-aider/CHANGELOG.md` | Release history for the Aider agent plugin. | 2026-03-20 |
| `packages/plugins/agent-claude-code/CHANGELOG.md` | Release history for the Claude Code agent plugin. | 2026-03-20 |
| `packages/plugins/agent-codex/CHANGELOG.md` | Release history for the Codex agent plugin. | 2026-03-20 |
| `packages/plugins/agent-opencode/CHANGELOG.md` | Release history for the OpenCode agent plugin. | 2026-03-20 |
| `packages/plugins/notifier-composio/CHANGELOG.md` | Release history for the Composio notifier plugin. | 2026-03-20 |
| `packages/plugins/notifier-desktop/CHANGELOG.md` | Release history for the desktop notifier plugin. | 2026-03-20 |
| `packages/plugins/notifier-discord/README.md` | Setup and configuration guide for the Discord notifier plugin. | 2026-03-23 |
| `packages/plugins/notifier-openclaw/CHANGELOG.md` | Release history for the OpenClaw notifier plugin. | 2026-03-20 |
| `packages/plugins/notifier-openclaw/README.md` | Setup guide for the OpenClaw notifier plugin. | 2026-03-26 |
| `packages/plugins/notifier-slack/CHANGELOG.md` | Release history for the Slack notifier plugin. | 2026-03-20 |
| `packages/plugins/notifier-webhook/CHANGELOG.md` | Release history for the webhook notifier plugin. | 2026-03-20 |
| `packages/plugins/runtime-process/CHANGELOG.md` | Release history for the process runtime plugin. | 2026-03-20 |
| `packages/plugins/runtime-tmux/CHANGELOG.md` | Release history for the tmux runtime plugin. | 2026-03-20 |
| `packages/plugins/runtime-tmux/README.md` | Package-level guide for the tmux runtime plugin's behavior and setup. | 2026-02-16 |
| `packages/plugins/scm-github/CHANGELOG.md` | Release history for the GitHub SCM plugin. | 2026-03-20 |
| `packages/plugins/scm-gitlab/CHANGELOG.md` | Release history for the GitLab SCM plugin. | 2026-03-20 |
| `packages/plugins/terminal-iterm2/CHANGELOG.md` | Release history for the iTerm2 terminal plugin. | 2026-03-20 |
| `packages/plugins/terminal-web/CHANGELOG.md` | Release history for the web terminal plugin. | 2026-03-20 |
| `packages/plugins/tracker-github/CHANGELOG.md` | Release history for the GitHub tracker plugin. | 2026-03-20 |
| `packages/plugins/tracker-gitlab/CHANGELOG.md` | Release history for the GitLab tracker plugin. | 2026-03-20 |
| `packages/plugins/tracker-linear/CHANGELOG.md` | Release history for the Linear tracker plugin. | 2026-03-20 |
| `packages/plugins/workspace-clone/CHANGELOG.md` | Release history for the clone workspace plugin. | 2026-03-20 |
| `packages/plugins/workspace-worktree/CHANGELOG.md` | Release history for the worktree workspace plugin. | 2026-03-20 |
| `packages/web/CHANGELOG.md` | Release history for the web dashboard package. | 2026-03-29 |

## Past

| File | Purpose | Why Classified As Past |
|------|---------|------------------------|
| `ARCHITECTURE.md` | Architecture plan for the hash-based system layout and core runtime decisions. | Historical architecture plan for an already-described migration path. |
| `artifacts/architecture-design.md` | Early architecture design artifact describing interaction model and notification-first philosophy. | Compiled design artifact from the initial buildout phase. |
| `artifacts/competitive-research.md` | Competitive research on other agent orchestration tools. | Research artifact feeding already-written product and architecture docs. |
| `artifacts/implementation-plan.md` | Work-breakdown and dependency plan for implementation phases. | Implementation planning artifact for work that has since been executed. |
| `docs/SECURITY-AUDIT-SUMMARY.md` | Security audit report summarizing a completed audit and historical findings. | Explicit audit summary of completed work. |
| `docs/design-cli-redesign-analysis.html` | HTML design/analysis document for the CLI redesign and onboarding simplification. | Contains explicit `Status: Implemented`. |
| `docs/design/README.md` | Index of dashboard design research artifacts. | Catalog for historical design research rather than living product docs. |
| `docs/design/competitive-analysis-raw.md` | Raw design research notes from competitor analysis. | Research source material behind later design briefs. |
| `docs/design/design-brief-v1.md` | Original dashboard design brief. | Superseded by the v2 `design-brief.md`. |
| `docs/design/design-brief.md` | Research-backed dashboard design specification. | Reads as a design artifact for an already-built dashboard experience. |
| `docs/design/graphql-batching-implementation.md` | Implementation write-up for GraphQL PR batching work. | Documents a named implementation for Issue #608. |
| `docs/design/orchestrator-terminal-design-brief.md` | Design brief for the orchestrator terminal page. | Design-spec artifact for an existing page shape. |
| `docs/design/session-detail-design-brief.md` | Design brief for the session detail page. | Design-spec artifact for an existing page shape. |

## Vision

| File | Purpose | Vision Signal |
|------|---------|---------------|
| `DESIGN-OPENCLAW-PLUGIN.md` | Revised design for deeper OpenClaw integration and phased rollout. | Forward-looking phased design (`Phase 0/1/3`, deferred hardening). |
| `docs/VOICE_COPILOT_PLAN.md` | Implementation plan for the Voice Copilot Gemini Live API integration. | Explicit implementation plan for future work. |
| `docs/design-npm-global-install-fixes.html` | HTML design proposal for fixing the global npm install and two-step setup experience. | Uses target-state language and shows `Status: Open`. |
| `docs/design-onboarding-improvements.html` | HTML analysis/proposal for reducing onboarding friction. | Improvement proposal centered on gaps and next changes. |
| `docs/design/feedback-pipeline-explainer.html` | Architecture explainer for the report -> issue -> agent-session -> PR feedback pipeline. | Tied to a not-yet-fully-realized pipeline formalization. |
| `docs/design/feedback-routing-and-followup-design.md` | Design document for the next-step feedback routing and follow-up pipeline. | Explicitly says it defines next-step architecture and is design-only. |
| `docs/design/session-replacement-handoff.md` | Design plan for successor sessions, PR takeover, and context handoff. | Explicitly marked `Not implemented`. |
| `docs/design/token-reference.css` | Proposed design token reference intended as a drop-in replacement for current theme tokens. | Recommendation artifact for a future visual refresh. |
| `docs/opencode-workflows-spec.md` | Intended behavior spec for selecting `agent: opencode`. | Opens with "defines intended behavior". |
| `docs/specs/project-based-dashboard-architecture.md` | Draft architecture spec for project-scoped dashboard behavior. | Explicit `Status: Draft`. |
| `docs/specs/runtime-terminal-port-and-project-id-hardening.html` | Draft hardening spec for runtime terminal port and project-ID handling. | Explicit `Status: Draft`. |

## Summary

- Total documentation files cataloged: 88
- Current: 64
- Past: 13
- Vision: 11
- Orphaned/Outdated: Not assessed in this inventory-only pass
