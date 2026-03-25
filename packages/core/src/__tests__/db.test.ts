import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDatabase } from '../db.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('db.ts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ao-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates database and tables', () => {
    const db = getDatabase(tmpDir);
    expect(db).toBeDefined();

    const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'");
    const row = stmt.get();
    expect(row).toBeDefined();
  });
});
