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

const {
  mockHomeRef,
  mockConfigRef,
  mockSessionManager,
  mockGlobalConfigRef,
  mockPreferencesRef,
  mockRunningRef,
  mockEventsDeleted,
} = vi.hoisted(() => ({
  mockHomeRef: { current: "/tmp/ao-reset-fallback-home" },
  mockConfigRef: { current: null as Record<string, unknown> | null },
  mockGlobalConfigRef: {
    current: null as { projects: Record<string, unknown>; projectOrder?: string[] } | null,
  },
  mockPreferencesRef: {
    current: { version: 1 } as {
      version: 1;
      defaultProjectId?: string;
      projectOrder?: string[];
      projects?: Record<string, { pinned?: boolean; enabled?: boolean }>;
    },
  },
  mockRunningRef: {
    current: null as { pid: number; port: number; projects: string[] } | null,
  },
  mockEventsDeleted: { current: [] as Array<{ projectId: string; rows: number }> },
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
    loadConfig: () => mockConfigRef.current,
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
    updatePreferences: (updater: (prefs: typeof mockPreferencesRef.current) => void) => {
      updater(mockPreferencesRef.current);
    },
    deleteEventsForProject: (projectId: string) => {
      const rows = projectId === "my-app" ? 3 : 0;
      mockEventsDeleted.current.push({ projectId, rows });
      return rows;
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
  mockPreferencesRef.current = { version: 1 };
  mockRunningRef.current = null;
  mockEventsDeleted.current = [];

  mkdirSync(join(tmpDir, "main-repo"), { recursive: true });

  program = new Command();
  program.exitOverride();
  registerReset(program);
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(mockPreferencesRef.current.projects?.["my-app"]).toBeUndefined();
    expect(mockPreferencesRef.current.projects?.["other-app"]).toBeDefined();
    expect(mockPreferencesRef.current.projectOrder).toEqual(["other-app"]);
    expect(mockPreferencesRef.current.defaultProjectId).toBeUndefined();
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
});
