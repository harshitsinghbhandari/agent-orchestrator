# Option C: Local Backend (Model Provider)

## Summary
Treat Ollama as a **model backend** rather than an agent. Instead of spawning Ollama as a runnable agent, expose it as a local model option that other agents (Claude, etc.) can use for inference.

## What This Is

A **model provider plugin** (`@composio/ao-model-ollama`) that:
- Provides local model inference via Ollama API
- Registers as a model backend alongside OpenAI, Anthropic, etc.
- Used by existing agents (Claude, etc.) when configured to use local models
- Ollama runs separately as a service (`ollama serve`)

**Key insight**: Users don't "chat with Ollama" - they chat with Claude/Anthropic/etc. using Ollama as the inference engine.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Orchestrator                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │   Claude    │    │    Claude   │    │    (Other)      │  │
│  │   Agent     │    │   Agent     │    │    Agents       │  │
│  └──────┬──────┘    └──────┬──────┘    └────────┬────────┘  │
│         │                  │                    │           │
│         ▼                  ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              Model Provider Registry (core)           │    │
│  └──────────────────────────────────────────────────────┘    │
│         │                  │                    │           │
│         ▼                  ▼                    ▼           │
│  ┌────────────┐    ┌────────────┐    ┌────────────────────┐ │
│  │ Anthropic  │    │  OpenAI   │    │     Ollama        │ │
│  │  Provider  │    │  Provider  │    │    Provider       │ │
│  └────────────┘    └────────────┘    └────────────────────┘ │
│                                                  │          │
└──────────────────────────────────────────────────┼──────────┘
                                                   │
                                                   ▼
                                    ┌─────────────────────────┐
                                    │  Ollama Server          │
                                    │  (localhost:11434)      │
                                    │  /api/chat             │
                                    └─────────────────────────┘
```

## How It Works

1. **Ollama runs as a service**: `ollama serve` (background process)
2. **Model provider registered**: Ollama appears as a model option alongside OpenAI/Anthropic
3. **Agents configured**: User selects "ollama" as the model provider for an agent
4. **Inference via API**: Agent sends prompts to Ollama via `POST /api/chat`
5. **No agent spawning**: Ollama is never launched as a separate agent - it's a backend

## Implementation Changes

### 1. New Package: `packages/plugins/model-ollama/`

```
packages/plugins/model-ollama/
├── package.json
└── src/
    └── index.ts          # ~300-350 lines
```

### 2. Model Provider Interface

```typescript
// packages/plugins/model-ollama/src/index.ts
import { ModelProvider, ModelConfig } from "@composio/ao-core";

export interface OllamaModelConfig extends ModelConfig {
  baseUrl?: string;        // default: http://localhost:11434
  model: string;            // e.g., "llama3", "codellama"
  keepAlive?: string;       // "5m", etc.
  temperature?: number;
  numCtx?: number;
}

export function createOllamaProvider(config: OllamaModelConfig) {
  return {
    name: "ollama",

    async complete(prompt, options) {
      const response = await fetch(`${config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: {
            temperature: options.temperature ?? config.temperature,
            num_ctx: options.numCtx ?? config.numCtx,
          },
        }),
      });
      const data = await response.json();
      return data.message.content;
    },

    async *completeStream(prompt, options) {
      const response = await fetch(`${config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          options: {
            temperature: options.temperature ?? config.temperature,
            num_ctx: options.numCtx ?? config.numCtx,
          },
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n")) {
          if (line.startsWith("{")) {
            const data = JSON.parse(line);
            if (data.message?.content) {
              yield data.message.content;
            }
          }
        }
      }
    },

    async listModels() {
      const response = await fetch(`${config.baseUrl}/api/tags`);
      const data = await response.json();
      return data.models.map((m: any) => m.name);
    },

    async isAvailable() {
      try {
        const response = await fetch(`${config.baseUrl}/api/version`);
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
```

### 3. Register in Model Provider Registry

```typescript
// packages/core/src/model-provider-registry.ts
const BUILTIN_PROVIDERS = [
  // ... existing ...
  { name: "ollama", pkg: "@composio/ao-model-ollama" },
];
```

### 4. Agent Configuration Update

```typescript
// User configures agents to use Ollama as backend
const agent = await orchestrator.launchAgent("claude", {
  modelProvider: "ollama",    // Use Ollama instead of Anthropic
  model: "llama3",            // Which Ollama model
  // ... other agent options
});
```

## Pros
- **Clean separation** - Ollama is infrastructure, not an agent
- **Full streaming** - Direct API access, proper streaming support
- **Tool calling** - Can leverage Ollama's function calling capabilities
- **Consistent** - Works with existing agent patterns
- **Flexible** - Can swap between cloud and local models easily
- **No session management** - Stateless API calls

## Cons
- **Architecture change** - Requires model provider abstraction to exist
- **Requires existing agents** - Can't use Ollama standalone like an agent
- **Server dependency** - Ollama must be running separately (`ollama serve`)
- **Not agent-like** - Users can't "launch Ollama" as they would Claude CLI

## Estimated Complexity
**Medium** - New model provider + need model provider abstraction in core

## Files to Modify
- `packages/core/src/model-provider-registry.ts` (add 1 entry)
- `packages/core/src/types.ts` (add modelProvider option to AgentLaunchConfig)
- `packages/core/src/index.ts` (export new package)

## Files to Create
- `packages/plugins/model-ollama/` (new package, ~350 lines)

## Example Usage

```javascript
// Configure Claude to use Ollama as backend
const agent = await orchestrator.launchAgent("claude", {
  modelProvider: "ollama",
  model: "llama3",
  temperature: 0.7,
});

// Chat with Claude using Ollama inference
const response = await agent.sendMessage("Hello!");
// Streaming works properly
for await (const token of response.stream()) {
  process.stdout.write(token);
}
```

## Comparison with Option A

| Aspect | Option A (HTTP Runtime) | Option C (Local Backend) |
|--------|------------------------|-------------------------|
| Ollama is | An agent | A model backend |
| How used | `launchAgent("ollama")` | `launchAgent("claude", { modelProvider: "ollama" })` |
| Streaming | Via runtime | Direct API |
| Tool calling | Per-agent | Per-agent (via Claude) |
| Maintenance | New runtime + agent | New model provider |
| Complexity | High | Medium |
