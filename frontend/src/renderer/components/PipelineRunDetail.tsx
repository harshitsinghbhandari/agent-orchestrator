import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "../lib/utils";
import { formatTimeCompact } from "../lib/format-time";
import { apiClient, apiErrorCode, apiErrorMessage, getApiBaseUrl } from "../lib/api-client";
import {
	formatStageDuration,
	runStatusTone,
	shortSha,
	stageOutcomeDotTone,
	stageOutcomeLabel,
} from "../lib/pipeline-display";
import { useKillSession } from "../hooks/useKillSession";
import { pipelineRunQueryKey, usePipelineRun } from "../hooks/usePipelineRuns";
import { useWorkspaceQuery } from "../hooks/useWorkspaceQuery";
import type { RunStatus, StageOutcome } from "../lib/pipeline-draft";
import type { WorkspaceSession } from "../types/workspace";
import type { components } from "../../api/schema";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

type PipelineStageView = components["schemas"]["PipelineStageView"];

// How much of a stage log the viewer asks for. The log is the main debugging
// surface for a command stage that failed, and the interesting part of a failure
// is the end of it.
const LOG_TAIL_LINES = 200;

// The daemon's code for "this stage has no log file", which the viewer renders
// as an empty log rather than as a failure.
const LOG_NOT_FOUND_CODE = "PIPELINE_STAGE_LOG_NOT_FOUND";

// Read-only detail for one pipeline run. Its job is to make the outcome taxonomy
// (spec section 7) legible: which stage settled how, whether it was nudged,
// which failure routed into it, what it produced or failed to produce, and what
// its log says. There is no resume (spec section 14.1) and no findings panel:
// the findings subsystem is deleted (D10), and a stage's contract is its one
// declared artifact.
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
	const status = run.status as RunStatus;
	const canCancel = status === "pending" || status === "running";

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
			<header className="border-b border-border px-6 py-5">
				<div className="flex flex-wrap items-center gap-2">
					<h1 className="truncate text-subtitle font-bold tracking-tight text-foreground">{run.pipelineName}</h1>
					<Badge variant="outline" className={cn("gap-1.5", runStatusTone(status))} data-run-status={status}>
						<span className={cn("h-1.5 w-1.5 rounded-full", stageOutcomeDotTone(status as StageOutcome))} />
						{status}
					</Badge>
					{run.cancelReason && <span className="text-caption text-passive">· {run.cancelReason}</span>}
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
				</div>

				<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-micro text-passive">
					<span>{run.runId}</span>
					<span aria-hidden="true">·</span>
					<RunSubject run={run} />
					<span aria-hidden="true">·</span>
					<span title={absoluteTime(run.createdAt)}>created {formatTimeCompact(run.createdAt)}</span>
					<span aria-hidden="true">·</span>
					{run.settledAt ? (
						<span title={absoluteTime(run.settledAt)}>settled {formatTimeCompact(run.settledAt)}</span>
					) : (
						<span>not settled</span>
					)}
				</div>

				{run.runDir && (
					<p className="mt-1 truncate font-mono text-micro text-passive" title={run.runDir}>
						{run.runDir}
					</p>
				)}
			</header>

			<section aria-label="Stages" className="px-6 py-4">
				<h2 className="mb-2 text-micro font-semibold uppercase tracking-wide text-passive">Stages</h2>
				<div className="flex flex-col gap-2">
					{stages.map((stage) => (
						<StageRow key={stage.stageId} runId={run.runId} stage={stage} />
					))}
					{stages.length === 0 && <p className="text-caption text-passive">No stages yet.</p>}
				</div>
			</section>
		</div>
	);
}

