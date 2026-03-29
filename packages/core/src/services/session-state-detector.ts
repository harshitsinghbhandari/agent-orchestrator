import type {
  Session,
  SessionStatus,
  OrchestratorConfig,
  PluginRegistry,
  Agent,
  SCM,
  Runtime,
} from "../types.js";
import { resolveAgentSelection, resolveSessionRole } from "../agent-selection.js";
import { getSessionsDir } from "../paths.js";
import { metadataService } from "./metadata-service.js";
import { handleError } from "../errors.js";

/** Parse a duration string like "10m", "30s", "1h" to milliseconds. */
export function parseDuration(str: string): number {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 3_600_000;
    default:
      return 0;
  }
}

export interface SessionStateDetector {
  determineStatus(session: Session): Promise<SessionStatus>;
}

export function createSessionStateDetector(
  config: OrchestratorConfig,
  registry: PluginRegistry,
): SessionStateDetector {
  function isIdleBeyondThreshold(session: Session, idleTimestamp: Date): boolean {
    const project = config.projects[session.projectId];
    const globalReaction = config.reactions["agent-stuck"];
    const projectReaction = project?.reactions?.["agent-stuck"];
    const stuckReaction = projectReaction
      ? { ...globalReaction, ...projectReaction }
      : globalReaction;

    const thresholdStr = stuckReaction?.threshold;
    if (typeof thresholdStr !== "string") return false;
    const stuckThresholdMs = parseDuration(thresholdStr);
    if (stuckThresholdMs <= 0) return false;
    const idleMs = Date.now() - idleTimestamp.getTime();
    return idleMs > stuckThresholdMs;
  }

  return {
    async determineStatus(session: Session): Promise<SessionStatus> {
      const project = config.projects[session.projectId];
      if (!project) return session.status;

      const agentName = resolveAgentSelection({
        role: resolveSessionRole(session.id, session.metadata),
        project,
        defaults: config.defaults,
        persistedAgent: session.metadata["agent"],
      }).agentName;
      const agent = registry.get<Agent>("agent", agentName);
      const scm = project.scm ? registry.get<SCM>("scm", project.scm.plugin) : null;

      let detectedIdleTimestamp: Date | null = null;

      // 1. Check if runtime is alive
      if (session.runtimeHandle) {
        const runtime = registry.get<Runtime>(
          "runtime",
          project.runtime ?? config.defaults.runtime,
        );
        if (runtime) {
          const alive = await runtime.isAlive(session.runtimeHandle).catch(() => true);
          if (!alive) return "killed";
        }
      }

      // 2. Check agent activity
      if (agent && session.runtimeHandle) {
        try {
          const activityState = await agent.getActivityState(session, config.readyThresholdMs);
          if (activityState) {
            if (activityState.state === "waiting_input") return "needs_input";
            if (activityState.state === "exited") return "killed";

            if (
              (activityState.state === "idle" || activityState.state === "blocked") &&
              activityState.timestamp
            ) {
              detectedIdleTimestamp = activityState.timestamp;
            }
          } else {
            const runtime = registry.get<Runtime>(
              "runtime",
              project.runtime ?? config.defaults.runtime,
            );
            const terminalOutput = runtime
              ? await runtime.getOutput(session.runtimeHandle, 10)
              : "";
            if (terminalOutput) {
              const activity = agent.detectActivity(terminalOutput);
              if (activity === "waiting_input") return "needs_input";

              const processAlive = await agent.isProcessRunning(session.runtimeHandle);
              if (!processAlive) return "killed";
            }
          }
        } catch (error) {
          handleError(
            error,
            { sessionId: session.id, projectId: session.projectId, operation: "agentProbe" },
            "preserve-state",
          );
          if (session.status === "stuck" || session.status === "needs_input") {
            return session.status;
          }
        }
      }

      // 3. Auto-detect PR
      if (
        !session.pr &&
        scm &&
        session.branch &&
        session.metadata["prAutoDetect"] !== "off" &&
        session.metadata["role"] !== "orchestrator" &&
        !session.id.endsWith("-orchestrator")
      ) {
        try {
          const detectedPR = await scm.detectPR(session, project);
          if (detectedPR) {
            session.pr = detectedPR;
            const sessionsDir = getSessionsDir(config.configPath, project.path);
            await metadataService.update(sessionsDir, session.id, { pr: detectedPR.url });
          }
        } catch (error) {
          handleError(
            error,
            { sessionId: session.id, projectId: session.projectId, operation: "detectPR" },
            "preserve-state",
          );
        }
      }

      // 4. Check PR state
      if (session.pr && scm) {
        try {
          const prState = await scm.getPRState(session.pr);
          if (prState === "merged") return "merged";
          if (prState === "closed") return "killed";

          const ciStatus = await scm.getCISummary(session.pr);
          if (ciStatus === "failing") return "ci_failed";

          const reviewDecision = await scm.getReviewDecision(session.pr);
          if (reviewDecision === "changes_requested") return "changes_requested";
          if (reviewDecision === "approved" || reviewDecision === "none") {
            const mergeReady = await scm.getMergeability(session.pr);
            if (mergeReady.mergeable) return "mergeable";
            if (reviewDecision === "approved") return "approved";
          }
          if (reviewDecision === "pending") return "review_pending";

          if (detectedIdleTimestamp && isIdleBeyondThreshold(session, detectedIdleTimestamp)) {
            return "stuck";
          }

          return "pr_open";
        } catch (error) {
          handleError(
            error,
            { sessionId: session.id, projectId: session.projectId, operation: "SCM_checks" },
            "preserve-state",
          );
        }
      }

      // 5. Post-all stuck detection
      if (detectedIdleTimestamp && isIdleBeyondThreshold(session, detectedIdleTimestamp)) {
        return "stuck";
      }

      // 6. Default
      if (
        session.status === "spawning" ||
        session.status === "stuck" ||
        session.status === "needs_input"
      ) {
        return "working";
      }
      return session.status;
    },
  };
}
