/**
 * Tests for hardening sub-area 8d (#197).
 *
 *  - PipelineStore.listArtifacts tolerates a torn FINAL JSONL line on read
 *    (drops it, fires `pipeline.artifacts.torn_line` observation). A torn
 *    NON-final line is real corruption and still throws.
 *  - Streaming + cap on agent findings file (covered indirectly via
 *    `FINDINGS_FILE_SIZE_CAP_BYTES` export and a focused parse test).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  asRunId,
  asStageRunId,
  createPipelineStore,
  FINDINGS_FILE_SIZE_CAP_BYTES,
  type Artifact,
} from "../pipeline/index.js";

function makeFinding(id: string): Artifact {
  return {
    artifactId: id as Artifact["artifactId"],
    pipelineRunId: asRunId("run-1"),
    stageRunId: asStageRunId("sr-1"),
    stageName: "review",
    kind: "finding",
    filePath: "src/x.ts",
    startLine: 1,
    endLine: 2,
    title: id,
    description: "...",
    category: "correctness",
    severity: "warning",
    confidence: 0.8,
    status: "open",
    createdAt: new Date().toISOString(),
  };
}

describe("PipelineStore.listArtifacts — torn-line tolerance (#197 / 8d)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ao-store-torn-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("drops a torn final line and emits a pipeline.artifacts.torn_line observation", () => {
    const observed: Array<{ name: string; data: Record<string, unknown> }> = [];
    const store = createPipelineStore(root, {
      onObservation: (event) => observed.push(event),
    });

    // Write two good lines + one torn (truncated mid-JSON) line at the end.
    const runId = asRunId("run-1");
    const stageRunId = asStageRunId("sr-1");
    const good1 = JSON.stringify(makeFinding("a"));
    const good2 = JSON.stringify(makeFinding("b"));
    const tornTail = '{"artifactId":"c","kind":"finding","fil'; // missing close

    // Reach into the store layout directly so we can write a deliberately
    // torn file. The store would never write this itself.
    const dir = join(root, "artifacts", runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${stageRunId}.jsonl`), `${good1}\n${good2}\n${tornTail}\n`, "utf-8");

    const artifacts = store.listArtifacts(runId, stageRunId);
    expect(artifacts.map((a) => a.artifactId)).toEqual(["a", "b"]);

    const torn = observed.find((o) => o.name === "pipeline.artifacts.torn_line");
    expect(torn).toBeDefined();
    expect(torn!.data["runId"]).toBe(runId);
    expect(torn!.data["stageRunId"]).toBe(stageRunId);
  });

  it("throws when a non-final line is corrupt (real corruption, not a torn append)", () => {
    const observed: Array<{ name: string; data: Record<string, unknown> }> = [];
    const store = createPipelineStore(root, {
      onObservation: (event) => observed.push(event),
    });

    const runId = asRunId("run-2");
    const stageRunId = asStageRunId("sr-2");
    const good = JSON.stringify(makeFinding("a"));
    const dir = join(root, "artifacts", runId);
    mkdirSync(dir, { recursive: true });
    // Bad line is FIRST — torn-line tolerance only applies to the last line.
    writeFileSync(join(dir, `${stageRunId}.jsonl`), `{not json\n${good}\n`, "utf-8");

    expect(() => store.listArtifacts(runId, stageRunId)).toThrow();
    expect(observed).toEqual([]);
  });

  it("works without an onObservation callback (backward compatibility)", () => {
    const store = createPipelineStore(root);
    const runId = asRunId("run-3");
    const stageRunId = asStageRunId("sr-3");
    const good = JSON.stringify(makeFinding("a"));
    const dir = join(root, "artifacts", runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${stageRunId}.jsonl`), `${good}\n{torn`, "utf-8");

    // Doesn't throw, drops the torn line.
    const artifacts = store.listArtifacts(runId, stageRunId);
    expect(artifacts.map((a) => a.artifactId)).toEqual(["a"]);
  });
});

describe("Agent findings cap constant (#197 / 8d)", () => {
  it("exposes a 5 MiB cap so consumers can document/validate it", () => {
    expect(FINDINGS_FILE_SIZE_CAP_BYTES).toBe(5 * 1024 * 1024);
  });
});
