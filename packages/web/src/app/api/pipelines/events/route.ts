import { type NextRequest } from "next/server";

import { listRunsAcrossProjects } from "@/lib/pipelines";

/**
 * GET /api/pipelines/events — Server-Sent Events stream of pipeline runs.
 *
 * Cadence: 5s (C-14 — must match the existing dashboard polling interval).
 * Each tick emits a single `data: <json>\n\n` frame with the full run list,
 * scoped by ?project when provided.
 *
 * Why pull-based SSE rather than push? Pipeline state is persisted as
 * flat JSON files by the CLI's running engine; the dashboard process does
 * not own state, so it polls the store. This matches `useSessionEvents`'s
 * coarse 5s cadence.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectFilter = searchParams.get("project") ?? undefined;
  const project = projectFilter && projectFilter !== "all" ? projectFilter : undefined;

  const encoder = new TextEncoder();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cancelled = true;
        }
      };

      const tick = async () => {
        if (cancelled) return;
        try {
          const snapshot = await listRunsAcrossProjects(project);
          send({ kind: "snapshot", ts: Date.now(), runs: snapshot.runs });
        } catch (err) {
          send({
            kind: "error",
            ts: Date.now(),
            error: err instanceof Error ? err.message : "snapshot failed",
          });
        }
        if (cancelled) return;
        timer = setTimeout(() => void tick(), 5_000);
      };

      // Emit a hello frame so clients see the connection open immediately.
      send({ kind: "hello", ts: Date.now() });
      await tick();
    },
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
