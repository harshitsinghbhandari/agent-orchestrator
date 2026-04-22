# Agent Orchestrator — Landing Page

A premium dark terminal-themed landing page for Agent Orchestrator.

## Tech Stack

- **Framework:** Next.js 16 (App Router, static export)
- **Styling:** Tailwind CSS v4 + CSS custom properties
- **Animation:** Vanilla Canvas 2D (orchestration graph) + CSS transitions + IntersectionObserver
- **Typography:** JetBrains Mono (display/code) + Geist (body)
- **Bundle:** <300KB total

## Development

```bash
cd landing-page
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build

```bash
npm run build
```

Static output is written to `landing-page/out/`. This is a fully static site (no server required).

## Deployment

### Option 1: Vercel (Recommended)

1. Push this repo to GitHub
2. Import the project on [vercel.com](https://vercel.com)
3. Set **Root Directory** to `landing-page`
4. Deploy — Vercel auto-detects Next.js and handles everything

### Option 2: Netlify

1. Build: `cd landing-page && npm run build`
2. Publish directory: `landing-page/out`
3. Or use `netlify.toml`:

```toml
[build]
  base = "landing-page"
  command = "npm run build"
  publish = "out"
```

### Option 3: Cloudflare Pages

1. Build command: `cd landing-page && npm run build`
2. Output directory: `landing-page/out`

### Option 4: Any Static Host (GitHub Pages, S3, etc.)

```bash
cd landing-page
npm run build
# Upload the contents of `out/` to your static host
```

### Option 5: Docker

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY landing-page/ .
RUN npm ci && npm run build

FROM nginx:alpine
COPY --from=builder /app/out /usr/share/nginx/html
EXPOSE 80
```

```bash
docker build -t ao-landing .
docker run -p 8080:80 ao-landing
```

## Project Structure

```
landing-page/
├── src/
│   ├── app/
│   │   ├── layout.tsx       # Root layout (fonts, metadata)
│   │   ├── page.tsx         # Main page (assembles all sections)
│   │   └── globals.css      # Design tokens, glow system, utilities
│   └── components/
│       ├── Nav.tsx           # Fixed nav with glass-morphism
│       ├── ScrollProgress.tsx # Cyan scroll progress bar
│       ├── HeroTerminal.tsx  # Animated CLI typing effect
│       ├── HeroCanvas.tsx    # Dynamic import wrapper
│       ├── OrchestrationCanvas.tsx # Canvas 2D agent visualization
│       ├── SocialProof.tsx   # Stats counter section
│       ├── AgentGrid.tsx     # 2x2 terminal card grid (CSS 3D)
│       ├── LifecycleDiagram.tsx # SVG state machine (scroll-animated)
│       ├── PluginGrid.tsx    # 8-slot plugin system cards
│       ├── DashboardPreview.tsx # Browser-frame dashboard mockup
│       ├── HowItWorks.tsx    # 3-step CLI flow
│       └── CTAFooter.tsx     # Install command + footer
├── next.config.ts           # Static export config
├── package.json
└── README.md
```

## Design Reference

See `LANDING_PAGE_DESIGN.md` in the repo root for the full design specification including:
- Color palette ("Phosphor Dark")
- Typography system
- Animation choreography
- Performance budget
- Responsive strategy
