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
import type { SessionManager } from "@aoagents/ao-core";

// Hoisted mocks - these can be updated in beforeEach
const {
  mockConfigRef,
  mockSessionManager,
  mockListTmuxSessions,
  mockKillTmuxSession,
  mockReadlineQuestion,
  mockPathsRef,
} = vi.hoisted(() => ({
  mockConfigRef: { current: null as Record<string, unknown> | null },
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
  mockListTmuxSessions: vi.fn(),
  mockKillTmuxSession: vi.fn(),
  mockReadlineQuestion: vi.fn(),
  mockPathsRef: {
    sessionsDir: "",
    archiveDir: "",
    worktreesDir: "",
  },
}));

vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    question: mockReadlineQuestion,
    close: vi.fn(),
  })),
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@aoagents/ao-core")>();
  return {
    ...actual,
    loadConfig: () => mockConfigRef.current,
    listTmuxSessions: () => mockListTmuxSessions(),
    killTmuxSession: (name: string) => mockKillTmuxSession(name),
    // Mock path functions to return our test directories
    getSessionsDir: () => mockPathsRef.sessionsDir,
    getArchiveDir: () => mockPathsRef.archiveDir,
    getWorktreesDir: () => mockPathsRef.worktreesDir,
  };
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: async (): Promise<SessionManager> => mockSessionManager as SessionManager,
}));

describe("ao cleanup --all", () => {
  let tempDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create temp directories
    tempDir = mkdtempSync(join(tmpdir(), "ao-cleanup-test-"));
    const sessionsDir = join(tempDir, "sessions");
    const archiveDir = join(sessionsDir, "archive");
    const worktreesDir = join(tempDir, "worktrees");

    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(archiveDir, { recursive: true });
    mkdirSync(worktreesDir, { recursive: true });

    // Update mock paths ref so mocked functions return correct directories
    mockPathsRef.sessionsDir = sessionsDir;
    mockPathsRef.archiveDir = archiveDir;
    mockPathsRef.worktreesDir = worktreesDir;

    // Setup mock config
    mockConfigRef.current = {
      configPath: join(tempDir, "agent-orchestrator.yaml"),
      projects: {
        "test-project": {
          path: tempDir,
          name: "Test Project",
          sessionPrefix: "tp",
          repo: "https://github.com/test/project",
        },
      },
      defaults: {
        agent: "claude-code",
        runtime: "tmux",
        workspace: "worktree",
      },
    };

    // Reset mocks
    mockListTmuxSessions.mockResolvedValue([]);
    mockKillTmuxSession.mockResolvedValue(undefined);
    mockSessionManager.kill.mockResolvedValue(undefined);

    // Spy on console and process
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("requires --all flag", async () => {
    // Make process.exit throw to actually stop execution
    processExitSpy.mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    const { registerCleanup } = await import("../../src/commands/cleanup.js");
    const { Command } = await import("commander");

    const program = new Command();
    registerCleanup(program);

    await expect(program.parseAsync(["node", "ao", "cleanup"])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--all flag is required"),
    );
  });

  it("rejects unknown project", async () => {
    // Make process.exit throw to actually stop execution
    processExitSpy.mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    const { registerCleanup } = await import("../../src/commands/cleanup.js");
    const { Command } = await import("commander");

    const program = new Command();
    registerCleanup(program);

    await expect(
      program.parseAsync(["node", "ao", "cleanup", "--all", "-p", "nonexistent"]),
    ).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown project: nonexistent"),
    );
  });

  it("aborts cleanup when user answers no to first confirmation", async () => {
    // Create an orchestrator session in the mocked sessions directory
    writeFileSync(
      join(mockPathsRef.sessionsDir, "tp-orchestrator-1"),
      "status=working\nrole=orchestrator\n",
    );

    // Mock readline to answer "no"
    mockReadlineQuestion.mockImplementation(
      (_question: string, callback: (answer: string) => void) => {
        callback("no");
      },
    );

    const { registerCleanup } = await import("../../src/commands/cleanup.js");
    const { Command } = await import("commander");

    const program = new Command();
    registerCleanup(program);

    await program.parseAsync(["node", "ao", "cleanup", "--all"]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cleanup aborted"));
    expect(mockSessionManager.kill).not.toHaveBeenCalled();
  });

  it("rejects AI agents when they answer yes to AI check", async () => {
    // Make process.exit throw to actually stop execution
    processExitSpy.mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    // Create a worker session in the mocked sessions directory
    writeFileSync(join(mockPathsRef.sessionsDir, "tp-1"), "status=working\n");

    // Answer yes to all questions including AI check
    mockReadlineQuestion.mockImplementation(
      (_question: string, callback: (answer: string) => void) => {
        callback("yes");
      },
    );

    const { registerCleanup } = await import("../../src/commands/cleanup.js");
    const { Command } = await import("commander");

    const program = new Command();
    registerCleanup(program);

    await expect(program.parseAsync(["node", "ao", "cleanup", "--all"])).rejects.toThrow(
      "process.exit(1)",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("cannot be run by AI agents"),
    );
  });

  it("executes cleanup when human confirms all prompts", async () => {
    // Create a worker session in the mocked sessions directory
    writeFileSync(join(mockPathsRef.sessionsDir, "tp-1"), "status=working\nworktree=/tmp/tp-1\n");

    // Track question count to give different answers
    let questionCount = 0;
    mockReadlineQuestion.mockImplementation(
      (_question: string, callback: (answer: string) => void) => {
        questionCount++;
        // Human user: yes to worker confirm, yes to metadata confirm, no to AI check
        if (questionCount <= 2) {
          callback("yes");
        } else {
          callback("no"); // AI check - human answers "no"
        }
      },
    );

    const { registerCleanup } = await import("../../src/commands/cleanup.js");
    const { Command } = await import("commander");

    const program = new Command();
    registerCleanup(program);

    await program.parseAsync(["node", "ao", "cleanup", "--all"]);

    // Should have called kill for the worker session
    expect(mockSessionManager.kill).toHaveBeenCalledWith("tp-1");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cleanup complete"));
  });

  it("shows cleanup summary before confirmations", async () => {
    // Create mixed sessions in the mocked directories
    writeFileSync(join(mockPathsRef.sessionsDir, "tp-1"), "status=working\n");
    writeFileSync(join(mockPathsRef.sessionsDir, "tp-2"), "status=working\n");
    writeFileSync(
      join(mockPathsRef.sessionsDir, "tp-orchestrator-1"),
      "status=working\nrole=orchestrator\n",
    );
    writeFileSync(join(mockPathsRef.archiveDir, "tp-0_2025-01-01T00-00-00Z"), "status=done\n");

    // Abort on first question
    mockReadlineQuestion.mockImplementation(
      (_question: string, callback: (answer: string) => void) => {
        callback("no");
      },
    );

    const { registerCleanup } = await import("../../src/commands/cleanup.js");
    const { Command } = await import("commander");

    const program = new Command();
    registerCleanup(program);

    await program.parseAsync(["node", "ao", "cleanup", "--all"]);

    // Should show summary with correct counts
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cleanup Summary"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Orchestrator sessions:"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Worker sessions:"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Archive files:"));
  });
});
