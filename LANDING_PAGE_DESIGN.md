# Agent Orchestrator — Landing Page Design Specification

> **Aesthetic Direction:** "Mission Control Terminal" — A premium dark interface that feels like you're looking at a spacecraft's command center. Not retro-terminal kitsch, but a *refined* terminal aesthetic where every pixel of negative space, every glow, every animation communicates precision and power. Think: if Linear designed a hacking tool.

---

## 1. Architecture & Technology Choices

### Rendering Stack Decision

| Approach | Verdict | Rationale |
|----------|---------|-----------|
| **Three.js / WebGL** | **NO** — not needed | Terminal aesthetics are inherently 2D (text, grids, lines). Forcing 3D models of "terminals" would feel gimmicky. The cognitive load doesn't justify the visual gain. |
| **Blender 3D models** | **NO** | Pre-rendered 3D assets are heavy, hard to animate responsively, and fight the monospace grid aesthetic. |
| **CSS 3D transforms** | **YES** — for depth | `perspective` + `rotateX/Y` on terminal cards creates convincing parallax depth without a WebGL context. Composited by GPU, zero library overhead. |
| **Canvas 2D** | **YES** — for the orchestration graph | The "agents connected to orchestrator" visualization needs dynamic particles, bezier curves, and real-time state updates. Canvas 2D is perfect. |
| **SVG** | **YES** — for the state machine diagram | The lifecycle flow (`spawning → working → merged`) is a directed graph. SVG gives crisp vector rendering with scroll-driven path animation (`stroke-dashoffset`). |
| **anime.js v4** | **YES** — primary animation engine | 24KB, scroll observer built-in, stagger system for grid effects, spring physics. No GSAP license concerns. Lighter than Framer Motion for a static site. |

### Tech Stack

```
Framework:      Next.js 15 (App Router, static export for CDN)
Animation:      anime.js v4 (Scroll Observer + Timeline + Stagger)
Canvas:         Vanilla Canvas 2D (orchestration graph)
Styling:        Tailwind CSS v4 + CSS custom properties
Typography:     Variable fonts (self-hosted, no Google Fonts latency)
Deployment:     Vercel Edge (automatic image optimization, CDN)
Bundle target:  < 150KB JS (gzipped), < 3s LCP on 4G
```

### Why NOT Three.js

The terminal metaphor is powerful precisely because it's **flat and textual**. The "3D feel" comes from:
1. **Layered depth** — overlapping terminal panels at different z-depths via CSS `translateZ`
2. **Perspective parallax** — mouse-tracked rotation on hero cards (pure CSS + 20 lines of JS)
3. **Canvas particle field** — floating dots/lines connecting agents (lightweight, 2D)
4. **Glow and light bleed** — `box-shadow` with large spread + blur simulates volumetric lighting

This approach delivers 90% of the visual impact of a Three.js scene at 5% of the bundle cost and complexity.

---

## 2. Design Tokens & Color System

### Palette: "Phosphor Dark"

Inspired by CRT phosphor glow — not the cliche green-on-black, but a refined system with **cyan as the primary accent** (signals intelligence/precision) and **amber for warnings/activity**.

```css
:root {
  /* Backgrounds — layered darkness */
  --bg-void:        #09090b;     /* deepest black (page bg) */
  --bg-surface:     #0f0f12;     /* card/panel bg */
  --bg-elevated:    #16161a;     /* hover states, raised panels */
  --bg-terminal:    #0a0a0f;     /* inside terminal blocks */
  
  /* Borders & Lines */
  --border-subtle:  #1e1e24;     /* barely visible structure */
  --border-default: #2a2a32;     /* standard borders */
  --border-bright:  #3a3a44;     /* emphasized borders */
  
  /* Text hierarchy */
  --text-primary:   #e8e8ed;     /* headings, primary content */
  --text-secondary: #8b8b96;     /* body text, descriptions */
  --text-muted:     #4a4a55;     /* labels, timestamps */
  --text-ghost:     #2a2a32;     /* decorative text, line numbers */
  
  /* Accent: Cyan (primary — "signal") */
  --cyan-50:        #ecfeff;
  --cyan-400:       #22d3ee;
  --cyan-500:       #06b6d4;
  --cyan-600:       #0891b2;
  --cyan-glow:      rgba(6, 182, 212, 0.15);   /* background glow */
  --cyan-flare:     rgba(34, 211, 238, 0.4);   /* intense glow */
  
  /* Accent: Amber (secondary — "activity/energy") */
  --amber-400:      #fbbf24;
  --amber-500:      #f59e0b;
  --amber-glow:     rgba(251, 191, 36, 0.12);
  
  /* Accent: Emerald (tertiary — "success/merged") */
  --emerald-400:    #34d399;
  --emerald-500:    #10b981;
  --emerald-glow:   rgba(16, 185, 129, 0.12);
  
  /* Accent: Rose (error/ci_failed) */
  --rose-400:       #fb7185;
  --rose-500:       #f43f5e;
  --rose-glow:      rgba(244, 63, 94, 0.12);
  
  /* Special effects */
  --scanline:       rgba(255, 255, 255, 0.015); /* subtle CRT scanline overlay */
  --noise-opacity:  0.02;                        /* film grain intensity */
  --glow-spread:    80px;                        /* how far glow bleeds */
}
```

