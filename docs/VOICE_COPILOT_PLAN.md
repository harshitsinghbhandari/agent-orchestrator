# Voice Copilot Implementation Plan — Gemini Live API Integration

## Executive Summary

This plan adds **spoken situational awareness** to Agent Orchestrator using the Gemini Live API. The voice layer announces important events and answers questions like "what's happening?" and "summarize session ao-94".

This is **not** a voice chatbot bolted onto AO, not a raw terminal reader, not a fancy TTS wrapper. It's a **supervision layer** that lets you monitor agent activity hands-free.

**Approach:** Fork-first prototype as a web-based sidecar that connects to AO's SSE event stream and relays audio via Gemini Live API.

---

## 1. Codebase Walkthrough (Relevant to Voice Integration)

### 1.1 Event Production & Subscription

**Events are produced by the LifecycleManager:**
- `packages/core/src/lifecycle-manager.ts:83-135` — `createEvent()` produces `OrchestratorEvent` objects
- `packages/core/src/lifecycle-manager.ts:1114-1128` — `notifyHuman()` dispatches to all registered notifiers
- Events are typed at `packages/core/src/types.ts:883-933` — 21 event types across 6 categories

**Current subscription mechanisms:**
1. **Notifier plugins** — receive events via `notify(event: OrchestratorEvent)` interface
2. **SSE endpoint** — `packages/web/src/app/api/events/route.ts` polls SessionManager every 5s
3. **Dashboard hooks** — `packages/web/src/hooks/useSessionEvents.ts` consumes SSE

### 1.2 SSE Caveat — Not a Precise Event Stream

AO's event system is **not truly event-native end-to-end**. The SSE endpoint polls SessionManager on an interval (5s), and observable UI state is derived from session reads, not pushed events.

**Implications for voice layer:**
- Don't treat SSE as a precise event stream
- Expect: duplicate updates, stale state, delayed transitions
- **Must implement:** dedupe + debounce layer in voice gateway

The SSE feed is the easiest initial signal source, but queries should always fetch fresh data.

### 1.3 Session State & Data Access

**Session metadata:**
- Flat files at `~/.agent-orchestrator/{hash}-{projectId}/sessions/{sessionId}/`
- Managed via `packages/core/src/metadata.ts`

**PR enrichment (CI, reviews, mergeability):**
- `packages/core/src/lifecycle-manager.ts:214-320` — `populatePREnrichmentCache()` batch-fetches via GraphQL
- `packages/web/src/lib/serialize.ts:123-200` — parallel fetch of PR state, CI checks, reviews

**Activity detection:**
- `packages/core/src/lifecycle-manager.ts:370-428` — 6 states: active/ready/idle/waiting_input/blocked/exited
- Stuck detection at lines 485-527 (idle beyond threshold → `session.stuck` event)

### 1.4 Key Types for Voice Context

```typescript
// packages/core/src/types.ts:924-933
interface OrchestratorEvent {
  id: string;
  type: EventType;           // 21 types (session.*, pr.*, ci.*, review.*, merge.*)
  priority: EventPriority;   // urgent | action | warning | info
  sessionId: SessionId;
  projectId: string;
  timestamp: Date;
  message: string;           // Human-readable summary
  data: Record<string, unknown>;  // prUrl, ciStatus, reviewComments, etc.
}

// packages/web/src/lib/types.ts:187-250
type AttentionLevel = "merge" | "respond" | "review" | "pending" | "working" | "done";
```

### 1.5 Existing Real-Time Infrastructure

| Layer | Technology | Location |
|-------|------------|----------|
| SSE events | 5s polling interval | `web/src/app/api/events/route.ts` |
| Terminal WebSocket | xterm.js + PTY | `web/src/components/DirectTerminal.tsx` |
| Session API | REST endpoints | `web/src/app/api/sessions/` |

---

## 2. Recommended Architecture

### 2.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│  ┌──────────────┐    ┌───────────────┐    ┌────────────────────┐   │
│  │  Dashboard   │    │  Voice Panel  │    │  Audio Playback    │   │
│  │  (existing)  │◄──►│  (new React)  │◄──►│  (Web Audio API)   │   │
│  └──────────────┘    └───────┬───────┘    └────────────────────┘   │
│                              │ WebSocket                            │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────┐
│  Voice Gateway (Node.js)     │                                       │
│  ┌───────────────────────────▼─────────────────────────────────┐    │
│  │  WebSocket Server                                            │    │
│  │  • Accepts browser connection                                │    │
│  │  • Subscribes to AO SSE events                               │    │
│  │  • Dedupe + debounce layer                                   │    │
│  │  • Maintains Gemini Live API session                         │    │
│  │  • Relays audio to browser                                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│  ┌───────────────────────────┼─────────────────────────────────┐    │
│  │  Gemini Live API Client   │ WebSocket                        │    │
│  │  • @google/genai SDK      ▼                                  │    │
│  │  • Function calling for queries                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Gemini Live API    │
                    │  gemini-3.1-flash-  │
                    │  live-preview       │
                    └─────────────────────┘
