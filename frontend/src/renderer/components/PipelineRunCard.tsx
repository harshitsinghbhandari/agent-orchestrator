import { cn } from "../lib/utils";
import { formatTimeCompact } from "../lib/format-time";
import {
	runStatusOf,
	runStatusTone,
	shortSha,
	stageOutcomeDotTone,
	stageOutcomeLabel,
	stageOutcomesOf,
} from "../lib/pipeline-display";
import type { PipelineRunSummary } from "../hooks/usePipelineRuns";

// Card view of a single pipeline run in a Kanban column: pipeline name, run
// status, session, per-stage outcome dots, an unverified-success hint, and a
// relative timestamp. The whole card opens the read-only run detail.
export function PipelineRunCard({ run, onOpen }: { run: PipelineRunSummary; onOpen: () => void }) {
	const status = runStatusOf(run);
	const outcomes = stageOutcomesOf(run);
	const stageNames = Object.keys(outcomes).sort();
	const unverified = Object.values(outcomes).filter((outcome) => outcome === "succeeded_unverified").length;

	return (
		<button
			type="button"
			onClick={onOpen}
			data-run-id={run.runId}
			data-run-status={status}
			className="flex w-full flex-col gap-1.5 rounded-md border border-border bg-card p-2.5 text-left shadow-sm transition-colors hover:border-border-strong"
		>
			<div className="flex items-baseline gap-2">
				<span className="truncate font-mono text-caption font-semibold text-foreground">{run.pipelineName}</span>
				<span className={cn("ml-auto text-micro font-medium", runStatusTone(status))}>{status}</span>
			</div>
			<div className="flex items-center gap-2 font-mono text-micro text-passive">
				<span className="truncate">{run.sessionId || run.runId}</span>
				{run.headSha && <span className="shrink-0">· {shortSha(run.headSha)}</span>}
			</div>
			{stageNames.length > 0 && (
				<ul className="flex flex-wrap items-center gap-1.5" aria-label="stage outcomes">
					{stageNames.map((name) => (
						<li
							key={name}
							className="inline-flex items-center gap-1 font-mono text-micro text-muted-foreground"
							title={`${name}: ${stageOutcomeLabel(outcomes[name])}`}
						>
							<span className={cn("h-1.5 w-1.5 rounded-full", stageOutcomeDotTone(outcomes[name]))} />
							<span className="truncate">{name}</span>
						</li>
					))}
				</ul>
			)}
			<div className="flex items-center gap-2 text-micro text-passive">
				<span>
					{run.stageCount} stage{run.stageCount === 1 ? "" : "s"}
				</span>
				{unverified > 0 && <span className="text-muted-foreground">· {unverified} unverified</span>}
				<span className="ml-auto">{formatTimeCompact(run.updatedAt)}</span>
			</div>
		</button>
	);
}
