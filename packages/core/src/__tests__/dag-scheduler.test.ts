import { describe, it, expect } from 'vitest';
import { validateDAG } from '../decomposer.js';
import { computeTiers, criticalPath, getReadyNodes, completeNode } from '../dag-scheduler.js';

describe('dag-scheduler', () => {
  it('detects cycles', () => {
    const nodes = [
      { id: '1', depends_on: ['2'], children: [] },
      { id: '2', depends_on: ['1'], children: [] },
      { id: '3', depends_on: [], children: [] }
    ] as any;

    const res = validateDAG(nodes);
    expect(res.valid).toBe(false);
    expect(res.cycle).toBeDefined();
  });

  it('computes tiers for linear DAG', () => {
    const root = {
      id: 'root',
      children: [
        { id: '1', depends_on: [], children: [], status: 'pending' },
        { id: '2', depends_on: ['1'], children: [], status: 'pending' },
        { id: '3', depends_on: ['2'], children: [], status: 'pending' }
      ]
    } as any;

    const tiers = computeTiers(root);
    expect(tiers.length).toBe(3);
    expect(tiers[0].nodes[0].id).toBe('1');
    expect(tiers[1].nodes[0].id).toBe('2');
    expect(tiers[2].nodes[0].id).toBe('3');
  });

  it('computes tiers for diamond DAG', () => {
    const root = {
      id: 'root',
      children: [
        { id: 'A', depends_on: [], children: [], status: 'pending' },
        { id: 'B', depends_on: ['A'], children: [], status: 'pending' },
        { id: 'C', depends_on: ['A'], children: [], status: 'pending' },
        { id: 'D', depends_on: ['B', 'C'], children: [], status: 'pending' }
      ]
    } as any;

    const tiers = computeTiers(root);
    expect(tiers.length).toBe(3);
    expect(tiers[0].nodes.map(n => n.id)).toEqual(['A']);
    expect(tiers[1].nodes.map(n => n.id).sort()).toEqual(['B', 'C']);
    expect(tiers[2].nodes.map(n => n.id)).toEqual(['D']);
  });

  it('computes critical path correctly', () => {
    const root = {
      id: 'root',
      children: [
        { id: 'A', depends_on: [], children: [], status: 'pending' },
        { id: 'B', depends_on: ['A'], children: [], status: 'pending' },
        { id: 'C', depends_on: ['A'], children: [], status: 'pending' },
        { id: 'D', depends_on: ['B', 'C'], children: [], status: 'pending' },
        { id: 'E', depends_on: ['D'], children: [], status: 'pending' },
      ]
    } as any;

    const cp = criticalPath(root);
    const cpIds = cp.map(n => n.id);
    expect(cpIds[0]).toBe('A');
    expect(['B', 'C']).toContain(cpIds[1]); // Could be B or C depending on sort
    expect(cpIds[2]).toBe('D');
    expect(cpIds[3]).toBe('E');
    expect(cpIds.length).toBe(4);
  });

  it('resolves ready nodes and updates after completion', () => {
    const root = {
      id: 'root',
      children: [
        { id: '1', depends_on: [], children: [], status: 'pending' },
        { id: '2', depends_on: ['1'], children: [], status: 'pending' },
      ]
    } as any;

    let ready = getReadyNodes(root);
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('1');

    ready = completeNode(root, '1');
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('2');
  });
});
