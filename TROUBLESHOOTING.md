# Troubleshooting

## DirectTerminal: posix_spawnp failed error

**Symptom**: Terminal in browser shows "Connected" but blank. WebSocket logs show:

```
[DirectTerminal] Failed to spawn PTY: Error: posix_spawnp failed.
```

**Root Cause**: node-pty prebuilt binaries are incompatible with your system.

**Fix**: Rebuild node-pty from source:

```bash
# From the repository root
cd node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty
npx node-gyp rebuild
```

**Verification**:

```bash
# Test node-pty works
node -e "const pty = require('./node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty'); \
  const shell = pty.spawn('/bin/zsh', [], {name: 'xterm-256color', cols: 80, rows: 24, \
  cwd: process.env.HOME, env: process.env}); \
  shell.onData((d) => console.log('✅ OK')); \
  setTimeout(() => process.exit(0), 1000);"
```

**When this happens**:

- After `pnpm install` (uses cached prebuilts)
- After copying the repo to a new location
- On some macOS configurations with Homebrew Node

**Permanent fix**: The postinstall hook automatically rebuilds node-pty:

```bash
pnpm install  # Automatically rebuilds node-pty via postinstall hook
```

If you need to manually rebuild:

```bash
cd node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty
npx node-gyp rebuild
```

## Other Issues

### "WebSocket connection failed. Ensure server is running on port 3002"

**Cause**: Voice server is not running or missing required configuration.

**Solutions**:
1. Check that `AO_VOICE_ENABLED` or `NEXT_PUBLIC_AO_VOICE_ENABLED` is set to `"true"`
2. Check that `GEMINI_API_KEY` is correctly configured in your environment
3. Verify environment variables are loaded (restart your terminal if needed)
4. Rebuild the project: `pnpm build`
5. Restart the server

### Config file not found

**Symptom**: API returns 500 with "No agent-orchestrator.yaml found"

**Fix**: Ensure `agent-orchestrator.yaml` exists in the directory where you run `ao start`. The orchestrator will automatically discover it. If you need to specify a custom location, you can set the `AO_CONFIG_PATH` environment variable:

```bash
export AO_CONFIG_PATH=/path/to/agent-orchestrator.yaml
```
