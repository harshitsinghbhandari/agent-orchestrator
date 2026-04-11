import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OPENCODE_INTERNAL_ORCHESTRATOR_AGENT_NAME = "__ao_orchestrator_internal";

export function getWorkspaceOpenCodeConfigPath(workspacePath: string): string {
  return join(workspacePath, ".ao", "opencode.json");
}

export function writeWorkspaceOpenCodeConfig(workspacePath: string, promptFile: string): string {
  const configPath = getWorkspaceOpenCodeConfigPath(workspacePath);
  const configDir = join(workspacePath, ".ao");
  mkdirSync(configDir, { recursive: true });

  const config = {
    $schema: "https://opencode.ai/config.json",
    default_agent: OPENCODE_INTERNAL_ORCHESTRATOR_AGENT_NAME,
    agent: {
      [OPENCODE_INTERNAL_ORCHESTRATOR_AGENT_NAME]: {
        description: "Agent Orchestrator internal orchestrator agent",
        mode: "primary",
        prompt: `{file:${promptFile}}`,
      },
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return configPath;
}
