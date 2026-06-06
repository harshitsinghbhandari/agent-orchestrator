/**
 * Flat-file pipeline store.
 *
 * File layout (rooted at any directory; v0 wires it to
 * getProjectPipelinesDir(projectId)):
 *
 *   runs/{runId}.json
 *   stages/{stageRunId}.json
 *   artifacts/{runId}/{stageRunId}.jsonl
 *   loops/{runId}.json
 *
 * Durability:
 * - JSON writes (runs, stages, loops) go through atomicWriteFileSync so
 *   concurrent writers never produce torn data.
 * - JSONL artifact appends use appendFileSync — atomic semantics aren't
 *   available for append, so a process crash mid-write can leave a partial
 *   line. `listArtifacts` tolerates a torn FINAL line (drops it and emits
 *   a `pipeline.artifacts.torn_line` observation via `onObservation`) so a
 *   crash mid-write doesn't break the reducer next time around. Earlier
 *   lines that fail to parse are still treated as corruption and throw.
 *
 * Reads are best-effort: missing files return null; corrupt JSON raises.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

import { atomicWriteFileSync } from "../atomic-write.js";
import {
  artifactsDirForRun,
  artifactsFilePath,
  loopFilePath,
  pipelineLayout,
  runFilePath,
  stageFilePath,
  threadFilePath,
  threadsDirForRun,
} from "./paths.js";
import type {
  Artifact,
  ArtifactId,
  ArtifactStatus,
  LoopState,
  RunId,
  RunState,
  StageRunId,
  StageState,
  ThreadMessage,
} from "./types.js";

export interface PersistedStageRun extends StageState {
  runId: RunId;
  stageName: string;
}

export interface PipelineStore {
  saveRun(run: RunState): void;
  loadRun(runId: RunId): RunState | null;
  listRuns(): RunState[];

  saveStage(run: PersistedStageRun): void;
  loadStage(stageRunId: StageRunId): PersistedStageRun | null;

  appendArtifacts(runId: RunId, stageRunId: StageRunId, artifacts: Artifact[]): void;
  listArtifacts(runId: RunId, stageRunId: StageRunId): Artifact[];
  /**
   * Atomically replace the artifact file for a stage run. Used by
   * `migrateStore` to rewrite a JSONL with backfilled fingerprints — the
   * normal append path can't update existing lines in place.
   */
  replaceArtifacts(runId: RunId, stageRunId: StageRunId, artifacts: Artifact[]): void;

  saveLoopState(runId: RunId, loopState: LoopState): void;
  loadLoopState(runId: RunId): LoopState | null;

  /**
   * Update a single artifact's status. Reads the JSONL, mutates the matching
   * record, and atomically rewrites the file. No-op when the artifact is
   * missing — the engine surfaces that via the invalidTransition observation
   * already.
   */
  updateArtifactStatus(
    runId: RunId,
    stageRunId: StageRunId,
    artifactId: ArtifactId,
    status: ArtifactStatus,
  ): void;

  appendThreadMessage(runId: RunId, stageRunId: StageRunId, msg: ThreadMessage): void;
  listThreadMessages(runId: RunId, stageRunId: StageRunId): ThreadMessage[];
}

/**
 * Observation callback hook. The store calls this best-effort when it
 * recovers from a torn JSONL line on read. Production callers wire it to
 * `recordActivityEvent`; tests can omit it.
 */
export interface PipelineStoreOptions {
  onObservation?: (event: { name: string; data: Record<string, unknown> }) => void;
}

