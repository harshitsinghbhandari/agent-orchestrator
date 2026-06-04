"use client";

import { useState } from "react";

import type { PipelineRunSummary } from "@/hooks/usePipelineEvents";
import { cn } from "@/lib/cn";

interface PipelineRunCardProps {
  run: PipelineRunSummary;
  onExpand?: () => void;
}

/**
 * Card view of a single pipeline run. Compact in the Kanban column; clicking
 * the header expands it inline to show per-stage status dots. Findings,
 * artifact actions, and the chat panel live in a separate detail view to keep
 * the column scannable.
 */
export function PipelineRunCard({ run, onExpand }: PipelineRunCardProps) {
  const [expanded, setExpanded] = useState(false);
  const stageNames = Object.keys(run.stageStatuses);

  return (
    <article
      className={cn(
        "rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-card)] p-2.5 shadow-sm",
        run.hasOpenFindings && "border-[var(--color-status-waiting)]",
      )}
      data-run-id={run.runId}
    >
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
          onExpand?.();
        }}
        className="flex w-full items-baseline gap-2 text-left"
        aria-expanded={expanded}
      >
        <span className="font-mono text-[11px] font-semibold text-[var(--color-text-primary)]">
          {run.pipelineName}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
          {run.sessionId}
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--color-text-tertiary)]">
          rounds {run.loopRounds}
        </span>
      </button>
      <p className="mt-1 font-mono text-[10px] text-[var(--color-text-tertiary)]">
        {run.headSha.length > 12 ? run.headSha.slice(0, 12) : run.headSha} · updated{" "}
        {new Date(run.updatedAt).toLocaleTimeString()}
      </p>
      <ul className="mt-1.5 flex flex-wrap items-center gap-1.5" aria-label="stage statuses">
        {stageNames.map((name) => (
          <StageDot key={name} stageName={name} status={run.stageStatuses[name] ?? "pending"} />
        ))}
      </ul>
      {run.hasOpenFindings && (
        <p className="mt-1.5 text-[10px] text-[var(--color-status-waiting)]">
          ● open findings
        </p>
      )}
      {expanded && (
        <p className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
          <a
            href={`/pipelines/${encodeURIComponent(run.runId)}?project=${encodeURIComponent(run.projectId)}`}
            className="underline-offset-2 hover:underline"
          >
            View run details →
          </a>
        </p>
      )}
    </article>
  );
}

interface StageDotProps {
  stageName: string;
  status: string;
}

function StageDot({ stageName, status }: StageDotProps) {
  const tone = stageStatusTone(status);
  return (
    <li
      className="inline-flex items-center gap-1 font-mono text-[10px]"
      title={`${stageName}: ${status}`}
      aria-label={`stage ${stageName} ${status}`}
    >
      <span className={cn("h-2 w-2 rounded-full", tone)} />
      <span className="text-[var(--color-text-secondary)]">{stageName}</span>
    </li>
  );
}

function stageStatusTone(status: string): string {
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
    case "pending":
    default:
      return "bg-[var(--color-text-muted)]";
  }
}
