/**
 * `ao stage` — inspect a single stage run.
 */

import chalk from "chalk";
import type { Command } from "commander";
import {
  asStageRunId,
  createPipelineStore,
  getProjectPipelinesDir,
  loadConfig,
} from "@aoagents/ao-core";

import { fail } from "../lib/cli-utils.js";
import { resolveScopedProjectId } from "../lib/project-resolution.js";
import { describeStage } from "../lib/pipeline-service.js";

export function registerStage(program: Command): void {
  const stage = program.command("stage").description("Pipeline stage inspection");

  stage
    .command("show")
    .description("Show a stage run with its artifacts")
    .argument("<stageRunId>", "Stage run id")
    .option("-p, --project <id>", "Project to scope to")
    .option("--json", "Output as JSON")
    .action((stageRunIdArg: string, opts: { project?: string; json?: boolean }) => {
      try {
        const config = loadConfig();
        const projectId = resolveScopedProjectId(config, opts.project);
        const store = createPipelineStore(getProjectPipelinesDir(projectId));
        const detail = describeStage(store, asStageRunId(stageRunIdArg));

        if (opts.json) {
          console.log(JSON.stringify(detail, null, 2));
          return;
        }

        const { stage: stageRun, run, artifacts } = detail;
        console.log(chalk.bold(`\nStage ${stageRun.stageRunId}`));
        console.log(`  stage:     ${chalk.cyan(stageRun.stageName)}`);
        console.log(`  run:       ${stageRun.runId}`);
        if (run) {
          console.log(`  pipeline:  ${chalk.cyan(run.pipelineName)}`);
          console.log(`  session:   ${run.sessionId}`);
        }
        console.log(`  status:    ${chalk.cyan(stageRun.status)}`);
        if (stageRun.verdict) {
          console.log(`  verdict:   ${stageRun.verdict}`);
        }
        console.log(`  attempts:  ${stageRun.attempt}`);
        if (stageRun.startedAt) {
          console.log(`  started:   ${chalk.dim(stageRun.startedAt)}`);
        }
        if (stageRun.completedAt) {
          console.log(`  completed: ${chalk.dim(stageRun.completedAt)}`);
        }
        if (stageRun.errorMessage) {
          console.log(`  ${chalk.red(`error: ${stageRun.errorMessage}`)}`);
        }

        console.log(chalk.bold(`\nArtifacts (${artifacts.length}):`));
        if (artifacts.length === 0) {
          console.log(chalk.dim("  (none)"));
        } else {
          for (const art of artifacts) {
            if (art.kind === "finding") {
              console.log(
                `  ${chalk.green(art.artifactId)}  ${chalk.cyan(art.severity)}  ${art.title}  ${chalk.dim(`${art.filePath}:${art.startLine}`)}`,
              );
            } else {
              console.log(`  ${chalk.green(art.artifactId)}  ${chalk.cyan("json")}`);
            }
          }
        }
        console.log();
      } catch (err) {
        fail(err);
      }
    });
}
