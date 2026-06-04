"use client";

import { useEffect, useReducer, useRef } from "react";

import type { LoopStateName } from "@aoagents/ao-core";

/**
 * Minimal pipeline-run summary view that mirrors what
 * `/api/pipelines/runs` returns. Keeping the type local (rather than
 * importing from `@/lib/pipelines`) avoids a Next.js client/server boundary
 * import — `server-only` modules cannot be pulled into client code.
 */
export interface PipelineRunSummary {
  runId: string;
  pipelineId: string;
  pipelineName: string;
  sessionId: string;
  projectId: string;
  loopState: LoopStateName;
  loopRounds: number;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  stageCount: number;
  stageStatuses: Record<string, string>;
  hasOpenFindings: boolean;
}

interface PipelineEventsState {
  runs: PipelineRunSummary[];
  loadError: string | null;
  lastSnapshotAt: number | null;
}

type Action =
  | { type: "snapshot"; runs: PipelineRunSummary[]; ts: number }
  | { type: "error"; message: string };

function reducer(state: PipelineEventsState, action: Action): PipelineEventsState {
  switch (action.type) {
    case "snapshot":
      return {
        runs: action.runs,
        loadError: null,
        lastSnapshotAt: action.ts,
      };
    case "error":
      return { ...state, loadError: action.message };
  }
}

export interface UsePipelineEventsOptions {
  /** Optional project filter — passes through to `/api/pipelines/events?project=`. */
  project?: string;
  /** When false, disables the SSE connection entirely (e.g. SSR or hidden tab). */
  enabled?: boolean;
}

/**
 * Subscribe to `/api/pipelines/events`. The server emits a snapshot every 5s
 * (C-14); this hook surfaces the latest snapshot plus any transient error.
 *
 * Reconnects automatically on transient errors — the SSE EventSource API
 * already retries on connection loss. We layer a thin error reporter on top so
 * the UI can show "stale" / "disconnected" affordances.
 */
export function usePipelineEvents(options: UsePipelineEventsOptions = {}): PipelineEventsState {
  const { project, enabled = true } = options;
  const [state, dispatch] = useReducer(reducer, {
    runs: [],
    loadError: null,
    lastSnapshotAt: null,
  });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const url = project
      ? `/api/pipelines/events?project=${encodeURIComponent(project)}`
      : "/api/pipelines/events";

    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data) as
          | { kind: "snapshot"; ts: number; runs: PipelineRunSummary[] }
          | { kind: "hello"; ts: number }
          | { kind: "error"; ts: number; error: string };
        if (frame.kind === "snapshot") {
          dispatch({ type: "snapshot", runs: frame.runs, ts: frame.ts });
        } else if (frame.kind === "error") {
          dispatch({ type: "error", message: frame.error });
        }
      } catch (err) {
        // A torn frame should not kill the stream; surface and keep listening.
        dispatch({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to parse pipeline SSE frame",
        });
      }
    };

    es.onerror = () => {
      dispatch({ type: "error", message: "pipeline events disconnected" });
      // EventSource auto-retries; no manual reconnect needed.
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [project, enabled]);

  return state;
}
