# Gemini Live Voice Copilot Implementation Plan

## Objective

Introduce a production-safe Gemini Live voice copilot into `packages/web` on top of `upstream/main`, with a plan that is incremental, testable, and compatible with the current AO dashboard architecture.

This plan is intentionally narrower and more implementable than the earlier handoff. It treats the voice system as a staged feature rollout, not a single large merge.

## Constraints From Current `upstream/main`

- No voice implementation exists on `upstream/main`.
- `packages/web/package.json` currently starts only Next.js and direct terminal WS in dev.
- `packages/web/server/start-all.ts` currently starts only Next.js and direct terminal WS in production.
- `packages/web/src/app/layout.tsx` has no voice panel mount point.
- `/api/events` emits reduced session snapshots:
  - `id`
  - `status`
  - `activity`
  - `attentionLevel`
  - `lastActivityAt`
- `/api/sessions` already provides the richer session/PR data a voice assistant needs for query tools.

These constraints mean the voice plan should not assume an existing server bridge, existing UI shell, or rich SSE payloads.

## Recommended Rollout Shape

Ship in 4 phases:

1. Foundation and secure transport
2. Push-to-talk voice loop + read-only session queries
3. Agent actions + proactive announcements
4. Optional higher-risk features behind review

This keeps the first merged increments small and debuggable while avoiding dead-end abstractions.

## Phase 1: Foundation And Secure Transport

### Goal

Create the minimal infrastructure required for a browser voice client to talk to a standalone Gemini Live bridge securely, without shipping microphone UX or action tools yet.

### Scope

- Add Gemini SDK dependency to `packages/web`
- Add standalone voice WebSocket server
- Add server startup wiring in dev and production
- Add token issuance route and token validation utilities
- Add feature gating env vars
- Add a minimal hidden/testable browser hook path for text-only interaction

### Files To Add

- `packages/web/server/voice-server.ts`
- `packages/web/src/lib/voice-token.ts`
- `packages/web/src/app/api/voice/token/route.ts`

### Files To Modify

- `packages/web/package.json`
- `packages/web/server/start-all.ts`
- `packages/web/tsconfig.server.json` only if needed for emitted path assumptions

### Implementation Notes

- Keep Gemini API usage server-side only.
- Use a standalone `ws` server, matching the direct-terminal pattern already used in `packages/web/server`.
- Use short-lived HMAC-signed tokens for browser-to-voice-server auth.
- Feature-gate both startup and UI exposure with env vars.
- Prefer a simple server-global singleton state for v1 because AO is currently single-operator by design.

### Acceptance Criteria

- With feature flag off, nothing new starts and no voice UI is rendered.
- With feature flag on and `GEMINI_API_KEY` + `VOICE_TOKEN_SECRET` set, the voice WS server starts successfully.
- Browser can fetch `/api/voice/token` and open a WS connection to the voice server.
- Voice server can connect to Gemini Live and return connection state.

### Tests

- token generation/validation unit tests
- `/api/voice/token` route tests
- smoke test for voice server message handling if practical

## Phase 2: Push-To-Talk Voice Loop And Read-Only Query Tools

### Goal

Make the feature actually useful with the smallest valuable UX:

- connect/disconnect UI
- push-to-talk microphone capture
- Gemini audio playback
- read-only queries against AO sessions

### Scope

- Add `VoicePanel` and `VoicePanelWrapper`
- Add `useVoiceCopilot` browser hook
- Add audio worklet for PCM capture
- Add basic Gemini system prompt
- Add read-only tool functions backed by `/api/sessions`

### Files To Add

- `packages/web/src/components/VoicePanel.tsx`
- `packages/web/src/components/VoicePanelWrapper.tsx`
- `packages/web/src/hooks/useVoiceCopilot.ts`
- `packages/web/public/audio-worklet-processor.js`
- `packages/web/src/lib/voice-functions.ts`

### Files To Modify

- `packages/web/src/app/layout.tsx`

### Tool Set For This Phase

- `list_sessions`
- `get_session_summary`
- `get_ci_failures`
- `get_review_comments`
- `get_session_changes`

### Implementation Notes

- Use 16kHz mono PCM for microphone upload.
- Use 24kHz PCM playback unless Gemini contract proves different.
- Prefer `AudioWorklet`, with `ScriptProcessorNode` fallback only if needed.
- Keep tool execution logic separate from the voice server transport code.
- Always refresh data from `/api/sessions` before executing a Gemini function call.

### Acceptance Criteria

- User can enable voice from the dashboard.
- User can hold a button or a key to speak.
- Gemini audio is played back reliably without overlapping chunks.
- Voice assistant can answer basic session/PR questions based on current dashboard data.

### Tests

- `useVoiceCopilot` hook tests
- `voice-functions` unit tests for session resolution and response shaping
- browser message parsing tests where practical

## Phase 3: Agent Actions And Proactive Announcements

### Goal

Add operational value beyond question answering:

