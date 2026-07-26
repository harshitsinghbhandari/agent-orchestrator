import { Trash2, X } from "lucide-react";
import { cn } from "../lib/utils";
import { AGENT_OPTIONS } from "../lib/agent-options";
import {
	ALL_EXECUTOR_KINDS,
	ALL_WORKSPACE_KINDS,
	SETTLED_OUTCOMES,
	type ExecutorKind,
	type StageDraft,
	type StageOutcome,
	type WorkspaceKind,
} from "../lib/pipeline-draft";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";

// The stage inspector (mockup 1a, right panel): a form two-way bound to the
// selected StageDraft. Every edit calls onChange with the next stage; the
// editor area owns the draft (usePipelineDraft) and the selection
// (useStageSelection), so this component stays a pure controlled form.
//
// `needs` is not editable here: the graph lib maintains it from the inbound
// success edges (spec §9.2), so it renders read-only.
//
// ponytail: this is the v2 stub, not the v2 inspector. It covers every v2 key
// but skips the warning states (workspace: session under a pr.* trigger,
// produces filename validation) and the DESIGN.md polish pass. Task 21 owns
// the real rewrite.

export interface StageInspectorProps {
	stage: StageDraft;
	// Every stage id in the draft; candidates for onSuccess and onFailure.
	stageIds: string[];
	onChange: (next: StageDraft) => void;
	onClose?: () => void;
	// Removes the inspected stage from the draft (the parent scrubs the routing
	// keys and clears the selection). The delete button renders only when wired.
	onDelete?: () => void;
}

const WORKSPACE_OPTIONS: { value: WorkspaceKind | "default"; label: string }[] = [
	{ value: "default", label: "Default" },
	...ALL_WORKSPACE_KINDS.map((kind) => ({ value: kind, label: kind })),
];

const EXECUTOR_SUBTITLE: Record<ExecutorKind, string> = {
	agent: "Agent executor",
	command: "Command executor",
};

// The engine kills the session on these outcomes when `session` is absent.
const DEFAULT_KILL_ON: StageOutcome[] = ["succeeded", "failed"];

