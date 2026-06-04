"use client";

export interface PipelineFilters {
  pipelineNames: string[];
  showDismissed: boolean;
}

interface PipelineFilterBarProps {
  filters: PipelineFilters;
  availablePipelines: string[];
  onChange(next: PipelineFilters): void;
}

/**
 * Filter bar — pipeline-name multi-select + "show dismissed" toggle.
 * No external UI libs (C-01), only Tailwind + CSS-variable colors (C-02/C-05).
 */
export function PipelineFilterBar(props: PipelineFilterBarProps) {
  const { filters, availablePipelines, onChange } = props;

  const togglePipeline = (name: string) => {
    const set = new Set(filters.pipelineNames);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    onChange({ ...filters, pipelineNames: [...set] });
  };

  const clear = () => onChange({ pipelineNames: [], showDismissed: false });
  const showingAll = filters.pipelineNames.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-card)] px-4 py-2">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
        Pipelines:
      </span>
      {availablePipelines.length === 0 && (
        <span className="text-[11px] text-[var(--color-text-muted)]">(none yet)</span>
      )}
      {availablePipelines.map((name) => {
        const active = filters.pipelineNames.includes(name);
        return (
          <button
            key={name}
            type="button"
            onClick={() => togglePipeline(name)}
            aria-pressed={active}
            className={
              active
                ? "rounded-full border border-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-primary)]"
                : "rounded-full border border-[var(--color-border-muted)] bg-[var(--color-bg-subtle)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-default)]"
            }
          >
            {name}
          </button>
        );
      })}
      {!showingAll && (
        <button
          type="button"
          onClick={clear}
          className="ml-1 text-[10px] text-[var(--color-text-muted)] underline-offset-2 hover:underline"
        >
          clear
        </button>
      )}

      <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)]">
        <input
          type="checkbox"
          checked={filters.showDismissed}
          onChange={(e) => onChange({ ...filters, showDismissed: e.target.checked })}
        />
        Show dismissed findings
      </span>
    </div>
  );
}