- send commands to sessions
- focus/follow context
- proactive spoken alerts for important AO state changes

### Scope

- Add action tools for agent messaging
- Add conversation context tracking
- Add event dedupe
- Add SSE subscription from voice server
- Add event-to-announcement logic

### Files To Add

- `packages/web/src/lib/voice-dedupe.ts`

### Files To Modify

- `packages/web/server/voice-server.ts`
- `packages/web/src/lib/voice-functions.ts`
- `packages/web/src/components/VoicePanel.tsx`

### Tool Set For This Phase

- `send_message_to_session`
- `focus_session`
- `follow_session`
- `pause_notifications`
- `resume_notifications`

### Implementation Notes

- Do not rely directly on the current `/api/events` payload for PR-specific transitions.
- Recommended approach:
  - use `/api/events` as the cheap change signal
  - when a session changes, hydrate the relevant session through `/api/sessions`
  - run transition detection on the richer hydrated session data
- Keep dedupe keyed by `sessionId:eventType` with a short time window to absorb 5-second polling repeats.
- Route message sends through `/api/sessions/[id]/send`.

### Acceptance Criteria

- User can tell a session or orchestrator to do work by voice.
- Focus/follow state is visible in the UI and affects later commands.
- Voice assistant announces actionable events without repeating the same alert every poll cycle.

### Tests

- dedupe tests
- action tool tests
- event transition tests using realistic before/after session payloads

## Phase 4: Higher-Risk Features Behind Review

### Goal

Add convenience features only after the core system is stable.

### Candidate Features

- wake-word / hands-free mode
- merge-by-voice flow
- audio/cost telemetry in UI
- multi-user or remote-host hardening

### Recommendation

Do not put these in the first production landing.

They are the most likely source of:

- security mistakes
- confusing UX
- incomplete state machines
- browser compatibility failures

## Module Plan

### `packages/web/server/voice-server.ts`

Responsibilities:

- browser WS server
- token validation
- Gemini Live session lifecycle
- browser message parsing
- Gemini message parsing
- tool response loop
- SSE subscription
- event dedupe + announcement injection

Keep this file transport-oriented. Anything that looks like business logic should move to `src/lib`.

### `packages/web/src/lib/voice-functions.ts`

Responsibilities:

- tool input validation and shaping
- session resolution heuristics
- response text shaping
- focus/follow context rules
- action return contracts back to server

### `packages/web/src/hooks/useVoiceCopilot.ts`

Responsibilities:

- token fetch
- browser WS lifecycle
- playback queue
- microphone start/stop
- queue interruption/cleanup
- connection error handling

### `packages/web/src/components/VoicePanel.tsx`

Responsibilities:

- feature toggle UI
- button/key interactions
- transcript/debug feedback
- status badges
- focus/follow state display

## Integration Decisions Baked Into This Plan

These are the recommended defaults unless review says otherwise:

- Keep the feature in `packages/web`, not `core`
- Use a standalone Node WS server, not a Next route handler for Gemini streaming
- Keep Gemini API key server-only
- Use `/api/sessions` as the authoritative data source for tool execution
- Treat `/api/events` as a lightweight change feed, not a sufficient source for PR-rich announcements
- Defer merge-by-voice and wake-word to later phases

## Detailed Task List

### Foundation

- Add `@google/genai` dependency
- Add `AO_VOICE_ENABLED`, `NEXT_PUBLIC_AO_VOICE_ENABLED`, `VOICE_TOKEN_SECRET`, `VOICE_PORT`, `AO_ALLOWED_ORIGIN` env support
- Add `voice-server.ts`
- Add token route and token utils
- Update `pnpm dev` and `start-all.ts`

### Browser MVP

- Add `VoicePanelWrapper` gated by `NEXT_PUBLIC_AO_VOICE_ENABLED`
- Add `VoicePanel`
- Add `useVoiceCopilot`
- Add `audio-worklet-processor.js`

### Tooling

- Add session query tool declarations
- Add `voice-functions.ts`
- Wire `/api/sessions` fetch into tool execution

### Action Layer

- Add send-message action path
- Add conversation context model
- Add focus/follow behavior

### Announcements

- Add SSE subscription in voice server
- Add dedupe helper
- Add transition detection that hydrates richer data before PR-specific announcements

## Risks To Manage During Implementation

- Browser audio APIs are stateful and easy to leak
- Gemini audio format assumptions may drift
- token auth can be broken by dashboard auth expectations if headers are not aligned
- SSE event payloads are currently too small for PR-state-aware speech
- mixed transport/business logic in the voice server can become unmaintainable if not separated early

## Definition Of Done For Initial Merge

The first merge should stop at:

- secure server-side Gemini bridge
- dashboard voice panel
- push-to-talk microphone capture
- playback
- read-only session tools

That is the smallest coherent feature that can be demoed, debugged, and reviewed safely.

Everything else can layer on without rewriting the core transport.
