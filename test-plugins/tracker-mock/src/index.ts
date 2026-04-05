/**
 * tracker-mock plugin — Mock issue tracker for testing external plugin loading.
 *
 * This plugin implements the Tracker interface with functional mock data.
 */

import type {
  PluginModule,
  Tracker,
  Issue,
  IssueFilters,
  IssueUpdate,
  CreateIssueInput,
  ProjectConfig,
} from "@composio/ao-core";

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_ISSUES: Map<string, Issue> = new Map([
  [
    "1",
    {
      id: "1",
      title: "Mock Issue 1: Add user authentication",
      description: "Implement user authentication with OAuth 2.0",
      url: "https://mock-tracker.example.com/issues/1",
      state: "open",
      labels: ["feature", "high-priority"],
      assignee: "test-user",
    },
  ],
  [
    "2",
    {
      id: "2",
      title: "Mock Issue 2: Fix login bug",
      description: "Users unable to login on mobile devices",
      url: "https://mock-tracker.example.com/issues/2",
      state: "in_progress",
      labels: ["bug"],
      assignee: "developer",
    },
  ],
  [
    "3",
    {
      id: "3",
      title: "Mock Issue 3: Update documentation",
      description: "Update README with new API endpoints",
      url: "https://mock-tracker.example.com/issues/3",
      state: "closed",
      labels: ["docs"],
    },
  ],
]);

// Track calls for testing
const callLog: Array<{ method: string; args: unknown[] }> = [];

function logCall(method: string, ...args: unknown[]): void {
  callLog.push({ method, args });
  console.log(`[tracker-mock] ${method}(${JSON.stringify(args).slice(1, -1)})`);
}

// ---------------------------------------------------------------------------
// Tracker implementation
// ---------------------------------------------------------------------------

function createMockTracker(config?: Record<string, unknown>): Tracker {
  const baseUrl = (config?.baseUrl as string) || "https://mock-tracker.example.com";

  return {
    name: "mock",

    async getIssue(identifier: string, _project: ProjectConfig): Promise<Issue> {
      logCall("getIssue", identifier);
      const id = identifier.replace(/^#/, "");
      const issue = MOCK_ISSUES.get(id);

      if (!issue) {
        throw new Error(`Issue ${identifier} not found`);
      }

      return { ...issue, url: `${baseUrl}/issues/${id}` };
    },

    async isCompleted(identifier: string, _project: ProjectConfig): Promise<boolean> {
      logCall("isCompleted", identifier);
      const id = identifier.replace(/^#/, "");
      const issue = MOCK_ISSUES.get(id);
      return issue?.state === "closed";
    },

    issueUrl(identifier: string, _project: ProjectConfig): string {
      logCall("issueUrl", identifier);
      const id = identifier.replace(/^#/, "");
      return `${baseUrl}/issues/${id}`;
    },

    issueLabel(url: string, _project: ProjectConfig): string {
      logCall("issueLabel", url);
      const match = url.match(/\/issues\/(\d+)/);
      return match ? `MOCK-${match[1]}` : url;
    },

    branchName(identifier: string, _project: ProjectConfig): string {
      logCall("branchName", identifier);
      const id = identifier.replace(/^#/, "");
      return `feat/mock-${id}`;
    },

    async generatePrompt(identifier: string, project: ProjectConfig): Promise<string> {
      logCall("generatePrompt", identifier);
      const issue = await this.getIssue(identifier, project);

      const lines = [
        `You are working on mock issue #${issue.id}: ${issue.title}`,
        `Issue URL: ${issue.url}`,
        "",
      ];

      if (issue.labels.length > 0) {
        lines.push(`Labels: ${issue.labels.join(", ")}`);
      }

      if (issue.description) {
        lines.push("## Description", "", issue.description);
      }

      lines.push(
        "",
        "Please implement the changes described in this issue. When done, commit and push your changes.",
      );

      return lines.join("\n");
    },

    async listIssues(filters: IssueFilters, _project: ProjectConfig): Promise<Issue[]> {
      logCall("listIssues", filters);
      let issues = Array.from(MOCK_ISSUES.values());

      if (filters.state && filters.state !== "all") {
        issues = issues.filter((i) => {
          if (filters.state === "open") return i.state === "open" || i.state === "in_progress";
          if (filters.state === "closed") return i.state === "closed";
          return true;
        });
      }

      if (filters.labels && filters.labels.length > 0) {
        issues = issues.filter((i) => filters.labels!.some((l: string) => i.labels.includes(l)));
      }

      if (filters.assignee) {
        issues = issues.filter((i) => i.assignee === filters.assignee);
      }

      const limit = filters.limit ?? 30;
      return issues.slice(0, limit);
    },

    async updateIssue(
      identifier: string,
      update: IssueUpdate,
      _project: ProjectConfig,
    ): Promise<void> {
      logCall("updateIssue", identifier, update);
      const id = identifier.replace(/^#/, "");
      const issue = MOCK_ISSUES.get(id);

      if (!issue) {
        throw new Error(`Issue ${identifier} not found`);
      }

      // Apply updates to mock data
      if (update.state) {
        issue.state = update.state;
      }
      if (update.labels) {
        issue.labels = [...issue.labels, ...update.labels];
      }
      if (update.removeLabels) {
        issue.labels = issue.labels.filter((l: string) => !update.removeLabels!.includes(l));
      }
      if (update.assignee) {
        issue.assignee = update.assignee;
      }
      if (update.comment) {
        console.log(`[tracker-mock] Comment added to #${id}: ${update.comment}`);
      }

      MOCK_ISSUES.set(id, issue);
    },

    async createIssue(input: CreateIssueInput, _project: ProjectConfig): Promise<Issue> {
      logCall("createIssue", input);
      const newId = String(MOCK_ISSUES.size + 1);

      const newIssue: Issue = {
        id: newId,
        title: input.title,
        description: input.description,
        url: `${baseUrl}/issues/${newId}`,
        state: "open",
        labels: input.labels ?? [],
        assignee: input.assignee,
      };

      MOCK_ISSUES.set(newId, newIssue);
      return newIssue;
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin module export
// ---------------------------------------------------------------------------

export const manifest = {
  name: "mock",
  slot: "tracker" as const,
  description: "Tracker plugin: Mock issue tracker for testing",
  version: "0.1.0",
};

export function create(config?: Record<string, unknown>): Tracker {
  console.log("[tracker-mock] Creating mock tracker plugin", config);
  return createMockTracker(config);
}

/** Export call log for testing */
export function getCallLog(): Array<{ method: string; args: unknown[] }> {
  return [...callLog];
}

/** Clear call log for testing */
export function clearCallLog(): void {
  callLog.length = 0;
}

export default { manifest, create } satisfies PluginModule<Tracker>;
