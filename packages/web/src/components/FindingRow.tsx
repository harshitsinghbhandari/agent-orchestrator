"use client";

import { useState } from "react";

import type { ArtifactStatus, Severity } from "@aoagents/ao-core";

import { cn } from "@/lib/cn";

export interface FindingArtifactView {
  artifactId: string;
  stageRunId: string;
  status: ArtifactStatus;
  filePath: string;
  startLine: number;
  endLine: number;
  title: string;
  description: string;
  severity: Severity;
  category: string;
  confidence: number;
}

interface FindingRowProps {
  runId: string;
  projectId: string;
  finding: FindingArtifactView;
  onStatusChanged?(next: ArtifactStatus): void;
}

/**
 * Per-finding row inside a stage card. Three actions: dismiss / reopen / send.
 * Each action POSTs the corresponding artifact-status mutation; the
 * surrounding card refreshes via the SSE feed.
 */
export function FindingRow(props: FindingRowProps): JSX.Element {
  const { runId, projectId, finding, onStatusChanged } = props;
  const [busy, setBusy] = useState<"dismiss" | "reopen" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dispatchStatus = async (status: ArtifactStatus) => {
    if (busy) return;
    const action = status === "dismissed" ? "dismiss" : status === "open" ? "reopen" : "send";
    setBusy(action);
    setError(null);
    try {
      const url = `/api/pipelines/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(finding.artifactId)}?project=${encodeURIComponent(projectId)}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, stageRunId: finding.stageRunId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      onStatusChanged?.(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const isDismissed = finding.status === "dismissed";
  const isSent = finding.status === "sent_to_agent";

  return (
    <div
      className={cn(
        "rounded border border-[var(--color-border-muted)] bg-[var(--color-bg-card)] p-2",
        isDismissed && "opacity-60",
      )}
      data-artifact-id={finding.artifactId}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "rounded-full px-1.5 py-px font-mono text-[10px] uppercase tracking-wide",
            severityClass(finding.severity),
          )}
        >
          {finding.severity}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">
          {finding.filePath}:{finding.startLine}
          {finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""}
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--color-text-tertiary)]">
          {Math.round(finding.confidence * 100)}%
        </span>
      </div>
      <p className="mt-1 text-[12px] font-semibold text-[var(--color-text-primary)]">
        {finding.title}
      </p>
      <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
        {finding.description}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!isDismissed && (
          <button
            type="button"
            onClick={() => void dispatchStatus("dismissed")}
            disabled={busy !== null}
            className="rounded border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-secondary)] hover:border-[var(--color-text-tertiary)] disabled:opacity-50"
          >
            {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
          </button>
        )}
        {isDismissed && (
          <button
            type="button"
            onClick={() => void dispatchStatus("open")}
            disabled={busy !== null}
            className="rounded border border-[var(--color-border-default)] bg-[var(--color-bg-subtle)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-secondary)] hover:border-[var(--color-text-tertiary)] disabled:opacity-50"
          >
            {busy === "reopen" ? "Reopening…" : "Reopen"}
          </button>
        )}
        {!isDismissed && !isSent && (
          <button
            type="button"
            onClick={() => void dispatchStatus("sent_to_agent")}
            disabled={busy !== null}
            className="rounded border border-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-primary)] hover:bg-[var(--color-accent)] disabled:opacity-50"
          >
            {busy === "send" ? "Sending…" : "Send to worker"}
          </button>
        )}
        {isSent && (
          <span className="font-mono text-[10px] text-[var(--color-status-ready)]">
            ✓ sent
          </span>
        )}
        {error && (
          <span className="font-mono text-[10px] text-[var(--color-status-error)]">{error}</span>
        )}
      </div>
    </div>
  );
}

function severityClass(s: Severity): string {
  switch (s) {
    case "error":
      return "bg-[var(--color-status-error)] text-[var(--color-text-on-accent)]";
    case "warning":
      return "bg-[var(--color-status-waiting)] text-[var(--color-text-on-accent)]";
    case "info":
    default:
      return "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]";
  }
}