```

### 2.2 Voice Gateway: Next.js Route vs Standalone Sidecar

Bidirectional realtime audio via a Next.js API route can get messy (framework constraints, edge runtime issues, WebSocket lifecycle).

**Keep open the option of a standalone sidecar:**

```
packages/web/
  ├── src/              # Next.js app
  └── voice-server.ts   # Standalone Node.js WebSocket server
```

**Why sidecar may be better:**
- Cleaner WebSocket lifecycle
- Easier audio streaming
- Easier debugging
- Less framework wrestling

**Decision:** Start with whichever is fastest. Can migrate between them.

### 2.3 Why Web Sidecar (Not Notifier Plugin)?

| Option | Pros | Cons |
|--------|------|------|
| **Notifier plugin** | Simple interface, auto subscription | No bidirectional audio, no conversation state, one-way only |
| **CLI integration** | Direct terminal access | No audio I/O, needs separate audio daemon |
| **Web sidecar** ✓ | Full audio I/O, conversation context, dashboard integration | More complex |

The **web sidecar** is best because:
1. Browser provides audio playback APIs
2. Can maintain conversation context across events
3. Natural integration with dashboard
4. Gemini Live API is WebSocket-based

### 2.4 Data Flow

**Event-to-Voice (push announcements):**
```
LifecycleManager → SSE /api/events → Voice Gateway (dedupe/debounce)
                                   → Filter (speakable events only)
                                   → Gemini context injection
                                   → Audio generation → Browser playback
```

**Voice-to-Query (user questions, V2+):**
```
Browser mic → Voice Gateway → Gemini Live API
                            ← Function call
                            → AO API query
                            ← Data
                            → Gemini continuation
                            ← Audio → Browser
```

---

## 3. Event Filtering — What to Auto-Speak

### 3.1 Speakable Events (MVP)

Only auto-announce these events:

| Event Type | Why |
|------------|-----|
| `ci.failing` | Agent's PR broke CI — needs attention |
| `review.changes_requested` | Reviewer asked for changes |
| `session.stuck` | Agent stopped making progress |
| `session.needs_input` | Agent waiting for human input |
| `merge.ready` | PR is approved + green — can merge |

### 3.2 Do NOT Auto-Speak

| Event Type | Why Skip |
|------------|----------|
| `session.spawned` | Too frequent, not actionable |
| `session.working` | Normal operation, noise |
| `session.idle` | Background info |
| `pr.created` | Nice to know, not urgent |
| `pr.updated` | Too frequent |
| Every PR state change | Annoying fast |

Users can still query these via voice ("what's session ao-94 doing?").

---

## 4. Minimal Event Schema for Voice Layer

```typescript
interface VoiceEvent {
  eventId: string;
  eventType: EventType;
  priority: EventPriority;
  timestamp: string;  // ISO 8601
  sessionId: string;
  projectId: string;
  message: string;    // Human-readable, for TTS

