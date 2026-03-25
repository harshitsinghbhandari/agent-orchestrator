import { describe, it, expect, vi } from 'vitest';
import { DAGExecutor } from '../dag-executor.js';
import type { DecompositionPlan, TaskNode } from '../decomposer.js';
import type { SessionManager, Session } from '../types.js';

describe('dag-executor', () => {
  it('executes a DAG sequentially by tiers', async () => {
    const root: TaskNode = {
      id: 'root',
      description: 'root',
      depth: 0,
      lineage: [],
      children: [
        { id: '1', description: 'task 1', depth: 1, lineage: ['root'], children: [], status: 'pending', depends_on: [], inputs: [], outputs: [] },
        { id: '2', description: 'task 2', depth: 1, lineage: ['root'], children: [], status: 'pending', depends_on: ['1'], inputs: [], outputs: [] },
        { id: '3', description: 'task 3', depth: 1, lineage: ['root'], children: [], status: 'pending', depends_on: ['2'], inputs: [], outputs: [] }
      ],
      status: 'pending',
      depends_on: [], inputs: [], outputs: []
    };

    const plan: DecompositionPlan = {
      id: 'plan-1',
      rootTask: 'root',
      tree: root,
      maxDepth: 3,
      phase: 'executing',
      createdAt: new Date().toISOString()
    };

    const mockSessionManager = {
      spawn: vi.fn().mockResolvedValue({ id: 's-1', status: 'spawning' }),
      get: vi.fn().mockResolvedValue({ id: 's-1', status: 'done' })
    } as unknown as SessionManager;

    const executor = new DAGExecutor(plan, {
      sessionManager: mockSessionManager,
      projectId: 'proj-1'
    });

    await executor.execute();
    expect(executor.getState()).toBe('completed');
    expect(mockSessionManager.spawn).toHaveBeenCalledTimes(3);
  });

  it('pauses and notifies on failure after max retries', async () => {
    const root: TaskNode = {
      id: 'root',
      description: 'root',
      depth: 0,
      lineage: [],
      children: [
        { id: '1', description: 'task 1', depth: 1, lineage: ['root'], children: [], status: 'pending', depends_on: [], inputs: [], outputs: [] }
      ],
      status: 'pending',
      depends_on: [], inputs: [], outputs: []
    };

    const plan: DecompositionPlan = {
      id: 'plan-2',
      rootTask: 'root',
      tree: root,
      maxDepth: 3,
      phase: 'executing',
      createdAt: new Date().toISOString()
    };

    const mockSessionManager = {
      spawn: vi.fn().mockResolvedValue({ id: 's-fail', status: 'spawning' }),
      get: vi.fn().mockResolvedValue({ id: 's-fail', status: 'errored' }) // Fails
    } as unknown as SessionManager;

    const notifications: string[] = [];
    const executor = new DAGExecutor(plan, {
      sessionManager: mockSessionManager,
      projectId: 'proj-1',
      onNotify: (msg) => notifications.push(msg)
    });

    await executor.execute();
    expect(executor.getState()).toBe('paused');
    expect(mockSessionManager.spawn).toHaveBeenCalledTimes(3); // 1 try + 2 retries
    expect(notifications[0]).toContain('failed after 3 retries');
  });
});
