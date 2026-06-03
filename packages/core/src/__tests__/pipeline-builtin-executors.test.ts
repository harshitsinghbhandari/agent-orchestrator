/**
 * Tests for the builtin executors (router + compose) and the engine wiring
 * that dispatches them.
 *
 * Coverage:
 *  - router success: alive worker → ctx.sendToSession called once per input
 *    stage; STAGE_COMPLETED records a `delivered` JSON artifact per stage
 *  - router worker-dead: terminal/missing worker → no send, observation
 *    `pipeline.send.skipped_worker_dead` emitted, `delivery_failed` artifact
 *    recorded, run still succeeds (router verdict is neutral)
 *  - compose: merges multiple upstream artifact lists into one JSON artifact
 *
 * The engine is exercised end-to-end with a 2-stage pipeline: an upstream
 * agent stage produces findings, then the downstream builtin consumes them
 * via `dependsOn`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  asPipelineId,
  createPipelineEngine,
  createPipelineStore,
  type AgentStageExecutor,
  type ArtifactInput,
  type Pipeline,
  type RunningAgentStage,
  type Stage,
  type StageOutcome,
  type StartStageInput,
  type TaskMode,
} from "../pipeline/index.js";
import { createPluginRegistry } from "../plugin-registry.js";
import type { Agent, PluginManifest, PluginModule, PluginRegistry } from "../types.js";

let storeRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "pipeline-builtin-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

function makeAgentPlugin(name: string, modes: TaskMode[]): PluginModule<Agent> {
  const manifest: PluginManifest = {
    name,
    slot: "agent",
    description: "test",
    version: "0.0.0",
    supportedTaskModes: modes,
  };
  return {
    manifest,
    create: () =>
      ({
        name,
        processName: name,
        getLaunchCommand: () => "true",
        getEnvironment: () => ({}),
        detectActivity: () => "idle",
        getActivityState: async () => null,
        isProcessRunning: async () => true,
        getSessionInfo: async () => null,
      }) as Agent,
  };
}

function withRegistry(plugins: PluginModule[]): PluginRegistry {
  const r = createPluginRegistry();
  for (const p of plugins) r.register(p);
  return r;
}

interface MockExecutor extends AgentStageExecutor {
  startCalls: StartStageInput[];
  setNextOutcome: (outcome: StageOutcome) => void;
}

function makeMockAgentExecutor(): MockExecutor {
  let nextOutcome: StageOutcome = { status: "running" };
  const startCalls: StartStageInput[] = [];
  const exec: MockExecutor = {
    startCalls,
    setNextOutcome: (o) => {
      nextOutcome = o;
    },
    async startStage(input) {
      startCalls.push(input);
      return {
        runId: input.runId,
        stageRunId: input.stageRunId,
        stageName: input.stage.name,
        sessionId: `mock-ses-${startCalls.length}`,
        workspacePath: "/tmp/mock",
        startedAt: Date.now(),
        input,
      };
    },
    async pollStage(_h: RunningAgentStage) {
      return nextOutcome;
    },
    async cancelStage() {
      /* no-op */
    },
  };
  return exec;
}

function makeAgentStage(name: string, overrides: Partial<Stage> = {}): Stage {
  return {
    name,
    trigger: { on: ["pr.opened"] },
    executor: { kind: "agent", plugin: "codex", mode: "review" },
    task: { prompt: name },
    ...overrides,
  };
}

function makeBuiltinStage(
  name: string,
  builtinName: "router" | "compose",
  dependsOn: string[],
): Stage {
  return {
    name,
    trigger: { on: ["pr.opened"] },
    executor: { kind: "builtin", name: builtinName },
    task: {},
    dependsOn,
  };
}

function makePipeline(stages: Stage[]): Pipeline {
  return { id: asPipelineId("pl-builtin"), name: "builtin", stages, maxConcurrentStages: 1 };
}

const sampleFinding = (idx: number): ArtifactInput => ({
  kind: "finding",
  filePath: `src/file${idx}.ts`,
  startLine: idx,
  endLine: idx,
  title: `Finding ${idx}`,
  description: `Issue at line ${idx}`,
  category: "general",
  severity: "warning",
  confidence: 0.9,
});

