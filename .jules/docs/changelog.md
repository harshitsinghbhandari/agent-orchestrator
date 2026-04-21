## 2025-04-12

### Files Updated
- `README.md` - Updated Plugin Architecture table to match actual plugins available in `packages/plugins/`.
- `SETUP.md` - Added precise pnpm version dependency, refreshed Plugin Slots table, removed deprecated Docker/Kubernetes examples, and added missing environment variables for Composio and OpenClaw.
- `TROUBLESHOOTING.md` - Fixed outdated resolution instructions for the "Config file not found" error, removing web symlinks and advising to use `AO_CONFIG_PATH`.

### Verification
- [x] Commands tested
- [x] Cross-referenced with code
- [x] No broken links

## 2026-04-19

### Files Updated
- `README.md` - Changed "Seven plugin slots" to "Eight plugin slots + core services" and added the non-pluggable "Lifecycle" slot to the Plugin Architecture table to correctly reflect the codebase structure.
- `SETUP.md` - Corrected the Slack configuration example parameter from `webhook` to `webhookUrl` to match the actual implementation in `packages/plugins/notifier-slack/src/index.ts`.

### Verification
- [x] Commands tested
- [x] Cross-referenced with code
- [x] No broken links
