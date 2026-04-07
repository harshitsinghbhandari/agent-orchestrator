/**
 * Dedupe + debounce layer for voice events.
 *
 * Prevents duplicate announcements when the SSE feed (5s polling) sends
 * the same event multiple times. Each event is keyed by sessionId + eventType,
 * and the same combination won't be spoken again within the dedupe window.
 */

/** Dedupe window in milliseconds (30 seconds as specified in plan) */
export const DEDUPE_WINDOW_MS = 30_000;

/** Map of event keys to their last-seen timestamps */
const recentEvents = new Map<string, number>();

/** Event types that should be auto-spoken */
export const SPEAKABLE_EVENTS = [
  "ci.failing",
  "review.changes_requested",
  "session.stuck",
  "session.needs_input",
  "merge.ready",
] as const;

export type SpeakableEventType = (typeof SPEAKABLE_EVENTS)[number];

/**
 * Check if an event type is speakable
 */
export function isSpeakableEvent(eventType: string): eventType is SpeakableEventType {
  return SPEAKABLE_EVENTS.includes(eventType as SpeakableEventType);
}

/**
 * Generate a dedupe key for an event
 */
export function getDedupeKey(sessionId: string, eventType: string): string {
  return `${sessionId}:${eventType}`;
}

/**
 * Check if an event should be spoken (not deduped)
 *
 * @returns true if the event should be spoken, false if it's a duplicate
 */
export function shouldSpeak(sessionId: string, eventType: string): boolean {
  // Only speak speakable event types
  if (!isSpeakableEvent(eventType)) {
    return false;
  }

  const now = Date.now();
  const key = getDedupeKey(sessionId, eventType);
  const lastSeen = recentEvents.get(key);

  // If we've seen this event recently, don't speak it again
  if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) {
    return false;
  }

  // Record this event
  recentEvents.set(key, now);

  return true;
}

/**
 * Mark an event as recently seen (for external callers)
 */
export function markEventSeen(sessionId: string, eventType: string): void {
  const key = getDedupeKey(sessionId, eventType);
  recentEvents.set(key, Date.now());
}

/**
 * Clear stale entries from the dedupe cache (older than dedupe window)
 * Should be called periodically to prevent memory leaks
 */
export function cleanupDedupeCache(): void {
  const now = Date.now();
  for (const [key, timestamp] of recentEvents.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentEvents.delete(key);
    }
  }
}

/**
 * Clear all entries from the dedupe cache (for testing or reset)
 */
export function clearDedupeCache(): void {
  recentEvents.clear();
}

/**
 * Get the current size of the dedupe cache (for debugging)
 */
export function getDedupeCacheSize(): number {
  return recentEvents.size;
}
