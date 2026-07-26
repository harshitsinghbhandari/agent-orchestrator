import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineRunDetail } from "./PipelineRunDetail";
import type { PipelineRunDetail as RunDetail } from "../hooks/usePipelineRuns";
import type { components } from "../../api/schema";

const { usePipelineRunMock, getMock, postMock, navigateMock } = vi.hoisted(() => ({
	usePipelineRunMock: vi.fn(),
	getMock: vi.fn(),
	postMock: vi.fn(),
	navigateMock: vi.fn(),
}));

vi.mock("../hooks/usePipelineRuns", () => ({
	usePipelineRun: () => usePipelineRunMock(),
	pipelineRunQueryKey: (runId: string) => ["pipeline-run", runId],
}));
vi.mock("../lib/api-client", () => ({
	apiClient: {
		GET: (...args: unknown[]) => getMock(...args),
		POST: (...args: unknown[]) => postMock(...args),
	},
	apiErrorCode: (e: unknown) => (e as { code?: string } | undefined)?.code,
	apiErrorMessage: (e: unknown, fallback = "Request failed") =>
		e instanceof Error ? e.message : ((e as { message?: string } | undefined)?.message ?? fallback),
	getApiBaseUrl: () => "http://127.0.0.1:3001",
	hasTrustedApiBaseUrl: () => true,
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

type StageView = RunDetail["stages"][number];
type SessionView = components["schemas"]["ControllersSessionView"];

const LOG_URL = "/api/v1/pipelines/runs/{runId}/stages/{stageId}/log";
const SESSION_URL = "/api/v1/sessions/{sessionId}";

function stage(overrides: Partial<StageView> & { stageId: string }): StageView {
	return {
		outcome: "succeeded",
		attempt: 1,
		enteredVia: "success",
		startedAt: "2026-07-15T00:00:00Z",
		settledAt: "2026-07-15T00:01:30Z",
		...overrides,
	};
}

function detail(overrides: Partial<RunDetail>): RunDetail {
	return {
		runId: "run-1",
		pipelineId: "def-1",
		pipelineName: "review",
		status: "running",
		subjectKind: "session",
		sessionId: "sess-1",
		headSha: "abcdef1234567890",
		stageCount: 1,
		stageOutcomes: { review: "running" },
		stages: [],
		createdAt: "2026-07-15T00:00:00Z",
		updatedAt: "2026-07-15T00:00:00Z",
		...overrides,
	};
}

function sessionView(overrides: Partial<SessionView> & { id: string }): SessionView {
	return {
		activity: { lastActivityAt: "2026-07-15T00:00:00Z", state: "idle" },
		createdAt: "2026-07-15T00:00:00Z",
		isTerminated: false,
		kind: "worker",
		projectId: "proj-1",
		prs: [],
		status: "idle",
		updatedAt: "2026-07-15T00:00:00Z",
		...overrides,
	};
}

function setRun(run: RunDetail) {
	usePipelineRunMock.mockReturnValue({ data: run, isLoading: false, isError: false, error: null });
}

// Route every GET the view makes: the stage log endpoint and the session lookup
// behind the orphan marker. Anything else is an unexpected call and fails loudly.
function setApi({
	log,
	logError,
	sessions = {},
}: {
	log?: components["schemas"]["PipelineStageLogResponse"];
	logError?: { code?: string; message: string };
	sessions?: Record<string, SessionView>;
} = {}) {
	getMock.mockImplementation((url: string, opts: { params: { path: Record<string, string> } }) => {
		if (url === LOG_URL) {
			if (logError) return Promise.resolve({ data: undefined, error: logError });
			return Promise.resolve(log ? { data: log, error: undefined } : { data: undefined, error: { message: "no log" } });
		}
		if (url === SESSION_URL) {
			const found = sessions[opts.params.path.sessionId];
			return Promise.resolve(
				found ? { data: { session: found }, error: undefined } : { data: undefined, error: { message: "no session" } },
			);
		}
		throw new Error(`unexpected GET ${url}`);
	});
}

function renderDetail(project?: string) {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<PipelineRunDetail runId="run-1" project={project} />
		</QueryClientProvider>,
	);
}

function row(stageId: string): HTMLElement {
	const found = document.querySelector(`[data-stage="${stageId}"]`);
	if (!found) throw new Error(`no row for stage ${stageId}`);
	return found as HTMLElement;
}

beforeEach(() => {
	usePipelineRunMock.mockReset();
	getMock.mockReset();
	postMock.mockReset().mockResolvedValue({ error: undefined });
	navigateMock.mockReset();
	setApi();
});

afterEach(() => vi.restoreAllMocks());

describe("PipelineRunDetail header", () => {
	it("shows the pipeline, the run status and the run folder path", () => {
		setRun(detail({ status: "failed", runDir: "/Users/x/.ao/pipelines/proj-1/run-1" }));
		renderDetail("proj-1");

		expect(screen.getByRole("heading", { name: "review" })).toBeInTheDocument();
		expect(screen.getByText("failed")).toBeInTheDocument();
		expect(screen.getByText("/Users/x/.ao/pipelines/proj-1/run-1")).toBeInTheDocument();
	});

	it("dates the run by when it was created and when it settled", () => {
		setRun(detail({ status: "succeeded", createdAt: "2026-07-15T00:00:00Z", settledAt: "2026-07-15T00:05:00Z" }));
		renderDetail("proj-1");

		expect(screen.getByText(/^created /)).toBeInTheDocument();
		expect(screen.getByText(/^settled /)).toBeInTheDocument();
	});

	it("says a running run has not settled instead of inventing a settled time", () => {
		setRun(detail({ status: "running", settledAt: null }));
		renderDetail("proj-1");

		expect(screen.queryByText(/^settled /)).not.toBeInTheDocument();
		expect(screen.getByText("not settled")).toBeInTheDocument();
	});

	it("links a session subject to its session page", async () => {
		setRun(detail({ subjectKind: "session", sessionId: "sess-42" }));
		renderDetail("proj-1");

		await userEvent.setup().click(screen.getByRole("button", { name: "sess-42" }));
		expect(navigateMock).toHaveBeenCalledWith({ to: "/sessions/$sessionId", params: { sessionId: "sess-42" } });
	});

	it("links a PR subject out to the PR when the tracked session knows its url", async () => {
		setRun(detail({ subjectKind: "pr", prNumber: 12, sessionId: "sess-pr" }));
		setApi({
			sessions: {
				"sess-pr": sessionView({
					id: "sess-pr",
					prs: [
						{
							number: 12,
							url: "https://github.com/acme/repo/pull/12",
							state: "open",
							ci: "passing",
							mergeability: "mergeable",
							review: "approved",
							reviewComments: false,
							updatedAt: "2026-07-15T00:00:00Z",
						},
					],
				}),
			},
		});
		renderDetail("proj-1");

		const link = await screen.findByRole("link", { name: "PR #12" });
		expect(link).toHaveAttribute("href", "https://github.com/acme/repo/pull/12");
	});

	it("still names a sessionless PR subject, as plain text rather than a dead link", () => {
		setRun(detail({ subjectKind: "pr", prNumber: 12, sessionId: "" }));
		renderDetail("proj-1");

		expect(screen.getByText("PR #12")).toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "PR #12" })).not.toBeInTheDocument();
	});

	it("shows the cancel reason next to a cancelled run's status", () => {
		setRun(detail({ status: "cancelled", cancelReason: "superseded by a newer run" }));
		renderDetail("proj-1");

		expect(screen.getByText("· superseded by a newer run")).toBeInTheDocument();
	});
});

