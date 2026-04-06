import { describe, it, expect } from "vitest";
import { pricingRegistry, PricingRegistry } from "../pricing-registry.js";

describe("PricingRegistry", () => {
  it("should have singleton instance", () => {
    const instance1 = PricingRegistry.getInstance();
    const instance2 = PricingRegistry.getInstance();
    expect(instance1).toBe(instance2);
  });

  it("should lookup the latest pricing for Claude Sonnet", () => {
    const pricing = pricingRegistry.lookup("anthropic", "claude-3-5-sonnet-latest");
    expect(pricing).toBeDefined();
    expect(pricing?.inputPerMillion).toBe(3.0);
    expect(pricing?.outputPerMillion).toBe(15.0);
  });

  it("should lookup pricing for a specific date", () => {
    // Register an older price
    pricingRegistry.register({
      provider: "test",
      model: "test-model",
      effectiveDate: "2023-01-01T00:00:00Z",
      inputPerMillion: 1.0,
      outputPerMillion: 5.0,
    });
    
    // Register a newer price
    pricingRegistry.register({
      provider: "test",
      model: "test-model",
      effectiveDate: "2024-01-01T00:00:00Z",
      inputPerMillion: 2.0,
      outputPerMillion: 10.0,
    });

    // Lookup with a date in 2023 should return the 2023 price
    const pricing2023 = pricingRegistry.lookup("test", "test-model", "2023-06-01T00:00:00Z");
    expect(pricing2023?.inputPerMillion).toBe(1.0);

    // Lookup with current date should return the 2024 price
    const pricingLatest = pricingRegistry.lookup("test", "test-model");
    expect(pricingLatest?.inputPerMillion).toBe(2.0);
  });

  it("should return undefined for unknown model", () => {
    const pricing = pricingRegistry.lookup("unknown", "model-x");
    expect(pricing).toBeUndefined();
  });
});
