# OpenUI Integration Research for Agent Orchestrator

## Table of Contents

1. [What OpenUI Is and How It Works](#1-what-openui-is-and-how-it-works)
2. [Integration Opportunities (Ranked by Impact)](#2-integration-opportunities-ranked-by-impact)
3. [Technical Architecture for Each Integration](#3-technical-architecture-for-each-integration)
4. [Required Changes](#4-required-changes)
5. [Recommended Starting Point](#5-recommended-starting-point)
6. [Appendix: Compatibility Analysis](#6-appendix-compatibility-analysis)

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

- **Zod v4 required** — AO uses Zod v3 for config validation. The two can coexist but need separate imports.
- **No WebSocket/push support** — Query() polls REST endpoints; no SSE or WebSocket integration out of the box.
- **Generate-once model** — The generated UI doesn't update reactively from external events (e.g., SSE). Query() can refetch, but there's no push mechanism.
- **Chat-first architecture** — The default UX assumes a chat interface. Standalone Renderer usage is supported but less documented.
- **No server-side rendering** — OpenUI renders client-side only.

---

## 2. Integration Opportunities (Ranked by Impact)

### Opportunity 1: Agent-Generated Insight Cards (Impact: HIGH, Feasibility: MEDIUM)

**The Problem:** Agent sessions produce a wall of terminal output. Users can't quickly understand what an agent did, what decisions it made, or what trade-offs it considered. The `summary` field is a single string.

**The Idea:** Agents use OpenUI to generate rich, structured insight cards about their own work. Instead of writing a plain-text summary, the agent outputs OpenUI Lang that renders as an interactive component:

- **Architecture decision cards** — "I chose Strategy A over Strategy B because..." with expandable reasoning
- **File change summaries** — Interactive diff viewer showing what changed and why
- **Test result dashboards** — Which tests passed/failed/were added, with drill-down
- **Dependency impact maps** — "Changing X affected Y and Z" with visual connections

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
│  Cost: $0.47 │ Duration: 12m │ Commits: 3      │
└─────────────────────────────────────────────────┘
```

**Why OpenUI fits:** The agent already has an LLM — it just needs the OpenUI component library in its context and instructions to output OpenUI Lang alongside its work summary. The dashboard embeds a `<Renderer>` to display the result. Each agent session's insight card is unique because the LLM generates it based on what actually happened.

---

### Opportunity 2: Interactive Session Timeline (Impact: HIGH, Feasibility: MEDIUM)

**The Problem:** The dashboard shows session state (working/pending/done) but not the journey. There's no timeline of "spawned → analyzed issue → created branch → wrote code → ran tests → tests failed → fixed → PR created → CI passed → merged."

**The Idea:** Build an OpenUI component library for timeline visualization. The lifecycle manager already tracks state transitions — feed them to an LLM that generates an annotated, interactive timeline using OpenUI components.

**Key components in the library:**

| Component | Purpose |
|-----------|---------|
| `Timeline` | Container with vertical/horizontal layout |
| `TimelineEvent` | Single event with timestamp, icon, description |
| `EventDetail` | Expandable detail panel for an event |
| `CodeBlock` | Syntax-highlighted code snippet |
| `DiffView` | Side-by-side or unified diff display |
| `MetricBar` | Visual metric (cost, duration, token usage) |
| `DecisionTree` | Branching visualization for agent decisions |

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
10:41 ✓ Tests passed — 14/14
  │
10:42 ● PR created — #456 "fix: sliding-window token refresh"
  │    [▸ PR description] [▸ Review readiness]
  │
10:55 ✓ CI passed — all checks green
  │
11:02 ✓ Merged — approved by @reviewer
```

**Why OpenUI fits:** Timelines are inherently variable — some sessions have 5 events, others have 50. Some need code snippets, others need decision trees. An LLM generating the timeline from structured event data produces contextually appropriate visualizations every time, rather than a rigid template that shows the same layout regardless of content.

---

### Opportunity 3: Agent Copilot Panel (Impact: HIGH, Feasibility: HARD)

**The Problem:** Users interact with agents through a raw terminal or quick-reply buttons. There's no way to ask "what are you working on?" or "why did you choose this approach?" without interrupting the agent's flow.

**The Idea:** An OpenUI-powered copilot panel alongside the terminal. Users type natural-language questions about the session, and the LLM generates interactive UI responses using session context:

- "Show me what files you changed" → Renders an interactive file tree with diff previews
- "Why did CI fail?" → Renders a failure analysis card with logs and suggested fixes
- "Compare your approach to the other agent working on this" → Renders a side-by-side comparison
- "What's left to do?" → Renders a checklist with completion percentages

**Key distinction from a chatbot:** The responses are interactive UIs, not text. The file tree is expandable. The diff is navigable. The checklist has progress bars. The comparison has toggle views. All generated on-the-fly by the LLM using OpenUI components.

**What it looks like:**

```
┌──────────── Terminal ────────────┐┌─────── Copilot ──────────┐
│ $ claude --resume session-abc    ││                           │
│ Analyzing auth middleware...     ││ You: "What did you change │
│ Reading src/auth/refresh.ts      ││       and why?"           │
│ ...                              ││                           │
│                                  ││ ┌── Changes ───────────┐ │
│                                  ││ │ ▸ src/auth/refresh.ts │ │
│                                  ││ │   +sliding window     │ │
│                                  ││ │   -fixed expiry       │ │
│                                  ││ │ ▸ src/auth/types.ts   │ │
│                                  ││ │   +RefreshConfig type │ │
│                                  ││ └──────────────────────┘ │
│                                  ││                           │
│                                  ││ Rationale: The existing   │
│                                  ││ fixed-expiry approach...  │
│                                  ││ [▸ Full reasoning]        │
└──────────────────────────────────┘└───────────────────────────┘
```

**Why OpenUI fits:** This is OpenUI's sweet spot — natural-language queries producing interactive UIs. The component library defines the building blocks; the LLM composes them based on what the user asks. No two responses look the same because they're generated from actual session context.

---

### Opportunity 4: On-Demand Analytics Dashboards (Impact: MEDIUM, Feasibility: EASY)

**The Problem:** The dashboard shows individual session status but lacks aggregate analytics — success rates, cost trends, time-to-merge distributions, failure patterns, agent performance comparisons.

**The Idea:** A "Generate Report" button that sends session data to an LLM, which produces an OpenUI-powered analytics dashboard. The user can ask for specific analyses:

- "Show me agent performance this week" → Bar charts, trend lines, percentile distributions
- "Which types of issues take longest?" → Category breakdown with drill-down
- "Compare Claude Code vs Codex on our repo" → Side-by-side metrics
- "What are the most common failure modes?" → Categorized failure analysis

**Why OpenUI fits:** Analytics requirements change constantly. Building static dashboards for every possible question is impractical. OpenUI lets the LLM generate the right visualization for the right question, using components designed for data display (charts, tables, metric cards).

**Feasibility: EASY** because this is a standalone feature — it doesn't touch the existing dashboard's real-time data flow. It reads session data via API, sends it to an LLM with the OpenUI library, and renders the result in an overlay/modal.

---

### Opportunity 5: PR Review Preparation View (Impact: MEDIUM, Feasibility: MEDIUM)

**The Problem:** When a PR is ready for review, the reviewer sees raw GitHub diffs. There's no agent-generated context about what changed, why, what alternatives were considered, and what the reviewer should pay special attention to.

**The Idea:** The agent generates an OpenUI-powered "review briefing" that renders in the dashboard:

- **Change narrative** — A structured walkthrough of the changes, file by file, explaining intent
- **Risk assessment** — Which changes are mechanical (renames, formatting) vs. behavioral
- **Test coverage map** — Which new/modified code has test coverage, which doesn't
- **Attention markers** — "Pay extra attention to lines 45-67 in refresh.ts — this is the core logic change"
- **Rollback plan** — If this breaks, here's what to revert and why

**What it looks like:**

```
┌─── Review Briefing: PR #456 ─────────────────────┐
│                                                    │
│  Summary: Replaced fixed-expiry token refresh      │
│  with sliding-window approach                      │
│                                                    │
│  Risk: LOW ■■□□□                                   │
│  Confidence: HIGH ■■■■□                            │
│                                                    │
│  ┌─── Change Walkthrough ──────────────────────┐   │
│  │ 1. src/auth/refresh.ts (core change)        │   │
│  │    What: New RefreshManager class            │   │
│  │    Why: Existing refresh() was stateless     │   │
│  │    ⚠ Attention: Error handling in L45-67     │   │
│  │    [▸ View annotated diff]                   │   │
│  │                                              │   │
│  │ 2. src/auth/middleware.ts (wiring)           │   │
│  │    What: Import new RefreshManager           │   │
│  │    Risk: NONE (mechanical)                   │   │
│  │    [▸ View diff]                             │   │
│  └──────────────────────────────────────────────┘   │
│                                                    │
│  Test Coverage: 94% of changed lines               │
│  Uncovered: L52-54 in refresh.ts [▸ Details]       │
└────────────────────────────────────────────────────┘
```

---

### Opportunity 6: Schema/Architecture Visualization (Impact: MEDIUM, Feasibility: MEDIUM)

**The Problem:** When agents work on database migrations, API changes, or architectural refactors, the impact is hard to visualize from diffs alone.

**The Idea:** Agents generate OpenUI-powered interactive diagrams:

- **Schema diff views** — Before/after database schema with highlighted changes
- **API endpoint maps** — Which endpoints changed, new parameters, breaking changes
- **Dependency graphs** — How the changed module connects to the rest of the system
- **State machine diagrams** — For lifecycle/state changes, show the before/after state machine

**Why OpenUI fits:** These visualizations are inherently contextual — the right diagram depends on what changed. An LLM generating the visualization from actual code context produces more useful diagrams than a generic static tool.

---

### Opportunity 7: Multi-Agent Comparison View (Impact: MEDIUM, Feasibility: HARD)

**The Problem:** AO can spawn multiple agents on the same issue (or related issues). There's no way to compare their approaches, trade-offs, or outcomes side by side.

**The Idea:** An OpenUI-powered comparison view that analyzes multiple sessions and renders:

- **Approach comparison** — How each agent interpreted the task differently
- **Code diff between agents** — What each agent changed, overlaps and divergences
- **Decision divergence points** — Where agents made different choices, and what reasoning drove each
- **Performance metrics** — Time, cost, code quality, test coverage per agent
- **Recommendation** — Which approach is better and why (generated by a meta-LLM reviewing both)

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
    │
    ▼
Dashboard: SessionCard.tsx / SessionDetail.tsx
    │ Embeds <Renderer library={aoLibrary} code={insightCode} />
    │ Renders inside an expandable panel
    │
    ▼
User sees interactive insight card
```

**Component library needed:**

```typescript
// packages/web/src/lib/openui-components.ts
import { defineComponent, createLibrary } from "@openui/react";
import { z } from "zod/v4"; // Zod v4 for OpenUI

export const DecisionCard = defineComponent({
  name: "DecisionCard",
  props: z.object({
    title: z.string(),
    chosen: z.string(),
    alternatives: z.array(z.string()).optional(),
    reasoning: z.string(),
  }),
  render: ({ title, chosen, alternatives, reasoning }) => (
    // Render with AO design tokens
  ),
});

export const FileChangeList = defineComponent({ ... });
export const MetricRow = defineComponent({ ... });
export const TestSummary = defineComponent({ ... });

export const aoLibrary = createLibrary([
  DecisionCard, FileChangeList, MetricRow, TestSummary, ...
]);
```

**Changes required:**

| Component | Change | Effort |
|-----------|--------|--------|
| Agent plugins | Add post-completion insight generation step | Medium |
| Session metadata | Store OpenUI Lang strings (already supports arbitrary strings) | Low |
| API routes | New `/api/sessions/[id]/insight` endpoint | Low |
| Dashboard | Add `<Renderer>` integration to SessionCard/SessionDetail | Medium |
| New package | `packages/web/src/lib/openui-components.ts` | Medium |
| Dependencies | Add `@openui/react` to web package | Low |

### Architecture B: Interactive Timeline (Opportunity 2)

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
API Route: GET /api/sessions/[id]/timeline
    │ Reads event log, sends to LLM with timeline component library
    │ Returns generated OpenUI Lang
    │
    ▼
Dashboard: New TimelineView component
    │ <Renderer library={timelineLibrary} code={timelineCode} />
    │
    ▼
User sees interactive session timeline
```

**Changes required:**

| Component | Change | Effort |
|-----------|--------|--------|
| Lifecycle manager | Emit structured events to JSONL log | Medium |
| Core types | Define `SessionEvent` type | Low |
| Session manager | Read/write event log | Low |
| API routes | New `/api/sessions/[id]/timeline` endpoint | Medium |
| Dashboard | New `TimelineView.tsx` component | Medium |
| OpenUI library | Timeline-specific components | Medium |

### Architecture C: Copilot Panel (Opportunity 3)

```
User types question in Copilot panel
    │
    ▼
API Route: POST /api/copilot/ask
    │ Receives: { sessionId, question }
    │ Gathers: session metadata, recent events, terminal output, PR data
    │ Sends to LLM with: context + question + AO component library prompt
    │ Returns: OpenUI Lang stream
    │
    ▼
Dashboard: CopilotPanel.tsx
    │ Streaming <Renderer> that builds UI incrementally
    │ Alongside DirectTerminal
    │
    ▼
User sees interactive answer
```

**This is the most complex integration** because it requires:
1. A context-gathering pipeline (session data, terminal history, git state)
2. A streaming LLM call from the API route
3. A streaming Renderer on the client
4. Layout changes to accommodate the panel alongside the terminal

### Architecture D: On-Demand Analytics (Opportunity 4)

```
User clicks "Generate Report" or types a question
    │
    ▼
API Route: POST /api/analytics/generate
    │ Gathers: all session data, PR metrics, activity history
    │ Sends to LLM with: data + question + analytics component library
    │ Returns: OpenUI Lang
    │
    ▼
Dashboard: AnalyticsPanel.tsx (modal/overlay)
    │ <Renderer library={analyticsLibrary} code={reportCode} />
    │
    ▼
User sees custom analytics dashboard
```

**Simplest integration** — it's a standalone modal that doesn't touch existing data flows.

---

## 4. Required Changes

### Changes to OpenUI

| Change | Why | Effort |
|--------|-----|--------|
| SSE/push support in runtime | AO's real-time updates use SSE; OpenUI's Query() only supports REST polling | Hard |
| Dark theme support in Renderer | AO uses a custom dark theme; Renderer needs to inherit CSS custom properties | Medium |
| Standalone Renderer documentation | Currently under-documented for non-chat usage | Low |
| Zod v3 compatibility layer (optional) | Allow component schemas to use Zod v3 alongside v4 | Medium |
| Streaming Renderer improvements | Better incremental rendering for large generated UIs | Medium |

### Changes to Agent Orchestrator

| Change | Why | Priority | Effort |
|--------|-----|----------|--------|
| Add `@openui/react` dependency to web package | Core integration dependency | P0 | Low |
| Create AO OpenUI component library | Define components matching AO's design system | P0 | Medium |
| Add session event logging to lifecycle manager | Structured event data for timelines | P1 | Medium |
| Add insight generation to agent plugins | Agents produce OpenUI Lang summaries | P1 | Medium |
| New API routes for insight/timeline/analytics | Serve OpenUI data to dashboard | P1 | Medium |
| Dashboard layout changes for new panels | Accommodate Renderer alongside existing UI | P2 | Medium |
| Copilot context-gathering pipeline | Aggregate session data for copilot queries | P2 | Hard |
| LLM integration in API routes | Send context to LLM, get OpenUI Lang back | P1 | Medium |

---

## 5. Recommended Starting Point

### Phase 1: On-Demand Analytics (2-3 days)

**Why start here:**
- Lowest risk — it's a standalone modal, no changes to existing dashboard
- Highest "wow factor" — users immediately see the power of generated UIs
- Validates the integration path — proves OpenUI works with AO's design system
- No agent plugin changes needed — works with existing session data

**Steps:**
1. Add `@openui/react` to `packages/web/`
2. Create analytics component library (MetricCard, BarChart, Table, TrendLine, ComparisonGrid)
3. Style components with AO's CSS custom properties
4. Create `POST /api/analytics/generate` route
5. Create `AnalyticsModal.tsx` with Renderer
6. Add "Generate Report" button to Dashboard.tsx
7. Wire up an LLM API call (Claude API) in the route

### Phase 2: Agent Insight Cards (1 week)

**Build on Phase 1's component library:**
1. Add insight-focused components (DecisionCard, FileChangeList, DiffView, TestSummary)
2. Add insight generation as a post-completion step in agent plugins
3. Store generated OpenUI code in session metadata
4. Create `/api/sessions/[id]/insight` route
5. Add expandable insight panel to SessionCard.tsx

### Phase 3: Interactive Timeline (1-2 weeks)

**Requires core changes:**
1. Add structured event logging to lifecycle manager
2. Define SessionEvent type in core
3. Create timeline component library
4. Create `/api/sessions/[id]/timeline` route with LLM generation
5. Create TimelineView.tsx component
6. Integrate into SessionDetail.tsx

### Phase 4: Copilot Panel (2-3 weeks)

**Most complex, save for last:**
1. Build context-gathering pipeline
2. Create streaming LLM endpoint
3. Build CopilotPanel.tsx with streaming Renderer
4. Layout changes for terminal + copilot side-by-side
5. History management for copilot conversations

---

## 6. Appendix: Compatibility Analysis

### Dependency Compatibility

| Concern | Status | Notes |
|---------|--------|-------|
| React version | Compatible | OpenUI targets React 18+; AO uses React 19 (should work) |
| Next.js | Compatible | OpenUI is client-side only; works in "use client" components |
| Zod version | Friction | OpenUI requires Zod v4; AO uses Zod v3. Can coexist with separate imports |
| Tailwind | Compatible | OpenUI components can use Tailwind classes |
| Bundle size | Monitor | OpenUI adds lexer/parser/evaluator; measure impact |
| SSR | N/A | OpenUI is client-only; AO already uses "use client" for interactive components |

### Performance Considerations

| Concern | Mitigation |
|---------|------------|
| LLM latency for generation | Cache generated OpenUI code in session metadata; regenerate only on request |
| Streaming parser overhead | OpenUI's parser is optimized for streaming; should be fine |
| Multiple Renderers on page | Lazy-load Renderer; only mount when panel is expanded |
| Bundle size | Dynamic import `@openui/react` only in components that use it |

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

| Alternative | Why OpenUI is better for AO |
|------------|---------------------------|
| Static React components | Can't adapt to variable agent output; need pre-built components for every scenario |
| Markdown rendering | No interactivity; can't expand/collapse, filter, or navigate |
| JSON → React mapping | Rigid schema; LLM must produce exact JSON; no compositional flexibility |
| iframe-based widgets | Poor integration with dashboard theme/layout; cross-origin issues |
| Custom DSL | Reinventing what OpenUI already solves; maintenance burden |

**OpenUI's unique value proposition for AO:** Agent sessions are inherently variable — different issues, different approaches, different outcomes. A framework that lets LLMs generate contextually appropriate UIs from a component library is exactly what's needed to surface this variability in a structured, interactive way.
