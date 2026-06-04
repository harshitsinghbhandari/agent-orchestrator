import { type NextRequest } from "next/server";

import { getCorrelationId, jsonWithCorrelation } from "@/lib/observability";
import {
  asRunId,
  asStageRunId,
  describeRunWithStages,
  listRunsAcrossProjects,
  listThread,
  sendFollowUp,
  ReviewerWorkspaceGoneError,
} from "@/lib/pipelines";

/** GET — list messages in the per-stage thread JSONL. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; stageRunId: string }> },
) {
  const correlationId = getCorrelationId(request);
  const { runId: runIdStr, stageRunId: stageRunIdStr } = await params;
  const runId = asRunId(runIdStr);
  const stageRunId = asStageRunId(stageRunIdStr);
  const url = new URL(request.url);
  let projectId = url.searchParams.get("project") ?? undefined;

  try {
    if (!projectId) {
      const { runs } = await listRunsAcrossProjects();
      const found = runs.find((r) => r.runId === runId);
      if (!found) {
        return jsonWithCorrelation({ error: "Run not found" }, { status: 404 }, correlationId);
      }
      projectId = found.projectId;
    }
    const messages = await listThread(projectId, runId, stageRunId);
    return jsonWithCorrelation({ messages }, { status: 200 }, correlationId);
  } catch (err) {
    return jsonWithCorrelation(
      { error: err instanceof Error ? err.message : "Failed to load thread" },
      { status: 500 },
      correlationId,
    );
  }
}

/**
 * POST — send a follow-up message into the stage's agent task. Routes through
 * `USER_FOLLOWUP` → reducer → `SEND_FOLLOWUP` → `Agent.sendFollowUpToTask`.
 *
 * Returns 410 `ReviewerWorkspaceGone` when the worker workspace is no longer
 * on disk (per the v2 spec — NO project-root fallback).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; stageRunId: string }> },
) {
  const correlationId = getCorrelationId(request);
  const { runId: runIdStr, stageRunId: stageRunIdStr } = await params;
  const runId = asRunId(runIdStr);
  const stageRunId = asStageRunId(stageRunIdStr);

  let body: { message?: string; reviewerId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonWithCorrelation({ error: "Invalid JSON body" }, { status: 400 }, correlationId);
  }
  const message = (body.message ?? "").trim();
  if (!message) {
    return jsonWithCorrelation({ error: "message is required" }, { status: 400 }, correlationId);
  }

  const url = new URL(request.url);
  let projectId = url.searchParams.get("project") ?? undefined;
  if (!projectId) {
    const { runs } = await listRunsAcrossProjects();
    const found = runs.find((r) => r.runId === runId);
    if (!found) {
      return jsonWithCorrelation({ error: "Run not found" }, { status: 404 }, correlationId);
    }
    projectId = found.projectId;
  }

  // Resolve stage name so we can dispatch USER_FOLLOWUP.
  const detail = await describeRunWithStages(projectId, runId);
  if (!detail) {
    return jsonWithCorrelation({ error: "Run not found" }, { status: 404 }, correlationId);
  }
  const stage = detail.stages.find((s) => s.stageRunId === stageRunId);
  if (!stage) {
    return jsonWithCorrelation(
      { error: "stageRunId not in this run" },
      { status: 400 },
      correlationId,
    );
  }

  try {
    await sendFollowUp({
      projectId,
      runId,
      stageRunId,
      stageName: stage.stageName,
      message,
      ...(body.reviewerId ? { reviewerId: body.reviewerId } : {}),
    });
    return jsonWithCorrelation({ ok: true }, { status: 200 }, correlationId);
  } catch (err) {
    if (err instanceof ReviewerWorkspaceGoneError) {
      return jsonWithCorrelation(
        { error: err.message, code: "ReviewerWorkspaceGone" },
        { status: 410 },
        correlationId,
      );
    }
    return jsonWithCorrelation(
      { error: err instanceof Error ? err.message : "Follow-up failed" },
      { status: 500 },
      correlationId,
    );
  }
}
