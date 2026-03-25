# L2 Context Stub

## Concept
The simplest possible implementation of the Context Sovereignty layer. Instead of a vectorized Brain, relevance ranking (NCD/Embeddings), and a PID-controlled context window, this stub blindly reads specific files and concatenates them up to a hard token limit.

## Implementation Strategy
A basic text assembler:
```typescript
export async function assembleContext(
  prompt: string,
  filesToRead: string[],
  maxTokens: number = 32000
) {
  let context = prompt + "\n\n--- Context ---\n";
  let currentTokens = estimateTokens(context);

  for (const file of filesToRead) {
    const content = await readFile(file);
    const tokens = estimateTokens(content);

    if (currentTokens + tokens > maxTokens) {
      // Hard truncation — no smart sliding window
      context += content.slice(0, (maxTokens - currentTokens) * 4); // rough char-to-token math
      break;
    }

    context += `\nFile: ${file}\n${content}\n`;
    currentTokens += tokens;
  }

  return context;
}
```

## Limitations vs. Full L2 Spec
- No intelligent eviction or "forgetting".
- PID controller logic is implemented but not dynamically wired to context assembly limits.
- No cross-session persistent memory ("Brain").
