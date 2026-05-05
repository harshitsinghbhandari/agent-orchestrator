/**
 * `ao pipeline` — list configured pipelines, manage runs.
 *
 * Sub-commands: list, runs, show, run, cancel, resume, migrate.
 *
 * The actual store I/O is delegated to `lib/pipeline-service.ts` so unit
 * tests can mock the store and assert on calls. This file only handles
 * project resolution, argument parsing, and presentation.
 */

import chalk from "chalk";
import type { Command } from "commander";
import {
  asRunId,
  createPipelineStore,
  getProjectPipelinesDir,
  loadConfig,
  type OrchestratorConfig,
  type PipelineStore,
  type RunState,
} from "@aoagents/ao-core";

import { fail } from "../lib/cli-utils.js";
import { getPluginRegistry } from "../lib/create-session-manager.js";
import { resolveScopedProjectId } from "../lib/project-resolution.js";
import { getRunning } from "../lib/running-state.js";
import {
  cancelRun,
  describeRun,
  LoopAlreadyActiveError,
  listConfiguredPipelines,
  listRuns,
  migrateStore,
  resolveConfiguredPipeline,
  resumeRun,
  triggerRun,
} from "../lib/pipeline-service.js";

interface ProjectScope {
  projectId: string;
  store: PipelineStore;
  config: OrchestratorConfig;
}

function openScope(projectOpt?: string): ProjectScope {
  const config = loadConfig();
  const projectId = resolveScopedProjectId(config, projectOpt);
  const store = createPipelineStore(getProjectPipelinesDir(projectId));
  return { projectId, store, config };
}

/**
 * Inverse of `warnIfAONotRunning` in spawn.ts. The running orchestrator
 * holds engine state in memory and (until v0.4 lifecycle wiring lands) does
 * not re-read pipeline runs from disk. CLI mutations therefore won't be seen
 * by the in-process engine until the user restarts it. Make that explicit.
 */
async function warnIfAORunning(projectId: string): Promise<void> {
  const running = await getRunning();
  if (!running || !running.projects.includes(projectId)) return;
  console.log(
    chalk.yellow(
      `⚠ AO is running (pid ${running.pid}) and holds in-memory pipeline state.`,
    ),
  );
  console.log(
    chalk.dim(
      `  This change is persisted to disk but the running engine won't pick it up until v0.4 lifecycle wiring lands.`,
    ),
  );
  console.log(
    chalk.dim(
      `  Restart \`ao start\` to re-hydrate engine state from the store.`,
    ),
  );
}

function formatLoopState(state: RunState["loopState"]): string {
  switch (state) {
    case "running":
      return chalk.cyan(state);
    case "awaiting_context":
      return chalk.yellow(state);
    case "done":
      return chalk.green(state);
    case "stalled":
      return chalk.magenta(state);
    case "terminated":
      return chalk.gray(state);
    default:
      return state;
  }
}

