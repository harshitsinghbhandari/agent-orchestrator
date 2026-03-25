/**
 * Task Decomposer — LLM-driven recursive task decomposition.
 *
 * Classifies issues as atomic (one agent can handle it) or composite
 * (needs to be broken into subtasks). Composite tasks are recursively
 * decomposed until all leaves are atomic.
 *
 * Integration: sits upstream of SessionManager.spawn(). When enabled,
 * complex issues are decomposed into child issues before agents are spawned.
 */

import Anthropic from "@anthropic-ai/sdk";

// =============================================================================
// TYPES
// =============================================================================

export type TaskKind = "atomic" | "composite";
export type TaskStatus = "pending" | "decomposing" | "ready" | "running" | "done" | "failed";

export interface TaskNode {
  id: string; // hierarchical: "1", "1.2", "1.2.3"
  depth: number;
  description: string;
  kind?: TaskKind;
  status: TaskStatus;
  lineage: string[]; // ancestor descriptions root→parent
  children: TaskNode[];
  depends_on: string[];      // NEW: list of node_id strings this task depends on
  inputs: string[];           // NEW: SSA-style artifact identifiers, e.g. "auth.py@v1"
  outputs: string[];          // NEW: SSA-style artifact identifiers, e.g. "auth.py@v2"
  risk_score?: number;        // NEW: 0.0 - 1.0 risk assessment
  parallelizable?: boolean;   // NEW: can run concurrently with siblings
  result?: string;
  issueId?: string; // tracker issue created for this subtask
  sessionId?: string; // AO session working on this task
}

export interface DecompositionPlan {
  id: string;
  rootTask: string;
  tree: TaskNode;
  maxDepth: number;
  phase: "decomposing" | "review" | "approved" | "executing" | "done" | "failed";
  createdAt: string;
  approvedAt?: string;
  parentIssueId?: string;
}

export interface DecomposerConfig {
  /** Enable auto-decomposition for backlog issues (default: false) */
  enabled: boolean;
  /** Max recursion depth (default: 3) */
  maxDepth: number;
  /** Model to use for decomposition (default: claude-sonnet-4-20250514) */
  model: string;
  /** Require human approval before executing decomposed plans (default: true) */
  requireApproval: boolean;
}

export const DEFAULT_DECOMPOSER_CONFIG: DecomposerConfig = {
  enabled: false,
  maxDepth: 3,
  model: "claude-sonnet-4-20250514",
  requireApproval: true,
};

// =============================================================================
// LINEAGE CONTEXT
// =============================================================================

/** Format the task lineage as an indented hierarchy for LLM context. */
export function formatLineage(lineage: string[], current: string): string {
  const parts = lineage.map((desc, i) => `${"  ".repeat(i)}${i}. ${desc}`);
  parts.push(`${"  ".repeat(lineage.length)}${lineage.length}. ${current}  <-- (this task)`);
  return parts.join("\n");
}

/** Format sibling tasks for awareness context. */
export function formatSiblings(siblings: string[], current: string): string {
  if (siblings.length === 0) return "";
  const lines = siblings.map((s) => (s === current ? `  - ${s}  <-- (you)` : `  - ${s}`));
  return `Sibling tasks being worked on in parallel:\n${lines.join("\n")}`;
}

// =============================================================================
// LLM CALLS
// =============================================================================

const CLASSIFY_SYSTEM = `You decide whether a software task is "atomic" or "composite".

- "atomic" = a developer can implement this directly without needing to plan further. It may involve multiple steps, but they're all part of one coherent unit of work.
- "composite" = this clearly contains 2+ independent concerns that should be worked on separately (e.g., backend + frontend, or auth + database + UI).

Decision heuristics:
- If the task names a single feature, endpoint, component, or module: atomic.
- If the task bundles unrelated concerns (e.g., "build auth and set up CI"): composite.
- If you're at depth 2 or deeper in the hierarchy, it is almost certainly atomic — only mark composite if you can name 2+ truly independent deliverables.
- When in doubt, choose atomic. Over-decomposition creates more overhead than under-decomposition.

Respond with ONLY the word "atomic" or "composite". Nothing else.`;

