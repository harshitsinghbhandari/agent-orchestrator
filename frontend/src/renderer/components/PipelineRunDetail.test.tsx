import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineRunDetail } from "./PipelineRunDetail";
import type { PipelineRunDetail as RunDetail } from "../hooks/usePipelineRuns";

const { usePipelineRunMock, postMock, navigateMock } = vi.hoisted(() => ({
	usePipelineRunMock: vi.fn(),
	postMock: vi.fn(),
	navigateMock: vi.fn(),
}));

vi.mock("../hooks/usePipelineRuns", () => ({
	usePipelineRun: () => usePipelineRunMock(),
	pipelineRunQueryKey: (runId: string) => ["pipeline-run", runId],
}));
vi.mock("../lib/api-client", () => ({
	apiClient: { POST: (...args: unknown[]) => postMock(...args) },
	apiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

type StageView = RunDetail["stages"][number];

function stage(overrides: Partial<StageView> & { stageId: string }): StageView {
	return {
		outcome: "succeeded",
		attempt: 1,
		enteredVia: "success",
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

function setRun(run: RunDetail) {
	usePipelineRunMock.mockReturnValue({ data: run, isLoading: false, isError: false, error: null });
}

function renderDetail(project?: string) {
	render(
		<QueryClientProvider client={new QueryClient()}>
			<PipelineRunDetail runId="run-1" project={project} />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	usePipelineRunMock.mockReset();
	postMock.mockReset().mockResolvedValue({ error: undefined });
	navigateMock.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("PipelineRunDetail", () => {
	it("renders each stage with its outcome, attempt and reason", () => {
		setRun(
			detail({
				stages: [stage({ stageId: "lint", outcome: "failed", attempt: 2, reason: "exit 1" })],
			}),
		);
		renderDetail("proj-1");

		const row = screen.getByText("lint").closest("[data-stage]") as HTMLElement;
		expect(within(row).getByText("failed")).toBeInTheDocument();
		// Attempt 2 is the one nudge a stage gets, and it is labelled as such.
		expect(within(row).getByText(/attempt 2/)).toBeInTheDocument();
		expect(within(row).getByText(/nudged/)).toBeInTheDocument();
		expect(within(row).getByText("exit 1")).toBeInTheDocument();
	});

	it("spells succeeded_unverified the way the spec does", () => {
		setRun(detail({ stages: [stage({ stageId: "answer", outcome: "succeeded_unverified" })] }));
		renderDetail("proj-1");

		const row = screen.getByText("answer").closest("[data-stage]") as HTMLElement;
		expect(within(row).getByText("succeeded (unverified)")).toBeInTheDocument();
	});

	it("names a declared artifact and flags it when the engine did not find one", () => {
		setRun(
			detail({
				stages: [
					stage({ stageId: "assess", outcome: "no_output", producedArtifact: { name: "review.md", exists: false } }),
					stage({ stageId: "audit", outcome: "succeeded", producedArtifact: { name: "audit.md", exists: true } }),
				],
			}),
		);
		renderDetail("proj-1");

		const missing = screen.getByText("assess").closest("[data-stage]") as HTMLElement;
		expect(within(missing).getByText("review.md (missing)")).toBeInTheDocument();

		const present = screen.getByText("audit").closest("[data-stage]") as HTMLElement;
		expect(within(present).getByText("audit.md")).toBeInTheDocument();
	});

	it("names the stage whose failure routed here", () => {
		setRun(detail({ stages: [stage({ stageId: "notify", enteredVia: "failure", failedStage: "publish" })] }));
		renderDetail("proj-1");

		const row = screen.getByText("notify").closest("[data-stage]") as HTMLElement;
		expect(within(row).getByText("via publish failing")).toBeInTheDocument();
	});

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
	it("offers no Cancel and no Resume on a settled run", () => {
		setRun(detail({ status: "failed" }));
		renderDetail("proj-1");

		expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
	});

	it("disables the action when the run's project is unknown", () => {
		setRun(detail({ status: "running" }));
		renderDetail(undefined);

		expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
	});

	it("shows the cancel reason next to a cancelled run's status", () => {
		setRun(detail({ status: "cancelled", cancelReason: "superseded by a newer run" }));
		renderDetail("proj-1");

		expect(screen.getByText("· superseded by a newer run")).toBeInTheDocument();
	});

	it("links the run-level session id to the session page", async () => {
		setRun(detail({ sessionId: "sess-42" }));
		renderDetail("proj-1");

		await userEvent.setup().click(screen.getByRole("button", { name: "sess-42" }));
		expect(navigateMock).toHaveBeenCalledWith({ to: "/sessions/$sessionId", params: { sessionId: "sess-42" } });
	});

	it("renders a dash instead of a link when the run has no session", () => {
		setRun(detail({ sessionId: "" }));
		renderDetail("proj-1");

		expect(screen.getByText("—", { exact: false })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "sess-42" })).not.toBeInTheDocument();
	});

	it("links a stage's session id to the session page", async () => {
		setRun(detail({ stages: [stage({ stageId: "fix", sessionId: "sess-fix-1" })] }));
		renderDetail("proj-1");

		const row = screen.getByText("fix").closest("[data-stage]") as HTMLElement;
		await userEvent.setup().click(within(row).getByRole("button", { name: "sess-fix-1" }));
		expect(navigateMock).toHaveBeenCalledWith({ to: "/sessions/$sessionId", params: { sessionId: "sess-fix-1" } });
	});

	it("does not render a stage session link when the stage has no sessionId (command stages)", () => {
		setRun(detail({ stages: [stage({ stageId: "lint" })] }));
		renderDetail("proj-1");

		const row = screen.getByText("lint").closest("[data-stage]") as HTMLElement;
		expect(within(row).queryAllByRole("button")).toHaveLength(0);
	});

	// The API returns stages in the definition's document order, so the view must
	// not re-sort them: a run reads top to bottom the way it was written.
	it("renders stages in the order the API returned them", () => {
		setRun(
			detail({
				stages: [stage({ stageId: "review" }), stage({ stageId: "assess" }), stage({ stageId: "publish" })],
			}),
		);
		const { container } = render(
			<QueryClientProvider client={new QueryClient()}>
				<PipelineRunDetail runId="run-1" project="proj-1" />
			</QueryClientProvider>,
		);

		const ids = Array.from(container.querySelectorAll("[data-stage]")).map((el) => el.getAttribute("data-stage"));
		expect(ids).toEqual(["review", "assess", "publish"]);
	});
});
