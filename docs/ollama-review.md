# Ollama Integration Review

This document evaluates three options for integrating Ollama into the Agent Orchestrator to enable the effective use of open-source models. The evaluation focuses on Foundation (technical robustness), UI, and UX, prioritizing approaches that minimize disruption to current user flows.

## Option A: HTTP Runtime Plugin

Treats Ollama as a first-class agent utilizing a new HTTP-based runtime instead of the existing CLI/tmux pattern.

- **Foundation (Robustness):** Introduces a new runtime paradigm (`runtime-http`) handling raw HTTP connections. This diverges significantly from the current CLI-centric process management, increasing architectural complexity and maintenance burden for managing connections, state, and activity.
- **UI:** Good. Streaming text generation is fully supported via HTTP chunks, providing a standard, responsive UI experience.
- **UX:** Good. Supports advanced features like tool calling, JSON mode, and appropriate session history (managed client-side), maintaining parity with cloud models.
- **Pros:** Full feature support (streaming, tool calling); treats Ollama as an equal agent.
- **Cons:** High implementation effort; creates a new runtime pattern to maintain; "activity detection" becomes timing-based instead of process-based.

## Option B: CLI Wrapper Plugin

Wraps the `ollama run <model>` command as a standard CLI-based agent, piping stdin/stdout via the existing tmux runtime.

- **Foundation (Robustness):** Technically simple. Reuses the established tmux runtime entirely. Fits perfectly into the existing process model.
- **UI:** Poor. Cannot stream tokens progressively; users must wait for the entire generation process to complete before seeing any output.
- **UX:** Poor. Inherently stateless, requiring manual conversation history prepending. Lack of native function calling support diminishes its utility. The process always appears "running" even when idle.
- **Pros:** Lowest implementation complexity; highest consistency with existing CLI agent paradigms.
- **Cons:** Severe UX limitations (no streaming, no history, no tool calling).

## Option C: Local Backend (Model Provider)

Reframes Ollama from being an "agent" to being a "model provider backend." Existing agents (like Claude) utilize Ollama's API for local inference.

- **Foundation (Robustness):** Strongest conceptual fit. Instead of trying to force a backend model server into the shape of a CLI agent, it correctly abstracts Ollama as a model provider. This requires a new provider registry, but the architecture aligns seamlessly with how models are actually used.
- **UI:** Excellent. Native API access ensures proper streaming, identical to OpenAI/Anthropic providers.
- **UX:** Excellent. Users interact with the same agents they already know, just backed by a local model. Tool calling and history are managed properly by the existing agents. No new paradigms for the user.
- **Pros:** Uncompromised UX; utilizes Ollama correctly as an inference engine; clean architectural abstraction.
- **Cons:** Requires adding a new model provider registry/abstraction to the core orchestrator.

## Conclusion & Recommendation

**Option C (Local Backend / Model Provider)** provides the strongest overall foundation.

While Option B is easiest, its UX limitations are unacceptable for a modern chat interface. Option A offers good UX but adds significant, somewhat misplaced, complexity by forcing a server into an agent mold.

Option C recognizes that Ollama is fundamentally an inference engine, not an agent. By treating it as a model provider, we enable **effective use of open-source models with minimal change to user flows**—users simply switch the backend for their existing, fully-featured agents. This approach yields the highest quality UI/UX and a cleaner, more scalable architecture.