import { describe, it, expect } from "vitest";
import { estimateTokens, estimateTokensForSection, totalTokens } from "../token-utils.js";

describe("Token Estimator", () => {
  it("should estimate tokens for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate tokens for short string", () => {
    expect(estimateTokens("hello")).toBe(2); // 5/4 = 1.25 -> 2
  });

  it("should estimate tokens for longer string", () => {
    const text = "This is a test string to check if the token estimator works correctly.".repeat(10);
    const expected = Math.ceil(text.length / 4);
    expect(estimateTokens(text)).toBe(expected);
  });

  it("should estimate tokens for prompt sections", () => {
    const sections = [
      { name: "header", content: "System Prompt" },
      { name: "body", content: "You are a helpful assistant." },
    ];
    const results = estimateTokensForSection(sections);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ name: "header", tokens: 4 }); // 13/4 = 3.25 -> 4
    expect(results[1]).toEqual({ name: "body", tokens: 7 }); // 28/4 = 7
  });

  it("should calculate total tokens", () => {
    const sections = [
      { tokens: 100 },
      { tokens: 50 },
      { tokens: 25 },
    ];
    expect(totalTokens(sections)).toBe(175);
  });
});
