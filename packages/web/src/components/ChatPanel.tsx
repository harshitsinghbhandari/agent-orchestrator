"use client";

import { useEffect, useState } from "react";

import type { ThreadMessage } from "@aoagents/ao-core";

import { cn } from "@/lib/cn";

interface ChatPanelProps {
  runId: string;
  stageRunId: string;
  stageName: string;
  projectId: string;
  /** Whether the agent for this stage supports `sendFollowUpToTask`. */
  followUpAvailable: boolean;
  /** Whether the stage is currently in `awaiting_context` (where chat is enabled). */
  stageActive: boolean;
  /** Optional human-readable reviewer label (`{sessionPrefix}-rev-N`) to stamp into the thread. */
  reviewerId?: string;
}

/**
 * Conversational follow-up panel for an `awaiting_context` stage. Polls the
 * thread JSONL at the same 5s cadence the rest of the dashboard uses (C-14).
 * Messages POST through `/api/pipelines/runs/:runId/stages/:stageRunId/thread`,
 * which dispatches `USER_FOLLOWUP` into the reducer.
 *
 * Worktree-gone (HTTP 410 `ReviewerWorkspaceGone`) surfaces inline — no
 * project-root fallback.
 */
export function ChatPanel(props: ChatPanelProps) {
  const { runId, stageRunId, projectId, followUpAvailable, stageActive, reviewerId } = props;
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceGone, setWorkspaceGone] = useState(false);

  const refresh = async (): Promise<void> => {
    try {
      const url = `/api/pipelines/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageRunId)}/thread?project=${encodeURIComponent(projectId)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { messages?: ThreadMessage[] };
      if (Array.isArray(body.messages)) setMessages(body.messages);
    } catch {
      // Polling failures are non-fatal — next 5s tick retries.
    }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, [runId, stageRunId, projectId]);

  const send = async (): Promise<void> => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    setWorkspaceGone(false);
    try {
      const url = `/api/pipelines/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageRunId)}/thread?project=${encodeURIComponent(projectId)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, ...(reviewerId ? { reviewerId } : {}) }),
      });
      if (res.status === 410) {
        setWorkspaceGone(true);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setDraft("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  if (!followUpAvailable) {
    return (
      <div className="rounded border border-dashed border-[var(--color-border-muted)] p-3 text-center text-[11px] text-[var(--color-text-tertiary)]">
        Chat unavailable — this agent doesn&apos;t implement <code>sendFollowUpToTask</code>.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-card)] p-2">
      <ol className="flex max-h-64 flex-col gap-1.5 overflow-auto" aria-label="Follow-up thread">
        {messages.length === 0 && (
          <li className="text-[11px] text-[var(--color-text-tertiary)]">
            No messages yet.
          </li>
        )}
        {messages.map((m, i) => (
          <li
            key={`${m.ts}-${i}`}
            className={cn(
              "rounded p-2 text-[11px] leading-relaxed",
              m.role === "user"
                ? "bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]"
                : m.role === "agent"
                  ? "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"
                  : "bg-[var(--color-bg-subtle)] text-[var(--color-text-tertiary)]",
            )}
          >
            <p className="mb-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)]">
              {m.role}
              {m.reviewerId ? ` · ${m.reviewerId}` : ""} · {new Date(m.ts).toLocaleTimeString()}
            </p>
            <p className="whitespace-pre-wrap break-words">{m.content}</p>
          </li>
        ))}
      </ol>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        disabled={!stageActive || sending}
        placeholder={
          stageActive ? "Send a follow-up… (Enter to send, Shift+Enter newline)" : "Chat disabled — stage not awaiting context."
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        className="rounded border border-[var(--color-border-muted)] bg-[var(--color-bg-subtle)] p-2 font-mono text-[11px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          {workspaceGone && (
            <span className="text-[var(--color-status-error)]">
              Worker workspace gone (410) — cannot deliver. No fallback to project root.
            </span>
          )}
          {!workspaceGone && error && (
            <span className="text-[var(--color-status-error)]">{error}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => void send()}
          disabled={!stageActive || sending || !draft.trim()}
          className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-0.5 font-mono text-[10px] text-[var(--color-text-on-accent)] disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
