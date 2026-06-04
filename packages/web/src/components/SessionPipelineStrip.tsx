"use client";

import { useEffect, useState } from "react";

import type { PipelineRunSummary } from "@/hooks/usePipelineEvents";
import { cn } from "@/lib/cn";

interface SessionPipelineStripProps {
  sessionId: string;
  projectId: string;
}

/**
 * Per-stage status dots strip for a session's linked pipeline runs. Renders
 * compactly under the session id on every `SessionCard` — one row per active
 * pipeline run, one dot per stage. Empty when the session has no pipeline
 * runs (the strip stays out of layout entirely).
 *
 * Polls `/api/pipelines/runs` at the 5s dashboard cadence (C-14). Skips
 * setState after unmount via the `cancelled` flag.
 */
export function SessionPipelineStrip(props: SessionPipelineStripProps) {
  const { sessionId, projectId } = props;
  const [runs, setRuns] = useState<PipelineRunSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const url = `/api/pipelines/runs?project=${encodeURIComponent(projectId)}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { runs?: PipelineRunSummary[] };
        if (cancelled) return;
        setRuns(
          (body.runs ?? []).filter((r) => r.sessionId === sessionId),
        );
      } catch {
        // transient failure — next tick retries
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, projectId]);

  if (runs.length === 0) return null;

  return (
    <div className="px-[10px] pb-[5px]" data-testid="session-pipeline-strip">
      {runs.map((run) => (
        <div
          key={run.runId}
          className="mt-1 flex flex-wrap items-center gap-1.5"
          aria-label={`pipeline ${run.pipelineName}`}
        >
          <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">
            {run.pipelineName}
          </span>
          {Object.entries(run.stageStatuses).map(([name, status]) => (
            <span
              key={name}
              className={cn("inline-block h-1.5 w-1.5 rounded-full", toneFor(status))}
              title={`${name}: ${status}`}
              aria-label={`stage ${name} ${status}`}
            />
          ))}
          <a
            href={`/pipelines?project=${encodeURIComponent(projectId)}`}
            className="ml-auto font-mono text-[10px] text-[var(--color-text-muted)] underline-offset-2 hover:underline"
          >
            view
          </a>
        </div>
      ))}
    </div>
  );
}

function toneFor(status: string): string {
  switch (status) {
    case "succeeded":
      return "bg-[var(--color-status-ready)]";
    case "running":
      return "bg-[var(--color-status-working)]";
    case "failed":
      return "bg-[var(--color-status-error)]";
    case "skipped":
      return "bg-[var(--color-text-tertiary)]";
    case "outdated":
      return "bg-[var(--color-text-muted)]";
    default:
      return "bg-[var(--color-text-muted)]";
  }
}