describe("PipelineRunDetail stages", () => {
	// The API returns stages in the definition's document order, so the view must
	// not re-sort them: a run reads top to bottom the way it was written.
	it("renders stages in the order the API returned them", () => {
		setRun(
			detail({ stages: [stage({ stageId: "review" }), stage({ stageId: "assess" }), stage({ stageId: "publish" })] }),
		);
		const { container } = render(
			<QueryClientProvider client={new QueryClient()}>
				<PipelineRunDetail runId="run-1" project="proj-1" />
			</QueryClientProvider>,
		);

		const ids = Array.from(container.querySelectorAll("[data-stage]")).map((el) => el.getAttribute("data-stage"));
		expect(ids).toEqual(["review", "assess", "publish"]);
	});

	it("renders each stage with its outcome, attempt and reason", () => {
		setRun(detail({ stages: [stage({ stageId: "lint", outcome: "failed", attempt: 2, reason: "exit 1" })] }));
		renderDetail("proj-1");

		expect(within(row("lint")).getByText("failed")).toBeInTheDocument();
		expect(within(row("lint")).getByText("attempt 2")).toBeInTheDocument();
		expect(within(row("lint")).getByText("exit 1")).toBeInTheDocument();
	});

	// Attempt 2 exists only because the engine nudged once (spec 7.1), so the
	// screen names the nudge rather than leaving a bare number to decode.
	it("tags attempt 2 as nudged and leaves a first attempt untagged", () => {
		setRun(
			detail({
				stages: [stage({ stageId: "second", attempt: 2 }), stage({ stageId: "first", attempt: 1 })],
			}),
		);
		renderDetail("proj-1");

		expect(within(row("second")).getByText("nudged")).toBeInTheDocument();
		expect(within(row("first")).queryByText("nudged")).not.toBeInTheDocument();
		expect(within(row("first")).queryByText(/attempt/)).not.toBeInTheDocument();
	});

	it("spells succeeded_unverified the way the spec does", () => {
		setRun(detail({ stages: [stage({ stageId: "answer", outcome: "succeeded_unverified" })] }));
		renderDetail("proj-1");

		expect(within(row("answer")).getByText("succeeded (unverified)")).toBeInTheDocument();
	});

	it("names the stage whose failure routed here", () => {
		setRun(detail({ stages: [stage({ stageId: "notify", enteredVia: "failure", failedStage: "publish" })] }));
		renderDetail("proj-1");

		expect(within(row("notify")).getByText("via publish failing")).toBeInTheDocument();
	});

	it("times a settled stage and marks a running one as still going", () => {
		setRun(
			detail({
				stages: [
					stage({ stageId: "done", startedAt: "2026-07-15T00:00:00Z", settledAt: "2026-07-15T00:01:30Z" }),
					stage({ stageId: "live", outcome: "running", startedAt: "2026-07-15T00:00:00Z", settledAt: null }),
				],
			}),
		);
		renderDetail("proj-1");

		expect(within(row("done")).getByText("1m 30s")).toBeInTheDocument();
		expect(within(row("live")).getByText(/^running for /)).toBeInTheDocument();
	});

	it("shows no duration for a stage that never started", () => {
		setRun(detail({ stages: [stage({ stageId: "later", outcome: "pending", startedAt: null, settledAt: null })] }));
		renderDetail("proj-1");

		expect(within(row("later")).queryByText(/running for/)).not.toBeInTheDocument();
	});
});

