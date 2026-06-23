# External Plugins

This guide explains how to create and use external plugins with Agent Orchestrator.

## Overview

External plugins allow you to extend Agent Orchestrator with custom integrations beyond the built-in plugins. Use them when you need to:

- **Integrate with unsupported services** — Connect to Jira, Bitbucket, Azure DevOps, or internal tools
- **Customize behavior** — Modify how issues are fetched, PRs are tracked, or notifications are sent
- **Share plugins across projects** — Publish to npm or use local paths for team-wide plugins

External plugins work identically to built-in plugins. They implement the same interfaces and are loaded at startup based on your `agent-orchestrator.yaml` configuration.

## Plugin Structure

Every plugin must export three things:

### 1. Manifest

Describes the plugin identity:

```typescript
export const manifest = {
  name: "jira",                    // Unique name within the slot
  slot: "tracker" as const,        // Which slot: tracker, scm, or notifier
  description: "Tracker plugin: Jira integration",
  version: "1.0.0",
};
```

**Important:** The `slot` must use `as const` to preserve the literal type.

### 2. create() Function

Factory function that returns the plugin instance:

```typescript
export function create(config?: Record<string, unknown>): Tracker {
  // config comes from your YAML configuration
  const apiToken = config?.apiToken as string;
  const baseUrl = config?.baseUrl as string;

  return {
    name: "jira",
    // ... implement interface methods
  };
}
```

The `config` parameter receives plugin-specific settings from your YAML file (with `plugin`, `package`, and `path` fields stripped).

### 3. Default Export

Combine manifest and create for the module export:

```typescript
import type { PluginModule, Tracker } from "@composio/ao-core";

export default { manifest, create } satisfies PluginModule<Tracker>;
```

### Optional: detect() Function

Check if required dependencies are available:

```typescript
export function detect(): boolean {
  // Return true if the plugin can run (e.g., CLI tool is installed)
  try {
    execSync("jira --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
```

## Available Slots

### Tracker

Issue/task tracking integration (GitHub Issues, Linear, Jira, etc.)

```typescript
interface Tracker {
  readonly name: string;

  // Required methods
  getIssue(identifier: string, project: ProjectConfig): Promise<Issue>;
  isCompleted(identifier: string, project: ProjectConfig): Promise<boolean>;
  issueUrl(identifier: string, project: ProjectConfig): string;
  branchName(identifier: string, project: ProjectConfig): string;
  generatePrompt(identifier: string, project: ProjectConfig): Promise<string>;

  // Optional methods
  issueLabel?(url: string, project: ProjectConfig): string;
  listIssues?(filters: IssueFilters, project: ProjectConfig): Promise<Issue[]>;
  updateIssue?(identifier: string, update: IssueUpdate, project: ProjectConfig): Promise<void>;
  createIssue?(input: CreateIssueInput, project: ProjectConfig): Promise<Issue>;
}

interface Issue {
  id: string;
  title: string;
  description: string;
  url: string;
  state: "open" | "in_progress" | "closed" | "cancelled";
  labels: string[];
  assignee?: string;
  priority?: number;
}
```

### SCM

Source control management (PRs, CI checks, reviews, merging):

```typescript
interface SCM {
  readonly name: string;

  // PR Lifecycle
  detectPR(session: Session, project: ProjectConfig): Promise<PRInfo | null>;
  getPRState(pr: PRInfo): Promise<PRState>;
  mergePR(pr: PRInfo, method?: MergeMethod): Promise<void>;
  closePR(pr: PRInfo): Promise<void>;

  // CI Tracking
  getCIChecks(pr: PRInfo): Promise<CICheck[]>;
  getCISummary(pr: PRInfo): Promise<CIStatus>;

  // Review Tracking
  getReviews(pr: PRInfo): Promise<Review[]>;
  getReviewDecision(pr: PRInfo): Promise<ReviewDecision>;
  getPendingComments(pr: PRInfo): Promise<ReviewComment[]>;
  getAutomatedComments(pr: PRInfo): Promise<AutomatedComment[]>;

  // Merge Readiness
  getMergeability(pr: PRInfo): Promise<MergeReadiness>;

  // Optional methods
  resolvePR?(reference: string, project: ProjectConfig): Promise<PRInfo>;
  getPRSummary?(pr: PRInfo): Promise<{ state: PRState; title: string; additions: number; deletions: number }>;
  verifyWebhook?(request: SCMWebhookRequest, project: ProjectConfig): Promise<SCMWebhookVerificationResult>;
  parseWebhook?(request: SCMWebhookRequest, project: ProjectConfig): Promise<SCMWebhookEvent | null>;
}
```

