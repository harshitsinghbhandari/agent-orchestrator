import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const AO_OPENCODE_SECTION_START = "<!-- AO_ORCHESTRATOR_PROMPT_START -->";
const AO_OPENCODE_SECTION_END = "<!-- AO_ORCHESTRATOR_PROMPT_END -->";

export function getWorkspaceAgentsMdPath(workspacePath: string): string {
  return join(workspacePath, "AGENTS.md");
}

export function writeWorkspaceOpenCodeAgentsMd(workspacePath: string, promptFile: string): string {
  const agentsMdPath = getWorkspaceAgentsMdPath(workspacePath);
  mkdirSync(workspacePath, { recursive: true });

  const prompt = readFileSync(promptFile, "utf-8").trim();
  const content = [
    AO_OPENCODE_SECTION_START,
    "## Agent Orchestrator",
    "",
    prompt,
    AO_OPENCODE_SECTION_END,
  ].join("\n");

  writeFileSync(agentsMdPath, `${content}\n`, "utf-8");
  return agentsMdPath;
}
