import { type NextRequest } from "next/server";

import { getCorrelationId, jsonWithCorrelation } from "@/lib/observability";
import {
  asRunId,
  asStageRunId,
  dismissArtifact,
  reopenArtifact,
  markArtifactSent,
  listRunsAcrossProjects,
  describeRunWithStages,
} from "@/lib/pipelines";
import type { ArtifactId, ArtifactStatus } from "@aoagents/ao-core";

/**
 * PATCH /api/pipelines/runs/:runId/artifacts/:artifactId — change an
 * artifact's status. Body: `{ status: "dismissed" | "open" | "sent_to_agent",
 * stageRunId, actor? }`. Flow:
 *
 *  - `dismissed` → user-suppressed finding (Workbench dismiss button)
 *  - `open`      → reopen a previously dismissed finding
 *  - `sent_to_agent` → mark as forwarded (set by router builtin in normal
 *    pipelines; exposed here so the dashboard's manual send button stamps
 *    the same status when SCM compose dispatches a single finding)
 *
 * The request body's `stageRunId` is the artifact's parent stage run; the
 * route validates it against the persisted artifact list to refuse mismatched
 * ids. All mutations flow through `ARTIFACT_STATUS_CHANGED` engine events,
 * not direct store writes (per #198 acceptance).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; artifactId: string }> },
) {
  const correlationId = getCorrelationId(request);
  const { runId: runIdStr, artifactId } = await params;
  const runId = asRunId(runIdStr);

  let body: { status?: string; stageRunId?: string; actor?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonWithCorrelation({ error: "Invalid JSON body" }, { status: 400 }, correlationId);
  }
  const status = body.status as ArtifactStatus | undefined;
  if (status !== "dismissed" && status !== "open" && status !== "sent_to_agent") {
    return jsonWithCorrelation(
      { error: "status must be one of: dismissed, open, sent_to_agent" },
      { status: 400 },
      correlationId,
    );
  }
  if (!body.stageRunId) {
    return jsonWithCorrelation({ error: "stageRunId required" }, { status: 400 }, correlationId);
  }
  const stageRunId = asStageRunId(body.stageRunId);

  // Resolve project from the run
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

  // Validate stageRunId belongs to this run + has the artifact
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
  if (!stage.artifacts.some((a) => a.artifactId === artifactId)) {
    return jsonWithCorrelation(
      { error: "artifactId not in this stage" },
      { status: 404 },
      correlationId,
    );
  }

  try {
    const input = {
      projectId,
      runId,
      stageRunId,
      artifactId: artifactId as ArtifactId,
      ...(body.actor ? { actor: body.actor } : {}),
    };
    if (status === "dismissed") await dismissArtifact(input);
    else if (status === "open") await reopenArtifact(input);
    else await markArtifactSent(input);
    return jsonWithCorrelation({ ok: true, status }, { status: 200 }, correlationId);
  } catch (err) {
    return jsonWithCorrelation(
      { error: err instanceof Error ? err.message : "Status update failed" },
      { status: 500 },
      correlationId,
    );
  }
}
