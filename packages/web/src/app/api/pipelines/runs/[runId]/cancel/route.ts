import { type NextRequest } from "next/server";

import { getCorrelationId, jsonWithCorrelation } from "@/lib/observability";
import { asRunId, cancelRun, listRunsAcrossProjects } from "@/lib/pipelines";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const correlationId = getCorrelationId(request);
  const { runId: runIdStr } = await params;
  const runId = asRunId(runIdStr);
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
    const updated = await cancelRun({ projectId, runId });
    if (!updated) {
      return jsonWithCorrelation({ error: "Run not found" }, { status: 404 }, correlationId);
    }
    return jsonWithCorrelation({ run: updated }, { status: 200 }, correlationId);
  } catch (err) {
    return jsonWithCorrelation(
      { error: err instanceof Error ? err.message : "Cancel failed" },
      { status: 500 },
      correlationId,
    );
  }
}
