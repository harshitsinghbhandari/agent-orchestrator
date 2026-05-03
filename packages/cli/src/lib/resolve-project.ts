/**
 * Unified project resolution for `ao start`.
 *
 * Replaces the per-arg-shape dispatch that lived inline in start.ts (URL →
 * handleUrlStart, path → addProjectToConfig, none → loadConfig/autoCreate +
 * registerFlatConfig recovery, project-id → resolveProject). Each shape
 * still has its own helper here, but they all return the same shape so
 * the caller can treat them uniformly.
 *
 * Today this module only covers the not-running path. The "AO is already
 * running" branch in start.ts still has its own inline clone+register
 * block (it intentionally avoids handleUrlStart's legacy wrapped local
 * config); migrating it to use resolveOrCreateProject is a follow-up
 * before PR B.2's daemon unification.
 */

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import {
  ConfigNotFoundError,
  findConfigFile,
  generateConfigFromUrl,
  configToYaml,
  isRepoUrl,
  loadConfig,
  parseRepoUrl,
  resolveCloneTarget,
  isRepoAlreadyCloned,
  getGlobalConfigPath,
  type OrchestratorConfig,
  type ParsedRepoUrl,
  type ProjectConfig,
} from "@aoagents/ao-core";
import chalk from "chalk";
import ora from "ora";
import { findFreePort } from "./web-dir.js";
import { DEFAULT_PORT } from "./constants.js";
import { ensureGit } from "./startup-preflight.js";

export type ProjectSource = "url" | "path" | "cwd" | "existing-id";

export interface Resolved {
  config: OrchestratorConfig;
  projectId: string;
  project: ProjectConfig;
  source: ProjectSource;
  /** True when this resolve call wrote new state to disk (cloned a repo,
   *  generated a config, or registered a project). False when the project
   *  was already known. Useful for dashboard cache invalidation hints. */
  justCreated: boolean;
  /** Populated only when source === "url". */
  parsed?: ParsedRepoUrl;
}

/**
 * Dependencies the resolver needs to delegate to existing start.ts helpers.
 * Passed in rather than imported to keep this module decoupled from
 * start.ts's other concerns (interactive prompts, agent detection, etc.).
 */
export interface ResolveDeps {
  /**
   * Add an unregistered local path as a new project. The signature matches
   * start.ts's `addProjectToConfig`. Returns the registered project id.
   */
  addProjectToConfig: (config: OrchestratorConfig, path: string) => Promise<string>;
  /**
   * Auto-create a config when none exists at `workingDir`. Matches
   * start.ts's `autoCreateConfig`. Returns the loaded config.
   */
  autoCreateConfig: (workingDir: string) => Promise<OrchestratorConfig>;
  /**
   * Resolve an existing project from a loaded config (handles single-
   * project, explicit arg, multi-project prompt). Matches start.ts's
   * `resolveProject`.
   */
  resolveProject: (
    config: OrchestratorConfig,
    projectArg?: string,
  ) => Promise<{ projectId: string; project: ProjectConfig; config: OrchestratorConfig }>;
  /**
   * Resolve a project from a loaded config by matching the URL's
   * `ownerRepo`. Matches start.ts's `resolveProjectByRepo`.
   */
  resolveProjectByRepo: (
    config: OrchestratorConfig,
    parsed: ParsedRepoUrl,
  ) => Promise<{ projectId: string; project: ProjectConfig; config: OrchestratorConfig }>;
  /**
   * Recover a flat local config that exists but isn't registered globally.
   * Matches start.ts's `registerFlatConfig`. Returns the registered id, or
   * null if recovery is not possible.
   */
  registerFlatConfig: (configPath: string) => Promise<string | null>;
  /**
   * Clone a repo into the target dir. Matches start.ts's `cloneRepo`.
   */
  cloneRepo: (parsed: ParsedRepoUrl, targetDir: string, cwd: string) => Promise<void>;
}

/**
 * Decide whether `arg` looks like a path (rather than a project id).
 * Matches start.ts's `isLocalPath`.
 */
function isLocalPath(arg: string): boolean {
  return arg.startsWith("/") || arg.startsWith("~") || arg.startsWith("./") || arg.startsWith("..");
}

