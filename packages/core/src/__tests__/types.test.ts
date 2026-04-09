import { describe, expect, it } from "vitest";
import { isOrchestratorSession, isIssueNotFoundError } from "../types.js";

describe("isOrchestratorSession", () => {
  it("detects orchestrators by explicit role metadata", () => {
    expect(
      isOrchestratorSession({ id: "app-control", metadata: { role: "orchestrator" } }, "app"),
    ).toBe(true);
  });

  it("falls back to orchestrator naming for legacy sessions", () => {
    expect(isOrchestratorSession({ id: "app-orchestrator", metadata: {} }, "app")).toBe(true);
  });

  it("detects numbered worktree orchestrators by prefix pattern", () => {
    expect(isOrchestratorSession({ id: "app-orchestrator-1", metadata: {} }, "app")).toBe(true);
    expect(isOrchestratorSession({ id: "app-orchestrator-42", metadata: {} }, "app")).toBe(true);
  });

  it("does not false-positive on worker sessions", () => {
    expect(isOrchestratorSession({ id: "app-7", metadata: { role: "worker" } }, "app")).toBe(false);
  });

  it("does not false-positive when prefix ends with -orchestrator", () => {
    // my-orchestrator-1 is a worker when prefix is "my-orchestrator"
    expect(
      isOrchestratorSession({ id: "my-orchestrator-1", metadata: {} }, "my-orchestrator"),
    ).toBe(false);
    // my-orchestrator-orchestrator-1 is the real worktree orchestrator
    expect(
      isOrchestratorSession(
        { id: "my-orchestrator-orchestrator-1", metadata: {} },
        "my-orchestrator",
      ),
    ).toBe(true);
  });

  it("does not filter out valid orchestrators when another project has orchestrator suffix as prefix", () => {
    // Project A has prefix "app", Project B has prefix "app-orchestrator"
    // app-orchestrator-1 is a valid orchestrator for Project A
    // The cross-project check should NOT filter it out just because
    // it matches the worker pattern for Project B
    const allPrefixes = ["app", "app-orchestrator"];
    expect(
      isOrchestratorSession({ id: "app-orchestrator-1", metadata: {} }, "app", allPrefixes),
    ).toBe(true);
    expect(
      isOrchestratorSession({ id: "app-orchestrator-42", metadata: {} }, "app", allPrefixes),
    ).toBe(true);
  });

  it("still filters out workers that match another project's worker pattern", () => {
    // app-worker-1 matches the worker pattern for prefix "app-worker"
    // so it should be filtered out when checking prefix "app"
    const allPrefixes = ["app", "app-worker"];
    // Note: "app-worker-1" does not match the orchestrator pattern "^app-orchestrator-\d+$"
    // so it fails the orchestrator format check before reaching the cross-project guard
    expect(
      isOrchestratorSession({ id: "app-worker-1", metadata: {} }, "app", allPrefixes),
    ).toBe(false);
  });

  it("detects numbered orchestrators without sessionPrefix", () => {
    // When sessionPrefix is unavailable (e.g., during lifecycle checks), the function
    // should still detect IDs ending with "-orchestrator-N" pattern
    expect(isOrchestratorSession({ id: "app-orchestrator-1", metadata: {} })).toBe(true);
    expect(isOrchestratorSession({ id: "myproject-orchestrator-42", metadata: {} })).toBe(true);
    // Should not match regular numbered workers
    expect(isOrchestratorSession({ id: "app-7", metadata: {} })).toBe(false);
    expect(isOrchestratorSession({ id: "app-worker-1", metadata: {} })).toBe(false);
    // Should still detect role metadata and legacy suffix without prefix
    expect(
      isOrchestratorSession({ id: "app-control", metadata: { role: "orchestrator" } }),
    ).toBe(true);
    expect(isOrchestratorSession({ id: "app-orchestrator", metadata: {} })).toBe(true);
  });

  it("disambiguates workers from orchestrators when prefix ends with -orchestrator and allSessionPrefixes provided", () => {
    // Edge case: "my-orchestrator-1" could be either:
    // - A worker for prefix "my-orchestrator"
    // - An orchestrator for prefix "my"
    // When allSessionPrefixes is provided, we can disambiguate
    const allPrefixes = ["my-orchestrator", "other-project"];

    // Without sessionPrefix but with allSessionPrefixes, correctly identify as worker
    expect(
      isOrchestratorSession({ id: "my-orchestrator-1", metadata: {} }, undefined, allPrefixes),
    ).toBe(false);

    // Real orchestrators still detected
    expect(
      isOrchestratorSession({ id: "other-project-orchestrator-1", metadata: {} }, undefined, allPrefixes),
    ).toBe(true);

    // Without allSessionPrefixes, we can't disambiguate (known limitation)
    // This is a false positive - documenting current behavior
    expect(
      isOrchestratorSession({ id: "my-orchestrator-1", metadata: {} }),
    ).toBe(true); // False positive without allSessionPrefixes
  });
});

describe("isIssueNotFoundError", () => {
  it("matches 'Issue X not found'", () => {
    expect(isIssueNotFoundError(new Error("Issue INT-9999 not found"))).toBe(true);
  });

  it("matches 'could not resolve to an Issue'", () => {
    expect(isIssueNotFoundError(new Error("Could not resolve to an Issue"))).toBe(true);
  });

  it("matches 'no issue with identifier'", () => {
    expect(isIssueNotFoundError(new Error("No issue with identifier ABC-123"))).toBe(true);
  });

  it("matches 'invalid issue format'", () => {
    expect(isIssueNotFoundError(new Error("Invalid issue format: fix login bug"))).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isIssueNotFoundError(new Error("Unauthorized"))).toBe(false);
    expect(isIssueNotFoundError(new Error("Network timeout"))).toBe(false);
    expect(isIssueNotFoundError(new Error("API key not found"))).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isIssueNotFoundError(null)).toBe(false);
    expect(isIssueNotFoundError(undefined)).toBe(false);
    expect(isIssueNotFoundError("string")).toBe(false);
  });
});