### Glow System

Every accent color has a corresponding glow treatment — a large, soft `box-shadow` or `radial-gradient` that bleeds into surrounding space:

```css
.glow-cyan {
  box-shadow: 
    0 0 20px var(--cyan-glow),
    0 0 60px var(--cyan-glow),
    inset 0 0 20px var(--cyan-glow);
}

/* Ambient light bleed behind sections */
.ambient-glow::before {
  content: '';
  position: absolute;
  width: 600px;
  height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--cyan-flare) 0%, transparent 70%);
  filter: blur(80px);
  opacity: 0.3;
}
```

---

## 3. Typography System

### Font Stack

| Role | Font | Weight | Rationale |
|------|------|--------|-----------|
| **Display** | **JetBrains Mono** (variable) | 700–800 | Premium monospace with coding ligatures. Recognizable to developers. The "brand face" of the terminal. |
| **Body** | **Geist** (variable) | 300–500 | Vercel's font — geometric, modern, pairs beautifully with monospace. Reads well at small sizes. |
| **Code/Terminal** | **JetBrains Mono** | 400 | Consistent with display; coding ligatures make CLI output look premium. |
| **Labels/UI** | **Geist Mono** | 400–500 | For small UI elements that need monospace but aren't "code" (timestamps, counts). |

### Type Scale

```css
--text-xs:    0.75rem;    /* 12px — timestamps, line numbers */
--text-sm:    0.875rem;   /* 14px — labels, secondary */
--text-base:  1rem;       /* 16px — body */
--text-lg:    1.125rem;   /* 18px — lead paragraphs */
--text-xl:    1.25rem;    /* 20px — section intros */
--text-2xl:   1.5rem;     /* 24px — subsection heads */
--text-3xl:   1.875rem;   /* 30px — section heads */
--text-4xl:   2.25rem;    /* 36px — major heads */
--text-5xl:   3rem;       /* 48px — hero subhead */
--text-hero:  4.5rem;     /* 72px — hero headline (clamp responsive) */
```

### Typography Rules

- Headlines: JetBrains Mono, uppercase tracking `0.05em`, `text-primary`
- Subheads: Geist, weight 300, `text-secondary`, generous `line-height: 1.6`
- Terminal blocks: JetBrains Mono 14px, `line-height: 1.7`, colored syntax
- **No italics** — monospace italics look bad. Use color/weight for emphasis.
- Letter-spacing on uppercase text: `0.08em` (prevents crowding)

---

## 4. Section-by-Section Breakdown

### Overview

```
┌─────────────────────────────────────────────────┐
│  [Nav]  Logo · Features · Docs · GitHub · CTA   │
├─────────────────────────────────────────────────┤
│  [Hero]  CLI typing + Orchestration Canvas       │  100vh
├─────────────────────────────────────────────────┤
│  [Social Proof]  "Trusted by" logos/stats        │  auto
├─────────────────────────────────────────────────┤
│  [Feature: Parallel Agents]  Terminal grid       │  100vh
├─────────────────────────────────────────────────┤
│  [Feature: Lifecycle]  State machine SVG         │  100vh
├─────────────────────────────────────────────────┤
│  [Feature: Plugin System]  8-slot grid           │  100vh
├─────────────────────────────────────────────────┤
│  [Feature: Dashboard]  Screenshot/mockup         │  100vh
├─────────────────────────────────────────────────┤
│  [How It Works]  3-step CLI flow                 │  auto
├─────────────────────────────────────────────────┤
│  [CTA / Footer]  Install command + links         │  auto
└─────────────────────────────────────────────────┘
```

