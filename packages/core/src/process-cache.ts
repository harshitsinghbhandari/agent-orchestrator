/**
 * Process-scoped async memoization for expensive checks shared across plugins.
 *
 * Use cases: prerequisite checks (binary present, auth valid) that multiple
 * plugins want to perform but only need to actually run once per CLI
 * invocation. Cache key chooses the dedup boundary — plugins that share a
 * key share the result.
 *
 * Both successes and failures are cached: if a check fails the user must fix
 * the underlying issue and re-run, so re-checking within the same process is
 * pointless and would muddy the error stream with duplicate messages.
 */

const cache = new Map<string, Promise<unknown>>();

export function memoizeAsync<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let cached = cache.get(key);
  if (!cached) {
    cached = fn();
    cache.set(key, cached);
  }
  return cached as Promise<T>;
}

/** Test-only — clears the process cache. */
export function _clearProcessCacheForTests(): void {
  cache.clear();
}
