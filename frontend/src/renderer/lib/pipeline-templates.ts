// The three static "New pipeline" templates. Baked into the renderer (spec
// decision: no template API); each is a full PipelineDraft in the normalized
// codec shape, so instantiating one is just serializeToYaml(template.draft())
// and the result parses clean through backend ParseDefinition (/validate).
// pipeline-templates.test.ts mirrors the Go validation rules to keep them
// honest.

import type { PipelineDraft } from "./pipeline-draft";

export interface PipelineTemplate {
	id: "pr-review" | "session-idle-triage" | "release-gate";
	name: string;
	description: string;
	// Accent dot in the modal's template list.
	dotClass: string;
	// Fresh draft per call so an edited instantiation never mutates the template.
	draft: () => PipelineDraft;
}

// An agent produces the review, a command posts it: the §6.4 split that makes
// the outcome measurable, and the reason the agent stage carries no credentials.
function prReview(): PipelineDraft {
	return {
		name: "pr-review",
		on: { pr: ["created", "updated"] },
		// The head moved, so an in-flight review is reading stale code (§10).
		concurrency: { scope: "pr", group: "pr-review", cancelInProgress: true },
		defaults: { onFailure: "notify-failure" },
		stages: [
			{
				id: "review",
				executor: "agent",
				agent: "claude-code",
				produces: "review.md",
				deadline: "20m",
				session: { killOn: ["succeeded", "failed"] },
				prompt: [
					"Review the diff for correctness, security, and convention drift.",
					"Write the review to $AO_OUTPUT, then `ao pipeline done`.",
					'If the change cannot be reviewed, `ao pipeline fail --reason "..."`.',
				].join("\n"),
				onSuccess: ["post-review"],
			},
			{
				id: "post-review",
				executor: "command",
				workspace: "run",
				credentials: ["github-review"],
				run: 'gh pr comment "$AO_PR_NUMBER" --body-file "$AO_RUN_DIR/agent-outputs/review.md"',
			},
			{
				id: "notify-failure",
				executor: "command",
				workspace: "run",
				run: 'echo "pr-review failed at $AO_FAILED_STAGE ($AO_FAILED_OUTCOME)"',
			},
		],
	};
}

// One agent in the user's own session, so it must never be killed (§7.2).
function sessionIdleTriage(): PipelineDraft {
	return {
		name: "session-idle-triage",
		on: { session: ["idle"] },
		concurrency: { scope: "session", group: "session-idle-triage", cancelInProgress: true },
		stages: [
			{
				id: "triage",
				executor: "agent",
				agent: "claude-code",
				workspace: "session",
				produces: "triage.md",
				deadline: "10m",
				// kill-on: [] never kills: this stage runs in a live human session.
				session: { killOn: [] },
				prompt: [
					"The session has gone idle. Summarize where the work stands,",
					"what is blocked, and the single next action.",
					"Write it to $AO_OUTPUT, then `ao pipeline done`.",
				].join("\n"),
			},
		],
	};
}

// A trimmed version of the spec §11 release pipeline: fan-out, one join, an
// agent on the failure path, and the pipeline-level failure default.
function releaseGate(): PipelineDraft {
	return {
		name: "release-gate",
		on: { pr: ["merged"] },
		// Nothing is worse than killing a run mid-release, so no cancellation, and
		// the scope is the project rather than the merged PR (§10).
		concurrency: { scope: "project", group: "release", cancelInProgress: false },
		defaults: { deadline: "30m", onFailure: "notify-failure" },
		stages: [
			{
				id: "prepare",
				executor: "command",
				workspace: "run",
				run: 'ao release resolve-version > "$AO_RUN_DIR/version"',
				onSuccess: ["build", "release-notes"],
			},
			{
				id: "build",
				executor: "command",
				workspace: "stage",
				deadline: "40m",
				run: "npm ci\nnpm run build",
				onSuccess: ["publish"],
				onFailure: "diagnose-build",
			},
			{
				id: "release-notes",
				executor: "agent",
				agent: "claude-code",
				workspace: "stage",
				produces: "release-notes.md",
				deadline: "15m",
				session: { killOn: ["succeeded", "failed"] },
				prompt: [
					'Write release notes for version $(cat "$AO_RUN_DIR/version").',
					"Group by user-visible change, not by commit.",
					"Write them to $AO_OUTPUT, then `ao pipeline done`.",
				].join("\n"),
				onSuccess: ["publish"],
			},
			{
				id: "publish",
				executor: "command",
				needs: ["build", "release-notes"],
				workspace: "run",
				credentials: ["github-release"],
				run: 'gh release create "v$(cat "$AO_RUN_DIR/version")" --notes-file "$AO_RUN_DIR/agent-outputs/release-notes.md"',
			},
			{
				id: "diagnose-build",
				executor: "agent",
				agent: "claude-code",
				produces: "diagnosis.md",
				deadline: "15m",
				// Kept alive on every outcome: this is the stage a human opens.
				session: { killOn: [] },
				prompt: [
					"Build stage `$AO_FAILED_STAGE` failed. Its log is at",
					"$AO_RUN_DIR/stage-logs/$AO_FAILED_STAGE.log and you are in its",
					"working tree with the failure state intact.",
					"Diagnose the root cause, write to $AO_OUTPUT, then `ao pipeline done`.",
				].join("\n"),
				onSuccess: ["notify-failure"],
			},
			{
				id: "notify-failure",
				executor: "command",
				workspace: "run",
				run: 'echo "release failed at $AO_FAILED_STAGE ($AO_FAILED_OUTCOME)"',
			},
		],
	};
}

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
	{
		id: "pr-review",
		name: "PR review",
		description: "an agent reviews the diff, a command posts it",
		dotClass: "bg-accent",
		draft: prReview,
	},
	{
		id: "session-idle-triage",
		name: "Session idle triage",
		description: "summarize where an idle session stands",
		dotClass: "bg-warning",
		draft: sessionIdleTriage,
	},
	{
		id: "release-gate",
		name: "Release gate",
		description: "build and notes fan out, join, publish",
		dotClass: "bg-success",
		draft: releaseGate,
	},
];