### Notifier

Push notifications to humans:

```typescript
interface Notifier {
  readonly name: string;

  // Required method
  notify(event: OrchestratorEvent): Promise<void>;

  // Optional methods
  notifyWithActions?(event: OrchestratorEvent, actions: NotifyAction[]): Promise<void>;
  post?(message: string, context?: NotifyContext): Promise<string | null>;
}

interface OrchestratorEvent {
  id: string;
  type: EventType;
  priority: "urgent" | "action" | "warning" | "info";
  sessionId: string;
  projectId: string;
  timestamp: Date;
  message: string;
  data: Record<string, unknown>;
}
```

## Config Syntax

### Loading via Local Path

Reference a local plugin directory:

```yaml
projects:
  my-app:
    name: My App
    repo: org/my-app
    path: /path/to/repo
    defaultBranch: main
    sessionPrefix: app
    tracker:
      path: ./plugins/tracker-jira   # Relative to config file
      apiToken: ${JIRA_API_TOKEN}
      baseUrl: https://mycompany.atlassian.net
```

For notifiers:

```yaml
notifiers:
  teams:
    path: ./plugins/notifier-teams
    webhookUrl: ${TEAMS_WEBHOOK_URL}
```

### Loading via npm Package

Reference an npm package:

```yaml
projects:
  my-app:
    tracker:
      package: "@mycompany/ao-plugin-tracker-jira"
      apiToken: ${JIRA_API_TOKEN}
```

### Plugin Name Validation

When you specify both `plugin` and `package`/`path`, the manifest name must match:

```yaml
# This will fail if the package's manifest.name is not "jira"
tracker:
  plugin: jira
  package: "@mycompany/ao-plugin-tracker-jira"
```

When you omit `plugin`, the name is auto-inferred from the manifest:

```yaml
# manifest.name will be used automatically
tracker:
  package: "@mycompany/ao-plugin-tracker-jira"
```

## Examples

### Minimal Tracker Plugin

```typescript
// tracker-mock/src/index.ts
import type { PluginModule, Tracker, Issue, ProjectConfig } from "@composio/ao-core";

const MOCK_ISSUES: Map<string, Issue> = new Map([
  ["1", {
    id: "1",
    title: "Implement user authentication",
    description: "Add OAuth 2.0 support",
    url: "https://tracker.example.com/issues/1",
    state: "open",
    labels: ["feature"],
  }],
]);

export const manifest = {
  name: "mock",
  slot: "tracker" as const,
  description: "Tracker plugin: Mock issue tracker for testing",
  version: "0.1.0",
};

export function create(config?: Record<string, unknown>): Tracker {
  const baseUrl = (config?.baseUrl as string) || "https://tracker.example.com";

  return {
    name: "mock",

    async getIssue(identifier: string, _project: ProjectConfig): Promise<Issue> {
      const issue = MOCK_ISSUES.get(identifier.replace(/^#/, ""));
      if (!issue) throw new Error(`Issue ${identifier} not found`);
      return { ...issue, url: `${baseUrl}/issues/${issue.id}` };
    },

    async isCompleted(identifier: string, _project: ProjectConfig): Promise<boolean> {
      const issue = MOCK_ISSUES.get(identifier.replace(/^#/, ""));
      return issue?.state === "closed";
    },

    issueUrl(identifier: string, _project: ProjectConfig): string {
      return `${baseUrl}/issues/${identifier.replace(/^#/, "")}`;
    },

    branchName(identifier: string, _project: ProjectConfig): string {
      return `feat/issue-${identifier.replace(/^#/, "")}`;
    },

    async generatePrompt(identifier: string, project: ProjectConfig): Promise<string> {
      const issue = await this.getIssue(identifier, project);
      return [
        `You are working on issue #${issue.id}: ${issue.title}`,
        `Issue URL: ${issue.url}`,
        "",
        "## Description",
        issue.description,
        "",
        "Please implement the changes and push when done.",
      ].join("\n");
    },
  };
}