describe("PipelineRunDetail stage log", () => {
	it("keeps the log collapsed until asked, then fetches the tail", async () => {
		setRun(detail({ stages: [stage({ stageId: "lint", outcome: "failed" })] }));
		setApi({ log: { runId: "run-1", stageId: "lint", content: "npm ERR! boom", truncated: false } });
		renderDetail("proj-1");

		expect(getMock).not.toHaveBeenCalledWith(LOG_URL, expect.anything());

		await userEvent.setup().click(within(row("lint")).getByRole("button", { name: "Log" }));

		expect(await within(row("lint")).findByText("npm ERR! boom")).toBeInTheDocument();
		expect(getMock).toHaveBeenCalledWith(LOG_URL, {
			params: { path: { runId: "run-1", stageId: "lint" }, query: { tail: 200 } },
		});
	});

	it("says so when the tail is only part of the log", async () => {
		setRun(detail({ stages: [stage({ stageId: "lint" })] }));
		setApi({ log: { runId: "run-1", stageId: "lint", content: "line", truncated: true } });
		renderDetail("proj-1");

		await userEvent.setup().click(within(row("lint")).getByRole("button", { name: "Log" }));
		expect(await within(row("lint")).findByText(/last 200 lines/)).toBeInTheDocument();
	});

	it("reports an empty log rather than an empty box", async () => {
		setRun(detail({ stages: [stage({ stageId: "lint" })] }));
		setApi({ log: { runId: "run-1", stageId: "lint", content: "", truncated: false } });
		renderDetail("proj-1");

		await userEvent.setup().click(within(row("lint")).getByRole("button", { name: "Log" }));
		expect(await within(row("lint")).findByText("No log was captured for this stage.")).toBeInTheDocument();
	});

	// The daemon 404s a stage with no log file on disk. That is the empty case,
	// not a failure, and showing a raw error code for it reads as a broken viewer.
	it("treats a missing log file as an empty log, not as an error", async () => {
		setRun(detail({ stages: [stage({ stageId: "review", outcome: "no_signal" })] }));
		setApi({ logError: { code: "PIPELINE_STAGE_LOG_NOT_FOUND", message: "Pipeline stage has no log yet" } });
		renderDetail("proj-1");

		await userEvent.setup().click(within(row("review")).getByRole("button", { name: "Log" }));
		expect(await within(row("review")).findByText("No log was captured for this stage.")).toBeInTheDocument();
		expect(within(row("review")).queryByText(/PIPELINE_STAGE_LOG_NOT_FOUND/)).not.toBeInTheDocument();
	});

	it("surfaces a log the daemon could not read", async () => {
		setRun(detail({ stages: [stage({ stageId: "lint" })] }));
		setApi({ logError: { code: "INTERNAL", message: "disk on fire" } });
		renderDetail("proj-1");

		await userEvent.setup().click(within(row("lint")).getByRole("button", { name: "Log" }));
		// The query retries once before it settles into its error state, so this
		// waits past the retry rather than racing it.
		expect(await within(row("lint")).findByText(/disk on fire/, {}, { timeout: 5000 })).toBeInTheDocument();
	});

	it("offers no log for a stage that never ran", () => {
		setRun(detail({ stages: [stage({ stageId: "skipped", outcome: "skipped", startedAt: null, settledAt: null })] }));
		renderDetail("proj-1");

		expect(within(row("skipped")).queryByRole("button", { name: "Log" })).not.toBeInTheDocument();
	});
});