export function createPipelineStore(
  root: string,
  options: PipelineStoreOptions = {},
): PipelineStore {
  const layout = pipelineLayout(root);
  const onObservation = options.onObservation;

  function ensureDir(path: string): void {
    if (!existsSync(path)) mkdirSync(path, { recursive: true });
  }

  function ensureLayout(): void {
    ensureDir(layout.runsDir);
    ensureDir(layout.stagesDir);
    ensureDir(layout.artifactsDir);
    ensureDir(layout.loopsDir);
  }

  return {
    saveRun(run) {
      ensureDir(layout.runsDir);
      atomicWriteFileSync(runFilePath(root, run.runId), JSON.stringify(run, null, 2));
    },

    loadRun(runId) {
      return readJsonOrNull<RunState>(runFilePath(root, runId));
    },

    listRuns() {
      ensureLayout();
      const out: RunState[] = [];
      for (const file of readdirSync(layout.runsDir)) {
        if (!file.endsWith(".json")) continue;
        const run = readJsonOrNull<RunState>(join(layout.runsDir, file));
        if (run) out.push(run);
      }
      return out;
    },

    saveStage(stage) {
      ensureDir(layout.stagesDir);
      atomicWriteFileSync(
        stageFilePath(root, stage.stageRunId),
        JSON.stringify(stage, null, 2),
      );
    },

    loadStage(stageRunId) {
      return readJsonOrNull<PersistedStageRun>(stageFilePath(root, stageRunId));
    },

    appendArtifacts(runId, stageRunId, artifacts) {
      if (artifacts.length === 0) return;
      ensureDir(artifactsDirForRun(root, runId));
      const lines = artifacts.map((a) => JSON.stringify(a)).join("\n") + "\n";
      appendFileSync(artifactsFilePath(root, runId, stageRunId), lines, "utf-8");
    },

    listArtifacts(runId, stageRunId) {
      const path = artifactsFilePath(root, runId, stageRunId);
      if (!existsSync(path)) return [];
      const body = readFileSync(path, "utf-8");
      const out: Artifact[] = [];
      // Track non-empty lines so we know which one is the LAST: only the
      // final partial line is tolerable (an interrupted append). A bad
      // earlier line is real corruption and still throws.
      const lines: string[] = [];
      for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lines.push(trimmed);
      }
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i] as string;
        try {
          out.push(JSON.parse(trimmed) as Artifact);
        } catch (err) {
          // 8d — appendFileSync isn't atomic. A crash mid-write can leave
          // a torn final line. Drop it with an observation rather than
          // throwing, so the reducer can keep advancing the run. Earlier
          // lines that fail are real corruption — re-raise.
          if (i === lines.length - 1) {
            if (onObservation) {
              onObservation({
                name: "pipeline.artifacts.torn_line",
                data: {
                  runId,
                  stageRunId,
                  path,
                  errorMessage: err instanceof Error ? err.message : String(err),
                  truncatedLength: trimmed.length,
                },
              });
            }
            break;
          }
          throw err;
        }
      }
      return out;
    },

    replaceArtifacts(runId, stageRunId, artifacts) {
      const path = artifactsFilePath(root, runId, stageRunId);
      if (artifacts.length === 0) {
        if (existsSync(path)) unlinkSync(path);
        return;
      }
      ensureDir(artifactsDirForRun(root, runId));
      const body = artifacts.map((a) => JSON.stringify(a)).join("\n") + "\n";
      atomicWriteFileSync(path, body);
    },

    saveLoopState(runId, loopState) {
      ensureDir(layout.loopsDir);
      atomicWriteFileSync(loopFilePath(root, runId), JSON.stringify(loopState, null, 2));
    },

    loadLoopState(runId) {
      return readJsonOrNull<LoopState>(loopFilePath(root, runId));
    },

    updateArtifactStatus(runId, stageRunId, artifactId, status) {
      const path = artifactsFilePath(root, runId, stageRunId);
      if (!existsSync(path)) return;
      const body = readFileSync(path, "utf-8");
      let changed = false;
      const out: Artifact[] = [];
      for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const a = JSON.parse(trimmed) as Artifact;
        if (a.artifactId === artifactId && a.status !== status) {
          out.push({ ...a, status });
          changed = true;
        } else {
          out.push(a);
        }
      }
      if (!changed) return;
      const rewritten = out.map((a) => JSON.stringify(a)).join("\n") + "\n";
      atomicWriteFileSync(path, rewritten);
    },

    appendThreadMessage(runId, stageRunId, msg) {
      ensureDir(threadsDirForRun(root, runId));
      appendFileSync(
        threadFilePath(root, runId, stageRunId),
        JSON.stringify(msg) + "\n",
        "utf-8",
      );
    },

    listThreadMessages(runId, stageRunId) {
      const path = threadFilePath(root, runId, stageRunId);
      if (!existsSync(path)) return [];
      const body = readFileSync(path, "utf-8");
      const out: ThreadMessage[] = [];
      for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        out.push(JSON.parse(trimmed) as ThreadMessage);
      }
      return out;
    },
  };
}

function readJsonOrNull<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  const body = readFileSync(path, "utf-8");
  return JSON.parse(body) as T;
}