const DECOMPOSE_SYSTEM = `You are a pragmatic task decomposition engine for software projects.

Given a composite task, break it into the MINIMUM number of subtasks needed:
- A simple task might only need 2 subtasks.
- A complex task might need up to 7, but only if each is truly distinct.
- Do NOT pad with extra subtasks. Do NOT create "test and polish" or "define requirements" subtasks.
- Do NOT create subtasks that overlap or restate each other.
- Each subtask should represent real, distinct work.

Think about how an experienced developer would actually split this work.

Respond with a JSON array of strings, each being a subtask description. Example:
["Implement Stripe webhook handler", "Build subscription management UI"]

Nothing else — just the JSON array.`;

const DEPENDENCY_SYSTEM = `You are a dependency analyzer and SSA artifact mapper for software subtasks. Given a list of subtasks and a codebase context, perform two actions:
1. Identify which subtasks depend on which others.
2. Determine the SSA (Static Single Assignment) style input and output artifacts for each subtask.
   - Use the format \`filename@v{n}\` (e.g., \`auth.py@v1\`, \`main.ts@v2\`).
   - Every modified file produces a new version number.
   - A file consumed but not modified is just an input.

Respond with a JSON object mapping task IDs to objects with \`depends_on\`, \`inputs\`, and \`outputs\` arrays.
Example:
{
  "1.2": {
    "depends_on": ["1.1"],
    "inputs": ["auth.py@v1"],
    "outputs": ["auth.py@v2"]
  },
  "1.3": {
    "depends_on": ["1.1", "1.2"],
    "inputs": ["auth.py@v2", "main.ts@v1"],
    "outputs": ["main.ts@v2"]
  }
}
Tasks with no dependencies should have an empty \`depends_on\` array.
Only include real dependencies — do NOT make every task depend on the previous one.`;

const RISK_SCORE_SYSTEM = `You are a risk assessor for software tasks. Evaluate the provided task description and return a risk score from 0.0 to 1.0.
- 0.0 = Trivial (e.g. fixing a typo, updating a README)
- 0.5 = Moderate (e.g. adding a standard endpoint, UI component)
- 1.0 = High Risk (e.g. database migration, core logic rewrite, auth changes)

Respond with ONLY the numeric score (e.g., 0.3). Nothing else.`;

async function classifyTask(
  client: Anthropic,
  model: string,
  task: string,
  lineage: string[],
): Promise<TaskKind> {
  const context = formatLineage(lineage, task);
  const res = await client.messages.create({
    model,
    max_tokens: 10,
    system: CLASSIFY_SYSTEM,
    messages: [{ role: "user", content: `Task hierarchy:\n${context}` }],
  });

  const text = res.content[0].type === "text" ? res.content[0].text.trim().toLowerCase() : "";
  return text === "composite" ? "composite" : "atomic";
}

async function decomposeTask(
  client: Anthropic,
  model: string,
  task: string,
  lineage: string[],
): Promise<string[]> {
  const context = formatLineage(lineage, task);
  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    system: DECOMPOSE_SYSTEM,
    messages: [{ role: "user", content: `Task hierarchy:\n${context}` }],
  });

  const text = res.content[0].type === "text" ? res.content[0].text.trim() : "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Decomposition failed — no JSON array in response: ${text}`);
  }

  const subtasks = JSON.parse(jsonMatch[0]) as string[];
  if (!Array.isArray(subtasks) || subtasks.length < 2) {
    throw new Error(`Decomposition produced ${subtasks.length} subtasks — need at least 2`);
  }

  return subtasks;
}

export interface DependencyAnalysisResult {
  depends_on: string[];
  inputs: string[];
  outputs: string[];
}

