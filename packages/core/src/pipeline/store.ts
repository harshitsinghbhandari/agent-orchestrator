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
 *   line. listArtifacts is therefore NOT crash-safe: it JSON.parses each
 *   non-empty line and will throw on a torn final record. Callers that need
 *   to tolerate crashes should wrap the read or repair the file out-of-band.
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
} from "./paths.js";
import type {
  Artifact,
  LoopState,
  RunId,
  RunState,
  StageRunId,
  StageState,
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
}

export function createPipelineStore(root: string): PipelineStore {
  const layout = pipelineLayout(root);

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
      for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        out.push(JSON.parse(trimmed) as Artifact);
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
  };
}

function readJsonOrNull<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  const body = readFileSync(path, "utf-8");
  return JSON.parse(body) as T;
}
