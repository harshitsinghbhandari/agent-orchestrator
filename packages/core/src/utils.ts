/**
 * Shared utility functions for agent-orchestrator plugins.
 *
 * @deprecated Use specific modules under utils/ instead.
 */

export { shellEscape, escapeAppleScript } from "./utils/shell.js";
export { validateUrl, isRetryableHttpStatus, normalizeRetryConfig } from "./utils/http.js";
export { resolveProjectIdForSessionId } from "./utils/config.js";
export { readLastJsonlEntry } from "./utils/file.js";