describe("PipelineRunDetail artifacts", () => {
	it("links a produced artifact through the outputs endpoint", () => {
		setRun(detail({ stages: [stage({ stageId: "audit", producedArtifact: { name: "audit.md", exists: true } })] }));
		renderDetail("proj-1");

		expect(within(row("audit")).getByRole("link", { name: "audit.md" })).toHaveAttribute(
			"href",
			"http://127.0.0.1:3001/api/v1/pipelines/runs/run-1/outputs/audit.md",
		);
	});

	// no_output is the whole point of the taxonomy: the agent said done and the
	// file was not there. Saying that beats a link to nothing.
	it("explains a no_output stage instead of linking a file that does not exist", () => {
		setRun(
			detail({
				stages: [
					stage({ stageId: "assess", outcome: "no_output", producedArtifact: { name: "review.md", exists: false } }),
				],
			}),
		);
		renderDetail("proj-1");

		expect(within(row("assess")).queryByRole("link")).not.toBeInTheDocument();
		expect(within(row("assess")).getByText(/review\.md/)).toHaveTextContent(
			"review.md is missing: the agent signalled done and the file was not there.",
		);
	});

	it("distinguishes a missing artifact on a settled stage from one that is not due yet", () => {
		setRun(
			detail({
				stages: [
					stage({ stageId: "gone", outcome: "succeeded", producedArtifact: { name: "out.md", exists: false } }),
					stage({
						stageId: "queued",
						outcome: "pending",
						startedAt: null,
						settledAt: null,
						producedArtifact: { name: "later.md", exists: false },
					}),
				],
			}),
		);
		renderDetail("proj-1");

		expect(within(row("gone")).getByText("out.md is not in the run folder.")).toBeInTheDocument();
		expect(within(row("queued")).getByText("produces later.md")).toBeInTheDocument();
	});
});

