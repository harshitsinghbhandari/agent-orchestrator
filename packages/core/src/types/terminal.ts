// =============================================================================
// TERMINAL — Plugin Slot 7
// =============================================================================

import type { Session } from "./session.js";

/**
 * Terminal manages how humans view/interact with running sessions.
 * Opens IDE tabs, browser windows, or terminal sessions.
 */
export interface Terminal {
  readonly name: string;

  /** Open a session for human interaction */
  openSession(session: Session): Promise<void>;

  /** Open all sessions for a project */
  openAll(sessions: Session[]): Promise<void>;

  /** Check if a session is already open in a tab/window */
  isSessionOpen?(session: Session): Promise<boolean>;
}