---

### Section 1: Navigation

**Layout:** Fixed top, glass-morphism on scroll (`backdrop-filter: blur(12px)`, `bg-void/80`).

**Content:**
- Left: AO logo (monospace logotype: `ao_` with blinking cursor)
- Center: Features · Docs · Pricing · GitHub
- Right: `npm i -g @aoagents/ao` (copyable) + "Get Started" button

**Animation:** Nav background transitions from fully transparent (hero) to glass-blur (on scroll past hero). Links have underline-grow-from-center hover.

---

### Section 2: Hero (The Money Shot)

**Concept:** Split layout — left side shows the CLI command being typed, right side shows a **live canvas visualization** of agents spawning and working.

**Left Panel — The Terminal:**
```
┌──────────────────────────────────────────┐
│ ~/project $ ao spawn --issue 42 ▊        │  ← typing animation
│                                          │
│ ✓ Spawning agent: claude-code            │  ← staggered reveal
│ ✓ Spawning agent: codex                  │
│ ✓ Spawning agent: aider                  │
│                                          │
│ ◉ 3 agents working in parallel           │  ← pulsing dot
│ ├─ claude-code  [████████░░] PR #47      │  ← animated progress
│ ├─ codex        [██████░░░░] working...  │
│ └─ aider        [████░░░░░░] spawning    │
│                                          │
│ ~/project $                              │
└──────────────────────────────────────────┘
```

**Implementation:**
- Real `<pre>` block with syntax-highlighted text
- anime.js timeline for typing effect (40ms per char, natural variance ±15ms)
- Each line fades in with `translateY(8px)` → `translateY(0)` + `opacity: 0 → 1`
- Progress bars animate with CSS `width` transition (staggered 200ms)
- Blinking cursor: CSS `animation: blink 1s step-end infinite`
- Terminal border: 1px `--border-default` with `--cyan-glow` box-shadow on hover

**Right Panel — Orchestration Canvas:**

A `<canvas>` element showing:
- Center node: AO orchestrator (larger, pulsing cyan ring)
- Orbiting nodes: 3–5 agent instances (smaller circles with agent-type colors)
- Connection lines: Bezier curves from center to agents (animated dash pattern)
- Particle trail: Small dots flowing along the curves (direction = data flow)
- State indicators: Nodes change color based on lifecycle state (auto-cycling demo)

**Canvas Technical Spec:**
```javascript
// ~150 lines of vanilla Canvas 2D
// No library needed — simple particle system

const nodes = [
  { type: 'orchestrator', x: center, y: center, radius: 24, color: cyan },
  { type: 'agent', label: 'claude-code', angle: 0, orbitRadius: 140 },
  { type: 'agent', label: 'codex', angle: 2.09, orbitRadius: 140 },
  { type: 'agent', label: 'aider', angle: 4.19, orbitRadius: 140 },
];

// Animation loop: 60fps, requestAnimationFrame
// - Nodes gently oscillate on orbit (sine wave, 0.3px amplitude)
// - Particles flow along bezier curves (pool of 30 particles, recycled)
// - State changes every 3s (cycling through lifecycle demo)
// - Mouse proximity increases glow intensity (subtle interactivity)
```

**Hero Headline (above terminal):**
```
ORCHESTRATE
YOUR AGENTS.
```
- JetBrains Mono, 72px (clamped: `clamp(2.5rem, 6vw, 4.5rem)`)
- Weight 800, `text-primary`
- Subtle `text-shadow: 0 0 40px var(--cyan-glow)`
- Staggered word reveal on load (anime.js `stagger(100)`)

**Hero Subhead:**
```
Spawn parallel AI agents. Each gets its own branch, its own PR,
its own mind. You just watch the dashboard.
```
- Geist, 18px, weight 300, `text-secondary`, max-width 520px

**CTA Buttons:**
- Primary: "Get Started" → filled cyan, white text
- Secondary: `npm i -g @aoagents/ao` → outlined, monospace, copy-on-click

---

### Section 3: Social Proof Bar

**Layout:** Horizontal scroll on mobile, centered row on desktop.

**Content:** 
- "Trusted by teams shipping with AI" (muted text)
- Logo row or metrics: "500+ sessions spawned" · "12 agent types" · "8 plugin slots"

**Animation:** Fade-in on scroll entry, numbers count up (anime.js `round: 1` on targets).

---