async function fromUrl(arg: string, deps: ResolveDeps): Promise<Resolved> {
  console.log(chalk.bold.cyan("\n  Agent Orchestrator — Quick Start\n"));
  const spinner = ora();

  spinner.start("Parsing repository URL");
  const parsed = parseRepoUrl(arg);
  spinner.succeed(`Repository: ${chalk.cyan(parsed.ownerRepo)} (${parsed.host})`);

  await ensureGit("repository cloning");

  const cwdDir = process.cwd();
  const targetDir = resolveCloneTarget(parsed, cwdDir);
  const alreadyCloned = isRepoAlreadyCloned(targetDir, parsed.cloneUrl);

  if (alreadyCloned) {
    console.log(chalk.green(`  Reusing existing clone at ${targetDir}`));
  } else {
    spinner.start(`Cloning ${parsed.ownerRepo}`);
    try {
      spinner.stop();
      await deps.cloneRepo(parsed, targetDir, cwdDir);
      spinner.succeed(`Cloned to ${targetDir}`);
    } catch (err) {
      spinner.fail("Clone failed");
      throw new Error(
        `Failed to clone ${parsed.ownerRepo}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  const configPath = resolve(targetDir, "agent-orchestrator.yaml");
  const configPathAlt = resolve(targetDir, "agent-orchestrator.yml");

  let config: OrchestratorConfig;
  let justCreated: boolean;
  if (existsSync(configPath)) {
    console.log(chalk.green(`  Using existing config: ${configPath}`));
    config = loadConfig(configPath);
    justCreated = false;
  } else if (existsSync(configPathAlt)) {
    console.log(chalk.green(`  Using existing config: ${configPathAlt}`));
    config = loadConfig(configPathAlt);
    justCreated = false;
  } else {
    spinner.start("Generating config");
    const freePort = await findFreePort(DEFAULT_PORT);
    const rawConfig = generateConfigFromUrl({
      parsed,
      repoPath: targetDir,
      port: freePort ?? DEFAULT_PORT,
    });
    const yamlContent = configToYaml(rawConfig);
    writeFileSync(configPath, yamlContent);
    spinner.succeed(`Config generated: ${configPath}`);
    config = loadConfig(configPath);
    justCreated = true;
  }

  const resolved = await deps.resolveProjectByRepo(config, parsed);
  return {
    config: resolved.config,
    projectId: resolved.projectId,
    project: resolved.project,
    source: "url",
    justCreated,
    parsed,
  };
}

async function fromPath(arg: string, deps: ResolveDeps): Promise<Resolved> {
  const resolvedPath = resolve(arg.replace(/^~/, process.env["HOME"] || ""));

  let configPath: string | undefined;
  try {
    configPath = findConfigFile() ?? undefined;
  } catch {
    // No config — fall through to autoCreate.
  }

  if (!configPath) {
    // No config anywhere — auto-create at the target path (or cwd if they match).
    const targetDir = resolve(cwd()) === resolvedPath ? cwd() : resolvedPath;
    const config = await deps.autoCreateConfig(targetDir);
    const resolved = await deps.resolveProject(config);
    return {
      config: resolved.config,
      projectId: resolved.projectId,
      project: resolved.project,
      source: "path",
      justCreated: true,
    };
  }

  // Config exists — check if the path is already registered.
  const config = loadConfig(configPath);
  const existingEntry = Object.entries(config.projects).find(
    ([, p]) => resolve(p.path.replace(/^~/, process.env["HOME"] || "")) === resolvedPath,
  );

  if (existingEntry) {
    return {
      config,
      projectId: existingEntry[0],
      project: existingEntry[1],
      source: "path",
      justCreated: false,
    };
  }

  // Path is new — register it.
  const addedId = await deps.addProjectToConfig(config, resolvedPath);
  const reloaded = loadConfig(config.configPath);
  return {
    config: reloaded,
    projectId: addedId,
    project: reloaded.projects[addedId],
    source: "path",
    justCreated: true,
  };
}

async function fromCwdOrId(arg: string | undefined, deps: ResolveDeps): Promise<Resolved> {
  let config: OrchestratorConfig;
  let recovered = false;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigNotFoundError) {
      // First run — auto-create config in cwd.
      config = await deps.autoCreateConfig(cwd());
      recovered = true;
    } else {
      // A config file exists but failed to load — likely a flat local
      // config whose project isn't in the global registry yet. Recover
      // by registering it, then retry the load.
      const foundConfig = findConfigFile() ?? undefined;
      if (!foundConfig) throw err;
      const addedId = await deps.registerFlatConfig(foundConfig);
      if (!addedId) throw err;
      config = loadConfig(foundConfig);
      recovered = true;
    }
  }

  // If the user named a project that isn't in the local config, fall back
  // to the global registry (which has all registered projects).
  if (arg && !config.projects[arg]) {
    const globalPath = getGlobalConfigPath();
    if (existsSync(globalPath)) {
      config = loadConfig(globalPath);
    }
  }

  const resolved = await deps.resolveProject(config, arg);
  return {
    config: resolved.config,
    projectId: resolved.projectId,
    project: resolved.project,
    source: arg ? "existing-id" : "cwd",
    justCreated: recovered,
  };
}

/**
 * Resolve (and create if necessary) the project a given `ao start [arg]`
 * invocation refers to.
 *
 * Dispatches by arg shape:
 * - `arg` is a URL → clone (or reuse), load/generate config, match by repo
 * - `arg` is a local path → load existing or addProject or autoCreate
 * - `arg` is a project id → load config, fall back to global if needed
 * - `arg` is undefined → load cwd config, autoCreate on first run, register
 *   flat configs that exist but aren't globally known
 *
 * The same `Resolved` shape comes back regardless of source; callers use
 * `source` and `justCreated` for hints (e.g. dashboard cache invalidation).
 */
export async function resolveOrCreateProject(
  arg: string | undefined,
  deps: ResolveDeps,
): Promise<Resolved> {
  if (arg && isRepoUrl(arg)) return fromUrl(arg, deps);
  if (arg && isLocalPath(arg)) return fromPath(arg, deps);
  return fromCwdOrId(arg, deps);
}
