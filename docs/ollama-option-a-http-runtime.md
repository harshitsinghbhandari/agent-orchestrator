# Option A: HTTP Runtime Plugin

## Summary
Treat Ollama as a first-class agent by creating a new HTTP-based runtime that communicates via REST API instead of spawning CLI processes.

## What This Is

A new **runtime plugin** (`@composio/ao-plugin-runtime-http`) that:
- Manages HTTP connections instead of tmux sessions/processes
- Sends prompts via `POST /api/chat` and receives streaming responses
- Maintains conversation history client-side (Ollama is stateless)
- Handles Ollama-specific features like tool calling, JSON mode, etc.

The **Ollama agent plugin** would then:
- Use the HTTP runtime instead of tmux/process
- Implement `Agent` interface with Ollama-specific logic
- Manage session state (message history) since Ollama doesn't

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Orchestrator                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │   Claude    │    │    Codex    │    │     Ollama      │  │
│  │   Agent     │    │    Agent    │    │     Agent       │  │
│  └──────┬──────┘    └──────┬──────┘    └────────┬────────┘  │
│         │                  │                    │           │
│         ▼                  ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              Plugin Registry (core)                   │    │
│  └──────────────────────────────────────────────────────┘    │
│         │                  │                    │           │
│         ▼                  ▼                    ▼           │
│  ┌────────────┐    ┌────────────┐    ┌────────────────────┐ │
│  │    tmux    │    │  process   │    │       http         │ │
│  │  Runtime   │    │  Runtime   │    │     Runtime        │ │
│  └────────────┘    └────────────┘    └────────────────────┘ │
│                                                │            │
└────────────────────────────────────────────────┼────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────┐
                                    │  Ollama Server      │
                                    │  (localhost:11434)  │
                                    │  /api/chat          │
                                    └─────────────────────┘
```

## Implementation Changes

### 1. New Package: `packages/plugins/runtime-http/`

```
packages/plugins/runtime-http/
├── package.json
└── src/
    └── index.ts          # ~150-200 lines
```

### 2. Runtime Interface Implementation

```typescript
// packages/plugins/runtime-http/src/index.ts
export interface HttpRuntimeConfig {
  baseUrl: string;           // http://localhost:11434
  model?: string;             // default model
  keepAlive?: string;         // "5m", etc.
}

export function create(config?: HttpRuntimeConfig): Runtime {
  return {
    name: "http",
    async create(handle) { /* return handle with connection info */ },
    async destroy(handle) { /* cleanup */ },
    async sendMessage(handle, message) {
      // POST to /api/chat with streaming
      // Store response chunks for getOutput()
    },
    async getOutput(handle, lines) { /* return accumulated output */ },
    async isAlive(handle) { /* ping /api/version */ },
  };
}
```

### 3. Ollama Agent Plugin

```
packages/plugins/agent-ollama/
├── package.json
└── src/
    └── index.ts          # ~300-400 lines
```

Key agent methods:
- `getLaunchCommand()` - Returns empty or starts `ollama serve` if needed
- `getActivityState()` - Returns "ready" when last message was < 30s ago, else "idle"
- `getSessionInfo()` - Returns message count as "summary", token usage as "cost"
- `promptDelivery: "post-launch"` - Messages sent via runtime.sendMessage()

### 4. Register in Plugin Registry

```typescript
// packages/core/src/plugin-registry.ts
const BUILTIN_PLUGINS = [
  // ... existing ...
  { slot: "runtime", name: "http", pkg: "@composio/ao-plugin-runtime-http" },
  { slot: "agent", name: "ollama", pkg: "@composio/ao-plugin-agent-ollama" },
];
```

### 5. Update Agent Launch Config (optional)

May need to add Ollama-specific options:
```typescript
// packages/core/src/types.ts
interface AgentLaunchConfig {
  // ... existing ...
  ollamaOptions?: {
    model?: string;
    temperature?: number;
    numCtx?: number;
  };
}
```

## Pros
- Clean separation: Ollama treated equally with other agents
- Full streaming support via HTTP
- Ollama's tool calling, JSON mode, etc. accessible
- Session history managed properly client-side

## Cons
- Largest implementation effort
- New runtime pattern diverges from CLI-based model
- More ongoing maintenance (HTTP connection management, error handling)
- "Activity detection" becomes timing-based, not process-based

## Estimated Complexity
**High** - New runtime + new agent plugin + potential type changes

## Files to Modify
- `packages/core/src/plugin-registry.ts` (add 2 entries)
- `packages/core/src/types.ts` (optional: add ollamaOptions)
- `packages/core/src/index.ts` (export new packages)

## Files to Create
- `packages/plugins/runtime-http/` (new package, ~200 lines)
- `packages/plugins/agent-ollama/` (new package, ~400 lines)