### Section 4: Feature — Parallel Agents

**Concept:** A grid of 4 terminal windows, each showing a different agent working simultaneously. As you scroll, they "come alive" one by one.

**Layout:**
```
┌─────────────┐  ┌─────────────┐
│ claude-code │  │   codex     │    ← 2x2 grid with CSS perspective
│ [working]   │  │ [pr_open]   │    ← slight rotateX(-2deg) for depth
└─────────────┘  └─────────────┘
┌─────────────┐  ┌─────────────┐
│   aider     │  │  opencode   │
│ [spawning]  │  │ [merged ✓]  │
└─────────────┘  └─────────────┘
```

**3D Effect (CSS only):**
```css
.agent-grid {
  perspective: 1200px;
  transform-style: preserve-3d;
}

.terminal-card {
  transform: rotateX(-2deg) rotateY(1deg);
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.terminal-card:hover {
  transform: rotateX(0) rotateY(0) translateZ(20px);
}
```

**Inside each terminal card:**
- Agent name + status badge (colored dot)
- 3–4 lines of simulated output (typing animation triggered by scroll)
- Glowing border color matches agent state (cyan=working, emerald=merged, rose=failed)

**Scroll Animation (anime.js Scroll Observer):**
- Cards start at `opacity: 0, translateY(40px), rotateX(-5deg)`
- Stagger in: 150ms between each card
- On full visibility: terminal output starts "typing"

**Section headline:** `ONE COMMAND. PARALLEL EXECUTION.`

---

### Section 5: Feature — Session Lifecycle

**Concept:** An animated SVG state machine diagram that draws itself as you scroll through it.

**Visual:**
```
    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │ spawning │────▶│ working  │────▶│ pr_open  │
    └──────────┘     └──────────┘     └────┬─────┘
                                           │
                          ┌────────────────┼────────────────┐
                          ▼                ▼                ▼
                    ┌──────────┐    ┌──────────┐    ┌──────────┐
                    │ ci_failed│    │  review  │    │ approved │
                    └────┬─────┘    └────┬─────┘    └────┬─────┘
                         │               │               │
                         └───────────────┼───────────────┘
                                         ▼
                                   ┌──────────┐
                                   │  merged  │
                                   └────┬─────┘
                                        ▼
                                   ┌──────────┐
                                   │   done   │
                                   └──────────┘
```

**Animation approach:**
- SVG `<path>` elements with `stroke-dasharray` = total length
- `stroke-dashoffset` animated from full-length → 0 as scroll progresses
- Each node fades in when its incoming edge reaches it
- Active node gets a pulsing glow ring
- A "current state" indicator (glowing dot) travels along the path

**Scroll mapping:**
```
Scroll 0%   → Only "spawning" visible
Scroll 20%  → Edge draws to "working"
Scroll 40%  → Edge branches to three states
Scroll 60%  → Edges converge to "merged"
Scroll 80%  → Edge to "done", full diagram glowing
Scroll 100% → Celebration state (subtle particle burst)
```

**Section headline:** `AUTONOMOUS FROM SPAWN TO MERGE.`
**Subtext:** "Agents handle CI failures, review comments, and PR management. You intervene only when you want to."

---

### Section 6: Feature — Plugin System

**Concept:** An 8-slot grid showing each plugin type as a "module" that can be swapped. Hover reveals the available implementations.

**Layout:** 4×2 grid of cards, each representing a plugin slot.

**Card design:**
```
┌───────────────────────────┐
│  ⬡  Runtime               │  ← icon + slot name
│                           │
│  tmux · process           │  ← available plugins (muted)
│                           │
│  [■ tmux]                 │  ← "active" indicator
└───────────────────────────┘
```

**Interaction:**
- On hover: card lifts (`translateZ(8px)`), border glows cyan
- Active plugin badge pulses subtly
- Cards stagger in from bottom-left to top-right

**Section headline:** `PLUG IN. SWAP OUT. SHIP.`
**Subtext:** "8 extension points. Mix and match runtimes, agents, trackers, and notifiers."

---

### Section 7: Feature — Dashboard Preview

**Concept:** A browser-frame mockup showing the AO dashboard (Kanban board with terminal attachment).

**Implementation:**
- Screenshot or live-rendered mockup of the dashboard
- Wrapped in a "browser chrome" frame (dots + address bar)
- Subtle perspective tilt: `rotateX(-4deg)` with large `perspective`
- On scroll: rotates to flat (0deg), "zooming in" feeling
- Ambient glow behind the frame (large blurred cyan gradient)

