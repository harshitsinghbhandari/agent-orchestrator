import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Session } from "@aoagents/ao-core";

// Redirect homedir() so kimiShareDir() picks our temp dir per test.
let fakeHome = "";
vi.mock("node:os", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    homedir: () => fakeHome,
  };
});

import {
  _resetSessionMatchCache,
  captureKimiBaseline,
  findKimiSessionMatch,
  isKimiSessionFile,
  kimiShareDir,
} from "../session-discovery.js";

function workspaceHash(workspacePath: string): string {
  return createHash("md5").update(workspacePath).digest("hex");
}

/** Write a Kimi session directory with both live-signal files. */
function writeKimiSession(
  workspacePath: string,
  sessionId: string,
  opts: { mtimeMs?: number } = {},
): string {
  const bucket = join(fakeHome, ".kimi", "sessions", workspaceHash(workspacePath));
  const dir = join(bucket, sessionId);
  mkdirSync(dir, { recursive: true });
  const ctx = join(dir, "context.jsonl");
  const wire = join(dir, "wire.jsonl");
  writeFileSync(ctx, "{}\n");
  writeFileSync(wire, "{}\n");
  if (opts.mtimeMs !== undefined) {
    const seconds = opts.mtimeMs / 1000;
    utimesSync(ctx, seconds, seconds);
    utimesSync(wire, seconds, seconds);
  }
  return dir;
}

function makeSession(workspacePath: string, createdAt = new Date()): Session {
  return {
    id: "ao-test",
    workspacePath,
    createdAt,
  } as unknown as Session;
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "kimi-disco-test-"));
  _resetSessionMatchCache();
  delete process.env["KIMI_SHARE_DIR"];
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("kimiShareDir", () => {
  it("defaults to <home>/.kimi", () => {
    expect(kimiShareDir()).toBe(join(fakeHome, ".kimi"));
  });

  it("respects the KIMI_SHARE_DIR override when set", () => {
    process.env["KIMI_SHARE_DIR"] = "/custom/kimi";
    expect(kimiShareDir()).toBe("/custom/kimi");
  });

  it("ignores empty/whitespace-only KIMI_SHARE_DIR", () => {
    process.env["KIMI_SHARE_DIR"] = "   ";
    expect(kimiShareDir()).toBe(join(fakeHome, ".kimi"));
  });
});

describe("isKimiSessionFile", () => {
  it("returns true for a regular file", async () => {
    const file = join(fakeHome, "regular.txt");
    writeFileSync(file, "hi");
    expect(await isKimiSessionFile(file)).toBe(true);
  });

  it("returns false for a symlink (sandbox check rejects non-regular files)", async () => {
    const target = join(fakeHome, "target.txt");
    writeFileSync(target, "hi");
    const link = join(fakeHome, "link.txt");
    symlinkSync(target, link);
    expect(await isKimiSessionFile(link)).toBe(false);
  });

  it("returns false for a directory", async () => {
    const dir = join(fakeHome, "subdir");
    mkdirSync(dir);
    expect(await isKimiSessionFile(dir)).toBe(false);
  });

  it("returns false when the path does not exist", async () => {
    expect(await isKimiSessionFile(join(fakeHome, "missing"))).toBe(false);
  });
});

