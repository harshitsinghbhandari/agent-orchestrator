import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PipelineSettingsModal } from "./PipelineSettingsModal";
import type { PipelineDraft } from "../lib/pipeline-draft";

function baseDraft(): PipelineDraft {
	return {
		name: "pr-review",
		stages: [
			{ id: "review", executor: "agent", agent: "claude-code" },
			{ id: "notify-failure", executor: "command", run: "true" },
		],
	};
}

// The harness exposes the committed draft so tests assert exactly what Done
// handed back through the setDraft path.
let committed: PipelineDraft;

function Harness({ initial }: { initial: PipelineDraft }) {
	const [draft, setDraft] = useState(initial);
	const [open, setOpen] = useState(true);
	committed = draft;
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				open settings
			</button>
			<PipelineSettingsModal
				open={open}
				value={draft}
				onCancel={() => setOpen(false)}
				onDone={(next) => {
					setDraft(next);
					setOpen(false);
				}}
			/>
		</>
	);
}

async function chooseOption(trigger: HTMLElement, optionName: string) {
	await userEvent.click(trigger);
	await userEvent.click(await screen.findByRole("option", { name: optionName }));
}

describe("PipelineSettingsModal", () => {
	it("binds the name, committing on Done", async () => {
		const user = userEvent.setup();
		render(<Harness initial={baseDraft()} />);

		const name = screen.getByRole("textbox", { name: "Pipeline name" });
		await user.clear(name);
		await user.type(name, "nightly-triage");

		await user.click(screen.getByRole("button", { name: "Done" }));
		expect(committed).toEqual({ ...baseDraft(), name: "nightly-triage" });
	});

	it("toggles trigger events and drops the block when the last one goes", async () => {
		const user = userEvent.setup();
		render(<Harness initial={baseDraft()} />);

		expect(screen.getByText(/runs only when started by hand/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "created" }));
		await user.click(screen.getByRole("button", { name: "idle" }));
		await user.click(screen.getByRole("button", { name: "Done" }));
		expect(committed.on).toEqual({ pr: ["created"], session: ["idle"] });

		await user.click(screen.getByRole("button", { name: "open settings" }));
		await user.click(screen.getByRole("button", { name: "created" }));
		await user.click(screen.getByRole("button", { name: "idle" }));
		await user.click(screen.getByRole("button", { name: "Done" }));
		// An emptied block round-trips as absent, not as an empty mapping.
		expect(committed.on).toBeUndefined();
	});

	it("binds the concurrency block, keeping an explicit false", async () => {
		const user = userEvent.setup();
		render(<Harness initial={baseDraft()} />);

		await chooseOption(screen.getByRole("combobox", { name: "Concurrency scope" }), "pr");
		await user.type(screen.getByRole("textbox", { name: "Concurrency group" }), "review");
		await user.click(screen.getByRole("switch", { name: "Cancel in progress" }));
		await user.click(screen.getByRole("button", { name: "Done" }));
		expect(committed.concurrency).toEqual({ scope: "pr", group: "review", cancelInProgress: true });

		await user.click(screen.getByRole("button", { name: "open settings" }));
		await user.click(screen.getByRole("switch", { name: "Cancel in progress" }));
		await user.click(screen.getByRole("button", { name: "Done" }));
		expect(committed.concurrency).toEqual({ scope: "pr", group: "review", cancelInProgress: false });
	});

	it("binds the defaults block from the draft's stage ids", async () => {
		const user = userEvent.setup();
		render(<Harness initial={baseDraft()} />);

		await user.type(screen.getByRole("textbox", { name: "Default deadline" }), "45m");
		await chooseOption(screen.getByRole("combobox", { name: "Default on failure" }), "notify-failure");
		await user.click(screen.getByRole("button", { name: "Done" }));
		expect(committed.defaults).toEqual({ deadline: "45m", onFailure: "notify-failure" });
	});

	it("keeps an untouched draft unchanged", async () => {
		const user = userEvent.setup();
		render(<Harness initial={baseDraft()} />);

		await user.click(screen.getByRole("button", { name: "Done" }));
		expect(committed).toEqual(baseDraft());
	});

	it("discards edits on Cancel and reseeds on reopen", async () => {
		const user = userEvent.setup();
		render(<Harness initial={baseDraft()} />);

		const name = screen.getByRole("textbox", { name: "Pipeline name" });
		await user.clear(name);
		await user.type(name, "scrapped");
		await user.click(screen.getByRole("button", { name: "Cancel" }));

		expect(committed).toEqual(baseDraft());
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "open settings" }));
		expect(screen.getByRole("textbox", { name: "Pipeline name" })).toHaveValue("pr-review");
	});
});
