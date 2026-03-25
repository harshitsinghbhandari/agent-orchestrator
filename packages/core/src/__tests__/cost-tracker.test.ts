import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CostTracker } from '../cost-tracker.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('CostTracker', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ao-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records costs and tracks budget correctly', () => {
    const tracker = new CostTracker(2.0, tmpDir); // Budget $2.00

    tracker.record({
      sessionId: 's-1',
      nodeId: 'n-1',
      operation: 'planning',
      model: 'claude',
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0.5
    });

    const budget = tracker.getBudget();
    expect(budget.currentCostUsd).toBe(0.5);
    expect(budget.remaining).toBe(1.5);
    expect(tracker.isOverBudget()).toBe(false);

    tracker.record({
      sessionId: 's-1',
      nodeId: 'n-1',
      operation: 'generation',
      model: 'claude',
      inputTokens: 200,
      outputTokens: 100,
      estimatedCostUsd: 1.6
    });

    expect(tracker.isOverBudget()).toBe(true);
  });

  it('detects cost anomaly', () => {
    const tracker = new CostTracker(10.0, tmpDir);

    // First 4 cheap operations
    for (let i = 0; i < 4; i++) {
      tracker.record({
        sessionId: 's-1',
        nodeId: 'n-1',
        operation: 'generation',
        model: 'claude',
        inputTokens: 10,
        outputTokens: 10,
        estimatedCostUsd: 0.1
      });
    }

    expect(tracker.isCostAnomaly()).toBe(false);

    // 3 expensive operations
    for (let i = 0; i < 3; i++) {
      tracker.record({
        sessionId: 's-1',
        nodeId: 'n-1',
        operation: 'generation',
        model: 'claude',
        inputTokens: 1000,
        outputTokens: 1000,
        estimatedCostUsd: 1.0 // 10x the previous average
      });
    }

    expect(tracker.isCostAnomaly()).toBe(true);
  });
});
