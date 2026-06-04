import "server-only";

import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

import {
  asRunId,
  asStageRunId,
  createPipelineStore,
  getProjectPipelinesDir,
  hydrateEngineState,
  loopKey,
  isTerminalLoopState,
  reduce,
  type Agent,
  type ArtifactId,
  type ArtifactStatus,
  type FollowUpContext,
  type LoopStateName,
  type PipelineEffect,
  type PipelineEvent,
  type PipelineStore,
  type PluginRegistry,
  type ProjectConfig,
  type RunId,
  type RunState,
  type Session,
  type StageRunId,
  type ThreadMessage,
} from "@aoagents/ao-core";

import { getServices } from "@/lib/services";

/**
 * Error thrown when a follow-up is requested but the linked worker workspace
 * no longer exists. The dashboard surfaces this as HTTP 410 `ReviewerWorkspaceGone`
 * per the v2 spec — there is NO project-root fallback.
 */
export class ReviewerWorkspaceGoneError extends Error {
  constructor(workspacePath: string) {
    super(`Reviewer workspace no longer exists: ${workspacePath}`);
    this.name = "ReviewerWorkspaceGone";
  }
}

/** Resolve the per-project pipeline store. */
export function getPipelineStore(projectId: string): PipelineStore {
  return createPipelineStore(getProjectPipelinesDir(projectId));
}

interface PipelineActionDeps {
  store: PipelineStore;
  registry: PluginRegistry;
  projects: Record<string, ProjectConfig>;
  sessionManager: Awaited<ReturnType<typeof getServices>>["sessionManager"];
  now?: () => number;
}

/**
 * Apply a single pipeline event in the web process. Mirrors the CLI's
 * one-shot `applyEvent`: the running `ao start` process owns the real engine,
 * but read+write actions from the dashboard (dismiss / reopen / cancel /
 * resume / follow-up) persist through the same reducer surface so artifacts
 * and threads stay consistent.
 *
 * Effects executed here:
 *  - persistence (PERSIST_RUN, PERSIST_LOOP_STATE, APPEND_ARTIFACTS,
 *    UPDATE_ARTIFACT_STATUS, APPEND_THREAD_MESSAGE) — straight store writes
 *  - SEND_FOLLOWUP — resolves the agent plugin and calls
 *    `sendFollowUpToTask` against the linked worker session
 *  - START_STAGE / CANCEL_STAGE — no-ops in the web path; the running CLI
 *    engine handles them when it next ticks. The CLI's pipeline-service
 *    warns about the same gap.
 *  - EMIT_OBSERVATION — no-op (web has no observation router today).
 */
export async function applyPipelineEvent(
  event: PipelineEvent,
  deps: PipelineActionDeps,
): Promise<void> {
  const { store, registry, projects, sessionManager, now = Date.now } = deps;
  const state = hydrateEngineState(store);
  const result = reduce(state, event);

  for (const effect of result.effects) {
    await persistEffect(effect, { store, registry, projects, sessionManager, now });
  }
}

async function persistEffect(
  effect: PipelineEffect,
  deps: PipelineActionDeps,
): Promise<void> {
  const { store, now = Date.now } = deps;
  switch (effect.type) {
    case "PERSIST_RUN":
      store.saveRun(effect.runState);
      for (const [stageName, stageState] of Object.entries(effect.runState.stages)) {
        store.saveStage({ ...stageState, runId: effect.runState.runId, stageName });
      }
      return;
    case "PERSIST_LOOP_STATE":
      store.saveLoopState(effect.runId, effect.loopState);
      return;
    case "APPEND_ARTIFACTS":
      store.appendArtifacts(effect.runId, effect.stageRunId, effect.artifacts);
      return;
    case "UPDATE_ARTIFACT_STATUS":
      store.updateArtifactStatus(effect.runId, effect.stageRunId, effect.artifactId, effect.status);
      return;
    case "APPEND_THREAD_MESSAGE":
      store.appendThreadMessage(effect.runId, effect.stageRunId, {
        role: effect.role,
        content: effect.content,
        ts: new Date(now()).toISOString(),
        ...(effect.reviewerId ? { reviewerId: effect.reviewerId } : {}),
      });
      return;
    case "SEND_FOLLOWUP":
      await deliverFollowUp(effect, deps);
      return;
    case "START_STAGE":
    case "CANCEL_STAGE":
    case "EMIT_OBSERVATION":
      // The running CLI engine owns stage lifecycle; dashboard mutations
      // don't reach into it. Observations are also not routed in the web.
      return;
  }
}

