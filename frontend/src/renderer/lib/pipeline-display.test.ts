import { describe, expect, it } from "vitest";
import { SETTLED_OUTCOMES, type StageOutcome } from "./pipeline-draft";
import {
	KANBAN_COLUMNS,
	runStatusOf,
	runStatusTone,
	stageOutcomeDotTone,
	stageOutcomeLabel,
	stageOutcomesOf,
	shortSha,
} from "./pipeline-display";

const ALL_OUTCOMES: StageOutcome[] = ["pending", "running", ...SETTLED_OUTCOMES];

describe("KANBAN_COLUMNS", () => {
	it("is the five D11 run statuses in lifecycle order, with pending labelled Queued", () => {
		expect(KANBAN_COLUMNS.map((col) => col.status)).toEqual(["pending", "running", "succeeded", "failed", "cancelled"]);
		expect(KANBAN_COLUMNS[0].title).toBe("Queued");
	});

	it("gives every column a title, a description and a left-border tone", () => {
		for (const col of KANBAN_COLUMNS) {
			expect(col.title).not.toBe("");
			expect(col.description).not.toBe("");
			expect(col.borderClass).toMatch(/^border-l-/);
		}
	});
});

describe("runStatusTone", () => {
	it("tones each status apart: accent running, success, error, muted cancelled, neutral pending", () => {
		expect(runStatusTone("running")).toContain("text-accent");
		expect(runStatusTone("succeeded")).toContain("text-success");
		expect(runStatusTone("failed")).toContain("text-error");
		expect(runStatusTone("cancelled")).toContain("text-passive");
		expect(runStatusTone("pending")).toContain("text-muted-foreground");
	});
});

describe("stageOutcomeDotTone", () => {
	it("keeps succeeded_unverified in the success family but hollow, not filled", () => {
		expect(stageOutcomeDotTone("succeeded")).toContain("bg-success");
		const unverified = stageOutcomeDotTone("succeeded_unverified");
		expect(unverified).toContain("border-success");
		expect(unverified).not.toContain("bg-success");
		expect(unverified).not.toBe(stageOutcomeDotTone("succeeded"));
	});

	it("groups failed with timed_out, no_output with no_signal, cancelled with skipped", () => {
		expect(stageOutcomeDotTone("timed_out")).toBe(stageOutcomeDotTone("failed"));
		expect(stageOutcomeDotTone("failed")).toContain("bg-error");
		expect(stageOutcomeDotTone("no_signal")).toBe(stageOutcomeDotTone("no_output"));
		expect(stageOutcomeDotTone("no_output")).toContain("bg-warning");
		expect(stageOutcomeDotTone("skipped")).toBe(stageOutcomeDotTone("cancelled"));
		expect(stageOutcomeDotTone("cancelled")).toContain("bg-passive");
	});

	it("pulses running on the accent and leaves pending neutral", () => {
		expect(stageOutcomeDotTone("running")).toContain("bg-accent");
		expect(stageOutcomeDotTone("running")).toContain("animate-pulse");
		expect(stageOutcomeDotTone("pending")).toContain("bg-muted-foreground");
	});

	it("does not collapse the eight settled outcomes into pass/fail", () => {
		const tones = new Set(SETTLED_OUTCOMES.map(stageOutcomeDotTone));
		// succeeded, succeeded_unverified, failed/timed_out, no_output/no_signal,
		// cancelled/skipped: five looks for eight outcomes, not two.
		expect(tones.size).toBe(5);
	});

	it("has a tone and a label for every outcome in the union", () => {
		for (const outcome of ALL_OUTCOMES) {
			expect(stageOutcomeDotTone(outcome)).not.toBe("");
			expect(stageOutcomeLabel(outcome)).not.toBe("");
		}
		expect(stageOutcomeLabel("succeeded_unverified")).toBe("succeeded (unverified)");
	});
});

describe("runStatusOf", () => {
	it("prefers the v2 status field", () => {
		expect(runStatusOf({ status: "succeeded", loopState: "stalled" })).toBe("succeeded");
	});

	it("falls back to the v1 loop state until the API regen lands", () => {
		expect(runStatusOf({ loopState: "running" })).toBe("running");
		expect(runStatusOf({ loopState: "awaiting_context" })).toBe("running");
		expect(runStatusOf({ loopState: "done" })).toBe("succeeded");
		expect(runStatusOf({ loopState: "stalled" })).toBe("failed");
		expect(runStatusOf({ loopState: "terminated" })).toBe("cancelled");
	});

	it("reads an unknown or missing status as pending rather than dropping the run", () => {
		expect(runStatusOf({})).toBe("pending");
		expect(runStatusOf({ status: "exploded" })).toBe("pending");
		expect(runStatusOf({ loopState: "who_knows" })).toBe("pending");
	});
});

describe("stageOutcomesOf", () => {
	it("prefers stageOutcomes and falls back to the v1 stageStatuses map", () => {
		expect(stageOutcomesOf({ stageOutcomes: { lint: "succeeded_unverified" } })).toEqual({
			lint: "succeeded_unverified",
		});
		expect(stageOutcomesOf({ stageStatuses: { lint: "running" } })).toEqual({ lint: "running" });
		expect(stageOutcomesOf({ stageStatuses: null })).toEqual({});
		expect(stageOutcomesOf({})).toEqual({});
	});
});

describe("shortSha", () => {
	it("clips to twelve characters", () => {
		expect(shortSha("abcdef1234567890")).toBe("abcdef123456");
		expect(shortSha("abcdef")).toBe("abcdef");
	});
});
