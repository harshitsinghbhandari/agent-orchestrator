import { type CostEstimate } from "./types.js";
import { pricingRegistry } from "./pricing-registry.js";

export interface ComputeCostParams {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  provider: string;
  model: string;
  /** If agent reports cost directly, use this instead of calculating */
  directCostUsd?: number;
  /** Date to use for pricing lookup (optional, defaults to current) */
  date?: string;
}

/**
 * Computes LLM cost based on token counts and model pricing.
 * Validates that token counts are non-negative to prevent buggy agents
 * from producing invalid cost estimates.
 */
export function computeCost(params: ComputeCostParams): CostEstimate {
  const {
    inputTokens: rawInput,
    outputTokens: rawOutput,
    cachedReadTokens: rawCacheRead = 0,
    cacheCreationTokens: rawCacheCreate = 0,
    reasoningTokens: rawReasoning = 0,
    provider,
    model,
    directCostUsd,
    date,
  } = params;

  // Ensure non-negative token counts (buggy agents may report negative values)
  const inputTokens = Math.max(0, rawInput);
  const outputTokens = Math.max(0, rawOutput);
  const cachedReadTokens = Math.max(0, rawCacheRead);
  const cacheCreationTokens = Math.max(0, rawCacheCreate);
  const reasoningTokens = Math.max(0, rawReasoning);

  if (directCostUsd !== undefined) {
    return {
      inputTokens,
      outputTokens,
      cachedReadTokens,
      cacheCreationTokens,
      reasoningTokens,
      estimatedCostUsd: directCostUsd,
      model,
      provider,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  const pricing = pricingRegistry.lookup(provider, model, date) || pricingRegistry.getDefaultPricing();

  const inputCost = (inputTokens * pricing.inputPerMillion) / 1_000_000;
  const outputCost = (outputTokens * pricing.outputPerMillion) / 1_000_000;
  
  const cacheReadCost = pricing.cacheReadPerMillion 
    ? (cachedReadTokens * pricing.cacheReadPerMillion) / 1_000_000 
    : 0;
    
  const cacheWriteCost = pricing.cacheWritePerMillion 
    ? (cacheCreationTokens * pricing.cacheWritePerMillion) / 1_000_000 
    : 0;
    
  const reasoningCost = pricing.reasoningPerMillion 
    ? (reasoningTokens * pricing.reasoningPerMillion) / 1_000_000 
    : 0;

  const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost + reasoningCost;

  return {
    inputTokens,
    outputTokens,
    cachedReadTokens,
    cacheCreationTokens,
    reasoningTokens,
    estimatedCostUsd: totalCost,
    model: pricing.model !== "default" ? pricing.model : model,
    provider: pricing.provider !== "unknown" ? pricing.provider : provider,
    pricingDate: pricing.effectiveDate,
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Merges two cost estimates, accumulating tokens and cost.
 * Ensures that token counts and costs are non-negative.
 */
export function mergeCosts(existing: CostEstimate | undefined, incoming: CostEstimate): CostEstimate {
  if (!existing) return incoming;

  const input = (existing.inputTokens || 0) + (incoming.inputTokens || 0);
  const output = (existing.outputTokens || 0) + (incoming.outputTokens || 0);
  const cachedR = (existing.cachedReadTokens || 0) + (incoming.cachedReadTokens || 0);
  const cachedW = (existing.cacheCreationTokens || 0) + (incoming.cacheCreationTokens || 0);
  const reasoning = (existing.reasoningTokens || 0) + (incoming.reasoningTokens || 0);
  const costVal = (existing.estimatedCostUsd || 0) + (incoming.estimatedCostUsd || 0);

  return {
    inputTokens: Math.max(0, input),
    outputTokens: Math.max(0, output),
    cachedReadTokens: Math.max(0, cachedR),
    cacheCreationTokens: Math.max(0, cachedW),
    reasoningTokens: Math.max(0, reasoning),
    estimatedCostUsd: Math.max(0, costVal),
    model: incoming.model || existing.model,
    provider: incoming.provider || existing.provider,
    lastUpdatedAt: incoming.lastUpdatedAt || existing.lastUpdatedAt || new Date().toISOString(),
  };
}

/**
 * Aggregate multiple cost estimates into a single summary.
 * Useful for calculating project-level or system-wide costs.
 */
export function aggregateCosts(costs: (CostEstimate | undefined)[]): CostEstimate {
  let combined: CostEstimate = {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };

  for (const cost of costs) {
    if (!cost) continue;
    combined = mergeCosts(combined, cost);
  }

  return combined;
}

/**
 * Format a cost estimate for display (e.g. CLI or terminal).
 * Returns a string like "$0.0420 (3,500 tokens) [claude-3-5-sonnet-latest]"
 * Uses exponential representation for very low costs to prevent shown as zero.
 */
export function formatCost(cost: CostEstimate): string {
  const rawUsd = cost.estimatedCostUsd;
  const usdFormatted =
    rawUsd > 0 && rawUsd < 0.0001 ? rawUsd.toExponential(2) : rawUsd.toFixed(4);

  const parts = [`$${usdFormatted}`];

  if (cost.inputTokens > 0 || cost.outputTokens > 0) {
    const tokens = (cost.inputTokens + cost.outputTokens).toLocaleString();
    parts.push(`(${tokens} tokens)`);
  }

  if (cost.model) {
    parts.push(`[${cost.model}]`);
  }

  return parts.join(" ");
}
