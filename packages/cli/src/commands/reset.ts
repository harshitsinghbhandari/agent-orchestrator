/**
 * `ao reset` — wipe a project's local AO state.
 *
 * Removes:
 * - The project's V2 storage directory: ~/.agent-orchestrator/projects/{projectId}/
 *   (sessions, worktrees, feedback reports, orchestrator runtime state, etc.)
 * - The project entry from the global config registry (~/.agent-orchestrator/config.yaml)
 * - The project's per-project entry and projectOrder slot in portfolio preferences
 *   ONLY when the prefs file actually references the project. We never write
 *   preferences.json into existence on machines that haven't customized the
 *   portfolio.
 * - Activity events for the project from the shared SQLite log
 *
 * Out of scope (intentionally preserved):
 * - The project repo on disk and its agent-orchestrator.yaml
 * - Legacy V1 storage (~/.agent-orchestrator/{storageKey}/) for migrated projects
 * - The shared observability dir (~/.agent-orchestrator/{hash}-observability/)
 *   which may contain data for multiple projects sharing the same config
 *
 * UX:
 * - Refuses (loud red banner) to run while `ao start` is active for the project.
 * - Prints a destructive-action banner + a "NOT touched by reset" notice before
 *   the preview so the operator knows what survives.
 * - Each persistence layer is reported only when it actually changed.
 *
 * Robustness:
 * - Tolerates a corrupted/missing local config (we still need to reset orphans
 *   and clean disk state).
 * - Tolerates orphan projects: an id that exists in the global registry but
 *   not the local config can still be reset by name, and `--all` includes
 *   orphans automatically.
 * - Tolerates invalid project IDs in `--all` (skip with a warning instead of
 *   crashing the whole loop).
 * - Auto-matches cwd inside a worktree (~/.agent-orchestrator/projects/X/worktrees/Y)
 *   to the parent project, not just the repo root.
 *
 * Live sessions are killed first via SessionManager.kill (runtime-agnostic —
 * works for tmux, process, and any future runtime plugin) before disk wipe.
 */

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import chalk from "chalk";
import type { Command } from "commander";
import {
  loadConfig,
  getProjectDir,
  getProjectWorktreesDir,
  loadGlobalConfig,
  unregisterProject,
  loadPreferences,
  savePreferences,
  deleteEventsForProject,
  type LoadedConfig,
  type PortfolioPreferences,
} from "@aoagents/ao-core";
import { promptConfirm } from "../lib/prompts.js";
import { findProjectForDirectory } from "../lib/project-resolution.js";
import { isHumanCaller } from "../lib/caller-context.js";
import { getSessionManager } from "../lib/create-session-manager.js";
import { getRunning } from "../lib/running-state.js";

interface ResolvedTarget {
  projectId: string;
}

/** True if this looks like a safe project id we can pass to getProjectDir(). */
function isSafeProjectId(projectId: string): boolean {
  try {
    getProjectDir(projectId);
    return true;
  } catch {
    return false;
  }
}

/** Read every projectId known to the global registry, swallowing errors. */
function readGlobalProjectIds(): string[] {
  try {
    const global = loadGlobalConfig();
    return global ? Object.keys(global.projects) : [];
  } catch {
    return [];
  }
}

/**
 * Resolve project from config — auto-detect from cwd or use explicit argument.
 *
 * Supports orphan projects: an id that exists in the global registry but not
 * the local config is still resolvable by name, so users can clean up state
 * for projects they no longer have a local YAML for.
 */
function resolveProjectForReset(
  config: LoadedConfig | null,
  projectArg?: string,
): ResolvedTarget {
  const localProjectIds = config ? Object.keys(config.projects) : [];
  const globalProjectIds = readGlobalProjectIds();
  const allKnownIds = Array.from(new Set([...localProjectIds, ...globalProjectIds]));

  if (projectArg) {
    if (allKnownIds.includes(projectArg)) {
      return { projectId: projectArg };
    }
    if (allKnownIds.length === 0) {
      throw new Error(`Project "${projectArg}" not found in any config.`);
    }
    throw new Error(
      `Project "${projectArg}" not found. Known projects:\n  ${allKnownIds.join(", ")}`,
    );
  }

  if (allKnownIds.length === 0) {
    throw new Error("No projects configured. Nothing to reset.");
  }

  if (allKnownIds.length === 1) {
    return { projectId: allKnownIds[0] };
  }

  // Multiple projects — try matching cwd against repo paths first…
  const currentDir = resolve(cwd());
  if (config) {
    const matchedProjectId = findProjectForDirectory(config.projects, currentDir);
    if (matchedProjectId) return { projectId: matchedProjectId };
  }

  // …then against AO-managed worktree directories. Users often run `ao reset`
  // from inside a worktree, where cwd is under getProjectWorktreesDir(id) —
  // not under project.path — so the repo-path match misses.
  for (const id of allKnownIds) {
    if (!isSafeProjectId(id)) continue;
    const worktreesDir = getProjectWorktreesDir(id);
    if (currentDir === worktreesDir || currentDir.startsWith(worktreesDir + "/")) {
      return { projectId: id };
    }
  }

  throw new Error(
    `Multiple projects configured. Specify which one to reset:\n  ${allKnownIds.map((id) => `ao reset ${id}`).join("\n  ")}\n\nOr use ao reset --all to reset all projects.`,
  );
}

