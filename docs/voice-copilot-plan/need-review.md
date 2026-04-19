# Gemini Live Voice Copilot: Need Review

These are the decisions that should be made explicitly before or during implementation. Recommended defaults are included so engineering can move quickly.

## 1. Should merge-by-voice be part of the first delivery?

Recommendation:

- No.

Why:

- It is the highest-risk action in the feature set.
- The earlier implementation shape had an incomplete pending-merge flow.
- It is easy to create a misleading UX where the system reports “merged” before a merge actually happens.

If approved later:

- require explicit spoken confirmation
- surface a visible pending-merge UI state
- route final execution through `/api/prs/[id]/merge`

## 2. Should wake-word / hands-free mode ship in the first delivery?

Recommendation:

- No.

Why:

- It adds browser support variability
- it complicates mic ownership and playback interruption
- it is not required to validate the core voice architecture

Ship push-to-talk first.

## 3. Should the voice server trust `/api/events` directly for proactive announcements?

Recommendation:

- No.

Why:

- current `/api/events` payload is intentionally reduced
- it does not carry the PR/CI/review fields needed for reliable voice transition detection

Recommended path:

- use `/api/events` as a change signal
- rehydrate changed sessions via `/api/sessions` before announcing CI/review/merge transitions

Alternative:

- expand `/api/events` payload specifically for voice consumers

That alternative is viable, but it broadens the API contract and should be a conscious decision.

## 4. Should browser voice token fetch require `AO_DASHBOARD_TOKEN` auth?

Recommendation:

- Decide this before implementation and keep it consistent.

Preferred default:

- If the dashboard is browser-accessible without a custom auth header, `/api/voice/token` should not require a header the browser does not already send.

If auth is required:

- define how the browser obtains and forwards the token
- do not leave the route expecting a bearer header that the hook never sends

## 5. Do we want single-user voice only, or multi-user safety?

Recommendation:

- Single-user only for v1.

Why:

- AO today is effectively a local operator dashboard
- a singleton WS + singleton Gemini session is dramatically simpler

If multi-user becomes a requirement later:

- the server state model must change from process-global singleton to per-client session state

## 6. Should voice feature gating use one env var or two?

Current likely choices:

- `AO_VOICE_ENABLED` for server startup
- `NEXT_PUBLIC_AO_VOICE_ENABLED` for client rendering

Recommendation:

- Keep both only if there is a real need for separate server/client toggles.
- Otherwise, derive one from the other in startup/config to avoid mismatched states.

The implementation should avoid this class of bug:

- server running, no UI rendered
- UI rendered, no server running

## 7. Should session queries support orchestrator commands in v1?

Recommendation:

- Yes for text/message routing
- No for anything more advanced than alias resolution

Why:

- AO already exposes orchestrator sessions in `/api/sessions`
- aliasing `orchestrator` is cheap and useful

## 8. Do we want text-only fallback in the first iteration?

Recommendation:

- Yes.

Why:

- It improves debuggability
- it makes local iteration faster when microphone permissions are failing
- it helps isolate transport bugs from mic-capture bugs

## 9. Should cost tracking be included in the initial landing?

Recommendation:

- No.

Why:

- It is useful but not required to prove correctness
- it introduces more state and more UI

It can be added after the voice loop is reliable.

## 10. Should the voice system be introduced behind an internal/experimental UI label?

Recommendation:

- Yes.

Suggested wording:

- “Experimental voice copilot”

Why:

- Sets correct expectations
- reduces support burden during rollout

## 11. Should proactive announcements be global or focused/followed-session only?

Recommendation:

- Start with globally important alerts plus optional follow mode.

Baseline alert classes:

- session stuck
- session needs input
- CI failed
- review changes requested

Then add follow-mode refinement if the alert volume is too high.

## 12. What is the minimum acceptable first merge?

Recommendation:

- secure WS bridge
- token auth
- push-to-talk
- playback
- read-only query tools
- experimental panel UI

Do not block the first merge on:

- merge-by-voice
- wake word
- cost UI
- multi-user support