**Animation:**
- Dashboard enters from below with `translateY(60px)` → 0
- Simultaneously rotates from `-4deg` → `0deg`
- After settling: session cards inside animate their status badges (color cycling)

**Section headline:** `SEE EVERYTHING. CONTROL ANYTHING.`

---

### Section 8: How It Works

**Concept:** 3-step CLI flow with numbered steps and terminal snippets.

```
①  Configure                    ②  Spawn                       ③  Ship
─────────────                   ─────────────                   ─────────────
ao init                         ao spawn --all                  ao merge --ready
→ agent-orchestrator.yaml       → 5 agents start working       → Auto-merges approved PRs
```

**Animation:** Steps reveal left-to-right with connecting lines drawing between them (SVG line + `stroke-dashoffset`).

---

### Section 9: CTA + Footer

**Concept:** Full-width terminal-style CTA.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  $ npm install -g @aoagents/ao                    [⎘]   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Massive monospace install command, centered
- Copy button with "Copied!" feedback animation
- Below: GitHub stars count, Discord link, documentation link
- Footer: minimal links, MIT license badge

---

## 5. Animation Choreography & Scroll Timeline

### Page Load Sequence (0–1200ms)

```
  0ms  — Page bg renders (instant, no flash)
 50ms  — Nav fades in (opacity 0→1, 300ms)
100ms  — Hero headline: word-by-word reveal (stagger 80ms, translateY 20px→0)
400ms  — Hero subhead fades in (opacity, 400ms)
600ms  — Terminal block slides up (translateY 30px→0, 500ms, spring easing)
700ms  — Typing animation begins in terminal (40ms/char)
800ms  — Canvas orchestration graph fades in (opacity, 600ms)
900ms  — CTA buttons fade in (opacity + translateY 10px→0)
1200ms — Canvas particles begin flowing
```

### Scroll-Driven Animations

Using anime.js v4 Scroll Observer:

```javascript
import { createTimeline, stagger } from 'animejs';
import { onScroll } from 'animejs/scroll';

// Each section has its own scroll-linked timeline
onScroll({
  target: '#lifecycle-section',
  enter: 'top 80%',   // start when top hits 80% viewport
  leave: 'bottom 20%', // end when bottom hits 20% viewport
  sync: true,          // progress linked to scroll position
  onUpdate: (progress) => {
    lifecycleTimeline.seek(progress * lifecycleTimeline.duration);
  }
});
```

### Easing Language

| Context | Easing | anime.js notation |
|---------|--------|-------------------|
| Element entry (scroll) | Smooth decelerate | `'outQuint'` |
| Hover lift | Springy | `spring({ stiffness: 300, damping: 20 })` |
| Typing cursor | Step | `'steps(1)'` |
| Progress bars | Linear | `'linear'` |
| Canvas particles | None (manual lerp) | N/A |
| State transitions | Ease in-out | `'inOutQuad'` |

---

## 6. The Orchestration Canvas — Detailed Spec

This is the **hero centerpiece** — a real-time visualization of the AO concept.

### Visual Language

```
          ╭─ ● claude-code [cyan, pulsing]
          │
    ◉ AO ─┼─ ● codex [amber, steady]
          │
          ╰─ ● aider [emerald, pulsing]
```

### Canvas Rendering Details

**Dimensions:** 500×500px logical, rendered at 2x for retina.

**Elements:**
1. **Center node** (AO): 
   - Filled circle, radius 20px, `--cyan-500`
   - Outer ring: 2px stroke, radius 28px, pulsing opacity (0.3→0.8→0.3, 2s loop)
   - Label: "AO" in JetBrains Mono 11px, centered below

2. **Agent nodes** (3–5):
   - Filled circles, radius 10px, agent-specific color
   - Status ring that changes color based on lifecycle state
   - Label below: agent name in 10px monospace
   - Positioned on an elliptical orbit (not circular — adds perspective feel)

3. **Connection lines:**
   - Quadratic bezier curves from center to each agent
   - Dashed stroke: `[4, 4]` pattern
   - Animated dash offset (creates "flowing" effect toward agent)

4. **Particles:**
   - Pool of 30 small circles (radius 2px, white, opacity 0.6)
   - Travel along the bezier curves at varying speeds
   - Represent "data/tasks flowing to agents"
   - Fade in at center, fade out at agent node

