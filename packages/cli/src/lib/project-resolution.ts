import { isAbsolute, relative, resolve } from "node:path";
import type { OrchestratorConfig } from "@aoagents/ao-core";

interface ProjectWithPath {
  path: string;
}

function isWithinProject(projectPath: string, currentDir: string): boolean {
  const relativePath = relative(projectPath, currentDir);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

/**
 * Find the best matching project for the current directory.
 * When multiple project paths contain the cwd, prefer the deepest match.
 */
export function findProjectForDirectory<T extends ProjectWithPath>(
  projects: Record<string, T>,
  currentDir: string,
): string | null {
  const resolvedCurrentDir = resolve(currentDir);

  const matches = Object.entries(projects)
    .filter(([, project]) => isWithinProject(resolve(project.path), resolvedCurrentDir))
    .sort(([, a], [, b]) => resolve(b.path).length - resolve(a.path).length);

  return matches[0]?.[0] ?? null;
}

/**
 * Resolve a project id for read-only inspection commands. Mirrors the cascade
 * used by `ao spawn` (explicit flag → single project → AO_PROJECT_ID env →
 * cwd match). Throws when ambiguous so the caller surfaces the error.
 */
export function resolveScopedProjectId(
  config: OrchestratorConfig,
  explicit?: string,
): string {
  if (explicit) {
    if (!config.projects[explicit]) {
      throw new Error(`Unknown project: ${explicit}`);
    }
    return explicit;
  }

  const ids = Object.keys(config.projects);
  if (ids.length === 0) throw new Error("No projects configured.");
  if (ids.length === 1) return ids[0];

  const fromEnv = process.env["AO_PROJECT_ID"];
  if (fromEnv && config.projects[fromEnv]) return fromEnv;

  const matched = findProjectForDirectory(config.projects, resolve(process.cwd()));
  if (matched) return matched;

  throw new Error(
    `Multiple projects configured. Pass --project <id>: ${ids.join(", ")}`,
  );
}
