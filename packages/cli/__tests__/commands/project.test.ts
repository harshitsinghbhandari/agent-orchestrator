import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

const {
  mockGetPortfolio,
  mockGetPortfolioSessionCounts,
  mockRegisterProject,
  mockUnregisterProject,
  mockLoadGlobalConfig,
  mockLoadPreferences,
  mockSavePreferences,
  mockLoadLocalProjectConfig,
  mockDeriveAvailableProjectId,
  mockPromptText,
} = vi.hoisted(() => ({
  mockGetPortfolio: vi.fn(),
  mockGetPortfolioSessionCounts: vi.fn(),
  mockRegisterProject: vi.fn(),
  mockUnregisterProject: vi.fn(),
  mockLoadGlobalConfig: vi.fn(),
  mockLoadPreferences: vi.fn(),
  mockSavePreferences: vi.fn(),
  mockLoadLocalProjectConfig: vi.fn(),
  mockDeriveAvailableProjectId: vi.fn(),
  mockPromptText: vi.fn(),
}));

vi.mock("@aoagents/ao-core", () => ({
  isPortfolioEnabled: () => true,
  getPortfolio: mockGetPortfolio,
  getPortfolioSessionCounts: mockGetPortfolioSessionCounts,
  registerProject: mockRegisterProject,
  unregisterProject: mockUnregisterProject,
  loadGlobalConfig: mockLoadGlobalConfig,
  loadPreferences: mockLoadPreferences,
  savePreferences: mockSavePreferences,
  loadLocalProjectConfig: mockLoadLocalProjectConfig,
  deriveAvailableProjectId: mockDeriveAvailableProjectId,
  loadConfig: vi.fn(),
}));

vi.mock("../../src/lib/portfolio-display.js", () => ({
  formatPortfolioDegradedReason: vi.fn().mockReturnValue(null),
  formatPortfolioProjectName: vi.fn().mockReturnValue(""),
  formatPortfolioProjectStatus: vi.fn().mockReturnValue("idle"),
}));

vi.mock("../../src/lib/caller-context.js", () => ({
  isHumanCaller: vi.fn(() => true),
}));

vi.mock("../../src/lib/prompts.js", () => ({
  promptConfirm: vi.fn(async () => true),
  promptText: mockPromptText,
}));

import { registerProject_cmd } from "../../src/commands/project.js";

let program: Command;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let _exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  program = new Command();
  program.exitOverride();
  registerProject_cmd(program);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  _exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`EXIT:${code}`);
  }) as typeof process.exit);
  mockLoadGlobalConfig.mockReturnValue({ projects: {} });
  mockDeriveAvailableProjectId.mockImplementation((projectId: string) => ({
    projectId,
    collision: false,
  }));
  mockPromptText.mockResolvedValue("");
});