export function StageInspector({ stage, stageIds, onChange, onClose, onDelete }: StageInspectorProps) {
	const update = (patch: Partial<StageDraft>) => onChange({ ...stage, ...patch });

	// Swapping executor kind drops the other kind's fields so nothing the daemon
	// rejects survives in the serialized config.
	const setExecutorKind = (executor: ExecutorKind) => {
		if (executor === stage.executor) return;
		const next: StageDraft = { ...stage, executor };
		if (executor === "agent") {
			delete next.run;
			delete next.credentials;
		} else {
			delete next.agent;
			delete next.prompt;
			delete next.produces;
			delete next.session;
		}
		onChange(next);
	};

	const onSuccess = stage.onSuccess ?? [];
	const successCandidates = stageIds.filter((id) => id !== stage.id && !onSuccess.includes(id));
	const killOn = stage.session?.killOn;

	return (
		<div
			data-testid="stage-inspector"
			className="flex h-full min-h-0 w-full flex-col overflow-y-auto border-l border-border bg-background"
		>
			<div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
				<div className="min-w-0">
					<h2 className="truncate text-control font-semibold text-foreground">Stage: {stage.id || "(unnamed)"}</h2>
					<p className="text-caption text-passive">{EXECUTOR_SUBTITLE[stage.executor]}</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{onDelete && (
						<Button
							size="icon-sm"
							variant="ghost"
							className="text-destructive hover:text-destructive"
							onClick={onDelete}
							aria-label="Delete stage"
						>
							<Trash2 className="size-icon-sm" aria-hidden="true" />
						</Button>
					)}
					{onClose && (
						<Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close inspector">
							<X className="size-icon-sm" aria-hidden="true" />
						</Button>
					)}
				</div>
			</div>

			<div className="flex flex-col gap-5 px-4 py-4">
				<Section label="Id">
					<Input
						aria-label="Stage id"
						value={stage.id}
						onChange={(e) => update({ id: e.target.value })}
						placeholder="stage-id"
					/>
				</Section>

				<Section label="Executor">
					<Segmented
						ariaLabel="Executor kind"
						options={ALL_EXECUTOR_KINDS.map((kind) => ({ value: kind, label: kind }))}
						value={stage.executor}
						onChange={setExecutorKind}
					/>
					<div className="mt-2.5">
						{stage.executor === "agent" ? (
							<AgentFields stage={stage} update={update} />
						) : (
							<CommandFields stage={stage} update={update} />
						)}
					</div>
				</Section>

				{stage.executor === "agent" && (
					<Section label="Session · kill-on">
						<div className="flex items-center justify-between gap-2">
							<span className="text-caption text-muted-foreground">Override the default</span>
							<Switch
								aria-label="Override kill-on"
								checked={killOn !== undefined}
								onCheckedChange={(on) => update({ session: on ? { killOn: DEFAULT_KILL_ON } : undefined })}
							/>
						</div>
						{killOn === undefined ? (
							<p className="mt-1.5 text-caption text-passive">
								Kills the session on {DEFAULT_KILL_ON.join(" and ")}; every other outcome keeps it for inspection.
							</p>
						) : (
							<>
								<div className="mt-2 flex flex-wrap gap-1.5">
									{SETTLED_OUTCOMES.map((outcome) => {
										const active = killOn.includes(outcome);
										return (
											<button
												key={outcome}
												type="button"
												aria-pressed={active}
												onClick={() =>
													update({
														session: {
															killOn: active ? killOn.filter((o) => o !== outcome) : [...killOn, outcome],
														},
													})
												}
												className={cn(
													"rounded-md border px-2 py-0.5 font-mono text-caption transition-colors",
													active
														? "border-accent-dim bg-accent-weak text-accent"
														: "border-border bg-raised text-muted-foreground hover:text-foreground",
												)}
											>
												{outcome}
											</button>
										);
									})}
								</div>
								{killOn.length === 0 && <p className="mt-1.5 text-caption text-passive">Never kills the session.</p>}
							</>
						)}
					</Section>
				)}

				<Section label="On success">
					<div className="flex flex-wrap gap-1.5">
						{onSuccess.map((id) => (
							<span
								key={id}
								className="inline-flex items-center gap-1 rounded-md border border-border bg-raised px-2 py-0.5 font-mono text-caption text-foreground"
							>
								{id}
								<button
									type="button"
									aria-label={`Remove successor ${id}`}
									onClick={() => {
										const next = onSuccess.filter((s) => s !== id);
										update({ onSuccess: next.length ? next : undefined });
									}}
									className="text-passive transition-colors hover:text-foreground"
								>
									<X className="size-icon-xs" aria-hidden="true" />
								</button>
							</span>
						))}
						{successCandidates.map((id) => (
							<button
								key={id}
								type="button"
								aria-label={`Add successor ${id}`}
								onClick={() => update({ onSuccess: [...onSuccess, id] })}
								className="rounded-md border border-dashed border-border px-2 py-0.5 font-mono text-caption text-passive transition-colors hover:text-foreground"
							>
								+ {id}
							</button>
						))}
						{onSuccess.length === 0 && successCandidates.length === 0 && (
							<span className="text-caption text-passive">No other stages to route to.</span>
						)}
					</div>
				</Section>

				<Section label="On failure">
					<Select
						value={stage.onFailure ?? "__default"}
						onValueChange={(id) => update({ onFailure: id === "__default" ? undefined : id })}
					>
						<SelectTrigger size="sm" aria-label="On failure" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="__default">Pipeline default</SelectItem>
							{stageIds
								.filter((id) => id && id !== stage.id)
								.map((id) => (
									<SelectItem key={id} value={id}>
										{id}
									</SelectItem>
								))}
						</SelectContent>
					</Select>
				</Section>

				<Section label="Needs">
					<div className="flex flex-wrap gap-1.5" data-testid="stage-needs">
						{(stage.needs ?? []).map((id) => (
							<span
								key={id}
								className="rounded-md border border-border bg-raised px-2 py-0.5 font-mono text-caption text-muted-foreground"
							>
								{id}
							</span>
						))}
						{(stage.needs ?? []).length === 0 && (
							<span className="text-caption text-passive">Set automatically from the inbound success edges.</span>
						)}
					</div>
				</Section>

				<Section label="Workspace">
					<Select
						value={stage.workspace ?? "default"}
						onValueChange={(value) => update({ workspace: value === "default" ? undefined : (value as WorkspaceKind) })}
					>
						<SelectTrigger size="sm" aria-label="Workspace" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{WORKSPACE_OPTIONS.map((opt) => (
								<SelectItem key={opt.value} value={opt.value}>
									{opt.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Section>

				<Section label="Deadline">
					<Input
						aria-label="Deadline"
						value={stage.deadline ?? ""}
						onChange={(e) => update({ deadline: e.target.value || undefined })}
						placeholder="(pipeline default)"
					/>
				</Section>
			</div>
		</div>
	);
}

// --- executor sub-forms ------------------------------------------------------

type FieldsProps = { stage: StageDraft; update: (patch: Partial<StageDraft>) => void };

function AgentFields({ stage, update }: FieldsProps) {
	return (
		<div className="flex flex-col gap-2.5">
			<LabeledControl label="Agent">
				<Select value={stage.agent ?? ""} onValueChange={(agent) => update({ agent })}>
					<SelectTrigger size="sm" aria-label="Agent" className="w-full">
						<SelectValue placeholder="Select agent" />
					</SelectTrigger>
					<SelectContent>
						{AGENT_OPTIONS.map((agent) => (
							<SelectItem key={agent} value={agent}>
								{agent}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</LabeledControl>
			<LabeledControl label="Prompt">
				<textarea
					aria-label="Prompt"
					className={textareaClass}
					rows={4}
					value={stage.prompt ?? ""}
					onChange={(e) => update({ prompt: e.target.value || undefined })}
					placeholder="What this stage should do."
				/>
			</LabeledControl>
			<LabeledControl label="Produces (bare filename)">
				<Input
					aria-label="Produces"
					value={stage.produces ?? ""}
					onChange={(e) => update({ produces: e.target.value || undefined })}
					placeholder="review.md"
				/>
			</LabeledControl>
		</div>
	);
}

function CommandFields({ stage, update }: FieldsProps) {
	return (
		<div className="flex flex-col gap-2.5">
			<LabeledControl label="Run">
				<textarea
					aria-label="Run"
					className={textareaClass}
					rows={4}
					value={stage.run ?? ""}
					onChange={(e) => update({ run: e.target.value || undefined })}
					placeholder="npm test"
				/>
			</LabeledControl>
			<LabeledControl label="Credentials (one name per line)">
				<textarea
					key={`credentials-${stage.id}`}
					aria-label="Credentials"
					className={textareaClass}
					rows={2}
					defaultValue={(stage.credentials ?? []).join("\n")}
					onChange={(e) => {
						const names = e.target.value
							.split("\n")
							.map((line) => line.trim())
							.filter(Boolean);
						update({ credentials: names.length ? names : undefined });
					}}
					placeholder="github-release"
				/>
			</LabeledControl>
		</div>
	);
}

// --- small building blocks ---------------------------------------------------

const textareaClass =
	"w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 font-mono text-caption leading-relaxed text-foreground outline-none transition placeholder:text-passive focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-weak";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<section>
			<h3 className="mb-1.5 font-mono text-micro font-medium uppercase tracking-wide text-passive">{label}</h3>
			{children}
		</section>
	);
}

function LabeledControl({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<span className="text-caption text-muted-foreground">{label}</span>
			{children}
		</div>
	);
}

function Segmented<T extends string>({
	ariaLabel,
	options,
	value,
	onChange,
}: {
	ariaLabel: string;
	options: { value: T; label: string }[];
	value: T;
	onChange: (next: T) => void;
}) {
	return (
		<div
			role="radiogroup"
			aria-label={ariaLabel}
			className="flex w-fit items-center rounded-md border border-border p-0.5"
		>
			{options.map((opt) => (
				<button
					key={opt.value}
					type="button"
					role="radio"
					aria-checked={value === opt.value}
					onClick={() => onChange(opt.value)}
					className={cn(
						"rounded px-2.5 py-1 text-caption font-medium transition-colors",
						value === opt.value ? "bg-accent/15 text-foreground" : "text-muted-foreground hover:text-foreground",
					)}
				>
					{opt.label}
				</button>
			))}
		</div>
	);
}
