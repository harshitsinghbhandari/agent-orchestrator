/**
 * `ao reset` — wipe a project's local AO state.
 *
 * Removes:
 * - The project's V2 storage directory: ~/.agent-orchestrator/projects/{projectId}/
 *   (sessions, worktrees, feedback reports, orchestrator runtime state, etc.)
 * - The project entry from the global config registry (~/.agent-orchestrator/config.yaml)
 * - The project's per-project entry and projectOrder slot in portfolio preferences
 * - Activity events for the project from the shared SQLite log
 *
 * Out of scope (intentionally preserved):
 * - The project repo on disk and its agent-orchestrator.yaml
 * - Legacy V1 storage (~/.agent-orchestrator/{storageKey}/) for migrated projects
 * - The shared observability dir (~/.agent-orchestrator/{hash}-observability/)
 *   which may contain data for multiple projects sharing the same config
 *
 * Refuses to run while `ao start` is active for the targeted project.
 * Live tmux sessions are killed first via SessionManager.kill before disk wipe.
 */

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import chalk from "chalk";
import type { Command } from "commander";
import {
  loadConfig,
  getProjectDir,
  loadGlobalConfig,
  unregisterProject,
  updatePreferences,
  deleteEventsForProject,
  type LoadedConfig,
  type ProjectConfig,
} from "@aoagents/ao-core";
import { promptConfirm } from "../lib/prompts.js";
import { findProjectForDirectory } from "../lib/project-resolution.js";
import { isHumanCaller } from "../lib/caller-context.js";
import { getSessionManager } from "../lib/create-session-manager.js";
import { getRunning } from "../lib/running-state.js";

interface ResolvedTarget {
  projectId: string;
  project: ProjectConfig;
}

/**
 * Resolve project from config — auto-detect from cwd or use explicit argument.
 */
function resolveProjectForReset(
  config: LoadedConfig,
  projectArg?: string,
): ResolvedTarget {
  const projectIds = Object.keys(config.projects);

  if (projectIds.length === 0) {
    throw new Error("No projects configured. Nothing to reset.");
  }

  if (projectArg) {
    const project = config.projects[projectArg];
    if (!project) {
      throw new Error(
        `Project "${projectArg}" not found. Available projects:\n  ${projectIds.join(", ")}`,
      );
    }
    return { projectId: projectArg, project };
  }

  // Single project — use it
  if (projectIds.length === 1) {
    const projectId = projectIds[0];
    return { projectId, project: config.projects[projectId] };
  }

  // Multiple projects — try matching cwd
  const currentDir = resolve(cwd());
  const matchedProjectId = findProjectForDirectory(config.projects, currentDir);
  if (matchedProjectId) {
    return { projectId: matchedProjectId, project: config.projects[matchedProjectId] };
  }

  throw new Error(
    `Multiple projects configured. Specify which one to reset:\n  ${projectIds.map((id) => `ao reset ${id}`).join("\n  ")}\n\nOr use ao reset --all to reset all projects.`,
  );
}

interface DeletionTargets {
  baseDir: string;
  items: Array<{ path: string; label: string; size?: number }>;
}

/**
 * Collect what will be deleted for a project.
 */
function collectDeletionTargets(projectId: string): DeletionTargets {
  const baseDir = getProjectDir(projectId);
  const items: DeletionTargets["items"] = [];

  if (!existsSync(baseDir)) {
    return { baseDir, items };
  }

  try {
    const entries = readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(baseDir, entry.name);
      let size: number | undefined;
      try {
        if (entry.isDirectory()) {
          size = getDirSize(fullPath);
        } else {
          size = statSync(fullPath).size;
        }
      } catch {
        // Ignore stat errors
      }
      items.push({ path: fullPath, label: entry.name, size });
    }
  } catch {
    // Directory might not be readable
  }

  return { baseDir, items };
}

/**
 * Get approximate directory size recursively (best-effort, ignores symlinks).
 */
function getDirSize(dirPath: string): number {
  let totalSize = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      try {
        // isDirectory()/isFile() on Dirent reflects the entry itself (no symlink follow).
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          totalSize += getDirSize(fullPath);
        } else if (entry.isFile()) {
          totalSize += statSync(fullPath).size;
        }
      } catch {
        // Skip inaccessible files
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return totalSize;
}

