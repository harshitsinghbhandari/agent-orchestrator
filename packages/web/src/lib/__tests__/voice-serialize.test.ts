import { describe, it, expect } from "vitest";
import {
  createVoiceEvent,
  detectStateChanges,
  serializeSessionForVoice,
} from "../voice-serialize";
import type { DashboardSession, DashboardPR } from "../types";

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

function createMockPR(overrides: Partial<DashboardPR> = {}): DashboardPR {
  return {
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
      mergeable: false,
      ciPassing: true,
      approved: true,
      noConflicts: true,
      blockers: [],
    },
    unresolvedThreads: 0,
    unresolvedComments: [],
    ...overrides,
  };
}

describe("voice-serialize", () => {
  describe("createVoiceEvent", () => {
    it("creates event with correct structure", () => {
      const session = createMockSession();
      const event = createVoiceEvent(session, "ci.failing");

      expect(event.eventType).toBe("ci.failing");
      expect(event.sessionId).toBe("ao-94");
      expect(event.projectId).toBe("test-project");
      expect(event.timestamp).toBeDefined();
      expect(event.message).toBeDefined();
      expect(event.context).toBeDefined();
    });

    it("generates unique event IDs", () => {
      const session = createMockSession();
      const event1 = createVoiceEvent(session, "ci.failing");
      const event2 = createVoiceEvent(session, "ci.failing");
      expect(event1.eventId).not.toBe(event2.eventId);
    });

    it("sets correct priority for action events", () => {
      const session = createMockSession();
      expect(createVoiceEvent(session, "ci.failing").priority).toBe("action");
      expect(createVoiceEvent(session, "session.stuck").priority).toBe("action");
      expect(createVoiceEvent(session, "session.needs_input").priority).toBe("action");
    });

    it("sets correct priority for warning events", () => {
      const session = createMockSession();
      expect(createVoiceEvent(session, "review.changes_requested").priority).toBe("warning");
    });

    it("sets correct priority for info events", () => {
      const session = createMockSession();
      expect(createVoiceEvent(session, "merge.ready").priority).toBe("info");
    });

    it("includes issue label in message", () => {
      const session = createMockSession({ issueLabel: "INT-1234" });
      const event = createVoiceEvent(session, "ci.failing");
      expect(event.message).toContain("INT-1234");
    });

    it("includes PR context when available", () => {
      const session = createMockSession({ pr: createMockPR() });
      const event = createVoiceEvent(session, "ci.failing");
      expect(event.context.prUrl).toBeDefined();
      expect(event.context.prNumber).toBe(42);
      expect(event.context.ciStatus).toBe("passing");
    });
  });

  describe("detectStateChanges", () => {
    it("returns empty array for no changes", () => {
      const session = createMockSession();
      const events = detectStateChanges(session, session);
      expect(events).toEqual([]);
    });

    it("detects CI failing transition", () => {
      const prev = createMockSession({ pr: createMockPR({ ciStatus: "passing" }) });
      const curr = createMockSession({ pr: createMockPR({ ciStatus: "failing" }) });
      const events = detectStateChanges(prev, curr);
      expect(events).toContain("ci.failing");
    });

    it("does not detect CI failing when already failing", () => {
      const prev = createMockSession({ pr: createMockPR({ ciStatus: "failing" }) });
      const curr = createMockSession({ pr: createMockPR({ ciStatus: "failing" }) });
      const events = detectStateChanges(prev, curr);
      expect(events).not.toContain("ci.failing");
    });

    it("detects review changes_requested transition", () => {
      const prev = createMockSession({ pr: createMockPR({ reviewDecision: "pending" }) });
      const curr = createMockSession({ pr: createMockPR({ reviewDecision: "changes_requested" }) });
      const events = detectStateChanges(prev, curr);
      expect(events).toContain("review.changes_requested");
    });

    it("detects session stuck transition", () => {
      const prev = createMockSession({ status: "working" });
      const curr = createMockSession({ status: "stuck" });
      const events = detectStateChanges(prev, curr);
      expect(events).toContain("session.stuck");
    });

    it("detects session needs_input via status", () => {
      const prev = createMockSession({ status: "working" });
      const curr = createMockSession({ status: "needs_input" });
      const events = detectStateChanges(prev, curr);
      expect(events).toContain("session.needs_input");
    });

    it("detects session needs_input via activity", () => {
      const prev = createMockSession({ activity: "active" });
      const curr = createMockSession({ activity: "waiting_input" });
      const events = detectStateChanges(prev, curr);
      expect(events).toContain("session.needs_input");
    });

    it("detects merge ready transition", () => {
      const notMergeable = createMockPR({
        mergeability: {
          mergeable: false,
          ciPassing: true,
          approved: true,
          noConflicts: true,
          blockers: ["Not approved"],
        },
      });
      const mergeable = createMockPR({
        state: "open",
        mergeability: {
          mergeable: true,
          ciPassing: true,
          approved: true,
          noConflicts: true,
          blockers: [],
        },
      });
      const prev = createMockSession({ pr: notMergeable });
      const curr = createMockSession({ pr: mergeable });
      const events = detectStateChanges(prev, curr);
      expect(events).toContain("merge.ready");
    });

    it("handles null previous session", () => {
      const curr = createMockSession({ pr: createMockPR({ ciStatus: "failing" }) });
      const events = detectStateChanges(null, curr);
      expect(events).toContain("ci.failing");
    });
  });

  describe("serializeSessionForVoice", () => {
    it("serializes basic session info", () => {
      const session = createMockSession();
      const serialized = serializeSessionForVoice(session);

      expect(serialized.id).toBe("ao-94");
      expect(serialized.status).toBe("working");
      expect(serialized.activity).toBe("active");
      expect(serialized.summary).toBe("Working on test feature");
    });

    it("includes attention level", () => {
      const session = createMockSession({ status: "stuck" });
      const serialized = serializeSessionForVoice(session);
      expect(serialized.attentionLevel).toBe("respond");
    });

    it("includes PR info when available", () => {
      const session = createMockSession({ pr: createMockPR() });
      const serialized = serializeSessionForVoice(session);
      expect(serialized.prUrl).toBe("https://github.com/test/repo/pull/42");
      expect(serialized.ciStatus).toBe("passing");
      expect(serialized.reviewDecision).toBe("approved");
    });

    it("handles null PR", () => {
      const session = createMockSession({ pr: null });
      const serialized = serializeSessionForVoice(session);
      expect(serialized.prUrl).toBeNull();
      expect(serialized.ciStatus).toBeNull();
      expect(serialized.reviewDecision).toBeNull();
    });
  });
});
