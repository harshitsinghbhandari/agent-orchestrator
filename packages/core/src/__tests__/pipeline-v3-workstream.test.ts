/**
 * Pipeline-v3 (issue #199) coverage:
 *  - Workstream manager: creation, join idempotence, per-project uniqueness,
 *    WORKSTREAM_CREATED / WORKSTREAM_MEMBER_ADDED events.
 *  - Workstream aggregate fan-in: `workstream.all_merged` fires once at the
 *    edge; doesn't re-fire on subsequent ticks; non-forgiven membership.
 *  - Workstream predicates: `all_workstream_workers_in_state`,
 *    `all_workstream_workers_match` (per-pipeline recursion),
 *    `workstream_member_count` — and `false` for non-workstream runs.
 *  - Router scope routing: workstream-scoped run sends to the workstream's
 *    orchestrator session; emits `routing.orchestrator_absent` when the
 *    orchestrator is missing; bypasses the worker-alive probe.
 *  - AO_PIPELINE_V3 gate: declared scope downgrades to `worker` when off,
 *    passes through when on.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeWorkstreamAggregateTriggers,
  createWorkstreamManager,
  freshAggregateSnapshot,
  workstreamSessionId,
  type AggregateSnapshot,
  type WorkstreamSessionInput,
  type WorkstreamEvent,
} from "../index.js";
import {
  asPipelineId,
  asRunId,
  asStageRunId,
  configuredPipelineToRuntime,
  evaluatePredicate,
  type Predicate,
  type PredicateCtx,
  type RunState,
  type WorkstreamPredicateCtx,
} from "../pipeline/index.js";
import { runRouter } from "../pipeline/executors/builtin/router.js";
import type { BuiltinTaskContext } from "../pipeline/types.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "ao-pipeline-v3-"));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
  delete process.env["AO_PIPELINE_V3"];
});

function workstreamFixtureDeps() {
  const events: WorkstreamEvent[] = [];
  const manager = createWorkstreamManager({
    rootForProject: (projectId) => join(tempRoot, projectId),
    onEvent: (e) => events.push(e),
    now: () => new Date("2026-06-06T00:00:00.000Z"),
  });
  return { manager, events };
}

describe("WorkstreamManager (#199)", () => {
  it("creates a workstream on first getOrCreate and emits WORKSTREAM_CREATED once", () => {
    const { manager, events } = workstreamFixtureDeps();
    const first = manager.getOrCreate("proj-a", "release-v2.5", {
      orchestratorSessionId: "proj-a-orchestrator",
      baseBranch: "main",
    });
    const second = manager.getOrCreate("proj-a", "release-v2.5");

    expect(first.workstreamId).toBe("release-v2.5");
    expect(first.orchestratorSessionId).toBe("proj-a-orchestrator");
    expect(first.baseBranch).toBe("main");
    expect(second.createdAt).toBe(first.createdAt);
    expect(events.filter((e) => e.type === "WORKSTREAM_CREATED")).toHaveLength(1);
  });

  it("addMember is idempotent and emits WORKSTREAM_MEMBER_ADDED only on first add", () => {
    const { manager, events } = workstreamFixtureDeps();
    manager.getOrCreate("proj-a", "ws", { orchestratorSessionId: "orc" });
    manager.addMember("proj-a", "ws", "proj-a-1");
    manager.addMember("proj-a", "ws", "proj-a-1");
    manager.addMember("proj-a", "ws", "proj-a-2");

    const state = manager.get("proj-a", "ws");
    expect(state?.members).toEqual(["proj-a-1", "proj-a-2"]);
    expect(events.filter((e) => e.type === "WORKSTREAM_MEMBER_ADDED")).toHaveLength(2);
  });

  it("uniqueness is per-project (same id in different projects are separate workstreams)", () => {
    const { manager } = workstreamFixtureDeps();
    manager.getOrCreate("proj-a", "ws");
    manager.getOrCreate("proj-b", "ws");
    manager.addMember("proj-a", "ws", "a-1");
    manager.addMember("proj-b", "ws", "b-1");
    expect(manager.get("proj-a", "ws")?.members).toEqual(["a-1"]);
    expect(manager.get("proj-b", "ws")?.members).toEqual(["b-1"]);
  });

  it("addMember throws when the workstream does not yet exist", () => {
    const { manager } = workstreamFixtureDeps();
    expect(() => manager.addMember("proj-a", "ghost", "a-1")).toThrow(/does not exist/);
  });
});

// --------------------------------------------------------------------------
// Fan-in: aggregate edge-triggering of `workstream.all_*`
// --------------------------------------------------------------------------

function makeSessionInput(
  sessionId: string,
  overrides: Partial<WorkstreamSessionInput> = {},
): WorkstreamSessionInput {
  return {
    sessionId,
    prState: overrides.prState ?? "open",
    latestRunByPipeline: overrides.latestRunByPipeline ?? {},
    ...(overrides.forgiven ? { forgiven: true } : {}),
    ...(overrides.stalled ? { stalled: true } : {}),
  };
}

describe("computeWorkstreamAggregateTriggers (#199 fan-in)", () => {
  it("fires workstream.all_merged exactly once when every non-forgiven member merges", () => {
    const { manager } = workstreamFixtureDeps();
    manager.getOrCreate("proj-a", "ws", { orchestratorSessionId: "orc" });
    manager.addMember("proj-a", "ws", "a-1");
    manager.addMember("proj-a", "ws", "a-2");

    const previousAggregates = new Map<string, AggregateSnapshot>();

    // Tick 1 — both open, no all_merged yet.
    const r1 = computeWorkstreamAggregateTriggers({
      workstreams: manager.list("proj-a"),
      sessions: [makeSessionInput("a-1"), makeSessionInput("a-2")],
      previousAggregates,
    });
    expect(r1.dispatches.map((d) => d.trigger)).toEqual(["workstream.all_pr_opened"]);

    // Tick 2 — first member merges; still not all merged.
    const r2 = computeWorkstreamAggregateTriggers({
      workstreams: manager.list("proj-a"),
      sessions: [
        makeSessionInput("a-1", { prState: "merged" }),
        makeSessionInput("a-2", { prState: "open" }),
      ],
      previousAggregates,
    });
    expect(r2.dispatches.map((d) => d.trigger)).toEqual([]);

    // Tick 3 — both merged; all_merged fires once.
    const r3 = computeWorkstreamAggregateTriggers({
      workstreams: manager.list("proj-a"),
      sessions: [
        makeSessionInput("a-1", { prState: "merged" }),
        makeSessionInput("a-2", { prState: "merged" }),
      ],
      previousAggregates,
    });
    expect(r3.dispatches.map((d) => d.trigger)).toEqual(["workstream.all_merged"]);

    // Tick 4 — same state; no re-fire.
    const r4 = computeWorkstreamAggregateTriggers({
      workstreams: manager.list("proj-a"),
      sessions: [
        makeSessionInput("a-1", { prState: "merged" }),
        makeSessionInput("a-2", { prState: "merged" }),
      ],
      previousAggregates,
    });
    expect(r4.dispatches).toEqual([]);
  });

  it("ignores forgiven members when computing all_merged", () => {
    const { manager } = workstreamFixtureDeps();
    manager.getOrCreate("proj-a", "ws");
    manager.addMember("proj-a", "ws", "a-1");
    manager.addMember("proj-a", "ws", "a-2");

    const previousAggregates = new Map<string, AggregateSnapshot>();
    const result = computeWorkstreamAggregateTriggers({
      workstreams: manager.list("proj-a"),
      sessions: [
        makeSessionInput("a-1", { prState: "merged" }),
        makeSessionInput("a-2", { prState: "open", forgiven: true }),
      ],
      previousAggregates,
    });
    expect(result.dispatches.map((d) => d.trigger)).toContain("workstream.all_merged");
  });

  it("uses ws:{id} as synthetic sessionId so engine loopKey stays partitioned", () => {
    const { manager } = workstreamFixtureDeps();
    manager.getOrCreate("proj-a", "ws-x");
    manager.addMember("proj-a", "ws-x", "a-1");
    const result = computeWorkstreamAggregateTriggers({
      workstreams: manager.list("proj-a"),
      sessions: [makeSessionInput("a-1", { prState: "merged" })],
      previousAggregates: new Map(),
    });
    const dispatch = result.dispatches.find((d) => d.trigger === "workstream.all_merged");
    expect(dispatch?.syntheticSessionId).toBe(workstreamSessionId("ws-x"));
    expect(dispatch?.snapshot.workstreamId).toBe("ws-x");
  });
});

// --------------------------------------------------------------------------
// Predicates
// --------------------------------------------------------------------------

function makeWorkstreamCtx(snapshot: WorkstreamPredicateCtx): PredicateCtx {
  const run: RunState = {
    runId: asRunId("run-1"),
    pipelineId: asPipelineId("pl-1"),
    pipelineName: "p",
    sessionId: "ws:x",
    pipelineConfigSnapshot: { id: asPipelineId("pl-1"), name: "p", stages: [] },
    headSha: "ws",
    loopState: "running",
    loopRounds: 1,
    stages: {},
    workstream: snapshot,
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
  };
  return { run, history: [], findings: [], workstream: snapshot };
}

describe("workstream predicates (#199)", () => {
  it("all_workstream_workers_in_state passes when every active member matches", () => {
    const predicate: Predicate = {
      kind: "all_workstream_workers_in_state",
      states: ["merged"],
    };
    const ctx = makeWorkstreamCtx({
      workstreamId: "w",
      members: [
        { sessionId: "a", prState: "merged", latestRunByPipeline: {} },
        { sessionId: "b", prState: "merged", latestRunByPipeline: {} },
      ],
    });
    expect(evaluatePredicate(predicate, ctx)).toBe(true);
  });

  it("all_workstream_workers_in_state returns false when any active member fails", () => {
    const predicate: Predicate = {
      kind: "all_workstream_workers_in_state",
      states: ["merged"],
    };
    const ctx = makeWorkstreamCtx({
      workstreamId: "w",
      members: [
        { sessionId: "a", prState: "merged", latestRunByPipeline: {} },
        { sessionId: "b", prState: "open", latestRunByPipeline: {} },
      ],
    });
    expect(evaluatePredicate(predicate, ctx)).toBe(false);
  });

  it("all_workstream_workers_match recurses over each member's latest run of the named pipeline", () => {
    const predicate: Predicate = {
      kind: "all_workstream_workers_match",
      pipeline: "pr-review",
      loopStates: ["done"],
    };
    const ctx = makeWorkstreamCtx({
      workstreamId: "w",
      members: [
        {
          sessionId: "a",
          prState: "merged",
          latestRunByPipeline: { "pr-review": "done" },
        },
        {
          sessionId: "b",
          prState: "merged",
          latestRunByPipeline: { "pr-review": "done" },
        },
      ],
    });
    expect(evaluatePredicate(predicate, ctx)).toBe(true);

    const ctxWithStalled = makeWorkstreamCtx({
      workstreamId: "w",
      members: [
        {
          sessionId: "a",
          prState: "merged",
          latestRunByPipeline: { "pr-review": "done" },
        },
        {
          sessionId: "b",
          prState: "merged",
          latestRunByPipeline: { "pr-review": "stalled" },
        },
      ],
    });
    expect(evaluatePredicate(predicate, ctxWithStalled)).toBe(false);
  });

  it("workstream_member_count respects min/max bounds", () => {
    const ctx = makeWorkstreamCtx({
      workstreamId: "w",
      members: [
        { sessionId: "a", prState: "merged", latestRunByPipeline: {} },
        { sessionId: "b", prState: "merged", latestRunByPipeline: {} },
        { sessionId: "c", prState: "merged", latestRunByPipeline: {} },
      ],
    });
    expect(evaluatePredicate({ kind: "workstream_member_count", min: 3 }, ctx)).toBe(true);
    expect(evaluatePredicate({ kind: "workstream_member_count", min: 4 }, ctx)).toBe(false);
    expect(
      evaluatePredicate({ kind: "workstream_member_count", min: 1, max: 2 }, ctx),
    ).toBe(false);
  });

  it("workstream predicates return false for non-workstream runs (no PredicateCtx.workstream)", () => {
    const baseRun: RunState = {
      runId: asRunId("run-1"),
      pipelineId: asPipelineId("pl-1"),
      pipelineName: "p",
      sessionId: "sess-1",
      pipelineConfigSnapshot: { id: asPipelineId("pl-1"), name: "p", stages: [] },
      headSha: "sha",
      loopState: "running",
      loopRounds: 1,
      stages: {},
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    };
    const ctx: PredicateCtx = { run: baseRun, history: [], findings: [] };
    expect(
      evaluatePredicate({ kind: "all_workstream_workers_in_state", states: ["merged"] }, ctx),
    ).toBe(false);
    expect(
      evaluatePredicate(
        { kind: "all_workstream_workers_match", pipeline: "p", loopStates: ["done"] },
        ctx,
      ),
    ).toBe(false);
    expect(evaluatePredicate({ kind: "workstream_member_count", min: 0 }, ctx)).toBe(
      false,
    );
  });
});

// --------------------------------------------------------------------------
// Router scope routing
// --------------------------------------------------------------------------

function makeRouterCtx(
  scope: "worker" | "workstream" | "orchestrator",
  options: Partial<BuiltinTaskContext> = {},
): BuiltinTaskContext {
  return {
    pipelineName: "integrated-review",
    runId: asRunId("run-1"),
    stageRunId: asStageRunId("sr-1"),
    stage: {
      name: "router-stage",
      trigger: { on: ["workstream.all_merged"] },
      executor: { kind: "builtin", name: "router" },
      task: {},
    },
    linkedSessionId: scope === "workstream" ? "ws:release" : "ses-1",
    scope,
    inputs: {
      upstream: [
        {
          artifactId: asRunId("art-1") as unknown as ReturnType<typeof asRunId>,
          pipelineRunId: asRunId("run-1"),
          stageRunId: asStageRunId("sr-up"),
          stageName: "upstream",
          kind: "finding",
          filePath: "x.ts",
          startLine: 1,
          endLine: 1,
          title: "T",
          description: "D",
          category: "general",
          severity: "info",
          confidence: 1,
          status: "open",
          createdAt: "2026-06-06T00:00:00.000Z",
        },
      ],
    },
    sendToSession: vi.fn().mockResolvedValue(undefined),
    ...options,
  } as BuiltinTaskContext;
}

describe("router scope routing (#199)", () => {
  it("workstream scope routes to routingTargetSessionId, bypasses worker-alive probe", async () => {
    const probe = vi.fn().mockResolvedValue(false); // intentionally false
    const ctx = makeRouterCtx("workstream", {
      routingTargetSessionId: "proj-a-orchestrator",
    });
    const outcome = await runRouter(ctx, { isSessionAlive: probe });

    expect(probe).not.toHaveBeenCalled();
    expect(ctx.sendToSession).toHaveBeenCalledWith(
      "proj-a-orchestrator",
      expect.any(String),
    );
    expect(outcome.verdict).toBe("neutral");
  });

  it("workstream scope with no orchestrator emits routing.orchestrator_absent and skips delivery", async () => {
    const ctx = makeRouterCtx("workstream"); // no routingTargetSessionId
    const probe = vi.fn().mockResolvedValue(true);
    const outcome = await runRouter(ctx, { isSessionAlive: probe });

    expect(ctx.sendToSession).not.toHaveBeenCalled();
    expect(outcome.observations.map((o) => o.name)).toContain("routing.orchestrator_absent");
  });

  it("worker scope still runs the worker-alive probe (unchanged v0/v1/v2 behavior)", async () => {
    const ctx = makeRouterCtx("worker");
    const probe = vi.fn().mockResolvedValue(true);
    await runRouter(ctx, { isSessionAlive: probe });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// AO_PIPELINE_V3 gate
// --------------------------------------------------------------------------

describe("AO_PIPELINE_V3 gate (#199)", () => {
  it("declared workstream scope downgrades to worker when AO_PIPELINE_V3 is unset", () => {
    delete process.env["AO_PIPELINE_V3"];
    const runtime = configuredPipelineToRuntime("ws-pipeline", {
      scope: "workstream",
      stages: [
        {
          name: "noop",
          trigger: { on: ["workstream.all_merged"] },
          executor: { kind: "builtin", name: "router" },
          task: {},
        },
      ],
    });
    // Default ("worker") is omitted from the runtime shape entirely.
    expect(runtime.scope).toBeUndefined();
  });

  it("declared workstream scope passes through when AO_PIPELINE_V3=1", () => {
    process.env["AO_PIPELINE_V3"] = "1";
    const runtime = configuredPipelineToRuntime("ws-pipeline", {
      scope: "workstream",
      stages: [
        {
          name: "noop",
          trigger: { on: ["workstream.all_merged"] },
          executor: { kind: "builtin", name: "router" },
          task: {},
        },
      ],
    });
    expect(runtime.scope).toBe("workstream");
  });
});

// Sanity reference: freshAggregateSnapshot is exported and starts un-latched.
describe("freshAggregateSnapshot", () => {
  it("returns an un-latched snapshot", () => {
    expect(freshAggregateSnapshot()).toEqual({
      allPrOpenedFired: false,
      allMergedFired: false,
      anyStalledFired: false,
    });
  });
});
