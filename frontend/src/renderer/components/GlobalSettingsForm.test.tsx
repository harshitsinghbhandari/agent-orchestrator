import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSettingsForm } from "./GlobalSettingsForm";

const { getMock, postMock, getMigration, setMigration, getUpdate, setUpdate } = vi.hoisted(() => ({
	getMock: vi.fn(),
	postMock: vi.fn(),
	getMigration: vi.fn(),
	setMigration: vi.fn(),
	getUpdate: vi.fn(),
	setUpdate: vi.fn(),
}));

vi.mock("../lib/api-client", () => ({
	apiClient: { GET: getMock, POST: postMock },
	apiErrorMessage: (e: unknown, fb = "Request failed") =>
		e instanceof Error ? e.message : ((e as { message?: string })?.message ?? fb),
}));
vi.mock("../lib/bridge", () => ({
	aoBridge: {
		appState: { getMigration, setMigration },
		updateSettings: { get: getUpdate, set: setUpdate },
	},
}));

function renderForm() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={qc}>
			<GlobalSettingsForm />
		</QueryClientProvider>,
	);
	return qc;
}

beforeEach(() => {
	for (const m of [getMock, postMock, getMigration, setMigration, getUpdate, setUpdate]) m.mockReset();
	getMigration.mockResolvedValue({ status: "pending" });
	getMock.mockResolvedValue({ data: { available: true, legacyRoot: "/home/u/.agent-orchestrator" }, error: undefined });
	postMock.mockResolvedValue({ data: { report: { projectsImported: 2, projectsSkipped: 1 } }, error: undefined });
	setMigration.mockResolvedValue(undefined);
	getUpdate.mockResolvedValue({ enabled: true, channel: "latest", nightlyAck: false });
	setUpdate.mockResolvedValue(undefined);
});

describe("GlobalSettingsForm", () => {
	it("renders the Updates and Migration sections", async () => {
		renderForm();
		expect(await screen.findByText("Updates")).toBeInTheDocument();
		expect(screen.getByText("Migration")).toBeInTheDocument();
	});

	it("shows the nightly warning and saves the loaded channel", async () => {
		getUpdate.mockResolvedValue({ enabled: true, channel: "nightly", nightlyAck: true });
		renderForm();
		expect(await screen.findByText(/Nightly builds are cut every day/i)).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(setUpdate).toHaveBeenCalledWith(expect.objectContaining({ channel: "nightly", enabled: true })),
		);
	});

	it("hides the nightly warning on the stable channel", async () => {
		renderForm();
		await screen.findByText("Updates");
		expect(screen.queryByText(/Nightly builds are cut every day/i)).not.toBeInTheDocument();
	});

	it("shows migration status and the available legacy root", async () => {
		renderForm();
		expect(await screen.findByText("Not migrated yet")).toBeInTheDocument();
		expect(await screen.findByText("/home/u/.agent-orchestrator")).toBeInTheDocument();
	});

	it("Run migration imports and marks completed", async () => {
		renderForm();
		const btn = await screen.findByRole("button", { name: "Run migration" });
		await userEvent.click(btn);
		await waitFor(() => expect(postMock).toHaveBeenCalledWith("/api/v1/import"));
		expect(setMigration).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
		expect(await screen.findByText("Migration complete.")).toBeInTheDocument();
	});

	it("lets a declined user re-run the migration", async () => {
		getMigration.mockResolvedValue({ status: "declined", lastAttemptAt: "2026-06-01T00:00:00.000Z" });
		renderForm();
		expect(await screen.findByText("Declined")).toBeInTheDocument();
		const btn = await screen.findByRole("button", { name: "Run migration" });
		expect(btn).toBeEnabled();
		await userEvent.click(btn);
		await waitFor(() => expect(postMock).toHaveBeenCalledWith("/api/v1/import"));
	});

	it("disables Run when no legacy install is available", async () => {
		getMock.mockResolvedValue({ data: { available: false, legacyRoot: "" }, error: undefined });
		renderForm();
		expect(await screen.findByText("None found")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Run migration" })).toBeDisabled();
	});

	it("a failed import surfaces the error and marks failed", async () => {
		postMock.mockResolvedValue({ data: undefined, error: { message: "disk full" } });
		renderForm();
		const btn = await screen.findByRole("button", { name: "Run migration" });
		await userEvent.click(btn);
		expect(await screen.findByText(/disk full/i)).toBeInTheDocument();
		expect(setMigration).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: "disk full" }));
	});
});
