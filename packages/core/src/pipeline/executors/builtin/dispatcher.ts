/**
 * Builtin executor dispatcher.
 *
 * The single point that upcasts a base `TaskContext` to a privileged
 * `BuiltinTaskContext` (which exposes `sendToSession`). Agent and command
 * executors must never see this capability — keep the dispatcher the only
 * caller that constructs a `BuiltinTaskContext`.
 *
 * The engine wires this in alongside the agent executor; on START_STAGE for
 * a builtin executor, it gathers upstream artifacts into a TaskContext and
 * hands them here.
 */

import type {
  ArtifactInput,
  BuiltinExecutor,
  BuiltinTaskContext,
  TaskContext,
  Verdict,
} from "../../types.js";
import { runCompose } from "./compose.js";
import { runRouter } from "./router.js";

export interface BuiltinDispatcherDeps {
  /** Probe a session before router attempts to deliver. */
  isSessionAlive: (sessionId: string) => Promise<boolean>;
  /** Deliver a message to a session. Wraps SessionManager.send. */
  sendToSession: (sessionId: string, message: string) => Promise<void>;
}

export interface BuiltinDispatchObservation {
  name: string;
  data: Record<string, unknown>;
}

export interface BuiltinDispatchOutcome {
  artifacts: ArtifactInput[];
  verdict: Verdict;
  observations: BuiltinDispatchObservation[];
}

export class UnknownBuiltinExecutorError extends Error {
  constructor(name: string) {
    super(`Unknown builtin executor name: "${name}"`);
    this.name = "UnknownBuiltinExecutorError";
  }
}

export async function dispatchBuiltin(
  ctx: TaskContext,
  executor: BuiltinExecutor,
  deps: BuiltinDispatcherDeps,
): Promise<BuiltinDispatchOutcome> {
  const builtinCtx: BuiltinTaskContext = {
    ...ctx,
    sendToSession: deps.sendToSession,
  };

  switch (executor.name) {
    case "router": {
      const outcome = await runRouter(builtinCtx, { isSessionAlive: deps.isSessionAlive });
      return outcome;
    }
    case "compose": {
      const outcome = await runCompose(builtinCtx);
      return { ...outcome, observations: [] };
    }
    default: {
      // Exhaustiveness guard — a new BuiltinExecutor.name would land here
      // until the dispatcher is updated.
      const _exhaustive: never = executor.name;
      throw new UnknownBuiltinExecutorError(_exhaustive);
    }
  }
}
