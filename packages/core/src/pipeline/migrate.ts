/**
 * Pipeline store migration.
 *
 * v0.3 introduces stable, stage-scoped fingerprints on finding artifacts so
 * dismissals recorded against the legacy `codeReview:` flow survive the
 * migration to single-stage pipelines (issue #193). This module walks the
 * flat-file store, backfills any finding artifact missing a fingerprint, and
 * rewrites only the JSONL files that changed.
 *
 * Idempotent by construction: a second invocation sees every finding already
 * has a fingerprint and reports 0 migrated.
 *
 * Fingerprint scheme: SHA-256 over a NUL-delimited tuple of
 *   stageName · filePath · anchorSignature|"L<start>:<end>" · category · title
 * truncated to 16 hex chars. The stage name is part of the input on purpose
 * — synthesizing the legacy code-review pipeline with stage `"review"` is
 * what makes pre-migration dismissals continue to match post-migration
 * artifacts.
 */

import { createHash } from "node:crypto";

import type { PipelineStore } from "./store.js";
import type { Artifact, FindingArtifactInput } from "./types.js";

export interface MigrateResult {
  /** Number of finding artifacts whose fingerprints were backfilled. */
  migrated: number;
  /** Number of stage-artifact JSONL files rewritten. */
  filesRewritten: number;
  /** Human-readable summary, suitable for direct CLI output. */
  message: string;
}

/**
 * Compute the canonical fingerprint for a finding artifact under a given stage.
 *
 * Treats `anchorSignature` (function/class name from the executor) as the
 * stable anchor when present; falls back to a line range otherwise. The line
 * range fallback is intentionally fragile — without an anchor a diff that
 * shifts the finding by even one line invalidates the fingerprint, which is
 * the correct behaviour for "we don't actually know what this attaches to".
 */
export function computeFindingFingerprint(
  finding: Pick<
    FindingArtifactInput,
    "filePath" | "startLine" | "endLine" | "title" | "category" | "anchorSignature"
  >,
  stageName: string,
): string {
  const anchor =
    finding.anchorSignature && finding.anchorSignature.length > 0
      ? finding.anchorSignature
      : `L${finding.startLine}:${finding.endLine}`;
  const parts = [stageName, finding.filePath, anchor, finding.category, finding.title];
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function isFinding(a: Artifact): a is Artifact & { kind: "finding" } {
  return a.kind === "finding";
}

/**
 * Walk the store, backfill missing fingerprints on finding artifacts, and
 * rewrite affected JSONL files. Safe to re-run.
 *
 * Only `kind: "finding"` artifacts are touched. JSON artifacts (`kind:
 * "json"`) carry no fingerprint and are passed through unchanged.
 */
export function migrateStore(store: PipelineStore): MigrateResult {
  let migrated = 0;
  let filesRewritten = 0;

  for (const run of store.listRuns()) {
    for (const [stageName, stageState] of Object.entries(run.stages)) {
      const artifacts = store.listArtifacts(run.runId, stageState.stageRunId);
      if (artifacts.length === 0) continue;

      let stageChanged = 0;
      const next: Artifact[] = artifacts.map((a) => {
        if (!isFinding(a) || a.fingerprint) return a;
        stageChanged++;
        return { ...a, fingerprint: computeFindingFingerprint(a, stageName) };
      });

      if (stageChanged > 0) {
        store.replaceArtifacts(run.runId, stageState.stageRunId, next);
        migrated += stageChanged;
        filesRewritten++;
      }
    }
  }

  const message =
    migrated === 0
      ? "Pipeline store is already migrated — every finding already carries a fingerprint."
      : `Backfilled fingerprints on ${migrated} finding(s) across ${filesRewritten} stage file(s).`;

  return { migrated, filesRewritten, message };
}
