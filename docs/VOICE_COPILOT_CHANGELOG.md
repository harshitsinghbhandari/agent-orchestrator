# Voice Copilot Changelog

## Overview

The Voice Copilot is a new feature that adds **spoken situational awareness** to Agent Orchestrator using the Gemini Live API. It announces important events (CI failures, review requests, stuck sessions) and answers questions about session status via voice.

---

## V4.1 — Refactoring + Security Hardening

### Refactoring (Issue #19)

**Code Deduplication:**
- Moved function handlers from voice-server.ts to voice-functions.ts (~450 lines removed)
- Consolidated ConversationContext, FunctionResult types in voice-functions.ts
- Imported dedupe logic from voice-dedupe.ts
- Imported token validation from voice-token.ts
- Server now imports from library modules instead of duplicating code

**Security Improvements:**
- Removed `GEMINI_API_KEY` fallback from `VOICE_TOKEN_SECRET` (was insecure)
- Token validation now requires `VOICE_TOKEN_SECRET` to be configured
- Added origin checking for WebSocket connections (localhost only + `AO_ALLOWED_ORIGIN`)
- Added WebSocket heartbeat (30s ping/pong) for stale connection detection
- Added authentication to `/api/voice/token` endpoint via `AO_DASHBOARD_TOKEN`

**Merge Safety:**
- Created pending-merges.ts module for safe voice-initiated merges
- Merge requests now create pending entries (5 minute expiry)
- Dashboard must confirm merges instead of immediate voice-triggered execution
- Better validation: checks CI passing, review approved, mergeable before allowing

**Audio Improvements:**
- Migrated from ScriptProcessorNode to AudioWorkletNode (with legacy fallback)
- Added audio-worklet-processor.js for off-main-thread PCM conversion
- Fixed sample rate handling (16kHz input, 24kHz output)
- Added rate limiting for send_message (10/minute per session)

**Code Quality:**
- Fixed findSessionById to use strict numeric suffix matching ("94" matches "ao-94" not "ao-194")
- Improved cost tracking with direction-aware sample rate defaults
- Removed dead code after executeFunctionCall switch

### Files Modified

| File | Changes |
|------|---------|
| `packages/web/src/lib/voice-functions.ts` | Extended FunctionResult, added V4 handlers, exported findSessionById/resolveSession |
| `packages/web/src/lib/voice-token.ts` | Removed GEMINI_API_KEY fallback |
| `packages/web/src/lib/pending-merges.ts` | NEW: Pending merge store |
| `packages/web/server/voice-server.ts` | Imports from libraries, WebSocket security, rate limiting |
| `packages/web/src/app/api/voice/token/route.ts` | Added authentication |
| `packages/web/src/hooks/useVoiceCopilot.ts` | AudioWorklet migration |
| `packages/web/public/audio-worklet-processor.js` | NEW: AudioWorklet processor |
| `docs/VOICE_COPILOT_CHANGELOG.md` | This changelog |

---

## V4 — Action Commands + Hardening

### New Features

**Action Commands:**

| Function | Description | Example Commands |
|----------|-------------|------------------|
| `merge_pr` | Merge a PR with confirmation flow | "Merge ao-25" "Merge PR 15" |
| `pause_notifications` | Pause automatic announcements | "Pause notifications" "Mute" "Be quiet" |
| `resume_notifications` | Resume automatic announcements | "Resume notifications" "Unmute" |

**Merge PR Confirmation Flow:**
- When user says "merge ao-25", the voice assistant asks for confirmation
- "Are you sure you want to merge PR 15 for session ao-25? Say yes to confirm or no to cancel."
- Only merges if PR is approved + CI green
- User must explicitly confirm with "yes" or "confirm"

**Notification Control:**
- Users can pause automatic event announcements while still being able to ask questions
- Visual indicator in VoicePanel shows when notifications are muted
- State persists until explicitly resumed or session disconnects

**VAD-Based Interruption Handling:**
- Detects when user starts speaking during playback
- Immediately clears audio queue and stops playback
- Allows natural conversation flow without waiting for responses to finish

**Session Resumption for Connection Drops:**
- Auto-reconnection with exponential backoff (up to 3 attempts)
- Preserves focus/follow/notification state across reconnections
- Graceful fallback to manual reconnect after max attempts

**Ephemeral Token Support:**
- New endpoint: `GET /api/voice/token` generates short-lived access tokens
- Tokens valid for 5 minutes, HMAC-SHA256 signed
- Optional: set `VOICE_TOKEN_SECRET` to enable token validation
- Keeps Gemini API key server-side only

**Context Window Compression:**
- Proactive reconnection before 15-minute Gemini session limit
- Reconnects at 14 minutes to avoid mid-conversation disconnects
- Context (focus, follow, notifications) preserved across reconnections