describe("pipeline builtin executors", () => {
  describe("router", () => {
    it("delivers upstream findings to the linked worker via sendToSession", async () => {
      const registry = withRegistry([makeAgentPlugin("codex", ["review"])]);
      const store = createPipelineStore(storeRoot);
      const agentExecutor = makeMockAgentExecutor();
      const isSessionAlive = vi.fn(async () => true);
      const sendToSession = vi.fn(async (_id: string, _msg: string) => {
        /* delivered */
      });

      const engine = createPipelineEngine({
        store,
        registry,
        agentExecutor,
        builtin: { isSessionAlive, sendToSession },
      });

      const pipeline = makePipeline([
        makeAgentStage("review"),
        makeBuiltinStage("deliver", "router", ["review"]),
      ]);

      const runId = await engine.startRun({
        pipeline,
        projectId: "proj-a",
        sessionId: "worker-session-1",
        headSha: "sha",
      });

      // Upstream stage produces two findings, then completes.
      agentExecutor.setNextOutcome({
        status: "completed",
        artifacts: [sampleFinding(1), sampleFinding(2)],
      });
      await engine.tick();

      // Router runs synchronously as part of the upstream's STAGE_COMPLETED
      // cascade, so by the time the tick resolves the whole pipeline is done.
      const finalRun = store.loadRun(runId)!;
      expect(finalRun.stages["deliver"]?.status).toBe("succeeded");
      expect(finalRun.stages["deliver"]?.verdict).toBe("neutral");
      expect(finalRun.loopState).toBe("done");

      // Liveness probed exactly once; send called exactly once (one input stage)
      expect(isSessionAlive).toHaveBeenCalledTimes(1);
      expect(isSessionAlive).toHaveBeenCalledWith("worker-session-1");
      expect(sendToSession).toHaveBeenCalledTimes(1);
      expect(sendToSession.mock.calls[0]?.[0]).toBe("worker-session-1");
      expect(sendToSession.mock.calls[0]?.[1]).toContain("review");
      expect(sendToSession.mock.calls[0]?.[1]).toContain("Finding 1");
      expect(sendToSession.mock.calls[0]?.[1]).toContain("Finding 2");

      // One `delivered` artifact recorded on disk.
      const deliverRunId = finalRun.stages["deliver"]!.stageRunId;
      const deliverArtifacts = store.listArtifacts(runId, deliverRunId);
      expect(deliverArtifacts).toHaveLength(1);
      expect(deliverArtifacts[0]).toMatchObject({
        kind: "json",
        data: {
          result: "delivered",
          fromStage: "review",
          targetSessionId: "worker-session-1",
          artifactCount: 2,
        },
      });
    });

    it("skips delivery when the linked worker is dead (no retry-spam)", async () => {
      const registry = withRegistry([makeAgentPlugin("codex", ["review"])]);
      const store = createPipelineStore(storeRoot);
      const agentExecutor = makeMockAgentExecutor();
      const isSessionAlive = vi.fn(async () => false);
      const sendToSession = vi.fn(async () => {
        throw new Error("should not be called");
      });

      const engine = createPipelineEngine({
        store,
        registry,
        agentExecutor,
        builtin: { isSessionAlive, sendToSession },
      });

      const pipeline = makePipeline([
        makeAgentStage("review"),
        makeBuiltinStage("deliver", "router", ["review"]),
      ]);

      const runId = await engine.startRun({
        pipeline,
        projectId: "proj-a",
        sessionId: "dead-worker",
        headSha: "sha",
      });

      agentExecutor.setNextOutcome({
        status: "completed",
        artifacts: [sampleFinding(1)],
      });
      await engine.tick();

      const finalRun = store.loadRun(runId)!;
      // Router still succeeds (verdict neutral) — worker_dead is a runtime
      // delivery condition, not a stage failure.
      expect(finalRun.stages["deliver"]?.status).toBe("succeeded");
      expect(finalRun.stages["deliver"]?.verdict).toBe("neutral");

      // sendToSession never called; pre-send probe returned false.
      expect(sendToSession).not.toHaveBeenCalled();
      expect(isSessionAlive).toHaveBeenCalledTimes(1);

      // Artifact records `delivery_failed` with reason=worker_dead.
      const deliverRunId = finalRun.stages["deliver"]!.stageRunId;
      const deliverArtifacts = store.listArtifacts(runId, deliverRunId);
      expect(deliverArtifacts).toHaveLength(1);
      expect(deliverArtifacts[0]).toMatchObject({
        kind: "json",
        data: {
          result: "delivery_failed",
          reason: "worker_dead",
          fromStage: "review",
          targetSessionId: "dead-worker",
        },
      });

      // Upstream finding stays `open` (router does not flip status).
      const reviewRunId = finalRun.stages["review"]!.stageRunId;
      const reviewArtifacts = store.listArtifacts(runId, reviewRunId);
      expect(reviewArtifacts).toHaveLength(1);
      expect(reviewArtifacts[0]?.status).toBe("open");
    });
  });

  describe("compose", () => {
    it("merges multiple upstream artifact lists into a single JSON artifact", async () => {
      const registry = withRegistry([makeAgentPlugin("codex", ["review", "code"])]);
      const store = createPipelineStore(storeRoot);
      const agentExecutor = makeMockAgentExecutor();
      const isSessionAlive = vi.fn(async () => true);
      const sendToSession = vi.fn(async () => {
        /* unused */
      });

      const engine = createPipelineEngine({
        store,
        registry,
        agentExecutor,
        builtin: { isSessionAlive, sendToSession },
      });

      // Two parallel upstream stages → compose merges both.
      const pipeline = makePipeline([
        makeAgentStage("review-a"),
        makeAgentStage("review-b", {
          executor: { kind: "agent", plugin: "codex", mode: "code" },
        }),
        makeBuiltinStage("merge", "compose", ["review-a", "review-b"]),
      ]);

      const runId = await engine.startRun({
        pipeline,
        projectId: "proj-a",
        sessionId: "worker",
        headSha: "sha",
      });

      // Complete first upstream (review-a) → engine schedules review-b next
      // (serial scheduling with maxConcurrentStages=1).
      agentExecutor.setNextOutcome({
        status: "completed",
        artifacts: [sampleFinding(1), sampleFinding(2)],
      });
      await engine.tick();

      // Complete review-b → compose runs synchronously after.
      agentExecutor.setNextOutcome({
        status: "completed",
        artifacts: [sampleFinding(3)],
      });
      await engine.tick();

      const finalRun = store.loadRun(runId)!;
      expect(finalRun.stages["merge"]?.status).toBe("succeeded");
      expect(finalRun.loopState).toBe("done");

      // sendToSession never called — compose doesn't deliver.
      expect(sendToSession).not.toHaveBeenCalled();

      const mergeRunId = finalRun.stages["merge"]!.stageRunId;
      const composedArtifacts = store.listArtifacts(runId, mergeRunId);
      expect(composedArtifacts).toHaveLength(1);
      const data = composedArtifacts[0]?.kind === "json" ? composedArtifacts[0].data : null;
      expect(data).toMatchObject({
        composedFrom: expect.arrayContaining(["review-a", "review-b"]),
        totalArtifacts: 3,
      });
      const stages = (data as { stages: Record<string, unknown[]> }).stages;
      expect(stages["review-a"]).toHaveLength(2);
      expect(stages["review-b"]).toHaveLength(1);
    });
  });

  describe("engine wiring", () => {
    it("fails a builtin stage with a clear message when builtin deps are not configured", async () => {
      const registry = withRegistry([makeAgentPlugin("codex", ["review"])]);
      const store = createPipelineStore(storeRoot);
      const agentExecutor = makeMockAgentExecutor();
      // No `builtin` dep passed — router stages must fail with a clear message.
      const engine = createPipelineEngine({ store, registry, agentExecutor });

      const pipeline = makePipeline([makeBuiltinStage("deliver", "router", [])]);

      const runId = await engine.startRun({
        pipeline,
        projectId: "proj-a",
        sessionId: "ses",
        headSha: "sha",
      });

      const run = store.loadRun(runId)!;
      expect(run.stages["deliver"]?.status).toBe("failed");
      expect(run.stages["deliver"]?.errorMessage).toMatch(/builtin.*configured/i);
    });
  });
});
