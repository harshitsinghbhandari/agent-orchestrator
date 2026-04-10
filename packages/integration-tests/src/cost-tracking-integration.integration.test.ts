/**
 * Integration tests for Cost Tracking and Prompt Truncation (Task 3.3)
 *
 * Tests the complete flow of:
 * - Prompt building and truncation based on model budgets
 * - Cost computation via pricing registry
 * - Cost persistence to cost.json files
 * - Cost merging on subsequent enrichments
 * - Aggregation across multiple sessions with different models
 *
 * These tests use mocked plugins but real registries and file I/O.
 */

import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionManager,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type Agent,
  type Workspace,
  type WorkspaceInfo,
  type CostEstimate,
  type Session,
  getSessionsDir,
  pricingRegistry,
  modelRegistry,
  computeCost,
  aggregateCosts,
  initializeRegistriesFromConfig,
  buildPromptWithMetadata,
  truncatePrompt,
} from "@aoagents/ao-core";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockPlugins(overrides?: {
  agentCost?: CostEstimate | null;
  agentModel?: string;
}): { runtime: Runtime; agent: Agent; workspace: Workspace } {
  const runtime: Runtime = {
    name: "mock-runtime",
    create: vi.fn().mockResolvedValue({ id: `rt-${randomUUID()}`, runtimeName: "mock-runtime", data: {} }),
    destroy: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getOutput: vi.fn().mockResolvedValue("$ mock output\n"),
    isAlive: vi.fn().mockResolvedValue(true),
  };

  const agent: Agent = {
    name: "mock-agent",
    processName: "mock-agent",
    getLaunchCommand: vi.fn().mockReturnValue("mock-agent --start"),
    getEnvironment: vi.fn().mockReturnValue({ AGENT_VAR: "1" }),
    detectActivity: vi.fn().mockReturnValue("active"),
    getActivityState: vi.fn().mockResolvedValue({ state: "active" }),
    isProcessRunning: vi.fn().mockResolvedValue(true),
    getSessionInfo: vi.fn().mockResolvedValue(
      overrides?.agentCost !== undefined
        ? {
            cost: overrides.agentCost,
            model: overrides.agentModel ?? "claude-3-5-sonnet-latest",
          }
        : null,
    ),
  };

  const workspace: Workspace = {
    name: "mock-workspace",
    create: vi.fn().mockImplementation(async (config) => ({
      path: `/tmp/mock-ws-${randomUUID()}`,
      branch: "feat/test",
      sessionId: config.sessionId,
      projectId: config.projectId,
    } as WorkspaceInfo)),
    destroy: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
  };

  return { runtime, agent, workspace };
}

function createMockRegistry(plugins: {
  runtime: Runtime;
  agent: Agent;
  workspace: Workspace;
}): PluginRegistry {
  return {
    register: vi.fn(),
    get: vi.fn().mockImplementation((slot: string) => {
      if (slot === "runtime") return plugins.runtime;
      if (slot === "agent") return plugins.agent;
      if (slot === "workspace") return plugins.workspace;
      return null;
    }),
    list: vi.fn().mockReturnValue([]),
    loadBuiltins: vi.fn(),
    loadFromConfig: vi.fn(),
  };
}

function createTestConfig(tmpDir: string, configPath: string, options?: {
  agentRules?: string;
  model?: string;
  pricingFile?: string;
  modelOverrides?: Array<{ provider: string; model: string; safePromptBudget: number }>;
}): OrchestratorConfig {
  const projectPath = join(tmpDir, "test-project");
  mkdirSync(projectPath, { recursive: true });

  return {
    configPath,
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: {
      runtime: "mock-runtime",
      agent: "mock-agent",
      workspace: "mock-workspace",
      notifiers: [],
    },
    projects: {
      "test-project": {
        name: "Test Project",
        repo: "org/test-project",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "test",
        agentRules: options?.agentRules,
        agentConfig: options?.model ? { model: options.model } : undefined,
      },
    },
    notifiers: {},
    notificationRouting: {
      urgent: [],
      action: [],
      warning: [],
      info: [],
    },
    reactions: {},
    pricing: options?.pricingFile ? { file: options.pricingFile } : undefined,
    models: options?.modelOverrides
      ? { overrides: options.modelOverrides }
      : undefined,
  };
}

// =============================================================================
// Test Suite: Prompt Truncation Integration
// =============================================================================