async function analyzeDependencies(
  client: Anthropic,
  model: string,
  nodes: TaskNode[],
  lineage: string[],
  cycleInfo?: string
): Promise<Record<string, DependencyAnalysisResult>> {
  const nodeDescriptions = nodes.map(n => `${n.id}: ${n.description}`).join('\n');
  let cycleConstraint = "";
  if (cycleInfo) {
    cycleConstraint = `\nThe following dependency graph contained a cycle: ${cycleInfo}. Remove the edge that is least critical.`;
  }
  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    system: DEPENDENCY_SYSTEM + cycleConstraint,
    messages: [{ role: "user", content: `Lineage:\n${lineage.join(' > ')}\n\nSubtasks:\n${nodeDescriptions}` }],
  });

  const text = res.content[0].type === "text" ? res.content[0].text.trim() : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {};
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }
}

async function estimateRisk(
  client: Anthropic,
  model: string,
  description: string,
): Promise<number> {
  // Use a fast model for this if possible, defaulting to the passed model
  const res = await client.messages.create({
    model: "claude-3-haiku-20240307", // Haiku-class model as spec'd
    max_tokens: 10,
    system: RISK_SCORE_SYSTEM,
    messages: [{ role: "user", content: `Task: ${description}` }],
  });

  const text = res.content[0].type === "text" ? res.content[0].text.trim() : "0.5";
  const score = parseFloat(text);
  if (isNaN(score) || score < 0 || score > 1) {
    return 0.5;
  }
  return score;
}

export function validateSSAInvariant(nodes: TaskNode[]): { valid: boolean; violations: string[] } {
  const outputsCount: Record<string, number> = {};
  for (const node of nodes) {
    for (const out of node.outputs || []) {
      outputsCount[out] = (outputsCount[out] || 0) + 1;
    }
  }

  const violations: string[] = [];
  for (const [artifact, count] of Object.entries(outputsCount)) {
    if (count > 1) {
      violations.push(`Artifact ${artifact} is output by multiple nodes (${count} times).`);
    }
  }

  return { valid: violations.length === 0, violations };
}

export function validateDAG(nodes: TaskNode[]): { valid: boolean; cycle?: string[] } {
  const inDegree: Record<string, number> = {};
  const graph: Record<string, string[]> = {};

  for (const node of nodes) {
    inDegree[node.id] = 0;
    graph[node.id] = [];
  }

  for (const node of nodes) {
    for (const dep of node.depends_on) {
      if (graph[dep]) {
        graph[dep].push(node.id);
        inDegree[node.id] = (inDegree[node.id] || 0) + 1;
      }
    }
  }

  const queue: string[] = [];
  for (const id in inDegree) {
    if (inDegree[id] === 0) queue.push(id);
  }

  let visitedCount = 0;
  while (queue.length > 0) {
    const u = queue.shift()!;
    visitedCount++;
    for (const v of graph[u]) {
      inDegree[v]--;
      if (inDegree[v] === 0) {
        queue.push(v);
      }
    }
  }

  if (visitedCount !== nodes.length) {
    // Has cycle, we could trace the cycle but returning the nodes involved is enough for the LLM
    const cycleNodes = nodes.filter(n => inDegree[n.id] > 0).map(n => n.id);
    return { valid: false, cycle: cycleNodes };
  }

  return { valid: true };
}

// =============================================================================
// TREE OPERATIONS
// =============================================================================

function createTaskNode(
  id: string,
  description: string,
  depth: number,
  lineage: string[],
): TaskNode {
  return {
    id,
    depth,
    description,
    status: "pending",
    lineage,
    children: [],
    depends_on: [],
    inputs: [],
    outputs: []
  };
}

