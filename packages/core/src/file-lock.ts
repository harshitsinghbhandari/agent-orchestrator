/**
 * File-based locking utility for preventing race conditions.
 *
 * Uses O_EXCL (exclusive create) for atomic lock file creation.
 * Lock files contain `pid:timestamp` for stale lock detection.
 */

import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  constants,
} from "node:fs";

export interface FileLockOptions {
  /** Maximum time to wait for lock acquisition (default: 5000ms) */
  lockTimeoutMs?: number;
  /** Time after which a lock is considered stale (default: 30000ms) */
  lockExpirationMs?: number;
  /** Interval between retry attempts (default: 100ms) */
  retryIntervalMs?: number;
}

export interface FileLock {
  /** Release the lock. Safe to call multiple times. */
  release(): void;
  /** Check if this lock instance still owns the lock file. */
  isHeld(): boolean;
}

const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_EXPIRATION_MS = 30000;
const DEFAULT_RETRY_INTERVAL_MS = 100;

/**
 * Format lock file content: `pid:timestamp`
 */
function formatLockContent(): string {
  return `${process.pid}:${Date.now()}`;
}

/**
 * Parse lock file content to extract pid and timestamp.
 * Returns null if content is invalid.
 */
function parseLockContent(content: string): { pid: number; timestamp: number } | null {
  const match = content.trim().match(/^(\d+):(\d+)$/);
  if (!match) return null;
  const pid = parseInt(match[1], 10);
  const timestamp = parseInt(match[2], 10);
  if (Number.isNaN(pid) || Number.isNaN(timestamp)) return null;
  return { pid, timestamp };
}

/**
 * Check if a lock file is stale (older than expiration threshold).
 */
function isLockStale(lockPath: string, expirationMs: number): boolean {
  try {
    const content = readFileSync(lockPath, "utf-8");
    const parsed = parseLockContent(content);
    if (!parsed) {
      // Invalid content - treat as stale
      return true;
    }
    const age = Date.now() - parsed.timestamp;
    return age > expirationMs;
  } catch {
    // Can't read file - treat as not stale (may have been released)
    return false;
  }
}

/**
 * Check if this process owns the lock.
 */
function isOwnedByUs(lockPath: string): boolean {
  try {
    const content = readFileSync(lockPath, "utf-8");
    const parsed = parseLockContent(content);
    return parsed !== null && parsed.pid === process.pid;
  } catch {
    return false;
  }
}

/**
 * Try to acquire the lock file atomically using O_EXCL.
 * Returns true if lock was acquired, false otherwise.
 */
function tryAcquireLock(lockPath: string): boolean {
  try {
    // O_EXCL fails if file exists - atomic create
    const fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    const content = formatLockContent();
    writeFileSync(lockPath, content, "utf-8");
    closeSync(fd);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return false;
    }
    throw err;
  }
}

/**
 * Remove a stale lock file if it exists and is stale.
 * Returns true if a stale lock was removed.
 */
function removeStaleIfNeeded(lockPath: string, expirationMs: number): boolean {
  if (!existsSync(lockPath)) return false;
  if (!isLockStale(lockPath, expirationMs)) return false;

  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    // Another process may have removed it or acquired it
    return false;
  }
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a file-based lock.
 *
 * @param lockPath - Path to the lock file
 * @param options - Lock configuration options
 * @returns A FileLock object for releasing the lock
 * @throws Error if lock cannot be acquired within timeout
 */
export async function createFileLock(
  lockPath: string,
  options?: FileLockOptions,
): Promise<FileLock> {
  const lockTimeoutMs = options?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const lockExpirationMs = options?.lockExpirationMs ?? DEFAULT_LOCK_EXPIRATION_MS;
  const retryIntervalMs = options?.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;

  const startTime = Date.now();
  let acquired = false;

  while (!acquired) {
    // Check for timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= lockTimeoutMs) {
      throw new Error(
        `Failed to acquire lock on ${lockPath} after ${lockTimeoutMs}ms`,
      );
    }

    // Try to remove stale lock
    removeStaleIfNeeded(lockPath, lockExpirationMs);

    // Try to acquire
    acquired = tryAcquireLock(lockPath);

    if (!acquired) {
      // Wait before retrying with slight jitter to reduce contention
      const jitter = Math.random() * (retryIntervalMs * 0.2);
      await sleep(retryIntervalMs + jitter);
    }
  }

  let released = false;

  return {
    release(): void {
      if (released) return;
      released = true;

      // Only release if we still own the lock
      if (isOwnedByUs(lockPath)) {
        try {
          unlinkSync(lockPath);
        } catch {
          // Best effort - file may have been removed by cleanup
        }
      }
    },

    isHeld(): boolean {
      if (released) return false;
      return isOwnedByUs(lockPath);
    },
  };
}

/**
 * Execute a function while holding a file lock.
 *
 * @param lockPath - Path to the lock file
 * @param fn - Async function to execute while holding the lock
 * @param options - Lock configuration options
 * @returns The result of the function
 * @throws Error if lock cannot be acquired or function throws
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options?: FileLockOptions,
): Promise<T> {
  const lock = await createFileLock(lockPath, options);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
