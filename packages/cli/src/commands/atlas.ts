import chalk from "chalk";
import type { Command } from "commander";
import {
  atlasExists,
  initAtlas,
  listFlows,
  listPending,
  getFlow,
  getFlowContent,
  getMultipleFlowContents,
  approvePending,
  rejectPending,
  findConfigFile,
  loadConfig,
} from "@aoagents/ao-core";

function resolveRepoPath(): string {
  const configPath = findConfigFile();
  if (configPath) {
    try {
      const config = loadConfig(configPath);
      const firstProjectId = Object.keys(config.projects)[0];
      if (firstProjectId) {
        return config.projects[firstProjectId]?.path ?? process.cwd();
      }
    } catch {
      // Fall back to cwd if config is invalid
    }
  }
  return process.cwd();
}

export function registerAtlas(program: Command): void {
  const atlas = program
    .command("atlas")
    .description("Manage codebase knowledge flows");

  atlas
    .command("init")
    .description("Initialize code-atlas folder structure")
    .action(() => {
      const repoPath = resolveRepoPath();

      if (atlasExists(repoPath)) {
        console.log(chalk.dim("Atlas already initialized at this location."));
        return;
      }

      initAtlas(repoPath);
      console.log(chalk.green(`Initialized code-atlas in ${repoPath}`));
      console.log(chalk.dim("  code-atlas/"));
      console.log(chalk.dim("  ├── atlas.json"));
      console.log(chalk.dim("  ├── flows/"));
      console.log(chalk.dim("  └── .pending/"));
    });

  atlas
    .command("list")
    .description("List all approved flows")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const repoPath = resolveRepoPath();

      if (!atlasExists(repoPath)) {
        console.log(chalk.yellow("No atlas found. Run 'ao atlas init' first."));
        return;
      }

      const flows = listFlows(repoPath);

      if (opts.json) {
        console.log(JSON.stringify(flows, null, 2));
        return;
      }

      if (flows.length === 0) {
        console.log(chalk.dim("No flows in the atlas yet."));
        return;
      }

      console.log(chalk.cyan(`${flows.length} flow(s) in atlas:\n`));

      for (const flow of flows) {
        console.log(`${chalk.green(flow.id)} ${chalk.dim(`(${flow.successCount} uses)`)}`);
        console.log(`  ${flow.title}`);
        if (flow.description) {
          console.log(chalk.dim(`  ${flow.description.slice(0, 80)}${flow.description.length > 80 ? "..." : ""}`));
        }
        console.log();
      }
    });

  atlas
    .command("pending")
    .description("List pending flow changes from agents")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const repoPath = resolveRepoPath();

      if (!atlasExists(repoPath)) {
        console.log(chalk.yellow("No atlas found. Run 'ao atlas init' first."));
        return;
      }

      const pending = listPending(repoPath);

      if (opts.json) {
        console.log(JSON.stringify(pending.map((p) => ({
          id: p.id,
          title: p.frontmatter.title,
          discoveredIn: p.frontmatter.discoveredIn,
          updated: p.frontmatter.updated,
        })), null, 2));
        return;
      }

      if (pending.length === 0) {
        console.log(chalk.dim("No pending flows."));
        return;
      }

      console.log(chalk.cyan(`${pending.length} pending flow(s):\n`));

      for (const flow of pending) {
        console.log(`${chalk.yellow(flow.id)}`);
        console.log(`  Title: ${flow.frontmatter.title}`);
        console.log(`  Discovered in: ${flow.frontmatter.discoveredIn}`);
        console.log();
      }

      console.log(chalk.dim("Use 'ao atlas approve <id>' to approve or 'ao atlas reject <id>' to reject."));
    });

  atlas
    .command("approve")
    .description("Approve a pending flow change")
    .argument("<id>", "Pending flow ID")
    .action((id: string) => {
      const repoPath = resolveRepoPath();

      if (!atlasExists(repoPath)) {
        throw new Error("No atlas found. Run 'ao atlas init' first.");
      }

      const flow = approvePending(repoPath, id);

      console.log(chalk.green(`Approved: ${id} → ${flow.id}`));
      console.log(chalk.dim(`  Title: ${flow.frontmatter.title}`));
      console.log(chalk.dim(`  Success count: ${flow.metadata.successCount}`));
      console.log(chalk.dim(`  Sessions: ${flow.metadata.sourceAOSession.join(", ")}`));
    });

  atlas
    .command("reject")
    .description("Reject a pending flow change")
    .argument("<id>", "Pending flow ID")
    .action((id: string) => {
      const repoPath = resolveRepoPath();

      if (!atlasExists(repoPath)) {
        throw new Error("No atlas found. Run 'ao atlas init' first.");
      }

      rejectPending(repoPath, id);
      console.log(chalk.green(`Rejected: ${id}`));
    });

  atlas
    .command("read")
    .description("Output a flow's content")
    .argument("<id>", "Flow ID")
    .action((id: string) => {
      const repoPath = resolveRepoPath();

      if (!atlasExists(repoPath)) {
        throw new Error("No atlas found. Run 'ao atlas init' first.");
      }

      const content = getFlowContent(repoPath, id);

      if (content === null) {
        throw new Error(`Flow not found: ${id}`);
      }

      console.log(content);
    });

  atlas
    .command("use")
    .description("Output multiple flows for agent consumption")
    .argument("<ids...>", "Flow IDs to include")
    .action((ids: string[]) => {
      const repoPath = resolveRepoPath();

      if (!atlasExists(repoPath)) {
        throw new Error("No atlas found. Run 'ao atlas init' first.");
      }

      const content = getMultipleFlowContents(repoPath, ids);

      if (!content) {
        throw new Error(`No flows found for: ${ids.join(", ")}`);
      }

      console.log(content);
    });

  atlas
    .command("show")
    .description("Show detailed information about a flow")
    .argument("<id>", "Flow ID")
    .action((id: string) => {
      const repoPath = resolveRepoPath();

      if (!atlasExists(repoPath)) {
        throw new Error("No atlas found. Run 'ao atlas init' first.");
      }

      const flow = getFlow(repoPath, id);

      if (flow === null) {
        throw new Error(`Flow not found: ${id}`);
      }

      console.log(chalk.cyan(`Flow: ${flow.id}\n`));
      console.log(`Title: ${flow.frontmatter.title}`);
      console.log(`Discovered in: ${flow.frontmatter.discoveredIn}`);
      console.log(`Last updated: ${flow.metadata.lastUpdated}`);
      console.log(`Success count: ${flow.metadata.successCount}`);
      console.log(`Source sessions: ${flow.metadata.sourceAOSession.join(", ")}`);

      if (flow.frontmatter.relatedFlows && flow.frontmatter.relatedFlows.length > 0) {
        console.log(`Related flows: ${flow.frontmatter.relatedFlows.join(", ")}`);
      }

      console.log(chalk.dim("\n--- Content ---\n"));
      console.log(flow.body);
    });
}