/** Recursively decompose a task tree (planning phase — no execution). */
async function planTree(
  client: Anthropic,
  model: string,
  task: TaskNode,
  maxDepth: number,
): Promise<TaskNode> {
  const kind = task.depth >= maxDepth ? "atomic" : await classifyTask(client, model, task.description, task.lineage);

  task.kind = kind;

  if (kind === "atomic") {
    task.status = "ready";
    return task;
  }

  task.status = "decomposing";
  const subtaskDescriptions = await decomposeTask(client, model, task.description, task.lineage);

  const childLineage = [...task.lineage, task.description];
  task.children = subtaskDescriptions.map((desc, i) =>
    createTaskNode(`${task.id}.${i + 1}`, desc, task.depth + 1, childLineage),
  );

  let valid = false;
  let cycleInfo: string | undefined;
  let retries = 0;

  while (!valid && retries < 3) {
    const deps = await analyzeDependencies(client, model, task.children, task.lineage, cycleInfo);
    for (const child of task.children) {
      const depInfo = deps[child.id];
      if (depInfo) {
        child.depends_on = depInfo.depends_on || [];
        child.inputs = depInfo.inputs || [];
        child.outputs = depInfo.outputs || [];
      } else {
        child.depends_on = [];
        child.inputs = [];
        child.outputs = [];
      }
    }
    const validation = validateDAG(task.children);
    valid = validation.valid;
    if (!valid) {
      cycleInfo = validation.cycle?.join(", ");
      retries++;
    }
  }

  // If we couldn't resolve the cycle after 3 retries, fallback to a sequential chain
  if (!valid) {
    for (let i = 0; i < task.children.length; i++) {
      if (i > 0) {
        task.children[i].depends_on = [task.children[i - 1].id];
      } else {
        task.children[i].depends_on = [];
      }
      task.children[i].inputs = [];
      task.children[i].outputs = [];
    }
  }

  // Recurse on children concurrently and compute risk scores
  await Promise.all(task.children.map(async (child) => {
    child.risk_score = await estimateRisk(client, model, child.description);
    return planTree(client, model, child, maxDepth);
  }));

  task.status = "ready";
  return task;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/** Create a decomposition plan for a task. */
export async function decompose(
  taskDescription: string,
  config: DecomposerConfig = DEFAULT_DECOMPOSER_CONFIG,
): Promise<DecompositionPlan> {
  const client = new Anthropic();
  const tree = createTaskNode("1", taskDescription, 0, []);

  await planTree(client, config.model, tree, config.maxDepth);

  return {
    id: `plan-${Date.now()}`,
    rootTask: taskDescription,
    tree,
    maxDepth: config.maxDepth,
    phase: config.requireApproval ? "review" : "approved",
    createdAt: new Date().toISOString(),
  };
}

/** Collect all leaf (atomic) tasks from a tree. */
export function getLeaves(task: TaskNode): TaskNode[] {
  if (task.children.length === 0) return [task];
  return task.children.flatMap(getLeaves);
}

/** Get sibling task descriptions for a given task. */
export function getSiblings(root: TaskNode, taskId: string): string[] {
  function findParent(node: TaskNode): TaskNode | null {
    for (const child of node.children) {
      if (child.id === taskId) return node;
      const found = findParent(child);
      if (found) return found;
    }
    return null;
  }

  const parent = findParent(root);
  if (!parent) return [];
  return parent.children.filter((c) => c.id !== taskId).map((c) => c.description);
}

/** Format the plan tree as a human-readable string. */
export function formatPlanTree(task: TaskNode, indent = 0): string {
  const prefix = "  ".repeat(indent);
  const kindTag = task.kind === "atomic" ? "[ATOMIC]" : task.kind === "composite" ? "[COMPOSITE]" : "";
  const statusTag = task.status !== "ready" ? ` (${task.status})` : "";
  let line = `${prefix}${task.id}. ${kindTag} ${task.description}${statusTag}`;

  if (task.children.length > 0) {
    const childLines = task.children.map((c) => formatPlanTree(c, indent + 1)).join("\n");
    line += "\n" + childLines;
  }

  return line;
}

/** Propagate done/failed status up the tree. */
export function propagateStatus(task: TaskNode): void {
  if (task.children.length === 0) return;
  task.children.forEach(propagateStatus);
  if (task.children.every((c) => c.status === "done")) {
    task.status = "done";
  } else if (task.children.some((c) => c.status === "failed")) {
    task.status = "failed";
  } else if (task.children.some((c) => c.status === "running" || c.status === "done")) {
    task.status = "running";
  }
}