**Cost Tracking:**
- Tracks audio minutes sent and received
- Sends periodic cost updates to browser
- Session duration tracking

### Files Modified

| File | Changes |
|------|---------|
| `packages/web/server/voice-server.ts` | V4 function declarations, merge/pause/resume handlers, token validation, session resumption, cost tracking, session limit checks |
| `packages/web/src/hooks/useVoiceCopilot.ts` | Added `clearAudioQueue` for VAD interruption, updated context interface |
| `packages/web/src/components/VoicePanel.tsx` | Muted indicator, merge action display |
| `packages/web/src/app/api/voice/token/route.ts` | New ephemeral token endpoint |
| `docs/VOICE_COPILOT_CHANGELOG.md` | V4 documentation |

### Technical Details

**Merge Confirmation:**
- `merge_pr` function checks CI status, review status, and mergeability
- Returns error with blockers if PR is not ready
- Only calls `/api/prs/[id]/merge` after explicit confirmation

**Token Format:**
```
base64(timestamp:nonce:hmac)
```
- timestamp: Unix epoch when created
- nonce: 16 random bytes (hex)
- hmac: HMAC-SHA256 of `timestamp:nonce` using secret

**Session Limit Management:**
- `GEMINI_SESSION_LIMIT_MS = 15 * 60 * 1000` (15 minutes)
- `PROACTIVE_RECONNECT_THRESHOLD_MS = 14 * 60 * 1000` (14 minutes)
- Check interval: every minute

---

## V3 — Voice Input + Basic Commands

### New Features

**Voice Input (Push-to-Talk):**
- Microphone capture using ScriptProcessorNode (16kHz PCM)
- Push-to-talk UI button and spacebar shortcut
- Streams audio to Gemini Live API in real-time

**New Functions:**

| Function | Description | Example Commands |
|----------|-------------|------------------|
| `send_message_to_session` | Send a message to an agent | "Tell ao-25 to fix linting" |
| `focus_session` | Set the focused session | "Focus on ao-25" |
| `follow_session` | Start following a session | "Follow ao-94" |

**Focus/Follow Mode:**
- Focused session becomes default target for commands
- Following a session triggers proactive updates for that session
- Context displayed in VoicePanel header

### Files Modified

| File | Changes |
|------|---------|
| `packages/web/server/voice-server.ts` | V3 function declarations, send/focus/follow handlers, audio input handling |
| `packages/web/src/hooks/useVoiceCopilot.ts` | Microphone capture, recording state, audio streaming |
| `packages/web/src/components/VoicePanel.tsx` | Push-to-talk button, spacebar shortcut, context display |

---

## V2 — Full Query Support + Context Retention

### New Features

**3 New Query Functions:**

| Function | Description | Example Queries |
|----------|-------------|-----------------|
| `get_ci_failures` | Get failed CI checks for a session's PR | "What failed in ao-25?" "Show CI failures" |
| `get_review_comments` | Get unresolved review comments | "What are the review comments?" "Show feedback" |
| `get_session_changes` | Get PR changes (additions, deletions, summary) | "What changed?" "Show the diff summary" |

**Conversation Context Retention:**

- Voice copilot now remembers the last-discussed session
- Follow-up queries like "what failed?" work without repeating the session ID
- Context is stored in-memory and resets when the browser disconnects

### Example Conversation Flow

```
User: "What's happening with ao-25?"
Voice: "Session ao-25 is working on... PR #123..."

User: "What failed?"
Voice: [Uses ao-25 from context] "Found 2 failing CI checks for ao-25..."

User: "What are the review comments?"
Voice: [Uses ao-25 from context] "Found 3 unresolved comments..."

User: "What changed in that session?"
Voice: [Uses ao-25 from context] "Changes in ao-25: +150 additions, -30 deletions..."
```

### Files Modified

| File | Changes |
|------|---------|
| `packages/web/server/voice-server.ts` | Added 3 new function declarations, context tracking, V2 function handlers |
| `packages/web/src/lib/voice-functions.ts` | Added V2 function declarations and handlers with context support |
| `docs/VOICE_COPILOT_CHANGELOG.md` | Documented V2 changes |

### Technical Details

**Context Tracking:**
- `ConversationContext` interface stores `lastSessionId` and `lastUpdatedAt`
- Context is updated after any function that resolves a specific session
- `list_sessions` does NOT update context (lists many sessions)
- Context resets when browser WebSocket disconnects

**Session Resolution:**
- Explicit session ID in query takes priority
- Falls back to context if no session ID provided
- Partial matching supported (e.g., "25" matches "ao-25")
- Clear error messages when context is empty

---

## V1 (MVP) — Spoken Situational Awareness

