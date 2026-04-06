import { describe, it, expect } from "vitest";
import { computeCost, mergeCosts } from "../cost-utils.js";

describe("Cost Utils", () => {
  it("should compute cost for Claude with caching", () => {
    const cost = computeCost({
      inputTokens: 1000000,
      outputTokens: 1000000,
      cachedReadTokens: 1000000,
      cacheCreationTokens: 1000000,
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
    });

    // input: 3.0, output: 15.0, cache read: 0.30, cache write: 3.75
    // total: 3 + 15 + 0.3 + 3.75 = 22.05
    expect(cost.estimatedCostUsd).toBeCloseTo(22.05);
    expect(cost.provider).toBe("anthropic");
    expect(cost.model).toBe("claude-3-5-sonnet-latest");
  });

  it("should use directCostUsd if provided", () => {
    const cost = computeCost({
      inputTokens: 100,
      outputTokens: 100,
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
      directCostUsd: 0.99,
    });

    expect(cost.estimatedCostUsd).toBe(0.99);
  });

  it("should merge two cost estimates", () => {
    const existing = {
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0.1,
    };
    const incoming = {
      inputTokens: 200,
      outputTokens: 100,
      estimatedCostUsd: 0.2,
      cachedReadTokens: 10,
    };

    const merged = mergeCosts(existing, incoming);
    expect(merged.inputTokens).toBe(300);
    expect(merged.outputTokens).toBe(150);
    expect(merged.estimatedCostUsd).toBeCloseTo(0.3);
    expect(merged.cachedReadTokens).toBe(10);
  });

  it("should handle undefined existing cost in merge", () => {
    const incoming = {
      inputTokens: 200,
      outputTokens: 100,
      estimatedCostUsd: 0.2,
    };

    const merged = mergeCosts(undefined, incoming);
    expect(merged).toEqual(incoming);
  });
});