describe("ao project ls", () => {
  it("prints message when portfolio is empty", async () => {
    mockGetPortfolio.mockReturnValue([]);

    await program.parseAsync(["node", "ao", "project", "ls"]);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("No projects in portfolio"),
    );
  });

  it("lists projects with session counts", async () => {
    mockGetPortfolio.mockReturnValue([
      { id: "app-1", name: "App One", source: "/tmp/app-1", pinned: false, enabled: true },
    ]);
    mockGetPortfolioSessionCounts.mockResolvedValue({
      "app-1": { total: 3, active: 1 },
    });
    mockLoadPreferences.mockReturnValue({ defaultProjectId: null });

    await program.parseAsync(["node", "ao", "project", "ls"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("app-1"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("3 sessions"));
  });

  it("marks default project", async () => {
    mockGetPortfolio.mockReturnValue([
      { id: "app-1", name: "App One", source: "/tmp/app-1", pinned: false, enabled: true },
    ]);
    mockGetPortfolioSessionCounts.mockResolvedValue({
      "app-1": { total: 0, active: 0 },
    });
    mockLoadPreferences.mockReturnValue({ defaultProjectId: "app-1" });

    await program.parseAsync(["node", "ao", "project", "ls"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("default"));
  });
});

describe("ao project add", () => {
  it("registers a valid project path", async () => {
    mockLoadLocalProjectConfig.mockReturnValue({ projects: {} });

    await program.parseAsync(["node", "ao", "project", "add", "/tmp/my-project"]);

    expect(mockRegisterProject).toHaveBeenCalledWith(
      expect.stringContaining("my-project"),
      "my-project",
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Registered"));
  });

  it("exits with error when no config found at path", async () => {
    mockLoadLocalProjectConfig.mockReturnValue(null);

    await expect(
      program.parseAsync(["node", "ao", "project", "add", "/tmp/no-config"]),
    ).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("No agent-orchestrator.yaml"),
    );
  });

  it("passes --key option to registerProject", async () => {
    mockLoadLocalProjectConfig.mockReturnValue({ projects: {} });

    await program.parseAsync([
      "node", "ao", "project", "add", "/tmp/my-project", "-k", "custom-key",
    ]);

    expect(mockRegisterProject).toHaveBeenCalledWith(
      expect.stringContaining("my-project"),
      "custom-key",
    );
  });

  it("prompts with a suffixed project ID when the derived ID already exists", async () => {
    mockLoadLocalProjectConfig.mockReturnValue({ projects: {} });
    mockDeriveAvailableProjectId.mockReturnValueOnce({
      projectId: "agent-orchestrator-1",
      collision: true,
      existingProjectId: "agent-orchestrator",
    });
    mockPromptText.mockResolvedValueOnce("agent-orchestrator-client");

    await program.parseAsync(["node", "ao", "project", "add", "/tmp/agent-orchestrator"]);

    expect(mockPromptText).toHaveBeenCalledWith(
      expect.stringContaining('Project ID "agent-orchestrator" already exists'),
      "agent-orchestrator-1",
      "agent-orchestrator-1",
    );
    expect(mockRegisterProject).toHaveBeenCalledWith(
      expect.stringContaining("agent-orchestrator"),
      "agent-orchestrator-client",
    );
  });

  it("uses the suffixed project ID without prompting when --default is provided", async () => {
    mockLoadLocalProjectConfig.mockReturnValue({ projects: {} });
    mockDeriveAvailableProjectId.mockReturnValueOnce({
      projectId: "agent-orchestrator-1",
      collision: true,
      existingProjectId: "agent-orchestrator",
    });

    await program.parseAsync(["node", "ao", "project", "add", "/tmp/agent-orchestrator", "--default"]);

    expect(mockPromptText).not.toHaveBeenCalled();
    expect(mockRegisterProject).toHaveBeenCalledWith(
      expect.stringContaining("agent-orchestrator"),
      "agent-orchestrator-1",
    );
  });

  it("surfaces duplicate path collisions as errors", async () => {
    mockLoadLocalProjectConfig.mockReturnValue({ projects: {} });
    mockRegisterProject.mockImplementationOnce(() => {
      throw new Error('Project "existing-proj" is already registered at "/tmp/my-project". Choose a different project ID or path.');
    });

    await expect(
      program.parseAsync(["node", "ao", "project", "add", "/tmp/my-project"]),
    ).rejects.toThrow();

    expect(mockRegisterProject).toHaveBeenCalledTimes(1);
  });
});

describe("ao project rm", () => {
  it("removes an existing project", async () => {
    mockGetPortfolio.mockReturnValue([
      { id: "app-1", name: "App One", source: "/tmp/app-1" },
    ]);

    await program.parseAsync(["node", "ao", "project", "rm", "app-1"]);

    expect(mockUnregisterProject).toHaveBeenCalledWith("app-1");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Removed"));
  });

  it("exits with error when project not found", async () => {
    mockGetPortfolio.mockReturnValue([]);

    await expect(
      program.parseAsync(["node", "ao", "project", "rm", "nonexistent"]),
    ).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });
});

describe("ao project set-default", () => {
  it("sets default project", async () => {
    mockGetPortfolio.mockReturnValue([
      { id: "app-1", name: "App One", source: "/tmp/app-1" },
    ]);
    mockLoadPreferences.mockReturnValue({ defaultProjectId: null });

    await program.parseAsync(["node", "ao", "project", "set-default", "app-1"]);

    expect(mockSavePreferences).toHaveBeenCalledWith({ defaultProjectId: "app-1" });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Set default"));
  });

  it("exits with error when project not found", async () => {
    mockGetPortfolio.mockReturnValue([]);

    await expect(
      program.parseAsync(["node", "ao", "project", "set-default", "nonexistent"]),
    ).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });
});
