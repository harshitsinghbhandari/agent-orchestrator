import type { OrchestratorConfig } from "../types.js";

/**
 * Given a session ID and the orchestrator config, find which project it belongs
 * to by matching session prefixes.
 */
export function resolveProjectIdForSessionId(
  config: OrchestratorConfig,
  sessionId: string,
): string | undefined {
  for (const [projectId, project] of Object.entries(config.projects)) {
    const prefix = project.sessionPrefix;
    if (sessionId === prefix || sessionId.startsWith(`${prefix}-`)) {
      return projectId;
    }
  }
  return undefined;
}
