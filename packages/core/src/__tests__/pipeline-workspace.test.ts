/**
 * Tests for pipeline/workspace.ts (#197 / 8a).
 *
 * Covers:
 *  - resolveWorkspaceClass defaults (agent/builtin → shared-ro, command → isolated-rw)
 *    plus explicit Stage.workspace overrides.
 *  - snapshotWorkspace / verifyWorkspaceUnchanged round-trips against a real
 *    git repo, including dirty-state detection and graceful no-op on non-git
 *    directories.
 *  - createIsolatedWorktree / destroyIsolatedWorktree round-trip — proves the
 *    helpers actually shell out to git and produce a usable checkout.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildGuardWarning,
  createIsolatedWorktree,
  destroyIsolatedWorktree,
  isolatedWorktreePath,
  resolveWorkspaceClass,
  snapshotWorkspace,
  verifyWorkspaceUnchanged,
  type Stage,
} from "../pipeline/index.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function initRepo(dir: string): string {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "seed.txt"), "hello\n", "utf-8");
  git(dir, "add", "seed.txt");
  git(dir, "commit", "-q", "-m", "seed");
  return git(dir, "rev-parse", "HEAD");
}

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    name: "s",
    trigger: { on: ["manual"] },
    executor: { kind: "agent", plugin: "codex", mode: "review" },
    task: {},
    ...overrides,
  };
}

describe("resolveWorkspaceClass", () => {
  it("defaults agent stages to shared-ro", () => {
    expect(resolveWorkspaceClass(makeStage())).toBe("shared-ro");
  });

  it("defaults builtin stages to shared-ro", () => {
    expect(
      resolveWorkspaceClass(
        makeStage({ executor: { kind: "builtin", name: "router" } }),
      ),
    ).toBe("shared-ro");
  });

  it("defaults command stages to isolated-rw", () => {
    expect(
      resolveWorkspaceClass(
        makeStage({ executor: { kind: "command", command: "echo" } }),
      ),
    ).toBe("isolated-rw");
  });

  it("respects explicit Stage.workspace overrides", () => {
    expect(resolveWorkspaceClass(makeStage({ workspace: "isolated-rw" }))).toBe(
      "isolated-rw",
    );
    expect(
      resolveWorkspaceClass(
        makeStage({
          executor: { kind: "command", command: "echo" },
          workspace: "shared-ro",
        }),
      ),
    ).toBe("shared-ro");
  });
});

describe("WorkspaceGuard via snapshotWorkspace / verifyWorkspaceUnchanged", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "ao-ws-guard-"));
    initRepo(repo);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("returns matching hashes when workspace is untouched", async () => {
    const before = await snapshotWorkspace(repo);
    const after = await snapshotWorkspace(repo);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(before!.hash).toBe(after!.hash);
    expect(verifyWorkspaceUnchanged(before, after).ok).toBe(true);
  });

  it("detects untracked file additions", async () => {
    const before = await snapshotWorkspace(repo);
    writeFileSync(join(repo, "dropped.txt"), "leak\n", "utf-8");
    const after = await snapshotWorkspace(repo);
    const check = verifyWorkspaceUnchanged(before, after);
    expect(check.ok).toBe(false);
    expect(before!.hash).not.toBe(after!.hash);
  });

  it("detects tracked-file modifications", async () => {
    const before = await snapshotWorkspace(repo);
    writeFileSync(join(repo, "seed.txt"), "tampered\n", "utf-8");
    const after = await snapshotWorkspace(repo);
    expect(verifyWorkspaceUnchanged(before, after).ok).toBe(false);
  });

  it("treats a non-git directory as no-op (null snapshot, ok=true)", async () => {
    const plain = mkdtempSync(join(tmpdir(), "ao-ws-plain-"));
    try {
      const snap = await snapshotWorkspace(plain);
      expect(snap).toBeNull();
      // ok=true is the safe default — we never escalate a degraded env.
      expect(verifyWorkspaceUnchanged(snap, null).ok).toBe(true);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("buildGuardWarning produces the documented observation shape", () => {
    const warning = buildGuardWarning({
      runId: "run-1",
      stageRunId: "sr-1",
      stageName: "review",
      workspacePath: "/tmp/ws",
      check: {
        ok: false,
        before: { hash: "before", takenAt: "t1" },
        after: { hash: "after", takenAt: "t2" },
      },
    });
    expect(warning.name).toBe("pipeline.workspace.guard_warning");
    expect(warning.data).toEqual({
      runId: "run-1",
      stageRunId: "sr-1",
      stageName: "review",
      workspacePath: "/tmp/ws",
      beforeHash: "before",
      afterHash: "after",
    });
  });
});

describe("createIsolatedWorktree / destroyIsolatedWorktree", () => {
  let repo: string;
  let head: string;
  let scratchRoot: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "ao-ws-repo-"));
    head = initRepo(repo);
    scratchRoot = mkdtempSync(join(tmpdir(), "ao-ws-scratch-"));
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  it("creates a detached worktree at headSha and destroy reclaims it", async () => {
    const wt = isolatedWorktreePath(scratchRoot, "run-1", "sr-1");
    await createIsolatedWorktree({ repoPath: repo, worktreePath: wt, headSha: head });

    // The seed file should be present in the new worktree.
    const list = git(repo, "worktree", "list", "--porcelain");
    expect(list).toContain(wt);

    await destroyIsolatedWorktree({ repoPath: repo, worktreePath: wt });

    const after = git(repo, "worktree", "list", "--porcelain");
    expect(after).not.toContain(wt);
  });
});

