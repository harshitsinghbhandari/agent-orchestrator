import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  inventoryHashDirs,
  convertKeyValueToJson,
  migrateStorage,
  rollbackStorage,
} from "../migration/storage-v2.js";

function createTempDir(): string {
  const dir = join(tmpdir(), `ao-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("inventoryHashDirs", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("detects hash-based directories", () => {
    mkdirSync(join(testDir, "abcdef012345-myproject", "sessions"), { recursive: true });
    writeFileSync(join(testDir, "abcdef012345-myproject", "sessions", "ao-1"), "status=working\n");

    const dirs = inventoryHashDirs(testDir);
    expect(dirs).toHaveLength(1);
    expect(dirs[0].hash).toBe("abcdef012345");
    expect(dirs[0].projectId).toBe("myproject");
    expect(dirs[0].empty).toBe(false);
  });

  it("marks empty directories correctly", () => {
    mkdirSync(join(testDir, "abcdef012345-empty-project"), { recursive: true });

    const dirs = inventoryHashDirs(testDir);
    expect(dirs).toHaveLength(1);
    expect(dirs[0].empty).toBe(true);
  });

  it("ignores non-hash directories", () => {
    mkdirSync(join(testDir, "projects"), { recursive: true });
    mkdirSync(join(testDir, "config.yaml"), { recursive: true });
    mkdirSync(join(testDir, "not-a-hash-dir"), { recursive: true });

    const dirs = inventoryHashDirs(testDir);
    expect(dirs).toHaveLength(0);
  });

  it("detects multiple hash dirs for the same project", () => {
    mkdirSync(join(testDir, "aaaaaaaaaaaa-myproject", "sessions"), { recursive: true });
    mkdirSync(join(testDir, "bbbbbbbbbbbb-myproject", "sessions"), { recursive: true });
    writeFileSync(join(testDir, "aaaaaaaaaaaa-myproject", "sessions", "ao-1"), "status=working\n");
    writeFileSync(join(testDir, "bbbbbbbbbbbb-myproject", "sessions", "ao-2"), "status=working\n");

    const dirs = inventoryHashDirs(testDir);
    expect(dirs).toHaveLength(2);
    expect(dirs.every((d) => d.projectId === "myproject")).toBe(true);
  });

  it("returns empty array for non-existent directory", () => {
    const dirs = inventoryHashDirs(join(testDir, "nonexistent"));
    expect(dirs).toHaveLength(0);
  });
});

describe("convertKeyValueToJson", () => {
  it("converts basic key-value pairs", () => {
    const kv = [
      "project=myproject",
      "agent=claude-code",
      "status=working",
      "createdAt=2026-04-21T12:00:00.000Z",
      "branch=session/ao-1",
      "worktree=/home/user/.agent-orchestrator/abc-myproject/worktrees/ao-1",
    ].join("\n");

    const result = convertKeyValueToJson(kv);
    expect(result["project"]).toBe("myproject");
    expect(result["agent"]).toBe("claude-code");
    expect(result["createdAt"]).toBe("2026-04-21T12:00:00.000Z");
    expect(result["branch"]).toBe("session/ao-1");
    // status is NOT included (computed on read)
    expect(result).not.toHaveProperty("status");
  });

  it("converts statePayload to lifecycle object", () => {
    const lifecycle = {
      version: 2,
      session: { kind: "worker", state: "working" },
    };
    const kv = [
      "project=myproject",
      `statePayload=${JSON.stringify(lifecycle)}`,
      "stateVersion=2",
    ].join("\n");

    const result = convertKeyValueToJson(kv);
    expect(result["lifecycle"]).toEqual(lifecycle);
    // stateVersion is dropped (lives inside lifecycle)
    expect(result).not.toHaveProperty("stateVersion");
    expect(result).not.toHaveProperty("statePayload");
  });

  it("converts prAutoDetect on/off to boolean", () => {
    expect(convertKeyValueToJson("prAutoDetect=on")["prAutoDetect"]).toBe(true);
    expect(convertKeyValueToJson("prAutoDetect=off")["prAutoDetect"]).toBe(false);
  });

  it("converts port fields to numbers in dashboard group", () => {
    const kv = "dashboardPort=3000\nterminalWsPort=3001\ndirectTerminalWsPort=3002";
    const result = convertKeyValueToJson(kv);
    expect(result["dashboard"]).toEqual({
      port: 3000,
      terminalWsPort: 3001,
      directTerminalWsPort: 3002,
    });
  });

  it("groups agentReport fields", () => {
    const kv = [
      "agentReportedState=addressing_reviews",
      "agentReportedAt=2026-04-21T12:35:05.200Z",
      "agentReportedNote=Fixed 2 test regressions",
    ].join("\n");

    const result = convertKeyValueToJson(kv);
    expect(result["agentReport"]).toEqual({
      state: "addressing_reviews",
      at: "2026-04-21T12:35:05.200Z",
      note: "Fixed 2 test regressions",
    });
  });

  it("groups reportWatcher fields", () => {
    const kv = [
      "reportWatcherLastAuditedAt=2026-04-21T16:50:09.934Z",
      "reportWatcherActiveTrigger=stale_report",
      "reportWatcherTriggerActivatedAt=2026-04-21T13:12:39.670Z",
      "reportWatcherTriggerCount=133",
    ].join("\n");

    const result = convertKeyValueToJson(kv);
    expect(result["reportWatcher"]).toEqual({
      lastAuditedAt: "2026-04-21T16:50:09.934Z",
      activeTrigger: "stale_report",
      triggerActivatedAt: "2026-04-21T13:12:39.670Z",
      triggerCount: 133,
    });
  });

  it("groups detecting fields into lifecycle.detecting", () => {
    const lifecycle = {
      version: 2,
      session: { kind: "worker", state: "working" },
    };
    const kv = [
      `statePayload=${JSON.stringify(lifecycle)}`,
      "lifecycleEvidence=review_pending",
      "detectingAttempts=3",
      "detectingStartedAt=2026-04-21T12:00:00.000Z",
      "detectingEvidenceHash=abc123",
    ].join("\n");

    const result = convertKeyValueToJson(kv);
    const resultLifecycle = result["lifecycle"] as Record<string, unknown>;
    expect(resultLifecycle["detecting"]).toEqual({
      evidence: "review_pending",
      attempts: 3,
      startedAt: "2026-04-21T12:00:00.000Z",
      evidenceHash: "abc123",
    });
  });

  it("parses runtimeHandle JSON string", () => {
    const handle = { id: "ao-1", runtimeName: "tmux", data: {} };
    const kv = `runtimeHandle=${JSON.stringify(handle)}`;
    const result = convertKeyValueToJson(kv);
    expect(result["runtimeHandle"]).toEqual(handle);
  });
});

describe("migrateStorage", () => {
  let testDir: string;
  let aoBaseDir: string;
  let configPath: string;

  beforeEach(() => {
    testDir = createTempDir();
    aoBaseDir = join(testDir, ".agent-orchestrator");
    configPath = join(aoBaseDir, "config.yaml");
    mkdirSync(aoBaseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("migrates a single project with one session", async () => {
    // Setup: hash dir with one worker session
    const hashDir = join(aoBaseDir, "abcdef012345-myproject");
    mkdirSync(join(hashDir, "sessions"), { recursive: true });
    writeFileSync(
      join(hashDir, "sessions", "ao-1"),
      [
        "project=myproject",
        "agent=claude-code",
        "status=working",
        "createdAt=2026-04-21T12:00:00.000Z",
        "branch=session/ao-1",
        "worktree=/home/user/.agent-orchestrator/abcdef012345-myproject/worktrees/ao-1",
      ].join("\n"),
    );

    // Setup: config with storageKey
    writeFileSync(
      configPath,
      [
        "projects:",
        "  myproject:",
        "    path: /home/user/myproject",
        "    storageKey: abcdef012345",
        "    defaultBranch: main",
        "",
      ].join("\n"),
    );

    const logs: string[] = [];
    const result = await migrateStorage({
      aoBaseDir,
      globalConfigPath: configPath,
      force: true,
      log: (msg) => logs.push(msg),
    });

    expect(result.projects).toBe(1);
    expect(result.sessions).toBe(1);

    // Session file should exist in new location
    const sessionPath = join(aoBaseDir, "projects", "myproject", "sessions", "ao-1.json");
    expect(existsSync(sessionPath)).toBe(true);

    const session = JSON.parse(readFileSync(sessionPath, "utf-8"));
    expect(session.project).toBe("myproject");
    expect(session.agent).toBe("claude-code");
    expect(session.worktree).toBe("./worktrees/ao-1");
    // status should not be stored
    expect(session).not.toHaveProperty("status");

    // Old dir should be renamed to .migrated
    expect(existsSync(`${hashDir}.migrated`)).toBe(true);
    expect(existsSync(hashDir)).toBe(false);

    // Config should have storageKey stripped
    const configContent = readFileSync(configPath, "utf-8");
    expect(configContent).not.toContain("storageKey");
  });

  it("extracts orchestrator session to orchestrator.json", async () => {
    const hashDir = join(aoBaseDir, "abcdef012345-myproject");
    mkdirSync(join(hashDir, "sessions"), { recursive: true });

    // Orchestrator session
    writeFileSync(
      join(hashDir, "sessions", "ao-orchestrator-1"),
      [
        "project=myproject",
        "role=orchestrator",
        "agent=claude-code",
        "createdAt=2026-04-21T12:00:00.000Z",
      ].join("\n"),
    );

    // Worker session
    writeFileSync(
      join(hashDir, "sessions", "ao-1"),
      [
        "project=myproject",
        "agent=claude-code",
        "createdAt=2026-04-21T12:00:00.000Z",
        "branch=session/ao-1",
        "worktree=/tmp/worktrees/ao-1",
      ].join("\n"),
    );

    const result = await migrateStorage({
      aoBaseDir,
      globalConfigPath: configPath,
      force: true,
      log: () => {},
    });

    expect(result.projects).toBe(1);
    expect(result.sessions).toBe(1);

    // Orchestrator file should exist
    const orchPath = join(aoBaseDir, "projects", "myproject", "orchestrator.json");
    expect(existsSync(orchPath)).toBe(true);
    const orch = JSON.parse(readFileSync(orchPath, "utf-8"));
    expect(orch.role).toBe("orchestrator");
    // Orchestrator should not have worktree/branch
    expect(orch).not.toHaveProperty("worktree");
    expect(orch).not.toHaveProperty("branch");
  });

  it("merges multiple hash dirs for the same project", async () => {
    // Two hash dirs with different sessions for the same project
    const hash1 = join(aoBaseDir, "aaaaaaaaaaaa-myproject");
    const hash2 = join(aoBaseDir, "bbbbbbbbbbbb-myproject");
    mkdirSync(join(hash1, "sessions"), { recursive: true });
    mkdirSync(join(hash2, "sessions"), { recursive: true });

    writeFileSync(
      join(hash1, "sessions", "ao-1"),
      "project=myproject\nagent=claude-code\ncreatedAt=2026-04-21T12:00:00.000Z\nbranch=b1\nworktree=/tmp/w1",
    );
    writeFileSync(
      join(hash2, "sessions", "ao-2"),
      "project=myproject\nagent=claude-code\ncreatedAt=2026-04-21T13:00:00.000Z\nbranch=b2\nworktree=/tmp/w2",
    );

    const result = await migrateStorage({
      aoBaseDir,
      globalConfigPath: configPath,
      force: true,
      log: () => {},
    });

    expect(result.projects).toBe(1);
    expect(result.sessions).toBe(2);

    // Both sessions should be in the new location
    expect(existsSync(join(aoBaseDir, "projects", "myproject", "sessions", "ao-1.json"))).toBe(true);
    expect(existsSync(join(aoBaseDir, "projects", "myproject", "sessions", "ao-2.json"))).toBe(true);
  });

  it("handles duplicate session IDs across hash dirs", async () => {
    const hash1 = join(aoBaseDir, "aaaaaaaaaaaa-myproject");
    const hash2 = join(aoBaseDir, "bbbbbbbbbbbb-myproject");
    mkdirSync(join(hash1, "sessions"), { recursive: true });
    mkdirSync(join(hash2, "sessions"), { recursive: true });

    // Same session ID, different timestamps — newer wins
    writeFileSync(
      join(hash1, "sessions", "ao-1"),
      "project=myproject\ncreatedAt=2026-04-21T12:00:00.000Z\nbranch=b1\nworktree=/tmp/w1",
    );
    writeFileSync(
      join(hash2, "sessions", "ao-1"),
      "project=myproject\ncreatedAt=2026-04-21T14:00:00.000Z\nbranch=b2\nworktree=/tmp/w2",
    );

    const result = await migrateStorage({
      aoBaseDir,
      globalConfigPath: configPath,
      force: true,
      log: () => {},
    });

    expect(result.sessions).toBe(1);
    expect(result.archives).toBeGreaterThanOrEqual(1);

    // The newer session should be kept
    const session = JSON.parse(
      readFileSync(join(aoBaseDir, "projects", "myproject", "sessions", "ao-1.json"), "utf-8"),
    );
    expect(session.createdAt).toBe("2026-04-21T14:00:00.000Z");
  });

  it("deletes empty hash directories", async () => {
    mkdirSync(join(aoBaseDir, "abcdef012345-empty-project"), { recursive: true });

    const result = await migrateStorage({
      aoBaseDir,
      globalConfigPath: configPath,
      force: true,
      log: () => {},
    });

    expect(result.emptyDirsDeleted).toBe(1);
    expect(existsSync(join(aoBaseDir, "abcdef012345-empty-project"))).toBe(false);
  });

  it("dry run makes no changes", async () => {
    const hashDir = join(aoBaseDir, "abcdef012345-myproject");
    mkdirSync(join(hashDir, "sessions"), { recursive: true });
    writeFileSync(
      join(hashDir, "sessions", "ao-1"),
      "project=myproject\ncreatedAt=2026-04-21T12:00:00.000Z\nbranch=b\nworktree=/tmp/w",
    );

    await migrateStorage({
      aoBaseDir,
      globalConfigPath: configPath,
      force: true,
      dryRun: true,
      log: () => {},
    });

    // Nothing should have changed
    expect(existsSync(hashDir)).toBe(true);
    expect(existsSync(join(aoBaseDir, "projects"))).toBe(false);
  });

  it("reports nothing to migrate when no hash dirs exist", async () => {
    const result = await migrateStorage({
      aoBaseDir,
      globalConfigPath: configPath,
      force: true,
      log: () => {},
    });

    expect(result.projects).toBe(0);
    expect(result.sessions).toBe(0);
  });

  it("migrates archives with fixed filenames", async () => {
    const hashDir = join(aoBaseDir, "abcdef012345-myproject");
    mkdirSync(join(hashDir, "sessions", "archive"), { recursive: true });

    // Old archive with colon-containing timestamp
    writeFileSync(
      join(hashDir, "sessions", "archive", "ao-83_2026-04-20T14:30:52.000Z"),
      "project=myproject\ncreatedAt=2026-04-20T14:30:52.000Z\nbranch=b\nworktree=/tmp/w",
    );

    const result = await migrateStorage({
      aoBaseDir,
      globalConfigPath: configPath,
      force: true,
      log: () => {},
    });

    expect(result.archives).toBe(1);

    // Archive should exist in the new location with fixed filename
    const archiveDir = join(aoBaseDir, "projects", "myproject", "archive");
    const archiveFiles = readdirSync(archiveDir);
    expect(archiveFiles.length).toBe(1);
    expect(archiveFiles[0]).toBe("ao-83_20260420T143052Z.json");
  });

  it("converts key=value format to JSON during migration", async () => {
    const hashDir = join(aoBaseDir, "abcdef012345-myproject");
    mkdirSync(join(hashDir, "sessions"), { recursive: true });

    const lifecycle = JSON.stringify({
      version: 2,
      session: { kind: "worker", state: "working" },
    });

    writeFileSync(
      join(hashDir, "sessions", "ao-1"),
      [
        "project=myproject",
        "agent=claude-code",
        "status=working",
        "createdAt=2026-04-21T12:00:00.000Z",
        `statePayload=${lifecycle}`,
        "stateVersion=2",
        "prAutoDetect=on",
        "dashboardPort=3000",
        "agentReportedState=task_complete",
        "branch=session/ao-1",
        "worktree=/tmp/worktrees/ao-1",
      ].join("\n"),
    );

    await migrateStorage({
      aoBaseDir,
      globalConfigPath: configPath,
      force: true,
      log: () => {},
    });

    const session = JSON.parse(
      readFileSync(join(aoBaseDir, "projects", "myproject", "sessions", "ao-1.json"), "utf-8"),
    );

    expect(session.lifecycle).toEqual({
      version: 2,
      session: { kind: "worker", state: "working" },
    });
    expect(session.prAutoDetect).toBe(true);
    expect(session.dashboard).toEqual({ port: 3000 });
    expect(session.agentReport).toEqual({ state: "task_complete" });
    expect(session).not.toHaveProperty("status");
    expect(session).not.toHaveProperty("statePayload");
    expect(session).not.toHaveProperty("stateVersion");
  });
});

describe("rollbackStorage", () => {
  let testDir: string;
  let aoBaseDir: string;
  let configPath: string;

  beforeEach(() => {
    testDir = createTempDir();
    aoBaseDir = join(testDir, ".agent-orchestrator");
    configPath = join(aoBaseDir, "config.yaml");
    mkdirSync(aoBaseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("restores .migrated directories and removes projects/", async () => {
    // Simulate post-migration state
    mkdirSync(join(aoBaseDir, "abcdef012345-myproject.migrated", "sessions"), { recursive: true });
    mkdirSync(join(aoBaseDir, "projects", "myproject", "sessions"), { recursive: true });
    writeFileSync(
      join(aoBaseDir, "projects", "myproject", "sessions", "ao-1.json"),
      '{"project":"myproject"}',
    );

    // Config without storageKey
    writeFileSync(
      configPath,
      [
        "projects:",
        "  myproject:",
        "    path: /home/user/myproject",
        "    defaultBranch: main",
        "",
      ].join("\n"),
    );

    await rollbackStorage({
      aoBaseDir,
      globalConfigPath: configPath,
      log: () => {},
    });

    // .migrated should be restored
    expect(existsSync(join(aoBaseDir, "abcdef012345-myproject"))).toBe(true);
    expect(existsSync(join(aoBaseDir, "abcdef012345-myproject.migrated"))).toBe(false);

    // projects/ should be gone
    expect(existsSync(join(aoBaseDir, "projects"))).toBe(false);

    // storageKey should be re-added to config
    const configContent = readFileSync(configPath, "utf-8");
    expect(configContent).toContain("storageKey");
    expect(configContent).toContain("abcdef012345");
  });

  it("does nothing when no .migrated directories exist", async () => {
    const logs: string[] = [];
    await rollbackStorage({
      aoBaseDir,
      globalConfigPath: configPath,
      log: (msg) => logs.push(msg),
    });

    expect(logs.some((l) => l.includes("Nothing to rollback"))).toBe(true);
  });
});