5. **Background grid:**
   - Subtle dot grid (2px dots, 30px spacing, opacity 0.05)
   - Gives depth reference without competing

### State Cycling (Demo Mode)

Every 3 seconds, one agent transitions to the next lifecycle state:
```
claude-code: working → pr_open → merged (cycle)
codex:       spawning → working → ci_failed → working → pr_open (cycle)
aider:       working → review_pending → changes_requested → working (cycle)
```

Color mapping:
- `spawning` → muted white
- `working` → cyan (pulsing)
- `pr_open` → amber
- `ci_failed` → rose
- `review_pending` → amber
- `merged` → emerald
- `done` → emerald (then fades)

### Mouse Interactivity

- Mouse position tracked via `mousemove` on canvas
- Nodes within 60px of cursor: scale up 1.3x, glow intensifies
- Connection lines near cursor: opacity increases, particles speed up
- Creates a "reactive field" feel without any library

---

## 7. Performance Budget & Optimization

### Bundle Budget

| Asset | Max Size (gzipped) | Strategy |
|-------|-------------------|----------|
| HTML | 15KB | Static generation, minimal inline styles |
| CSS | 20KB | Tailwind purge, no unused utilities |
| JS (core) | 40KB | anime.js (24KB) + page logic (16KB) |
| JS (canvas) | 8KB | Vanilla, no dependencies |
| Fonts | 80KB | Variable fonts, `font-display: swap`, subset latin |
| Images | 100KB | WebP/AVIF, lazy-loaded below fold |
| **Total** | **~260KB** | Under 300KB hard limit |

### Performance Targets

| Metric | Target | How |
|--------|--------|-----|
| LCP | < 2.0s | Hero headline is text (instant render), no blocking resources |
| FID | < 50ms | No heavy JS on main thread during load |
| CLS | < 0.05 | Font fallback metrics match, explicit image dimensions |
| TTI | < 3.0s | Defer canvas init, anime.js loaded async |

### Optimization Techniques

1. **Font loading:** `<link rel="preload">` for JetBrains Mono variable. CSS `size-adjust` on fallback to prevent CLS.

2. **Canvas deferral:** Orchestration canvas initializes on `requestIdleCallback` or after hero text is visible. Shows a static SVG placeholder until canvas is ready.

3. **Scroll observer thresholds:** anime.js Scroll Observer uses `IntersectionObserver` internally — animations only compute when sections are in/near viewport.

4. **No layout thrash:** All animations use `transform` and `opacity` only (composited properties). No `width`, `height`, `top`, `left` animations.

5. **Canvas optimization:**
   - `will-change: transform` on canvas element
   - Offscreen canvas for double-buffering (if needed)
   - Particle pool (no allocation during animation)
   - `requestAnimationFrame` with visibility check (`document.hidden`)
   - Reduced motion: skip particles, show static connections

6. **Reduced motion support:**
```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; }
  .canvas-container { display: none; }
  .static-fallback { display: block; }
}
```

---

## 8. Asset Requirements

### What Needs to Be Created

| Asset | Type | Creator | Notes |
|-------|------|---------|-------|
| AO logotype | SVG | Designer | Monospace "ao_" with cursor. Simple, scalable. |
| Agent type icons | SVG (×4) | Designer | Minimal line icons for Claude/Codex/Aider/OpenCode |
| Plugin slot icons | SVG (×8) | Designer | Simple geometric icons per slot |
| Dashboard mockup | PNG/WebP | Screenshot | Real dashboard, cropped and polished |
| Orchestration canvas | JS | Developer | ~150 lines vanilla Canvas 2D (spec above) |
| Lifecycle SVG | SVG | Developer | Programmatic SVG with animated paths |
| OG image | PNG 1200×630 | Designer | Terminal-style hero for social sharing |
| Favicon | SVG + ICO | Designer | "ao" monogram, works at 16px |

### What Does NOT Need to Be Created

- No 3D models (no Blender, no GLTF files)
- No Lottie/Rive animation files (too heavy for this aesthetic)
- No video content (canvas replaces any need for video)
- No illustration assets (the terminal IS the illustration)
- No custom WebGL shaders (CSS glow + canvas 2D is sufficient)

---

## 9. Responsive Strategy

### Breakpoints

```css
--bp-sm:  640px;   /* Mobile landscape */
--bp-md:  768px;   /* Tablet */
--bp-lg:  1024px;  /* Desktop */
--bp-xl:  1280px;  /* Large desktop */
```

