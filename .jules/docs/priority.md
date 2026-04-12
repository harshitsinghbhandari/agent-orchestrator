# Documentation Update Priority

Update frequency guidelines for maintaining documentation freshness.

## Daily

Files that change with code commits and should be reviewed daily during active development.

| File | Reason |
|------|--------|
| `CLAUDE.md` | Core project context - must reflect current architecture and conventions |
| `packages/ao/CHANGELOG.md` | Updated with each release |
| `packages/cli/CHANGELOG.md` | Updated with each release |
| `packages/core/CHANGELOG.md` | Updated with each release |
| `packages/web/CHANGELOG.md` | Updated with each release |

## Weekly

Files that should be reviewed weekly to ensure accuracy with recent changes.

| File | Reason |
|------|--------|
| `README.md` | Top-level product overview - should reflect new features |
| `SETUP.md` | Install/setup guide - dependencies and steps may change |
| `TROUBLESHOOTING.md` | New issues surface regularly |
| `code-atlas/flows/implementing-an-agent-plugin.md` | Plugin API evolves with core |
| `code-atlas/flows/liveness-detection-architecture.md` | Activity detection logic changes frequently |
| `code-atlas/flows/session-spawn-flow.md` | Session lifecycle may be updated |
| `docs/CLI.md` | CLI commands change with new features |
| `docs/DEVELOPMENT.md` | Dev patterns evolve |
| `packages/core/README.md` | Core services and responsibilities |

## Biweekly

Files that need periodic review every two weeks.

| File | Reason |
|------|--------|
| `AGENTS.md` | Agent-facing quick reference |
| `CONTRIBUTING.md` | Contributor guide - conventions may shift |
| `VOICE_SETUP.md` | Voice feature setup |
| `docs/PLUGIN_SPEC.md` | Plugin contract - changes with major updates |
| `docs/observability.md` | Observability signals evolve |
| `docs/VOICE_COPILOT_CHANGELOG.md` | Voice feature iterations |
| `changelog/hash-based-architecture-migration.md` | Migration guide - update if architecture changes |
| `skills/agent-orchestrator/SKILL.md` | Skill definition |
| `skills/agent-orchestrator/references/config.md` | Config reference |

## Monthly

Files that are stable and need monthly review.

| File | Reason |
|------|--------|
| `DESIGN.md` | Design system - stable unless major redesign |
| `SECURITY.md` | Security policy - infrequent changes |
| `.gitleaks.toml` | Secret scanning config - rarely changes |
| `docs/openclaw-plugin-setup.md` | Plugin setup guide |
| `examples/README.md` | Examples index |
| `packages/cli/templates/rules/*.md` | Rule templates - stable |
| `packages/plugins/*/README.md` | Plugin guides - stable between major versions |
| `packages/plugins/*/CHANGELOG.md` | Plugin release history |

## Vision Documents

These are forward-looking and should be reviewed when planning or implementing the features they describe.

| File | Review Trigger |
|------|----------------|
| `DESIGN-OPENCLAW-PLUGIN.md` | When working on OpenClaw integration |
| `docs/VOICE_COPILOT_PLAN.md` | When working on Voice Copilot |
| `docs/design-npm-global-install-fixes.html` | When addressing npm install issues |
| `docs/design-onboarding-improvements.html` | When improving onboarding |
| `docs/design/feedback-pipeline-explainer.html` | When building feedback pipeline |
| `docs/design/feedback-routing-and-followup-design.md` | When implementing feedback routing |
| `docs/design/session-replacement-handoff.md` | When implementing session handoff |
| `docs/design/token-reference.css` | When updating design tokens |
| `docs/opencode-workflows-spec.md` | When working on OpenCode agent |
| `docs/specs/project-based-dashboard-architecture.md` | When implementing project dashboard |
| `docs/specs/runtime-terminal-port-and-project-id-hardening.html` | When hardening runtime |
