/**
 * Workstream trigger bridge (pipeline-v3, issue #199).
 *
 * Sits between the lifecycle manager and the pipeline engine for
 * workstream-scoped pipelines. Each `pollAll` cycle:
 *
 *   1. Walk every persisted workstream and snapshot its members' PR /
 *      pipeline state from the live session list.
 *   2. Compare each aggregate against the previously-stored snapshot to
 *      detect edge transitions (e.g. "every non-forgiven member just
 *      reached `merged` for the first time").
 *   3. Emit one `WorkstreamDispatch` per fired trigger; the lifecycle
 *      manager forwards each to `pipelineEngine.startRun` with the
 *      workstream-scoped pipelines that subscribe to the trigger.
 *
 * This module is deliberately I/O-free: it takes sessions + workstreams
 * as inputs and returns dispatches as outputs, so it can be tested in
 * isolation without spinning up a real session manager.
 *
 * Edge-triggering: `all_*` events fire once per transition into the
 * "all-satisfied" set. The bridge keeps the prior aggregate in a
 * caller-supplied Map<workstreamId, AggregateSnapshot>; once an `all_*`
 * fires, the snapshot is updated so subsequent ticks don't re-fire.
 */

import type { WorkstreamState } from "../types.js";
import type {
  LoopStateName,
  StageTriggerEvent,
  WorkstreamMemberPRState,
  WorkstreamMemberSnapshot,
  WorkstreamPredicateCtx,
} from "./types.js";

/** Minimal session shape this bridge needs (decoupled from full Session). */
export interface WorkstreamSessionInput {
  sessionId: string;
  /** Lifecycle PR state ("none" | "open" | "merged" | "closed"). */
  prState: WorkstreamMemberPRState;
  /** Per-pipeline-name latest run loopState. Empty record if none. */
  latestRunByPipeline: Readonly<Record<string, LoopStateName | undefined>>;
  /** When set, exclude from `all_*` aggregates. */
  forgiven?: boolean;
  /** True when the session's runtime is dead / stuck / detecting too long. */
  stalled?: boolean;
}

/** Snapshot of which aggregate triggers have already fired for a workstream. */
export interface AggregateSnapshot {
  allPrOpenedFired: boolean;
  allMergedFired: boolean;
  anyStalledFired: boolean;
}

export function freshAggregateSnapshot(): AggregateSnapshot {
  return { allPrOpenedFired: false, allMergedFired: false, anyStalledFired: false };
}

/**
 * One trigger the bridge wants the caller to forward to the engine. The
 * lifecycle manager wraps this in a startRun call with the workstream
 * snapshot attached to PredicateCtx via RunState.workstream.
 */
export interface WorkstreamDispatch {
  workstreamId: string;
  trigger: StageTriggerEvent;
  /** Use as `engine.startRun({ sessionId })` so loopKey is workstream-keyed. */
  syntheticSessionId: string;
  snapshot: WorkstreamPredicateCtx;
}

export interface ComputeWorkstreamTriggersInput {
  workstreams: ReadonlyArray<WorkstreamState>;
  sessions: ReadonlyArray<WorkstreamSessionInput>;
  /** Per-workstream previously-fired aggregate triggers (mutated by the caller). */
  previousAggregates: Map<string, AggregateSnapshot>;
}

export interface ComputeWorkstreamTriggersOutput {
  dispatches: WorkstreamDispatch[];
}

/**
 * Synthetic session id used for workstream-scoped runs so the engine's
 * `loopKey` keeps workstream pipelines on their own loop and never
 * collides with per-worker keys.
 */
export function workstreamSessionId(workstreamId: string): string {
  return `ws:${workstreamId}`;
}

/**
 * Walk every workstream, build a snapshot, detect aggregate edge
 * transitions, and return the dispatches the lifecycle manager should
 * forward. Mutates `previousAggregates` so the next call sees the new
 * edge state — callers should keep one Map per process.
 */
export function computeWorkstreamAggregateTriggers(
  input: ComputeWorkstreamTriggersInput,
): ComputeWorkstreamTriggersOutput {
  const sessionById = new Map(input.sessions.map((s) => [s.sessionId, s]));
  const dispatches: WorkstreamDispatch[] = [];

  for (const ws of input.workstreams) {
    const memberInputs = ws.members
      .map((id) => sessionById.get(id))
      .filter((s): s is WorkstreamSessionInput => s !== undefined);

    const members: WorkstreamMemberSnapshot[] = memberInputs.map((s) => ({
      sessionId: s.sessionId,
      prState: s.prState,
      latestRunByPipeline: { ...s.latestRunByPipeline },
      ...(s.forgiven ? { forgiven: true } : {}),
    }));

    const snapshot: WorkstreamPredicateCtx = {
      workstreamId: ws.workstreamId,
      ...(ws.orchestratorSessionId ? { orchestratorSessionId: ws.orchestratorSessionId } : {}),
      members,
    };
    const syntheticSessionId = workstreamSessionId(ws.workstreamId);

    const prior =
      input.previousAggregates.get(ws.workstreamId) ?? freshAggregateSnapshot();

    // Filter to non-forgiven members for `all_*` aggregates.
    const active = memberInputs.filter((m) => !m.forgiven);

    if (active.length === 0) {
      // Empty / fully-forgiven workstream: leave prior snapshot in place,
      // never edge-fire. Manual triggers can still be dispatched by the
      // CLI separately.
      input.previousAggregates.set(ws.workstreamId, prior);
      continue;
    }

    const allPrOpenedNow = active.every(
      (m) => m.prState === "open" || m.prState === "merged",
    );
    const allMergedNow = active.every((m) => m.prState === "merged");
    const anyStalledNow = active.some((m) => m.stalled === true);

    // Edge transitions only — once-per-transition semantics. When the
    // condition falls back to false, we reset the latch so a later
    // re-entry will fire again (e.g. a member's PR is re-opened after
    // close).
    const next: AggregateSnapshot = {
      allPrOpenedFired: allPrOpenedNow,
      allMergedFired: allMergedNow,
      anyStalledFired: anyStalledNow,
    };

    if (allPrOpenedNow && !prior.allPrOpenedFired) {
      dispatches.push({
        workstreamId: ws.workstreamId,
        trigger: "workstream.all_pr_opened",
        syntheticSessionId,
        snapshot,
      });
    }
    if (allMergedNow && !prior.allMergedFired) {
      dispatches.push({
        workstreamId: ws.workstreamId,
        trigger: "workstream.all_merged",
        syntheticSessionId,
        snapshot,
      });
    }
    if (anyStalledNow && !prior.anyStalledFired) {
      dispatches.push({
        workstreamId: ws.workstreamId,
        trigger: "workstream.any_stalled",
        syntheticSessionId,
        snapshot,
      });
    }

    input.previousAggregates.set(ws.workstreamId, next);
  }

  return { dispatches };
}

/**
 * Per-member fan-in: when a single worker session's PR state transitions
 * (none→open, open→merged, sha-changed-open→open), emit the matching
 * `workstream.worker_pr_*` dispatch so workstream-scoped pipelines that
 * subscribe see each member's transition exactly once.
 */
export function workstreamWorkerTriggerFor(
  prTransition: "opened" | "updated" | "merged",
): StageTriggerEvent {
  switch (prTransition) {
    case "opened":
      return "workstream.worker_pr_opened";
    case "updated":
      return "workstream.worker_pr_updated";
    case "merged":
      return "workstream.worker_pr_merged";
  }
}
