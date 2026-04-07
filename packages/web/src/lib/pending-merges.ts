/**
 * Pending merge store for voice-initiated merges (V4).
 *
 * Provides a safety layer between voice commands and actual PR merges.
 * When a user says "merge ao-25", this creates a pending merge request
 * that must be confirmed in the dashboard within 5 minutes.
 */

/** Time-to-live for pending merge requests (5 minutes) */
export const PENDING_MERGE_TTL_MS = 5 * 60 * 1000;

/**
 * A pending merge request awaiting dashboard confirmation
 */
export interface PendingMerge {
  /** Unique identifier for this pending merge */
  id: string;
  /** Session ID (e.g., "ao-25") */
  sessionId: string;
  /** PR number to merge */
  prNumber: number;
  /** Timestamp when the merge was requested */
  requestedAt: number;
  /** Timestamp when the pending merge expires */
  expiresAt: number;
}

/** In-memory store of pending merges */
const pendingMerges = new Map<string, PendingMerge>();

/**
 * Generate a unique pending merge ID
 */
function generateId(): string {
  return `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a pending merge request
 *
 * @param sessionId The session ID (e.g., "ao-25")
 * @param prNumber The PR number to merge
 * @returns The created pending merge
 */
export function requestMerge(sessionId: string, prNumber: number): PendingMerge {
  const id = generateId();
  const now = Date.now();
  const merge: PendingMerge = {
    id,
    sessionId,
    prNumber,
    requestedAt: now,
    expiresAt: now + PENDING_MERGE_TTL_MS,
  };
  pendingMerges.set(id, merge);
  return merge;
}

/**
 * Confirm a pending merge request
 *
 * Returns the pending merge if it exists and hasn't expired.
 * Removes the pending merge from the store.
 *
 * @param id The pending merge ID
 * @returns The pending merge, or null if not found/expired
 */
export function confirmMerge(id: string): PendingMerge | null {
  const merge = pendingMerges.get(id);
  if (!merge) return null;

  // Check if expired
  if (Date.now() > merge.expiresAt) {
    pendingMerges.delete(id);
    return null;
  }

  // Remove from store and return
  pendingMerges.delete(id);
  return merge;
}

/**
 * Cancel a pending merge request
 *
 * @param id The pending merge ID
 * @returns true if the merge was found and cancelled, false otherwise
 */
export function cancelMerge(id: string): boolean {
  return pendingMerges.delete(id);
}

/**
 * Get all pending merges (excluding expired ones)
 *
 * @returns Array of pending merges
 */
export function getPendingMerges(): PendingMerge[] {
  cleanupExpired();
  return Array.from(pendingMerges.values());
}

/**
 * Get a pending merge by ID (without consuming it)
 *
 * @param id The pending merge ID
 * @returns The pending merge, or null if not found/expired
 */
export function getPendingMerge(id: string): PendingMerge | null {
  const merge = pendingMerges.get(id);
  if (!merge) return null;

  if (Date.now() > merge.expiresAt) {
    pendingMerges.delete(id);
    return null;
  }

  return merge;
}

/**
 * Get all pending merges for a specific session
 *
 * @param sessionId The session ID
 * @returns Array of pending merges for the session
 */
export function getPendingMergesForSession(sessionId: string): PendingMerge[] {
  cleanupExpired();
  return Array.from(pendingMerges.values()).filter(
    (merge) => merge.sessionId === sessionId,
  );
}

/**
 * Clean up expired pending merges
 */
export function cleanupExpired(): void {
  const now = Date.now();
  const entries = Array.from(pendingMerges.entries());
  for (const [id, merge] of entries) {
    if (now > merge.expiresAt) {
      pendingMerges.delete(id);
    }
  }
}

/**
 * Clear all pending merges (for testing)
 */
export function clearAllPendingMerges(): void {
  pendingMerges.clear();
}

/**
 * Get the number of pending merges (for debugging)
 */
export function getPendingMergeCount(): number {
  cleanupExpired();
  return pendingMerges.size;
}
