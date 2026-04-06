import { type PricingSpec } from "./pricing-registry.js";

/**
 * Default pricing specifications for common LLMs.
 * Updated as of April 2026.
 */
export const DEFAULT_PRICING: PricingSpec[] = [
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    effectiveDate: "2024-10-22T00:00:00Z",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.30,
    cacheWritePerMillion: 3.75,
  },
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet-latest",
    effectiveDate: "2024-10-22T00:00:00Z",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.30,
    cacheWritePerMillion: 3.75,
  },
  {
    provider: "anthropic",
    model: "claude-3-7-sonnet-20250219",
    effectiveDate: "2025-02-19T00:00:00Z",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.30,
    cacheWritePerMillion: 3.75,
    reasoningPerMillion: 15.0,
  },
  {
    provider: "anthropic",
    model: "claude-3-7-sonnet-latest",
    effectiveDate: "2025-02-19T00:00:00Z",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.30,
    cacheWritePerMillion: 3.75,
    reasoningPerMillion: 15.0,
  },
  {
    provider: "openai",
    model: "gpt-4o",
    effectiveDate: "2024-05-13T00:00:00Z",
    inputPerMillion: 2.50,
    outputPerMillion: 10.0,
  },
  {
    provider: "openai",
    model: "gpt-4o-latest",
    effectiveDate: "2024-05-13T00:00:00Z",
    inputPerMillion: 2.50,
    outputPerMillion: 10.0,
  },
  {
    provider: "openai",
    model: "o3-mini",
    effectiveDate: "2025-01-30T00:00:00Z",
    inputPerMillion: 2.0,
    outputPerMillion: 8.0,
    cacheReadPerMillion: 1.0,
  },
  {
    provider: "openai",
    model: "o1",
    effectiveDate: "2024-12-12T00:00:00Z",
    inputPerMillion: 15.0,
    outputPerMillion: 60.0,
    cacheReadPerMillion: 7.5,
  },
  {
    provider: "openai",
    model: "codex",
    effectiveDate: "2024-01-01T00:00:00Z",
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
  }
];