async function deliverFollowUp(
  effect: Extract<PipelineEffect, { type: "SEND_FOLLOWUP" }>,
  deps: PipelineActionDeps,
): Promise<void> {
  const { store, registry, projects, sessionManager } = deps;
  const session = await resolveSession(effect.sessionId, sessionManager);
  if (!session) {
    throw new Error(`Worker session not found: ${effect.sessionId}`);
  }
  const workspacePath = session.workspacePath;
  if (!workspacePath || !existsSync(workspacePath)) {
    throw new ReviewerWorkspaceGoneError(workspacePath ?? "<unset>");
  }
  const project = projects[session.projectId];
  if (!project) {
    throw new Error(`Project not found for session: ${session.id}`);
  }
  const agent = resolveAgentForProject(registry, project);
  if (!agent?.sendFollowUpToTask) {
    throw new Error(`Agent "${agent?.name ?? "?"}" does not implement sendFollowUpToTask`);
  }

  const run = store.loadRun(effect.runId);
  const stage = run?.stages[effect.stageName];

  const ctx: FollowUpContext = {
    sessionId: session.id,
    workspacePath,
    pipelineRunId: effect.runId,
    stageRunId: effect.stageRunId,
    pipelineName: run?.pipelineName ?? "",
    stageName: effect.stageName,
  };
  // The reducer already persisted the user message and emitted the observation.
  // Best-effort guard so the engine doesn't double-throw if the stage is gone.
  if (!stage) {
    throw new Error(`Stage "${effect.stageName}" not in run ${effect.runId}`);
  }

  const result = await agent.sendFollowUpToTask(ctx, effect.message);
  if (result.reply && result.reply.length > 0) {
    store.appendThreadMessage(effect.runId, effect.stageRunId, {
      role: "agent",
      content: result.reply,
      ts: new Date(Date.now()).toISOString(),
    });
  }
}

async function resolveSession(
  sessionId: string,
  sessionManager: PipelineActionDeps["sessionManager"],
): Promise<Session | null> {
  const all = await sessionManager.list();
  return all.find((s) => s.id === sessionId) ?? null;
}

