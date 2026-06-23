/**
 * scm-mock plugin — Mock SCM for testing external plugin loading.
 *
 * This plugin implements the SCM interface with functional mock data.
 */

import type {
  PluginModule,
  SCM,
  Session,
  ProjectConfig,
  PRInfo,
  PRState,
  MergeMethod,
  CICheck,
  CIStatus,
  Review,
  ReviewDecision,
  ReviewComment,
  AutomatedComment,
  MergeReadiness,
} from "@composio/ao-core";

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

interface MockPRData {
  info: PRInfo;
  state: PRState;
  ciStatus: CIStatus;
  reviewDecision: ReviewDecision;
  checks: CICheck[];
  reviews: Review[];
  comments: ReviewComment[];
  automatedComments: AutomatedComment[];
}

const MOCK_PRS: Map<number, MockPRData> = new Map([
  [
    1,
    {
      info: {
        number: 1,
        url: "https://mock-scm.example.com/pr/1",
        title: "feat: Add user authentication",
        owner: "test-org",
        repo: "test-repo",
        branch: "feat/mock-1",
        baseBranch: "main",
        isDraft: false,
      },
      state: "open",
      ciStatus: "passing",
      reviewDecision: "approved",
      checks: [
        {
          name: "build",
          status: "passed",
          url: "https://mock-scm.example.com/checks/1/build",
        },
        {
          name: "test",
          status: "passed",
          url: "https://mock-scm.example.com/checks/1/test",
        },
      ],
      reviews: [
        {
          author: "reviewer1",
          state: "approved",
          body: "LGTM!",
          submittedAt: new Date("2024-01-15T10:00:00Z"),
        },
      ],
      comments: [],
      automatedComments: [],
    },
  ],
  [
    2,
    {
      info: {
        number: 2,
        url: "https://mock-scm.example.com/pr/2",
        title: "fix: Login bug on mobile",
        owner: "test-org",
        repo: "test-repo",
        branch: "feat/mock-2",
        baseBranch: "main",
        isDraft: false,
      },
      state: "open",
      ciStatus: "failing",
      reviewDecision: "changes_requested",
      checks: [
        {
          name: "build",
          status: "passed",
          url: "https://mock-scm.example.com/checks/2/build",
        },
        {
          name: "test",
          status: "failed",
          url: "https://mock-scm.example.com/checks/2/test",
        },
      ],
      reviews: [
        {
          author: "reviewer2",
          state: "changes_requested",
          body: "Please fix the test failures",
          submittedAt: new Date("2024-01-16T14:00:00Z"),
        },
      ],
      comments: [
        {
          id: "c1",
          author: "reviewer2",
          body: "This needs error handling",
          path: "src/auth.ts",
          line: 42,
          isResolved: false,
          createdAt: new Date("2024-01-16T14:05:00Z"),
          url: "https://mock-scm.example.com/pr/2/comments/c1",
        },
      ],
      automatedComments: [
        {
          id: "ac1",
          botName: "mock-linter[bot]",
          body: "ESLint: Unused variable 'foo'",
          path: "src/auth.ts",
          line: 15,
          severity: "warning",
          createdAt: new Date("2024-01-16T14:01:00Z"),
          url: "https://mock-scm.example.com/pr/2/comments/ac1",
        },
      ],
    },
  ],
]);

// Track calls for testing
const callLog: Array<{ method: string; args: unknown[] }> = [];

function logCall(method: string, ...args: unknown[]): void {
  callLog.push({ method, args });
  console.log(`[scm-mock] ${method}(${JSON.stringify(args).slice(1, -1)})`);
}

// ---------------------------------------------------------------------------
// SCM implementation
// ---------------------------------------------------------------------------

