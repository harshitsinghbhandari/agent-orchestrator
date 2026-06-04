/**
 * File-layout helpers for the flat-file pipeline store.
 *
 *   {root}/
 *     runs/{runId}.json
 *     stages/{stageRunId}.json
 *     artifacts/{runId}/{stageRunId}.jsonl
 *     loops/{runId}.json
 *
 * `root` is typically getProjectPipelinesDir(projectId) but the store accepts
 * any root, which makes tests and isolation trivial.
 */

import { join } from "node:path";

import type { RunId, StageRunId } from "./types.js";

export interface PipelineLayout {
  root: string;
  runsDir: string;
  stagesDir: string;
  artifactsDir: string;
  loopsDir: string;
  threadsDir: string;
}

export function pipelineLayout(root: string): PipelineLayout {
  return {
    root,
    runsDir: join(root, "runs"),
    stagesDir: join(root, "stages"),
    artifactsDir: join(root, "artifacts"),
    loopsDir: join(root, "loops"),
    threadsDir: join(root, "threads"),
  };
}

export function runFilePath(root: string, runId: RunId): string {
  return join(root, "runs", `${runId}.json`);
}

export function stageFilePath(root: string, stageRunId: StageRunId): string {
  return join(root, "stages", `${stageRunId}.json`);
}

export function artifactsDirForRun(root: string, runId: RunId): string {
  return join(root, "artifacts", runId);
}

export function artifactsFilePath(root: string, runId: RunId, stageRunId: StageRunId): string {
  return join(artifactsDirForRun(root, runId), `${stageRunId}.jsonl`);
}

export function loopFilePath(root: string, runId: RunId): string {
  return join(root, "loops", `${runId}.json`);
}

export function threadsDirForRun(root: string, runId: RunId): string {
  return join(root, "threads", runId);
}

export function threadFilePath(root: string, runId: RunId, stageRunId: StageRunId): string {
  return join(threadsDirForRun(root, runId), `${stageRunId}.jsonl`);
}
