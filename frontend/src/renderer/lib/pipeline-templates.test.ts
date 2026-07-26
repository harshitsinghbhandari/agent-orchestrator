import { describe, expect, it } from "vitest";
import {
	ALL_CONCURRENCY_SCOPES,
	ALL_EXECUTOR_KINDS,
	ALL_PR_EVENTS,
	ALL_SESSION_EVENTS,
	ALL_WORKSPACE_KINDS,
	parseYamlToDraft,
	serializeToYaml,
	SETTLED_OUTCOMES,
	type PipelineDraft,
} from "./pipeline-draft";
import { cycleStageIds } from "./pipeline-graph";
import { PIPELINE_TEMPLATES } from "./pipeline-templates";

// Templates are static config baked into the renderer, so the daemon never
// sees them until a user hits Save. This suite mirrors the edit-time rules of
// backend/internal/pipeline (spec §13) closely enough that a template violating
// them fails here instead of at /validate in front of a user.

const KNOWN_EXECUTORS = new Set<string>(ALL_EXECUTOR_KINDS);
const KNOWN_WORKSPACES = new Set<string>(ALL_WORKSPACE_KINDS);
const KNOWN_PR_EVENTS = new Set<string>(ALL_PR_EVENTS);
const KNOWN_SESSION_EVENTS = new Set<string>(ALL_SESSION_EVENTS);
const KNOWN_SCOPES = new Set<string>(ALL_CONCURRENCY_SCOPES);
const KNOWN_OUTCOMES = new Set<string>(SETTLED_OUTCOMES);

function draftViolations(draft: PipelineDraft): string[] {
	const out: string[] = [];
	if (draft.name.trim() === "") out.push("name: must not be empty");
	if (draft.stages.length === 0) out.push("stages: at least one stage required");

	const ids = draft.stages.map((s) => s.id);
	const idSet = new Set(ids);
	if (idSet.size !== ids.length) out.push("stages: duplicate stage ids");

	for (const event of draft.on?.pr ?? []) {
		if (!KNOWN_PR_EVENTS.has(event)) out.push(`on.pr: unknown event ${event}`);
	}
	for (const event of draft.on?.session ?? []) {
		if (!KNOWN_SESSION_EVENTS.has(event)) out.push(`on.session: unknown event ${event}`);
	}
	if (draft.concurrency?.scope && !KNOWN_SCOPES.has(draft.concurrency.scope)) {
		out.push(`concurrency.scope: unknown scope ${draft.concurrency.scope}`);
	}
	if (draft.defaults?.onFailure && !idSet.has(draft.defaults.onFailure)) {
		out.push(`defaults.onFailure: unknown stage ${draft.defaults.onFailure}`);
	}

	// Inbound success edges decide where `needs` is required and what it must
	// equal; failure edges are never counted (spec §9.2).
	const inboundSuccess = new Map<string, string[]>();
	for (const stage of draft.stages) {
		for (const to of stage.onSuccess ?? []) {
			inboundSuccess.set(to, [...(inboundSuccess.get(to) ?? []), stage.id]);
		}
	}

	for (const [i, stage] of draft.stages.entries()) {
		const base = `stages[${i}]`;
		if (stage.id.trim() === "") out.push(`${base}.id: must not be empty`);
		if (!KNOWN_EXECUTORS.has(stage.executor)) out.push(`${base}.executor: unknown kind ${stage.executor}`);

		if (stage.executor === "agent") {
			if (!stage.agent) out.push(`${base}.agent: required on an agent stage`);
			if (!stage.prompt) out.push(`${base}.prompt: required on an agent stage`);
			// §8: the credential tier is a schema property, not a convention.
			if (stage.credentials?.length) out.push(`${base}.credentials: forbidden on an agent stage`);
		} else {
			if (!stage.run) out.push(`${base}.run: required on a command stage`);
			if (stage.produces) out.push(`${base}.produces: forbidden on a command stage`);
		}
		if (stage.produces && /[\\/]/.test(stage.produces)) {
			out.push(`${base}.produces: must be a bare filename`);
		}
		if (stage.workspace && !KNOWN_WORKSPACES.has(stage.workspace)) {
			out.push(`${base}.workspace: unknown workspace ${stage.workspace}`);
		}
		for (const outcome of stage.session?.killOn ?? []) {
			if (!KNOWN_OUTCOMES.has(outcome)) out.push(`${base}.session.killOn: unknown outcome ${outcome}`);
		}

		for (const to of stage.onSuccess ?? []) {
			if (!idSet.has(to)) out.push(`${base}.onSuccess: unknown stage ${to}`);
		}
		if (stage.onFailure && !idSet.has(stage.onFailure)) {
			out.push(`${base}.onFailure: unknown stage ${stage.onFailure}`);
		}

		const inbound = inboundSuccess.get(stage.id) ?? [];
		const needs = stage.needs ?? [];
		for (const need of needs) {
			if (!idSet.has(need)) out.push(`${base}.needs: unknown stage ${need}`);
		}
		if (inbound.length > 1 && needs.length === 0) out.push(`${base}.needs: required, ${inbound.length} inbound edges`);
		if (needs.length > 0 && [...needs].sort().join(",") !== [...inbound].sort().join(",")) {
			out.push(`${base}.needs: does not match the inbound success edges`);
		}
		if (stage.workspace === "inherit" && inbound.length > 1) {
			out.push(`${base}.workspace: inherit needs exactly one inbound success edge`);
		}
	}

	return out;
}

describe("PIPELINE_TEMPLATES", () => {
	it("offers the three starter concepts", () => {
		expect(PIPELINE_TEMPLATES.map((t) => t.id)).toEqual(["pr-review", "session-idle-triage", "release-gate"]);
	});

	for (const template of PIPELINE_TEMPLATES) {
		describe(template.name, () => {
			it("returns a fresh draft per call", () => {
				const a = template.draft();
				const b = template.draft();
				expect(a).not.toBe(b);
				expect(a.stages).not.toBe(b.stages);
				expect(a).toEqual(b);
			});

			it("round-trips through the codec unchanged", () => {
				const draft = template.draft();
				const parsed = parseYamlToDraft(serializeToYaml(draft));
				expect(parsed.parseError).toBeUndefined();
				expect(parsed.draft).toEqual(draft);
			});

			it("passes the mirrored backend validation rules", () => {
				expect(draftViolations(template.draft())).toEqual([]);
			});

			it("has an acyclic routing graph", () => {
				expect(cycleStageIds(template.draft())).toEqual(new Set());
			});
		});
	}
});