export default { manifest, create } satisfies PluginModule<Tracker>;
```

### Minimal SCM Plugin

```typescript
// scm-mock/src/index.ts
import type {
  PluginModule, SCM, Session, ProjectConfig, PRInfo, PRState,
  CICheck, CIStatus, Review, ReviewDecision, ReviewComment,
  AutomatedComment, MergeReadiness,
} from "@composio/ao-core";

const MOCK_PRS: Map<number, { info: PRInfo; state: PRState; ciStatus: CIStatus }> = new Map([
  [1, {
    info: {
      number: 1,
      url: "https://scm.example.com/pr/1",
      title: "Add authentication",
      owner: "org",
      repo: "app",
      branch: "feat/auth",
      baseBranch: "main",
      isDraft: false,
    },
    state: "open",
    ciStatus: "passing",
  }],
]);

export const manifest = {
  name: "mock",
  slot: "scm" as const,
  description: "SCM plugin: Mock source control for testing",
  version: "0.1.0",
};

export function create(_config?: Record<string, unknown>): SCM {
  return {
    name: "mock",

    async detectPR(session: Session, _project: ProjectConfig): Promise<PRInfo | null> {
      for (const pr of MOCK_PRS.values()) {
        if (pr.info.branch === session.branch) return pr.info;
      }
      return null;
    },

    async getPRState(pr: PRInfo): Promise<PRState> {
      return MOCK_PRS.get(pr.number)?.state ?? "closed";
    },

    async mergePR(pr: PRInfo, _method?: string): Promise<void> {
      const data = MOCK_PRS.get(pr.number);
      if (data) data.state = "merged";
    },

    async closePR(pr: PRInfo): Promise<void> {
      const data = MOCK_PRS.get(pr.number);
      if (data) data.state = "closed";
    },

    async getCIChecks(pr: PRInfo): Promise<CICheck[]> {
      return [{ name: "build", status: "passed" }, { name: "test", status: "passed" }];
    },

    async getCISummary(pr: PRInfo): Promise<CIStatus> {
      return MOCK_PRS.get(pr.number)?.ciStatus ?? "none";
    },

    async getReviews(_pr: PRInfo): Promise<Review[]> {
      return [{ author: "reviewer", state: "approved", submittedAt: new Date() }];
    },

    async getReviewDecision(_pr: PRInfo): Promise<ReviewDecision> {
      return "approved";
    },

    async getPendingComments(_pr: PRInfo): Promise<ReviewComment[]> {
      return [];
    },

    async getAutomatedComments(_pr: PRInfo): Promise<AutomatedComment[]> {
      return [];
    },

    async getMergeability(pr: PRInfo): Promise<MergeReadiness> {
      const ciPassing = (await this.getCISummary(pr)) === "passing";
      const approved = (await this.getReviewDecision(pr)) === "approved";
      return {
        mergeable: ciPassing && approved,
        ciPassing,
        approved,
        noConflicts: true,
        blockers: [],
      };
    },
  };
}

export default { manifest, create } satisfies PluginModule<SCM>;
```

### Minimal Notifier Plugin

```typescript
// notifier-mock/src/index.ts
import type { PluginModule, Notifier, OrchestratorEvent, NotifyAction } from "@composio/ao-core";

export const manifest = {
  name: "mock",
  slot: "notifier" as const,
  description: "Notifier plugin: Mock notifications for testing",
  version: "0.1.0",
};

