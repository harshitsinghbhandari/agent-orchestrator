import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "../lib/utils";
import { formatTimeCompact } from "../lib/format-time";
import { apiClient, apiErrorMessage } from "../lib/api-client";
import { runStatusTone, shortSha, stageOutcomeDotTone, stageOutcomeLabel } from "../lib/pipeline-display";
import { pipelineRunQueryKey, usePipelineRun } from "../hooks/usePipelineRuns";
import type { RunStatus, StageOutcome } from "../lib/pipeline-draft";
import type { components } from "../../api/schema";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

type PipelineStageView = components["schemas"]["PipelineStageView"];

// Read-only detail for one pipeline run: per-stage outcomes plus the one
// lifecycle action v2 keeps. There is no resume (spec section 14.1) and no
// findings panel: the findings subsystem is deleted, and a stage's contract is
// its one declared artifact.
//
// Task 24 rewrites this into the full v2 surface: outcome badges, the nudge tag,
// the collapsible log viewer over the stage log endpoint, artifact download
// links over the outputs endpoint, and the orphaned-session affordance. This is
// the mechanical port that keeps the build green on the v2 DTO.
export function PipelineRunDetail({ runId, project }: { runId: string; project?: string }) {
	const queryClient = useQueryClient();
	const { data: run, isLoading, isError, error } = usePipelineRun(runId);
	const [actionError, setActionError] = useState<string | null>(null);

	const cancel = useMutation({
		mutationFn: async () => {
			if (!project) throw new Error("Project is unknown for this run");
			const { error: apiError } = await apiClient.POST("/api/v1/pipelines/runs/{runId}/cancel", {
				params: { path: { runId }, query: { project } },
			});
			if (apiError) throw new Error(apiErrorMessage(apiError));
		},
		onSuccess: () => {
			setActionError(null);
			void queryClient.invalidateQueries({ queryKey: pipelineRunQueryKey(runId) });
			void queryClient.invalidateQueries({ queryKey: ["pipeline-runs"] });
		},
		onError: (e: unknown) => setActionError(e instanceof Error ? e.message : "Action failed"),
	});

	if (isLoading) {
		return <p className="p-6 text-caption text-passive">Loading run…</p>;
	}
	if (isError || !run) {
		return (
			<p className="p-6 text-caption text-error">
				Could not load run{error instanceof Error ? `: ${error.message}` : ""}.
			</p>
		);
	}

	// Stages arrive in plan order from the API; only a live run can be cancelled.
	const stages = run.stages;
	const canCancel = run.status === "pending" || run.status === "running";

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
			<header className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-5">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<h1 className="truncate text-subtitle font-bold tracking-tight text-foreground">{run.pipelineName}</h1>
						<span className={cn("text-caption font-semibold", runStatusTone(run.status as RunStatus))}>
							{run.status}
						</span>
						{run.cancelReason && <span className="text-caption text-passive">· {run.cancelReason}</span>}
					</div>
					<p className="mt-0.5 truncate font-mono text-micro text-passive">
						{run.runId} · session {run.sessionId ? <SessionLink sessionId={run.sessionId} /> : "—"}
						{run.prNumber ? ` · PR #${run.prNumber}` : ""}
						{run.headSha ? ` · ${shortSha(run.headSha)}` : ""} · updated {formatTimeCompact(run.updatedAt)}
					</p>
				</div>
				<div className="ml-auto flex items-center gap-2">
					{actionError && <span className="text-caption text-error">{actionError}</span>}
					{canCancel && (
						<Button
							size="sm"
							variant="outline"
							disabled={cancel.isPending || !project}
							title={project ? undefined : "Open this run from the board to cancel it"}
							onClick={() => cancel.mutate()}
						>
							{cancel.isPending ? "Cancelling…" : "Cancel"}
						</Button>
					)}
				</div>
			</header>

			<section aria-label="Stages" className="px-6 py-4">
				<h2 className="mb-2 text-micro font-semibold uppercase tracking-wide text-passive">Stages</h2>
				<div className="flex flex-col gap-2">
					{stages.map((stage) => (
						<StageRow key={stage.stageId} stage={stage} />
					))}
					{stages.length === 0 && <p className="text-caption text-passive">No stages yet.</p>}
				</div>
			</section>
		</div>
	);
}

// One stage row: outcome, attempt, and a collapsible block for the captured
// output tail when the stage produced one.
function StageRow({ stage }: { stage: PipelineStageView }) {
	const [showOutput, setShowOutput] = useState(false);
	const outcome = stage.outcome as StageOutcome;
	return (
		<div
			data-stage={stage.stageId}
			className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
		>
			<span className={cn("h-2 w-2 shrink-0 rounded-full", stageOutcomeDotTone(outcome))} />
			<span className="font-mono text-caption font-medium text-foreground">{stage.stageId}</span>
			<span className="font-mono text-micro text-passive">{stageOutcomeLabel(outcome)}</span>
			{stage.sessionId && (
				<span className="font-mono text-micro text-passive">
					· session <SessionLink sessionId={stage.sessionId} />
				</span>
			)}
			{stage.enteredVia === "failure" && stage.failedStage && (
				<Badge variant="outline">via {stage.failedStage} failing</Badge>
			)}
			{stage.producedArtifact && (
				<Badge variant={stage.producedArtifact.exists ? "outline" : "warning"}>
					{stage.producedArtifact.exists ? stage.producedArtifact.name : `${stage.producedArtifact.name} (missing)`}
				</Badge>
			)}
			<span className="ml-auto flex items-center gap-2 font-mono text-micro text-passive">
				{stage.outputTail && (
					<button
						type="button"
						onClick={() => setShowOutput((v) => !v)}
						className="rounded px-1 text-passive underline-offset-2 hover:text-foreground hover:underline"
						aria-expanded={showOutput}
					>
						{showOutput ? "Hide output" : "Output"}
					</button>
				)}
				<span>
					attempt {stage.attempt}
					{stage.attempt > 1 ? " · nudged" : ""}
				</span>
			</span>
			{stage.reason && <p className="w-full font-mono text-micro text-error">{stage.reason}</p>}
			{stage.outputTail && showOutput && (
				<pre className="max-h-80 w-full overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background px-2 py-1.5 font-mono text-micro text-muted-foreground">
					{stage.outputTail}
				</pre>
			)}
		</div>
	);
}

// SessionLink navigates to a session's page (from the routes shell), reused for
// both the run-level session and any stage that ran an agent (command stages
// leave stage.sessionId empty and stay plain text).
function SessionLink({ sessionId }: { sessionId: string }) {
	const navigate = useNavigate();
	return (
		<button
			type="button"
			onClick={() => void navigate({ to: "/sessions/$sessionId", params: { sessionId } })}
			className="rounded px-0.5 text-passive underline-offset-2 hover:text-foreground hover:underline"
		>
			{sessionId}
		</button>
	);
}
