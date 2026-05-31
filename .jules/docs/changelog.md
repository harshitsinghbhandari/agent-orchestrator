## 2025-04-12

### Files Updated
- `README.md` - Updated Plugin Architecture table to match actual plugins available in `packages/plugins/`.
- `SETUP.md` - Added precise pnpm version dependency, refreshed Plugin Slots table, removed deprecated Docker/Kubernetes examples, and added missing environment variables for Composio and OpenClaw.
- `TROUBLESHOOTING.md` - Fixed outdated resolution instructions for the "Config file not found" error, removing web symlinks and advising to use `AO_CONFIG_PATH`.

### Verification
- [x] Commands tested
- [x] Cross-referenced with code
- [x] No broken links

## 2026-05-31

### Files Updated
- `README.md` - Removed 'Docker' from the runtime alternatives in the Plugin Architecture table.
- `SETUP.md` - Replaced 'docker' with 'process' in the per-project overrides example, updated custom plugin examples to remove Docker/Kubernetes, and added `AO_VOICE_ENABLED` and `GEMINI_API_KEY` to the Optional environment variables.
- `TROUBLESHOOTING.md` - Added a section for resolving the Voice Copilot 'WebSocket connection failed' error by setting the `AO_VOICE_ENABLED` and `GEMINI_API_KEY` environment variables.

### Verification
- [x] Commands tested
- [x] Cross-referenced with code
- [x] No broken links
