"use client";

import { useMemo, useState } from "react";

import type { LoopStateName } from "@aoagents/ao-core";

import { usePipelineEvents, type PipelineRunSummary } from "@/hooks/usePipelineEvents";
import { PipelineFilterBar, type PipelineFilters } from "@/components/PipelineFilterBar";
import { PipelineRunCard } from "@/components/PipelineRunCard";
import { cn } from "@/lib/cn";

interface PipelineWorkbenchProps {
  initialRuns: PipelineRunSummary[];
  projectFilter: string | null;
}

interface KanbanColumn {
  state: LoopStateName;
  title: string;
  description: string;
  toneClass: string;
}

const COLUMNS: readonly KanbanColumn[] = [
  {
    state: "running",
    title: "Running",
    description: "Stage executing",
    toneClass: "border-l-[var(--color-status-working)]",
  },
  {
    state: "awaiting_context",
    title: "Awaiting context",
    description: "Stage paused for input",
    toneClass: "border-l-[var(--color-status-waiting)]",
  },
  {
    state: "done",
    title: "Done",
    description: "All stages succeeded",
    toneClass: "border-l-[var(--color-status-ready)]",
  },
  {
    state: "stalled",
    title: "Stalled",
    description: "Failed stages — resume to retry",
    toneClass: "border-l-[var(--color-status-error)]",
  },
  {
    state: "terminated",
    title: "Terminated",
    description: "Cancelled or superseded",
    toneClass: "border-l-[var(--color-text-tertiary)]",
  },
] as const;

/**
 * Workbench — 5-column Kanban grouped by `loopState`. Live updates via the
 * pipeline SSE feed (5s cadence, C-14). The initial run list is server-rendered
 * so first paint shows real data, and the SSE snapshot replaces it once the
 * EventSource connects.
 */
export function PipelineWorkbench(props: PipelineWorkbenchProps): JSX.Element {
  const { initialRuns, projectFilter } = props;
  const live = usePipelineEvents({ project: projectFilter ?? undefined });
  const runs = live.lastSnapshotAt !== null ? live.runs : initialRuns;

  const [filters, setFilters] = useState<PipelineFilters>({
    pipelineNames: [],
    showDismissed: false,
  });

  const filteredRuns = useMemo(() => {
    if (filters.pipelineNames.length === 0) return runs;
    const allowed = new Set(filters.pipelineNames);
    return runs.filter((r) => allowed.has(r.pipelineName));
  }, [runs, filters.pipelineNames]);

  const columns = useMemo(() => {
    const grouped = new Map<LoopStateName, PipelineRunSummary[]>();
    for (const col of COLUMNS) grouped.set(col.state, []);
    for (const run of filteredRuns) {
      grouped.get(run.loopState)?.push(run);
    }
    return COLUMNS.map((col) => ({ ...col, runs: grouped.get(col.state) ?? [] }));
  }, [filteredRuns]);

  const pipelineNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) set.add(r.pipelineName);
    return [...set].sort();
  }, [runs]);

  return (
    <div className="flex h-full min-h-screen flex-col bg-[var(--color-bg-page)] text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--color-border-default)] bg-[var(--color-bg-card)] px-6 py-4">
        <h1 className="text-base font-semibold tracking-tight">Pipeline Workbench</h1>
        <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
          {projectFilter ? `Project ${projectFilter}` : "All projects"} ·{" "}
          {runs.length} run{runs.length === 1 ? "" : "s"} ·{" "}
          {live.lastSnapshotAt ? "live" : "loading…"}
          {live.loadError ? ` · ${live.loadError}` : ""}
        </p>
      </header>

      <PipelineFilterBar
        filters={filters}
        availablePipelines={pipelineNames}
        onChange={setFilters}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto px-3 py-3 md:grid-cols-5">
        {columns.map((col) => (
          <section
            key={col.state}
            className={cn(
              "flex min-h-[200px] flex-col rounded-md border-l-2 bg-[var(--color-bg-subtle)] p-2",
              col.toneClass,
            )}
            aria-label={`${col.title} column`}
            data-loop-state={col.state}
          >
            <header className="px-1 pb-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                {col.title}{" "}
                <span className="ml-1 rounded-full bg-[var(--color-bg-card)] px-1.5 py-px font-mono text-[10px] text-[var(--color-text-muted)]">
                  {col.runs.length}
                </span>
              </h2>
              <p className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                {col.description}
              </p>
            </header>
            <div className="flex flex-1 flex-col gap-2">
              {col.runs.map((run) => (
                <PipelineRunCard key={run.runId} run={run} />
              ))}
              {col.runs.length === 0 && (
                <div className="rounded border border-dashed border-[var(--color-border-muted)] p-3 text-center text-[10px] text-[var(--color-text-tertiary)]">
                  Empty
                </div>
              )}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
