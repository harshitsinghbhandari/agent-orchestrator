/**
 * Integration tests for external plugin loading via path: field.
 *
 * This test validates that PR #11's external plugin loading feature works correctly
 * by loading mock plugins from the test-plugins/ directory.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPluginRegistry } from "../plugin-registry.js";
import type { OrchestratorConfig, Tracker, SCM, Notifier } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to test-plugins directory (relative to this test file in packages/core/src/__tests__)
const TEST_PLUGINS_DIR = resolve(__dirname, "../../../../test-plugins");

// ---------------------------------------------------------------------------
// Helper to create test config
// ---------------------------------------------------------------------------

function makeTestConfig(): OrchestratorConfig {
  const configPath = resolve(TEST_PLUGINS_DIR, "test-config.yaml");

  return {
    configPath,
    readyThresholdMs: 300000,
    defaults: {
      runtime: "tmux",
      agent: "claude-code",
      workspace: "worktree",
      notifiers: ["mock"],
    },
    projects: {
      "test-project": {
        name: "Test Project",
        repo: "test-org/test-repo",
        path: "/tmp/test-repo",
        defaultBranch: "main",
        sessionPrefix: "test",
        tracker: {
          path: "./tracker-mock",
        },
        scm: {
          path: "./scm-mock",
        },
      },
    },
    notifiers: {
      mock: {
        path: "./notifier-mock",
        prefix: "[TEST]",
        silent: true,
      },
    },
    notificationRouting: {
      urgent: ["mock"],
      action: ["mock"],
      warning: ["mock"],
      info: ["mock"],
    },
    reactions: {},
    // Internal: external plugin entries for manifest validation
    _externalPluginEntries: [
      {
        source: "projects.test-project.tracker",
        location: { kind: "project", projectId: "test-project", configType: "tracker" },
        slot: "tracker",
        path: "./tracker-mock",
        // No expectedPluginName - will infer from manifest
      },
      {
        source: "projects.test-project.scm",
        location: { kind: "project", projectId: "test-project", configType: "scm" },
        slot: "scm",
        path: "./scm-mock",
      },
      {
        source: "notifiers.mock",
        location: { kind: "notifier", notifierId: "mock" },
        slot: "notifier",
        path: "./notifier-mock",
      },
    ],
    plugins: [
      {
        name: "tracker-mock",
        source: "local",
        path: "./tracker-mock",
        enabled: true,
      },
      {
        name: "scm-mock",
        source: "local",
        path: "./scm-mock",
        enabled: true,
      },
      {
        name: "notifier-mock",
        source: "local",
        path: "./notifier-mock",
        enabled: true,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("External plugin loading via path:", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let trackerMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let scmMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifierMock: any;

  beforeAll(async () => {
    // Import the mock plugins directly to verify they export correctly
    const trackerPath = join(TEST_PLUGINS_DIR, "tracker-mock/dist/index.js");
    const scmPath = join(TEST_PLUGINS_DIR, "scm-mock/dist/index.js");
    const notifierPath = join(TEST_PLUGINS_DIR, "notifier-mock/dist/index.js");

    trackerMock = await import(trackerPath);
    scmMock = await import(scmPath);
    notifierMock = await import(notifierPath);
  });

  describe("Plugin manifest validation", () => {
    it("tracker-mock exports correct manifest", () => {
      expect(trackerMock.manifest).toEqual({
        name: "mock",
        slot: "tracker",
        description: "Tracker plugin: Mock issue tracker for testing",
        version: "0.1.0",
      });
    });

    it("scm-mock exports correct manifest", () => {
      expect(scmMock.manifest).toEqual({
        name: "mock",
        slot: "scm",
        description: "SCM plugin: Mock source control for testing",
        version: "0.1.0",
      });
    });

    it("notifier-mock exports correct manifest", () => {
      expect(notifierMock.manifest).toEqual({
        name: "mock",
        slot: "notifier",
        description: "Notifier plugin: Mock notifications for testing",
        version: "0.1.0",
      });
    });
  });

  describe("Plugin create() function", () => {
    it("tracker-mock create() returns a valid Tracker", () => {
      const tracker: Tracker = trackerMock.create();
      expect(tracker.name).toBe("mock");
      expect(typeof tracker.getIssue).toBe("function");
      expect(typeof tracker.isCompleted).toBe("function");
      expect(typeof tracker.issueUrl).toBe("function");
      expect(typeof tracker.branchName).toBe("function");
      expect(typeof tracker.generatePrompt).toBe("function");
      expect(typeof tracker.listIssues).toBe("function");
      expect(typeof tracker.updateIssue).toBe("function");
      expect(typeof tracker.createIssue).toBe("function");
    });

    it("scm-mock create() returns a valid SCM", () => {
      const scm: SCM = scmMock.create();
      expect(scm.name).toBe("mock");
      expect(typeof scm.detectPR).toBe("function");
      expect(typeof scm.getPRState).toBe("function");
      expect(typeof scm.mergePR).toBe("function");
      expect(typeof scm.closePR).toBe("function");
      expect(typeof scm.getCIChecks).toBe("function");
      expect(typeof scm.getCISummary).toBe("function");
      expect(typeof scm.getReviews).toBe("function");
      expect(typeof scm.getReviewDecision).toBe("function");
      expect(typeof scm.getPendingComments).toBe("function");
      expect(typeof scm.getAutomatedComments).toBe("function");
      expect(typeof scm.getMergeability).toBe("function");
    });

    it("notifier-mock create() returns a valid Notifier", () => {
      const notifier: Notifier = notifierMock.create();
      expect(notifier.name).toBe("mock");
      expect(typeof notifier.notify).toBe("function");
      expect(typeof notifier.notifyWithActions).toBe("function");
      expect(typeof notifier.post).toBe("function");
    });
  });

  describe("Tracker mock functionality", () => {
    it("getIssue returns mock issue data", async () => {
      const tracker: Tracker = trackerMock.create();
      const issue = await tracker.getIssue("1", {
        name: "test",
        repo: "test/test",
        path: "/tmp",
        defaultBranch: "main",
        sessionPrefix: "test",
      });

      expect(issue.id).toBe("1");
      expect(issue.title).toContain("Mock Issue 1");
      expect(issue.state).toBe("open");
      expect(issue.labels).toContain("feature");
    });

    it("isCompleted returns correct state", async () => {
      const tracker: Tracker = trackerMock.create();
      const project = {
        name: "test",
        repo: "test/test",
        path: "/tmp",
        defaultBranch: "main",
        sessionPrefix: "test",
      };

      expect(await tracker.isCompleted("1", project)).toBe(false);
      expect(await tracker.isCompleted("3", project)).toBe(true);
    });

    it("throws error for non-existent issue", async () => {
      const tracker: Tracker = trackerMock.create();
      await expect(
        tracker.getIssue("999", {
          name: "test",
          repo: "test/test",
          path: "/tmp",
          defaultBranch: "main",
          sessionPrefix: "test",
        }),
      ).rejects.toThrow("Issue 999 not found");
    });
  });

  describe("SCM mock functionality", () => {
    it("getPRState returns correct state", async () => {
      const scm: SCM = scmMock.create();
      const pr1 = {
        number: 1,
        url: "https://mock-scm.example.com/pr/1",
        title: "test",
        owner: "test-org",
        repo: "test-repo",
        branch: "feat/mock-1",
        baseBranch: "main",
        isDraft: false,
      };
      expect(await scm.getPRState(pr1)).toBe("open");
    });

    it("getCISummary returns correct status", async () => {
      const scm: SCM = scmMock.create();
      const pr1 = {
        number: 1,
        url: "https://mock-scm.example.com/pr/1",
        title: "test",
        owner: "test-org",
        repo: "test-repo",
        branch: "feat/mock-1",
        baseBranch: "main",
        isDraft: false,
      };
      const pr2 = {
        number: 2,
        url: "https://mock-scm.example.com/pr/2",
        title: "test",
        owner: "test-org",
        repo: "test-repo",
        branch: "feat/mock-2",
        baseBranch: "main",
        isDraft: false,
      };

      expect(await scm.getCISummary(pr1)).toBe("passing");
      expect(await scm.getCISummary(pr2)).toBe("failing");
    });

    it("getMergeability returns correct merge readiness", async () => {
      const scm: SCM = scmMock.create();
      const pr1 = {
        number: 1,
        url: "https://mock-scm.example.com/pr/1",
        title: "test",
        owner: "test-org",
        repo: "test-repo",
        branch: "feat/mock-1",
        baseBranch: "main",
        isDraft: false,
      };

      const mergeability = await scm.getMergeability(pr1);
      expect(mergeability.mergeable).toBe(true);
      expect(mergeability.ciPassing).toBe(true);
      expect(mergeability.approved).toBe(true);
      expect(mergeability.blockers).toHaveLength(0);
    });
  });

  describe("Notifier mock functionality", () => {
    it("notify logs event correctly", async () => {
      const notifier: Notifier = notifierMock.create({ silent: true });
      const event = {
        id: "test-1",
        type: "session.spawned" as const,
        priority: "info" as const,
        sessionId: "test-session",
        projectId: "test-project",
        timestamp: new Date(),
        message: "Test notification",
        data: {},
      };

      await expect(notifier.notify(event)).resolves.toBeUndefined();
    });

    it("post returns mock post ID", async () => {
      const notifier: Notifier = notifierMock.create({ silent: true });
      const postId = await notifier.post!("Test message", { sessionId: "test" });
      expect(postId).toMatch(/^mock-post-\d+$/);
    });
  });

  describe("Plugin registry integration", () => {
    it("loads external plugins from config.plugins", async () => {
      const registry = createPluginRegistry();
      const config = makeTestConfig();

      // Create mock import function that loads our test plugins
      const importFn = async (specifier: string): Promise<unknown> => {
        if (specifier.includes("tracker-mock")) {
          return import(join(TEST_PLUGINS_DIR, "tracker-mock/dist/index.js"));
        }
        if (specifier.includes("scm-mock")) {
          return import(join(TEST_PLUGINS_DIR, "scm-mock/dist/index.js"));
        }
        if (specifier.includes("notifier-mock")) {
          return import(join(TEST_PLUGINS_DIR, "notifier-mock/dist/index.js"));
        }
        throw new Error(`Not found: ${specifier}`);
      };

      await registry.loadFromConfig(config, importFn);

      // Verify plugins are registered
      expect(registry.get("tracker", "mock")).not.toBeNull();
      expect(registry.get("scm", "mock")).not.toBeNull();
      expect(registry.get("notifier", "mock")).not.toBeNull();
    });

    it("updates config with actual manifest.name", async () => {
      const registry = createPluginRegistry();
      const config = makeTestConfig();

      const importFn = async (specifier: string): Promise<unknown> => {
        if (specifier.includes("tracker-mock")) {
          return import(join(TEST_PLUGINS_DIR, "tracker-mock/dist/index.js"));
        }
        if (specifier.includes("scm-mock")) {
          return import(join(TEST_PLUGINS_DIR, "scm-mock/dist/index.js"));
        }
        if (specifier.includes("notifier-mock")) {
          return import(join(TEST_PLUGINS_DIR, "notifier-mock/dist/index.js"));
        }
        throw new Error(`Not found: ${specifier}`);
      };

      await registry.loadFromConfig(config, importFn);

      // Config should be updated with manifest.name
      expect(config.projects["test-project"].tracker?.plugin).toBe("mock");
      expect(config.projects["test-project"].scm?.plugin).toBe("mock");
      expect(config.notifiers.mock?.plugin).toBe("mock");
    });

    it("passes notifier config to create()", async () => {
      const registry = createPluginRegistry();
      const config = makeTestConfig();

      const importFn = async (specifier: string): Promise<unknown> => {
        if (specifier.includes("tracker-mock")) {
          return import(join(TEST_PLUGINS_DIR, "tracker-mock/dist/index.js"));
        }
        if (specifier.includes("scm-mock")) {
          return import(join(TEST_PLUGINS_DIR, "scm-mock/dist/index.js"));
        }
        if (specifier.includes("notifier-mock")) {
          // Return a spy version to verify config is passed
          const original = await import(join(TEST_PLUGINS_DIR, "notifier-mock/dist/index.js"));
          const createSpy = vi.fn(original.create);
          return { ...original, create: createSpy };
        }
        throw new Error(`Not found: ${specifier}`);
      };

      await registry.loadFromConfig(config, importFn);

      // The notifier should be registered with config
      const notifier = registry.get<Notifier>("notifier", "mock");
      expect(notifier).not.toBeNull();
      expect(notifier!.name).toBe("mock");
    });
  });

  describe("Manifest name mismatch detection", () => {
    it("logs error when expectedPluginName does not match manifest.name", async () => {
      const registry = createPluginRegistry();
      const config = makeTestConfig();

      // Set an expected name that doesn't match
      config._externalPluginEntries![0].expectedPluginName = "jira";

      const importFn = async (specifier: string): Promise<unknown> => {
        if (specifier.includes("tracker-mock")) {
          // Returns plugin with manifest.name = "mock", not "jira"
          return import(join(TEST_PLUGINS_DIR, "tracker-mock/dist/index.js"));
        }
        if (specifier.includes("scm-mock")) {
          return import(join(TEST_PLUGINS_DIR, "scm-mock/dist/index.js"));
        }
        if (specifier.includes("notifier-mock")) {
          return import(join(TEST_PLUGINS_DIR, "notifier-mock/dist/index.js"));
        }
        throw new Error(`Not found: ${specifier}`);
      };

      // Capture stderr to verify error is logged
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await registry.loadFromConfig(config, importFn);

      // Should log error about mismatch
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to load plugin"));

      stderrSpy.mockRestore();
    });
  });
});