This is the **MVP implementation** that focuses on:
- Event-driven voice announcements
- Two query functions (`list_sessions`, `get_session_summary`)
- Browser-based audio playback
- Simple toggle UI

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│  ┌──────────────┐    ┌───────────────┐    ┌────────────────────┐   │
│  │  Dashboard   │    │  VoicePanel   │    │  Audio Playback    │   │
│  │  (existing)  │    │  (toggle UI)  │◄──►│  (Web Audio API)   │   │
│  └──────────────┘    └───────┬───────┘    └────────────────────┘   │
│                              │ WebSocket (ws://localhost:3002)      │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────┐
│  Voice Server (Node.js)      │ Port 3002                            │
│  ┌───────────────────────────▼─────────────────────────────────┐    │
│  │  WebSocket Server                                            │    │
│  │  • Accepts browser connection                                │    │
│  │  • Subscribes to AO SSE events (/api/events)                 │    │
│  │  • Dedupe + debounce layer (30s window)                      │    │
│  │  • Maintains Gemini Live API session                         │    │
│  │  • Relays audio to browser                                   │    │
│  └───────────────────────────┬─────────────────────────────────┘    │
│                              │ WebSocket                            │
│  ┌───────────────────────────▼─────────────────────────────────┐    │
│  │  Gemini Live API Client                                      │    │
│  │  • @google/genai SDK                                         │    │
│  │  • Function calling (list_sessions, get_session_summary)     │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                     ┌─────────────────────┐
                     │  Gemini Live API    │
                     │  gemini-3.1-flash-  │
                     │  live-preview       │
                     └─────────────────────┘
```

## Files Created

### Server-Side

| File | Purpose |
|------|---------|
| `packages/web/server/voice-server.ts` | Standalone WebSocket server that bridges browser, SSE events, and Gemini Live API |

### Library Files

| File | Purpose |
|------|---------|
| `packages/web/src/lib/voice-dedupe.ts` | Dedupe + debounce layer (30s window per session+eventType) |
| `packages/web/src/lib/voice-serialize.ts` | Event → VoiceEvent transformation and state change detection |
| `packages/web/src/lib/voice-functions.ts` | MVP function implementations (list_sessions, get_session_summary) |
| `packages/web/src/lib/gemini-client.ts` | Gemini Live API wrapper (not used by voice-server directly, utility for future) |

### React Components

| File | Purpose |
|------|---------|
| `packages/web/src/components/VoicePanel.tsx` | Toggle button, status indicator, query input |
| `packages/web/src/components/VoicePanelWrapper.tsx` | Conditional rendering based on env var |

### Hooks

| File | Purpose |
|------|---------|
| `packages/web/src/hooks/useVoiceCopilot.ts` | WebSocket connection + Web Audio API playback |

## Files Modified

| File | Change |
|------|--------|
| `packages/web/package.json` | Added `@google/genai` dependency, `dev:voice` script |
| `packages/web/src/app/layout.tsx` | Import and render `VoicePanelWrapper` |
| `packages/web/server/start-all.ts` | Conditionally spawn voice server in production |

## How to Enable

### Environment Variables

```bash
# Required: Gemini API key
export GEMINI_API_KEY="your-gemini-api-key"

# Required: Enable voice feature
export NEXT_PUBLIC_AO_VOICE_ENABLED="true"

# Optional: Voice server port (default: 3002)
export VOICE_PORT="3002"
```

### Development

```bash
# Start all servers including voice
cd packages/web
pnpm dev

# Or start voice server standalone
pnpm dev:voice
```

### Production

Voice server starts automatically with `start:all` when `AO_VOICE_ENABLED=true` or `NEXT_PUBLIC_AO_VOICE_ENABLED=true`.

## Usage

1. Set environment variables (see above)
2. Start the dashboard (`pnpm dev`)
3. Click the "Enable Voice" button in the bottom-right corner
4. Voice will announce important events automatically
5. Type questions in the input field to query session status

### Auto-Spoken Events

These events trigger automatic voice announcements:

| Event | Condition |
|-------|-----------|
| `ci.failing` | PR CI status transitions to failing |
| `review.changes_requested` | Review decision changes to "changes requested" |
| `session.stuck` | Session status becomes "stuck" |
| `session.needs_input` | Session needs human input (waiting_input/blocked) |
| `merge.ready` | PR becomes mergeable (approved + CI green) |

### Query Functions

| Function | Example Query |
|----------|---------------|
| `list_sessions` | "What sessions are running?" "Show me stuck sessions" |
| `get_session_summary` | "What's ao-94 doing?" "Summarize session 42" |
| `get_ci_failures` | "What failed in ao-25?" "Show CI failures" (V2) |
| `get_review_comments` | "What are the review comments?" "Show feedback" (V2) |
| `get_session_changes` | "What changed?" "Show the diff" (V2) |

**Note (V2):** After discussing a session, you can omit the session ID in follow-up queries. The voice copilot will remember the last-discussed session.

## Technical Details

### Audio Format

- **Output from Gemini:** PCM, 16-bit, mono, 24kHz
- **Browser playback:** Gapless streaming using `audioContext.currentTime` scheduling.
- **Scheduling:** Precise back-to-back buffer playback with a 100ms initial jitter buffer to prevent stuttering.

### Dedupe Logic

- Events are keyed by `sessionId:eventType`
- Same key won't trigger announcement within 30-second window
- Cache is cleaned periodically to prevent memory leaks

### Session State Tracking

The voice server maintains previous session states to detect transitions:
- CI status changes (non-failing → failing)
- Review decision changes (any → changes_requested)
- Session status changes (any → stuck/needs_input)
- Mergeability changes (not-mergeable → mergeable)

### Connection Management

- **Gemini Live API:** Now using `gemini-3.1-flash-live-preview` (lower latency, improved tool use).
- **Session Isolation:** Only one browser client allowed. Server explicitly disconnects existing Gemini sessions and stops SSE subscriptions when a new client connects to prevent overlapping voices.
- **Automatic Resume:** Hook automatically resumes `AudioContext` if suspended by browser autoplay policies.
- **Graceful Cleanup:** WebSocket cleanup logic handles `CONNECTING` states to avoid browser console errors.

## Known Limitations

1. ~~**No microphone input (MVP)** — Text queries only, voice input planned for V3~~ ✅ **Fixed in V3** — Push-to-talk voice input now available
2. **Single client** — Only one browser can connect to voice at a time
3. ~~**No action execution** — Cannot merge PRs or send messages via voice (planned for V4)~~ ✅ **Fixed in V4** — Can merge PRs and send messages via voice
4. **Local network only** — Voice server runs on localhost
5. ~~**No conversation memory** — Each query is independent~~ ✅ **Fixed in V2** — Context retention now remembers last-discussed session

## Future Phases

### ~~V2 — Full Query Support~~ ✅ COMPLETE
- ~~`get_ci_failures` — Fetch failed check names + truncated logs~~ ✅
- ~~`get_review_comments` — Fetch pending review threads~~ ✅
- ~~`get_session_changes` — PR diff summary~~ ✅
- ~~Conversation context retention~~ ✅

### ~~V3 — Voice Input + Basic Commands~~ ✅ COMPLETE
- ~~Microphone capture (browser MediaRecorder)~~ ✅
- ~~`send_message_to_session` — Voice-to-agent messaging~~ ✅
- ~~Session focus / follow mode~~ ✅
- ~~Push-to-talk UI~~ ✅

### ~~V4 — Action Commands + Hardening~~ ✅ COMPLETE
- ~~`merge_pr` with confirmation flow~~ ✅
- ~~Pause/resume notifications~~ ✅
- ~~VAD-based interruption handling~~ ✅
- ~~Session resumption for connection drops~~ ✅
- ~~Ephemeral token support~~ ✅
- ~~Context window compression~~ ✅
- ~~Cost tracking~~ ✅

### Sprint: Stability & Performance (April 2026)
- **Gapless Playback:** Removed 50ms gaps between chunks; implemented precise `nextPlayTime` scheduling.
- **Gemini 3.1 Migration:** Upgraded model to `gemini-3.1-flash-live-preview`.
- **API Optimization:** Migrated text queries and event injections from `sendClientContent` to `sendRealtimeInput` (per Live API best practices).
- **Interruption Support:** Implemented server-side detection of Gemini interruption signals to clear browser audio queues immediately.
- **SSE Reliability:** Fixed `AbortError` logging loops during intentional disconnections.
- **Detailed Observability:** Added deep logging for message flows (Browser ↔ Server ↔ Gemini) and function call execution.

## Troubleshooting

### Voice button doesn't appear
- Ensure `NEXT_PUBLIC_AO_VOICE_ENABLED=true` is set
- Restart the Next.js dev server after changing env vars

### "GEMINI_API_KEY not configured" error
- Set `GEMINI_API_KEY` environment variable
- Restart the voice server

### No audio playback
- Check browser console for errors
- Ensure browser allows autoplay (may need user gesture first)
- Verify AudioContext is not suspended

### Events not being announced
- Check voice server logs for SSE connection status
- Verify `/api/events` endpoint is accessible
- Events may be deduped (30s window) — wait or trigger different event

### WebSocket connection fails
- Ensure voice server is running on port 3002
- Check for port conflicts
- Verify firewall allows local WebSocket connections
