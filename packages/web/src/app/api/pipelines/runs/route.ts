import { type NextRequest } from "next/server";

import { getCorrelationId, jsonWithCorrelation } from "@/lib/observability";
import { listRunsAcrossProjects } from "@/lib/pipelines";

/** GET /api/pipelines/runs — list pipeline runs (optionally scoped by ?project=). */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  const { searchParams } = new URL(request.url);
  const projectFilter = searchParams.get("project") ?? undefined;
  try {
    const { runs } = await listRunsAcrossProjects(
      projectFilter && projectFilter !== "all" ? projectFilter : undefined,
    );
    return jsonWithCorrelation({ runs }, { status: 200 }, correlationId);
  } catch (err) {
    return jsonWithCorrelation(
      { error: err instanceof Error ? err.message : "Failed to list pipeline runs" },
      { status: 500 },
      correlationId,
    );
  }
}
