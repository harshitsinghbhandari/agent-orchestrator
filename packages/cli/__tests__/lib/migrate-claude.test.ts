import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toClaudeProjectPath } from "@aoagents/ao-plugin-agent-claude-code";
import { planTranscriptCopy, relocateTranscript } from "../../src/lib/migrate-claude.js";

const UUID = "abcdabcd-1111-2222-3333-444455556666";

describe("planTranscriptCopy", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ao-migrate-claude-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("computes the source slug from the worktree and the dest from the orchestrator template", async () => {
    const dataDir = join(dir, "data");
    const worktree = join(dir, "legacy-worktree");
    mkdirSync(worktree, { recursive: true }); // exists -> realpath resolves it
    const claudeProjectsDir = join(dir, "claude-projects");

    const plan = await planTranscriptCopy({
      dataDir,
      projectId: "app",
      prefix: "app",
      worktree,
      uuid: UUID,
      claudeProjectsDir,
    });

    // Destination uses the LITERAL orchestrator-worktree template (no realpath).
    const destTemplate = join(dataDir, "worktrees", "app", "orchestrator", "app-orchestrator");
    expect(plan.destPath).toBe(
      join(claudeProjectsDir, toClaudeProjectPath(destTemplate), `${UUID}.jsonl`),
    );
    expect(plan.sourcePath.endsWith(`${UUID}.jsonl`)).toBe(true);
    expect(plan.sourcePath.startsWith(claudeProjectsDir)).toBe(true);
  });
});

describe("relocateTranscript", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ao-migrate-claude-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function plan(): { sourcePath: string; destPath: string; projectId: string; uuid: string } {
    return {
      projectId: "app",
      uuid: UUID,
      sourcePath: join(dir, "src", `${UUID}.jsonl`),
      destPath: join(dir, "dest", "nested", `${UUID}.jsonl`),
    };
  }

  it("copies the transcript, creating the destination dir", () => {
    const p = plan();
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(p.sourcePath, '{"type":"summary"}\n');

    expect(relocateTranscript(p)).toBe("copied");
    expect(existsSync(p.destPath)).toBe(true);
    expect(readFileSync(p.destPath, "utf-8")).toBe('{"type":"summary"}\n');
  });

  it("is a no-op when the destination already exists", () => {
    const p = plan();
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "dest", "nested"), { recursive: true });
    writeFileSync(p.sourcePath, "new\n");
    writeFileSync(p.destPath, "existing\n");

    expect(relocateTranscript(p)).toBe("already-present");
    expect(readFileSync(p.destPath, "utf-8")).toBe("existing\n"); // not clobbered
  });

  it("skips silently when the source is missing", () => {
    const p = plan();
    expect(relocateTranscript(p)).toBe("source-missing");
    expect(existsSync(p.destPath)).toBe(false);
  });
});
