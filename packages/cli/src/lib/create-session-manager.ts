/**
 * Session manager factory for the CLI.
 *
 * Creates a PluginRegistry with all available plugins loaded,
 * then creates a SessionManager instance backed by core's implementation.
 * This ensures the CLI uses the same hash-based naming, metadata format,
 * and plugin abstractions as the rest of the system.
 */

import {
  createAgentExecutor,
  createLifecycleManager,
  createPipelineEngine,
  createPipelineStore,
  createPluginRegistry,
  createSessionManager,
  getProjectPipelinesDir,
  hydrateEngineState,
  recordActivityEvent,
  type LifecycleManager,
  type ObservationContext,
  type OpenCodeSessionManager,
  type OrchestratorConfig,
  type PipelineEngine,
  type PluginRegistry,
} from "@aoagents/ao-core";
import { importPluginModuleFromSource } from "./plugin-store.js";

/**
 * Route a pipeline EMIT_OBSERVATION effect into the activity-event log so
 * observations surface in `ao session show` and the web dashboard (#197 / 8c).
 *
 * Best-effort: `recordActivityEvent` swallows its own write failures, so any
 * unexpected throw here would have to come from the data shape. We catch
 * defensively so a routing bug can never crash the engine tick.
 */
function routePipelineObservation(
  event: { name: string; data: Record<string, unknown> },
  ctx: ObservationContext,
): void {
  try {
    recordActivityEvent({
      source: "pipeline",
      kind: event.name,
      summary: event.name,
      data: event.data,
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    });
  } catch {
    // Swallow — observation routing must never break the engine.
  }
}

const registryPromises = new Map<string, Promise<PluginRegistry>>();

function getRegistryCacheKey(config: OrchestratorConfig): string {
  return config.configPath || "__default__";
}

/**
 * Get or create the plugin registry.
 * Caches the Promise (not the resolved value) so concurrent callers
 * await the same initialization rather than racing.
 */
export async function getPluginRegistry(config: OrchestratorConfig): Promise<PluginRegistry> {
  const cacheKey = getRegistryCacheKey(config);
  let registryPromise = registryPromises.get(cacheKey);

  if (!registryPromise) {
    registryPromise = (async () => {
      const registry = createPluginRegistry();
      // Prefer the AO-managed plugin store when a package is installed there,
      // but still fall back to the CLI/workspace dependency tree for built-ins.
      await registry.loadFromConfig(config, importPluginModuleFromSource);
      return registry;
    })().catch((err) => {
      registryPromises.delete(cacheKey);
      throw err;
    });
    registryPromises.set(cacheKey, registryPromise);
  }

  return registryPromise;
}

/**
 * Create a SessionManager backed by core's implementation.
 * Initializes the plugin registry from config and wires everything up.
 */
export async function getSessionManager(
  config: OrchestratorConfig,
): Promise<OpenCodeSessionManager> {
  const registry = await getPluginRegistry(config);
  return createSessionManager({ config, registry });
}

/**
 * Create a LifecycleManager backed by core's implementation.
 * Shares the same plugin registry initialization path as SessionManager.
 *
 * When a `projectId` is supplied, we also construct the per-project pipeline
 * engine (hydrated from the flat-file store, with any leftover in-flight
 * stages reconciled) and pass it into the lifecycle manager so `engine.tick()`
 * runs on the existing 5s poll cadence (per C-14, no new timers).
 *
 * The engine is intentionally NOT constructed in the multi-project mode
 * (`projectId === undefined`, used by the web dashboard's webhook-driven
 * lifecycle manager): the engine is per-project and the web path currently
 * doesn't own pipeline execution.
 */
export interface LifecycleManagerHandle {
  lifecycle: LifecycleManager;
  /** Per-project pipeline engine. Null when no projectId was supplied. */
  pipelineEngine: PipelineEngine | null;
}

export async function getLifecycleManager(
  config: OrchestratorConfig,
  projectId?: string,
): Promise<LifecycleManagerHandle> {
  const registry = await getPluginRegistry(config);
  const sessionManager = createSessionManager({ config, registry });

  let pipelineEngine: PipelineEngine | null = null;
  if (projectId) {
    const store = createPipelineStore(getProjectPipelinesDir(projectId), {
      onObservation: (event) => routePipelineObservation(event, {}),
    });
    const agentExecutor = createAgentExecutor({ sessionManager });
    pipelineEngine = createPipelineEngine({
      store,
      registry,
      agentExecutor,
      initialState: hydrateEngineState(store),
      onObservation: routePipelineObservation,
      // Wire worker session lookups so the engine can build `PrContext`
      // (head SHA + PR number/URL/branches) for agent stages — see #215.
      getSession: (sessionId) => sessionManager.get(sessionId),
    });
    // Reconcile stages left in `running` from a previous process: their
    // in-flight executor handles are gone, so dispatch STAGE_FAILED to let
    // the reducer either advance the run or terminate it as `stalled`.
    await pipelineEngine.reconcileInflightStages();
  }

  const lifecycle = createLifecycleManager({
    config,
    registry,
    sessionManager,
    projectId,
    ...(pipelineEngine ? { pipelineEngine } : {}),
  });
  return { lifecycle, pipelineEngine };
}

/**
 * Build a transient pipeline engine for one-shot CLI dispatches (e.g.
 * `ao pipeline run`). Hydrates state from the persisted store and wires up
 * a real agent executor so the engine can spawn stages — but does NOT call
 * `reconcileInflightStages`, because reconcile assumes the caller owns the
 * lifecycle for those stages. Calling it from a transient CLI process would
 * STAGE_FAILED stages that a separately-running `ao start` is still driving,
 * corrupting that other process's view of the world.
 *
 * After dispatch, the CLI should exit without ticking the engine. The agent
 * session it spawned lives on in the runtime plugin; a future `ao start`
 * will surface the resulting run in the dashboard.
 */
export async function getOneShotPipelineEngine(
  config: OrchestratorConfig,
  projectId: string,
): Promise<PipelineEngine> {
  const registry = await getPluginRegistry(config);
  const sessionManager = createSessionManager({ config, registry });
  const store = createPipelineStore(getProjectPipelinesDir(projectId), {
    onObservation: (event) => routePipelineObservation(event, {}),
  });
  const agentExecutor = createAgentExecutor({ sessionManager });
  return createPipelineEngine({
    store,
    registry,
    agentExecutor,
    initialState: hydrateEngineState(store),
    onObservation: routePipelineObservation,
    // Wire worker session lookups so the engine can build `PrContext`
    // (head SHA + PR number/URL/branches) for agent stages — see #215.
    getSession: (sessionId) => sessionManager.get(sessionId),
  });
}
