import type { SessionId } from "./types.js";

export class SessionError extends Error {
  constructor(
    message: string,
    public readonly sessionId: SessionId,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "SessionError";
  }
}

export class RecoveryError extends SessionError {
  constructor(
    message: string,
    sessionId: SessionId,
    cause?: Error,
  ) {
    super(message, sessionId, cause);
    this.name = "RecoveryError";
  }
}

export class MetadataError extends SessionError {
  constructor(
    message: string,
    sessionId: SessionId,
    cause?: Error,
  ) {
    super(message, sessionId, cause);
    this.name = "MetadataError";
  }
}

export type ErrorStrategy = "log-and-continue" | "preserve-state" | "escalate";

export interface ErrorContext {
  sessionId: SessionId;
  projectId?: string;
  operation: string;
}

export function handleError(error: unknown, context: ErrorContext, strategy: ErrorStrategy): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorObj = error instanceof Error ? error : new Error(String(error));

  if (strategy === "log-and-continue" || strategy === "preserve-state") {
    console.warn(`[${context.operation}] Handled error for session ${context.sessionId}: ${errorMessage}`);
    // If we had a robust structured logger injected here, we would use it.
    // We emit structured logs where necessary manually or via observability observer.
  } else if (strategy === "escalate") {
    console.error(`[${context.operation}] Escalating error for session ${context.sessionId}: ${errorMessage}`);
    throw new SessionError(`Escalated error in ${context.operation}: ${errorMessage}`, context.sessionId, errorObj);
  }
}