  // Structured context for follow-up queries
  context: {
    prUrl?: string;
    prNumber?: number;
    ciStatus?: "passing" | "failing" | "pending" | "none";
    reviewDecision?: "approved" | "changes_requested" | "pending" | "none";
    summary?: string;
    attentionLevel?: AttentionLevel;
  };
}
```

---

## 5. MVP Function Declarations

**Only 2 functions for MVP:**

```typescript
const mvpTools = [
  {
    name: "list_sessions",
    description: "List active agent sessions with their current status",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["working", "stuck", "needs_input", "pr_open", "approved"],
          description: "Filter by session status"
        }
      }
    }
  },
  {
    name: "get_session_summary",
    description: "Get summary of what a specific agent session is working on",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID like 'ao-94'"
        }
      },
      required: ["sessionId"]
    }
  }
];
```

**Implementation:**

| Function | AO API | Returns |
|----------|--------|---------|
| `list_sessions` | `GET /api/sessions` | Session IDs, statuses, attention levels |
| `get_session_summary` | `GET /api/sessions/:id` | `session.summary` + status + PR state |

---

## 6. Phased Implementation Plan

### MVP — Spoken Situational Awareness

**Goal:** Prove that event ingestion works, Gemini Live loop works, narration is useful, session query UX is right.

**Scope:**
1. Event listener (consume AO SSE feed)
2. Gemini Live session (connect + maintain)
3. Voice output (browser audio playback)
4. 2 functions: `list_sessions`, `get_session_summary`
5. Browser toggle (on/off)
6. Dedupe/debounce layer

**NOT in MVP:**
- ❌ Microphone input
- ❌ CI log fetching
- ❌ Review comment fetching
- ❌ Action execution (merge, send message)
- ❌ Core config schema changes

**Configuration (env vars only):**
```bash
GEMINI_API_KEY=your-key
AO_VOICE_ENABLED=true
```

No changes to `packages/core/src/config.ts`. Keep rebase pain low.

**Files to create:**
```
packages/web/
  ├── voice-server.ts              # OR src/app/api/voice/ws/route.ts
  └── src/
      ├── lib/
      │   ├── gemini-client.ts     # Gemini Live API wrapper
      │   ├── voice-serialize.ts   # Event → VoiceEvent
      │   ├── voice-functions.ts   # list_sessions, get_session_summary
      │   └── voice-dedupe.ts      # Dedupe + debounce layer
      ├── components/
      │   └── VoicePanel.tsx       # Toggle, status indicator
      └── hooks/
          └── useVoiceCopilot.ts   # WebSocket + audio playback
```

**Success criteria:**
- Voice announces CI failures within 10s
- "What's happening?" returns accurate session list
- "Summarize ao-94" returns correct summary

---

### V2 — Full Query Support

**Goal:** Handle all follow-up queries.

**Add:**
- `get_ci_failures` — fetch failed check names + truncated logs
- `get_review_comments` — fetch pending review threads
- `get_session_changes` — PR diff summary (files, +/- lines)
- Conversation context retention (remember last-discussed session)

---

### V3 — Voice Input + Basic Commands

**Goal:** Two-way voice interaction.

**Add:**
- Microphone capture (browser MediaRecorder)
- `send_message_to_session` — voice-to-agent messaging
- Session focus / follow mode
- Push-to-talk UI

**NOT yet:**
- ❌ Merge commands
- ❌ Kill commands
- ❌ Any destructive action

---

### V4 — Action Commands + Hardening

**Goal:** Reliable, interruptible, production-ready.

**Add:**
- `merge_pr` with confirmation flow
- Pause/resume notifications
- VAD-based interruption handling
- Session resumption for connection drops
- Ephemeral token support (no API key in browser)
- Context window compression
- Cost tracking

---

## 7. Files to Modify First (MVP)

### New Files

| Path | Purpose |
|------|---------|
| `packages/web/voice-server.ts` | Standalone WebSocket server (preferred) |
| `packages/web/src/lib/gemini-client.ts` | Gemini Live API wrapper |
| `packages/web/src/lib/voice-serialize.ts` | OrchestratorEvent → VoiceEvent |
| `packages/web/src/lib/voice-functions.ts` | Function call implementations |
| `packages/web/src/lib/voice-dedupe.ts` | Dedupe + debounce layer |
| `packages/web/src/components/VoicePanel.tsx` | Toggle UI |
| `packages/web/src/hooks/useVoiceCopilot.ts` | Browser audio + WebSocket |

### Existing Files to Modify

| Path | Change |
|------|--------|
| `packages/web/src/app/layout.tsx` | Add VoicePanel (conditional on env) |
| `packages/web/package.json` | Add `@google/genai` dependency |

### Files NOT Modified (Intentional)

| Path | Why Skip |
|------|----------|
| `packages/core/src/config.ts` | Avoid core changes, use env vars |
| `packages/core/src/types.ts` | No new types needed in core |
| `packages/core/src/lifecycle-manager.ts` | Don't touch event production |

---

## 8. Risks and Mitigations

### 8.1 AO Event System Limitations

**Risk:** SSE is polling-based, not precise events.

**Mitigation:**
- Dedupe layer in voice gateway
- Debounce rapid state changes
- Queries always fetch fresh data
- Events are context hints, not source of truth

**Risk:** Lifecycle manager may crash/stall.

**Mitigation:**
- Voice gateway has independent health check
- Falls back to direct API queries
- Voice code fully isolated — AO core unaffected

### 8.2 Gemini Live API Limitations

**Risk:** 15-minute connection limit.

**Mitigation:**
- Enable context window compression from start
- Track connection age, proactive reconnect
- Session resumption for seamless recovery

**Risk:** Sync-only function calls.

**Mitigation:**
- Keep handlers fast (<2s)
- Pre-cache session list
- Return summaries, not full payloads

**Risk:** Model hallucination on session IDs.

**Mitigation:**
- Validate session IDs before function calls
- Explicit "unknown session" handling
- Ground responses in function call results

### 8.3 Browser Audio

**Risk:** Audio playback complexity across browsers.

**Mitigation:**
- Use standard Web Audio API patterns
- Fallback to text-only mode if audio fails
- Test Chrome, Firefox, Safari

### 8.4 Security

**Risk:** API key in browser.

**Mitigation:**
- MVP: API key stays server-side, audio proxied through gateway
- V4: Ephemeral tokens

---

## 9. Open Questions

1. **Multi-project:** Announce project name? Filter to one project?
2. **Batch mode:** If 10 sessions, enumerate or summarize?
3. **Handoff:** When to say "check dashboard" vs. reading aloud?
4. **Cost tracking:** Expose Gemini audio minutes in UI?

---

## 10. Fork Strategy

**Fork:** `harshitsinghbhandari/agent-orchestrator`
**Branch:** `feat/voice-copilot`

**Isolation:**
1. All voice code in `packages/web/` — no core changes
2. VoicePanel conditional on `AO_VOICE_ENABLED` env var
3. No changes to event production or lifecycle manager
4. Can rebase onto main with minimal conflicts

**Upstream path:**
- Can be merged as self-contained PR
- Or maintained as fork-only feature

---

## Appendix: Gemini Live API Integration

### Connection Setup

```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const session = await ai.live.connect({
  model: 'gemini-3.1-flash-live-preview',
  config: {
    responseModalities: ['audio'],
    systemInstruction: {
      parts: [{
        text: `You are the voice interface for Agent Orchestrator, a system managing parallel AI coding agents.

Your role:
- Announce important events concisely (CI failures, review requests, stuck sessions)
- Answer questions about session status and agent activity
- Keep responses brief and actionable
- Use session IDs like "ao-94" consistently
- If you don't know, say so and suggest checking the dashboard`
      }]
    },
    tools: mvpTools
  },
  callbacks: {
    onopen: () => console.log('Gemini Live connected'),
    onmessage: handleGeminiMessage,
    onerror: (error) => console.error('Gemini error:', error),
    onclose: () => console.log('Gemini Live disconnected')
  }
});
```

### Event Injection with Dedupe

```typescript
const recentEvents = new Map<string, number>();  // eventId → timestamp
const DEDUPE_WINDOW_MS = 30_000;

