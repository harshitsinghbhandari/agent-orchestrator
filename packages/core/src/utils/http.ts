/**
 * Validate that a URL starts with http:// or https://.
 * Throws with a descriptive error including the plugin label if invalid.
 */
export function validateUrl(url: string, label: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error();
    }
  } catch {
    throw new Error(`[${label}] Invalid url: must be http(s), got "${url}"`);
  }
}

/**
 * Returns true if an HTTP status code should be retried.
 * Retry only 429 (rate-limit) and 5xx (server) failures.
 */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Normalize retry config from plugin config with sane defaults.
 */
export function normalizeRetryConfig(
  config: Record<string, unknown> | undefined,
  defaults: { retries: number; retryDelayMs: number } = { retries: 2, retryDelayMs: 1000 },
): { retries: number; retryDelayMs: number } {
  const rawRetries = config?.retries as number | undefined;
  const rawDelay = config?.retryDelayMs as number | undefined;
  const retries = Number.isFinite(rawRetries) ? Math.max(0, rawRetries ?? 0) : defaults.retries;
  const retryDelayMs = Number.isFinite(rawDelay) && (rawDelay ?? -1) >= 0
    ? (rawDelay as number)
    : defaults.retryDelayMs;
  return { retries, retryDelayMs };
}
