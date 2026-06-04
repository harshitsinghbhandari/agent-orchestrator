"use client";

import type { LoopStateName } from "@aoagents/ao-core";

import { cn } from "@/lib/cn";

export interface RunHistoryEntry {
  runId: string;
  loopState: LoopStateName;
  loopRounds: number;
  createdAt: string;
  updatedAt: string;
}

interface RunHistoryTimelineProps {
  entries: RunHistoryEntry[];
}

/**
 * Compact horizontal timeline of past runs for a session+pipeline loop. Each
 * dot represents one run, colored by terminal `loopState`. Hovering reveals
 * runId + duration.
 */
export function RunHistoryTimeline({ entries }: RunHistoryTimelineProps) {
  if (entries.length === 0) {
    return (
      <p className="text-[11px] text-[var(--color-text-tertiary)]">No prior runs.</p>
    );
  }
  return (
    <ol
      className="flex flex-wrap items-center gap-1"
      aria-label="Pipeline run history"
    >
      {entries.map((entry) => (
        <li key={entry.runId} className="inline-flex items-center gap-1">
          <span
            className={cn("h-2 w-2 rounded-full", toneFor(entry.loopState))}
            title={`${entry.runId} · ${entry.loopState} · round ${entry.loopRounds}`}
            aria-label={`run ${entry.runId} ${entry.loopState}`}
          />
          <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">
            #{entry.loopRounds}
          </span>
        </li>
      ))}
    </ol>
  );
}

function toneFor(state: LoopStateName): string {
  switch (state) {
    case "running":
      return "bg-[var(--color-status-working)]";
    case "awaiting_context":
      return "bg-[var(--color-status-waiting)]";
    case "done":
      return "bg-[var(--color-status-ready)]";
    case "stalled":
      return "bg-[var(--color-status-error)]";
    case "terminated":
    default:
      return "bg-[var(--color-text-tertiary)]";
  }
}
