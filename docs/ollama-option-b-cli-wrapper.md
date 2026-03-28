# Option B: CLI Wrapper Plugin

## Summary
Treat Ollama as a CLI-based agent by wrapping the `ollama run <model>` command as a dumb agent that pipes prompts via stdin and reads responses via stdout.

## What This Is

A minimal **agent plugin** (`@composio/ao-plugin-agent-ollama`) that:
- Spawns `ollama run <model>` as a subprocess (like existing CLI agents)
- Pipes prompts to the process via stdin
- Reads responses by reading from stdout/stderr
- Uses the existing **tmux runtime** to manage the CLI session

This treats Ollama exactly like any other CLI-based agent (Claude CLI, Codex CLI, etc.).

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
│  │    tmux    │    │    tmux    │    │       tmux         │ │
│  │  Runtime   │    │  Runtime   │    │     Runtime        │ │
│  └────────────┘    └────────────┘    └────────────────────┘ │
│                                                  │          │
└──────────────────────────────────────────────────┼──────────┘
                                                   │
                                                   ▼
                                    ┌─────────────────────────┐
                                    │  ollama run <model>     │
                                    │  (subprocess/tmux)      │
                                    └─────────────────────────┘
```

## How It Works

1. **Launch**: `agent.getLaunchCommand()` returns `["ollama", "run", "llama3"]`
2. **Spawn**: Runtime creates a tmux session running the command
3. **Prompt**: Messages are piped to stdin via `tmux send-keys`
4. **Output**: Responses are captured from stdout via `tmux capture-pane`
5. **Activity**: Process is "alive" while running; "idle" when waiting for input

## Implementation Changes

### 1. New Package: `packages/plugins/agent-ollama/`

```
packages/plugins/agent-ollama/
├── package.json
└── src/
    └── index.ts          # ~200-250 lines
```

### 2. Agent Plugin Implementation

```typescript
// packages/plugins/agent-ollama/src/index.ts
import { AgentPlugin, AgentConfig } from "@composio/ao-core";

export function createOllamaAgent(config: AgentConfig = {}) {
  return {
    name: "ollama",
    runtime: "tmux",

    getLaunchCommand() {
      const model = config.model || "llama3";
      return {
        command: "ollama",
        args: ["run", model],
        env: {},
      };
    },

    getActivityState(handle) {
      // If process exists, it's either running (active) or waiting (idle)
      // Could track last activity time via timestamps
      return handle.alive ? "idle" : "inactive";
    },

    getSessionInfo(handle) {
      return {
        summary: "Ollama session",
        cost: "local",
      };
    },

    promptDelivery: "post-launch",
  };
}
```

### 3. Register in Plugin Registry

```typescript
// packages/core/src/plugin-registry.ts
const BUILTIN_PLUGINS = [
  // ... existing ...
  { slot: "agent", name: "ollama", pkg: "@composio/ao-plugin-agent-ollama" },
];
```

### 4. Configuration

```typescript
// packages/core/src/types.ts
interface AgentLaunchConfig {
  // ... existing ...
  ollamaOptions?: {
    model?: string;           // default: "llama3"
    temperature?: number;
    numCtx?: number;
    keepAlive?: string;        // e.g., "5m"
  };
}
```

## Limitations

### 1. No Streaming
- Cannot stream tokens as they generate
- Must wait for full response before displaying

### 2. No Conversation History
- Ollama CLI is stateless between prompts
- Would need to prepend all previous messages to each prompt manually
- Token limits become problematic quickly

### 3. No Tool Calling
- Ollama CLI doesn't support function calling natively
- Would need to parse stdout and inject tool results manually

### 4. Activity Detection
- Process is always "running" even when idle waiting for input
- Cannot distinguish "thinking" from "waiting"

### 5. No Real-time Output
- Full response only available after process completes
- Cannot show progressive generations

## Pros
- **Minimal code** - Reuses existing tmux runtime entirely
- **Fastest to implement** - Similar to existing agent plugins
- **Consistent** - Same pattern as Claude CLI, Codex, etc.
- **Low maintenance** - No new runtime to maintain
- **Works offline** - Local model, no internet required

## Cons
- **Poor UX** - No streaming, full response only
- **No history** - Must manually prepend conversation context
- **No tool support** - Can't use Ollama's function calling
- **Inefficient** - Each prompt is a new context (unless managed manually)
- **Activity detection** - Always shows as "running"

## Estimated Complexity
**Low** - Single new agent plugin, reuses existing tmux runtime

## Files to Modify
- `packages/core/src/plugin-registry.ts` (add 1 entry)
- `packages/core/src/types.ts` (optional: add ollamaOptions)
- `packages/core/src/index.ts` (export new package)

## Files to Create
- `packages/plugins/agent-ollama/` (new package, ~250 lines)

## Example Usage

```javascript
// After implementation
const agent = await orchestrator.launchAgent("ollama", {
  ollamaOptions: { model: "codellama" }
});

const response = await agent.sendMessage("Explain this code");
// Response only available after full generation completes
```
