/**
 * Tests for EMIT_OBSERVATION → onObservation routing (#197 / 8c).
 *
 * Asserts that the engine fans out reducer-emitted observations to the
 * injected callback, enriches them with sessionId / projectId from the
 * underlying RunState + runMetadata side-table, and swallows callback
 * errors so a routing failure can't crash the engine.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import type { Agent, PluginManifest, PluginModule, PluginRegistry } from "../types.js";
import { createPluginRegistry } from "../plugin-registry.js";
import {
  asPipelineId,
  createPipelineEngine,
  createPipelineStore,
  hydrateEngineState,
  type AgentStageExecutor,
  type ObservationContext,
  type Pipeline,
} from "../pipeline/index.js";

function makeAgentPlugin(name: string): PluginModule<Agent> {
  const manifest: PluginManifest = {
    name,
    slot: "agent",
    description: "test",
    version: "0.0.0",
    supportedTaskModes: ["review"],
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

function makeRegistry(): PluginRegistry {
  const r = createPluginRegistry();
  r.register(makeAgentPlugin("codex"));
  return r;
}

// Agent executor stub — every stage "completes" immediately on poll with the
// caller-supplied artifacts. The engine only uses it for START/POLL/CANCEL.
function makeAgentExecutor(): AgentStageExecutor {
  return {
    startStage: async (input) => ({
      runId: input.runId,
      stageRunId: input.stageRunId,
      stageName: input.stage.name,
      sessionId: "stub-session" as never,
      workspacePath: "/tmp/ws",
      startedAt: Date.now(),
      input,
    }),
    pollStage: async () => ({ status: "completed", artifacts: [] }),
    cancelStage: async () => undefined,
  };
}

function makePipeline(): Pipeline {
  return {
    id: asPipelineId("pl-1"),
    name: "default",
    stages: [
      {
        name: "review",
        trigger: { on: ["manual"] },
        executor: { kind: "agent", plugin: "codex", mode: "review" },
        task: {},
      },
    ],
    maxConcurrentStages: 1,
  };
}

describe("engine routes EMIT_OBSERVATION to onObservation", () => {
  let storeRoot: string;
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "ao-obs-route-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it("invokes onObservation for run-create and forwards run context", async () => {
    const store = createPipelineStore(storeRoot);
    const captured: Array<{ name: string; ctx: ObservationContext }> = [];
    const engine = createPipelineEngine({
      store,
      registry: makeRegistry(),
      agentExecutor: makeAgentExecutor(),
      initialState: hydrateEngineState(store),
      onObservation: (event, ctx) =>
        captured.push({ name: event.name, ctx: { ...ctx } }),
    });

    await engine.startRun({
      pipeline: makePipeline(),
      projectId: "proj-1",
      sessionId: "ses-1",
      headSha: "sha-aaa",
      trigger: "manual",
    });

    const created = captured.find((c) => c.name === "pipeline.run.created");
    expect(created).toBeDefined();
    expect(created!.ctx.sessionId).toBe("ses-1");
    expect(created!.ctx.projectId).toBe("proj-1");
    expect(created!.ctx.pipelineName).toBe("default");
    expect(typeof created!.ctx.runId).toBe("string");
  });

  it("swallows errors thrown by onObservation", async () => {
    const store = createPipelineStore(storeRoot);
    const engine = createPipelineEngine({
      store,
      registry: makeRegistry(),
      agentExecutor: makeAgentExecutor(),
      initialState: hydrateEngineState(store),
      onObservation: () => {
        throw new Error("boom");
      },
    });

    // Should NOT throw despite the callback throwing on every observation.
    await expect(
      engine.startRun({
        pipeline: makePipeline(),
        projectId: "proj-1",
        sessionId: "ses-1",
        headSha: "sha-aaa",
        trigger: "manual",
      }),
    ).resolves.toBeDefined();
  });
});
