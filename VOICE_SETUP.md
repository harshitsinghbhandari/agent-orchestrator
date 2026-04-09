# Voice Copilot Setup Guide

This guide explains how to enable and use the Voice Copilot feature in Agent Orchestrator.

## Overview

Voice Copilot provides a hands-free voice interface powered by Google Gemini Live API. It allows you to:
- Ask questions about agent sessions and their status
- Send commands to agents via voice
- Receive proactive audio notifications about CI failures, PR reviews, and stuck sessions
- Control the dashboard hands-free with wake word detection ("Hey AO")

## Prerequisites

- Node.js 20+ and pnpm 9.15.4
- A Google Gemini API key ([get one here](https://aistudio.google.com/apikey))
- Microphone access in your browser

## Setup Steps

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment Variables

Add these environment variables to your shell profile (`.zshrc`, `.bashrc`, etc.):

```bash
# Required: Google Gemini API key for voice AI
export GEMINI_API_KEY="your-gemini-api-key-here"

# Required: Secret for signing voice authentication tokens (any random string)
export VOICE_TOKEN_SECRET="your-random-secret-string"

# Required (production only): Enable voice server
export AO_VOICE_ENABLED="true"
# OR
export NEXT_PUBLIC_AO_VOICE_ENABLED="true"
```

**Getting a Gemini API Key:**
1. Visit https://aistudio.google.com/apikey
2. Sign in with your Google account
3. Click "Create API key"
4. Copy the key and set it as `GEMINI_API_KEY`

**Generating a Secure Token Secret:**
```bash
# Generate a random secret
openssl rand -base64 32
```

Or use any string like `"my-secret-key-123"`. This is used to sign WebSocket authentication tokens.

### 3. Build the Project

**Important:** You must build the project to compile the voice server code:

```bash
pnpm build
```

### 4. Start the Server

**Option A: Development Mode** (recommended for testing)
```bash
pnpm dev
```
Voice is always enabled in dev mode (no `AO_VOICE_ENABLED` env var needed).

**Option B: Production Mode**
```bash
ao start
```
Requires `AO_VOICE_ENABLED` or `NEXT_PUBLIC_AO_VOICE_ENABLED` to be set.

### 5. Verify Voice Server is Running

Check that the voice server is listening on port 3002:

```bash
lsof -i :3002
```

You should see output like:
```
COMMAND   PID  USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME
node    12345  user   23u  IPv6  0x...      0t0  TCP *:3002 (LISTEN)
```

Or check the server logs for:
```
[voice] Voice copilot server listening on port 3002
```

## Using Voice Copilot

### Enabling Voice

1. Open the dashboard at http://localhost:3000
2. Click the **"Enable Voice"** button in the bottom-right corner
3. Allow microphone access when prompted
4. Wait for the connection status to show "Voice active" (green indicator)

### Push-to-Talk Mode

**Hold the microphone button** or **press and hold Space** anywhere on the dashboard to speak:
- Release to stop recording
- Gemini will process your speech and respond with audio

### Hands-Free Mode (Wake Word)

1. Click the toggle in the voice panel to enable "Hands-free mode"
2. Say **"Hey AO"** to activate listening
3. Speak your question or command
4. Gemini will respond automatically
5. Wake word listening resumes after the response

### Example Voice Commands

**Query sessions:**
- "List all sessions"
- "What's the status of ao-94?"
- "Show me stuck sessions"

**Check PR details:**
- "What failed in CI for ao-25?"
- "Show review comments for ao-94"
- "What changed in session ao-12?"

**Send commands to agents:**
- "Tell ao-94 to fix linting errors"
- "Ask ao-25 to add tests"
- "Tell the orchestrator to spawn an agent"

**Focus and follow:**
- "Focus on ao-94" (sets default target for commands)
- "Follow ao-25" (receive proactive updates about this session)

**Merge PRs (with confirmation):**
- "Merge ao-94"
- Gemini will ask for confirmation: "Are you sure...?"
- Respond: "Yes" or "No"

**Control notifications:**
- "Pause notifications" (stop proactive announcements)
- "Resume notifications" (re-enable announcements)

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | **Yes** | - | Google Gemini API key for voice AI |
| `VOICE_TOKEN_SECRET` | **Yes** | - | Secret for signing authentication tokens |
| `AO_VOICE_ENABLED` | Production only | `false` | Enables voice server in production |
| `NEXT_PUBLIC_AO_VOICE_ENABLED` | Production only | `false` | Alternative env var to enable voice |
| `VOICE_PORT` | No | `3002` | Port for voice WebSocket server |
| `AO_ALLOWED_ORIGIN` | No | - | Additional allowed origin for CORS (e.g., production domain) |

**Note:** In development mode (`pnpm dev`), voice is always enabled and `AO_VOICE_ENABLED` is not required.

## Troubleshooting

### "WebSocket connection failed. Ensure server is running on port 3002"

**Cause:** Voice server is not running.

**Solutions:**
1. Check that `AO_VOICE_ENABLED` or `NEXT_PUBLIC_AO_VOICE_ENABLED` is set to `"true"`
2. Verify environment variables are loaded (restart your terminal if needed)
3. Rebuild the project: `pnpm build`
4. Restart the server
5. Check if port 3002 is listening: `lsof -i :3002`

### "GEMINI_API_KEY not configured"

**Cause:** The Gemini API key environment variable is missing.

**Solution:** Set `GEMINI_API_KEY` in your shell profile and restart the server.

### "Voice authentication not configured (VOICE_TOKEN_SECRET required)"

**Cause:** The token secret environment variable is missing.

**Solution:** Set `VOICE_TOKEN_SECRET` to any random string and restart the server.

### Voice button appears but doesn't connect

**Cause:** Outdated compiled files (build artifacts don't match source code).

**Solution:**
```bash
# Clean and rebuild
pnpm clean
pnpm build
# Restart server
ao start  # or pnpm dev
```

### Microphone not working

**Cause:** Browser denied microphone permission.

**Solution:**
1. Check browser permissions (click the lock icon in the address bar)
2. Allow microphone access for localhost
3. Reload the page and try again

### "Origin not allowed" error

**Cause:** Connecting from a non-localhost domain without proper CORS setup.

**Solution:** Set `AO_ALLOWED_ORIGIN` environment variable:
```bash
export AO_ALLOWED_ORIGIN="https://your-domain.com"
```

## Architecture Notes

The voice feature consists of three components:

1. **Browser client** (`VoicePanel.tsx` + `useVoiceCopilot.ts`)
   - Push-to-talk and hands-free UI
   - WebSocket connection to voice server
   - Audio recording (16kHz PCM) and playback (24kHz PCM)

2. **Voice WebSocket server** (`packages/web/server/voice-server.ts`)
   - Standalone server on port 3002
   - Authenticates connections with ephemeral tokens
   - Proxies audio between browser and Gemini
   - Subscribes to dashboard SSE for proactive announcements

3. **Gemini Live API** (Google Cloud)
   - Speech-to-text and text-to-speech
   - Natural language understanding
   - Function calling for dashboard actions

## Cost Information

Voice Copilot uses the Gemini 3.1 Flash Live Preview model:
- **Input audio:** ~$0.06 per minute (16kHz microphone)
- **Output audio:** ~$0.09 per minute (24kHz Gemini speech)
- **Session limit:** 15 minutes per session (automatically reconnects)

Cost tracking is displayed in the voice panel (when implemented).

## Privacy & Security

- **API key stays server-side:** Never exposed to the browser
- **Ephemeral tokens:** Short-lived (5 min) HMAC-SHA256 signed tokens
- **Local-only by default:** WebSocket connections restricted to localhost
- **No persistent storage:** Voice sessions are ephemeral, no conversation history stored

## Additional Resources

- [Gemini Live API Documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/live-api)
- [Voice Copilot Changelog](docs/VOICE_COPILOT_CHANGELOG.md)
- [Voice Copilot Design Plan](docs/VOICE_COPILOT_PLAN.md)
- [Agent Orchestrator Documentation](README.md)

## Contributing

To work on voice features:

1. Follow setup steps above
2. Use dev mode: `pnpm dev`
3. Voice server auto-reloads with `tsx watch`
4. See `packages/web/server/voice-server.ts` for server code
5. See `packages/web/src/components/VoicePanel.tsx` for UI code

## Support

For issues or questions:
- Open an issue on GitHub
- Check [VOICE_COPILOT_CHANGELOG.md](docs/VOICE_COPILOT_CHANGELOG.md) for known issues
- Review server logs for `[voice]` prefixed messages
