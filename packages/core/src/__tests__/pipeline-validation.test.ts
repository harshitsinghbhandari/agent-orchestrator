import { describe, expect, it } from "vitest";

import {
  PipelineConfigError,
  asPipelineId,
  getSupportedTaskModes,
  validatePipelineAgentModes,
  type Pipeline,
  type Stage,
  type TaskMode,
} from "../pipeline/index.js";
import { createPluginRegistry } from "../plugin-registry.js";
import type { Agent, PluginManifest, PluginModule, PluginRegistry } from "../types.js";

function makeAgentPlugin(name: string, modes?: TaskMode[]): PluginModule<Agent> {
  const manifest: PluginManifest = {
    name,
    slot: "agent",
    description: `${name} test plugin`,
    version: "0.0.0",
    ...(modes ? { supportedTaskModes: modes } : {}),
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

function makeStage(overrides: Partial<Stage>): Stage {
  return {
    name: "review",
    trigger: { on: ["pr.opened"] },
    executor: { kind: "agent", plugin: "codex", mode: "review" },
    task: { prompt: "review" },
    ...overrides,
  };
}

function makePipeline(stages: Stage[]): Pipeline {
  return { id: asPipelineId("pl-1"), name: "default", stages, maxConcurrentStages: 1 };
}

describe("getSupportedTaskModes", () => {
  it("returns the manifest's supportedTaskModes when set", () => {
    const r = withRegistry([makeAgentPlugin("codex", ["review", "code"])]);
    expect(getSupportedTaskModes(r, "codex")).toEqual(["review", "code"]);
  });

  it("returns [] when the agent plugin omits supportedTaskModes", () => {
    const r = withRegistry([makeAgentPlugin("codex")]);
    expect(getSupportedTaskModes(r, "codex")).toEqual([]);
  });

  it("returns null when the agent plugin is unknown", () => {
    const r = withRegistry([makeAgentPlugin("codex", ["review"])]);
    expect(getSupportedTaskModes(r, "no-such-plugin")).toBeNull();
  });
});

describe("validatePipelineAgentModes", () => {
  it("accepts a pipeline whose agent supports the requested mode", () => {
    const r = withRegistry([makeAgentPlugin("codex", ["review"])]);
    const pipeline = makePipeline([
      makeStage({ executor: { kind: "agent", plugin: "codex", mode: "review" } }),
    ]);
    expect(() => validatePipelineAgentModes(pipeline, r)).not.toThrow();
  });

  it("rejects a stage routed to an agent that does not advertise the mode", () => {
    const r = withRegistry([makeAgentPlugin("codex", ["code"])]);
    const pipeline = makePipeline([
      makeStage({
        name: "review",
        executor: { kind: "agent", plugin: "codex", mode: "review" },
      }),
    ]);
    expect(() => validatePipelineAgentModes(pipeline, r)).toThrow(PipelineConfigError);
    try {
      validatePipelineAgentModes(pipeline, r);
    } catch (err) {
      expect((err as Error).message).toContain('agent "codex"');
      expect((err as Error).message).toContain('mode "review"');
      expect((err as Error).message).toContain('"code"');
    }
  });

  it("rejects an agent that omits supportedTaskModes (defaults to [])", () => {
    const r = withRegistry([makeAgentPlugin("codex")]);
    const pipeline = makePipeline([
      makeStage({ executor: { kind: "agent", plugin: "codex", mode: "review" } }),
    ]);
    expect(() => validatePipelineAgentModes(pipeline, r)).toThrow(PipelineConfigError);
  });

  it("rejects unknown agent plugins with a clear message", () => {
    const r = withRegistry([makeAgentPlugin("codex", ["review"])]);
    const pipeline = makePipeline([
      makeStage({ executor: { kind: "agent", plugin: "nonexistent", mode: "review" } }),
    ]);
    expect(() => validatePipelineAgentModes(pipeline, r)).toThrow(/unknown agent plugin/);
  });

  it("ignores command stages — they have no mode", () => {
    const r = withRegistry([makeAgentPlugin("codex", ["review"])]);
    const pipeline = makePipeline([
      makeStage({ name: "lint", executor: { kind: "command", command: "eslint" } }),
    ]);
    expect(() => validatePipelineAgentModes(pipeline, r)).not.toThrow();
  });

  it("validates every stage in a multi-stage pipeline and fails on the first mismatch", () => {
    const r = withRegistry([
      makeAgentPlugin("codex", ["review"]),
      makeAgentPlugin("aider", ["code"]),
    ]);
    const pipeline = makePipeline([
      makeStage({ name: "review", executor: { kind: "agent", plugin: "codex", mode: "review" } }),
      makeStage({
        name: "fix",
        executor: { kind: "agent", plugin: "aider", mode: "review" },
      }),
    ]);
    expect(() => validatePipelineAgentModes(pipeline, r)).toThrow(/stage "fix"/);
  });
});
