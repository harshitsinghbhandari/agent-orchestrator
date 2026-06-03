/**
 * Builtin executor: `router`.
 *
 * Reads upstream stage artifacts via `ctx.inputs` (keyed by upstream stage
 * name), composes one message per upstream stage, and delivers each to the
 * linked worker session via `ctx.sendToSession`.
 *
 * Replaces the removed v0 `SEND_TO_AGENT` reducer command path. Router runs
 * in the engine process; the engine writes any resulting artifacts through
 * the normal STAGE_COMPLETED path. Router never mutates the pipeline store.
 *
 * Pre-send liveness: a single `isSessionAlive` probe per invocation. If the
 * worker is terminal/killed/missing we emit `pipeline.send.skipped_worker_dead`
 * once per input stage, leave the underlying findings `open`, and skip
 * delivery (no retry-spam — the next pipeline tick will reprobe).
 */

import type {
  Artifact,
  ArtifactInput,
  BuiltinTaskContext,
  Verdict,
} from "../../types.js";

export interface RouterDeps {
  /** Probe the linked worker session before attempting delivery. */
  isSessionAlive: (sessionId: string) => Promise<boolean>;
}

export interface RouterObservation {
  name: string;
  data: Record<string, unknown>;
}

export interface RouterOutcome {
  artifacts: ArtifactInput[];
  verdict: Verdict;
  observations: RouterObservation[];
}

export async function runRouter(
  ctx: BuiltinTaskContext,
  deps: RouterDeps,
): Promise<RouterOutcome> {
  const artifacts: ArtifactInput[] = [];
  const observations: RouterObservation[] = [];
  const targetSessionId = ctx.linkedSessionId;

  // Single liveness probe — input stages share the same target worker, so
  // probing once avoids hammering the runtime when there are many findings.
  const alive = await deps.isSessionAlive(targetSessionId);

  for (const [fromStage, stageArtifacts] of Object.entries(ctx.inputs)) {
    if (stageArtifacts.length === 0) continue;

    if (!alive) {
      observations.push({
        name: "pipeline.send.skipped_worker_dead",
        data: {
          runId: ctx.runId,
          stageRunId: ctx.stageRunId,
          stageName: ctx.stage.name,
          fromStage,
          targetSessionId,
          artifactCount: stageArtifacts.length,
        },
      });
      artifacts.push({
        kind: "json",
        data: {
          result: "delivery_failed",
          reason: "worker_dead",
          fromStage,
          targetSessionId,
          artifactCount: stageArtifacts.length,
        },
      });
      continue;
    }

    const message = composeMessage(fromStage, stageArtifacts);

    try {
      await ctx.sendToSession(targetSessionId, message);
      artifacts.push({
        kind: "json",
        data: {
          result: "delivered",
          fromStage,
          targetSessionId,
          artifactCount: stageArtifacts.length,
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      observations.push({
        name: "pipeline.send.failed",
        data: {
          runId: ctx.runId,
          stageRunId: ctx.stageRunId,
          stageName: ctx.stage.name,
          fromStage,
          targetSessionId,
          error: errorMessage,
        },
      });
      artifacts.push({
        kind: "json",
        data: {
          result: "delivery_failed",
          reason: "send_error",
          fromStage,
          targetSessionId,
          error: errorMessage,
        },
      });
    }
  }

  return { artifacts, verdict: "neutral", observations };
}

function composeMessage(stageName: string, artifacts: Artifact[]): string {
  const lines: string[] = [];
  lines.push(`Findings from upstream pipeline stage "${stageName}":`);
  lines.push("");
  for (const artifact of artifacts) {
    if (artifact.kind === "finding") {
      lines.push(
        `- [${artifact.severity}] ${artifact.filePath}:${artifact.startLine}-${artifact.endLine} — ${artifact.title}`,
      );
      lines.push(`  ${artifact.description}`);
    } else {
      lines.push(`- ${JSON.stringify(artifact.data)}`);
    }
  }
  return lines.join("\n");
}
