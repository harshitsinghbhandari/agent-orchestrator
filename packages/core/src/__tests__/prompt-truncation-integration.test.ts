import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSessionManager } from "../session-manager.js";
import type { OrchestratorConfig, PluginRegistry, Agent, WorkspaceInfo } from "../types.js";
import { setupTestContext, teardownTestContext, type TestContext } from "./test-utils.js";
import { readMetadataRaw } from "../metadata.js";

let ctx: TestContext;
let sessionsDir: string;
let mockRegistry: PluginRegistry;
let config: OrchestratorConfig;

beforeEach(() => {
  ctx = setupTestContext();
  ({ sessionsDir, mockRegistry, config } = ctx);

  const mockAgent: Agent = {
    name: "mock-agent",
    processName: "mock-agent",
    getLaunchCommand: vi.fn().mockReturnValue("mock start"),
    getEnvironment: vi.fn().mockReturnValue({}),
    detectActivity: vi.fn().mockReturnValue("active"),
    getActivityState: vi.fn().mockResolvedValue({ state: "active" }),
    isProcessRunning: vi.fn().mockResolvedValue(true),
    getSessionInfo: vi.fn().mockResolvedValue(null),
  };

  const originalGet = mockRegistry.get;
  mockRegistry.get = vi.fn().mockImplementation((slot: string, name?: string) => {
    if (slot === "agent" && name === "mock-agent") return mockAgent;
    if (slot === "workspace") {
      return {
        name: "mock-workspace",
        create: vi.fn().mockResolvedValue({
          path: "/tmp/mock-ws",
          branch: "main",
          sessionId: "mock-1",
          projectId: "my-app"
        } as WorkspaceInfo),
        destroy: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
      };
    }
    if (slot === "runtime") {
      return {
        name: "mock-runtime",
        create: vi.fn().mockResolvedValue({ id: "mock-rt", runtimeName: "mock-runtime", data: {} }),
        destroy: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        getOutput: vi.fn().mockResolvedValue(""),
        isAlive: vi.fn().mockResolvedValue(true),
      };
    }
    return (originalGet as any)(slot, name);
  });

  config.defaults.agent = "mock-agent";
  // Add some long rules so the prompt naturally gets large
  config.projects["my-app"]!.agentRules = "A".repeat(10000); 
});

afterEach(() => {
  teardownTestContext(ctx);
  vi.restoreAllMocks();
});

describe("Prompt Truncation Integration", () => {
  it("truncates prompt and saves report when maxPromptTokens is exceeded", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    // Force a very low maxPromptTokens to guarantee truncation
    const session = await sm.spawn({
      projectId: "my-app",
      issueId: "INT-999",
      prompt: "Fix the bug",
      maxPromptTokens: 100, // Very low budget
    });

    const meta = readMetadataRaw(sessionsDir, session.id);
    expect(meta).not.toBeNull();
    
    // truncationReport should be defined in metadata
    expect(meta!.promptTruncationReport).toBeDefined();
    
    const report = JSON.parse(meta!.promptTruncationReport);
    expect(report.originalTokens).toBeGreaterThan(100);
    expect(report.finalTokens).toBeLessThan(200); 
    expect(report.truncatedSections.length).toBeGreaterThan(0);
  });

  it("does not truncate prompt when maxPromptTokens is large enough", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawn({
      projectId: "my-app",
      issueId: "INT-999",
      prompt: "Fix the bug",
      maxPromptTokens: 50000, // Very high budget
    });

    const meta = readMetadataRaw(sessionsDir, session.id);
    expect(meta).not.toBeNull();
    
    // truncationReport should NOT be defined in metadata
    expect(meta!.promptTruncationReport).toBeUndefined();
  });
});