function createMockSCM(_config?: Record<string, unknown>): SCM {
  return {
    name: "mock",

    // --- PR Lifecycle ---

    async detectPR(session: Session, _project: ProjectConfig): Promise<PRInfo | null> {
      logCall("detectPR", session.id, session.branch);
      // Find PR by branch name
      for (const prData of MOCK_PRS.values()) {
        if (prData.info.branch === session.branch) {
          return prData.info;
        }
      }
      return null;
    },

    async resolvePR(reference: string, _project: ProjectConfig): Promise<PRInfo> {
      logCall("resolvePR", reference);
      const prNum = parseInt(reference.replace(/^#/, ""), 10);
      const prData = MOCK_PRS.get(prNum);
      if (!prData) {
        throw new Error(`PR ${reference} not found`);
      }
      return prData.info;
    },

    async getPRState(pr: PRInfo): Promise<PRState> {
      logCall("getPRState", pr.number);
      const prData = MOCK_PRS.get(pr.number);
      return prData?.state ?? "closed";
    },

    async getPRSummary(
      pr: PRInfo,
    ): Promise<{ state: PRState; title: string; additions: number; deletions: number }> {
      logCall("getPRSummary", pr.number);
      const prData = MOCK_PRS.get(pr.number);
      return {
        state: prData?.state ?? "closed",
        title: prData?.info.title ?? pr.title,
        additions: 42,
        deletions: 10,
      };
    },

    async mergePR(pr: PRInfo, method?: MergeMethod): Promise<void> {
      logCall("mergePR", pr.number, method);
      const prData = MOCK_PRS.get(pr.number);
      if (prData) {
        prData.state = "merged";
      }
    },

    async closePR(pr: PRInfo): Promise<void> {
      logCall("closePR", pr.number);
      const prData = MOCK_PRS.get(pr.number);
      if (prData) {
        prData.state = "closed";
      }
    },

    // --- CI Tracking ---

    async getCIChecks(pr: PRInfo): Promise<CICheck[]> {
      logCall("getCIChecks", pr.number);
      const prData = MOCK_PRS.get(pr.number);
      return prData?.checks ?? [];
    },

    async getCISummary(pr: PRInfo): Promise<CIStatus> {
      logCall("getCISummary", pr.number);
      const prData = MOCK_PRS.get(pr.number);
      return prData?.ciStatus ?? "none";
    },

    // --- Review Tracking ---

    async getReviews(pr: PRInfo): Promise<Review[]> {
      logCall("getReviews", pr.number);
      const prData = MOCK_PRS.get(pr.number);
      return prData?.reviews ?? [];
    },

    async getReviewDecision(pr: PRInfo): Promise<ReviewDecision> {
      logCall("getReviewDecision", pr.number);
      const prData = MOCK_PRS.get(pr.number);
      return prData?.reviewDecision ?? "none";
    },

    async getPendingComments(pr: PRInfo): Promise<ReviewComment[]> {
      logCall("getPendingComments", pr.number);
      const prData = MOCK_PRS.get(pr.number);
      return prData?.comments.filter((c) => !c.isResolved) ?? [];
    },

    async getAutomatedComments(pr: PRInfo): Promise<AutomatedComment[]> {
      logCall("getAutomatedComments", pr.number);
      const prData = MOCK_PRS.get(pr.number);
      return prData?.automatedComments ?? [];
    },

    // --- Merge Readiness ---

    async getMergeability(pr: PRInfo): Promise<MergeReadiness> {
      logCall("getMergeability", pr.number);
      const prData = MOCK_PRS.get(pr.number);
      if (!prData) {
        return {
          mergeable: false,
          ciPassing: false,
          approved: false,
          noConflicts: true,
          blockers: ["PR not found"],
        };
      }

      const ciPassing = prData.ciStatus === "passing";
      const approved = prData.reviewDecision === "approved";
      const blockers: string[] = [];

      if (!ciPassing) blockers.push("CI checks failing");
      if (!approved) blockers.push("Awaiting review approval");

      return {
        mergeable: ciPassing && approved,
        ciPassing,
        approved,
        noConflicts: true,
        blockers,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin module export
// ---------------------------------------------------------------------------

export const manifest = {
  name: "mock",
  slot: "scm" as const,
  description: "SCM plugin: Mock source control for testing",
  version: "0.1.0",
};

export function create(config?: Record<string, unknown>): SCM {
  console.log("[scm-mock] Creating mock SCM plugin", config);
  return createMockSCM(config);
}

/** Export call log for testing */
export function getCallLog(): Array<{ method: string; args: unknown[] }> {
  return [...callLog];
}

/** Clear call log for testing */
export function clearCallLog(): void {
  callLog.length = 0;
}

export default { manifest, create } satisfies PluginModule<SCM>;