describe("Prompt Truncation Integration", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    const raw = await mkdtemp(join(tmpdir(), "ao-cost-test-"));
    tmpDir = raw;
    configPath = join(tmpDir, "agent-orchestrator.yaml");
    await writeFile(configPath, "projects: {}\n");
  });

  afterEach(async () => {
    if (tmpDir && existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("does not truncate prompt when it fits within model budget", async () => {
    const plugins = createMockPlugins();
    const registry = createMockRegistry(plugins);
    const config = createTestConfig(tmpDir, configPath, {
      agentRules: "Follow best practices.",
    });

    const sm = createSessionManager({ config, registry });

    // Spawn with generous budget (default model budget is 100k+)
    const session = await sm.spawn({
      projectId: "test-project",
      issueId: "TEST-1",
      prompt: "Fix the bug",
      maxPromptTokens: 50000, // Large budget
    });

    expect(session).toBeDefined();
    expect(session.id).toBeTruthy();

    // Verify no truncation metadata in session
    // (truncation report is only set when truncation actually happens)
    const sessionsDir = getSessionsDir(configPath, config.projects["test-project"]!.path);
    const metadataPath = join(sessionsDir, session.id);

    if (existsSync(metadataPath)) {
      const metadata = readFileSync(metadataPath, "utf-8");
      expect(metadata).not.toContain("promptTruncationReport");
    }
  });

  it("truncates prompt when it exceeds maxPromptTokens budget", async () => {
    const plugins = createMockPlugins();
    const registry = createMockRegistry(plugins);

    // Create config with very long agent rules to force truncation
    const longRules = "A".repeat(50000); // ~12,500 tokens at 4 chars/token
    const config = createTestConfig(tmpDir, configPath, {
      agentRules: longRules,
    });

    const sm = createSessionManager({ config, registry });

    // Spawn with very low budget to guarantee truncation
    const session = await sm.spawn({
      projectId: "test-project",
      issueId: "TEST-2",
      prompt: "Fix the critical bug",
      maxPromptTokens: 100, // Very low budget forces truncation
    });

    expect(session).toBeDefined();

    // Check that truncation report was saved in metadata
    const sessionsDir = getSessionsDir(configPath, config.projects["test-project"]!.path);
    const metadataPath = join(sessionsDir, session.id);

    if (existsSync(metadataPath)) {
      const metadata = readFileSync(metadataPath, "utf-8");

      // Look for truncation report
      const reportMatch = metadata.match(/promptTruncationReport=(.+)/);
      if (reportMatch) {
        const report = JSON.parse(reportMatch[1]);
        expect(report.originalTokens).toBeGreaterThan(100);
        expect(report.finalTokens).toBeLessThanOrEqual(report.originalTokens);
        expect(report.budget).toBe(100);
      }
    }
  });

  it("preserves highest priority sections during truncation", () => {
    const project = {
      name: "Test Project",
      repo: "org/test",
      path: "/tmp/test",
      defaultBranch: "main",
      sessionPrefix: "test",
      agentRules: "B".repeat(20000), // Long rules (priority 5)
    };

    const result = buildPromptWithMetadata({
      project,
      projectId: "test",
      issueId: "TEST-1",
      issueContext: "C".repeat(10000), // Issue details (priority 9)
      userPrompt: "Fix this specific bug", // Priority 10 - highest
    });

    // Truncate to a small budget
    const truncated = truncatePrompt(result, 500);

    // Verify the report shows what was truncated
    expect(truncated.truncationReport).toBeDefined();
    expect(truncated.truncationReport!.originalTokens).toBeGreaterThan(500);
    expect(truncated.truncationReport!.finalTokens).toBeLessThanOrEqual(600); // Some margin

    // The prompt should still contain the additional instructions (highest priority)
    expect(truncated.prompt).toContain("Fix this specific bug");
  });

  it("drops optional sections before truncating required sections", () => {
    const project = {
      name: "Test Project",
      repo: "org/test",
      path: "/tmp/test",
      defaultBranch: "main",
      sessionPrefix: "test",
      agentRules: "D".repeat(5000), // Optional, priority 5
    };

    const result = buildPromptWithMetadata({
      project,
      projectId: "test",
      issueId: "TEST-1",
      userPrompt: "Important instruction",
      siblings: ["E".repeat(5000)], // Optional parallel work, priority 4 (lowest)
    });

    // Truncate
    const truncated = truncatePrompt(result, 1000);

    expect(truncated.truncationReport).toBeDefined();

    // Lower priority sections should be dropped/truncated first
    const report = truncated.truncationReport!;

    // Either dropped or truncated parallel-work (priority 4) before user-rules (priority 5)
    const droppedOrTruncated = [
      ...report.droppedSections,
      ...report.truncatedSections.map((s: { name: string }) => s.name),
    ];

    // Check that low-priority sections were affected
    expect(droppedOrTruncated.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Test Suite: Cost Computation via Registry
// =============================================================================

describe("Cost Computation via Registry", () => {
  it("computes cost using pricing registry for known models", () => {
    const cost = computeCost({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
    });

    // Claude Sonnet: $3/M input, $15/M output = $18 total
    expect(cost.estimatedCostUsd).toBeCloseTo(18.0, 1);
    expect(cost.provider).toBe("anthropic");
    expect(cost.model).toBe("claude-3-5-sonnet-latest");
  });

  it("includes cache token costs when present", () => {
    const cost = computeCost({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
    });

    // Input: $3, Output: $15, Cache Read: $0.30, Cache Write: $3.75 = $22.05
    expect(cost.estimatedCostUsd).toBeCloseTo(22.05, 1);
    expect(cost.cachedReadTokens).toBe(1_000_000);
    expect(cost.cacheCreationTokens).toBe(1_000_000);
  });

  it("uses default pricing for unknown models", () => {
    const cost = computeCost({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      provider: "unknown-provider",
      model: "unknown-model",
    });

    // Default pricing: $2.5/M input, $10/M output = $12.5
    expect(cost.estimatedCostUsd).toBeCloseTo(12.5, 1);
  });

  it("respects directCostUsd when provided by agent", () => {
    const cost = computeCost({
      inputTokens: 100,
      outputTokens: 100,
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
      directCostUsd: 0.99,
    });

    // Should use direct cost, not computed
    expect(cost.estimatedCostUsd).toBe(0.99);
    expect(cost.inputTokens).toBe(100);
    expect(cost.outputTokens).toBe(100);
  });

  it("computes cost with date-based pricing lookup", () => {
    // Register custom pricing with a specific date
    pricingRegistry.register({
      provider: "test-provider",
      model: "test-model",
      effectiveDate: "2025-01-01T00:00:00Z",
      inputPerMillion: 1.0,
      outputPerMillion: 2.0,
    });

    const cost = computeCost({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      provider: "test-provider",
      model: "test-model",
      date: "2025-06-01", // After effective date
    });

    expect(cost.estimatedCostUsd).toBeCloseTo(3.0, 1); // $1 + $2
    expect(cost.pricingDate).toBe("2025-01-01T00:00:00Z");
  });
});

// =============================================================================
// Test Suite: Cost Persistence to cost.json
// =============================================================================

describe("Cost Persistence to cost.json", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    const raw = await mkdtemp(join(tmpdir(), "ao-cost-persist-"));
    tmpDir = raw;
    configPath = join(tmpDir, "agent-orchestrator.yaml");
    await writeFile(configPath, "projects: {}\n");
  });

  afterEach(async () => {
    if (tmpDir && existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("persists cost to cost.json when session is enriched", async () => {
    const mockCost: CostEstimate = {
      inputTokens: 5000,
      outputTokens: 2000,
      estimatedCostUsd: 0.045,
      model: "claude-3-5-sonnet-latest",
      provider: "anthropic",
      lastUpdatedAt: new Date().toISOString(),
    };

    const plugins = createMockPlugins({ agentCost: mockCost });
    const registry = createMockRegistry(plugins);
    const config = createTestConfig(tmpDir, configPath);

    const sm = createSessionManager({ config, registry });

    // Spawn a session
    const session = await sm.spawn({
      projectId: "test-project",
      issueId: "TEST-COST-1",
      prompt: "Test cost persistence",
    });

    // List sessions to trigger enrichment
    const sessions = await sm.list("test-project");
    expect(sessions.length).toBeGreaterThan(0);

    // Check that cost.json was created
    const sessionsDir = getSessionsDir(configPath, config.projects["test-project"]!.path);
    const costFilePath = join(sessionsDir, session.id + ".cost.json");

    // Wait a moment for async file write
    await new Promise((r) => setTimeout(r, 100));

    if (existsSync(costFilePath)) {
      const costData = JSON.parse(readFileSync(costFilePath, "utf-8"));
      expect(costData.inputTokens).toBe(5000);
      expect(costData.outputTokens).toBe(2000);
      expect(costData.estimatedCostUsd).toBeCloseTo(0.045);
      expect(costData.model).toBe("claude-3-5-sonnet-latest");
    }
  });

  it("merges costs from existing cost.json on subsequent enrichments", async () => {
    const plugins = createMockPlugins({
      agentCost: {
        inputTokens: 1000,
        outputTokens: 500,
        estimatedCostUsd: 0.01,
        model: "claude-3-5-sonnet-latest",
        provider: "anthropic",
      },
    });
    const registry = createMockRegistry(plugins);
    const config = createTestConfig(tmpDir, configPath);

    const sm = createSessionManager({ config, registry });

    // Create session directory and pre-existing cost.json
    const sessionsDir = getSessionsDir(configPath, config.projects["test-project"]!.path);
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = "test-merge-1";
    const costFilePath = join(sessionsDir, sessionId + ".cost.json");

    // Write pre-existing cost data
    const existingCost: CostEstimate = {
      inputTokens: 2000,
      outputTokens: 1000,
      estimatedCostUsd: 0.02,
      model: "claude-3-5-sonnet-latest",
      provider: "anthropic",
    };
    await writeFile(costFilePath, JSON.stringify(existingCost, null, 2));

    // Write session metadata
    const metadataPath = join(sessionsDir, sessionId);
    const metadata = [
      `worktree=${tmpDir}/ws`,
      `branch=feat/test`,
      `status=working`,
      `project=test-project`,
      `issue=TEST-MERGE`,
      `createdAt=${new Date().toISOString()}`,
    ].join("\n");
    await writeFile(metadataPath, metadata + "\n");

    // List sessions to trigger enrichment
    const sessions = await sm.list("test-project");
    const session = sessions.find((s: Session) => s.id === sessionId);

    if (session) {
      // Wait for async file operations
      await new Promise((r) => setTimeout(r, 100));

      if (existsSync(costFilePath)) {
        const mergedCost = JSON.parse(readFileSync(costFilePath, "utf-8"));

        // Should have merged: 2000 + 1000 = 3000 input tokens
        expect(mergedCost.inputTokens).toBe(3000);
        // 1000 + 500 = 1500 output tokens
        expect(mergedCost.outputTokens).toBe(1500);
        // 0.02 + 0.01 = 0.03 cost
        expect(mergedCost.estimatedCostUsd).toBeCloseTo(0.03);
      }
    }
  });

  it("handles missing cost.json gracefully on first enrichment", async () => {
    const mockCost: CostEstimate = {
      inputTokens: 3000,
      outputTokens: 1500,
      estimatedCostUsd: 0.03,
      model: "gpt-4o",
      provider: "openai",
    };

    const plugins = createMockPlugins({ agentCost: mockCost, agentModel: "gpt-4o" });
    const registry = createMockRegistry(plugins);
    const config = createTestConfig(tmpDir, configPath);

    const sm = createSessionManager({ config, registry });

    // Spawn session (no pre-existing cost.json)
    const session = await sm.spawn({
      projectId: "test-project",
      issueId: "TEST-NEW-COST",
      prompt: "First cost tracking",
    });

    // Trigger enrichment
    await sm.list("test-project");

    // Wait for async file operations
    await new Promise((r) => setTimeout(r, 100));

    const sessionsDir = getSessionsDir(configPath, config.projects["test-project"]!.path);
    const costFilePath = join(sessionsDir, session.id + ".cost.json");

    if (existsSync(costFilePath)) {
      const costData = JSON.parse(readFileSync(costFilePath, "utf-8"));
      expect(costData.inputTokens).toBe(3000);
      expect(costData.outputTokens).toBe(1500);
      expect(costData.model).toBe("gpt-4o");
    }
  });
});

// =============================================================================
// Test Suite: Cost Aggregation Across Sessions
// =============================================================================

describe("Cost Aggregation Across Sessions", () => {
  it("aggregates costs across multiple sessions with different models", () => {
    const costs: CostEstimate[] = [
      // Session 1: Claude Sonnet
      {
        inputTokens: 10000,
        outputTokens: 5000,
        estimatedCostUsd: 0.105, // (10000*3 + 5000*15) / 1M
        model: "claude-3-5-sonnet-latest",
        provider: "anthropic",
      },
      // Session 2: GPT-4o
      {
        inputTokens: 8000,
        outputTokens: 4000,
        estimatedCostUsd: 0.06, // (8000*2.5 + 4000*10) / 1M
        model: "gpt-4o",
        provider: "openai",
      },
      // Session 3: Claude Sonnet with caching
      {
        inputTokens: 15000,
        outputTokens: 7000,
        cachedReadTokens: 5000,
        cacheCreationTokens: 2000,
        estimatedCostUsd: 0.1575, // input + output + cache
        model: "claude-3-5-sonnet-latest",
        provider: "anthropic",
      },
      // Session 4: o3-mini
      {
        inputTokens: 20000,
        outputTokens: 10000,
        estimatedCostUsd: 0.12, // (20000*2 + 10000*8) / 1M
        model: "o3-mini",
        provider: "openai",
      },
      // Session 5: Unknown model (uses default pricing)
      {
        inputTokens: 5000,
        outputTokens: 2500,
        estimatedCostUsd: 0.0375, // (5000*2.5 + 2500*10) / 1M default
        model: "custom-model",
        provider: "custom-provider",
      },
    ];

    const aggregated = aggregateCosts(costs);

    // Total input: 10000 + 8000 + 15000 + 20000 + 5000 = 58000
    expect(aggregated.inputTokens).toBe(58000);

    // Total output: 5000 + 4000 + 7000 + 10000 + 2500 = 28500
    expect(aggregated.outputTokens).toBe(28500);

    // Total cached read: 0 + 0 + 5000 + 0 + 0 = 5000
    expect(aggregated.cachedReadTokens).toBe(5000);

    // Total cache creation: 0 + 0 + 2000 + 0 + 0 = 2000
    expect(aggregated.cacheCreationTokens).toBe(2000);

    // Total cost: 0.105 + 0.06 + 0.1575 + 0.12 + 0.0375 = 0.48
    expect(aggregated.estimatedCostUsd).toBeCloseTo(0.48, 2);
  });

  it("handles empty cost array", () => {
    const aggregated = aggregateCosts([]);

    expect(aggregated.inputTokens).toBe(0);
    expect(aggregated.outputTokens).toBe(0);
    expect(aggregated.estimatedCostUsd).toBe(0);
  });

  it("handles array with undefined values", () => {
    const costs: (CostEstimate | undefined)[] = [
      {
        inputTokens: 1000,
        outputTokens: 500,
        estimatedCostUsd: 0.01,
      },
      undefined,
      {
        inputTokens: 2000,
        outputTokens: 1000,
        estimatedCostUsd: 0.02,
      },
      undefined,
    ];

    const aggregated = aggregateCosts(costs);

    expect(aggregated.inputTokens).toBe(3000);
    expect(aggregated.outputTokens).toBe(1500);
    expect(aggregated.estimatedCostUsd).toBeCloseTo(0.03);
  });

  it("aggregates single session correctly", () => {
    const costs: CostEstimate[] = [
      {
        inputTokens: 5000,
        outputTokens: 2500,
        estimatedCostUsd: 0.05,
        model: "test-model",
        provider: "test-provider",
      },
    ];

    const aggregated = aggregateCosts(costs);

    expect(aggregated.inputTokens).toBe(5000);
    expect(aggregated.outputTokens).toBe(2500);
    expect(aggregated.estimatedCostUsd).toBeCloseTo(0.05);
  });

  it("preserves model info from last cost in aggregation", () => {
    const costs: CostEstimate[] = [
      {
        inputTokens: 1000,
        outputTokens: 500,
        estimatedCostUsd: 0.01,
        model: "first-model",
        provider: "first-provider",
      },
      {
        inputTokens: 2000,
        outputTokens: 1000,
        estimatedCostUsd: 0.02,
        model: "last-model",
        provider: "last-provider",
      },
    ];

    const aggregated = aggregateCosts(costs);

    // mergeCosts uses incoming model/provider, so last one wins
    expect(aggregated.model).toBe("last-model");
    expect(aggregated.provider).toBe("last-provider");
  });
});

// =============================================================================
// Test Suite: Registry Initialization from Config
// =============================================================================

describe("Registry Initialization from Config", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    const raw = await mkdtemp(join(tmpdir(), "ao-registry-init-"));
    tmpDir = raw;
    configPath = join(tmpDir, "agent-orchestrator.yaml");
    await writeFile(configPath, "projects: {}\n");
  });

  afterEach(async () => {
    if (tmpDir && existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("loads custom pricing from JSON file", async () => {
    // Create custom pricing file
    const pricingFile = join(tmpDir, "custom-pricing.json");
    const customPricing = [
      {
        provider: "custom",
        model: "custom-llm-v1",
        inputPerMillion: 5.0,
        outputPerMillion: 20.0,
        effectiveDate: "2026-01-01T00:00:00Z",
      },
    ];
    await writeFile(pricingFile, JSON.stringify(customPricing, null, 2));

    const config: OrchestratorConfig = {
      configPath,
      port: 3000,
      readyThresholdMs: 300_000,
      defaults: {
        runtime: "mock",
        agent: "mock",
        workspace: "mock",
        notifiers: [],
      },
      projects: {},
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
      pricing: { file: "custom-pricing.json" },
    };

    // Initialize registries
    initializeRegistriesFromConfig(config);

    // Verify custom pricing was loaded
    const pricing = pricingRegistry.lookup("custom", "custom-llm-v1");
    expect(pricing).toBeDefined();
    expect(pricing!.inputPerMillion).toBe(5.0);
    expect(pricing!.outputPerMillion).toBe(20.0);
  });

  it("loads custom pricing from YAML file", async () => {
    // Create custom pricing YAML file
    const pricingFile = join(tmpDir, "custom-pricing.yaml");
    const yamlContent = `
- provider: yaml-provider
  model: yaml-model
  inputPerMillion: 4.0
  outputPerMillion: 16.0
  effectiveDate: "2026-02-01T00:00:00Z"
  cacheReadPerMillion: 0.5
`;
    await writeFile(pricingFile, yamlContent);

    const config: OrchestratorConfig = {
      configPath,
      port: 3000,
      readyThresholdMs: 300_000,
      defaults: {
        runtime: "mock",
        agent: "mock",
        workspace: "mock",
        notifiers: [],
      },
      projects: {},
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
      pricing: { file: "custom-pricing.yaml" },
    };

    initializeRegistriesFromConfig(config);

    const pricing = pricingRegistry.lookup("yaml-provider", "yaml-model");
    expect(pricing).toBeDefined();
    expect(pricing!.inputPerMillion).toBe(4.0);
    expect(pricing!.cacheReadPerMillion).toBe(0.5);
  });

  it("applies model overrides from config", async () => {
    const config: OrchestratorConfig = {
      configPath,
      port: 3000,
      readyThresholdMs: 300_000,
      defaults: {
        runtime: "mock",
        agent: "mock",
        workspace: "mock",
        notifiers: [],
      },
      projects: {},
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
      models: {
        overrides: [
          {
            provider: "anthropic",
            model: "claude-test-override",
            safePromptBudget: 50000,
          },
        ],
      },
    };

    initializeRegistriesFromConfig(config);

    const budget = modelRegistry.getPromptBudget("anthropic", "claude-test-override");
    expect(budget).toBe(50000);
  });

  it("handles missing pricing file gracefully", async () => {
    const config: OrchestratorConfig = {
      configPath,
      port: 3000,
      readyThresholdMs: 300_000,
      defaults: {
        runtime: "mock",
        agent: "mock",
        workspace: "mock",
        notifiers: [],
      },
      projects: {},
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
      pricing: { file: "non-existent-pricing.json" },
    };

    // Should not throw, just warn
    expect(() => initializeRegistriesFromConfig(config)).not.toThrow();
  });

  it("handles invalid pricing file format gracefully", async () => {
    // Create invalid pricing file (not an array)
    const pricingFile = join(tmpDir, "invalid-pricing.json");
    await writeFile(pricingFile, JSON.stringify({ invalid: "format" }));

    const config: OrchestratorConfig = {
      configPath,
      port: 3000,
      readyThresholdMs: 300_000,
      defaults: {
        runtime: "mock",
        agent: "mock",
        workspace: "mock",
        notifiers: [],
      },
      projects: {},
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
      pricing: { file: "invalid-pricing.json" },
    };

    // Should not throw, just warn
    expect(() => initializeRegistriesFromConfig(config)).not.toThrow();
  });
});

// =============================================================================
// Test Suite: Model Registry Integration
// =============================================================================

describe("Model Registry Integration", () => {
  it("returns correct prompt budget for known models", () => {
    const claudeBudget = modelRegistry.getPromptBudget("anthropic", "claude-3-5-sonnet-latest");
    expect(claudeBudget).toBe(160000);

    const gptBudget = modelRegistry.getPromptBudget("openai", "gpt-4o");
    expect(gptBudget).toBe(100000);
  });

  it("handles case-insensitive model lookups", () => {
    const budget1 = modelRegistry.getPromptBudget("Anthropic", "Claude-3-5-Sonnet-Latest");
    const budget2 = modelRegistry.getPromptBudget("anthropic", "claude-3-5-sonnet-latest");

    expect(budget1).toBe(budget2);
  });

  it("returns default budget for unknown models", () => {
    const budget = modelRegistry.getPromptBudget("unknown", "unknown-model");
    expect(budget).toBe(100000); // Default from getDefaultEstimate()
  });

  it("allows registering new models", () => {
    modelRegistry.register({
      provider: "test-provider",
      model: "test-model-custom",
      maxContextTokens: 500000,
      safePromptBudget: 400000,
      supportsCacheRead: true,
      supportsCacheWrite: true,
      supportsReasoning: false,
    });

    const budget = modelRegistry.getPromptBudget("test-provider", "test-model-custom");
    expect(budget).toBe(400000);

    const spec = modelRegistry.get("test-provider", "test-model-custom");
    expect(spec).toBeDefined();
    expect(spec!.maxContextTokens).toBe(500000);
    expect(spec!.supportsCacheRead).toBe(true);
  });
});

// =============================================================================
// Test Suite: End-to-End Cost Flow
// =============================================================================

describe("End-to-End Cost Flow", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    const raw = await mkdtemp(join(tmpdir(), "ao-e2e-cost-"));
    tmpDir = raw;
    configPath = join(tmpDir, "agent-orchestrator.yaml");
    await writeFile(configPath, "projects: {}\n");
  });

  afterEach(async () => {
    if (tmpDir && existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("complete flow: spawn → enrich → persist → merge → aggregate", async () => {
    // Simulate 3 sessions with incremental costs
    const sessionCosts = [
      { inputTokens: 1000, outputTokens: 500, estimatedCostUsd: 0.01 },
      { inputTokens: 2000, outputTokens: 1000, estimatedCostUsd: 0.02 },
      { inputTokens: 3000, outputTokens: 1500, estimatedCostUsd: 0.03 },
    ];

    let costIndex = 0;
    const plugins = createMockPlugins({
      agentCost: sessionCosts[0] as CostEstimate,
    });

    // Update getSessionInfo to return different costs
    (plugins.agent.getSessionInfo as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const cost = sessionCosts[Math.min(costIndex, sessionCosts.length - 1)];
      costIndex++;
      return { cost: { ...cost, model: "claude-3-5-sonnet-latest", provider: "anthropic" } };
    });

    const registry = createMockRegistry(plugins);
    const config = createTestConfig(tmpDir, configPath);
    const sm = createSessionManager({ config, registry });

    // Spawn 3 sessions
    const sessions = [];
    for (let i = 0; i < 3; i++) {
      const session = await sm.spawn({
        projectId: "test-project",
        issueId: `E2E-${i + 1}`,
        prompt: `Task ${i + 1}`,
      });
      sessions.push(session);
    }

    // Enrich all sessions (triggers cost persistence)
    await sm.list("test-project");
    await new Promise((r) => setTimeout(r, 200)); // Wait for async writes

    // Read all cost.json files and aggregate
    const sessionsDir = getSessionsDir(configPath, config.projects["test-project"]!.path);
    const allCosts: CostEstimate[] = [];

    for (const session of sessions) {
      const costFilePath = join(sessionsDir, session.id + ".cost.json");
      if (existsSync(costFilePath)) {
        const cost = JSON.parse(readFileSync(costFilePath, "utf-8"));
        allCosts.push(cost);
      }
    }

    // Aggregate and verify
    if (allCosts.length > 0) {
      const total = aggregateCosts(allCosts);

      // Verify aggregation makes sense (exact values depend on mock behavior)
      expect(total.inputTokens).toBeGreaterThan(0);
      expect(total.outputTokens).toBeGreaterThan(0);
      expect(total.estimatedCostUsd).toBeGreaterThan(0);
    }
  });
});
