import { type NextRequest } from "next/server";

import { getCorrelationId, jsonWithCorrelation } from "@/lib/observability";
import { asRunId, describeRunWithStages, listRunsAcrossProjects } from "@/lib/pipelines";

/**
 * GET /api/pipelines/runs/:runId — full run detail with stages, artifacts,
 * and per-stage thread counts. `?project=` is required for direct lookup,
 * but if omitted we fall back to scanning each project until the runId
 * resolves (one read per project — cheap because the store lists each
 * directory once).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const correlationId = getCorrelationId(request);
  const { runId: runIdStr } = await params;
  const runId = asRunId(runIdStr);
  const { searchParams } = new URL(request.url);
  const project = searchParams.get("project");

  try {
    if (project) {
      const detail = await describeRunWithStages(project, runId);
      if (!detail) {
        return jsonWithCorrelation({ error: "Run not found" }, { status: 404 }, correlationId);
      }
      return jsonWithCorrelation({ run: detail }, { status: 200 }, correlationId);
    }

    // No project filter — search every project.
    const { runs } = await listRunsAcrossProjects();
    const summary = runs.find((r) => r.runId === runId);
    if (!summary) {
      return jsonWithCorrelation({ error: "Run not found" }, { status: 404 }, correlationId);
    }
    const detail = await describeRunWithStages(summary.projectId, runId);
    if (!detail) {
      return jsonWithCorrelation({ error: "Run not found" }, { status: 404 }, correlationId);
    }
    return jsonWithCorrelation({ run: detail }, { status: 200 }, correlationId);
  } catch (err) {
    return jsonWithCorrelation(
      { error: err instanceof Error ? err.message : "Failed to load run" },
      { status: 500 },
      correlationId,
    );
  }
}
