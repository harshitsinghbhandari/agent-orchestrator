import { CalendarDays, Circle, CircleCheck, CircleDot, CircleSlash, CircleX, MoreHorizontal, Timer } from "lucide-react";
import { cn } from "../lib/utils";
import { formatTimeCompact } from "../lib/format-time";
import { formatStageDuration, runStatusLabel, runStatusOf, runStatusTone } from "../lib/pipeline-display";
import type { RunStatus } from "../lib/pipeline-draft";
import type { PipelineRunSummary } from "../hooks/usePipelineRuns";
import type { WorkspaceSession } from "../types/workspace";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";

// What fired a run. The DTO's `subjectKind` is the closest thing we have to
// GitHub's workflow `event`, so the list filters and labels on it.
export type RunEvent = PipelineRunSummary["subjectKind"];

// A run flattened into everything the list row shows, so the workbench resolves
// the session join once for the whole list and the row, the filter bar, and the
// counts all read the same derived values.
export type PipelineRunRowModel = {
	run: PipelineRunSummary;
	status: RunStatus;
	event: RunEvent;
	// The headline: the subject when we know it, otherwise the pipeline name.
	title: string;
	// GitHub's trigger sub-line: "<pipeline> #<number>: <what fired it>".
	trigger: string;
	// The head branch of the subject, when a local session tracks one.
	branch?: string;
};

// Run ids are `run-<uuid>`; the display number is the first block of that uuid.
// The API has no per-pipeline run counter, and numbering client-side would
// renumber every run whenever a filter changed, so the row shows a short form of
// the id it already has: stable, unique, and the same on every screen.
export function shortRunNumber(runId: string): string {
	const body = runId.startsWith("run-") ? runId.slice(4) : runId;
	return body.split("-")[0].slice(0, 7) || runId;
}

// The sub-line, in GitHub's idiom: what fired the run and on behalf of what. The
// run DTO carries no actor, so nothing claims one; a PR subject names its number
// and, when a local session tracks it, that session.
export function describeRunTrigger(run: PipelineRunSummary, session?: WorkspaceSession): string {
	const prefix = `${run.pipelineName} #${shortRunNumber(run.runId)}: `;
	if (run.subjectKind === "pr" && run.prNumber) {
		return `${prefix}Pull request #${run.prNumber}${session ? ` in session ${session.title}` : ""}`;
	}
	if (run.sessionId) {
		return `${prefix}Session ${session?.title ?? run.sessionId}`;
	}
	return `${prefix}Manual run on this project`;
}

// A settled run shows how long it took; a live one says what it is doing, the
// way GitHub shows "In progress" instead of a clock that never ticks.
export function runDurationLabel(row: PipelineRunRowModel): string {
	if (row.status === "pending" || row.status === "running") return runStatusLabel(row.status);
	const duration = formatStageDuration(row.run.createdAt, row.run.settledAt);
	return duration || runStatusLabel(row.status);
}

export function toRunRowModel(run: PipelineRunSummary, session?: WorkspaceSession): PipelineRunRowModel {
	return {
		run,
		status: runStatusOf(run),
		event: run.subjectKind,
		title: session?.title || run.pipelineName,
		trigger: describeRunTrigger(run, session),
		branch: session?.branch,
	};
}

const STATUS_ICON = {
	pending: Circle,
	running: CircleDot,
	succeeded: CircleCheck,
	failed: CircleX,
	cancelled: CircleSlash,
} as const;

// One run in the list: status icon, subject, trigger sub-line, branch chip, and
// a stacked timestamp/duration pair on the right, plus the row overflow menu.
export function PipelineRunRow({
	row,
	onOpen,
	onCancel,
	cancelPending,
}: {
	row: PipelineRunRowModel;
	onOpen: () => void;
	onCancel: () => void;
	cancelPending: boolean;
}) {
	const { run, status } = row;
	const StatusIcon = STATUS_ICON[status];
	// Only a live run can be cancelled, and only when we know which project to
	// send the cancel to (the endpoint is project-scoped).
	const canCancel = (status === "pending" || status === "running") && Boolean(run.projectId);

	return (
		<li
			data-run-id={run.runId}
			data-run-status={status}
			className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-raised"
		>
			<StatusIcon
				aria-label={runStatusLabel(status)}
				className={cn("size-4 shrink-0", runStatusTone(status), status === "running" && "animate-pulse")}
			/>

			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<button
					type="button"
					onClick={onOpen}
					className="truncate text-left text-control font-semibold text-foreground transition-colors hover:text-accent"
				>
					{row.title}
				</button>
				<span className="truncate text-caption text-passive">{row.trigger}</span>
			</div>

			{row.branch && (
				<span
					title={row.branch}
					className="hidden max-w-48 shrink-0 truncate rounded-md bg-accent-weak px-1.5 py-0.5 font-mono text-micro text-accent lg:inline-block"
				>
					{row.branch}
				</span>
			)}

			<div className="flex w-28 shrink-0 flex-col items-end gap-0.5 text-micro text-passive">
				<span className="flex items-center gap-1">
					<CalendarDays className="size-3 shrink-0" aria-hidden="true" />
					{formatTimeCompact(run.createdAt)}
				</span>
				<span className="flex items-center gap-1">
					<Timer className="size-3 shrink-0" aria-hidden="true" />
					{runDurationLabel(row)}
				</span>
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger
					aria-label={`Actions for ${row.title}`}
					className="shrink-0 rounded-md p-1 text-passive transition-colors hover:bg-surface hover:text-foreground"
				>
					<MoreHorizontal className="size-4" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={onOpen}>View run detail</DropdownMenuItem>
					{canCancel && (
						<DropdownMenuItem disabled={cancelPending} onSelect={onCancel}>
							{cancelPending ? "Cancelling…" : "Cancel run"}
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</li>
	);
}