describe("captureKimiBaseline", () => {
  it("snapshots existing UUIDs in the workspace's bucket", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "kimi-ws-")));
    try {
      writeKimiSession(workspace, "uuid-pre-1");
      writeKimiSession(workspace, "uuid-pre-2");

      await captureKimiBaseline(workspace);

      const baselinePath = join(workspace, ".ao", "kimi-baseline.json");
      const parsed = JSON.parse(readFileSync(baselinePath, "utf-8")) as {
        preExistingUuids: string[];
        capturedAt: string;
      };
      expect(parsed.preExistingUuids.sort()).toEqual(["uuid-pre-1", "uuid-pre-2"]);
      expect(typeof parsed.capturedAt).toBe("string");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("captures an empty baseline when the bucket doesn't exist yet", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "kimi-ws-")));
    try {
      await captureKimiBaseline(workspace);
      const baselinePath = join(workspace, ".ao", "kimi-baseline.json");
      const parsed = JSON.parse(readFileSync(baselinePath, "utf-8")) as {
        preExistingUuids: string[];
      };
      expect(parsed.preExistingUuids).toEqual([]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing baseline (preserves restore semantics)", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "kimi-ws-")));
    try {
      mkdirSync(join(workspace, ".ao"));
      const original = { preExistingUuids: ["from-disk"], capturedAt: "2020-01-01T00:00:00Z" };
      writeFileSync(
        join(workspace, ".ao", "kimi-baseline.json"),
        JSON.stringify(original),
        "utf-8",
      );

      // Write some "new" sessions that would be picked up if baseline overwrote.
      writeKimiSession(workspace, "uuid-new-1");

      await captureKimiBaseline(workspace);

      const parsed = JSON.parse(
        readFileSync(join(workspace, ".ao", "kimi-baseline.json"), "utf-8"),
      ) as { preExistingUuids: string[] };
      expect(parsed.preExistingUuids).toEqual(["from-disk"]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe("findKimiSessionMatch", () => {
  it("returns null when the session has no workspace path", async () => {
    const result = await findKimiSessionMatch({} as Session);
    expect(result).toBeNull();
  });

  it("returns null when the kimi sessions root doesn't exist", async () => {
    // No bucket written — sandbox check fails closed.
    const session = makeSession(realpathSync(mkdtempSync(join(tmpdir(), "kimi-empty-"))));
    const result = await findKimiSessionMatch(session);
    expect(result).toBeNull();
  });

  it("picks the freshest live session via recency heuristic and pins it", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "kimi-ws-")));
    try {
      // Capture baseline BEFORE adding session — so AO sees it as "new".
      await captureKimiBaseline(workspace);

      const now = Date.now();
      writeKimiSession(workspace, "uuid-new", { mtimeMs: now });

      const session = makeSession(workspace, new Date(now - 5_000));
      const match = await findKimiSessionMatch(session);

      expect(match).not.toBeNull();
      expect(match?.sessionId).toBe("uuid-new");

      // Pin file should now exist for next-run dominance.
      const pin = JSON.parse(
        readFileSync(join(workspace, ".ao", "kimi-session-id.json"), "utf-8"),
      ) as { sessionId: string };
      expect(pin.sessionId).toBe("uuid-new");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("ignores baseline (pre-existing) UUIDs even if newer", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "kimi-ws-")));
    try {
      // Pre-existing session captured into baseline.
      writeKimiSession(workspace, "uuid-old", { mtimeMs: Date.now() });
      await captureKimiBaseline(workspace);

      const session = makeSession(workspace, new Date(Date.now() - 10_000));
      const match = await findKimiSessionMatch(session);

      // No new sessions and the only candidate is in the baseline → null.
      expect(match).toBeNull();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("prefers the pin file over the recency winner once written", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "kimi-ws-")));
    try {
      await captureKimiBaseline(workspace);
      const now = Date.now();
      writeKimiSession(workspace, "uuid-pinned", { mtimeMs: now - 60_000 });
      writeKimiSession(workspace, "uuid-newer", { mtimeMs: now });

      // Manually write a pin to "uuid-pinned".
      mkdirSync(join(workspace, ".ao"), { recursive: true });
      writeFileSync(
        join(workspace, ".ao", "kimi-session-id.json"),
        JSON.stringify({ sessionId: "uuid-pinned", pinnedAt: new Date().toISOString() }),
        "utf-8",
      );

      const session = makeSession(workspace, new Date(now - 10 * 60_000));
      const match = await findKimiSessionMatch(session);

      expect(match?.sessionId).toBe("uuid-pinned");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("returns null when the pinned UUID no longer has live signals", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "kimi-ws-")));
    try {
      await captureKimiBaseline(workspace);
      const now = Date.now();
      writeKimiSession(workspace, "uuid-other", { mtimeMs: now });

      mkdirSync(join(workspace, ".ao"), { recursive: true });
      writeFileSync(
        join(workspace, ".ao", "kimi-session-id.json"),
        JSON.stringify({ sessionId: "uuid-vanished", pinnedAt: new Date().toISOString() }),
        "utf-8",
      );

      const session = makeSession(workspace, new Date(now - 10_000));
      const match = await findKimiSessionMatch(session);

      // Pin existed but didn't match — must NOT silently fall back to a recency guess.
      expect(match).toBeNull();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("ignores sessions older than session.createdAt - 60s grace", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "kimi-ws-")));
    try {
      await captureKimiBaseline(workspace);
      const sessionStart = Date.now();
      // Session was active 5 minutes before AO launched.
      writeKimiSession(workspace, "uuid-stale", { mtimeMs: sessionStart - 5 * 60_000 });

      const session = makeSession(workspace, new Date(sessionStart));
      const match = await findKimiSessionMatch(session);
      expect(match).toBeNull();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("pins the first match so a newer UUID appearing later doesn't steal the session", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "kimi-ws-")));
    try {
      await captureKimiBaseline(workspace);
      const now = Date.now();
      writeKimiSession(workspace, "uuid-A", { mtimeMs: now });

      const session = makeSession(workspace, new Date(now - 5_000));
      const first = await findKimiSessionMatch(session);
      expect(first?.sessionId).toBe("uuid-A");

      // Add a newer session AFTER first lookup. The pin written on the
      // first call must keep "uuid-A" sticky.
      writeKimiSession(workspace, "uuid-B", { mtimeMs: now + 60_000 });
      const second = await findKimiSessionMatch(session);
      expect(second?.sessionId).toBe("uuid-A");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("uses kimi.json's last_session_id as the soft-pin tiebreaker before recency", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "kimi-ws-")));
    try {
      await captureKimiBaseline(workspace);
      const now = Date.now();
      // The recency winner would be uuid-fresh (newer mtime), but kimi.json
      // points at uuid-soft-pin — and the soft-pin must win.
      writeKimiSession(workspace, "uuid-fresh", { mtimeMs: now });
      writeKimiSession(workspace, "uuid-soft-pin", { mtimeMs: now - 30_000 });

      const kimiJsonPath = join(fakeHome, ".kimi", "kimi.json");
      writeFileSync(
        kimiJsonPath,
        JSON.stringify({
          work_dirs: [{ path: workspace, last_session_id: "uuid-soft-pin" }],
        }),
        "utf-8",
      );

      const session = makeSession(workspace, new Date(now - 60_000));
      const match = await findKimiSessionMatch(session);

      expect(match?.sessionId).toBe("uuid-soft-pin");

      // Soft-pin winners are persisted to the AO pin file for next-run dominance.
      const pin = JSON.parse(
        readFileSync(join(workspace, ".ao", "kimi-session-id.json"), "utf-8"),
      ) as { sessionId: string };
      expect(pin.sessionId).toBe("uuid-soft-pin");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("ignores a kimi.json soft-pin pointing at a baseline (pre-existing) UUID", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "kimi-ws-")));
    try {
      const now = Date.now();
      // Baseline captures uuid-old as pre-existing.
      writeKimiSession(workspace, "uuid-old", { mtimeMs: now });
      await captureKimiBaseline(workspace);

      // After baseline, AO launches and kimi-cli writes uuid-old as soft-pin
      // (stale pointer to a session that predates AO).
      writeFileSync(
        join(fakeHome, ".kimi", "kimi.json"),
        JSON.stringify({
          work_dirs: [{ path: workspace, last_session_id: "uuid-old" }],
        }),
        "utf-8",
      );

      const session = makeSession(workspace, new Date(now - 5_000));
      const match = await findKimiSessionMatch(session);

      // Baseline filter applies BEFORE soft-pin — stale pointer is rejected.
      expect(match).toBeNull();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