### Mobile Adaptations

| Section | Desktop | Mobile |
|---------|---------|--------|
| Hero | Split (terminal + canvas) | Stacked (terminal above, canvas below or hidden) |
| Agent grid | 2×2 with perspective | Single column stack, no perspective |
| Lifecycle | Full horizontal SVG | Vertical flow, simplified |
| Plugin grid | 4×2 | 2×4 or accordion |
| Dashboard | Tilted frame | Flat, scrollable screenshot |
| Canvas | 500×500 | 300×300 or replaced with static SVG |

### Mobile Performance

- Canvas disabled below 640px (replaced with static SVG illustration)
- Scroll animations simplified (no stagger, just fade-in)
- Fonts: reduce to 2 weights (400, 700) on mobile

---

## 10. Interaction Micro-Details (The Polish)

These tiny details separate "good" from "award-winning":

1. **Terminal cursor blink** — Exactly 530ms on, 530ms off. Not 500ms (feels robotic). The slight asymmetry feels alive.

2. **Copy button feedback** — On click: button text swaps to "✓ Copied" in emerald, icon rotates 360deg (300ms spring), reverts after 2s.

3. **Code syntax colors** — Inside terminal blocks: commands in `--cyan-400`, flags in `--amber-400`, strings in `--emerald-400`, comments in `--text-muted`.

4. **Hover cursor trails** — On the canvas section only: cursor leaves a faint, quickly-fading trail of 3 dots. Subtle "data flowing from your input" metaphor.

5. **Scanline overlay** — A full-page `::after` pseudo-element with repeating horizontal lines (1px every 4px, `--scanline` opacity). Barely visible but adds CRT texture subconsciously.

6. **Scroll progress indicator** — A thin cyan line at the very top of the viewport showing page scroll progress. 1px height, full width.

7. **Section transitions** — Between major sections: a subtle horizontal rule made of dots (`. . . . . . . .`) in `--text-ghost`, 20px spacing from content.

8. **Noise texture** — A static SVG noise filter overlaid at 2% opacity on the entire page. Adds organic warmth to the digital aesthetic.

---

## 11. Summary: Why This Approach Wins

| Decision | Rationale |
|----------|-----------|
| No Three.js | Terminal ≠ 3D. The aesthetic power comes from typography, glow, and choreography — not polygons. |
| Canvas 2D for hero | Lightweight (8KB), custom, unique. No generic "3D rotating object" that every AI startup uses. |
| CSS 3D transforms | Just enough depth (perspective cards) without the complexity/cost of a WebGL scene. |
| anime.js v4 | 24KB for a full animation system with built-in scroll observer. Replaces GSAP (150KB) + ScrollTrigger. |
| Monospace as hero font | The terminal IS the product. Making the typography feel like code output reinforces the brand at every level. |
| Glow as the "material" | Instead of drop shadows (feels dated) or flat design (feels generic), glow creates the sci-fi command center atmosphere. |

### The One Thing People Will Remember

**The hero orchestration canvas.** Watching those particles flow from the center node to the agents, seeing states change in real-time, creates an instant "I get what this does" moment. It's not a screenshot. It's not a video. It's a living, breathing visualization of your product's core value prop — agents working in parallel while you watch.

---

## 12. Implementation Phases

### Phase 1: Foundation (2–3 days)
- Next.js project setup with Tailwind v4
- Design token system (CSS custom properties)
- Typography + font loading
- Basic page structure with all sections (no animation)
- Nav + footer

### Phase 2: Hero (2–3 days)
- Terminal component with typing animation
- Canvas orchestration visualization
- Hero headline animation (load sequence)
- CTA buttons with copy functionality

### Phase 3: Feature Sections (3–4 days)
- Parallel agents grid with CSS 3D cards
- Lifecycle SVG state machine + scroll animation
- Plugin system grid
- Dashboard mockup section

### Phase 4: Polish (2–3 days)
- Scroll-driven animation choreography (anime.js)
- Micro-interactions (hover, copy, cursor effects)
- Scanline/noise overlays
- Reduced motion support
- Performance audit + optimization

### Phase 5: Ship (1 day)
- Responsive QA
- OG image + meta tags
- Analytics
- Deploy to Vercel

**Total estimate: 10–14 days for one developer.**

---

*This document is the source of truth for the AO landing page. All implementation decisions should trace back to the rationale captured here.*