export function registerPipeline(program: Command): void {
  const pipeline = program
    .command("pipeline")
    .description("Pipeline management (list configs, run, show, cancel, resume, migrate)");

  pipeline
    .command("list")
    .description("List configured pipelines")
    .option("-p, --project <id>", "Project to scope to")
    .option("--json", "Output as JSON")
    .action((opts: { project?: string; json?: boolean }) => {
      try {
        const { config, projectId } = openScope(opts.project);
        const pipelines = listConfiguredPipelines(config, projectId);

        if (opts.json) {
          console.log(JSON.stringify({ projectId, pipelines }, null, 2));
          return;
        }

        if (pipelines.length === 0) {
          console.log(chalk.dim(`  (no pipelines configured for ${projectId})`));
          return;
        }

        console.log(chalk.bold(`\nPipelines for ${projectId}:`));
        for (const p of pipelines) {
          const triggers = p.triggers.length > 0 ? p.triggers.join(", ") : "(none)";
          console.log(
            `  ${chalk.green(p.pipelineId)}  ${chalk.dim(`${p.stageCount} stage(s) — triggers: ${triggers}`)}`,
          );
        }
        console.log();
      } catch (err) {
        fail(err);
      }
    });

  pipeline
    .command("runs")
    .description("List pipeline runs (newest first)")
    .option("-p, --project <id>", "Project to scope to")
    .option("--pipeline <name>", "Filter by pipeline name")
    .option("--status <state>", "Filter by loop state (running, done, stalled, terminated, awaiting_context)")
    .option("--limit <n>", "Maximum number of runs to show", (v) => Number.parseInt(v, 10))
    .option("--json", "Output as JSON")
    .action(
      (opts: { project?: string; pipeline?: string; status?: string; limit?: number; json?: boolean }) => {
        try {
          const { store, projectId } = openScope(opts.project);
          const filtered = listRuns(store, {
            ...(opts.pipeline ? { pipeline: opts.pipeline } : {}),
            ...(opts.status ? { status: opts.status } : {}),
          });
          const limited =
            opts.limit && opts.limit > 0 ? filtered.slice(0, opts.limit) : filtered;

          if (opts.json) {
            console.log(JSON.stringify({ projectId, runs: limited }, null, 2));
            return;
          }

          if (limited.length === 0) {
            console.log(chalk.dim("  (no runs)"));
            return;
          }

          console.log(chalk.bold(`\nRuns for ${projectId}:`));
          for (const run of limited) {
            const reason = run.terminationReason ? ` (${run.terminationReason})` : "";
            console.log(
              `  ${chalk.green(run.runId)}  ${chalk.cyan(run.pipelineName)}  ${formatLoopState(run.loopState)}${chalk.dim(reason)}  ${chalk.dim(run.createdAt)}`,
            );
          }
          console.log();
        } catch (err) {
          fail(err);
        }
      },
    );

  pipeline
    .command("show")
    .description("Show run detail (stages + artifacts)")
    .argument("<runId>", "Pipeline run id")
    .option("-p, --project <id>", "Project to scope to")
    .option("--json", "Output as JSON")
    .action((runIdArg: string, opts: { project?: string; json?: boolean }) => {
      try {
        const { store } = openScope(opts.project);
        const detail = describeRun(store, asRunId(runIdArg));

        if (opts.json) {
          console.log(JSON.stringify(detail, null, 2));
          return;
        }

        const { run, loop, stages } = detail;
        console.log(chalk.bold(`\nRun ${run.runId}`));
        console.log(`  pipeline:  ${chalk.cyan(run.pipelineName)}`);
        console.log(`  session:   ${run.sessionId}`);
        console.log(`  state:     ${formatLoopState(run.loopState)}`);
        if (run.terminationReason) {
          console.log(`  reason:    ${chalk.dim(run.terminationReason)}`);
        }
        console.log(`  rounds:    ${run.loopRounds}`);
        console.log(`  headSha:   ${run.headSha}`);
        console.log(`  created:   ${chalk.dim(run.createdAt)}`);
        console.log(`  updated:   ${chalk.dim(run.updatedAt)}`);

        console.log(chalk.bold(`\nStages:`));
        if (stages.length === 0) {
          console.log(chalk.dim("  (none)"));
        }
        for (const { stageName, state, artifacts } of stages) {
          const verdict = state.verdict ? ` ${chalk.dim(`verdict=${state.verdict}`)}` : "";
          console.log(
            `  ${chalk.green(stageName)}  ${chalk.cyan(state.status)}${verdict}  attempts=${state.attempt}  artifacts=${artifacts.length}`,
          );
          if (state.errorMessage) {
            console.log(`    ${chalk.red(`error: ${state.errorMessage}`)}`);
          }
          console.log(`    ${chalk.dim(`stageRunId=${state.stageRunId}`)}`);
        }

        if (loop) {
          console.log(chalk.bold(`\nLoop:`));
          console.log(`  state:    ${formatLoopState(loop.loopState)}`);
          console.log(`  rounds:   ${loop.loopRounds}`);
          if (loop.currentRunId) {
            console.log(`  current:  ${loop.currentRunId}`);
          }
        }
        console.log();
      } catch (err) {
        fail(err);
      }
    });

  pipeline
    .command("run")
    .description("Trigger a manual run for a configured pipeline")
    .argument(
      "<pipeline>",
      "Pipeline id (YAML map key) or `name` field — both are accepted",
    )
    .option("-p, --project <id>", "Project to scope to")
    .option("--session <id>", "Override the session id used to key the run")
    .option("--head-sha <sha>", "Override the head SHA recorded for the run")
    .option("--json", "Output as JSON")
    .action(
      async (
        pipelineRef: string,
        opts: { project?: string; session?: string; headSha?: string; json?: boolean },
      ) => {
        try {
          const { config, projectId, store } = openScope(opts.project);
          const pipeline = resolveConfiguredPipeline(config, projectId, pipelineRef);
          const registry = await getPluginRegistry(config);
          let runId;
          try {
            runId = triggerRun(store, registry, pipeline, {
              ...(opts.session ? { sessionId: opts.session } : {}),
              ...(opts.headSha ? { headSha: opts.headSha } : {}),
            });
          } catch (err) {
            if (err instanceof LoopAlreadyActiveError) {
              fail(err);
            }
            throw err;
          }

          if (opts.json) {
            console.log(
              JSON.stringify({ projectId, runId, pipelineName: pipeline.name }, null, 2),
            );
            return;
          }

          console.log(
            chalk.green(
              `✓ Triggered ${chalk.bold(pipeline.name)} for ${chalk.bold(projectId)} → ${runId}`,
            ),
          );
          console.log(
            chalk.dim(
              `  Run state persisted. v0.4 lifecycle integration will pick it up.`,
            ),
          );
          await warnIfAORunning(projectId);
        } catch (err) {
          fail(err);
        }
      },
    );

  pipeline
    .command("cancel")
    .description("Cancel an in-flight run (kills its stage sessions cleanly)")
    .argument("<runId>", "Pipeline run id")
    .option("-p, --project <id>", "Project to scope to")
    .option("--json", "Output as JSON")
    .action(async (runIdArg: string, opts: { project?: string; json?: boolean }) => {
      try {
        const { store, projectId } = openScope(opts.project);
        const { run, alreadyTerminal } = cancelRun(store, asRunId(runIdArg));

        if (opts.json) {
          console.log(JSON.stringify({ run, alreadyTerminal }, null, 2));
          return;
        }

        if (alreadyTerminal) {
          console.log(
            chalk.yellow(
              `⚠ ${run.runId} is already in a terminal state (${formatLoopState(run.loopState)})${run.terminationReason ? chalk.dim(` — ${run.terminationReason}`) : ""}.`,
            ),
          );
          if (run.loopState === "stalled") {
            console.log(
              chalk.dim(
                `  Use \`ao pipeline resume ${run.runId}\` to retry failed stages instead.`,
              ),
            );
          }
          return;
        }

        console.log(
          chalk.green(
            `✓ ${run.runId} → ${formatLoopState(run.loopState)}${run.terminationReason ? chalk.dim(` (${run.terminationReason})`) : ""}`,
          ),
        );
        await warnIfAORunning(projectId);
      } catch (err) {
        fail(err);
      }
    });

  pipeline
    .command("resume")
    .description("Re-attempt failed stages of a previous run")
    .argument("<runId>", "Pipeline run id")
    .option("-p, --project <id>", "Project to scope to")
    .option("--json", "Output as JSON")
    .action(async (runIdArg: string, opts: { project?: string; json?: boolean }) => {
      try {
        const { store, projectId } = openScope(opts.project);
        const result = resumeRun(store, asRunId(runIdArg));

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.resetStages.length === 0) {
          console.log(chalk.dim(`  No failed stages to resume for ${result.run.runId}.`));
          return;
        }

        if (result.run.loopState !== "running") {
          console.log(
            chalk.yellow(
              `⚠ No stages could be reset — retry cap exceeded for: ${result.resetStages.join(", ")}.`,
            ),
          );
          return;
        }

        console.log(
          chalk.green(
            `✓ Reset ${result.resetStages.length} stage(s): ${result.resetStages.join(", ")}`,
          ),
        );
        await warnIfAORunning(projectId);
      } catch (err) {
        fail(err);
      }
    });

  pipeline
    .command("migrate")
    .description("Run the pipeline store schema migration helper")
    .option("-p, --project <id>", "Project to scope to")
    .option("--json", "Output as JSON")
    .action((opts: { project?: string; json?: boolean }) => {
      try {
        const { store, projectId } = openScope(opts.project);
        const result = migrateStore(store);

        if (opts.json) {
          console.log(JSON.stringify({ projectId, ...result }, null, 2));
          return;
        }

        console.log(chalk.green(`✓ ${result.message}`));
      } catch (err) {
        fail(err);
      }
    });
}
