import type {
  SessionId,
  ReactionConfig,
  ReactionResult,
  SessionManager,
  Session,
  OrchestratorConfig,
  OrchestratorEvent,
} from "../types.js";
import { parseDuration } from "./session-state-detector.js";

interface ReactionTracker {
  attempts: number;
  firstTriggered: Date;
}

export interface ReactionExecutor {
  execute(
    sessionId: SessionId,
    projectId: string,
    reactionKey: string,
    reactionConfig: ReactionConfig,
  ): Promise<ReactionResult>;
  clearReactionTracker(sessionId: SessionId, reactionKey: string): void;
  getReactionConfigForSession(session: Session, reactionKey: string): ReactionConfig | null;
  pruneTrackers(activeSessionIds: Set<string>): void;
}

import type { EventPriority, EventType } from "../types.js";

export function createReactionExecutor(
  config: OrchestratorConfig,
  sessionManager: SessionManager,
  notifyHuman: (event: OrchestratorEvent, priority: EventPriority) => Promise<void>,
  createEvent: (type: EventType, opts: any) => OrchestratorEvent,
): ReactionExecutor {
  const reactionTrackers = new Map<string, ReactionTracker>();

  return {
    async execute(
      sessionId: SessionId,
      projectId: string,
      reactionKey: string,
      reactionConfig: ReactionConfig,
    ): Promise<ReactionResult> {
      const trackerKey = `${sessionId}:${reactionKey}`;
      let tracker = reactionTrackers.get(trackerKey);

      if (!tracker) {
        tracker = { attempts: 0, firstTriggered: new Date() };
        reactionTrackers.set(trackerKey, tracker);
      }

      tracker.attempts++;

      const maxRetries = reactionConfig.retries ?? Infinity;
      const escalateAfter = reactionConfig.escalateAfter;
      let shouldEscalate = false;

      if (tracker.attempts > maxRetries) {
        shouldEscalate = true;
      }

      if (typeof escalateAfter === "string") {
        const durationMs = parseDuration(escalateAfter);
        if (durationMs > 0 && Date.now() - tracker.firstTriggered.getTime() > durationMs) {
          shouldEscalate = true;
        }
      }

      if (typeof escalateAfter === "number" && tracker.attempts > escalateAfter) {
        shouldEscalate = true;
      }

      if (shouldEscalate) {
        const event = createEvent("reaction.escalated" as EventType, {
          sessionId,
          projectId,
          message: `Reaction '${reactionKey}' escalated after ${tracker.attempts} attempts`,
          data: { reactionKey, attempts: tracker.attempts },
        });
        await notifyHuman(event, reactionConfig.priority ?? "urgent");
        return {
          reactionType: reactionKey,
          success: true,
          action: "escalated",
          escalated: true,
        };
      }

      const action = reactionConfig.action ?? "notify";

      switch (action) {
        case "send-to-agent": {
          if (reactionConfig.message) {
            try {
              await sessionManager.send(sessionId, reactionConfig.message);
              return {
                reactionType: reactionKey,
                success: true,
                action: "send-to-agent",
                message: reactionConfig.message,
                escalated: false,
              };
            } catch {
              return {
                reactionType: reactionKey,
                success: false,
                action: "send-to-agent",
                escalated: false,
              };
            }
          }
          break;
        }

        case "notify": {
          const event = createEvent("reaction.triggered" as EventType, {
            sessionId,
            projectId,
            message: `Reaction '${reactionKey}' triggered notification`,
            data: { reactionKey },
          });
          await notifyHuman(event, reactionConfig.priority ?? "info");
          return {
            reactionType: reactionKey,
            success: true,
            action: "notify",
            escalated: false,
          };
        }

        case "auto-merge": {
          const event = createEvent("reaction.triggered" as EventType, {
            sessionId,
            projectId,
            message: `Reaction '${reactionKey}' triggered auto-merge`,
            data: { reactionKey },
          });
          await notifyHuman(event, "action");
          return {
            reactionType: reactionKey,
            success: true,
            action: "auto-merge",
            escalated: false,
          };
        }
      }

      return {
        reactionType: reactionKey,
        success: false,
        action,
        escalated: false,
      };
    },

    clearReactionTracker(sessionId: SessionId, reactionKey: string): void {
      reactionTrackers.delete(`${sessionId}:${reactionKey}`);
    },

    getReactionConfigForSession(session: Session, reactionKey: string): ReactionConfig | null {
      const project = config.projects[session.projectId];
      const globalReaction = config.reactions[reactionKey];
      const projectReaction = project?.reactions?.[reactionKey];
      const reactionConfig = projectReaction
        ? { ...globalReaction, ...projectReaction }
        : globalReaction;
      return reactionConfig ? (reactionConfig as ReactionConfig) : null;
    },

    pruneTrackers(activeSessionIds: Set<string>): void {
      for (const trackerKey of reactionTrackers.keys()) {
        const sessionId = trackerKey.split(":")[0];
        if (sessionId && !activeSessionIds.has(sessionId)) {
          reactionTrackers.delete(trackerKey);
        }
      }
    },
  };
}