/**
 * Format byte size for display.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Kill all live sessions for a project before wiping state.
 */
async function killProjectSessions(
  config: LoadedConfig,
  projectId: string,
): Promise<number> {
  let killed = 0;
  try {
    const sm = await getSessionManager(config);
    const sessions = await sm.list(projectId);
    for (const session of sessions) {
      try {
        await sm.kill(session.id);
        killed++;
      } catch {
        // Session might already be dead
      }
    }
  } catch {
    // Session manager might fail if state is corrupted — that's fine, we're wiping it
  }
  return killed;
}

/**
 * Drop the project from the global registry and any portfolio preference slots.
 * Reset is purely destructive; lookups that no longer find the project are not failures.
 */
function pruneGlobalState(projectId: string): void {
  try {
    if (loadGlobalConfig()?.projects[projectId]) {
      unregisterProject(projectId);
    }
  } catch {
    // Best-effort; corrupted global config shouldn't block reset
  }

  try {
    updatePreferences((prefs) => {
      if (prefs.projects?.[projectId]) {
        const { [projectId]: _removed, ...rest } = prefs.projects;
        prefs.projects = rest;
      }
      if (prefs.projectOrder) {
        prefs.projectOrder = prefs.projectOrder.filter((id) => id !== projectId);
      }
      if (prefs.defaultProjectId === projectId) {
        prefs.defaultProjectId = undefined;
      }
    });
  } catch {
    // Same: best-effort
  }
}

interface PerTargetResult {
  projectId: string;
  diskRemoved: boolean;
  diskError?: string;
  eventsRemoved: number;
  killed: number;
}

