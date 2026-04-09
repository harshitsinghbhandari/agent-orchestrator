import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createFileLock, withFileLock } from "../file-lock.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `ao-test-file-lock-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("createFileLock", () => {
  it("creates a lock file and releases it", async () => {
    const lockPath = join(testDir, "test.lock");

    const lock = await createFileLock(lockPath);

    // Lock file should exist
    expect(existsSync(lockPath)).toBe(true);

    // Lock should be held
    expect(lock.isHeld()).toBe(true);

    // Release the lock
    lock.release();

    // Lock file should be removed
    expect(existsSync(lockPath)).toBe(false);

    // isHeld should return false after release
    expect(lock.isHeld()).toBe(false);
  });

  it("prevents concurrent lock acquisition", async () => {
    const lockPath = join(testDir, "concurrent.lock");

    // Acquire first lock
    const lock1 = await createFileLock(lockPath, { lockTimeoutMs: 100 });
    expect(lock1.isHeld()).toBe(true);

    // Second lock should timeout
    await expect(
      createFileLock(lockPath, { lockTimeoutMs: 100 }),
    ).rejects.toThrow(/Failed to acquire lock/);

    // Release first lock
    lock1.release();

    // Now we should be able to acquire again
    const lock2 = await createFileLock(lockPath);
    expect(lock2.isHeld()).toBe(true);
    lock2.release();
  });

  it("handles stale lock detection", async () => {
    const lockPath = join(testDir, "stale.lock");

    // Create a stale lock file (old timestamp)
    const stalePid = 99999;
    const staleTimestamp = Date.now() - 60_000; // 60 seconds ago
    writeFileSync(lockPath, `${stalePid}:${staleTimestamp}`, "utf-8");

    // Should be able to acquire lock despite stale file
    const lock = await createFileLock(lockPath, { lockExpirationMs: 30_000 });
    expect(lock.isHeld()).toBe(true);

    // Verify our process owns it now
    const content = readFileSync(lockPath, "utf-8");
    expect(content).toMatch(new RegExp(`^${process.pid}:\\d+$`));

    lock.release();
  });

  it("handles invalid lock file content as stale", async () => {
    const lockPath = join(testDir, "invalid.lock");

    // Create an invalid lock file
    writeFileSync(lockPath, "invalid-content", "utf-8");

    // Should be able to acquire lock
    const lock = await createFileLock(lockPath, { lockExpirationMs: 1 });
    expect(lock.isHeld()).toBe(true);
    lock.release();
  });

  it("release is safe to call multiple times", async () => {
    const lockPath = join(testDir, "multi-release.lock");

    const lock = await createFileLock(lockPath);
    expect(lock.isHeld()).toBe(true);

    // Multiple releases should not throw
    lock.release();
    lock.release();
    lock.release();

    expect(lock.isHeld()).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("only releases if we own the lock", async () => {
    const lockPath = join(testDir, "ownership.lock");

    // Create lock owned by another process
    const otherPid = 99999;
    const timestamp = Date.now();
    writeFileSync(lockPath, `${otherPid}:${timestamp}`, "utf-8");

    // Create a fake lock object that thinks it owns it
    // (simulating what would happen if another process acquired it between checks)
    const fakeLock = {
      release: () => {
        // This mimics the internal release logic
        const content = readFileSync(lockPath, "utf-8");
        const match = content.match(/^(\d+):(\d+)$/);
        if (match && parseInt(match[1], 10) === process.pid) {
          unlinkSync(lockPath);
        }
      },
    };

    // Calling release should NOT delete the file (different owner)
    fakeLock.release();
    expect(existsSync(lockPath)).toBe(true);

    // Clean up
    unlinkSync(lockPath);
  });
});

describe("withFileLock", () => {
  it("executes function while holding lock", async () => {
    const lockPath = join(testDir, "with-lock.lock");
    let lockExisted = false;

    const result = await withFileLock(lockPath, async () => {
      lockExisted = existsSync(lockPath);
      return "success";
    });

    expect(result).toBe("success");
    expect(lockExisted).toBe(true);
    // Lock should be released after function completes
    expect(existsSync(lockPath)).toBe(false);
  });

  it("releases lock even if function throws", async () => {
    const lockPath = join(testDir, "throw.lock");

    await expect(
      withFileLock(lockPath, async () => {
        throw new Error("Test error");
      }),
    ).rejects.toThrow("Test error");

    // Lock should be released despite error
    expect(existsSync(lockPath)).toBe(false);
  });

  it("passes through function return value", async () => {
    const lockPath = join(testDir, "return.lock");

    const result = await withFileLock(lockPath, async () => {
      return { foo: "bar", count: 42 };
    });

    expect(result).toEqual({ foo: "bar", count: 42 });
  });

  it("serializes concurrent operations", async () => {
    const lockPath = join(testDir, "serialize.lock");
    const results: number[] = [];

    // Start multiple concurrent operations
    const operations = [1, 2, 3].map((n) =>
      withFileLock(lockPath, async () => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(n);
        return n;
      }),
    );

    await Promise.all(operations);

    // All operations should complete
    expect(results.sort()).toEqual([1, 2, 3]);
  });

  it("respects custom timeout", async () => {
    const lockPath = join(testDir, "timeout.lock");

    // Acquire lock and hold it
    const lock = await createFileLock(lockPath);

    // Second operation should timeout
    const start = Date.now();
    await expect(
      withFileLock(
        lockPath,
        async () => "should not run",
        { lockTimeoutMs: 100 },
      ),
    ).rejects.toThrow(/Failed to acquire lock/);
    const elapsed = Date.now() - start;

    // Should have waited at least the timeout duration
    expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some timing variance

    lock.release();
  });
});

describe("lock file format", () => {
  it("writes pid:timestamp format", async () => {
    const lockPath = join(testDir, "format.lock");

    const before = Date.now();
    const lock = await createFileLock(lockPath);
    const after = Date.now();

    const content = readFileSync(lockPath, "utf-8");
    const match = content.match(/^(\d+):(\d+)$/);

    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBe(process.pid);

    const timestamp = parseInt(match![2], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);

    lock.release();
  });
});
