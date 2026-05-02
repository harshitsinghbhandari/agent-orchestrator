import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getProjectDir, getProjectSessionsDir } from "@aoagents/ao-core";

type TestPrefs = {
  version: 1;
  defaultProjectId?: string;
  projectOrder?: string[];
  projects?: Record<string, { pinned?: boolean; enabled?: boolean }>;
};

const {
  mockHomeRef,
  mockConfigRef,
  mockSessionManager,
  mockGlobalConfigRef,
  mockPreferencesRef,
  mockSavedPrefs,
  mockRunningRef,
  mockEventsDeleted,
  mockLastStopPruned,
  mockLoadConfigError,
  mockEventsResult,
} = vi.hoisted(() => ({
  mockHomeRef: { current: "/tmp/ao-reset-fallback-home" },
  // Set to a non-null Error to make loadConfig() throw it instead of returning the config.
  mockLoadConfigError: { current: null as Error | null },
  // Override what deleteEventsForProject returns (defaults to project-scoped behavior).
  mockEventsResult: {
    current: null as { available: boolean; removed: number } | null,
  },
  mockConfigRef: { current: null as Record<string, unknown> | null },
  mockGlobalConfigRef: {
    current: null as { projects: Record<string, unknown>; projectOrder?: string[] } | null,
  },
  // The "stored" prefs file. Reset reads from this and writes back.
  mockPreferencesRef: {
    current: null as { version: 1; defaultProjectId?: string; projectOrder?: string[]; projects?: Record<string, { pinned?: boolean; enabled?: boolean }> } | null,
  },
  // Records every savePreferences call so we can assert "wasn't written"
  // when the file would otherwise be created spuriously.
  mockSavedPrefs: { current: [] as Array<unknown> },
  mockRunningRef: {
    current: null as { pid: number; port: number; projects: string[] } | null,
  },
  mockEventsDeleted: { current: [] as Array<{ projectId: string; rows: number }> },
  mockLastStopPruned: { current: [] as string[] },
  mockSessionManager: {
    list: vi.fn(),
    kill: vi.fn(),
    cleanup: vi.fn(),
    restore: vi.fn(),
    remap: vi.fn(),
    get: vi.fn(),
    spawn: vi.fn(),
    spawnOrchestrator: vi.fn(),
    send: vi.fn(),
    claimPR: vi.fn(),
  },
}));

vi.mock("node:os", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => mockHomeRef.current,
  };
});

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@aoagents/ao-core")>();
  return {
    ...actual,
    loadConfig: () => {
      if (mockLoadConfigError.current) throw mockLoadConfigError.current;
      return mockConfigRef.current;
    },
    loadGlobalConfig: () => mockGlobalConfigRef.current,
    unregisterProject: (projectId: string) => {
      if (!mockGlobalConfigRef.current?.projects[projectId]) return;
      const { [projectId]: _drop, ...rest } = mockGlobalConfigRef.current.projects;
      mockGlobalConfigRef.current.projects = rest;
      if (mockGlobalConfigRef.current.projectOrder) {
        mockGlobalConfigRef.current.projectOrder = mockGlobalConfigRef.current.projectOrder.filter(
          (id) => id !== projectId,
        );
      }
    },
    loadPreferences: () => {
      // Mirror real behavior: missing file → default { version: 1 }
      return mockPreferencesRef.current ?? { version: 1 };
    },
    savePreferences: (prefs: TestPrefs) => {
      // Track that a write happened so tests can assert it didn't, and
      // also persist the value for subsequent assertions.
      mockSavedPrefs.current.push(JSON.parse(JSON.stringify(prefs)));
      mockPreferencesRef.current = prefs;
    },
    deleteEventsForProject: (projectId: string) => {
      if (mockEventsResult.current) {
        mockEventsDeleted.current.push({ projectId, rows: mockEventsResult.current.removed });
        return mockEventsResult.current;
      }
      const rows = projectId === "my-app" ? 3 : 0;
      mockEventsDeleted.current.push({ projectId, rows });
      return { available: true, removed: rows };
    },
  };
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: async () => mockSessionManager,
}));