export function registerReset(program: Command): void {
  program
    .command("reset [project]")
    .description("Wipe a project's local AO state (storage dir + global registry entry)")
    .option("-p, --project <id>", "Specify project ID to reset")
    .option("--yes", "Skip confirmation prompt")
    .option("--all", "Reset all projects")
    .action(
      async (
        projectArg?: string,
        opts: { project?: string; yes?: boolean; all?: boolean } = {},
      ) => {
        // Reject conflicting selectors before doing any work
        if (opts.all && (projectArg || opts.project)) {
          console.error(
            chalk.red("Cannot combine --all with a project argument or --project."),
          );
          process.exit(1);
        }
        if (projectArg && opts.project && projectArg !== opts.project) {
          console.error(
            chalk.red(
              `Conflicting project selectors: positional "${projectArg}" vs --project "${opts.project}".`,
            ),
          );
          process.exit(1);
        }

        const config = loadConfig();
        const effectiveProjectArg = projectArg ?? opts.project;

        // Determine which projects to reset
        let targets: ResolvedTarget[];

        if (opts.all) {
          targets = Object.entries(config.projects).map(([id, project]) => ({
            projectId: id,
            project,
          }));
          if (targets.length === 0) {
            console.log(chalk.yellow("No projects configured. Nothing to reset."));
            return;
          }
        } else {
          targets = [resolveProjectForReset(config, effectiveProjectArg)];
        }

        // Refuse to operate on a project served by a live `ao start` instance.
        // Wiping under the daemon's feet corrupts in-memory orchestrator state.
        const running = await getRunning();
        if (running) {
          const overlap = targets
            .map((t) => t.projectId)
            .filter((id) => running.projects.includes(id));
          if (overlap.length > 0) {
            console.error(
              chalk.red(
                `\n'ao start' is currently running (PID ${running.pid}, port ${running.port}) and serving:`,
              ),
            );
            for (const id of overlap) console.error(chalk.red(`  - ${id}`));
            console.error(
              chalk.red(
                `\nStop it first with: ao stop${overlap.length === 1 ? ` ${overlap[0]}` : ""}\n`,
              ),
            );
            process.exit(1);
          }
        }

        // Collect all deletion targets (disk preview)
        const allTargets = targets.map(({ projectId, project }) => ({
          projectId,
          project,
          ...collectDeletionTargets(projectId),
        }));

        const globalConfig = (() => {
          try {
            return loadGlobalConfig();
          } catch {
            return null;
          }
        })();

        const targetsWithGlobalState = allTargets.filter(
          (t) => t.items.length > 0 || globalConfig?.projects[t.projectId],
        );

        if (targetsWithGlobalState.length === 0) {
          console.log(
            chalk.yellow(
              "\nNo AO state found for the specified project(s). Nothing to reset.\n",
            ),
          );
          return;
        }

        // Display what will be deleted
        console.log(chalk.bold("\nThe following project state will be deleted:\n"));

        for (const { projectId, baseDir, items } of allTargets) {
          const registered = !!globalConfig?.projects[projectId];
          if (items.length === 0 && !registered) {
            console.log(chalk.dim(`  ${projectId}: (no state found)`));
            continue;
          }

          console.log(chalk.cyan(`  ${projectId}:`));
          if (items.length > 0) {
            console.log(chalk.dim(`    ${baseDir}/`));
            for (const item of items) {
              const sizeStr =
                item.size !== undefined ? chalk.dim(` (${formatSize(item.size)})`) : "";
              console.log(`      ${item.label}${sizeStr}`);
            }
          } else {
            console.log(chalk.dim(`    ${baseDir}/  (already empty)`));
          }
          if (registered) {
            console.log(chalk.dim("    + global registry entry + portfolio preferences"));
          }
          console.log();
        }

        // Confirm
        if (!opts.yes) {
          if (!isHumanCaller()) {
            console.error(
              chalk.red(
                "Cannot confirm interactively in non-TTY mode. Use --yes to skip confirmation.",
              ),
            );
            process.exit(1);
          }
          const confirmed = await promptConfirm(
            "This will permanently delete the above project state. Continue?",
            false,
          );
          if (!confirmed) {
            console.log(chalk.yellow("\nReset cancelled.\n"));
            return;
          }
        }

        // Execute reset
        const results: PerTargetResult[] = [];
        for (const { projectId, baseDir, items } of allTargets) {
          const registered = !!globalConfig?.projects[projectId];
          if (items.length === 0 && !registered) continue;

          console.log(chalk.bold(`\nResetting ${chalk.cyan(projectId)}...`));

          // Kill live sessions first
          const killed = await killProjectSessions(config, projectId);
          if (killed > 0) {
            console.log(chalk.dim(`  Killed ${killed} live session${killed !== 1 ? "s" : ""}`));
          }

          let diskRemoved = items.length === 0; // nothing on disk == trivially removed
          let diskError: string | undefined;

          if (items.length > 0) {
            try {
              rmSync(baseDir, { recursive: true, force: true });
              diskRemoved = true;
              console.log(chalk.green(`  ✓ Removed ${baseDir}`));
            } catch (err) {
              diskError = err instanceof Error ? err.message : String(err);
              console.error(chalk.red(`  ✗ Failed to remove ${baseDir}: ${diskError}`));
            }
          }

          // Global registry + preferences cleanup (best-effort)
          pruneGlobalState(projectId);
          if (registered) {
            console.log(chalk.dim("  Unregistered from global config + portfolio preferences"));
          }

          // Activity events DB pruning (best-effort)
          let eventsRemoved = 0;
          try {
            eventsRemoved = deleteEventsForProject(projectId);
            if (eventsRemoved > 0) {
              console.log(
                chalk.dim(
                  `  Removed ${eventsRemoved} activity event${eventsRemoved !== 1 ? "s" : ""}`,
                ),
              );
            }
          } catch {
            // Best-effort; SQLite unavailable is not a failure for reset
          }

          results.push({ projectId, diskRemoved, diskError, eventsRemoved, killed });
        }

        const failures = results.filter((r) => !r.diskRemoved);
        if (failures.length > 0) {
          console.error(
            chalk.red(
              `\n✗ Reset finished with ${failures.length} failure${failures.length !== 1 ? "s" : ""}:`,
            ),
          );
          for (const f of failures) {
            console.error(chalk.red(`  - ${f.projectId}: ${f.diskError ?? "unknown error"}`));
          }
          console.error("");
          process.exit(1);
        }

        console.log(chalk.green("\n✓ Reset complete.\n"));
      },
    );
}
