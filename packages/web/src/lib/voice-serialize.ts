/**
 * Voice event serialization layer.
 *
 * Transforms AO dashboard sessions into VoiceEvent objects that can be
 * sent to the Gemini Live API for spoken announcements.
 */

import type { DashboardSession, DashboardPR, AttentionLevel, CIStatus, ReviewDecision } from "./types";
import { getAttentionLevel, isPRMergeReady } from "./types";
import type { SpeakableEventType } from "./voice-dedupe";

/**
 * VoiceEvent schema for the voice layer.
 * Contains structured context for TTS and follow-up queries.
 */
export interface VoiceEvent {
  eventId: string;
  eventType: SpeakableEventType;
  priority: "urgent" | "action" | "warning" | "info";
  timestamp: string; // ISO 8601
  sessionId: string;
  projectId: string;
  message: string; // Human-readable, for TTS

  // Structured context for follow-up queries
  context: {
    prUrl?: string;
    prNumber?: number;
    ciStatus?: CIStatus;
    reviewDecision?: ReviewDecision;
    summary?: string;
    attentionLevel?: AttentionLevel;
  };
}

/**
 * Map event types to priority levels
 */
function getEventPriority(eventType: SpeakableEventType): VoiceEvent["priority"] {
  switch (eventType) {
    case "ci.failing":
    case "session.stuck":
    case "session.needs_input":
      return "action";
    case "review.changes_requested":
      return "warning";
    case "merge.ready":
      return "info";
    default:
      return "info";
  }
}

/**
 * Generate a human-readable message for an event
 */
function generateEventMessage(
  eventType: SpeakableEventType,
  session: DashboardSession,
): string {
  const sessionLabel = session.issueLabel
    ? `Session ${session.id} for ${session.issueLabel}`
    : `Session ${session.id}`;

  switch (eventType) {
    case "ci.failing":
      return `${sessionLabel} has failing CI checks. The PR needs attention.`;

    case "review.changes_requested":
      return `${sessionLabel} has review comments requesting changes.`;

    case "session.stuck":
      return `${sessionLabel} appears to be stuck. The agent hasn't made progress recently.`;

    case "session.needs_input":
      return `${sessionLabel} is waiting for your input. The agent needs human intervention.`;

    case "merge.ready":
      return `${sessionLabel} is ready to merge. The PR is approved and CI is green.`;

    default:
      return `${sessionLabel} has an update.`;
  }
}

/**
 * Counter for unique event IDs within the same millisecond
 */
let eventIdCounter = 0;

/**
 * Generate a unique event ID
 */
function generateEventId(sessionId: string, eventType: string): string {
  eventIdCounter = (eventIdCounter + 1) % 10000;
  return `${sessionId}-${eventType}-${Date.now()}-${eventIdCounter}`;
}

/**
 * Create a VoiceEvent from a dashboard session and event type
 */
export function createVoiceEvent(
  session: DashboardSession,
  eventType: SpeakableEventType,
): VoiceEvent {
  const pr = session.pr;

  return {
    eventId: generateEventId(session.id, eventType),
    eventType,
    priority: getEventPriority(eventType),
    timestamp: new Date().toISOString(),
    sessionId: session.id,
    projectId: session.projectId,
    message: generateEventMessage(eventType, session),
    context: {
      prUrl: pr?.url,
      prNumber: pr?.number,
      ciStatus: pr?.ciStatus,
      reviewDecision: pr?.reviewDecision,
      summary: session.summary ?? undefined,
      attentionLevel: getAttentionLevel(session),
    },
  };
}

/**
 * Determine which events should be triggered based on session state changes
 *
 * Compares previous and current session states to detect transitions
 * that should trigger voice announcements.
 */
export function detectStateChanges(
  previousSession: DashboardSession | null,
  currentSession: DashboardSession,
): SpeakableEventType[] {
  const events: SpeakableEventType[] = [];

  const prevPr = previousSession?.pr;
  const currPr = currentSession.pr;

  // CI failing: transition from non-failing to failing
  if (currPr?.ciStatus === "failing" && prevPr?.ciStatus !== "failing") {
    events.push("ci.failing");
  }

  // Review changes requested: transition to changes_requested
  if (
    currPr?.reviewDecision === "changes_requested" &&
    prevPr?.reviewDecision !== "changes_requested"
  ) {
    events.push("review.changes_requested");
  }

  // Session stuck: transition to stuck status
  if (
    currentSession.status === "stuck" &&
    previousSession?.status !== "stuck"
  ) {
    events.push("session.stuck");
  }

  // Session needs input: transition to needs_input status or waiting_input activity
  const isNowWaiting =
    currentSession.status === "needs_input" ||
    currentSession.activity === "waiting_input" ||
    currentSession.activity === "blocked";
  const wasWaiting =
    previousSession?.status === "needs_input" ||
    previousSession?.activity === "waiting_input" ||
    previousSession?.activity === "blocked";

  if (isNowWaiting && !wasWaiting) {
    events.push("session.needs_input");
  }

  // Merge ready: transition to mergeable state
  const isNowMergeable = currPr && isPRMergeReady(currPr);
  const wasMergeable = prevPr && isPRMergeReady(prevPr);

  if (isNowMergeable && !wasMergeable) {
    events.push("merge.ready");
  }

  return events;
}

/**
 * Serialize a session for voice context (minimal data for Gemini)
 */
export function serializeSessionForVoice(session: DashboardSession): {
  id: string;
  status: string;
  activity: string | null;
  attentionLevel: AttentionLevel;
  summary: string | null;
  issueLabel: string | null;
  prUrl: string | null;
  ciStatus: CIStatus | null;
  reviewDecision: ReviewDecision | null;
} {
  return {
    id: session.id,
    status: session.status,
    activity: session.activity,
    attentionLevel: getAttentionLevel(session),
    summary: session.summary,
    issueLabel: session.issueLabel,
    prUrl: session.pr?.url ?? null,
    ciStatus: session.pr?.ciStatus ?? null,
    reviewDecision: session.pr?.reviewDecision ?? null,
  };
}
