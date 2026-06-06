import {
  createCorrelationId,
  createProjectObserver,
  recordActivityEvent,
  type LifecycleManager,
  type OrchestratorConfig,
  type PipelineEngine,
} from "@aoagents/ao-core";
import { getLifecycleManager } from "./create-session-manager.js";

const DEFAULT_INTERVAL_MS = 30_000;

interface ActiveLoop {
  lifecycle: LifecycleManager;
  pipelineEngine: PipelineEngine | null;
  /** Synchronous teardown (stops the lifecycle poll timer). */
  stop: () => void;
  /** Async drain — cancels in-flight pipeline runs and persists state. */
  drainPipelineEngine: () => Promise<void>;
}

const active = new Map<string, ActiveLoop>();
/**
 * Promises for in-flight pipeline drains kicked off by `stopLifecycleWorker`.
 * Held so `drainAllLifecycleWorkerPipelines()` can `await` drains that were
 * started before the shutdown handler began awaiting — i.e. ones that were
 * fire-and-forgot from a synchronous `stopAllLifecycleWorkers()` call earlier
 * in the same tick.
 */
const pendingDrains = new Set<Promise<void>>();

// Note: no SIGINT/SIGTERM listeners are installed here. Adding a listener for
// those signals removes Node.js's default "exit on signal" behavior, which
// would leave `ao start` hanging when `ao stop` sends SIGTERM (the setInterval
// keeps the event loop alive forever). Default signal handling terminates the
// process cleanly; the OS reclaims the interval timer. Callers that need to
// flush state explicitly before exit can call `stopAllLifecycleWorkers()`.

export interface LifecycleWorkerStatus {
  running: boolean;
  started: boolean;
}

export async function ensureLifecycleWorker(
  config: OrchestratorConfig,
  projectId: string,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): Promise<LifecycleWorkerStatus> {
  if (!config.projects[projectId]) {
    throw new Error(`Unknown project: ${projectId}`);
  }

  if (active.has(projectId)) {
    return { running: true, started: false };
  }

  const observer = createProjectObserver(config, "lifecycle-service");
  const { lifecycle, pipelineEngine } = await getLifecycleManager(config, projectId);

  lifecycle.start(intervalMs);

  observer.setHealth({
    surface: "lifecycle.worker",
    status: "ok",
    projectId,
    correlationId: createCorrelationId("lifecycle-service"),
    details: { projectId, intervalMs, inProcess: true, pipelineEngine: pipelineEngine !== null },
  });

  active.set(projectId, {
    lifecycle,
    pipelineEngine,
    stop: () => {
      try {
        lifecycle.stop();
      } finally {
        observer.setHealth({
          surface: "lifecycle.worker",
          status: "warn",
          projectId,
          correlationId: createCorrelationId("lifecycle-service"),
          reason: "Lifecycle polling stopped",
          details: { projectId },
        });
      }
    },
    drainPipelineEngine: async () => {
      if (!pipelineEngine) return;
      try {
        await pipelineEngine.shutdown();
      } catch (err) {
        // Best-effort: any persistence failure is recorded as an activity event
        // so RCA can answer "did clean shutdown reach the engine?" but never
        // blocks `ao stop` from completing.
        recordActivityEvent({
          projectId,
          source: "lifecycle",
          kind: "pipeline.shutdown_failed",
          level: "warn",
          summary: `pipeline engine shutdown failed for ${projectId}`,
          data: {
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },
  });

  return { running: true, started: true };
}

export function stopLifecycleWorker(projectId: string): void {
  const entry = active.get(projectId);
  if (!entry) return;

  try {
    entry.stop();
  } catch {
    // Best-effort
  }
  // Drain the pipeline engine asynchronously. The synchronous `stop()` above
  // already halted the poll timer, so it's safe to delete the active entry
  // immediately. The drain promise is tracked in `pendingDrains` so the
  // graceful-shutdown handler can `await drainAllLifecycleWorkerPipelines()`
  // and pick up drains that started in an earlier synchronous burst.
  if (entry.pipelineEngine) {
    const p = entry.drainPipelineEngine().finally(() => {
      pendingDrains.delete(p);
    });
    pendingDrains.add(p);
  }
  active.delete(projectId);
}

export function stopAllLifecycleWorkers(): void {
  for (const projectId of Array.from(active.keys())) {
    stopLifecycleWorker(projectId);
  }
}

/**
 * Async drain of every active project's pipeline engine. Called by the
 * graceful-shutdown handler (`installShutdownHandlers`) so in-flight stages
 * are cancelled and final state persisted before the process exits.
 *
 * Covers both code paths:
 *  - Drains started before this call landed (synchronous `stopLifecycleWorker`
 *    bursts kicked off by `stopAllLifecycleWorkers`): awaited via `pendingDrains`.
 *  - Loops still in `active`: drained inline.
 */
export async function drainAllLifecycleWorkerPipelines(): Promise<void> {
  const stillActive = Array.from(active.values()).map((entry) =>
    entry.drainPipelineEngine(),
  );
  await Promise.all([...pendingDrains, ...stillActive]);
}

export function isLifecycleWorkerRunning(projectId: string): boolean {
  return active.has(projectId);
}

export function listLifecycleWorkers(): string[] {
  return Array.from(active.keys());
}
