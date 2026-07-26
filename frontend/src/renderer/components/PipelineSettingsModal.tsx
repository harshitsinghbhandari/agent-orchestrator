import { useEffect, useState } from "react";
import {
	ALL_CONCURRENCY_SCOPES,
	ALL_PR_EVENTS,
	ALL_SESSION_EVENTS,
	type ConcurrencyScope,
	type PipelineDraft,
	type PREvent,
	type SessionEvent,
} from "../lib/pipeline-draft";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";

// PipelineSettingsModal edits the pipeline-level draft fields (mockup 1b top):
// name, the `on:` triggers, the concurrency block, and the defaults block.
// Edits stay local until Done, which hands the caller the updated draft to
// commit through usePipelineDraft's setDraft; Cancel (or dismissing) discards
// them.
//
// ponytail: this is the v2 stub, not the v2 settings modal. It edits every v2
// key but carries none of the §10 guidance copy (cancel-in-progress for
// pr.updated vs release pipelines, the subject-default scope hint). Task 22
// owns the real rewrite.

export interface PipelineSettingsModalProps {
	open: boolean;
	value: PipelineDraft;
	onCancel: () => void;
	onDone: (value: PipelineDraft) => void;
}

export function PipelineSettingsModal({ open, value, onCancel, onDone }: PipelineSettingsModalProps) {
	const [draft, setDraft] = useState<PipelineDraft>(value);

	// Reseed the local draft each time the modal opens; edits while open stay
	// local until Done.
	useEffect(() => {
		if (open) setDraft(value);
	}, [open, value]);

	const stageIds = draft.stages.map((s) => s.id).filter(Boolean);

	// An empty `on`/`concurrency`/`defaults` block round-trips as absent rather
	// than as an empty mapping, matching the codec's pruning.
	const patchBlock = <K extends "on" | "concurrency" | "defaults">(key: K, patch: Partial<PipelineDraft[K]>) => {
		const merged = { ...draft[key], ...patch } as Record<string, unknown>;
		for (const [k, v] of Object.entries(merged)) {
			if (v === undefined || (Array.isArray(v) && v.length === 0)) delete merged[k];
		}
		const next = { ...draft };
		if (Object.keys(merged).length > 0) next[key] = merged as PipelineDraft[K];
		else delete next[key];
		setDraft(next);
	};

	const togglePREvent = (event: PREvent) => {
		const on = draft.on?.pr ?? [];
		patchBlock("on", { pr: on.includes(event) ? on.filter((e) => e !== event) : [...on, event] });
	};

	const toggleSessionEvent = (event: SessionEvent) => {
		const on = draft.on?.session ?? [];
		patchBlock("on", { session: on.includes(event) ? on.filter((e) => e !== event) : [...on, event] });
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
			<DialogContent showCloseButton={false} aria-describedby={undefined} className="max-w-3xl">
				<DialogHeader className="flex-row items-center justify-between">
					<div className="min-w-0">
						<DialogTitle>Pipeline settings</DialogTitle>
						<p className="mt-0.5 truncate text-caption text-passive">
							{draft.name || "untitled"} · triggers, concurrency, and stage defaults
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<Button variant="outline" size="sm" onClick={onCancel}>
							Cancel
						</Button>
						<Button size="sm" onClick={() => onDone(draft)}>
							Done
						</Button>
					</div>
				</DialogHeader>

				<div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
					<label className="flex flex-col gap-1.5">
						<FieldLabel>Name</FieldLabel>
						<Input
							aria-label="Pipeline name"
							value={draft.name}
							onChange={(e) => setDraft({ ...draft, name: e.target.value })}
						/>
					</label>

					<div className="flex flex-col gap-2">
						<FieldLabel>Triggers</FieldLabel>
						<div className="flex flex-col gap-2">
							<EventRow
								caption="on.pr"
								events={ALL_PR_EVENTS}
								active={draft.on?.pr ?? []}
								onToggle={(e) => togglePREvent(e as PREvent)}
							/>
							<EventRow
								caption="on.session"
								events={ALL_SESSION_EVENTS}
								active={draft.on?.session ?? []}
								onToggle={(e) => toggleSessionEvent(e as SessionEvent)}
							/>
						</div>
						{!draft.on?.pr?.length && !draft.on?.session?.length && (
							<span className="text-caption text-passive">No triggers: the pipeline runs only when started by hand.</span>
						)}
					</div>

					<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
						<div className="flex flex-col gap-1.5">
							<FieldLabel>Concurrency scope</FieldLabel>
							<Select
								value={draft.concurrency?.scope ?? "__subject"}
								onValueChange={(scope) =>
									patchBlock("concurrency", {
										scope: scope === "__subject" ? undefined : (scope as ConcurrencyScope),
									})
								}
							>
								<SelectTrigger size="sm" aria-label="Concurrency scope" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="__subject">Subject default</SelectItem>
									{ALL_CONCURRENCY_SCOPES.map((scope) => (
										<SelectItem key={scope} value={scope}>
											{scope}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<label className="flex flex-col gap-1.5">
							<FieldLabel>Concurrency group</FieldLabel>
							<Input
								aria-label="Concurrency group"
								value={draft.concurrency?.group ?? ""}
								onChange={(e) => patchBlock("concurrency", { group: e.target.value || undefined })}
								placeholder={draft.name || "(pipeline name)"}
							/>
						</label>

						<div className="flex flex-col gap-1.5">
							<FieldLabel>Cancel in progress</FieldLabel>
							<div className="flex h-control-form items-center gap-2 rounded-md border border-border bg-surface px-2.5">
								<Switch
									aria-label="Cancel in progress"
									checked={draft.concurrency?.cancelInProgress ?? false}
									onCheckedChange={(checked) => patchBlock("concurrency", { cancelInProgress: checked })}
								/>
								<span className="text-xs text-muted-foreground">
									{draft.concurrency?.cancelInProgress ? "On" : "Off"}
								</span>
							</div>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<label className="flex flex-col gap-1.5">
							<FieldLabel>Default deadline</FieldLabel>
							<Input
								aria-label="Default deadline"
								value={draft.defaults?.deadline ?? ""}
								onChange={(e) => patchBlock("defaults", { deadline: e.target.value || undefined })}
								placeholder="30m"
							/>
						</label>

						<div className="flex flex-col gap-1.5">
							<FieldLabel>Default on failure</FieldLabel>
							<Select
								value={draft.defaults?.onFailure ?? "__none"}
								onValueChange={(id) => patchBlock("defaults", { onFailure: id === "__none" ? undefined : id })}
							>
								<SelectTrigger size="sm" aria-label="Default on failure" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="__none">None</SelectItem>
									{stageIds.map((id) => (
										<SelectItem key={id} value={id}>
											{id}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function EventRow({
	caption,
	events,
	active,
	onToggle,
}: {
	caption: string;
	events: readonly string[];
	active: readonly string[];
	onToggle: (event: string) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<span className="w-24 shrink-0 font-mono text-micro text-passive">{caption}</span>
			{events.map((event) => {
				const on = active.includes(event);
				return (
					<button
						key={event}
						type="button"
						aria-pressed={on}
						onClick={() => onToggle(event)}
						className={cn(
							"rounded-md border px-2 py-0.5 font-mono text-caption transition-colors",
							on
								? "border-accent-dim bg-accent-weak text-accent"
								: "border-border bg-raised text-muted-foreground hover:text-foreground",
						)}
					>
						{event}
					</button>
				);
			})}
		</div>
	);
}

function FieldLabel({ children }: { children: React.ReactNode }) {
	return <span className="font-mono text-micro font-medium uppercase tracking-wide text-passive">{children}</span>;
}
