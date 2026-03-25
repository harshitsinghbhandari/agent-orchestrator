import { type DecompositionPlan, type TaskNode, getSiblings } from "./decomposer.js";
import { computeTiers, type DAGTier, completeNode } from "./dag-scheduler.js";
import { type SessionManager } from "./types.js";
import { type CostTracker } from "./cost-tracker.js";

// Optional CostTracker integration since it will be built in Task 4
export interface DAGExecutorOptions {
  sessionManager: SessionManager;
  projectId: string;
  issueId?: string;
  costTracker?: CostTracker;
  onNotify?: (message: string) => void;
}

type ExecutionState = "executing" | "paused" | "completed" | "failed";

export class DAGExecutor {
  private plan: DecompositionPlan;
  private sessionManager: SessionManager;
  private projectId: string;
  private issueId?: string;
  private state: ExecutionState = "executing";
  private costTracker?: CostTracker;
  private onNotify?: (message: string) => void;

  private retryCounts: Map<string, number> = new Map();
  private maxRetries = 3;

  constructor(plan: DecompositionPlan, options: DAGExecutorOptions) {
    this.plan = plan;
    this.sessionManager = options.sessionManager;
    this.projectId = options.projectId;
    this.issueId = options.issueId;
    this.costTracker = options.costTracker;
    this.onNotify = options.onNotify;
  }

  public async execute(): Promise<void> {
    this.state = "executing";

    try {
      const tiers = computeTiers(this.plan.tree);

      for (const tier of tiers) {
        if (this.state !== "executing") break;
        await this.executeTier(tier);
      }

      if (this.state === "executing") {
        this.state = "completed";
        this.notify("DAG Execution completed successfully.");
      }
    } catch (err) {
      this.state = "failed";
      const message = err instanceof Error ? err.message : String(err);
      this.notify(`DAG Execution failed: ${message}`);
    }
  }

  private async executeTier(tier: DAGTier): Promise<void> {
    // 1. Heuristic file-level isolation check (simulated with naive serialization for overlap)
    // In a real implementation this would call an LLM. Here we just run them concurrently
    // but a production version would group non-overlapping nodes.
    const serializedGroups = this.groupNodesByIsolation(tier.nodes);

    for (const group of serializedGroups) {
      if (this.state !== "executing") break;

      const promises = group.map(node => this.executeNode(node));
      await Promise.all(promises);
    }
  }

  private groupNodesByIsolation(nodes: TaskNode[]): TaskNode[][] {
    // Phase 1 fallback: run them concurrently and assume they are isolated.
    // Real implementation would parse files modified.
    return [nodes];
  }

  private async executeNode(node: TaskNode): Promise<void> {
    if (this.costTracker && this.costTracker.isOverBudget()) {
      this.state = "paused";
      this.notify("Execution paused: Cost budget exceeded.");
      return;
    }

    let success = false;
    let attempt = this.retryCounts.get(node.id) || 0;

    const siblings = getSiblings(this.plan.tree, node.id);

    while (!success && attempt < this.maxRetries && this.state === "executing") {
      try {
        const session = await this.sessionManager.spawn({
          projectId: this.projectId,
          issueId: this.issueId,
          prompt: node.description,
          lineage: node.lineage,
          siblings: siblings
        });

        // Wait for session to finish. In an actual system we'd await session status transitions.
        // For this vertical slice proof, we simulate waiting for a terminal state.
        await this.waitForSession(session.id);

        node.status = "done";
        node.sessionId = session.id;
        success = true;
        completeNode(this.plan.tree, node.id);
      } catch (err) {
        attempt++;
        this.retryCounts.set(node.id, attempt);
        if (attempt >= this.maxRetries) {
          this.state = "paused";
          const message = err instanceof Error ? err.message : String(err);
          this.notify(`Node ${node.id} failed after ${this.maxRetries} retries. DAG paused. Error: ${message}`);
        }
      }
    }
  }

  private async waitForSession(sessionId: string): Promise<void> {
    // Polling simulation to wait for session completion.
    // In reality, this would integrate with LifecycleManager or an event bus.
    while (true) {
      const session = await this.sessionManager.get(sessionId);
      if (!session) throw new Error("Session disappeared");
      if (["done", "merged", "killed", "errored", "terminated", "cleanup"].includes(session.status)) {
        if (["killed", "errored"].includes(session.status)) {
          throw new Error(`Session finished with error state: ${session.status}`);
        }
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  private notify(message: string) {
    if (this.onNotify) {
      this.onNotify(message);
    }
  }

  public getState(): ExecutionState {
    return this.state;
  }
}