function resolveAgentForProject(
  registry: PluginRegistry,
  project: ProjectConfig,
): Agent | null {
  const name = project.agent ?? "claude-code";
  try {
    return registry.get<Agent>("agent", name);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// High-level helpers used by the API routes
// ---------------------------------------------------------------------------

export async function dismissArtifact(input: {
  projectId: string;
  runId: RunId;
  stageRunId: StageRunId;
  artifactId: ArtifactId;
  actor?: string;
}): Promise<void> {
  return mutateArtifactStatus({ ...input, status: "dismissed" });
}

export async function reopenArtifact(input: {
  projectId: string;
  runId: RunId;
  stageRunId: StageRunId;
  artifactId: ArtifactId;
  actor?: string;
}): Promise<void> {
  return mutateArtifactStatus({ ...input, status: "open" });
}

export async function markArtifactSent(input: {
  projectId: string;
  runId: RunId;
  stageRunId: StageRunId;
  artifactId: ArtifactId;
}): Promise<void> {
  return mutateArtifactStatus({ ...input, status: "sent_to_agent" });
}

async function mutateArtifactStatus(input: {
  projectId: string;
  runId: RunId;
  stageRunId: StageRunId;
  artifactId: ArtifactId;
  status: ArtifactStatus;
  actor?: string;
}): Promise<void> {
  const { config, registry, sessionManager } = await getServices();
  const store = getPipelineStore(input.projectId);
  await applyPipelineEvent(
    {
      type: "ARTIFACT_STATUS_CHANGED",
      now: Date.now(),
      runId: input.runId,
      stageRunId: input.stageRunId,
      artifactId: input.artifactId,
      status: input.status,
      ...(input.actor ? { actor: input.actor } : {}),
    },
    { store, registry, projects: config.projects, sessionManager },
  );
}

export interface SendFollowUpInput {
  projectId: string;
  runId: RunId;
  stageRunId: StageRunId;
  stageName: string;
  message: string;
  reviewerId?: string;
}

export async function sendFollowUp(input: SendFollowUpInput): Promise<void> {
  const { config, registry, sessionManager } = await getServices();
  const store = getPipelineStore(input.projectId);
  await applyPipelineEvent(
    {
      type: "USER_FOLLOWUP",
      now: Date.now(),
      runId: input.runId,
      stageRunId: input.stageRunId,
      stageName: input.stageName,
      message: input.message,
      ...(input.reviewerId ? { reviewerId: input.reviewerId } : {}),
    },
    { store, registry, projects: config.projects, sessionManager },
  );
}

export interface CancelRunInput {
  projectId: string;
  runId: RunId;
}

export async function cancelRun(input: CancelRunInput): Promise<RunState | null> {
  const { config, registry, sessionManager } = await getServices();
  const store = getPipelineStore(input.projectId);
  const run = store.loadRun(input.runId);
  if (!run) return null;
  if (isTerminalLoopState(run.loopState)) return run;
  await applyPipelineEvent(
    {
      type: "RUN_CANCELLED",
      now: Date.now(),
      runId: input.runId,
      reason: "manual_cancel",
    },
    { store, registry, projects: config.projects, sessionManager },
  );
  return store.loadRun(input.runId);
}

export interface ResumeRunInput {
  projectId: string;
  runId: RunId;
}

export async function resumeRun(input: ResumeRunInput): Promise<RunState | null> {
  const { config, registry, sessionManager } = await getServices();
  const store = getPipelineStore(input.projectId);
  const run = store.loadRun(input.runId);
  if (!run) return null;

  const candidateStageNames = Object.entries(run.stages)
    .filter(([, s]) => s.status === "failed" || s.status === "outdated")
    .map(([name]) => name);
  if (candidateStageNames.length === 0) return run;

  const stageRunIds: Record<string, StageRunId> = {};
  for (const name of candidateStageNames) {
    stageRunIds[name] = asStageRunId(`sr-${randomUUID()}`);
  }

  await applyPipelineEvent(
    {
      type: "RUN_RESUMED",
      now: Date.now(),
      runId: input.runId,
      stageRunIds,
    },
    { store, registry, projects: config.projects, sessionManager },
  );
  return store.loadRun(input.runId);
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export interface RunSummaryView {
  runId: RunId;
  pipelineId: string;
  pipelineName: string;
  sessionId: string;
  projectId: string;
  loopState: LoopStateName;
  loopRounds: number;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  stageCount: number;
  stageStatuses: Record<string, string>;
  hasOpenFindings: boolean;
}

/**
 * List all pipeline runs across configured projects. Pure read — no engine
 * dispatch. The CLI's `ao start` is the source of truth for engine state;
 * this just walks the persistent flat-file store under each project.
 */
export async function listRunsAcrossProjects(filterProjectId?: string): Promise<{
  runs: RunSummaryView[];
}> {
  const { config } = await getServices();
  const out: RunSummaryView[] = [];

  const projectIds = filterProjectId
    ? config.projects[filterProjectId]
      ? [filterProjectId]
      : []
    : Object.keys(config.projects);

  for (const projectId of projectIds) {
    let runs: RunState[] = [];
    try {
      runs = getPipelineStore(projectId).listRuns();
    } catch {
      continue;
    }
    for (const run of runs) {
      const stageStatuses: Record<string, string> = {};
      for (const [name, s] of Object.entries(run.stages)) stageStatuses[name] = s.status;
      const hasOpenFindings = (run.findings ?? []).some(
        (a) => a.kind === "finding" && a.status === "open",
      );
      out.push({
        runId: run.runId,
        pipelineId: run.pipelineId,
        pipelineName: run.pipelineName,
        sessionId: run.sessionId,
        projectId,
        loopState: run.loopState,
        loopRounds: run.loopRounds,
        headSha: run.headSha,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        stageCount: Object.keys(run.stages).length,
        stageStatuses,
        hasOpenFindings,
      });
    }
  }

  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { runs: out };
}

export interface StageView {
  stageName: string;
  stageRunId: StageRunId;
  status: string;
  attempt: number;
  verdict?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  artifacts: Array<{
    artifactId: ArtifactId;
    kind: string;
    status: ArtifactStatus;
    [k: string]: unknown;
  }>;
}

export interface RunDetailView extends RunSummaryView {
  stages: StageView[];
  /** Per-stage thread message counts. */
  threadCounts: Record<string, number>;
}

export async function describeRunWithStages(
  projectId: string,
  runId: RunId,
): Promise<RunDetailView | null> {
  const store = getPipelineStore(projectId);
  const run = store.loadRun(runId);
  if (!run) return null;

  const stages: StageView[] = [];
  const threadCounts: Record<string, number> = {};
  for (const [stageName, s] of Object.entries(run.stages)) {
    const artifacts = store.listArtifacts(runId, s.stageRunId);
    const view: StageView = {
      stageName,
      stageRunId: s.stageRunId,
      status: s.status,
      attempt: s.attempt,
      ...(s.verdict ? { verdict: s.verdict } : {}),
      ...(s.startedAt ? { startedAt: s.startedAt } : {}),
      ...(s.completedAt ? { completedAt: s.completedAt } : {}),
      ...(s.errorMessage ? { errorMessage: s.errorMessage } : {}),
      artifacts: artifacts.map((a) => ({
        ...a,
        artifactId: a.artifactId,
        kind: a.kind,
        status: a.status,
      })),
    };
    stages.push(view);
    threadCounts[stageName] = store.listThreadMessages(runId, s.stageRunId).length;
  }

  const stageStatuses: Record<string, string> = {};
  for (const [name, s] of Object.entries(run.stages)) stageStatuses[name] = s.status;
  const hasOpenFindings = (run.findings ?? []).some(
    (a) => a.kind === "finding" && a.status === "open",
  );

  return {
    runId: run.runId,
    pipelineId: run.pipelineId,
    pipelineName: run.pipelineName,
    sessionId: run.sessionId,
    projectId,
    loopState: run.loopState,
    loopRounds: run.loopRounds,
    headSha: run.headSha,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    stageCount: Object.keys(run.stages).length,
    stageStatuses,
    hasOpenFindings,
    stages,
    threadCounts,
  };
}

export async function listThread(
  projectId: string,
  runId: RunId,
  stageRunId: StageRunId,
): Promise<ThreadMessage[]> {
  return getPipelineStore(projectId).listThreadMessages(runId, stageRunId);
}

/**
 * Make a human-readable reviewer id surface label. Storage keeps the opaque
 * stageRunId as the primary key; this is the dashboard-only display id.
 */
export function makeReviewerId(sessionPrefix: string, n: number): string {
  return `${sessionPrefix}-rev-${n}`;
}

// Re-export so route handlers can branded-cast user input
export { asRunId, asStageRunId, loopKey };
