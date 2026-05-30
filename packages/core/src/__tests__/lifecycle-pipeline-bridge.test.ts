/**
 * Unit tests for the lifecycle-manager → pipeline-engine bridge (issue #192).
 *
 * The bridge converts PR-state transitions on a session into the matching
 * pipeline trigger events (`pr.opened`, `pr.updated`, `pr.merged`) and
 * dispatches them into the engine via `startRun` / `dispatch(NEW_SHA_DETECTED)`.
 *
 * These tests stub the engine so we can assert exactly what was dispatched.
 * Stage execution and reducer behaviour are covered separately in
 * pipeline-engine.test.ts and pipeline-reducer.test.ts.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { writeMetadata } from "../metadata.js";
import { createLifecycleManager } from "../lifecycle-manager.js";
import { recordActivityEvent } from "../activity-events.js";
import type {
  OrchestratorConfig,
  PluginRegistry,
  OpenCodeSessionManager,
  PRInfo,
  SCM,
  Session,
  SessionMetadata,
} from "../types.js";
import type { PipelineEngine } from "../pipeline/engine.js";
import {
  createMockPlugins,
  createMockRegistry,
  createMockSCM,
  createMockSessionManager,
  createTestEnvironment,
  makePR,
  makeSession,
  type TestEnvironment,
} from "./test-utils.js";

vi.mock("../activity-events.js", () => ({
  recordActivityEvent: vi.fn(),
}));

interface EngineCalls {
  startRun: ReturnType<typeof vi.fn>;
  dispatch: ReturnType<typeof vi.fn>;
}

function createStubEngine(): { engine: PipelineEngine; calls: EngineCalls } {
  const startRun = vi.fn().mockResolvedValue("run-stub");
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const engine: PipelineEngine = {
    state: () => ({ runs: {}, currentRunByLoop: {}, historySummaries: {} }),
    startRun: startRun as unknown as PipelineEngine["startRun"],
    dispatch: dispatch as unknown as PipelineEngine["dispatch"],
    tick: vi.fn().mockResolvedValue(undefined) as unknown as PipelineEngine["tick"],
    cancelRun: vi.fn().mockResolvedValue(undefined) as unknown as PipelineEngine["cancelRun"],
    reconcileInflightStages: vi
      .fn()
      .mockResolvedValue(undefined) as unknown as PipelineEngine["reconcileInflightStages"],
    shutdown: vi.fn().mockResolvedValue(undefined) as unknown as PipelineEngine["shutdown"],
  };
  return { engine, calls: { startRun, dispatch } };
}

/**
 * Build a project config with one pipeline whose only stage subscribes to
 * the listed trigger events. Lets each test exercise a specific trigger.
 */
function configWithPipeline(
  env: TestEnvironment,
  triggers: ReadonlyArray<"pr.opened" | "pr.updated" | "pr.merged" | "pr.merge_ready" | "manual">,
): OrchestratorConfig {
  return {
    ...env.config,
    projects: {
      ...env.config.projects,
      "my-app": {
        ...env.config.projects["my-app"]!,
        pipelines: {
          review: {
            name: "review",
            stages: [
              {
                name: "lint",
                trigger: { on: [...triggers] },
                executor: { kind: "agent", plugin: "claude-code", mode: "review" },
                task: { prompt: "lint" },
              },
            ],
          },
        },
      },
    },
  };
}

function sessionWithOpenPR(pr: PRInfo): Session {
  return makeSession({
    pr,
    lifecycle: {
      ...makeSession().lifecycle,
      pr: {
        state: "open",
        reason: "in_progress",
        number: pr.number,
        url: pr.url,
        lastObservedAt: new Date().toISOString(),
      },
    },
  });
}

