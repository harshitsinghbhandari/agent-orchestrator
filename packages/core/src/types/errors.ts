// =============================================================================
// ERROR DETECTION HELPERS
// =============================================================================

/**
 * Detect if an error indicates that an issue was not found in the tracker.
 * Used by spawn validation to distinguish "not found" from other errors (auth, network, etc).
 *
 * Uses specific patterns to avoid matching infrastructure errors like "API key not found",
 * "Team not found", "Configuration not found", etc.
 */
export function isIssueNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = (err as Error).message?.toLowerCase() || "";

  // Match issue-specific not-found patterns
  return (
    (message.includes("issue") &&
      (message.includes("not found") || message.includes("does not exist"))) ||
    message.includes("no issue found") ||
    message.includes("could not find issue") ||
    // GitHub: "no issue found" or "could not resolve to an Issue"
    message.includes("could not resolve to an issue") ||
    // Linear: "Issue <id> not found" or "No issue with identifier"
    message.includes("no issue with identifier") ||
    // GitHub: "invalid issue format" (ad-hoc free-text strings)
    message.includes("invalid issue format")
  );
}

/** Thrown when a session cannot be restored (e.g. merged, still working). */
export class SessionNotRestorableError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly reason: string,
  ) {
    super(`Session ${sessionId} cannot be restored: ${reason}`);
    this.name = "SessionNotRestorableError";
  }
}

/** Thrown when a workspace is missing and cannot be recreated. */
export class WorkspaceMissingError extends Error {
  constructor(
    public readonly path: string,
    public readonly detail?: string,
  ) {
    super(`Workspace missing at ${path}${detail ? `: ${detail}` : ""}`);
    this.name = "WorkspaceMissingError";
  }
}

/** Thrown when a session lookup fails (session does not exist). */
export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

/** Thrown when no agent-orchestrator.yaml config file can be found. */
export class ConfigNotFoundError extends Error {
  constructor(message?: string) {
    super(message ?? "No agent-orchestrator.yaml found. Run `ao start` to create one.");
    this.name = "ConfigNotFoundError";
  }
}

export type ProjectResolveErrorKind = "malformed" | "invalid" | "old-format";

/** Thrown when a project cannot be resolved into an effective runtime config. */
export class ProjectResolveError extends Error {
  constructor(
    public readonly projectId: string,
    message: string,
    public readonly reasonKind?: ProjectResolveErrorKind,
  ) {
    super(message);
    this.name = "ProjectResolveError";
  }
}
