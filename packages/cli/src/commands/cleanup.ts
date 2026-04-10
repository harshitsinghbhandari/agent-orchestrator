import { createInterface } from "node:readline";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import {
  loadConfig,
  getSessionsDir,
  getArchiveDir,
  getWorktreesDir,
  listMetadata,
  deleteMetadata,
  killTmuxSession,
  listTmuxSessions,
} from "@aoagents/ao-core";
import { getSessionManager } from "../lib/create-session-manager.js";
import { isOrchestratorSessionName } from "../lib/session-utils.js";

/**
 * Prompt the user for yes/no input.
 * Returns true for 'yes', false for 'no'.
 */
async function askConfirmation(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "yes" || normalized === "y");
    });
  });
}

export function registerCleanup(program: Command): void {
  program
    .command("cleanup")
    .description("Full project cleanup (kill all sessions, reset counter)")
    .option("--all", "Perform full cleanup (required)")
    .option("-p, --project <id>", "Target specific project")
    .option("--include-archives", "Also delete archived sessions (default: true for --all)")
    .action(
      async (opts: {
        all?: boolean;
        project?: string;
        includeArchives?: boolean;
      }) => {
        if (!opts.all) {
          console.error(
            chalk.red("The --all flag is required for cleanup. Use: ao cleanup --all"),
          );
          process.exit(1);
        }

        // Explicit warning for AI agents
        console.log(
          chalk.bgRed.white.bold(
            "\n  WARNING: THIS COMMAND IS NOT SUPPOSED TO BE RUN BY AI AGENTS  \n",
          ),
        );

        const config = loadConfig();

        // Validate project if specified
        if (opts.project && !config.projects[opts.project]) {
          console.error(chalk.red(`Unknown project: ${opts.project}`));
          process.exit(1);
        }

        const projectIds = opts.project ? [opts.project] : Object.keys(config.projects);

        if (projectIds.length === 0) {
          console.log(chalk.dim("No projects configured."));
          return;
        }

        // Gather information about what will be cleaned
        const orchestratorSessions: Array<{ projectId: string; sessionId: string }> = [];
        const workerSessions: Array<{ projectId: string; sessionId: string }> = [];
        let totalMetadataFiles = 0;
        let totalArchiveFiles = 0;

        for (const projectId of projectIds) {
          const project = config.projects[projectId];
          if (!project) continue;

          const sessionsDir = getSessionsDir(config.configPath, project.path);
          const archiveDir = getArchiveDir(config.configPath, project.path);

          // Count metadata files
          const sessionIds = listMetadata(sessionsDir);
          totalMetadataFiles += sessionIds.length;

          // Categorize sessions
          for (const sessionId of sessionIds) {
            if (isOrchestratorSessionName(config, sessionId, projectId)) {
              orchestratorSessions.push({ projectId, sessionId });
            } else {
              workerSessions.push({ projectId, sessionId });
            }
          }

          // Count archive files
          if (existsSync(archiveDir)) {
            const archiveFiles = readdirSync(archiveDir).filter((f) => {
              try {
                return statSync(join(archiveDir, f)).isFile();
              } catch {
                return false;
              }
            });
            totalArchiveFiles += archiveFiles.length;
          }
        }

        console.log(chalk.bold("\nCleanup Summary:"));
        console.log(`  Orchestrator sessions: ${chalk.yellow(orchestratorSessions.length)}`);
        console.log(`  Worker sessions: ${chalk.yellow(workerSessions.length)}`);
        console.log(`  Metadata files: ${chalk.yellow(totalMetadataFiles)}`);
        console.log(`  Archive files: ${chalk.yellow(totalArchiveFiles)}`);
        console.log();

        // Step 1: Kill orchestrator sessions confirmation
        if (orchestratorSessions.length > 0) {
          const confirm1 = await askConfirmation(
            chalk.red("This will KILL ALL ORCHESTRATOR SESSIONS. Continue? (yes/no): "),
          );
          if (!confirm1) {
            console.log(chalk.yellow("\nCleanup aborted."));
            return;
          }
        }

        // Step 2: Kill worker sessions confirmation
        if (workerSessions.length > 0) {
          const confirm2 = await askConfirmation(
            chalk.red("This will KILL ALL WORKER SESSIONS. Continue? (yes/no): "),
          );
          if (!confirm2) {
            console.log(chalk.yellow("\nCleanup aborted."));
            return;
          }
        }

        // Step 3: Delete metadata confirmation
        if (totalMetadataFiles > 0 || totalArchiveFiles > 0) {
          const confirm3 = await askConfirmation(
            chalk.red(
              "This will DELETE ALL METADATA (session counter resets to 1). Continue? (yes/no): ",
            ),
          );
          if (!confirm3) {
            console.log(chalk.yellow("\nCleanup aborted."));
            return;
          }
        }

        // Step 4: AI Agent check
        const isAiAgent = await askConfirmation(
          chalk.magenta("Are you an AI Agent? (yes/no): "),
        );
        if (isAiAgent) {
          console.error(chalk.red("\nThis command cannot be run by AI agents."));
          process.exit(1);
        }

        // Execute cleanup
        console.log(chalk.bold("\nExecuting cleanup...\n"));

        const sm = await getSessionManager(config);
        const errors: Array<{ sessionId: string; error: string }> = [];

        // Phase 1: Kill orchestrator sessions
        if (orchestratorSessions.length > 0) {
          console.log(chalk.dim("Killing orchestrator sessions..."));
          for (const { sessionId } of orchestratorSessions) {
            try {
              await sm.kill(sessionId);
              console.log(chalk.green(`  Killed: ${sessionId}`));
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              errors.push({ sessionId, error: errorMsg });
              console.error(chalk.red(`  Error killing ${sessionId}: ${errorMsg}`));
            }
          }
        }

        // Phase 2: Kill worker sessions
        if (workerSessions.length > 0) {
          console.log(chalk.dim("Killing worker sessions..."));
          for (const { sessionId } of workerSessions) {
            try {
              await sm.kill(sessionId);
              console.log(chalk.green(`  Killed: ${sessionId}`));
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              errors.push({ sessionId, error: errorMsg });
              console.error(chalk.red(`  Error killing ${sessionId}: ${errorMsg}`));
            }
          }
        }

        // Phase 3: Delete remaining metadata files (without archiving)
        // This catches any orphaned metadata that kill() might have missed
        console.log(chalk.dim("Cleaning up metadata..."));
        for (const projectId of projectIds) {
          const project = config.projects[projectId];
          if (!project) continue;

          const sessionsDir = getSessionsDir(config.configPath, project.path);
          const remainingIds = listMetadata(sessionsDir);

          for (const sessionId of remainingIds) {
            try {
              // Delete WITHOUT archiving (archive = false)
              deleteMetadata(sessionsDir, sessionId, false);
              console.log(chalk.green(`  Deleted metadata: ${sessionId}`));
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              console.error(chalk.red(`  Error deleting metadata ${sessionId}: ${errorMsg}`));
            }
          }
        }

        // Phase 4: Delete archive files
        const includeArchives = opts.includeArchives !== false; // Default true for --all
        if (includeArchives) {
          console.log(chalk.dim("Deleting archives..."));
          for (const projectId of projectIds) {
            const project = config.projects[projectId];
            if (!project) continue;

            const archiveDir = getArchiveDir(config.configPath, project.path);
            if (existsSync(archiveDir)) {
              try {
                const archiveFiles = readdirSync(archiveDir);
                for (const file of archiveFiles) {
                  const filePath = join(archiveDir, file);
                  try {
                    if (statSync(filePath).isFile()) {
                      rmSync(filePath);
                      console.log(chalk.green(`  Deleted archive: ${file}`));
                    }
                  } catch {
                    // Ignore individual file errors
                  }
                }
              } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                console.error(chalk.red(`  Error cleaning archives for ${projectId}: ${errorMsg}`));
              }
            }
          }
        }

        // Phase 5: Clean up orphaned worktrees
        console.log(chalk.dim("Cleaning up orphaned worktrees..."));
        for (const projectId of projectIds) {
          const project = config.projects[projectId];
          if (!project) continue;

          const worktreesDir = getWorktreesDir(config.configPath, project.path);
          if (existsSync(worktreesDir)) {
            try {
              const worktreeDirs = readdirSync(worktreesDir);
              for (const dir of worktreeDirs) {
                const worktreePath = join(worktreesDir, dir);
                try {
                  if (statSync(worktreePath).isDirectory()) {
                    rmSync(worktreePath, { recursive: true, force: true });
                    console.log(chalk.green(`  Removed worktree: ${dir}`));
                  }
                } catch {
                  // Ignore individual directory errors
                }
              }
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              console.error(
                chalk.red(`  Error cleaning worktrees for ${projectId}: ${errorMsg}`),
              );
            }
          }
        }

        // Phase 6: Clean up orphaned tmux sessions
        console.log(chalk.dim("Cleaning up orphaned tmux sessions..."));
        try {
          const tmuxSessions = await listTmuxSessions();
          if (tmuxSessions) {
            for (const projectId of projectIds) {
              const project = config.projects[projectId];
              if (!project) continue;
              const prefix = project.sessionPrefix ?? projectId;

              // Match sessions for this project (both worker and orchestrator patterns)
              const projectPattern = new RegExp(
                `^([a-f0-9]{12}-)?${prefix}(-orchestrator)?(-\\d+)?$`,
              );

              for (const tmuxSession of tmuxSessions) {
                if (projectPattern.test(tmuxSession.name)) {
                  try {
                    await killTmuxSession(tmuxSession.name);
                    console.log(chalk.green(`  Killed tmux session: ${tmuxSession.name}`));
                  } catch {
                    // Ignore errors - session might already be gone
                  }
                }
              }
            }
          }
        } catch {
          // tmux might not be available
        }

        // Summary
        console.log(chalk.bold("\nCleanup complete!"));
        const totalKilled = orchestratorSessions.length + workerSessions.length;
        console.log(`  Sessions killed: ${chalk.green(totalKilled - errors.length)}`);
        if (errors.length > 0) {
          console.log(`  Errors: ${chalk.red(errors.length)}`);
        }
        console.log(chalk.dim("  Session counter has been reset to 1."));
      },
    );
}