describe("lifecycle pipeline-trigger bridge", () => {
  let env: TestEnvironment;
  let mockSCM: SCM;
  let mockSessionManager: OpenCodeSessionManager;
  let mockRegistry: PluginRegistry;
  let scmHeadSha: string | null;

  beforeEach(() => {
    env = createTestEnvironment();
    vi.mocked(recordActivityEvent).mockClear();
    scmHeadSha = "sha-aaa";
    const plugins = createMockPlugins();
    mockSCM = createMockSCM({
      detectPR: vi.fn().mockResolvedValue(makePR({ owner: "org", repo: "my-app" })),
      getPRState: vi.fn().mockResolvedValue("open"),
      enrichSessionsPRBatch: vi.fn().mockImplementation(async (prs: PRInfo[]) => {
        const result = new Map();
        for (const pr of prs) {
          result.set(`${pr.owner}/${pr.repo}#${pr.number}`, {
            state: "open",
            ciStatus: "passing",
            reviewDecision: "none",
            mergeable: false,
            headSha: scmHeadSha,
          });
        }
        return result;
      }),
    });
    mockSessionManager = createMockSessionManager();
    mockRegistry = createMockRegistry({
      runtime: plugins.runtime,
      agent: plugins.agent,
      workspace: plugins.workspace,
      scm: mockSCM,
    });
  });

  afterEach(() => {
    env.cleanup();
  });

  it("dispatches TRIGGER_FIRED(pr.opened) when a PR transitions none→open", async () => {
    const config = configWithPipeline(env, ["pr.opened"]);
    const pr = makePR({ owner: "org", repo: "my-app" });
    // session.pr is set but lifecycle.pr.state is still "none" (synthesized
    // from empty metadata). populatePREnrichmentCache fills the cache via the
    // batch SCM mock; then determineStatus flips lifecycle.pr.state to "open"
    // and the bridge sees the real transition with headSha already available.
    const session = makeSession({ pr });
    vi.mocked(mockSessionManager.list).mockResolvedValue([session]);
    vi.mocked(mockSessionManager.get).mockResolvedValue(session);
    writeMetadata(env.sessionsDir, session.id, {
      worktree: "/tmp",
      branch: "feat/test",
      status: "working",
      project: "my-app",
    } as unknown as SessionMetadata);
    vi.mocked(mockSCM.detectPR).mockResolvedValue(pr);

    const { engine, calls } = createStubEngine();
    const lm = createLifecycleManager({
      config,
      registry: mockRegistry,
      sessionManager: mockSessionManager,
      projectId: "my-app",
      pipelineEngine: engine,
    });

    await lm.check(session.id);

    expect(calls.startRun).toHaveBeenCalledTimes(1);
    const call = calls.startRun.mock.calls[0][0];
    expect(call.trigger).toBe("pr.opened");
    expect(call.sessionId).toBe(session.id);
    expect(call.projectId).toBe("my-app");
    expect(call.pipeline.name).toBe("review");
    expect(call.headSha).toBe("sha-aaa");
    expect(calls.dispatch).not.toHaveBeenCalled();
  });

  it("does not dispatch when the configured pipeline doesn't subscribe to the event", async () => {
    // Pipeline only subscribes to pr.merge_ready — pr.opened must NOT trigger.
    const config = configWithPipeline(env, ["pr.merge_ready"]);
    const pr = makePR({ owner: "org", repo: "my-app" });
    const session = makeSession({ pr: null });
    vi.mocked(mockSessionManager.list).mockResolvedValue([session]);
    vi.mocked(mockSessionManager.get).mockResolvedValue(session);
    writeMetadata(env.sessionsDir, session.id, {
      worktree: "/tmp",
      branch: "feat/test",
      status: "working",
      project: "my-app",
    } as unknown as SessionMetadata);
    vi.mocked(mockSCM.detectPR).mockResolvedValue(pr);

    const { engine, calls } = createStubEngine();
    const lm = createLifecycleManager({
      config,
      registry: mockRegistry,
      sessionManager: mockSessionManager,
      projectId: "my-app",
      pipelineEngine: engine,
    });

    await lm.check(session.id);

    expect(calls.startRun).not.toHaveBeenCalled();
    expect(calls.dispatch).not.toHaveBeenCalled();
  });

  it("is idempotent across polls when PR state does not change", async () => {
    const config = configWithPipeline(env, ["pr.opened"]);
    const pr = makePR({ owner: "org", repo: "my-app" });
    const session = sessionWithOpenPR(pr);
    vi.mocked(mockSessionManager.list).mockResolvedValue([session]);
    vi.mocked(mockSessionManager.get).mockResolvedValue(session);
    writeMetadata(env.sessionsDir, session.id, {
      worktree: "/tmp",
      branch: "feat/test",
      status: "pr_open",
      project: "my-app",
      pr: pr.url,
    } as unknown as SessionMetadata);
    vi.mocked(mockSCM.detectPR).mockResolvedValue(pr);

    const { engine, calls } = createStubEngine();
    const lm = createLifecycleManager({
      config,
      registry: mockRegistry,
      sessionManager: mockSessionManager,
      projectId: "my-app",
      pipelineEngine: engine,
    });

    // PR was already open BEFORE the first poll — no transition, no dispatch.
    await lm.check(session.id);
    await lm.check(session.id);
    await lm.check(session.id);

    expect(calls.startRun).not.toHaveBeenCalled();
    expect(calls.dispatch).not.toHaveBeenCalled();
  });

  it("dispatches NEW_SHA_DETECTED + TRIGGER_FIRED(pr.updated) when HEAD SHA changes on open PR", async () => {
    const config = configWithPipeline(env, ["pr.updated"]);
    const pr = makePR({ owner: "org", repo: "my-app" });
    const session = sessionWithOpenPR(pr);
    vi.mocked(mockSessionManager.list).mockResolvedValue([session]);
    vi.mocked(mockSessionManager.get).mockResolvedValue(session);
    writeMetadata(env.sessionsDir, session.id, {
      worktree: "/tmp",
      branch: "feat/test",
      status: "pr_open",
      project: "my-app",
      pr: pr.url,
    } as unknown as SessionMetadata);
    vi.mocked(mockSCM.detectPR).mockResolvedValue(pr);

    const { engine, calls } = createStubEngine();
    const lm = createLifecycleManager({
      config,
      registry: mockRegistry,
      sessionManager: mockSessionManager,
      projectId: "my-app",
      pipelineEngine: engine,
    });

    // First poll seeds the SHA tracker; no transition so no dispatch.
    scmHeadSha = "sha-aaa";
    await lm.check(session.id);
    expect(calls.startRun).not.toHaveBeenCalled();
    expect(calls.dispatch).not.toHaveBeenCalled();

    // Second poll observes a new SHA — bridge dispatches both events.
    scmHeadSha = "sha-bbb";
    await lm.check(session.id);

    expect(calls.dispatch).toHaveBeenCalledTimes(1);
    const dispatchCall = calls.dispatch.mock.calls[0][0];
    expect(dispatchCall).toMatchObject({
      type: "NEW_SHA_DETECTED",
      sessionId: session.id,
      pipelineName: "review",
      sha: "sha-bbb",
    });
    expect(calls.startRun).toHaveBeenCalledTimes(1);
    expect(calls.startRun.mock.calls[0][0].trigger).toBe("pr.updated");
    expect(calls.startRun.mock.calls[0][0].headSha).toBe("sha-bbb");

    // Third poll with the same SHA — no further dispatches.
    await lm.check(session.id);
    expect(calls.dispatch).toHaveBeenCalledTimes(1);
    expect(calls.startRun).toHaveBeenCalledTimes(1);
  });

  it("no-ops when the project has no pipelines configured at all", async () => {
    // env.config has no pipelines — keep it as-is.
    const pr = makePR({ owner: "org", repo: "my-app" });
    const session = makeSession({ pr: null });
    vi.mocked(mockSessionManager.list).mockResolvedValue([session]);
    vi.mocked(mockSessionManager.get).mockResolvedValue(session);
    writeMetadata(env.sessionsDir, session.id, {
      worktree: "/tmp",
      branch: "feat/test",
      status: "working",
      project: "my-app",
    } as unknown as SessionMetadata);
    vi.mocked(mockSCM.detectPR).mockResolvedValue(pr);

    const { engine, calls } = createStubEngine();
    const lm = createLifecycleManager({
      config: env.config,
      registry: mockRegistry,
      sessionManager: mockSessionManager,
      projectId: "my-app",
      pipelineEngine: engine,
    });

    await lm.check(session.id);

    expect(calls.startRun).not.toHaveBeenCalled();
    expect(calls.dispatch).not.toHaveBeenCalled();
  });

  it("no-ops when no pipelineEngine is wired into the lifecycle manager", async () => {
    const config = configWithPipeline(env, ["pr.opened"]);
    const pr = makePR({ owner: "org", repo: "my-app" });
    const session = makeSession({ pr: null });
    vi.mocked(mockSessionManager.list).mockResolvedValue([session]);
    vi.mocked(mockSessionManager.get).mockResolvedValue(session);
    writeMetadata(env.sessionsDir, session.id, {
      worktree: "/tmp",
      branch: "feat/test",
      status: "working",
      project: "my-app",
    } as unknown as SessionMetadata);
    vi.mocked(mockSCM.detectPR).mockResolvedValue(pr);

    const lm = createLifecycleManager({
      config,
      registry: mockRegistry,
      sessionManager: mockSessionManager,
      projectId: "my-app",
    });

    // Should not throw — the bridge is a no-op when no engine is configured.
    await expect(lm.check(session.id)).resolves.not.toThrow();
  });
});
