/**
 * Registry Initializer — applies config-driven pricing and model overrides to the singletons.
 *
 * Call initializeRegistriesFromConfig() after loadConfig() to wire up
 * custom pricing files and model overrides from the YAML config.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { pricingRegistry, type PricingSpec } from "./pricing-registry.js";
import { modelRegistry, type ModelSpec } from "./model-registry.js";
import type { OrchestratorConfig } from "./types.js";

/**
 * Schema for entries in a custom pricing file (JSON or YAML).
 * Matches PricingSpec but effectiveDate is optional (defaults to today).
 */
interface PricingFileEntry {
  provider: string;
  model: string;
  effectiveDate?: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
  reasoningPerMillion?: number;
}

/**
 * Load custom pricing from a file and register with the pricing registry.
 * Supports JSON and YAML formats.
 *
 * File format (array of pricing entries):
 * ```yaml
 * - provider: anthropic
 *   model: claude-4-opus
 *   inputPerMillion: 15.0
 *   outputPerMillion: 75.0
 *   effectiveDate: "2026-01-01"  # optional, defaults to today
 * ```
 */
function loadPricingFile(filePath: string, configDir: string): void {
  const absolutePath = resolve(configDir, filePath);

  if (!existsSync(absolutePath)) {
    console.warn(
      `[registry-initializer] Pricing file not found: ${absolutePath}. ` +
        `Custom pricing will not be loaded.`,
    );
    return;
  }

  const content = readFileSync(absolutePath, "utf-8");
  const ext = extname(absolutePath).toLowerCase();

  let entries: PricingFileEntry[];
  try {
    if (ext === ".json") {
      entries = JSON.parse(content);
    } else if (ext === ".yaml" || ext === ".yml") {
      entries = parseYaml(content);
    } else {
      console.warn(
        `[registry-initializer] Unknown pricing file extension: ${ext}. ` +
          `Supported: .json, .yaml, .yml`,
      );
      return;
    }
  } catch (err) {
    console.warn(
      `[registry-initializer] Failed to parse pricing file ${absolutePath}: ${err}`,
    );
    return;
  }

  if (!Array.isArray(entries)) {
    console.warn(
      `[registry-initializer] Pricing file must be an array of pricing entries. ` +
        `Got: ${typeof entries}`,
    );
    return;
  }

  const today = new Date().toISOString().split("T")[0] + "T00:00:00Z";
  let registered = 0;

  for (const entry of entries) {
    if (
      !entry.provider ||
      !entry.model ||
      typeof entry.inputPerMillion !== "number" ||
      typeof entry.outputPerMillion !== "number"
    ) {
      console.warn(
        `[registry-initializer] Skipping invalid pricing entry: ` +
          `requires provider, model, inputPerMillion, outputPerMillion. Got: ${JSON.stringify(entry)}`,
      );
      continue;
    }

    const spec: PricingSpec = {
      provider: entry.provider,
      model: entry.model,
      effectiveDate: entry.effectiveDate || today,
      inputPerMillion: entry.inputPerMillion,
      outputPerMillion: entry.outputPerMillion,
      cacheReadPerMillion: entry.cacheReadPerMillion,
      cacheWritePerMillion: entry.cacheWritePerMillion,
      reasoningPerMillion: entry.reasoningPerMillion,
    };

    try {
      pricingRegistry.register(spec);
      registered++;
    } catch (err) {
      console.warn(
        `[registry-initializer] Failed to register pricing for ${entry.provider}/${entry.model}: ${err}`,
      );
    }
  }

  if (registered > 0) {
    console.log(
      `[registry-initializer] Loaded ${registered} custom pricing entries from ${absolutePath}`,
    );
  }
}

/**
 * Apply model overrides from config to the model registry.
 * Only safePromptBudget is supported via config; other ModelSpec fields
 * use defaults from the existing registration or fallback values.
 */
function applyModelOverrides(
  overrides: NonNullable<OrchestratorConfig["models"]>["overrides"],
): void {
  if (!overrides || overrides.length === 0) return;

  for (const override of overrides) {
    const existing = modelRegistry.get(override.provider, override.model);

    const spec: ModelSpec = {
      provider: override.provider,
      model: override.model,
      // Use existing values if available, otherwise use reasonable defaults
      maxContextTokens: existing?.maxContextTokens ?? 128000,
      safePromptBudget: override.safePromptBudget,
      supportsCacheRead: existing?.supportsCacheRead ?? false,
      supportsCacheWrite: existing?.supportsCacheWrite ?? false,
      supportsReasoning: existing?.supportsReasoning ?? false,
    };

    modelRegistry.register(spec);
  }

  console.log(
    `[registry-initializer] Applied ${overrides.length} model overrides`,
  );
}

/**
 * Apply default prompt budget ratio to models without explicit overrides.
 * This modifies the default estimate returned for unknown models.
 *
 * Note: The ModelRegistry's getDefaultEstimate() returns a fixed value.
 * To apply a ratio, we'd need to either:
 * 1. Modify ModelRegistry to accept a configurable default
 * 2. Pre-register common models with the adjusted budget
 *
 * For now, this logs a warning that the feature requires model-specific overrides.
 */
function applyDefaultPromptBudgetRatio(
  defaults: NonNullable<OrchestratorConfig["models"]>["defaults"],
): void {
  if (!defaults?.promptBudgetRatio) return;

  // TODO: Enhance ModelRegistry to support a configurable default ratio
  console.log(
    `[registry-initializer] promptBudgetRatio=${defaults.promptBudgetRatio} is set. ` +
      `To apply this to specific models, add them to models.overrides with calculated safePromptBudget.`,
  );
}

/**
 * Initialize the pricing and model registries from config.
 *
 * Call this after loadConfig() to apply:
 * - Custom pricing from config.pricing.file
 * - Model overrides from config.models.overrides
 * - Default prompt budget ratio from config.models.defaults
 *
 * @param config - The validated OrchestratorConfig
 */
export function initializeRegistriesFromConfig(config: OrchestratorConfig): void {
  const configDir = config.configPath ? dirname(config.configPath) : process.cwd();

  // Load custom pricing file if specified
  if (config.pricing?.file) {
    loadPricingFile(config.pricing.file, configDir);
  }

  // Apply model configuration
  if (config.models) {
    applyDefaultPromptBudgetRatio(config.models.defaults);
    applyModelOverrides(config.models.overrides);
  }
}
