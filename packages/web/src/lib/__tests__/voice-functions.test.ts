import { describe, it, expect } from "vitest";
import {
  handleListSessions,
  handleGetSessionSummary,
  executeFunctionCall,
  MVP_TOOLS,
} from "../voice-functions";
import type { DashboardSession } from "../types";

// Test data factory
function createMockSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "ao-94",
    projectId: "test-project",
    status: "working",
    activity: "active",
    branch: "feat/test",
    issueId: null,
    issueUrl: "https://github.com/test/repo/issues/1",
    issueLabel: "#1",
    issueTitle: "Test issue",
    summary: "Working on test feature",
    summaryIsFallback: false,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    pr: null,
    metadata: {},
    ...overrides,
  };
}

describe("voice-functions", () => {
  describe("MVP_TOOLS", () => {
    it("has correct structure for list_sessions", () => {
      const listSessions = MVP_TOOLS.find((t) => t.name === "list_sessions");
      expect(listSessions).toBeDefined();
      expect(listSessions?.parameters.type).toBe("object");
      expect(listSessions?.parameters.properties?.status).toBeDefined();
    });

    it("has correct structure for get_session_summary", () => {
      const getSummary = MVP_TOOLS.find((t) => t.name === "get_session_summary");
      expect(getSummary).toBeDefined();
      expect(getSummary?.parameters.type).toBe("object");
      expect(getSummary?.parameters.properties?.sessionId).toBeDefined();
      expect(getSummary?.parameters.required).toContain("sessionId");
    });
  });

  describe("handleListSessions", () => {
    it("returns empty message when no sessions", () => {
      const result = handleListSessions({}, []);
      expect(result).toBe("No active sessions found.");
    });

    it("returns empty message with filter when no matches", () => {
      const result = handleListSessions({ status: "stuck" }, []);
      expect(result).toBe('No sessions match the filter "stuck".');
    });

    it("lists all sessions without filter", () => {
      const sessions = [
        createMockSession({ id: "ao-94", status: "working" }),
        createMockSession({ id: "ao-95", status: "pr_open" }),
      ];
      const result = handleListSessions({}, sessions);
      expect(result).toContain("Found 2 sessions");
      expect(result).toContain("ao-94");
      expect(result).toContain("ao-95");
    });

    it("filters by working status", () => {
      const sessions = [
        createMockSession({ id: "ao-94", status: "working", activity: "active" }),
        createMockSession({ id: "ao-95", status: "stuck", activity: "idle" }),
      ];
      const result = handleListSessions({ status: "working" }, sessions);
      expect(result).toContain("ao-94");
      expect(result).not.toContain("ao-95");
    });

    it("filters by stuck status", () => {
      const sessions = [
        createMockSession({ id: "ao-94", status: "stuck" }),
        createMockSession({ id: "ao-95", status: "working" }),
      ];
      const result = handleListSessions({ status: "stuck" }, sessions);
      expect(result).toContain("ao-94");
      expect(result).not.toContain("ao-95");
    });

    it("includes issue label in output", () => {
      const sessions = [
        createMockSession({ id: "ao-94", issueLabel: "INT-1234" }),
      ];
      const result = handleListSessions({}, sessions);
      expect(result).toContain("INT-1234");
    });

    it("truncates long summaries", () => {
      const longSummary = "A".repeat(100);
      const sessions = [
        createMockSession({ id: "ao-94", summary: longSummary }),
      ];
      const result = handleListSessions({}, sessions);
      expect(result).toContain("...");
      expect(result.length).toBeLessThan(longSummary.length + 100);
    });
  });

  describe("handleGetSessionSummary", () => {
    it("returns not found for missing session", () => {
      const result = handleGetSessionSummary({ sessionId: "ao-99" }, []);
      expect(result).toContain("not found");
    });

    it("finds session by exact ID", () => {
      const sessions = [createMockSession({ id: "ao-94" })];
      const result = handleGetSessionSummary({ sessionId: "ao-94" }, sessions);
      expect(result).toContain("ao-94");
      expect(result).toContain("working");
    });

    it("finds session by case-insensitive ID", () => {
      const sessions = [createMockSession({ id: "AO-94" })];
      const result = handleGetSessionSummary({ sessionId: "ao-94" }, sessions);
      expect(result).toContain("AO-94");
    });

    it("finds session by partial ID", () => {
      const sessions = [createMockSession({ id: "ao-94" })];
      const result = handleGetSessionSummary({ sessionId: "94" }, sessions);
      expect(result).toContain("ao-94");
    });

    it("includes summary in output", () => {
      const sessions = [
        createMockSession({ id: "ao-94", summary: "Test summary content" }),
      ];
      const result = handleGetSessionSummary({ sessionId: "ao-94" }, sessions);
      expect(result).toContain("Test summary content");
    });

    it("includes PR info when available", () => {
      const sessions = [
        createMockSession({
          id: "ao-94",
          pr: {
            number: 42,
            url: "https://github.com/test/repo/pull/42",
            title: "Add feature",
            owner: "test",
            repo: "repo",
            branch: "feat/test",
            baseBranch: "main",
            isDraft: false,
            state: "open",
            additions: 100,
            deletions: 50,
            ciStatus: "passing",
            ciChecks: [],
            reviewDecision: "approved",
            mergeability: {
              mergeable: true,
              ciPassing: true,
              approved: true,
              noConflicts: true,
              blockers: [],
            },
            unresolvedThreads: 0,
            unresolvedComments: [],
          },
        }),
      ];
      const result = handleGetSessionSummary({ sessionId: "ao-94" }, sessions);
      expect(result).toContain("#42");
      expect(result).toContain("Add feature");
      expect(result).toContain("passing");
      expect(result).toContain("approved");
    });

    it("shows no PR message when PR not created", () => {
      const sessions = [createMockSession({ id: "ao-94", pr: null })];
      const result = handleGetSessionSummary({ sessionId: "ao-94" }, sessions);
      expect(result).toContain("No PR created yet");
    });
  });

  describe("executeFunctionCall", () => {
    it("routes to list_sessions", () => {
      const sessions = [createMockSession({ id: "ao-94" })];
      const result = executeFunctionCall("list_sessions", {}, sessions);
      expect(result).toContain("ao-94");
    });

    it("routes to get_session_summary", () => {
      const sessions = [createMockSession({ id: "ao-94" })];
      const result = executeFunctionCall(
        "get_session_summary",
        { sessionId: "ao-94" },
        sessions,
      );
      expect(result).toContain("ao-94");
    });

    it("returns error for unknown function", () => {
      const result = executeFunctionCall("unknown_function", {}, []);
      expect(result).toContain("Unknown function");
      expect(result).toContain("list_sessions");
      expect(result).toContain("get_session_summary");
    });
  });
});
