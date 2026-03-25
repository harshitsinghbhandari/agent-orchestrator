import { type TaskNode } from "./decomposer.js";

export interface DAGTier {
  tier: number;
  nodes: TaskNode[];
}

/**
 * Computes topological tiers from a given root task.
 * All leaf tasks under the root are gathered, and dependencies
 * are resolved. Cycles will throw an error.
 */
export function computeTiers(root: TaskNode): DAGTier[] {
  // Extract all nodes that are not composite (leaves essentially)
  const allNodes: TaskNode[] = [];

  function traverse(node: TaskNode) {
    if (!node.children || node.children.length === 0) {
      allNodes.push(node);
    } else {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  traverse(root);

  const nodeMap = new Map<string, TaskNode>();
  for (const node of allNodes) {
    nodeMap.set(node.id, node);
  }

  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  for (const node of allNodes) {
    inDegree.set(node.id, 0);
    graph.set(node.id, []);
  }

  for (const node of allNodes) {
    for (const dep of node.depends_on || []) {
      if (graph.has(dep)) {
        graph.get(dep)!.push(node.id);
        inDegree.set(node.id, inDegree.get(node.id)! + 1);
      }
    }
  }

  const tiers: DAGTier[] = [];
  let currentTierNodes: string[] = [];

  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) currentTierNodes.push(id);
  }

  let tierIndex = 0;
  let visitedCount = 0;

  while (currentTierNodes.length > 0) {
    const nextTierNodes: string[] = [];
    const tierGroup: TaskNode[] = [];

    for (const id of currentTierNodes) {
      tierGroup.push(nodeMap.get(id)!);
      visitedCount++;

      for (const dependentId of graph.get(id)!) {
        const newDegree = inDegree.get(dependentId)! - 1;
        inDegree.set(dependentId, newDegree);
        if (newDegree === 0) {
          nextTierNodes.push(dependentId);
        }
      }
    }

    tiers.push({ tier: tierIndex++, nodes: tierGroup });
    currentTierNodes = nextTierNodes;
  }

  if (visitedCount !== allNodes.length) {
    throw new Error("DAG contains a cycle, cannot compute tiers.");
  }

  return tiers;
}

/**
 * Returns the critical path (longest path through the DAG)
 */
export function criticalPath(root: TaskNode): TaskNode[] {
  // Uses a topological sort to find the longest path
  const tiers = computeTiers(root);
  if (tiers.length === 0) return [];

  const allNodes: TaskNode[] = [];
  const nodeMap = new Map<string, TaskNode>();

  for (const t of tiers) {
    for (const n of t.nodes) {
      allNodes.push(n);
      nodeMap.set(n.id, n);
    }
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();

  for (const node of allNodes) {
    dist.set(node.id, 0);
    prev.set(node.id, null);
  }

  for (const t of tiers) {
    for (const u of t.nodes) {
      // Find dependents
      for (const v of allNodes) {
        if (v.depends_on && v.depends_on.includes(u.id)) {
          if (dist.get(u.id)! + 1 > dist.get(v.id)!) {
            dist.set(v.id, dist.get(u.id)! + 1);
            prev.set(v.id, u.id);
          }
        }
      }
    }
  }

  let maxDist = -1;
  let endNode: string | null = null;
  for (const [id, d] of dist.entries()) {
    if (d > maxDist) {
      maxDist = d;
      endNode = id;
    }
  }

  if (!endNode) return [];

  const path: TaskNode[] = [];
  let curr: string | null = endNode;
  while (curr !== null) {
    path.push(nodeMap.get(curr)!);
    curr = prev.get(curr)!;
  }

  return path.reverse();
}

/**
 * Returns all nodes that are ready to execute (all dependencies met, status pending)
 */
export function getReadyNodes(root: TaskNode): TaskNode[] {
  const allNodes: TaskNode[] = [];

  function traverse(node: TaskNode) {
    if (!node.children || node.children.length === 0) {
      allNodes.push(node);
    } else {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }
  traverse(root);

  const nodeMap = new Map<string, TaskNode>();
  for (const n of allNodes) {
    nodeMap.set(n.id, n);
  }

  const ready: TaskNode[] = [];

  for (const node of allNodes) {
    if (node.status === "pending") {
      let depsMet = true;
      for (const depId of node.depends_on || []) {
        const depNode = nodeMap.get(depId);
        if (depNode && depNode.status !== "done") {
          depsMet = false;
          break;
        }
      }
      if (depsMet) {
        ready.push(node);
      }
    }
  }

  return ready;
}

/**
 * Mark a node as completed and return newly unblocked nodes
 */
export function completeNode(root: TaskNode, nodeId: string): TaskNode[] {
  let targetNode: TaskNode | null = null;

  function traverse(node: TaskNode) {
    if (node.id === nodeId) {
      targetNode = node;
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }
  traverse(root);

  if (targetNode) {
    (targetNode as TaskNode).status = "done";
  }

  // Find newly ready nodes
  return getReadyNodes(root);
}