export function create(config?: Record<string, unknown>): Notifier {
  const prefix = (config?.prefix as string) || "[NOTIFICATION]";
  const silent = config?.silent === true;

  return {
    name: "mock",

    async notify(event: OrchestratorEvent): Promise<void> {
      if (!silent) {
        console.log(`${prefix} ${event.priority.toUpperCase()}: ${event.message}`);
      }
    },

    async notifyWithActions(event: OrchestratorEvent, actions: NotifyAction[]): Promise<void> {
      if (!silent) {
        const actionLabels = actions.map((a) => a.label).join(" | ");
        console.log(`${prefix} ${event.message}\nActions: ${actionLabels}`);
      }
    },

    async post(message: string, _context?: unknown): Promise<string | null> {
      if (!silent) console.log(`${prefix} POST: ${message}`);
      return `mock-post-${Date.now()}`;
    },
  };
}

export default { manifest, create } satisfies PluginModule<Notifier>;
```

### Package.json Template

```json
{
  "name": "@mycompany/ao-plugin-tracker-jira",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@composio/ao-core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
```

### tsconfig.json Template

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"]
}
```

## Troubleshooting

### Slot Mismatch

**Error:**
```
Plugin at projects.myapp.tracker has slot "notifier" but was configured as "tracker".
The plugin will be registered under its declared slot "notifier".
```

**Cause:** Your plugin's `manifest.slot` doesn't match where it's referenced in config.

**Fix:** Ensure `manifest.slot` matches the config location:
- `tracker:` config → `slot: "tracker" as const`
- `scm:` config → `slot: "scm" as const`
- `notifiers:` config → `slot: "notifier" as const`

### Name Mismatch

**Error:**
```
Plugin manifest.name mismatch at projects.myapp.tracker:
expected "jira" but package "@acme/ao-plugin-tracker-jira" has manifest.name "jira-cloud".
Either update the 'plugin' field to match the actual manifest.name, or remove it to auto-infer.
```

**Cause:** You specified `plugin: jira` but the package's manifest has `name: "jira-cloud"`.

**Fix:** Either:
1. Update `plugin:` to match: `plugin: jira-cloud`
2. Remove `plugin:` entirely to auto-infer from manifest

### Module Not Found

**Error:**
```
[plugin-registry] Could not resolve specifier for plugin "my-tracker" (source: local)
```

**Cause:** The path doesn't exist or doesn't have a valid entry point.

**Fix:** Ensure:
1. The path is relative to `agent-orchestrator.yaml` or absolute
2. The directory contains `package.json` with `main` or `exports` field
3. The built output exists (run `pnpm build` in the plugin directory)

### Interface Method Missing

**Error:**
```
TypeError: tracker.getIssue is not a function
```

**Cause:** Your `create()` function doesn't return all required interface methods.

**Fix:** Implement all required methods for the interface. Check the [Available Slots](#available-slots) section for required vs optional methods.

### Config Not Passed

**Symptom:** Plugin doesn't receive configuration values.

**Cause:** Plugin-specific config must be at the same level as `path:` or `package:`.

**Wrong:**
```yaml
tracker:
  path: ./plugins/tracker-jira
  config:              # Wrong: nested under "config"
    apiToken: xxx
```

**Correct:**
```yaml
tracker:
  path: ./plugins/tracker-jira
  apiToken: xxx        # Correct: same level as path
  baseUrl: https://...
```

### Plugin Not Loading

**Symptom:** Plugin appears to load but isn't used.

**Debug steps:**
1. Check plugin is built: `ls -la ./plugins/my-plugin/dist/`
2. Add logging to `create()`: `console.log("[my-plugin] Loading with config:", config)`
3. Verify the manifest name matches what's in config
4. Check for errors in stderr during startup

### TypeScript Errors

**Error:**
```
Cannot find module '@composio/ao-core' or its corresponding type declarations.
```

**Fix:** Ensure your plugin is part of the pnpm workspace or has `@composio/ao-core` installed:

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
  - "packages/plugins/*"
  - "my-plugins/*"        # Add your plugins directory
```

Then run `pnpm install` to link dependencies.
