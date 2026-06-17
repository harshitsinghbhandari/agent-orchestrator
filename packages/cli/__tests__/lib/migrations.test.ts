import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Drift guard for the vendored goose migrations.
 *
 * These `.sql` files are copied verbatim from aoagents/ReverbCode @ commit
 * 43ae7eb. If ReverbCode changes a migration (or someone edits a vendored copy),
 * these checksums change and this test fails — forcing a deliberate re-vendor +
 * `VENDORED_SCHEMA_VERSION` bump rather than a silent schema drift.
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../src/lib/migrations");

// sha256 of each file's exact 43ae7eb content.
const EXPECTED: Record<string, string> = {
  "0001_init.sql": "dd14f805954310190359da414532c0eeff2bed1f5cbee5311512fc72a2999c54",
  "0002_remove_activity_source.sql":
    "608ae733fad29cc1be9e67697fed57019f39998345237c42d975591296f64225",
  "0003_add_session_display_name.sql":
    "691fe9702006c2194443d4fa593f9a94cf02b17eee97db84668c6133b46ae77d",
  "0004_scm_observer_schema.sql":
    "dbd2eab13fa80db44c6a17cd199a0a1bcc40540580361a6ae15857736fe2068a",
  "0005_pr_last_nudge_signature.sql":
    "69eb49a17ecb5a1974f0fde3bdb45f1f3cfd5b2c44430ba993ae77f059ca6345",
  "0006_pr_session_changed_cdc.sql":
    "1bff6ec226f5fa31f8eeddf5839fd7fda2aa44ff394164e4a96a83a77417514b",
  "0007_allow_implemented_harnesses.sql":
    "c688f73979e334e4f637c9a2e986673bdc4d6a7ecc8511511b93ee330d622735",
  "0008_add_project_config.sql":
    "b1630baba5a41b309197b1f05a41e7b9ba6a1c993d8e618d8e107379a310f070",
  "0009_workspace_projects.sql":
    "7d73830cdd4f344804cf2d4eed1d6ef2a9acd5263b14b67b57ef3782a05af871",
  "0010_add_first_signal_at.sql":
    "20970792497b49964eb61ab1998d67a185c2294591436184fd2c02f96c381abd",
  "0011_notifications.sql": "231cf983109e2d8a87af0af15d68d9b2a22b944818a8165105e5fda2fa0aa990",
  "0012_add_review_tables.sql":
    "68878b097954e6725936c83e2017ad8d91aba0a6ee34f49b25b8cafc1fa84b08",
};

describe("vendored migrations (43ae7eb pin)", () => {
  it("vendors exactly the expected files in numeric order", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files).toEqual(Object.keys(EXPECTED));
  });

  it.each(Object.entries(EXPECTED))("%s matches the pinned checksum", (file, expected) => {
    const content = readFileSync(join(MIGRATIONS_DIR, file));
    const actual = createHash("sha256").update(content).digest("hex");
    expect(actual).toBe(expected);
  });
});