// What the run is about. A PR subject only has a url when a local session tracks
// it (the run DTO carries the number, not the link), and a sessionless PR is
// first-class (spec section 4), so the number renders as plain text rather than
// as a link to a guessed url.
function RunSubject({ run }: { run: components["schemas"]["PipelineRunDetail"] }) {
	const session = useSessionFacts(run.sessionId);
	if (run.subjectKind === "pr" && run.prNumber) {
		const prUrl = session?.prs?.find((pr) => pr.number === run.prNumber)?.url;
		return (
			<span className="flex items-center gap-2">
				{prUrl ? (
					<a
						href={prUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="rounded text-passive underline-offset-2 hover:text-foreground hover:underline"
					>
						PR #{run.prNumber}
					</a>
				) : (
					<span>PR #{run.prNumber}</span>
				)}
				{run.headSha && <span>{shortSha(run.headSha)}</span>}
				{run.sessionId && <SessionLink sessionId={run.sessionId} />}
			</span>
		);
	}
	if (run.sessionId) return <SessionLink sessionId={run.sessionId} />;
	// A project subject (a manual trigger) has neither a PR nor a session to
	// point at, and saying so is the whole of it.
	return <span>{run.subjectKind}</span>;
}

// One stage row: how it settled, how long it took, why it was entered, what it
// produced, and the two things a human reaches for when it went wrong (the log
// and the session that is still alive).
function StageRow({ runId, stage }: { runId: string; stage: PipelineStageView }) {
	const [showLog, setShowLog] = useState(false);
	const outcome = stage.outcome as StageOutcome;
	const settled = Boolean(stage.settledAt);
	const duration = formatStageDuration(stage.startedAt, stage.settledAt);
	// A stage the plan never reached has no log file, so do not offer a button
	// that can only 404.
	const hasLog = Boolean(stage.startedAt);

	return (
		<div data-stage={stage.stageId} className="rounded-md border border-border bg-card px-3 py-2.5">
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-mono text-caption font-medium text-foreground">{stage.stageId}</span>
				<Badge variant="outline" className="gap-1.5">
					<span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stageOutcomeDotTone(outcome))} />
					{stageOutcomeLabel(outcome)}
				</Badge>
				{stage.attempt > 1 && (
					<>
						<span className="font-mono text-micro text-passive">attempt {stage.attempt}</span>
						<Badge variant="warning" title="The engine nudged this stage once and it ran again (spec 7.1)">
							nudged
						</Badge>
					</>
				)}
				{stage.enteredVia === "failure" && stage.failedStage && (
					<Badge variant="outline">via {stage.failedStage} failing</Badge>
				)}
				<span className="ml-auto flex items-center gap-2 font-mono text-micro text-passive">
					{duration && <span>{settled ? duration : `running for ${duration}`}</span>}
					{hasLog && (
						<button
							type="button"
							onClick={() => setShowLog((v) => !v)}
							aria-expanded={showLog}
							className="rounded px-1 text-passive underline-offset-2 hover:text-foreground hover:underline"
						>
							{showLog ? "Hide log" : "Log"}
						</button>
					)}
				</span>
			</div>

			{stage.reason && <p className="mt-1.5 font-mono text-micro text-error">{stage.reason}</p>}

			{(stage.producedArtifact || stage.sessionId) && (
				<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro text-passive">
					{stage.producedArtifact && (
						<StageArtifact runId={runId} artifact={stage.producedArtifact} outcome={outcome} />
					)}
					{stage.sessionId && <StageSession runId={runId} stageId={stage.stageId} sessionId={stage.sessionId} />}
				</div>
			)}

			{showLog && <StageLog runId={runId} stageId={stage.stageId} live={!settled} />}
		</div>
	);
}

// The declared artifact, verified against the run folder by the API. The three
// states are deliberately distinct: `no_output` is the agent saying done with
// nothing there (spec section 7), a settled stage missing its file means the run
// folder no longer has it, and a stage that has not run yet is simply not due.
function StageArtifact({
	runId,
	artifact,
	outcome,
}: {
	runId: string;
	artifact: components["schemas"]["PipelineProducedArtifact"];
	outcome: StageOutcome;
}) {
	if (artifact.exists) {
		return (
			<a
				href={`${getApiBaseUrl()}/api/v1/pipelines/runs/${encodeURIComponent(runId)}/outputs/${encodeURIComponent(artifact.name)}`}
				target="_blank"
				rel="noopener noreferrer"
				className="rounded text-accent underline-offset-2 hover:underline"
			>
				{artifact.name}
			</a>
		);
	}
	if (outcome === "no_output") {
		return (
			<span className="text-warning">
				{artifact.name} is missing: the agent signalled done and the file was not there.
			</span>
		);
	}
	if (outcome === "pending" || outcome === "running") {
		return <span>produces {artifact.name}</span>;
	}
	return <span className="text-warning">{artifact.name} is not in the run folder.</span>;
}

