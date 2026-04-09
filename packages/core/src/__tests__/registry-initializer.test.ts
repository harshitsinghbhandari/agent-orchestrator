import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OrchestratorConfig } from "../types.js";

// Mock node:fs before importing the module under test
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Import mocked modules
import { existsSync, readFileSync } from "node:fs";
import { initializeRegistriesFromConfig } from "../registry-initializer.js";
import { pricingRegistry } from "../pricing-registry.js";
import { modelRegistry } from "../model-registry.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

function createTestConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  return {
    configPath: "/test/config/agent-orchestrator.yaml",
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: {
      runtime: "tmux",
      agent: "claude-code",
      workspace: "worktree",
      notifiers: [],
    },
    projects: {},
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
    ...overrides,
  };
}

describe("Registry Initializer", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let pricingRegisterSpy: ReturnType<typeof vi.spyOn>;
  let modelRegisterSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    pricingRegisterSpy = vi.spyOn(pricingRegistry, "register");
    modelRegisterSpy = vi.spyOn(modelRegistry, "register");
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
    pricingRegisterSpy.mockRestore();
    modelRegisterSpy.mockRestore();
  });

  describe("loadPricingFile", () => {
    it("loads valid JSON pricing file and registers entries", () => {
      const pricingData = [
        {
          provider: "anthropic",
          model: "claude-4-opus",
          inputPerMillion: 15.0,
          outputPerMillion: 75.0,
          effectiveDate: "2026-01-01T00:00:00Z",
        },
        {
          provider: "openai",
          model: "gpt-5",
          inputPerMillion: 10.0,
          outputPerMillion: 30.0,
        },
      ];

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(pricingData));

      const config = createTestConfig({
        pricing: { file: "custom-pricing.json" },
      });

      initializeRegistriesFromConfig(config);

      expect(mockExistsSync).toHaveBeenCalledWith("/test/config/custom-pricing.json");
      expect(pricingRegisterSpy).toHaveBeenCalledTimes(2);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Loaded 2 custom pricing entries"),
      );
    });

    it("loads valid YAML pricing file and registers entries", () => {
      const yamlContent = `
- provider: anthropic
  model: claude-4-opus
  inputPerMillion: 15.0
  outputPerMillion: 75.0
  effectiveDate: "2026-01-01T00:00:00Z"
`;

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(yamlContent);

      const config = createTestConfig({
        pricing: { file: "custom-pricing.yaml" },
      });

      initializeRegistriesFromConfig(config);

      expect(pricingRegisterSpy).toHaveBeenCalledTimes(1);
      expect(pricingRegisterSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "anthropic",
          model: "claude-4-opus",
          inputPerMillion: 15.0,
          outputPerMillion: 75.0,
        }),
      );
    });

    it("handles missing pricing file gracefully with warning", () => {
      mockExistsSync.mockReturnValue(false);

      const config = createTestConfig({
        pricing: { file: "nonexistent.json" },
      });

      // Should not throw
      initializeRegistriesFromConfig(config);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Pricing file not found"),
      );
      expect(pricingRegisterSpy).not.toHaveBeenCalled();
    });

    it("handles malformed JSON with warning", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("{ invalid json }}}");

      const config = createTestConfig({
        pricing: { file: "bad.json" },
      });

      initializeRegistriesFromConfig(config);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to parse pricing file"),
      );
      expect(pricingRegisterSpy).not.toHaveBeenCalled();
    });

    it("handles non-array pricing file with warning", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ not: "an array" }));

      const config = createTestConfig({
        pricing: { file: "object.json" },
      });

      initializeRegistriesFromConfig(config);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Pricing file must be an array"),
      );
      expect(pricingRegisterSpy).not.toHaveBeenCalled();
    });

    it("skips invalid entries with warning but processes valid ones", () => {
      const pricingData = [
        {
          // Missing required fields
          provider: "anthropic",
          // model missing
          inputPerMillion: 15.0,
        },
        {
          // Valid entry
          provider: "openai",
          model: "gpt-5",
          inputPerMillion: 10.0,
          outputPerMillion: 30.0,
        },
      ];

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(pricingData));

      const config = createTestConfig({
        pricing: { file: "mixed.json" },
      });

      initializeRegistriesFromConfig(config);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Skipping invalid pricing entry"),
      );
      expect(pricingRegisterSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Loaded 1 custom pricing entries"),
      );
    });

    it("handles unsupported file extension with warning", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("some content");

      const config = createTestConfig({
        pricing: { file: "pricing.txt" },
      });

      initializeRegistriesFromConfig(config);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown pricing file extension"),
      );
      expect(pricingRegisterSpy).not.toHaveBeenCalled();
    });

    it("defaults effectiveDate to today when not provided", () => {
      const pricingData = [
        {
          provider: "test",
          model: "test-model",
          inputPerMillion: 1.0,
          outputPerMillion: 2.0,
          // No effectiveDate
        },
      ];

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(pricingData));

      const config = createTestConfig({
        pricing: { file: "no-date.json" },
      });

      initializeRegistriesFromConfig(config);

      expect(pricingRegisterSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "test",
          model: "test-model",
          effectiveDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/),
        }),
      );
    });

    it("does nothing when pricing config is not specified", () => {
      const config = createTestConfig({
        pricing: undefined,
      });

      initializeRegistriesFromConfig(config);

      expect(mockExistsSync).not.toHaveBeenCalled();
      expect(pricingRegisterSpy).not.toHaveBeenCalled();
    });
  });

  describe("applyModelOverrides", () => {
    it("applies model overrides from config", () => {
      const config = createTestConfig({
        models: {
          overrides: [
            {
              provider: "anthropic",
              model: "claude-4-opus",
              safePromptBudget: 180000,
            },
          ],
        },
      });

      initializeRegistriesFromConfig(config);

      expect(modelRegisterSpy).toHaveBeenCalledTimes(1);
      expect(modelRegisterSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "anthropic",
          model: "claude-4-opus",
          safePromptBudget: 180000,
        }),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Applied 1 model overrides"),
      );
    });

    it("applies multiple model overrides", () => {
      const config = createTestConfig({
        models: {
          overrides: [
            { provider: "anthropic", model: "claude-4-opus", safePromptBudget: 180000 },
            { provider: "openai", model: "gpt-5", safePromptBudget: 120000 },
          ],
        },
      });

      initializeRegistriesFromConfig(config);

      expect(modelRegisterSpy).toHaveBeenCalledTimes(2);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Applied 2 model overrides"),
      );
    });

    it("does nothing when models config is not specified", () => {
      const config = createTestConfig({
        models: undefined,
      });

      initializeRegistriesFromConfig(config);

      expect(modelRegisterSpy).not.toHaveBeenCalled();
    });

    it("does nothing when overrides array is empty", () => {
      const config = createTestConfig({
        models: {
          overrides: [],
        },
      });

      initializeRegistriesFromConfig(config);

      expect(modelRegisterSpy).not.toHaveBeenCalled();
    });

  });

  describe("combined pricing and model overrides", () => {
    it("applies both pricing file and model overrides", () => {
      const pricingData = [
        {
          provider: "custom",
          model: "custom-model",
          inputPerMillion: 5.0,
          outputPerMillion: 20.0,
        },
      ];

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(pricingData));

      const config = createTestConfig({
        pricing: { file: "pricing.json" },
        models: {
          overrides: [
            { provider: "custom", model: "custom-model", safePromptBudget: 100000 },
          ],
        },
      });

      initializeRegistriesFromConfig(config);

      expect(pricingRegisterSpy).toHaveBeenCalledTimes(1);
      expect(modelRegisterSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("configPath handling", () => {
    it("resolves pricing file path relative to config directory", () => {
      const pricingData = [
        {
          provider: "test",
          model: "test",
          inputPerMillion: 1.0,
          outputPerMillion: 2.0,
        },
      ];

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(pricingData));

      const config = createTestConfig({
        configPath: "/my/project/agent-orchestrator.yaml",
        pricing: { file: "pricing.json" },
      });

      initializeRegistriesFromConfig(config);

      // Should resolve relative to /my/project/
      expect(mockExistsSync).toHaveBeenCalledWith("/my/project/pricing.json");
    });
  });
});
