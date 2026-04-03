import { describe, it, expect } from "vitest";
import {
  handleListSessions,
  handleGetSessionSummary,
  handleGetCIFailures,
  handleGetReviewComments,
  handleGetSessionChanges,
  executeFunctionCall,
  createConversationContext,
  findSessionById,
  MVP_TOOLS,
  type ConversationContext,
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
  describe("findSessionById", () => {
    it("finds session by exact ID", () => {
      const sessions = [createMockSession({ id: "ao-94" })];
      const result = findSessionById("ao-94", sessions);
      expect(result?.id).toBe("ao-94");
    });

    it("finds session by case-insensitive ID", () => {
      const sessions = [createMockSession({ id: "AO-94" })];
      const result = findSessionById("ao-94", sessions);
      expect(result?.id).toBe("AO-94");
    });

    it("finds session by numeric suffix", () => {
      const sessions = [createMockSession({ id: "ao-94" })];
      const result = findSessionById("94", sessions);
      expect(result?.id).toBe("ao-94");
    });

    it("does not match numeric suffix that is part of a longer number", () => {
      const sessions = [
        createMockSession({ id: "ao-194" }),
        createMockSession({ id: "ao-94" }),
      ];
      const result = findSessionById("94", sessions);
      expect(result?.id).toBe("ao-94");
    });

    it("returns null for non-existent session", () => {
      const sessions = [createMockSession({ id: "ao-94" })];
      const result = findSessionById("ao-999", sessions);
      expect(result).toBeNull();
    });

    // Orchestrator matching tests
    it("finds orchestrator session by exact ID", () => {
      const sessions = [
        createMockSession({ id: "ao-94" }),
        createMockSession({ id: "ao-orchestrator", metadata: { role: "orchestrator" } }),
      ];
      const result = findSessionById("ao-orchestrator", sessions);
      expect(result?.id).toBe("ao-orchestrator");
    });

    it("finds orchestrator session by 'orchestrator' keyword", () => {
      const sessions = [
        createMockSession({ id: "ao-94" }),
        createMockSession({ id: "ao-orchestrator", metadata: { role: "orchestrator" } }),
      ];
      const result = findSessionById("orchestrator", sessions);
      expect(result?.id).toBe("ao-orchestrator");
    });

    it("finds orchestrator session by 'orch' keyword", () => {
      const sessions = [
        createMockSession({ id: "ao-94" }),
        createMockSession({ id: "app-orchestrator", metadata: { role: "orchestrator" } }),
      ];
      const result = findSessionById("orch", sessions);
      expect(result?.id).toBe("app-orchestrator");
    });

    it("finds orchestrator session by 'the orchestrator' keyword", () => {
      const sessions = [
        createMockSession({ id: "ao-94" }),
        createMockSession({ id: "ao-orchestrator", metadata: { role: "orchestrator" } }),
      ];
      const result = findSessionById("the orchestrator", sessions);
      expect(result?.id).toBe("ao-orchestrator");
    });

    it("orchestrator keyword is case-insensitive", () => {
      const sessions = [
        createMockSession({ id: "ao-94" }),
        createMockSession({ id: "ao-orchestrator", metadata: { role: "orchestrator" } }),
      ];
      const result = findSessionById("ORCHESTRATOR", sessions);
      expect(result?.id).toBe("ao-orchestrator");
    });

    it("returns null when orchestrator keyword used but no orchestrator exists", () => {
      const sessions = [
        createMockSession({ id: "ao-94" }),
        createMockSession({ id: "ao-95" }),
      ];
      const result = findSessionById("orchestrator", sessions);
      expect(result).toBeNull();
    });
  });

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
      const context = createConversationContext();
      const result = executeFunctionCall("list_sessions", {}, sessions, context);
      expect(result.result).toContain("ao-94");
      expect(result.sessionId).toBeNull(); // list_sessions doesn't set context
    });

    it("routes to get_session_summary", () => {
      const sessions = [createMockSession({ id: "ao-94" })];
      const context = createConversationContext();
      const result = executeFunctionCall(
        "get_session_summary",
        { sessionId: "ao-94" },
        sessions,
        context,
      );
      expect(result.result).toContain("ao-94");
      expect(result.sessionId).toBe("ao-94");
    });

    it("returns error for unknown function", () => {
      const context = createConversationContext();
      const result = executeFunctionCall("unknown_function", {}, [], context);
      expect(result.result).toContain("Unknown function");
      expect(result.result).toContain("list_sessions");
      expect(result.result).toContain("get_session_summary");
    });
  });

  // V2 Function Tests
  describe("handleGetCIFailures (V2)", () => {
    it("returns error when session not found", () => {
      const context = createConversationContext();
      const result = handleGetCIFailures({ sessionId: "ao-99" }, [], context);
      expect(result.result).toContain("not found");
      expect(result.sessionId).toBeNull();
    });

    it("returns error when no PR exists", () => {
      const sessions = [createMockSession({ id: "ao-94", pr: null })];
      const context = createConversationContext();
      const result = handleGetCIFailures({ sessionId: "ao-94" }, sessions, context);
      expect(result.result).toContain("doesn't have a PR");
      expect(result.sessionId).toBe("ao-94");
    });

    it("returns passing message when no failures", () => {
      const sessions = [
        createMockSession({
          id: "ao-94",
          pr: {
            number: 42,
            url: "https://github.com/test/repo/pull/42",
            title: "Test PR",
            owner: "test",
            repo: "repo",
            branch: "feat/test",
            baseBranch: "main",
            isDraft: false,
            state: "open",
            additions: 100,
            deletions: 50,
            ciStatus: "passing",
            ciChecks: [
              { name: "build", status: "passed" },
              { name: "test", status: "passed" },
            ],
            reviewDecision: "none",
            mergeability: { mergeable: false, ciPassing: true, approved: false, noConflicts: true, blockers: [] },
            unresolvedThreads: 0,
            unresolvedComments: [],
          },
        }),
      ];
      const context = createConversationContext();
      const result = handleGetCIFailures({ sessionId: "ao-94" }, sessions, context);
      expect(result.result).toContain("No CI failures");
      expect(result.result).toContain("passing");
      expect(result.sessionId).toBe("ao-94");
    });

    it("lists failed CI checks", () => {
      const sessions = [
        createMockSession({
          id: "ao-94",
          pr: {
            number: 42,
            url: "https://github.com/test/repo/pull/42",
            title: "Test PR",
            owner: "test",
            repo: "repo",
            branch: "feat/test",
            baseBranch: "main",
            isDraft: false,
            state: "open",
            additions: 100,
            deletions: 50,
            ciStatus: "failing",
            ciChecks: [
              { name: "build", status: "passed" },
              { name: "test", status: "failed", url: "https://github.com/test/repo/actions/runs/123" },
              { name: "lint", status: "failed" },
            ],
            reviewDecision: "none",
            mergeability: { mergeable: false, ciPassing: false, approved: false, noConflicts: true, blockers: [] },
            unresolvedThreads: 0,
            unresolvedComments: [],
          },
        }),
      ];
      const context = createConversationContext();
      const result = handleGetCIFailures({ sessionId: "ao-94" }, sessions, context);
      expect(result.result).toContain("2 failing CI check");
      expect(result.result).toContain("test");
      expect(result.result).toContain("lint");
      expect(result.result).not.toContain("build");
      expect(result.sessionId).toBe("ao-94");
    });

    it("uses context when sessionId not provided", () => {
      const sessions = [createMockSession({ id: "ao-94", pr: null })];
      const context: ConversationContext = {
        lastSessionId: "ao-94",
        lastUpdatedAt: Date.now(),
      };
      const result = handleGetCIFailures({}, sessions, context);
      expect(result.result).toContain("ao-94");
    });

    it("returns error when no context and no sessionId", () => {
      const sessions = [createMockSession({ id: "ao-94" })];
      const context = createConversationContext();
      const result = handleGetCIFailures({}, sessions, context);
      expect(result.result).toContain("No session specified");
    });
  });

  describe("handleGetReviewComments (V2)", () => {
    it("returns error when no PR exists", () => {
      const sessions = [createMockSession({ id: "ao-94", pr: null })];
      const context = createConversationContext();
      const result = handleGetReviewComments({ sessionId: "ao-94" }, sessions, context);
      expect(result.result).toContain("doesn't have a PR");
    });

    it("returns approved message when no comments and approved", () => {
      const sessions = [
        createMockSession({
          id: "ao-94",
          pr: {
            number: 42,
            url: "https://github.com/test/repo/pull/42",
            title: "Test PR",
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
            mergeability: { mergeable: true, ciPassing: true, approved: true, noConflicts: true, blockers: [] },
            unresolvedThreads: 0,
            unresolvedComments: [],
          },
        }),
      ];
      const context = createConversationContext();
      const result = handleGetReviewComments({ sessionId: "ao-94" }, sessions, context);
      expect(result.result).toContain("No pending review comments");
      expect(result.result).toContain("approved");
    });

    it("lists unresolved review comments", () => {
      const sessions = [
        createMockSession({
          id: "ao-94",
          pr: {
            number: 42,
            url: "https://github.com/test/repo/pull/42",
            title: "Test PR",
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
            reviewDecision: "changes_requested",
            mergeability: { mergeable: false, ciPassing: true, approved: false, noConflicts: true, blockers: [] },
            unresolvedThreads: 2,
            unresolvedComments: [
              { url: "https://...", path: "src/index.ts", author: "reviewer1", body: "Please add error handling" },
              { url: "https://...", path: "src/utils.ts", author: "reviewer2", body: "This could be simplified" },
            ],
          },
        }),
      ];
      const context = createConversationContext();
      const result = handleGetReviewComments({ sessionId: "ao-94" }, sessions, context);
      expect(result.result).toContain("2 unresolved review comment");
      expect(result.result).toContain("reviewer1");
      expect(result.result).toContain("reviewer2");
      expect(result.result).toContain("src/index.ts");
      expect(result.result).toContain("error handling");
    });
  });

  describe("handleGetSessionChanges (V2)", () => {
    it("returns error when no PR exists", () => {
      const sessions = [createMockSession({ id: "ao-94", pr: null })];
      const context = createConversationContext();
      const result = handleGetSessionChanges({ sessionId: "ao-94" }, sessions, context);
      expect(result.result).toContain("doesn't have a PR");
      expect(result.result).toContain("No changes");
    });

    it("shows PR stats and changes", () => {
      const sessions = [
        createMockSession({
          id: "ao-94",
          summary: "Implementing feature X",
          pr: {
            number: 42,
            url: "https://github.com/test/repo/pull/42",
            title: "Add feature X",
            owner: "test",
            repo: "repo",
            branch: "feat/test",
            baseBranch: "main",
            isDraft: false,
            state: "open",
            additions: 150,
            deletions: 30,
            ciStatus: "passing",
            ciChecks: [],
            reviewDecision: "pending",
            mergeability: { mergeable: false, ciPassing: true, approved: false, noConflicts: true, blockers: [] },
            unresolvedThreads: 0,
            unresolvedComments: [],
          },
        }),
      ];
      const context = createConversationContext();
      const result = handleGetSessionChanges({ sessionId: "ao-94" }, sessions, context);
      expect(result.result).toContain("ao-94");
      expect(result.result).toContain("#42");
      expect(result.result).toContain("Add feature X");
      expect(result.result).toContain("+150 additions");
      expect(result.result).toContain("-30 deletions");
      expect(result.result).toContain("+120 lines"); // net change
      expect(result.result).toContain("Implementing feature X");
      expect(result.sessionId).toBe("ao-94");
    });
  });

  describe("Context Retention (V2)", () => {
    it("updates context after resolving a session", () => {
      const sessions = [createMockSession({ id: "ao-94", pr: null })];
      const context = createConversationContext();

      // First call with explicit sessionId
      const result1 = handleGetCIFailures({ sessionId: "ao-94" }, sessions, context);
      expect(result1.sessionId).toBe("ao-94");

      // Simulate context update
      if (result1.sessionId) {
        context.lastSessionId = result1.sessionId;
        context.lastUpdatedAt = Date.now();
      }

      // Second call without sessionId should use context
      const result2 = handleGetCIFailures({}, sessions, context);
      expect(result2.result).toContain("ao-94");
    });

    it("list_sessions does not update context", () => {
      const sessions = [createMockSession({ id: "ao-94" })];
      const context = createConversationContext();
      const result = executeFunctionCall("list_sessions", {}, sessions, context);
      expect(result.sessionId).toBeNull();
    });

    it("get_session_summary updates context", () => {
      const sessions = [createMockSession({ id: "ao-94" })];
      const context = createConversationContext();
      const result = executeFunctionCall("get_session_summary", { sessionId: "ao-94" }, sessions, context);
      expect(result.sessionId).toBe("ao-94");
    });
  });

  describe("MVP_TOOLS V2 additions", () => {
    it("has get_ci_failures function", () => {
      const func = MVP_TOOLS.find((t) => t.name === "get_ci_failures");
      expect(func).toBeDefined();
      expect(func?.description).toContain("CI");
    });

    it("has get_review_comments function", () => {
      const func = MVP_TOOLS.find((t) => t.name === "get_review_comments");
      expect(func).toBeDefined();
      expect(func?.description).toContain("review");
    });

    it("has get_session_changes function", () => {
      const func = MVP_TOOLS.find((t) => t.name === "get_session_changes");
      expect(func).toBeDefined();
      expect(func?.description).toContain("changed");
    });
  });
});
