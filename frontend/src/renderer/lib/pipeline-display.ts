// Shared presentation vocabulary for the pipelines Runs UI: the fixed five-column
// Kanban keyed on the v2 `RunStatus` (decision D11), plus the tone maps for run
// statuses and the eight settled stage outcomes (spec §7).
//
// The palette's job is to keep the eight outcomes distinguishable at a glance
// rather than collapsing them into pass/fail. Two pairs share a tone because
// they mean the same thing to the eye (failed/timed_out, no_output/no_signal;
// cancelled/skipped are both "nothing happened here"), and
// `succeeded_unverified` stays in the success family but renders hollow, since
// spec §7 makes unverified success deliberately visible. Colors are AO design
// tokens only (DESIGN.md, refined-blue accent); nothing new is invented here.

import type { RunStatus, StageOutcome } from "./pipeline-draft";

export type KanbanColumn = {
	status: RunStatus;
	title: string;
	description: string;
	// Tailwind class for the column's 2px left accent border.
	borderClass: string;
};

// Column order and copy are fixed; the board renders exactly these five in this
// order regardless of which statuses currently have runs.
export const KANBAN_COLUMNS: readonly KanbanColumn[] = [
	{ status: "pending", title: "Queued", description: "Waiting to start", borderClass: "border-l-border" },
	{ status: "running", title: "Running", description: "Stages executing", borderClass: "border-l-accent" },
	{
		status: "succeeded",
		title: "Succeeded",
		description: "Every stage settled successfully",
		borderClass: "border-l-success",
	},
	{
		status: "failed",
		title: "Failed",
		description: "A stage failed, timed out, or produced nothing",
		borderClass: "border-l-error",
	},
	{ status: "cancelled", title: "Cancelled", description: "Superseded or killed", borderClass: "border-l-passive" },
] as const;

// A run's status → the text tone used for it on a card or in the run detail.
export function runStatusTone(status: RunStatus): string {
	switch (status) {
		case "running":
			return "text-accent";
		case "succeeded":
			return "text-success";
		case "failed":
			return "text-error";
		case "cancelled":
			return "text-passive";
		case "pending":
		default:
			return "text-muted-foreground";
	}
}

// A stage outcome → the classes for its small status dot. `succeeded_unverified`
// is the one hollow dot: same success hue, no fill, so "it said done but nothing
// was verified" reads differently from a real success without shouting.
export function stageOutcomeDotTone(outcome: StageOutcome): string {
	switch (outcome) {
		case "succeeded":
			return "bg-success";
		case "succeeded_unverified":
			return "border border-success bg-transparent";
		case "failed":
		case "timed_out":
			return "bg-error";
		case "no_output":
		case "no_signal":
			return "bg-warning";
		case "cancelled":
		case "skipped":
			return "bg-passive";
		case "running":
			return "bg-accent animate-pulse";
		case "pending":
		default:
			return "bg-muted-foreground";
	}
}

// Human copy for an outcome, matching the spec's own wording.
export function stageOutcomeLabel(outcome: StageOutcome): string {
	return outcome === "succeeded_unverified" ? "succeeded (unverified)" : outcome.replace(/_/g, " ");
}

// The run fields this module reads, straight off the v2 run DTO.
export type RunDisplayFields = {
	status?: string;
	stageOutcomes?: { [key: string]: string } | null;
};

const RUN_STATUSES: readonly string[] = KANBAN_COLUMNS.map((col) => col.status);

// An unknown status reads as "pending" so an unrecognised run still lands in a
// column instead of vanishing off the board.
export function runStatusOf(run: RunDisplayFields): RunStatus {
	if (run.status && RUN_STATUSES.includes(run.status)) return run.status as RunStatus;
	return "pending";
}

// An outcome the UI does not know falls through to the neutral branch of
// stageOutcomeDotTone, which is why this cast is safe.
export function stageOutcomesOf(run: RunDisplayFields): Record<string, StageOutcome> {
	return (run.stageOutcomes ?? {}) as Record<string, StageOutcome>;
}

// A short commit reference for a run header.
export function shortSha(sha: string): string {
	return sha.length > 12 ? sha.slice(0, 12) : sha;
}

// How long a stage took, for run detail. An unsettled stage is measured against
// now, so a running stage's row keeps counting; a stage that never started has
// no duration at all rather than a misleading zero.
export function formatStageDuration(startedAt?: string | null, settledAt?: string | null): string {
	if (!startedAt) return "";
	const start = new Date(startedAt).getTime();
	const end = settledAt ? new Date(settledAt).getTime() : Date.now();
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
	const seconds = Math.round((end - start) / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
