/**
 * `ao artifact` — inspect findings produced by a stage run.
 */

import type { Command } from "commander";
import {
  asStageRunId,
  createPipelineStore,
  getProjectPipelinesDir,
  loadConfig,
} from "@aoagents/ao-core";

import { fail } from "../lib/cli-utils.js";
import { resolveScopedProjectId } from "../lib/project-resolution.js";
import { readStageArtifacts } from "../lib/pipeline-service.js";

export function registerArtifact(program: Command): void {
  const artifact = program
    .command("artifact")
    .description("Pipeline artifact inspection");

  artifact
    .command("show")
    .description("Print findings JSONL for a stage run")
    .argument("<stageRunId>", "Stage run id")
    .option("-p, --project <id>", "Project to scope to")
    .option("--pretty", "Pretty-print each artifact (multi-line JSON)")
    .action(
      (stageRunIdArg: string, opts: { project?: string; pretty?: boolean }) => {
        try {
          const config = loadConfig();
          const projectId = resolveScopedProjectId(config, opts.project);
          const store = createPipelineStore(getProjectPipelinesDir(projectId));
          const artifacts = readStageArtifacts(store, asStageRunId(stageRunIdArg));

          for (const a of artifacts) {
            console.log(opts.pretty ? JSON.stringify(a, null, 2) : JSON.stringify(a));
          }
        } catch (err) {
          fail(err);
        }
      },
    );
}
