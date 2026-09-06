# OpenUI Integration Research for Agent Orchestrator

## Table of Contents

1. [What OpenUI Is and How It Works](#1-what-openui-is-and-how-it-works)
2. [Integration Opportunities (Ranked by Impact)](#2-integration-opportunities-ranked-by-impact)
3. [Technical Architecture for Each Integration](#3-technical-architecture-for-each-integration)
4. [Required Changes](#4-required-changes)
5. [Recommended Starting Point](#5-recommended-starting-point)
6. [Risk Mitigations](#6-risk-mitigations)
7. [Appendix: Compatibility Analysis](#7-appendix-compatibility-analysis)

---

## 1. What OpenUI Is and How It Works

### Core Concept

[OpenUI](https://github.com/thesysdev/openui) is a **Generative UI framework** that lets LLMs produce live, interactive UIs instead of plain text or static markdown. It introduces **OpenUI Lang** — a declarative language that LLMs output instead of JSON or HTML. The key insight: the LLM generates a program once, and the runtime handles all subsequent interactivity (data fetching, state changes, form submissions) without calling the LLM again.

**Generate once, execute forever.**

### Architecture

```
LLM Output (OpenUI Lang)
    ↓
Streaming Lexer → Token Stream
    ↓
Streaming Parser → AST (incrementally built)
    ↓
Materializer → Resolves references, maps positional args to named props
    ↓
Evaluator → Resolves $variables, Query() results, Action() bindings
    ↓
React Renderer → Live interactive UI components
```

### Key Primitives

| Primitive | Purpose | Example |
|-----------|---------|---------|
| `defineComponent()` | Register a component with Zod v4 schema + React renderer | `defineComponent({ name: "StatusCard", props: z.object({...}), render: (props) => <Card {...props}/> })` |
| `Query()` | Declarative data fetching (REST/GraphQL) | `Query("/api/sessions", "GET")` |
| `Mutation()` | Write operations | `Mutation("/api/sessions/123/kill", "POST")` |
| `$variable` | Reactive state binding | `$selectedSession = "abc123"` |
| `Action()` | Button/event handlers | `Action("onClick", Mutation(...))` |
| `Library` | Component collection → auto-generates LLM system prompt | `createLibrary([StatusCard, Timeline, ...])` |

### How Component Libraries Work

1. You define components with `defineComponent()`, providing a Zod v4 schema for props and a React render function.
2. Components are assembled into a `Library`.
3. The library auto-generates a **system prompt** that teaches the LLM the OpenUI Lang syntax and available components.
4. The LLM outputs OpenUI Lang code using your components.
5. The streaming parser incrementally builds the AST and renders components as they arrive.

### Integration Model

OpenUI provides a `<Renderer>` component that can be embedded standalone — you don't need the chat interface. This is the cleanest integration path for AO:

```tsx
import { Renderer } from "@openui/react";
import { myLibrary } from "./openui-components";

function AgentInsightPanel({ openUICode }: { openUICode: string }) {
  return <Renderer library={myLibrary} code={openUICode} />;
}
```

### Limitations

- **Zod v4 required** — AO uses Zod v3 for config validation. See [Zod v4 Coexistence Plan](#zod-v4-coexistence-plan) for mitigation.
- **No WebSocket/push support** — Query() polls REST endpoints; no SSE or WebSocket integration. **This is a hard blocker for any real-time integration.** OpenUI-rendered views cannot receive external push updates. Use OpenUI only for static/completed data (insight cards, post-session timelines), not live session views.
- **Generate-once model** — The generated UI is a snapshot. It does not update when the underlying session state changes. This is acceptable for completed sessions, but means OpenUI is the wrong tool for active session monitoring.
- **Chat-first architecture** — The default UX assumes a chat interface. Standalone Renderer usage is supported but less documented.
- **No server-side rendering** — OpenUI renders client-side only.

### Where OpenUI Fits vs. Where It Doesn't

| Use case | OpenUI fit? | Why |
|----------|-------------|-----|
| Completed session summaries | Yes | Static data, variable structure, benefits from LLM composition |
| PR review briefings | Yes | Same as above — snapshot of completed work |
| Live session monitoring | No | Needs SSE/push updates; OpenUI can't receive them |
| Real-time analytics | No | Stale the moment it renders; chart library is better |
| Ad-hoc analytics queries | Maybe | Natural-language → generated dashboard is compelling, but a chart library handles structured data with less complexity |

---

## 2. Integration Opportunities (Ranked by Impact)

### Opportunity 1: Agent-Generated Insight Cards (Impact: HIGH, Feasibility: MEDIUM)

**The Problem:** Agent sessions produce a wall of terminal output. Users can't quickly understand what an agent did, what decisions it made, or what trade-offs it considered. The `summary` field is a single string.

**The Idea:** Agents use OpenUI to generate rich, structured insight cards about their own work at session completion. Instead of writing a plain-text summary, the agent outputs OpenUI Lang that renders as an interactive component:

- **Architecture decision cards** — "I chose Strategy A over Strategy B because..." with expandable reasoning
- **File change summaries** — Interactive diff viewer showing what changed and why
- **Test result dashboards** — Which tests passed/failed/were added, with drill-down
- **Dependency impact maps** — "Changing X affected Y and Z" with visual connections
- **PR review briefing** — Risk assessment, attention markers, test coverage map, rollback plan

This subsumes what was previously listed as a separate "PR Review Preparation" opportunity — it's the same feature (agent generates structured work summary) surfaced in two places: the session card and the PR view.

**Cost model:** One LLM call per completed session. Generated OpenUI Lang is cached in session metadata — never regenerated unless explicitly requested. No recurring LLM cost.

**What it looks like:**

```
┌─────────────────────────────────────────────────┐
│  Session: fix-auth-middleware (#1234)            │
│                                                 │
│  ┌─── Decision Log ──────────────────────────┐  │
│  │ 1. Analyzed 3 approaches to token refresh │  │
│  │    [▸ Expand reasoning]                   │  │
│  │ 2. Chose sliding-window refresh           │  │
│  │    [▸ Trade-offs considered]               │  │
│  │ 3. Modified 4 files, added 12 tests       │  │
│  │    [▸ View changes]                       │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌─── Files Modified ────────────────────────┐  │
│  │ ● src/auth/refresh.ts    +47 -12          │  │
│  │ ● src/auth/middleware.ts +8  -3           │  │
│  │ ● tests/auth.test.ts    +89 -0   [new]   │  │
│  │ [▸ View inline diffs]                     │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌─── Review Briefing ──────────────────────┐   │
│  │ Risk: LOW ■■□□□   Confidence: HIGH ■■■■□ │   │
│  │ ⚠ Attention: L45-67 in refresh.ts        │   │
│  │ Test coverage: 94% of changed lines      │   │
│  └───────────────────────────────────────────┘   │
│                                                 │
│  Cost: $0.47 │ Duration: 12m │ Commits: 3      │
└─────────────────────────────────────────────────┘
```

**Why OpenUI fits here specifically:** Agent output is inherently variable — different issues produce different decisions, different file structures, different trade-offs. A static template either over-provisions (empty sections for decisions the agent didn't make) or under-provisions (no section for the unexpected thing the agent did). The LLM generates exactly the right layout for what actually happened. This is the one place where the "generate once" model is a feature, not a limitation — completed sessions don't change.

---

### Opportunity 2: Session Timeline (Impact: MEDIUM, Feasibility: MEDIUM)

**The Problem:** The dashboard shows session state (working/pending/done) but not the journey. There's no timeline of "spawned → analyzed issue → created branch → wrote code → ran tests → tests failed → fixed → PR created → CI passed → merged."

**The Idea:** Build a timeline view for completed sessions using structured lifecycle events.

**Important constraint:** OpenUI has no push/SSE support. A timeline for an active session would be stale the moment it renders. **This integration only works for completed sessions** — generate the timeline once after the session reaches a terminal state (merged/done/terminated), cache it, and display it in the session detail view.

For active sessions, a static Tailwind timeline component driven by lifecycle events is the right tool. OpenUI adds value only for the post-hoc annotated timeline where the LLM can add narrative context ("the agent tried approach A, it failed because X, then pivoted to approach B").

**What it looks like:**

```
10:32 ● Spawned — issue #1234 "Fix auth token refresh"
  │
10:33 ● Analyzed — read 4 files, identified root cause
  │    [▸ Files analyzed] [▸ Root cause reasoning]
  │
10:35 ● Implementation — modified refresh.ts
  │    [▸ View diff] [▸ Why this approach?]
  │
10:38 ✗ Tests failed — 2 failures in auth.test.ts
  │    [▸ Failure details] [▸ Agent analysis]
  │
10:40 ● Fix applied — edge case in token expiry
  │    [▸ View fix]
  │
10:42 ✓ PR created — #456
  │
11:02 ✓ Merged
```

**Cost model:** One LLM call per completed session. Cached in session metadata.

---

### Opportunity 3: On-Demand Analytics (Impact: MEDIUM, Feasibility: EASY)

**The Problem:** The dashboard shows individual session status but lacks aggregate analytics.

**The Idea:** A "Generate Report" button that sends session data to an LLM with an OpenUI analytics component library.

**Honest assessment:** This is the weakest OpenUI use case. Analytics data is structured and predictable — success rates, cost trends, time distributions. A standard chart library (Recharts, Nivo) handles 90% of this at 10% of the complexity without an LLM call. The only scenario where OpenUI adds value over a chart library is natural-language ad-hoc queries: "why did failure rates spike on Tuesday?" where the LLM can correlate session data with contextual explanations.

**Recommendation:** Build basic analytics with a chart library first. Reach for OpenUI only if users actually need the natural-language query UX and it proves valuable beyond what structured dashboards provide.

---

### Opportunity 4: Schema/Architecture Visualization (Impact: LOW, Feasibility: MEDIUM)

**The Problem:** When agents work on database migrations or architectural refactors, the impact is hard to visualize from diffs alone.

**The Idea:** Agents generate interactive diagrams as part of their insight cards (Opportunity 1): schema diffs, API endpoint maps, dependency graphs. These are specialized components in the same OpenUI library, not a separate integration.

---

### Dropped Opportunities

**Copilot Panel (previously Opp 3):** Deferred. The streaming Renderer + layout overhaul + context-gathering pipeline is a 2-3 week build. The distinction from a chat interface with rich markdown rendering isn't strong enough to justify the complexity now. Revisit after the insight card pipeline is proven and if users request interactive query responses over formatted text.

**Multi-Agent Comparison (previously Opp 7):** Deferred. High complexity, niche use case. The data needed (structured comparison of agent approaches) doesn't exist yet. Build the event logging and insight card infrastructure first — comparison views become feasible once there's structured data to compare.

---

## 3. Technical Architecture for Each Integration

### Architecture A: Agent Insight Cards (Opportunity 1)

```
Agent Plugin (claude-code, codex, etc.)
    │
    │ At session completion, agent generates OpenUI Lang
    │ using the AO component library prompt
    │
    ▼
Session Metadata
    │ Store OpenUI code in session metadata
    │ Key: "insightCard" → OpenUI Lang string
    │
    ▼
API Route: GET /api/sessions/[id]/insight
    │ Returns the stored OpenUI Lang
    │ Fallback: returns plain-text summary if no insight card exists
    │
    ▼
Dashboard: SessionCard.tsx / SessionDetail.tsx
    │ Embeds <Renderer library={aoLibrary} code={insightCode} />
    │ Renders inside an expandable panel
    │ On Renderer error: falls back to plain-text summary
    │
    ▼
User sees interactive insight card
```

**Component library needed:**

```typescript
// packages/web/src/lib/openui-components.ts
import { defineComponent, createLibrary } from "@openui/react";
import { z } from "zod/v4"; // Zod v4 — isolated to this file only

export const DecisionCard = defineComponent({
  name: "DecisionCard",
  props: z.object({
    title: z.string(),
    chosen: z.string(),
    alternatives: z.array(z.string()).optional(),
    reasoning: z.string(),
  }),
  render: ({ title, chosen, alternatives, reasoning }) => (
    // Render with AO design tokens (var(--color-*))
  ),
});

export const FileChangeList = defineComponent({ ... });
export const MetricRow = defineComponent({ ... });
export const TestSummary = defineComponent({ ... });
export const ReviewBriefing = defineComponent({ ... });

export const aoLibrary = createLibrary([
  DecisionCard, FileChangeList, MetricRow, TestSummary, ReviewBriefing, ...
]);
```

**Changes required:**

| Component | Change | Effort |
|-----------|--------|--------|
| Agent plugins | Add post-completion insight generation step | Medium |
| Session metadata | Store OpenUI Lang strings (already supports arbitrary strings) | Low |
| API routes | New `/api/sessions/[id]/insight` endpoint with fallback | Low |
| Dashboard | Add `<Renderer>` with error boundary to SessionCard/SessionDetail | Medium |
| New module | `packages/web/src/lib/openui-components.ts` | Medium |
| Dependencies | Add `@openui/react` to web package | Low |

### Architecture B: Session Timeline (Opportunity 2)

```
Lifecycle Manager (polling loop)
    │
    │ Already tracks state transitions
    │ Add: emit structured events to session event log
    │
    ▼
Session Event Log (new)
    │ JSONL file at ~/.agent-orchestrator/{hash}/sessions/{id}/events.jsonl
    │ Each line: { ts, type, state, detail, metadata }
    │
    ▼
On session completion:
    │ API Route reads event log, sends to LLM with timeline library
    │ Caches generated OpenUI Lang in session metadata
    │
    ▼
API Route: GET /api/sessions/[id]/timeline
    │ Returns cached OpenUI Lang
    │ Fallback: returns raw event list for static rendering
    │
    ▼
Dashboard: SessionDetail.tsx
    │ Completed sessions: <Renderer /> with interactive timeline
    │ Active sessions: static Tailwind timeline component from lifecycle events
    │
    ▼
User sees session journey
```

**Changes required:**

| Component | Change | Effort |
|-----------|--------|--------|
| Lifecycle manager | Emit structured events to JSONL log | Medium |
| Core types | Define `SessionEvent` type | Low |
| Session manager | Read/write event log | Low |
| API routes | New `/api/sessions/[id]/timeline` endpoint | Medium |
| Dashboard | Static timeline for active, OpenUI timeline for completed | Medium |
| OpenUI library | Timeline-specific components (reuse some from Insight Cards) | Medium |

---

## 4. Required Changes

### Changes to OpenUI

| Change | Why | Effort | Blocking? |
|--------|-----|--------|-----------|
| Dark theme support in Renderer | AO uses a custom dark theme; Renderer needs to inherit CSS custom properties | Medium | No — can work around with component-level styling |
| Standalone Renderer documentation | Currently under-documented for non-chat usage | Low | No — can read source |

Note: SSE/push support is NOT listed here because we're scoping OpenUI to static/completed data where push isn't needed. If we later want real-time OpenUI views, that becomes a hard prerequisite.

### Changes to Agent Orchestrator

| Change | Why | Priority | Effort |
|--------|-----|----------|--------|
| Add `@openui/react` dependency to web package | Core integration dependency | P0 | Low |
| Create AO OpenUI component library (Zod v4 isolated) | Define components matching AO's design system | P0 | Medium |
| Add insight generation to agent plugins | Agents produce OpenUI Lang summaries at completion | P0 | Medium |
| New API route for insight with fallback | Serve OpenUI data to dashboard | P0 | Low |
| Error boundary around Renderer | Graceful fallback to text summary | P0 | Low |
| Add session event logging to lifecycle manager | Structured event data for timelines | P1 | Medium |
| New API route for timeline | Serve timeline data | P1 | Medium |
| Static timeline component for active sessions | Non-OpenUI timeline for live sessions | P1 | Medium |
| LLM integration in API routes | Send context to LLM, get OpenUI Lang back | P0 | Medium |

---

## 5. Recommended Starting Point

### Phase 1: Agent Insight Cards (1 week)

**Why start here:**
- Tests the core thesis — LLM-generated UI handles variable agent output better than static templates
- Works exclusively with completed sessions — the "generate once" model is a feature here, not a limitation
- One LLM call per session, cached forever — predictable, bounded cost
- Validates the full pipeline: agent → OpenUI Lang → metadata → API → Renderer → dashboard
- Includes PR review briefing (merged Opp 1 + 5)

**Steps:**
1. Add `@openui/react` to `packages/web/` (Zod v4 as peer dep, isolated)
2. Create insight component library styled with AO design tokens
3. Add error boundary wrapper around `<Renderer>` with text summary fallback
4. Add post-completion insight generation hook to claude-code agent plugin
5. Store generated OpenUI code in session metadata
6. Create `/api/sessions/[id]/insight` route
7. Add expandable insight panel to SessionDetail.tsx
8. Measure bundle size impact of `@openui/react`

### Phase 2: Session Timeline for Completed Sessions (1-2 weeks)

**Build on Phase 1's component library and Renderer integration:**
1. Add structured event logging to lifecycle manager (JSONL)
2. Define `SessionEvent` type in core
3. Add timeline-specific components to OpenUI library
4. Generate timeline OpenUI code on session completion (reuse LLM integration from Phase 1)
5. Build static Tailwind timeline for active sessions (no OpenUI)
6. Create `/api/sessions/[id]/timeline` route
7. Integrate both views into SessionDetail.tsx

### Phase 3: Evaluate Analytics (1 week, exploratory)

**Don't commit to OpenUI for analytics yet:**
1. Build basic analytics with a standard chart library (Recharts)
2. Add a "Ask a question" input that sends natural-language queries to LLM
3. Compare: does the OpenUI-generated response add value over the static charts?
4. If yes, invest in the analytics component library. If no, ship the chart library version.

### Deferred: Copilot Panel, Multi-Agent Comparison

Revisit after Phase 1-2 are shipped and validated. Prerequisites:
- Proven insight card pipeline
- User feedback on whether interactive UI responses (vs. formatted text) are worth the complexity
- OpenUI push/SSE support (for copilot to show live data)

---

## 6. Risk Mitigations

### Error Handling: Invalid OpenUI Lang

The LLM may generate malformed OpenUI Lang. The Renderer must never crash the dashboard.

**Mitigation:** Wrap every `<Renderer>` in a React error boundary that catches parse/render failures and falls back to the existing plain-text summary. The insight card is an enhancement — if it fails, the user sees what they'd see today.

```tsx
<InsightErrorBoundary fallback={<TextSummary text={session.summary} />}>
  <Renderer library={aoLibrary} code={insightCode} />
</InsightErrorBoundary>
```

Additionally, validate the generated OpenUI Lang against the component library schema before storing it in session metadata. If validation fails, store the plain-text summary instead and log the failure for debugging.

### Security: Renderer Trust Boundary

The Renderer evaluates LLM-generated code. A compromised or adversarial agent prompt could inject malicious OpenUI Lang.

**Mitigations:**
1. **OpenUI Lang is not JavaScript.** It's a declarative language with a fixed grammar — no arbitrary code execution. The evaluator only resolves component references, `Query()`, `Mutation()`, `$variables`, and `Action()`. It cannot execute arbitrary functions.
2. **Component library is the sandbox.** Only components defined in `aoLibrary` can be instantiated. The Renderer ignores unknown component names.
3. **Query/Mutation allowlist.** Configure the Renderer to only allow `Query()` and `Mutation()` calls to AO's own API routes (`/api/*`). Block external URLs.
4. **CSP headers.** The dashboard's Content-Security-Policy should prevent any injected content from loading external resources.

**Residual risk:** A malicious agent could generate insight cards with misleading content (e.g., "all tests passed" when they didn't). This is a content trust issue, not a code execution issue — the same risk exists with plain-text summaries today.

### Bundle Size Budget

Adding `@openui/react` brings in the lexer, parser, materializer, evaluator, and Zod v4. This needs measurement before committing.

**Budget:** The web dashboard currently loads ~300KB gzipped JS (estimate). The OpenUI addition should not exceed 50KB gzipped (15% increase). If it does, dynamic import is mandatory.

**Mitigation plan:**
1. After adding the dependency, measure with `next build` + bundle analyzer
2. If under 50KB gzipped: static import is fine
3. If over 50KB gzipped: dynamic import (`next/dynamic`) with loading skeleton
4. If over 100KB gzipped: reconsider — the overhead may not justify the feature

```tsx
// Dynamic import path (if bundle too large)
const InsightRenderer = dynamic(
  () => import("@/components/InsightRenderer"),
  { loading: () => <InsightSkeleton />, ssr: false }
);
```

### Offline/Degraded Mode

If the LLM call fails during insight generation, the dashboard must not break.

**Invariant:** Every code path that displays an insight card must have a non-OpenUI fallback. The insight card is a progressive enhancement.

**Degradation chain:**
1. OpenUI insight card renders → show it
2. OpenUI Renderer throws → error boundary catches → show plain-text summary
3. No insight card in metadata → show existing summary string
4. No summary at all → show "No summary available"

The dashboard never depends on OpenUI being available or functional. If `@openui/react` fails to load, the dashboard works exactly as it does today.

### Zod v4 Coexistence Plan

Running Zod v3 and v4 in the same monorepo creates real friction: type confusion, transitive dependency conflicts, and developer confusion about which `z` to import.

**Mitigation:**

1. **Isolate Zod v4 to a single file.** Only `packages/web/src/lib/openui-components.ts` imports from `zod/v4`. No other file in the monorepo touches v4.

2. **Lint rule enforcement.** Add an ESLint rule or a simple grep-based CI check that flags any import of `zod/v4` outside the OpenUI components file:
   ```bash
   # CI check
   if grep -r "from ['\"]zod/v4" --include='*.ts' --include='*.tsx' \
     | grep -v 'openui-components'; then
     echo "ERROR: Zod v4 imports only allowed in openui-components.ts"
     exit 1
   fi
   ```

3. **No Zod v4 types in public interfaces.** The OpenUI component library file exports the `aoLibrary` object and nothing else. No Zod v4 schema types leak into the rest of the codebase.

4. **Package.json isolation.** Add `zod@^4` as a dependency of `@aoagents/ao-web` only, not the root or any other package. Since `@aoagents/ao-core` uses `zod@^3`, pnpm's strict dependency resolution keeps them separate.

5. **Document in CLAUDE.md.** Add a note: "Zod v4 is used exclusively for OpenUI component schemas in `packages/web/src/lib/openui-components.ts`. All other validation uses Zod v3. Do not import from `zod/v4` anywhere else."

---

## 7. Appendix: Compatibility Analysis

### Dependency Compatibility

| Concern | Status | Notes |
|---------|--------|-------|
| React version | Compatible | OpenUI targets React 18+; AO uses React 19 (should work) |
| Next.js | Compatible | OpenUI is client-side only; works in "use client" components |
| Zod version | Managed friction | See [Zod v4 Coexistence Plan](#zod-v4-coexistence-plan) |
| Tailwind | Compatible | OpenUI components can use Tailwind classes |
| Bundle size | Measure first | See [Bundle Size Budget](#bundle-size-budget) |
| SSR | N/A | OpenUI is client-only; AO already uses "use client" for interactive components |

### Performance Considerations

| Concern | Mitigation |
|---------|------------|
| LLM cost per insight card | One call per completed session, cached forever. No recurring cost. |
| LLM latency | Generate asynchronously post-completion. User never waits for generation. |
| Streaming parser overhead | OpenUI's parser is optimized for streaming; should be fine for cached content |
| Multiple Renderers on page | Lazy-load Renderer; only mount when panel is expanded |
| Bundle size | Dynamic import if over 50KB gzipped (see budget above) |

### Design System Integration

OpenUI components must match AO's design system:
- Use `var(--color-*)` tokens from globals.css
- JetBrains Mono for data, Geist Sans for body text
- 0px border radius (no rounded corners)
- 2px accent borders
- Spring-like easing for transitions
- 44px minimum touch targets
- Dark theme as default

This means **custom components**, not OpenUI's defaults. The component library IS the integration — each component renders with AO's visual language.

### Alternatives Considered

| Alternative | Verdict |
|------------|---------|
| Static React components | Better for structured/predictable data (analytics, active session monitoring). Worse for variable agent output (insight cards). |
| Markdown rendering | No interactivity; can't expand/collapse, filter, or navigate. Acceptable fallback. |
| JSON → React mapping | Rigid schema; LLM must produce exact JSON; no compositional flexibility. |
| Chart library (Recharts/Nivo) | Better for analytics. Use this for structured data, OpenUI for variable narrative data. |
| Custom DSL | Reinventing what OpenUI already solves; maintenance burden. |

**Bottom line:** OpenUI's unique value for AO is surfacing variable agent output (decisions, trade-offs, file changes, test results) as interactive, navigable components. For structured data (analytics, live session state), use standard React components and chart libraries. Don't force OpenUI where static components are simpler and better.