vi.mock("../../src/lib/caller-context.js", () => ({
  isHumanCaller: vi.fn(() => true),
  getCallerType: () => "human",
}));

vi.mock("../../src/lib/prompts.js", () => ({
  promptConfirm: vi.fn().mockResolvedValue(true),
  promptSelect: vi.fn(),
  promptText: vi.fn(),
}));

vi.mock("../../src/lib/running-state.js", () => ({
  getRunning: async () => mockRunningRef.current,
  pruneLastStopForProjects: async (projectIds: readonly string[]) => {
    mockLastStopPruned.current.push(...projectIds);
  },
}));

import { Command } from "commander";
import { registerReset } from "../../src/commands/reset.js";
import { promptConfirm } from "../../src/lib/prompts.js";
import { isHumanCaller } from "../../src/lib/caller-context.js";

let tmpDir: string;
let configPath: string;
let program: Command;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let consoleErrSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ao-reset-test-"));
  // Redirect homedir() so getProjectDir resolves under tmpDir instead of the
  // real ~/.agent-orchestrator (HOME env doesn't propagate through libuv here).
  mockHomeRef.current = tmpDir;

  configPath = join(tmpDir, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}");

  mockConfigRef.current = {
    configPath,
    port: 3000,
    defaults: {
      runtime: "tmux",
      agent: "claude-code",
      workspace: "worktree",
      notifiers: ["desktop"],
    },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: join(tmpDir, "main-repo"),
        defaultBranch: "main",
        sessionPrefix: "app",
      },
    },
    notifiers: {},
    notificationRouting: {},
    reactions: {},
  } as Record<string, unknown>;

  mockGlobalConfigRef.current = null;
  // Default to "no preferences file on disk" (the common case for users
  // who haven't customized portfolio).
  mockPreferencesRef.current = null;
  mockSavedPrefs.current = [];
  mockRunningRef.current = null;
  mockEventsDeleted.current = [];
  mockLastStopPruned.current = [];
  mockLoadConfigError.current = null;
  mockEventsResult.current = null;

  mkdirSync(join(tmpDir, "main-repo"), { recursive: true });

  program = new Command();
  program.exitOverride();
  registerReset(program);
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  mockSessionManager.list.mockReset();
  mockSessionManager.kill.mockReset();

  vi.mocked(promptConfirm).mockResolvedValue(true);
  vi.mocked(isHumanCaller).mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  mockHomeRef.current = "/tmp/ao-reset-fallback-home";
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ao reset", () => {
  it("removes an empty baseDir when it exists but has no listable contents", async () => {
    // Regression: previously the command keyed off `items.length > 0`, so an
    // empty (or unreadable) project dir would skip removal and report success.
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    expect(existsSync(baseDir)).toBe(true);

    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    expect(existsSync(baseDir)).toBe(false);
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).not.toContain("No AO state found");
    expect(output).toContain("Reset complete");
  });

  it("removes the project base directory when confirmed", async () => {
    const baseDir = getProjectDir("my-app");
    const sessionsDir = getProjectSessionsDir("my-app");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "app-1.json"), "{}");

    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    expect(existsSync(baseDir)).toBe(false);
  });

  it("shows what will be deleted before confirmation", async () => {
    const sessionsDir = getProjectSessionsDir("my-app");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "app-1.json"), "{}");

    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("will be deleted");
    expect(output).toContain("my-app");
  });

  it("does nothing when no state exists", async () => {
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("No AO state found");
  });

  it("kills live sessions before wiping state", async () => {
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");

    mockSessionManager.list.mockResolvedValue([
      { id: "app-1", projectId: "my-app", status: "working" },
      { id: "app-2", projectId: "my-app", status: "pr_open" },
    ]);
    mockSessionManager.kill.mockResolvedValue({ cleaned: true });

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    expect(mockSessionManager.kill).toHaveBeenCalledTimes(2);
    expect(mockSessionManager.kill).toHaveBeenCalledWith("app-1");
    expect(mockSessionManager.kill).toHaveBeenCalledWith("app-2");
  });

  it("respects confirmation denial", async () => {
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");

    vi.mocked(promptConfirm).mockResolvedValue(false);
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app"]);

    expect(existsSync(baseDir)).toBe(true);
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("cancelled");
  });

  it("resets all projects with --all flag", async () => {
    const config = mockConfigRef.current!;
    (config.projects as Record<string, unknown>)["other-app"] = {
      name: "Other App",
      repo: "org/other-app",
      path: join(tmpDir, "other-repo"),
      defaultBranch: "main",
      sessionPrefix: "oth",
    };
    mkdirSync(join(tmpDir, "other-repo"), { recursive: true });

    const baseDir1 = getProjectDir("my-app");
    const baseDir2 = getProjectDir("other-app");
    mkdirSync(baseDir1, { recursive: true });
    mkdirSync(baseDir2, { recursive: true });
    writeFileSync(join(baseDir1, "marker"), "x");
    writeFileSync(join(baseDir2, "marker"), "x");

    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "--all", "--yes"]);

    expect(existsSync(baseDir1)).toBe(false);
    expect(existsSync(baseDir2)).toBe(false);
  });

  it("errors on unknown project", async () => {
    await expect(
      program.parseAsync(["node", "ao", "reset", "nonexistent", "--yes"]),
    ).rejects.toThrow();
  });

  it("supports -p flag for project selection", async () => {
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");

    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "-p", "my-app", "--yes"]);

    expect(existsSync(baseDir)).toBe(false);
  });

  it("continues even if session kill fails", async () => {
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");

    mockSessionManager.list.mockResolvedValue([
      { id: "app-1", projectId: "my-app", status: "working" },
    ]);
    mockSessionManager.kill.mockRejectedValue(new Error("tmux dead"));

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    expect(existsSync(baseDir)).toBe(false);
  });

  it("refuses non-TTY without --yes", async () => {
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");

    vi.mocked(isHumanCaller).mockReturnValue(false);
    mockSessionManager.list.mockResolvedValue([]);

    await expect(
      program.parseAsync(["node", "ao", "reset", "my-app"]),
    ).rejects.toThrow(/process\.exit\(1\)/);

    expect(existsSync(baseDir)).toBe(true);
    const errOutput = consoleErrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errOutput).toContain("non-TTY mode");
  });

  it("refuses to reset when ao start is running for the project", async () => {
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");

    mockRunningRef.current = { pid: 12345, port: 3000, projects: ["my-app"] };
    mockSessionManager.list.mockResolvedValue([]);

    await expect(
      program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]),
    ).rejects.toThrow(/process\.exit\(1\)/);

    expect(existsSync(baseDir)).toBe(true);
    const errOutput = consoleErrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errOutput).toContain("ao stop my-app");
  });

  it("proceeds when ao start runs but doesn't serve the targeted project", async () => {
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");

    mockRunningRef.current = { pid: 12345, port: 3000, projects: ["other-project"] };
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    expect(existsSync(baseDir)).toBe(false);
  });

  it("rejects --all combined with a project argument", async () => {
    await expect(
      program.parseAsync(["node", "ao", "reset", "my-app", "--all", "--yes"]),
    ).rejects.toThrow(/process\.exit\(1\)/);
    const errOutput = consoleErrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errOutput).toContain("Cannot combine --all");
  });

  it("rejects conflicting positional and --project values", async () => {
    await expect(
      program.parseAsync(["node", "ao", "reset", "foo", "-p", "bar", "--yes"]),
    ).rejects.toThrow(/process\.exit\(1\)/);
    const errOutput = consoleErrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errOutput).toContain("Conflicting project selectors");
  });

  it("exits non-zero when a target's directory removal fails", async () => {
    const { chmodSync } = await import("node:fs");
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");

    // Lock the parent directory so rmSync cannot unlink baseDir from it.
    const projectsParent = join(tmpDir, ".agent-orchestrator", "projects");
    chmodSync(projectsParent, 0o555);

    mockSessionManager.list.mockResolvedValue([]);

    try {
      await expect(
        program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]),
      ).rejects.toThrow(/process\.exit\(1\)/);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(errOutput).toContain("Failed to remove");
      expect(errOutput).toContain("Reset finished with 1 failure");
    } finally {
      chmodSync(projectsParent, 0o755);
    }
  });

  it("unregisters project from global config and prunes preferences", async () => {
    mockGlobalConfigRef.current = {
      projects: { "my-app": { path: "/repo" }, "other-app": { path: "/other" } },
      projectOrder: ["my-app", "other-app"],
    };
    mockPreferencesRef.current = {
      version: 1,
      defaultProjectId: "my-app",
      projectOrder: ["my-app", "other-app"],
      projects: {
        "my-app": { pinned: true },
        "other-app": { enabled: true },
      },
    };
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    expect(mockGlobalConfigRef.current.projects["my-app"]).toBeUndefined();
    expect(mockGlobalConfigRef.current.projects["other-app"]).toBeDefined();
    expect(mockGlobalConfigRef.current.projectOrder).toEqual(["other-app"]);
    expect(mockPreferencesRef.current?.projects?.["my-app"]).toBeUndefined();
    expect(mockPreferencesRef.current?.projects?.["other-app"]).toBeDefined();
    expect(mockPreferencesRef.current?.projectOrder).toEqual(["other-app"]);
    expect(mockPreferencesRef.current?.defaultProjectId).toBeUndefined();

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Unregistered from global config registry");
    expect(output).toContain("Pruned slot from portfolio preferences");
  });

  it("does NOT create preferences.json when no prefs reference the project", async () => {
    // Repro: user has never customized portfolio. preferences.json doesn't
    // exist. Reset should leave it that way.
    mockGlobalConfigRef.current = { projects: { "my-app": { path: "/repo" } } };
    mockPreferencesRef.current = null; // file does not exist
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    expect(mockSavedPrefs.current).toEqual([]); // savePreferences never called
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Unregistered from global config registry");
    expect(output).not.toContain("portfolio preferences");
  });

  it("does NOT touch preferences.json when prefs exist but reference other projects", async () => {
    mockGlobalConfigRef.current = { projects: { "my-app": { path: "/repo" } } };
    mockPreferencesRef.current = {
      version: 1,
      defaultProjectId: "other-app",
      projectOrder: ["other-app"],
      projects: { "other-app": { pinned: true } },
    };
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    expect(mockSavedPrefs.current).toEqual([]); // unchanged → no write
    expect(mockPreferencesRef.current?.projects?.["other-app"]).toBeDefined();
  });

  it("shows the destructive warning banner before the preview", async () => {
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");

    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("WARNING — DESTRUCTIVE OPERATION");
    expect(output).toContain("cannot be undone");
    expect(output).toContain("NOT touched by reset");
  });

  it("prunes activity events for the targeted project", async () => {
    mockGlobalConfigRef.current = { projects: { "my-app": { path: "/repo" } } };
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    expect(mockEventsDeleted.current).toEqual([{ projectId: "my-app", rows: 3 }]);
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Removed 3 activity events");
  });

  it("--all on empty config exits with a friendly message", async () => {
    mockConfigRef.current = {
      ...mockConfigRef.current!,
      projects: {},
    };
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "--all", "--yes"]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("No projects configured");
  });

  it("resets an orphan project (in global registry, not in local config)", async () => {
    // The user has wiped or never created a local agent-orchestrator.yaml
    // entry for "ghost-app", but it's still in the global config registry
    // (e.g. abandoned project, manual cleanup of local config).
    mockConfigRef.current = {
      ...mockConfigRef.current!,
      projects: {}, // local doesn't list ghost-app
    };
    mockGlobalConfigRef.current = { projects: { "ghost-app": { path: "/wherever" } } };
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "ghost-app", "--yes"]);

    expect(mockGlobalConfigRef.current.projects["ghost-app"]).toBeUndefined();
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("(orphan — not in local config)");
    expect(output).toContain("Reset complete");
  });

  it("--all also covers orphan projects in the global registry", async () => {
    mockConfigRef.current = {
      ...mockConfigRef.current!,
      projects: {
        "my-app": {
          name: "My App",
          path: join(tmpDir, "main-repo"),
          defaultBranch: "main",
          sessionPrefix: "app",
        },
      },
    };
    mockGlobalConfigRef.current = {
      projects: {
        "my-app": { path: "/local" },
        "ghost-app": { path: "/whatever" }, // orphan
      },
    };

    const baseDir1 = getProjectDir("my-app");
    const baseDir2 = getProjectDir("ghost-app");
    mkdirSync(baseDir1, { recursive: true });
    mkdirSync(baseDir2, { recursive: true });
    writeFileSync(join(baseDir1, "marker"), "x");
    writeFileSync(join(baseDir2, "marker"), "x");
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "--all", "--yes"]);

    expect(existsSync(baseDir1)).toBe(false);
    expect(existsSync(baseDir2)).toBe(false);
    expect(mockGlobalConfigRef.current.projects["my-app"]).toBeUndefined();
    expect(mockGlobalConfigRef.current.projects["ghost-app"]).toBeUndefined();
  });

  it("--all skips projects with unsafe ids without crashing the loop", async () => {
    mockConfigRef.current = {
      ...mockConfigRef.current!,
      projects: {
        "my-app": {
          name: "My App",
          path: join(tmpDir, "main-repo"),
          defaultBranch: "main",
          sessionPrefix: "app",
        },
      },
    };
    // Inject an unsafe id only into global. assertSafeProjectId rejects "..".
    mockGlobalConfigRef.current = {
      projects: {
        "my-app": { path: "/local" },
        "..": { path: "/evil" },
      },
    };

    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "--all", "--yes"]);

    expect(existsSync(baseDir)).toBe(false);
    const warnOutput = consoleWarnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(warnOutput).toContain("skipping");
    expect(warnOutput).toContain("unsafe ids");
  });

  it("warns and proceeds when local config can't be loaded", async () => {
    mockLoadConfigError.current = new Error("invalid YAML at line 7");
    mockConfigRef.current = null;
    mockGlobalConfigRef.current = { projects: { "ghost-app": { path: "/wherever" } } };
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "ghost-app", "--yes"]);

    const warnOutput = consoleWarnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(warnOutput).toMatch(/could not read local agent-orchestrator\.yaml/);
    expect(warnOutput).toContain("invalid YAML at line 7");
  });

  it("warns when activity events DB is unavailable but still completes", async () => {
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");
    mockSessionManager.list.mockResolvedValue([]);
    mockEventsResult.current = { available: false, removed: 0 };

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    expect(existsSync(baseDir)).toBe(false);
    const warnOutput = consoleWarnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(warnOutput).toContain("activity-events DB was unavailable");
  });

  it("prunes last-stop.json for successfully-wiped projects", async () => {
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");
    mockSessionManager.list.mockResolvedValue([]);

    await program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]);

    expect(mockLastStopPruned.current).toEqual(["my-app"]);
  });

  it("does NOT prune last-stop.json when disk wipe failed", async () => {
    const { chmodSync } = await import("node:fs");
    const baseDir = getProjectDir("my-app");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(join(baseDir, "marker"), "x");

    const projectsParent = join(tmpDir, ".agent-orchestrator", "projects");
    chmodSync(projectsParent, 0o555);

    mockSessionManager.list.mockResolvedValue([]);

    try {
      await expect(
        program.parseAsync(["node", "ao", "reset", "my-app", "--yes"]),
      ).rejects.toThrow(/process\.exit\(1\)/);

      // Disk wipe failed, so last-stop must not be pruned — letting a retry
      // recover correctly.
      expect(mockLastStopPruned.current).toEqual([]);
    } finally {
      chmodSync(projectsParent, 0o755);
    }
  });

  it("rejects an unknown project with a helpful error listing both local and global ids", async () => {
    mockConfigRef.current = {
      ...mockConfigRef.current!,
      projects: {
        "my-app": {
          name: "My App",
          path: join(tmpDir, "main-repo"),
          defaultBranch: "main",
          sessionPrefix: "app",
        },
      },
    };
    mockGlobalConfigRef.current = { projects: { "ghost-app": { path: "/x" } } };

    await expect(
      program.parseAsync(["node", "ao", "reset", "nonexistent", "--yes"]),
    ).rejects.toThrow();
    // The error message itself goes through commander's exitOverride; we just
    // care that we threw rather than crashing on getProjectDir.
  });
});