interface DeletionTargets {
  baseDir: string;
  exists: boolean;
  items: Array<{ path: string; label: string; size?: number }>;
}

/**
 * Collect what will be deleted for a project.
 *
 * `exists` reflects baseDir's presence on disk and is the authoritative
 * signal for "is there anything to delete here". `items` is best-effort
 * preview content — readdir/stat errors leave it empty, so callers must
 * not use `items.length` as a proxy for "directory is empty/absent".
 */
function collectDeletionTargets(projectId: string): DeletionTargets {
  const baseDir = getProjectDir(projectId);
  const items: DeletionTargets["items"] = [];

  if (!existsSync(baseDir)) {
    return { baseDir, exists: false, items };
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

  return { baseDir, exists: true, items };
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
 * Skipped silently if config is unavailable — without a config we can't
 * even build the SessionManager, but reset can still wipe disk state.
 */
async function killProjectSessions(
  config: LoadedConfig | null,
  projectId: string,
): Promise<number> {
  if (!config) return 0;
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

/** True if the preferences object contains anything keyed by `projectId`. */
function preferencesReferenceProject(
  prefs: PortfolioPreferences,
  projectId: string,
): boolean {
  if (prefs.projects?.[projectId]) return true;
  if (prefs.projectOrder?.includes(projectId)) return true;
  if (prefs.defaultProjectId === projectId) return true;
  return false;
}

/**
 * Read-only check: is anything outside the V2 storage dir referencing the
 * project? Used at preview time so we can show the user accurately what
 * reset will touch — separately for the registry and the prefs file.
 */
function readGlobalReferences(projectId: string): {
  registered: boolean;
  prefsReferenced: boolean;
} {
  let registered = false;
  let prefsReferenced = false;

  try {
    registered = !!loadGlobalConfig()?.projects[projectId];
  } catch {
    // Corrupted global config — treat as not registered
  }

  try {
    prefsReferenced = preferencesReferenceProject(loadPreferences(), projectId);
  } catch {
    // Corrupted prefs — treat as no reference
  }

  return { registered, prefsReferenced };
}

/**
 * Drop the project from the global registry and any portfolio preference slots.
 * Returns what was actually changed so callers can report accurately.
 *
 * Both layers are best-effort (try/catch). Reset is destructive by definition;
 * a corrupted global config or unwritable prefs file must not block disk cleanup.
 *
 * Important: prefs are only written if the loaded prefs actually reference
 * this project. Otherwise we'd create an empty `preferences.json` on machines
 * that have never customized the portfolio — a surprising side effect.
 */
function pruneGlobalState(projectId: string): {
  unregistered: boolean;
  prefsChanged: boolean;
} {
  let unregistered = false;
  let prefsChanged = false;

  try {
    if (loadGlobalConfig()?.projects[projectId]) {
      unregisterProject(projectId);
      unregistered = true;
    }
  } catch {
    // Corrupted global config — skip
  }

  try {
    const prefs = loadPreferences();
    if (preferencesReferenceProject(prefs, projectId)) {
      if (prefs.projects?.[projectId]) {
        const { [projectId]: _removed, ...rest } = prefs.projects;
        prefs.projects = Object.keys(rest).length > 0 ? rest : undefined;
      }
      if (prefs.projectOrder) {
        const next = prefs.projectOrder.filter((id) => id !== projectId);
        prefs.projectOrder = next.length > 0 ? next : undefined;
      }
      if (prefs.defaultProjectId === projectId) {
        prefs.defaultProjectId = undefined;
      }
      savePreferences(prefs);
      prefsChanged = true;
    }
    // else: nothing to change → don't write preferences.json into existence
  } catch {
    // Best-effort
  }

  return { unregistered, prefsChanged };
}

interface PerTargetResult {
  projectId: string;
  diskRemoved: boolean;
  diskError?: string;
  eventsAvailable: boolean;
  eventsRemoved: number;
  killed: number;
}

export function registerReset(program: Command): void {
  program
    .command("reset [project]")
    .description("Wipe a project's local AO state (storage dir + global registry entry)")
    .option("-p, --project <id>", "Specify project ID to reset")
    .option("--yes", "Skip confirmation prompt")
    .option("--all", "Reset all projects (including orphans in the global registry)")
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

        // Tolerate a corrupted/missing local config: we still need to be able
        // to clean up orphans and disk state. We treat the local config as
        // "advisory" — the global registry is the authoritative project list.
        let config: LoadedConfig | null = null;
        try {
          config = loadConfig();
        } catch (err) {
          console.warn(
            chalk.yellow(
              `Warning: could not read local agent-orchestrator.yaml — proceeding from global registry only.`,
            ),
          );
          console.warn(
            chalk.dim(
              `  ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        }

        const effectiveProjectArg = projectArg ?? opts.project;

        // Determine which projects to reset
        let targets: ResolvedTarget[];

        if (opts.all) {
          const localIds = config ? Object.keys(config.projects) : [];
          const globalIds = readGlobalProjectIds();
          const merged = Array.from(new Set([...localIds, ...globalIds]));

          // Filter out unsafe ids early so one bad apple can't crash the loop.
          // assertSafeProjectId rejects ".", "..", weird chars, length > 128.
          const safeIds: string[] = [];
          const unsafeIds: string[] = [];
          for (const id of merged) {
            (isSafeProjectId(id) ? safeIds : unsafeIds).push(id);
          }
          if (unsafeIds.length > 0) {
            console.warn(
              chalk.yellow(
                `Warning: skipping ${unsafeIds.length} project(s) with unsafe ids:`,
              ),
            );
            for (const id of unsafeIds) console.warn(chalk.dim(`  - ${JSON.stringify(id)}`));
          }

          targets = safeIds.map((id) => ({ projectId: id }));
          if (targets.length === 0) {
            console.log(chalk.yellow("No projects configured. Nothing to reset."));
            return;
          }
        } else {
          targets = [resolveProjectForReset(config, effectiveProjectArg)];
        }

        // Refuse to operate on a project served by a live `ao start` instance.
        // Wiping under the daemon's feet corrupts in-memory orchestrator state.
        let running: Awaited<ReturnType<typeof getRunning>> = null;
        try {
          running = await getRunning();
        } catch (err) {
          console.warn(
            chalk.yellow(
              `Warning: could not check if 'ao start' is running (${err instanceof Error ? err.message : String(err)}). Proceeding anyway.`,
            ),
          );
        }
        if (running) {
          const overlap = targets
            .map((t) => t.projectId)
            .filter((id) => running!.projects.includes(id));
          if (overlap.length > 0) {
            console.error("");
            console.error(chalk.bold.red("  ⚠  CANNOT RESET — `ao start` IS LIVE"));
            console.error(
              chalk.red(
                `  Running on PID ${running.pid}, port ${running.port}, serving:`,
              ),
            );
            for (const id of overlap) console.error(chalk.red(`    - ${id}`));
            console.error(
              chalk.red(
                `\n  Stop it first with: ao stop${overlap.length === 1 ? ` ${overlap[0]}` : ""}\n`,
              ),
            );
            process.exit(1);
          }
        }

        // Collect all deletion targets (disk preview + per-layer references)
        const allTargets = targets.map(({ projectId }) => ({
          projectId,
          isOrphan: !(config && config.projects[projectId]),
          ...collectDeletionTargets(projectId),
          ...readGlobalReferences(projectId),
        }));

        const targetsWithState = allTargets.filter(
          (t) => t.exists || t.registered || t.prefsReferenced,
        );

        if (targetsWithState.length === 0) {
          console.log(
            chalk.yellow(
              "\nNo AO state found for the specified project(s). Nothing to reset.\n",
            ),
          );
          return;
        }

        // Loud, unmissable destructive-action banner
        console.log("");
        console.log(chalk.bold.red("  ⚠  WARNING — DESTRUCTIVE OPERATION"));
        console.log(
          chalk.red("  This permanently deletes project state. It cannot be undone."),
        );
        console.log(
          chalk.red("  Make sure you have pushed any work in active worktrees first."),
        );
        console.log("");

        // Display what will be deleted
        console.log(chalk.bold("The following project state will be deleted:\n"));

        for (const { projectId, baseDir, exists, items, registered, prefsReferenced, isOrphan } of allTargets) {
          if (!exists && !registered && !prefsReferenced) {
            console.log(chalk.dim(`  ${projectId}: (no state found)`));
            continue;
          }

          console.log(
            chalk.cyan(`  ${projectId}${isOrphan ? chalk.yellow(" (orphan — not in local config)") : ""}:`),
          );
          if (exists) {
            console.log(chalk.dim(`    ${baseDir}/`));
            if (items.length > 0) {
              for (const item of items) {
                const sizeStr =
                  item.size !== undefined ? chalk.dim(` (${formatSize(item.size)})`) : "";
                console.log(`      ${item.label}${sizeStr}`);
              }
            } else {
              console.log(chalk.dim("      (contents not enumerable)"));
            }
          }
          if (registered) {
            console.log(chalk.dim("    + entry in global config registry"));
          }
          if (prefsReferenced) {
            console.log(chalk.dim("    + slot in portfolio preferences"));
          }
          console.log();
        }

        // Tell the user what reset does NOT touch — the boundaries matter
        // because users often assume "reset" wipes more than it does.
        console.log(chalk.bold.red("  NOT touched by reset:"));
        console.log(chalk.red("    • The repo on disk and your agent-orchestrator.yaml"));
        console.log(chalk.red("    • Legacy V1 storage (~/.agent-orchestrator/<storageKey>/)"));
        console.log(chalk.red("    • The shared observability dir (~/.agent-orchestrator/<hash>-observability/)"));
        console.log("");

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
            chalk.bold.red("This will permanently delete the above project state. Continue?"),
            false,
          );
          if (!confirmed) {
            console.log(chalk.yellow("\nReset cancelled.\n"));
            return;
          }
        }

        // Execute reset
        const results: PerTargetResult[] = [];
        let dbWasUnavailable = false;
        for (const { projectId, baseDir, exists, registered, prefsReferenced } of allTargets) {
          if (!exists && !registered && !prefsReferenced) continue;

          console.log(chalk.bold(`\nResetting ${chalk.cyan(projectId)}...`));

          // Kill live sessions first (skipped if local config is unavailable —
          // we'd still wipe disk state even without the SessionManager)
          const killed = await killProjectSessions(config, projectId);
          if (killed > 0) {
            console.log(chalk.dim(`  Killed ${killed} live session${killed !== 1 ? "s" : ""}`));
          }

          // Disk removal: drive off baseDir existence, not the preview list.
          // An empty or unreadable dir still needs removing; an absent dir is a no-op success.
          let diskRemoved = !exists;
          let diskError: string | undefined;

          if (exists) {
            try {
              rmSync(baseDir, { recursive: true, force: true });
              diskRemoved = true;
              console.log(chalk.green(`  ✓ Removed ${baseDir}`));
            } catch (err) {
              if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
                // Race: dir disappeared between preview and rm. Treat as success.
                diskRemoved = true;
                console.log(chalk.green(`  ✓ Removed ${baseDir}`));
              } else {
                diskError = err instanceof Error ? err.message : String(err);
                console.error(chalk.red(`  ✗ Failed to remove ${baseDir}: ${diskError}`));
              }
            }
          }

          // Global registry + preferences cleanup (best-effort, accurate reporting).
          const { unregistered, prefsChanged } = pruneGlobalState(projectId);
          if (unregistered) {
            console.log(chalk.dim("  Unregistered from global config registry"));
          }
          if (prefsChanged) {
            console.log(chalk.dim("  Pruned slot from portfolio preferences"));
          }

          // Activity events DB pruning. Distinguish "DB unavailable" (warn once
          // at the end) from "DB worked, removed N rows".
          let eventsAvailable: boolean;
          let eventsRemoved: number;
          try {
            const result = deleteEventsForProject(projectId);
            eventsAvailable = result.available;
            eventsRemoved = result.removed;
          } catch {
            eventsAvailable = false;
            eventsRemoved = 0;
          }
          if (!eventsAvailable) dbWasUnavailable = true;
          if (eventsRemoved > 0) {
            console.log(
              chalk.dim(
                `  Removed ${eventsRemoved} activity event${eventsRemoved !== 1 ? "s" : ""}`,
              ),
            );
          }

          results.push({ projectId, diskRemoved, diskError, eventsAvailable, eventsRemoved, killed });
        }

        if (dbWasUnavailable) {
          console.warn(
            chalk.yellow(
              "\nWarning: activity-events DB was unavailable (locked or not installed). Event rows for the targeted project(s) may persist.",
            ),
          );
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
