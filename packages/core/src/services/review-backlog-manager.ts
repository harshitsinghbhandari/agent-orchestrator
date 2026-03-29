import type { Session, SessionStatus, OrchestratorConfig, PluginRegistry, SCM, ReactionResult } from "../types.js";
import type { ReactionExecutor } from "./reaction-executor.js";

export interface ReviewBacklogManager {
  maybeDispatchReviewBacklog(
    session: Session,
    oldStatus: SessionStatus,
    newStatus: SessionStatus,
    transitionReaction?: { key: string; result: ReactionResult | null },
  ): Promise<void>;
}

export function createReviewBacklogManager(
  config: OrchestratorConfig,
  registry: PluginRegistry,
  reactionExecutor: ReactionExecutor,
  updateSessionMetadata: (session: Session, updates: Partial<Record<string, string>>) => Promise<void>,
): ReviewBacklogManager {
  function makeFingerprint(ids: string[]): string {
    return [...ids].sort().join(",");
  }

  return {
    async maybeDispatchReviewBacklog(
      session: Session,
      oldStatus: SessionStatus,
      newStatus: SessionStatus,
      transitionReaction?: { key: string; result: ReactionResult | null },
    ): Promise<void> {
      const project = config.projects[session.projectId];
      if (!project || !session.pr) return;

      const scm = project.scm ? registry.get<SCM>("scm", project.scm.plugin) : null;
      if (!scm) return;

      const humanReactionKey = "changes-requested";
      const automatedReactionKey = "bugbot-comments";

      if (newStatus === "merged" || newStatus === "killed") {
        reactionExecutor.clearReactionTracker(session.id, humanReactionKey);
        reactionExecutor.clearReactionTracker(session.id, automatedReactionKey);
        await updateSessionMetadata(session, {
          lastPendingReviewFingerprint: "",
          lastPendingReviewDispatchHash: "",
          lastPendingReviewDispatchAt: "",
          lastAutomatedReviewFingerprint: "",
          lastAutomatedReviewDispatchHash: "",
          lastAutomatedReviewDispatchAt: "",
        });
        return;
      }

      const [pendingResult, automatedResult] = await Promise.allSettled([
        scm.getPendingComments(session.pr),
        scm.getAutomatedComments(session.pr),
      ]);

      const pendingComments =
        pendingResult.status === "fulfilled" && Array.isArray(pendingResult.value)
          ? pendingResult.value
          : null;
      const automatedComments =
        automatedResult.status === "fulfilled" && Array.isArray(automatedResult.value)
          ? automatedResult.value
          : null;

      // Pending (human) comments
      if (pendingComments !== null) {
        const pendingFingerprint = makeFingerprint(pendingComments.map((c) => c.id));
        const lastPendingFingerprint = session.metadata["lastPendingReviewFingerprint"] ?? "";
        const lastPendingDispatchHash = session.metadata["lastPendingReviewDispatchHash"] ?? "";

        if (pendingFingerprint !== lastPendingFingerprint && transitionReaction?.key !== humanReactionKey) {
          reactionExecutor.clearReactionTracker(session.id, humanReactionKey);
        }
        if (pendingFingerprint !== lastPendingFingerprint) {
          await updateSessionMetadata(session, { lastPendingReviewFingerprint: pendingFingerprint });
        }

        if (!pendingFingerprint) {
          reactionExecutor.clearReactionTracker(session.id, humanReactionKey);
          await updateSessionMetadata(session, {
            lastPendingReviewFingerprint: "",
            lastPendingReviewDispatchHash: "",
            lastPendingReviewDispatchAt: "",
          });
        } else if (transitionReaction?.key === humanReactionKey && transitionReaction.result?.success) {
          if (lastPendingDispatchHash !== pendingFingerprint) {
            await updateSessionMetadata(session, {
              lastPendingReviewDispatchHash: pendingFingerprint,
              lastPendingReviewDispatchAt: new Date().toISOString(),
            });
          }
        } else if (!(oldStatus !== newStatus && newStatus === "changes_requested") && pendingFingerprint !== lastPendingDispatchHash) {
          const reactionConfig = reactionExecutor.getReactionConfigForSession(session, humanReactionKey);
          if (reactionConfig && reactionConfig.action && (reactionConfig.auto !== false || reactionConfig.action === "notify")) {
            const result = await reactionExecutor.execute(session.id, session.projectId, humanReactionKey, reactionConfig);
            if (result.success) {
              await updateSessionMetadata(session, {
                lastPendingReviewDispatchHash: pendingFingerprint,
                lastPendingReviewDispatchAt: new Date().toISOString(),
              });
            }
          }
        }
      }

      // Automated comments
      if (automatedComments !== null) {
        const automatedFingerprint = makeFingerprint(automatedComments.map((c) => c.id));
        const lastAutomatedFingerprint = session.metadata["lastAutomatedReviewFingerprint"] ?? "";
        const lastAutomatedDispatchHash = session.metadata["lastAutomatedReviewDispatchHash"] ?? "";

        if (automatedFingerprint !== lastAutomatedFingerprint) {
          reactionExecutor.clearReactionTracker(session.id, automatedReactionKey);
          await updateSessionMetadata(session, { lastAutomatedReviewFingerprint: automatedFingerprint });
        }

        if (!automatedFingerprint) {
          reactionExecutor.clearReactionTracker(session.id, automatedReactionKey);
          await updateSessionMetadata(session, {
            lastAutomatedReviewFingerprint: "",
            lastAutomatedReviewDispatchHash: "",
            lastAutomatedReviewDispatchAt: "",
          });
        } else if (automatedFingerprint !== lastAutomatedDispatchHash) {
          const reactionConfig = reactionExecutor.getReactionConfigForSession(session, automatedReactionKey);
          if (reactionConfig && reactionConfig.action && (reactionConfig.auto !== false || reactionConfig.action === "notify")) {
            const result = await reactionExecutor.execute(session.id, session.projectId, automatedReactionKey, reactionConfig);
            if (result.success) {
              await updateSessionMetadata(session, {
                lastAutomatedReviewDispatchHash: automatedFingerprint,
                lastAutomatedReviewDispatchAt: new Date().toISOString(),
              });
            }
          }
        }
      }
    },
  };
}
