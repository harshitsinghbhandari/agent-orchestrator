/**
 * Code Atlas — codebase knowledge flows
 *
 * Atlas lives in the REPO (`code-atlas/`), NOT in `~/.agent-orchestrator/`.
 * It's committed to git as living documentation of project-specific knowledge
 * discovered by agents.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { atomicWriteFileSync } from "./atomic-write.js";
import { withFileLock } from "./file-lock.js";

// Directory structure constants
export const ATLAS_DIR = "code-atlas";
export const ATLAS_INDEX_FILE = "atlas.json";
export const FLOWS_DIR = "flows";
export const PENDING_DIR = ".pending";

// ID validation regex - must be a simple slug (lowercase alphanumeric with hyphens)
const FLOW_ID_REGEX = /^[a-z0-9-]+$/;
// Pending ID validation - more permissive but still safe (alphanumeric, dots, underscores, hyphens)
const PENDING_ID_REGEX = /^[A-Za-z0-9._-]+$/;

// Zod schemas for validation
export const FlowMetadataSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  description: z.string(),
  lastUpdated: z.string().datetime({ offset: true }),
  sourceAOSession: z.array(z.string()),
  successCount: z.number().int().nonnegative(),
});

export const AtlasIndexSchema = z.object({
  flows: z.record(z.string(), FlowMetadataSchema),
});

export const FlowFrontmatterSchema = z.object({
  title: z.string().min(1),
  discoveredIn: z.string().min(1),
  updated: z.string().min(1),
  relatedFlows: z.array(z.string()).optional(),
});

// Types
export type FlowMetadata = z.infer<typeof FlowMetadataSchema>;
export type AtlasIndex = z.infer<typeof AtlasIndexSchema>;
export type FlowFrontmatter = z.infer<typeof FlowFrontmatterSchema>;

export interface Flow {
  id: string;
  metadata: FlowMetadata;
  frontmatter: FlowFrontmatter;
  body: string;
}

export interface PendingFlow {
  id: string;
  frontmatter: FlowFrontmatter;
  body: string;
  filePath: string;
}

export interface FlowSummary {
  id: string;
  title: string;
  description: string;
  lastUpdated: string;
  successCount: number;
}

// Path utilities
export function getAtlasDir(repoPath: string): string {
  return join(repoPath, ATLAS_DIR);
}

export function getFlowsDir(repoPath: string): string {
  return join(getAtlasDir(repoPath), FLOWS_DIR);
}

export function getPendingDir(repoPath: string): string {
  return join(getAtlasDir(repoPath), PENDING_DIR);
}

export function getAtlasIndexPath(repoPath: string): string {
  return join(getAtlasDir(repoPath), ATLAS_INDEX_FILE);
}

// ID validation to prevent path traversal
function validateFlowId(flowId: string): string {
  if (!flowId || flowId === "." || flowId === "..") {
    throw new Error(`Invalid flow ID: ${flowId}`);
  }
  if (!FLOW_ID_REGEX.test(flowId)) {
    throw new Error(`Invalid flow ID format: ${flowId}. Must be lowercase alphanumeric with hyphens.`);
  }
  return flowId;
}

function validatePendingId(pendingId: string): string {
  if (!pendingId || pendingId === "." || pendingId === "..") {
    throw new Error(`Invalid pending flow ID: ${pendingId}`);
  }
  if (!PENDING_ID_REGEX.test(pendingId)) {
    throw new Error(`Invalid pending flow ID format: ${pendingId}`);
  }
  return pendingId;
}

// Ensure a resolved path is within the expected directory (defense in depth)
function assertPathWithinDir(filePath: string, expectedDir: string): void {
  const resolvedPath = resolve(filePath);
  const resolvedDir = resolve(expectedDir);
  if (!resolvedPath.startsWith(resolvedDir + "/") && resolvedPath !== resolvedDir) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
}

// Initialization
export function atlasExists(repoPath: string): boolean {
  return existsSync(getAtlasIndexPath(repoPath));
}

export function initAtlas(repoPath: string): void {
  const atlasDir = getAtlasDir(repoPath);
  const flowsDir = getFlowsDir(repoPath);
  const pendingDir = getPendingDir(repoPath);
  const indexPath = getAtlasIndexPath(repoPath);

  // Create directories
  mkdirSync(atlasDir, { recursive: true });
  mkdirSync(flowsDir, { recursive: true });
  mkdirSync(pendingDir, { recursive: true });

  // Create empty index if it doesn't exist
  if (!existsSync(indexPath)) {
    const emptyIndex: AtlasIndex = { flows: {} };
    atomicWriteFileSync(indexPath, JSON.stringify(emptyIndex, null, 2) + "\n");
  }

  // Create .gitignore for pending directory to ignore pending flows until approved
  const gitignorePath = join(pendingDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    atomicWriteFileSync(
      gitignorePath,
      "# Pending flows are not committed until approved\n*\n!.gitignore\n",
    );
  }
}

// Index operations
export function loadAtlasIndex(repoPath: string): AtlasIndex {
  const indexPath = getAtlasIndexPath(repoPath);

  if (!existsSync(indexPath)) {
    return { flows: {} };
  }

  try {
    const content = readFileSync(indexPath, "utf-8");
    const parsed = JSON.parse(content);
    return AtlasIndexSchema.parse(parsed);
  } catch (err) {
    throw new Error(`Failed to load atlas index: ${indexPath}`, { cause: err });
  }
}

export function saveAtlasIndex(repoPath: string, atlas: AtlasIndex): void {
  const indexPath = getAtlasIndexPath(repoPath);
  const validated = AtlasIndexSchema.parse(atlas);
  atomicWriteFileSync(indexPath, JSON.stringify(validated, null, 2) + "\n");
}

// Frontmatter parsing
export function parseFrontmatter(content: string): { frontmatter: FlowFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    throw new Error("Invalid flow file: missing YAML frontmatter");
  }

  const [, yamlContent, body] = match;

  try {
    const parsed = parseYaml(yamlContent ?? "");
    const frontmatter = FlowFrontmatterSchema.parse(parsed);
    return { frontmatter, body: body ?? "" };
  } catch (err) {
    throw new Error("Invalid flow frontmatter", { cause: err });
  }
}

// Slug generation
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Flow operations
export function listFlows(repoPath: string): FlowSummary[] {
  const atlas = loadAtlasIndex(repoPath);

  return Object.values(atlas.flows)
    .map((metadata) => ({
      id: metadata.id,
      title: metadata.title,
      description: metadata.description,
      lastUpdated: metadata.lastUpdated,
      successCount: metadata.successCount,
    }))
    .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
}

export function getFlow(repoPath: string, flowId: string): Flow | null {
  // Validate flowId to prevent path traversal
  const safeFlowId = validateFlowId(flowId);

  const atlas = loadAtlasIndex(repoPath);
  const metadata = atlas.flows[safeFlowId];

  if (!metadata) {
    return null;
  }

  const flowsDir = getFlowsDir(repoPath);
  const flowPath = join(flowsDir, `${safeFlowId}.md`);

  // Defense in depth: verify path is within flows directory
  assertPathWithinDir(flowPath, flowsDir);

  if (!existsSync(flowPath)) {
    return null;
  }

  try {
    const content = readFileSync(flowPath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    return {
      id: safeFlowId,
      metadata,
      frontmatter,
      body,
    };
  } catch (err) {
    throw new Error(`Failed to read flow ${safeFlowId}`, { cause: err });
  }
}

export function getFlowContent(repoPath: string, flowId: string): string | null {
  // Validate flowId to prevent path traversal
  const safeFlowId = validateFlowId(flowId);

  const flowsDir = getFlowsDir(repoPath);
  const flowPath = join(flowsDir, `${safeFlowId}.md`);

  // Defense in depth: verify path is within flows directory
  assertPathWithinDir(flowPath, flowsDir);

  if (!existsSync(flowPath)) {
    return null;
  }

  return readFileSync(flowPath, "utf-8");
}

export function getMultipleFlowContents(repoPath: string, flowIds: string[]): string {
  const sections: string[] = [];

  for (const flowId of flowIds) {
    const content = getFlowContent(repoPath, flowId);
    if (content) {
      sections.push(`# Flow: ${flowId}\n\n${content}`);
    }
  }

  return sections.join("\n\n---\n\n");
}

// Pending flow operations
export function listPending(repoPath: string): PendingFlow[] {
  const pendingDir = getPendingDir(repoPath);

  if (!existsSync(pendingDir)) {
    return [];
  }

  const pending: PendingFlow[] = [];

  for (const fileName of readdirSync(pendingDir)) {
    if (!fileName.endsWith(".md")) continue;

    const filePath = join(pendingDir, fileName);

    try {
      if (!statSync(filePath).isFile()) continue;
    } catch {
      continue;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);
      const id = fileName.replace(/\.md$/, "");

      pending.push({
        id,
        frontmatter,
        body,
        filePath,
      });
    } catch {
      // Skip invalid files
      continue;
    }
  }

  return pending.sort((a, b) => a.id.localeCompare(b.id));
}

export async function approvePending(repoPath: string, pendingId: string): Promise<Flow> {
  // Validate pendingId to prevent path traversal
  const safePendingId = validatePendingId(pendingId);

  const pendingDir = getPendingDir(repoPath);
  const pendingPath = join(pendingDir, `${safePendingId}.md`);

  // Defense in depth: verify path is within pending directory
  assertPathWithinDir(pendingPath, pendingDir);

  if (!existsSync(pendingPath)) {
    throw new Error(`Pending flow not found: ${safePendingId}`);
  }

  // Parse the pending file
  const content = readFileSync(pendingPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);

  // Generate flow ID from title
  const flowId = slugify(frontmatter.title);

  if (!flowId) {
    throw new Error(`Cannot generate valid flow ID from title: ${frontmatter.title}`);
  }

  // Use file lock to prevent concurrent modifications to atlas.json
  const indexPath = getAtlasIndexPath(repoPath);
  const lockPath = `${indexPath}.lock`;

  return withFileLock(lockPath, async () => {
    // Load current atlas index
    const atlas = loadAtlasIndex(repoPath);
    const existingMetadata = atlas.flows[flowId];

    // Create or update metadata
    const now = new Date().toISOString();
    const metadata: FlowMetadata = {
      id: flowId,
      title: frontmatter.title,
      description: body.split("\n").find((line) => line.trim().length > 0)?.trim().slice(0, 200) ?? "",
      lastUpdated: now,
      sourceAOSession: existingMetadata
        ? [...new Set([...existingMetadata.sourceAOSession, frontmatter.discoveredIn])]
        : [frontmatter.discoveredIn],
      successCount: existingMetadata ? existingMetadata.successCount + 1 : 1,
    };

    // Update frontmatter with current timestamp
    const updatedFrontmatter: FlowFrontmatter = {
      ...frontmatter,
      updated: now,
    };

    // Build updated file content using yaml stringify for proper escaping
    const updatedContent = formatFlowContent(updatedFrontmatter, body);

    // Ensure flows directory exists
    const flowsDir = getFlowsDir(repoPath);
    mkdirSync(flowsDir, { recursive: true });

    // Write the approved flow file
    const flowPath = join(flowsDir, `${flowId}.md`);
    atomicWriteFileSync(flowPath, updatedContent);

    // Update atlas index BEFORE removing pending file
    // This ensures we don't lose the pending change if save fails
    atlas.flows[flowId] = metadata;
    saveAtlasIndex(repoPath, atlas);

    // Remove pending file only after flow and index are persisted
    unlinkSync(pendingPath);

    return {
      id: flowId,
      metadata,
      frontmatter: updatedFrontmatter,
      body,
    };
  });
}

export function rejectPending(repoPath: string, pendingId: string): void {
  // Validate pendingId to prevent path traversal
  const safePendingId = validatePendingId(pendingId);

  const pendingDir = getPendingDir(repoPath);
  const pendingPath = join(pendingDir, `${safePendingId}.md`);

  // Defense in depth: verify path is within pending directory
  assertPathWithinDir(pendingPath, pendingDir);

  if (!existsSync(pendingPath)) {
    throw new Error(`Pending flow not found: ${safePendingId}`);
  }

  unlinkSync(pendingPath);
}

// Helper to format flow content with frontmatter using yaml stringify for proper escaping
function formatFlowContent(frontmatter: FlowFrontmatter, body: string): string {
  // Use yaml stringify to properly handle escaping of all values
  const frontmatterObj: Record<string, unknown> = {
    title: frontmatter.title,
    discoveredIn: frontmatter.discoveredIn,
    updated: frontmatter.updated,
  };

  if (frontmatter.relatedFlows && frontmatter.relatedFlows.length > 0) {
    frontmatterObj.relatedFlows = frontmatter.relatedFlows;
  }

  const yamlContent = stringifyYaml(frontmatterObj, { lineWidth: 0 }).trim();

  return `---\n${yamlContent}\n---\n${body}`;
}
