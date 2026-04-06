import { describe, it, expect } from "vitest";
import { modelRegistry, ModelRegistry } from "../model-registry.js";

describe("ModelRegistry", () => {
  it("should have singleton instance", () => {
    const instance1 = ModelRegistry.getInstance();
    const instance2 = ModelRegistry.getInstance();
    expect(instance1).toBe(instance2);
  });

  it("should return the correct prompt budget for Claude", () => {
    const budget = modelRegistry.getPromptBudget("anthropic", "claude-3-5-sonnet-latest");
    expect(budget).toBe(160000);
  });

  it("should return the correct prompt budget for gpt-4o", () => {
    const budget = modelRegistry.getPromptBudget("openai", "gpt-4o");
    expect(budget).toBe(100000);
  });

  it("should return the default prompt budget for unknown models", () => {
    const budget = modelRegistry.getPromptBudget("unknown", "foo-bar");
    expect(budget).toBe(100000); // from getDefaultEstimate()
  });

  it("should handle mixed-case model names in lookup", () => {
    const budget = modelRegistry.getPromptBudget("Anthropic", "Claude-3-5-Sonnet-Latest");
    expect(budget).toBe(160000);
  });

  it("should allow registering new models", () => {
    modelRegistry.register({
      provider: "goose",
      model: "goose-1",
      maxContextTokens: 500000,
      safePromptBudget: 400000,
      supportsCacheRead: false,
      supportsCacheWrite: false,
      supportsReasoning: false,
    });
    const budget = modelRegistry.getPromptBudget("goose", "goose-1");
    expect(budget).toBe(400000);
  });
});