describe("PipelineRunDetail sessions", () => {
	it("links a stage's session id to the session page", async () => {
		setRun(detail({ stages: [stage({ stageId: "fix", sessionId: "sess-fix-1" })] }));
		renderDetail("proj-1");

		await userEvent.setup().click(within(row("fix")).getByRole("button", { name: "sess-fix-1" }));
		expect(navigateMock).toHaveBeenCalledWith({ to: "/sessions/$sessionId", params: { sessionId: "sess-fix-1" } });
	});

	it("does not render a stage session link when the stage has no sessionId (command stages)", () => {
		setRun(detail({ stages: [stage({ stageId: "lint" })] }));
		renderDetail("proj-1");

		expect(within(row("lint")).queryByRole("button", { name: /sess-/ })).not.toBeInTheDocument();
	});

	it("marks a kept session and offers to kill it", async () => {
		setRun(detail({ stages: [stage({ stageId: "review", outcome: "no_signal", sessionId: "sess-kept" })] }));
		setApi({
			sessions: {
				"sess-kept": sessionView({
					id: "sess-kept",
					pipelineOrphan: {
						runId: "run-1",
						stage: "review",
						outcome: "no_signal",
						pipeline: "review",
						keptAt: "2026-07-15T00:02:00Z",
					},
				}),
			},
		});
		renderDetail("proj-1");

		expect(await within(row("review")).findByText("kept")).toBeInTheDocument();

		await userEvent.setup().click(within(row("review")).getByRole("button", { name: "Kill session" }));
		await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
		expect(postMock).toHaveBeenCalledWith("/api/v1/sessions/{sessionId}/kill", {
			params: { path: { sessionId: "sess-kept" } },
		});
	});

	// The daemon leaves pipelineOrphan on the DTO after a kill, so a terminated
	// session would otherwise keep offering a kill button that has already run.
	it("drops the marker once the session is terminated", async () => {
		setRun(
			detail({
				stages: [
					stage({ stageId: "alive", outcome: "no_output", sessionId: "sess-alive" }),
					stage({ stageId: "dead", outcome: "no_output", sessionId: "sess-dead" }),
				],
			}),
		);
		const orphan = {
			runId: "run-1",
			outcome: "no_output",
			pipeline: "review",
			keptAt: "2026-07-15T00:02:00Z",
		};
		setApi({
			sessions: {
				"sess-alive": sessionView({ id: "sess-alive", pipelineOrphan: { ...orphan, stage: "alive" } }),
				"sess-dead": sessionView({
					id: "sess-dead",
					isTerminated: true,
					status: "terminated",
					pipelineOrphan: { ...orphan, stage: "dead" },
				}),
			},
		});
		renderDetail("proj-1");

		await within(row("alive")).findByText("kept");
		expect(within(row("dead")).queryByText("kept")).not.toBeInTheDocument();
		expect(within(row("dead")).queryByRole("button", { name: "Kill session" })).not.toBeInTheDocument();
	});

	// A session an earlier run kept is not this run's business. The marker waits
	// on the sibling stage's badge, so the session lookups have demonstrably
	// resolved before the absence is asserted.
	it("does not mark a session another run kept", async () => {
		setRun(
			detail({
				stages: [
					stage({ stageId: "mine", outcome: "no_output", sessionId: "sess-mine" }),
					stage({ stageId: "theirs", sessionId: "sess-other" }),
				],
			}),
		);
		setApi({
			sessions: {
				"sess-mine": sessionView({
					id: "sess-mine",
					pipelineOrphan: {
						runId: "run-1",
						stage: "mine",
						outcome: "no_output",
						pipeline: "review",
						keptAt: "2026-07-15T00:02:00Z",
					},
				}),
				"sess-other": sessionView({
					id: "sess-other",
					pipelineOrphan: {
						runId: "run-99",
						stage: "theirs",
						outcome: "no_output",
						pipeline: "review",
						keptAt: "2026-07-15T00:02:00Z",
					},
				}),
			},
		});
		renderDetail("proj-1");

		await within(row("mine")).findByText("kept");
		expect(within(row("theirs")).queryByText("kept")).not.toBeInTheDocument();
		expect(within(row("theirs")).queryByRole("button", { name: "Kill session" })).not.toBeInTheDocument();
	});
});

describe("PipelineRunDetail actions", () => {
	it("cancels a running run with the run's project scope", async () => {
		setRun(detail({ status: "running" }));
		renderDetail("proj-7");

		await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));

		await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
		expect(postMock).toHaveBeenCalledWith("/api/v1/pipelines/runs/{runId}/cancel", {
			params: { path: { runId: "run-1" }, query: { project: "proj-7" } },
		});
	});

	// v2 has no resume: a failed run is dead, and re-running means a new run.
	// The findings panel went with the findings subsystem (D10).
	it("offers no Cancel, no Resume and no findings on a settled run", () => {
		setRun(detail({ status: "failed" }));
		renderDetail("proj-1");

		expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
		expect(screen.queryByText(/finding/i)).not.toBeInTheDocument();
	});

	it("disables the action when the run's project is unknown", () => {
		setRun(detail({ status: "running" }));
		renderDetail(undefined);

		expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
	});
});
