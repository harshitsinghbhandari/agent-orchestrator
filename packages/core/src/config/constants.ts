export const TMUX_DELAYS = {
  ESCAPE_CLEAR_MS: 100,
  PASTE_SETTLE_MS: 1000,
} as const;

export const OBSERVABILITY_LIMITS = {
  TRACES: 80,
  SESSIONS: 200,
} as const;

export const LIFECYCLE_DEFAULTS = {
  POLL_INTERVAL_MS: 30_000,
} as const;