function shouldSpeak(event: VoiceEvent): boolean {
  // Only speak speakable event types
  const speakable = [
    'ci.failing',
    'review.changes_requested',
    'session.stuck',
    'session.needs_input',
    'merge.ready'
  ];
  if (!speakable.includes(event.eventType)) return false;

  // Dedupe within window
  const now = Date.now();
  const key = `${event.sessionId}:${event.eventType}`;
  const lastSeen = recentEvents.get(key);
  if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) return false;

  recentEvents.set(key, now);
  return true;
}

function injectEvent(session: GeminiLiveSession, event: VoiceEvent) {
  if (!shouldSpeak(event)) return;

  session.sendRealtimeInput({
    text: `[AO Event] ${event.message}
Session: ${event.sessionId}
${event.context.prUrl ? `PR: ${event.context.prUrl}` : ''}`
  });
}
```

### Function Call Handler

```typescript
async function handleFunctionCall(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case 'list_sessions': {
      const res = await fetch('/api/sessions');
      const { sessions } = await res.json();
      const filtered = args.status
        ? sessions.filter((s: any) => s.status === args.status)
        : sessions;
      return filtered.length === 0
        ? 'No sessions match that filter.'
        : filtered.map((s: any) =>
            `${s.id}: ${s.status}${s.summary ? ` — ${s.summary}` : ''}`
          ).join('\n');
    }

    case 'get_session_summary': {
      const res = await fetch(`/api/sessions/${args.sessionId}`);
      if (!res.ok) return `Session ${args.sessionId} not found.`;
      const session = await res.json();
      return session.summary ?? `${args.sessionId} is ${session.status}, no summary available.`;
    }

    default:
      return `Unknown function: ${name}`;
  }
}
```

### Audio Formats

- **Output from Gemini:** PCM, 16-bit, mono, 24kHz
- **Browser playback:** Decode base64 → ArrayBuffer → AudioContext.decodeAudioData

---

## Summary

The MVP is **spoken situational awareness**:

1. Hear important updates (CI failed, review comments, stuck, needs input, merge ready)
2. Ask "what's happening?"
3. Ask "summarize ao-94"

If those 3 work well, round one is won. Everything else is expansion.
