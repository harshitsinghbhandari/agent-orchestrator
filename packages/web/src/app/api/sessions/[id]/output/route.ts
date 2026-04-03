import { type NextRequest } from "next/server";
import { validateIdentifier, validateNumber } from "@/lib/validation";
import { getServices } from "@/lib/services";
import { SessionNotFoundError, type Runtime, type RuntimeHandle } from "@composio/ao-core";
import {
  getCorrelationId,
  jsonWithCorrelation,
  recordApiObservation,
  resolveProjectIdForSessionId,
} from "@/lib/observability";

const DEFAULT_LINES = 50;
const MAX_LINES = 500;

/** GET /api/sessions/:id/output — Get terminal output from a session */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  const startedAt = Date.now();
  const { id } = await params;
  const idErr = validateIdentifier(id, "id");
  if (idErr) {
    return jsonWithCorrelation({ error: idErr }, { status: 400 }, correlationId);
  }

  // Parse optional lines parameter from query string
  const { searchParams } = new URL(request.url);
  const linesParam = searchParams.get("lines");
  let lines = DEFAULT_LINES;
  if (linesParam !== null) {
    const linesErr = validateNumber(parseInt(linesParam, 10), "lines", 1, MAX_LINES);
    if (linesErr) {
      return jsonWithCorrelation({ error: linesErr }, { status: 400 }, correlationId);
    }
    lines = parseInt(linesParam, 10);
  }

  try {
    const { config, registry, sessionManager } = await getServices();
    const projectId = resolveProjectIdForSessionId(config, id);
    const session = await sessionManager.get(id);

    if (!session) {
      throw new SessionNotFoundError(id);
    }

    // Get the runtime handle from the session
    const runtimeHandle: RuntimeHandle | null = session.runtimeHandle;
    if (!runtimeHandle) {
      return jsonWithCorrelation(
        { error: "Session has no runtime handle - cannot fetch terminal output" },
        { status: 400 },
        correlationId,
      );
    }

    // Get the runtime plugin
    const project = config.projects[session.projectId];
    const runtimeName = runtimeHandle.runtimeName ?? project?.runtime ?? config.defaults.runtime;
    const runtime = registry.get<Runtime>("runtime", runtimeName);

    if (!runtime) {
      return jsonWithCorrelation(
        { error: `Runtime plugin "${runtimeName}" not found` },
        { status: 500 },
        correlationId,
      );
    }

    // Fetch terminal output
    const output = await runtime.getOutput(runtimeHandle, lines);

    recordApiObservation({
      config,
      method: "GET",
      path: "/api/sessions/[id]/output",
      correlationId,
      startedAt,
      outcome: "success",
      statusCode: 200,
      projectId,
      sessionId: id,
      data: { lines, outputLength: output.length },
    });

    return jsonWithCorrelation(
      {
        ok: true,
        sessionId: id,
        output,
        lines,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
      correlationId,
    );
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return jsonWithCorrelation({ error: err.message }, { status: 404 }, correlationId);
    }
    const { config } = await getServices().catch(() => ({ config: undefined }));
    const projectId = config ? resolveProjectIdForSessionId(config, id) : undefined;
    if (config) {
      recordApiObservation({
        config,
        method: "GET",
        path: "/api/sessions/[id]/output",
        correlationId,
        startedAt,
        outcome: "failure",
        statusCode: 500,
        projectId,
        sessionId: id,
        reason: err instanceof Error ? err.message : "Failed to get terminal output",
      });
    }
    const msg = err instanceof Error ? err.message : "Failed to get terminal output";
    return jsonWithCorrelation({ error: msg }, { status: 500 }, correlationId);
  }
}
