export interface CostEntry {
  sessionId: string;
  nodeId: string;
  operation: 'planning' | 'generation' | 'quality' | 'self_heal';
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  timestamp: Date;
}

export interface CostBudget {
  maxCostUsd: number;
  currentCostUsd: number;
  remaining: number;
  entries: CostEntry[];
}

import { getDatabase } from "./db.js";

export class CostTracker {
  private maxCostUsd: number;
  private entries: CostEntry[] = [];
  private projectBaseDir?: string;

  constructor(budgetUsd: number, projectBaseDir?: string) {
    this.maxCostUsd = budgetUsd;
    this.projectBaseDir = projectBaseDir;
  }

  record(entry: Omit<CostEntry, 'timestamp'>): void {
    const costEntry = { ...entry, timestamp: new Date() };
    this.entries.push(costEntry);

    if (this.projectBaseDir) {
      try {
        const db = getDatabase(this.projectBaseDir);
        const stmt = db.prepare(`
          INSERT INTO cost_entries (sessionId, nodeId, operation, model, inputTokens, outputTokens, estimatedCostUsd, timestamp)
          VALUES (@sessionId, @nodeId, @operation, @model, @inputTokens, @outputTokens, @estimatedCostUsd, @timestamp)
        `);
        stmt.run({
          ...costEntry,
          timestamp: costEntry.timestamp.toISOString()
        });
      } catch (e) {
        // Soft fail
      }
    }
  }

  getBudget(): CostBudget {
    const currentCostUsd = this.entries.reduce((sum, e) => sum + e.estimatedCostUsd, 0);
    return {
      maxCostUsd: this.maxCostUsd,
      currentCostUsd,
      remaining: this.maxCostUsd - currentCostUsd,
      entries: this.entries
    };
  }

  isOverBudget(): boolean {
    return this.getBudget().currentCostUsd >= this.maxCostUsd;
  }

  isCostAnomaly(): boolean {
    if (this.entries.length < 5) return false;

    // Check if the rate of cost accumulation over the last few operations is an anomaly
    // Simple heuristic: if the average cost of the last 3 entries is > 3x the average of all prior entries
    const recent = this.entries.slice(-3);
    const prior = this.entries.slice(0, -3);

    if (prior.length === 0) return false;

    const recentAvg = recent.reduce((sum, e) => sum + e.estimatedCostUsd, 0) / recent.length;
    const priorAvg = prior.reduce((sum, e) => sum + e.estimatedCostUsd, 0) / prior.length;

    return recentAvg > priorAvg * 3;
  }
}
