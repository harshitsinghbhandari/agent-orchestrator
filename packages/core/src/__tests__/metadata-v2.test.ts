import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reserveSessionId, writeSessionMetadata, readSessionMetadata, listSessionIds } from '../metadata-v2.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('metadata-v2.ts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ao-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reserves a session id', () => {
    const success1 = reserveSessionId(tmpDir, 'test-session-1');
    expect(success1).toBe(true);

    const success2 = reserveSessionId(tmpDir, 'test-session-1');
    expect(success2).toBe(false);
  });

  it('writes and reads session metadata', () => {
    writeSessionMetadata(tmpDir, 'test-session-2', {
      worktree: '/tmp/worktree',
      branch: 'main',
      status: 'working'
    });

    const meta = readSessionMetadata(tmpDir, 'test-session-2');
    expect(meta).toBeDefined();
    expect(meta?.worktree).toBe('/tmp/worktree');
    expect(meta?.branch).toBe('main');
  });

  it('lists session ids', () => {
    reserveSessionId(tmpDir, 'test-session-3');
    reserveSessionId(tmpDir, 'test-session-4');

    const ids = listSessionIds(tmpDir);
    expect(ids).toContain('test-session-3');
    expect(ids).toContain('test-session-4');
  });
});
