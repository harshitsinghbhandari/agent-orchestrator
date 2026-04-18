# @composio/ao-plugin-agent-codex

## [Unreleased]

### Fixed

- Make Codex worker restore commands use `--ask-for-approval on-request` instead of resuming in `never` approval mode, while keeping permissionless orchestrator restores explicitly bypassed.

## 0.2.0

### Patch Changes

- 3a650b0: Zero-friction onboarding: `ao start` auto-detects project, generates config, and launches dashboard — no prompts, no manual setup. Renamed npm package to `@composio/ao`. Made `@composio/ao-web` publishable with production entry point. Cross-platform agent detection. Auto-port-finding. Permission auto-retry in shell scripts.
- Updated dependencies [3a650b0]
  - @composio/ao-core@0.2.0
