## 2025-04-12

### Files Updated
- `README.md` - Updated Plugin Architecture table to match actual plugins available in `packages/plugins/`.
- `SETUP.md` - Added precise pnpm version dependency, refreshed Plugin Slots table, removed deprecated Docker/Kubernetes examples, and added missing environment variables for Composio and OpenClaw.
- `TROUBLESHOOTING.md` - Fixed outdated resolution instructions for the "Config file not found" error, removing web symlinks and advising to use `AO_CONFIG_PATH`.

### Verification
- [x] Commands tested
- [x] Cross-referenced with code
- [x] No broken links

## 2024-06-28

### Files Updated
- `SETUP.md` - Changed `webhook:` to `webhookUrl:` for Slack configuration based on codebase verification, explicitly noted `LINEAR_API_KEY` is required for issue deletion cleanup, and added `OPENCLAW_HOOKS_TOKEN` to optional prerequisites.
- `TROUBLESHOOTING.md` - Added a section documenting the Codex agent not recognised issue, guiding users to verify the installation path based on recent commit 8e19f35.

### Verification
- [x] Commands tested
- [x] Cross-referenced with code
- [x] No broken links