// A stage's session, plus the affordance for one the engine kept alive:
// `no_output`, `no_signal` and `timed_out` spare the session precisely so a
// human can look at it (spec section 7.2), and the bound on that is a visible
// marker and a kill button, not a silent reaper.
function StageSession({ runId, stageId, sessionId }: { runId: string; stageId: string; sessionId: string }) {
	const session = useSessionFacts(sessionId);
	const [killError, setKillError] = useState<string | null>(null);
	const orphan = session?.pipelineOrphan;
	// `pipelineOrphan` survives on the DTO after the session is killed, so the
	// terminated check is what makes the marker mean "still alive, go look at
	// it" rather than "was spared once". Without it the kill button stays after
	// it has done its job.
	const keptHere = orphan?.runId === runId && orphan?.stage === stageId && session?.status !== "terminated";

	// The shared kill mutation: one endpoint, one set of telemetry events, and a
	// workspace refetch that is also what refreshes the marker on this row.
	const kill = useKillSession(
		{ id: sessionId, workspaceId: session?.workspaceId ?? "" },
		{ onKilled: () => setKillError(null), onError: setKillError },
	);

	return (
		<span className="flex items-center gap-2">
			<span>session</span>
			<SessionLink sessionId={sessionId} />
			{keptHere && orphan && (
				<>
					<Badge
						variant="warning"
						title={`Kept alive after ${stageOutcomeLabel(orphan.outcome as StageOutcome)}, ${formatTimeCompact(orphan.keptAt)}, so you can see what the agent was doing.`}
					>
						kept
					</Badge>
					<Button size="sm" variant="outline" disabled={kill.isPending} onClick={() => kill.mutate()}>
						{kill.isPending ? "Killing…" : "Kill session"}
					</Button>
				</>
			)}
			{killError && <span className="text-error">{killError}</span>}
		</span>
	);
}

// The stage's captured stdout and stderr, fetched only once someone opens it and
// refetched while the stage is still running.
function StageLog({ runId, stageId, live }: { runId: string; stageId: string; live: boolean }) {
	const { data, isLoading, error } = useQuery({
		queryKey: ["pipeline-stage-log", runId, stageId],
		queryFn: async () => {
			const { data: body, error: apiError } = await apiClient.GET(
				"/api/v1/pipelines/runs/{runId}/stages/{stageId}/log",
				{ params: { path: { runId, stageId }, query: { tail: LOG_TAIL_LINES } } },
			);
			// A stage with no log file on disk is the empty case, not an error:
			// showing an error code for "nothing was written" reads as a bug in
			// the viewer rather than as the fact it is.
			if (apiErrorCode(apiError) === LOG_NOT_FOUND_CODE) return { content: "", truncated: false };
			if (apiError) throw new Error(apiErrorMessage(apiError, "Could not read the stage log"));
			return body;
		},
		retry: 1,
		refetchInterval: live ? 5_000 : false,
	});

	if (isLoading) return <p className="mt-1.5 font-mono text-micro text-passive">Loading log…</p>;
	if (error) {
		return (
			<p className="mt-1.5 font-mono text-micro text-error">{apiErrorMessage(error, "Could not read the stage log")}</p>
		);
	}
	if (!data?.content)
		return <p className="mt-1.5 font-mono text-micro text-passive">No log was captured for this stage.</p>;

	return (
		<div className="mt-1.5">
			{data.truncated && <p className="mb-1 font-mono text-micro text-passive">Showing the last 200 lines.</p>}
			<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background px-2 py-1.5 font-mono text-micro text-muted-foreground">
				{data.content}
			</pre>
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

// The two things run detail reads off a session: the orphan marker
// (`pipelineOrphan`) and the PR url a PR-subject run needs and does not carry
// itself. Both ride the workspace query the shell has already loaded, so this
// screen adds no request of its own and sees the same session facts as the
// board.
function useSessionFacts(sessionId: string | undefined): WorkspaceSession | undefined {
	const workspaces = useWorkspaceQuery().data;
	if (!sessionId) return undefined;
	for (const workspace of workspaces ?? []) {
		const found = workspace.sessions.find((session) => session.id === sessionId);
		if (found) return found;
	}
	return undefined;
}

function absoluteTime(iso: string): string {
	const ts = new Date(iso);
	return Number.isFinite(ts.getTime()) ? ts.toLocaleString() : iso;
}
