import {
  DEFAULT_READY_THRESHOLD_MS,
  DEFAULT_ACTIVE_WINDOW_MS,
  shellEscape,
  readLastJsonlEntry,
  checkActivityLogState,
  getActivityFallbackState,
  isWindows,
  PROCESS_PROBE_INDETERMINATE,
  type ActivityDetection,
  type ActivityState,
  type ProcessProbeResult,
  type RuntimeHandle,
  type Session,
} from "@aoagents/ao-core";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import {
  readdir,
  stat,
  lstat,
  open,
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CODEX_HOOK_ACTIVITY_UPDATER_FILENAME = "ao-codex-activity-updater.cjs";
const CODEX_HOOK_ACTIVITY_TIMEOUT_SECONDS = 5;
const ACTIVITY_LOG_TAIL_BYTES = 64 * 1024;

const CODEX_ACTIVITY_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "Stop",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
] as const;

type CodexActivityHookEvent = (typeof CODEX_ACTIVITY_HOOK_EVENTS)[number];

const CODEX_HOOK_EVENT_KEYS: Record<CodexActivityHookEvent, string> = {
  SessionStart: "session_start",
  UserPromptSubmit: "user_prompt_submit",
  PreToolUse: "pre_tool_use",
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  Stop: "stop",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  SubagentStart: "subagent_start",
};

function readCodexHookActivityUpdaterScript(): string {
  return readFileSync(new URL("./ao-codex-activity-updater.cjs", import.meta.url), "utf-8");
}

interface AoCodexHookTrustEntry {
  key: string;
  trustedHash: string;
}

function getCodexActivityUpdaterCommand(): string {
  return `node ${shellEscape(join(".codex", CODEX_HOOK_ACTIVITY_UPDATER_FILENAME))}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAoCodexActivityUpdater(hook: unknown): hook is Record<string, unknown> {
  return (
    isRecord(hook) &&
    typeof hook["command"] === "string" &&
    hook["command"].includes(CODEX_HOOK_ACTIVITY_UPDATER_FILENAME)
  );
}

function createAoCodexActivityUpdater(): Record<string, unknown> {
  return {
    type: "command",
    command: getCodexActivityUpdaterCommand(),
    timeout: CODEX_HOOK_ACTIVITY_TIMEOUT_SECONDS,
  };
}

function ensureCodexActivityHookGroup(
  hooks: Record<string, unknown>,
  eventName: CodexActivityHookEvent,
): void {
  const existingGroups = hooks[eventName];
  const groups = Array.isArray(existingGroups) ? existingGroups : [];
  const normalizedGroups = groups
    .map((group): unknown => {
      if (!isRecord(group) || !Array.isArray(group["hooks"])) return group;
      const normalizedHookEntries = group["hooks"].filter(
        (hook) => !isAoCodexActivityUpdater(hook),
      );
      if (normalizedHookEntries.length === 0) return null;
      return { ...group, hooks: normalizedHookEntries };
    })
    .filter((group): group is unknown => group !== null);

  normalizedGroups.push({ hooks: [createAoCodexActivityUpdater()] });
  hooks[eventName] = normalizedGroups;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

function calculateCodexHookTrustedHash(
  eventName: CodexActivityHookEvent,
  group: Record<string, unknown>,
  hook: Record<string, unknown>,
): string {
  const matcher = typeof group["matcher"] === "string" ? group["matcher"] : undefined;
  const command = typeof hook["command"] === "string" ? hook["command"] : "";
  const timeout =
    typeof hook["timeout"] === "number" ? hook["timeout"] : CODEX_HOOK_ACTIVITY_TIMEOUT_SECONDS;
  const identity = {
    event_name: CODEX_HOOK_EVENT_KEYS[eventName],
    matcher,
    hooks: [{ type: "command", command, timeout, async: hook["async"] === true }],
  };
  return `sha256:${createHash("sha256").update(canonicalJson(identity)).digest("hex")}`;
}

function collectAoCodexHookTrustEntries(
  hooksPath: string,
  hooks: Record<string, unknown>,
): AoCodexHookTrustEntry[] {
  const entries: AoCodexHookTrustEntry[] = [];
  for (const eventName of CODEX_ACTIVITY_HOOK_EVENTS) {
    const eventGroups = hooks[eventName];
    if (!Array.isArray(eventGroups)) continue;
    eventGroups.forEach((group, groupIndex) => {
      if (!isRecord(group) || !Array.isArray(group["hooks"])) return;
      group["hooks"].forEach((hook, hookIndex) => {
        if (!isAoCodexActivityUpdater(hook)) return;
        entries.push({
          key: `${hooksPath}:${CODEX_HOOK_EVENT_KEYS[eventName]}:${groupIndex}:${hookIndex}`,
          trustedHash: calculateCodexHookTrustedHash(eventName, group, hook),
        });
      });
    });
  }
  return entries;
}

function escapeTomlBasicString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .split(String.fromCharCode(8))
    .join("\\b")
    .split(String.fromCharCode(9))
    .join("\\t")
    .split(String.fromCharCode(10))
    .join("\\n")
    .split(String.fromCharCode(12))
    .join("\\f")
    .split(String.fromCharCode(13))
    .join("\\r");
}

// Codex config.toml is small and currently written by Codex as simple section
// tables. Keep this deliberately narrow: upsert only AO-owned exact section
// headers/keys and preserve the rest of the user's file byte-for-byte.
function upsertTomlSectionLine(toml: string, header: string, line: string): string {
  let lines = toml.length > 0 ? toml.split(/\r?\n/) : [];
  if (lines.length > 0 && lines[lines.length - 1] === "") lines = lines.slice(0, -1);
  const existingStart = lines.findIndex((existingLine) => existingLine.trim() === header);
  if (existingStart === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push(header, line);
    return `${lines.join("\n")}\n`;
  }
  let existingEnd = lines.length;
  for (let index = existingStart + 1; index < lines.length; index += 1) {
    if (lines[index]?.trim().startsWith("[")) {
      existingEnd = index;
      break;
    }
  }
  const key = line.split("=")[0]?.trim() ?? "";
  const lineIndex = lines
    .slice(existingStart + 1, existingEnd)
    .findIndex((existingLine) => existingLine.trim().startsWith(key));
  if (lineIndex === -1) lines.splice(existingStart + 1, 0, line);
  else lines[existingStart + 1 + lineIndex] = line;
  return `${lines.join("\n")}\n`;
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = join(
    dirname(filePath),
    `.${basename(filePath)}.tmp.${process.pid}.${Date.now()}`,
  );
  try {
    await writeFile(tempPath, content, "utf-8");
    await rename(tempPath, filePath);
  } catch (err: unknown) {
    try {
      await rm(tempPath, { force: true });
    } catch {
      // Best-effort cleanup; preserve the original write/rename error.
    }
    throw err;
  }
}

async function readGitOutput(workspacePath: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: workspacePath, timeout: 10_000 });
    const output = stdout.trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

async function resolveCodexHooksConfigDir(workspacePath: string): Promise<string> {
  const workspaceCodexDir = join(workspacePath, ".codex");
  const checkoutRootOutput = await readGitOutput(workspacePath, ["rev-parse", "--show-toplevel"]);
  const commonDirOutput = await readGitOutput(workspacePath, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (!checkoutRootOutput || !commonDirOutput) return workspaceCodexDir;

  const checkoutRoot = resolve(checkoutRootOutput);
  const commonDir = resolve(commonDirOutput);
  if (basename(commonDir) !== ".git") return workspaceCodexDir;

  const repoRoot = dirname(commonDir);
  if (repoRoot === checkoutRoot) return workspaceCodexDir;

  const relativeWorkspacePath = relative(checkoutRoot, resolve(workspacePath));
  if (
    relativeWorkspacePath === ".." ||
    relativeWorkspacePath.startsWith(`..${sep}`) ||
    isAbsolute(relativeWorkspacePath)
  ) {
    return workspaceCodexDir;
  }
  return join(repoRoot, relativeWorkspacePath, ".codex");
}

export async function setupCodexHookActivityUpdater(workspacePath: string): Promise<void> {
  const workspaceCodexDir = join(workspacePath, ".codex");
  const hooksConfigDir = await resolveCodexHooksConfigDir(workspacePath);
  const hooksPath = join(hooksConfigDir, "hooks.json");
  await mkdir(workspaceCodexDir, { recursive: true });
  await writeFileAtomic(
    join(workspaceCodexDir, CODEX_HOOK_ACTIVITY_UPDATER_FILENAME),
    readCodexHookActivityUpdaterScript(),
  );
  if (hooksConfigDir !== workspaceCodexDir) {
    await mkdir(hooksConfigDir, { recursive: true });
    await writeFileAtomic(
      join(hooksConfigDir, CODEX_HOOK_ACTIVITY_UPDATER_FILENAME),
      readCodexHookActivityUpdaterScript(),
    );
  }

  let config: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(hooksPath, "utf-8"));
    if (isRecord(parsed)) config = parsed;
  } catch {
    // Missing or malformed hooks.json is treated as an empty config.
  }
  const hooksValue = config["hooks"];
  const hooks: Record<string, unknown> = isRecord(hooksValue) ? hooksValue : {};
  for (const eventName of CODEX_ACTIVITY_HOOK_EVENTS)
    ensureCodexActivityHookGroup(hooks, eventName);
  config["hooks"] = hooks;
  await writeFileAtomic(hooksPath, JSON.stringify(config, null, 2) + "\n");

  const codexConfigDir = join(homedir(), ".codex");
  const codexConfigPath = join(codexConfigDir, "config.toml");
  await mkdir(codexConfigDir, { recursive: true });
  let toml = await readFile(codexConfigPath, "utf-8").catch(() => "");
  toml = upsertTomlSectionLine(
    toml,
    `[projects."${escapeTomlBasicString(workspacePath)}"]`,
    'trust_level = "trusted"',
  );
  for (const entry of collectAoCodexHookTrustEntries(hooksPath, hooks)) {
    toml = upsertTomlSectionLine(
      toml,
      `[hooks.state."${escapeTomlBasicString(entry.key)}"]`,
      `trusted_hash = "${entry.trustedHash}"`,
    );
  }
  await writeFileAtomic(codexConfigPath, toml);
}

export function isActionableActivity(state: ActivityState): boolean {
  return state === "waiting_input" || state === "blocked";
}

export function mapCodexJsonlEntryToActivity(
  entry: { lastType: string | null; payloadType: string | null; modifiedAt: Date },
  thresholdMs: number,
): ActivityDetection {
  const timestamp = entry.modifiedAt;
  const ageMs = Math.max(0, Date.now() - timestamp.getTime());
  const activeWindowMs = Math.min(DEFAULT_ACTIVE_WINDOW_MS, thresholdMs);
  const effectiveType = entry.payloadType ?? entry.lastType;
  switch (effectiveType) {
    case "approval_request":
    case "exec_approval_request":
    case "apply_patch_approval_request":
      return { state: "waiting_input", timestamp };
    case "error":
    case "stream_error":
      return { state: "blocked", timestamp };
    case "task_started":
    case "agent_reasoning":
    case "response_item":
    case "turn_context":
    case "user_input":
    case "tool_call":
    case "exec_command":
    case "exec_command_begin":
    case "exec_command_end":
      if (ageMs <= activeWindowMs) return { state: "active", timestamp };
      return { state: ageMs > thresholdMs ? "idle" : "ready", timestamp };
    case "task_complete":
    case "turn_aborted":
    case "agent_message":
    case "assistant_message":
    case "session_meta":
    case "event_msg":
    case "compacted":
    case "token_count":
      return { state: ageMs > thresholdMs ? "idle" : "ready", timestamp };
    default:
      if (ageMs <= activeWindowMs) return { state: "active", timestamp };
      return { state: ageMs > thresholdMs ? "idle" : "ready", timestamp };
  }
}

interface CodexActivityEntry {
  ts: string;
  state: ActivityState;
  source: "terminal" | "native" | "hook";
  sessionId?: string;
}

interface CodexActivityResult {
  entry: CodexActivityEntry;
  modifiedAt: Date;
}

interface CodexActivityResults {
  latest: CodexActivityResult | null;
  latestHook: CodexActivityResult | null;
}

const VALID_ACTIVITY_STATES = new Set<string>([
  "active",
  "ready",
  "idle",
  "waiting_input",
  "blocked",
  "exited",
]);
const VALID_ACTIVITY_SOURCES = new Set<string>(["terminal", "native", "hook"]);

function parseCodexActivityLine(line: string): CodexActivityEntry | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) return null;
    if (
      typeof parsed["ts"] !== "string" ||
      typeof parsed["state"] !== "string" ||
      typeof parsed["source"] !== "string" ||
      !VALID_ACTIVITY_STATES.has(parsed["state"]) ||
      !VALID_ACTIVITY_SOURCES.has(parsed["source"])
    ) {
      return null;
    }
    return {
      ts: parsed["ts"],
      state: parsed["state"] as ActivityState,
      source: parsed["source"] as "terminal" | "native" | "hook",
      ...(typeof parsed["sessionId"] === "string" ? { sessionId: parsed["sessionId"] } : {}),
    };
  } catch {
    return null;
  }
}

async function readCodexActivityResults(session: Session): Promise<CodexActivityResults> {
  const empty: CodexActivityResults = { latest: null, latestHook: null };
  if (!session.workspacePath) return empty;
  try {
    const handle = await open(join(session.workspacePath, ".ao", "activity.jsonl"), "r");
    try {
      const fileStat = await handle.stat();
      const tailSize = Math.min(fileStat.size, ACTIVITY_LOG_TAIL_BYTES);
      const offset = Math.max(0, fileStat.size - tailSize);
      const buffer = Buffer.alloc(tailSize);
      const { bytesRead } = await handle.read(buffer, 0, tailSize, offset);
      if (bytesRead === 0) return empty;
      let lines = buffer.subarray(0, bytesRead).toString("utf-8").split(/\r?\n/).filter(Boolean);
      if (offset > 0 && lines.length > 1) lines = lines.slice(1);
      const results: CodexActivityResults = { latest: null, latestHook: null };
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (line === undefined) continue;
        const entry = parseCodexActivityLine(line);
        if (!entry) continue;
        if (entry.source === "hook") {
          const ts = new Date(entry.ts);
          const belongsToSession =
            !Number.isNaN(ts.getTime()) &&
            ts.getTime() >= session.createdAt.getTime() &&
            entry.sessionId === session.id;
          if (!belongsToSession) continue;
          const result = { entry, modifiedAt: ts };
          results.latestHook ??= result;
          results.latest ??= result;
        } else {
          results.latest ??= { entry, modifiedAt: fileStat.mtime };
        }
        if (results.latest && results.latestHook) return results;
      }
      return results;
    } finally {
      await handle.close();
    }
  } catch {
    return empty;
  }
}

export function pickNewestActivityDetection(
  detections: Array<ActivityDetection | null>,
): ActivityDetection | null {
  return detections.reduce<ActivityDetection | null>((newest, detection) => {
    if (!detection) return newest;
    if (!newest) return detection;
    const detectionTime = detection.timestamp?.getTime() ?? 0;
    const newestTime = newest.timestamp?.getTime() ?? 0;
    return detectionTime >= newestTime ? detection : newest;
  }, null);
}

// =============================================================================
// Codex Session JSONL Parsing (for getSessionInfo)
// =============================================================================

/** Codex session directory: ~/.codex/sessions/ */
const CODEX_SESSIONS_DIR = join(homedir(), ".codex", "sessions");
const SESSION_MATCH_SCAN_CHUNK_BYTES = 8192;
const SESSION_MATCH_SCAN_LINE_LIMIT = 10;

interface CodexTokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  cached_tokens?: number;
  reasoning_output_tokens?: number;
  reasoning_tokens?: number;
}

interface CodexJsonlPayload extends CodexTokenUsage {
  id?: string;
  cwd?: string;
  model_provider?: string;
  model?: string;
  turn_id?: string;
  threadId?: string;
  content?: string;
  role?: string;
  type?: string;
  info?: {
    total_token_usage?: CodexTokenUsage;
    last_token_usage?: CodexTokenUsage;
  };
}

/**
 * Recent Codex versions wrap event fields in `payload`, while older fixtures
 * used a flat shape. Accept both so session discovery works against real
 * Codex JSONL and existing tests remain valid.
 */
interface CodexJsonlLine extends CodexJsonlPayload {
  type?: string;
  payload?: CodexJsonlPayload;
  msg?: CodexTokenUsage & { type?: string };
}

function getCodexPayload(entry: CodexJsonlLine): CodexJsonlPayload {
  return entry.payload ?? entry;
}

/**
 * Collect all JSONL files under a directory, recursively.
 * Codex stores sessions in date-sharded directories:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *
 * Uses lstat (not stat) so symlinks to directories are never followed,
 * preventing infinite loops from symlink cycles. Max depth is capped at 4
 * (YYYY/MM/DD + 1 buffer) as an additional safety guard.
 */
const MAX_SESSION_SCAN_DEPTH = 4;

async function collectJsonlFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_SESSION_SCAN_DEPTH) return [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (entry.endsWith(".jsonl")) {
      results.push(fullPath);
    } else {
      // Recurse into subdirectories (YYYY/MM/DD structure).
      // Use lstat to avoid following symlinks that could create cycles.
      try {
        const s = await lstat(fullPath);
        if (s.isDirectory()) {
          const nested = await collectJsonlFiles(fullPath, depth + 1);
          results.push(...nested);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }
  return results;
}

async function readJsonlPrefixLines(filePath: string, maxLines: number): Promise<string[]> {
  const handle = await open(filePath, "r");
  const lines: string[] = [];
  let partialLine = "";
  // Reuse a single decoder across reads so multi-byte UTF-8 sequences that
  // straddle a chunk boundary (e.g. CJK characters in base_instructions) get
  // buffered correctly instead of producing U+FFFD replacement characters.
  const decoder = new StringDecoder("utf8");

  try {
    while (lines.length < maxLines) {
      const buffer = Buffer.allocUnsafe(SESSION_MATCH_SCAN_CHUNK_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);

      if (bytesRead === 0) {
        partialLine += decoder.end();
        const finalLine = partialLine.trim();
        if (finalLine) lines.push(finalLine);
        break;
      }

      partialLine += decoder.write(buffer.subarray(0, bytesRead));

      let newlineIndex = partialLine.indexOf("\n");
      while (newlineIndex !== -1 && lines.length < maxLines) {
        const line = partialLine.slice(0, newlineIndex).trim();
        if (line) lines.push(line);
        partialLine = partialLine.slice(newlineIndex + 1);
        newlineIndex = partialLine.indexOf("\n");
      }
    }
  } finally {
    await handle.close();
  }

  return lines;
}

/**
 * Normalize a path for cross-platform comparison. Codex's JSONL may emit
 * forward-slash paths or vary drive-letter case on Windows; AO constructs
 * workspace paths via path.join which yields backslashes on Windows. Compare
 * via a canonical form: forward slashes throughout, lowercased drive letter.
 */
function toComparablePath(p: string): string {
  const slash = p.replace(/\\/g, "/");
  return slash.replace(/^([a-zA-Z]):/, (_, d: string) => d.toLowerCase() + ":");
}

/**
 * Check if the first few complete JSONL records of a session file contain a
 * session_meta entry matching the given workspace path. This avoids parsing a
 * truncated session_meta line when Codex embeds large base_instructions.
 */
async function sessionFileMatchesCwd(filePath: string, workspacePath: string): Promise<boolean> {
  const wantedCwd = toComparablePath(workspacePath);
  try {
    const lines = await readJsonlPrefixLines(filePath, SESSION_MATCH_SCAN_LINE_LIMIT);
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          const entry = parsed as CodexJsonlLine;
          const payload = getCodexPayload(entry);
          if (
            entry.type === "session_meta" &&
            typeof payload.cwd === "string" &&
            toComparablePath(payload.cwd) === wantedCwd
          ) {
            return true;
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Unreadable file
  }
  return false;
}

/**
 * Find Codex session files whose `session_meta` cwd matches the given workspace path.
 * Recursively scans ~/.codex/sessions/ (date-sharded: YYYY/MM/DD/rollout-*.jsonl).
 * Returns the path to the most recently modified matching file, or null.
 */
async function findCodexSessionFile(
  workspacePath: string,
  jsonlFiles?: string[],
): Promise<string | null> {
  jsonlFiles ??= await collectJsonlFiles(CODEX_SESSIONS_DIR);
  if (jsonlFiles.length === 0) return null;

  let bestMatch: { path: string; mtime: number } | null = null;

  for (const filePath of jsonlFiles) {
    const matches = await sessionFileMatchesCwd(filePath, workspacePath);
    if (matches) {
      try {
        const s = await stat(filePath);
        if (!bestMatch || s.mtimeMs > bestMatch.mtime) {
          bestMatch = { path: filePath, mtime: s.mtimeMs };
        }
      } catch {
        // Skip if stat fails
      }
    }
  }

  return bestMatch?.path ?? null;
}

/**
 * Find a Codex session file by persisted native thread id. Codex rollout
 * filenames include the thread id, so this path only inspects filenames and
 * avoids opening historical JSONL files to match session_meta.cwd.
 */
async function findCodexSessionFileByThreadId(
  threadId: string,
  jsonlFiles?: string[],
): Promise<string | null> {
  jsonlFiles ??= await collectJsonlFiles(CODEX_SESSIONS_DIR);
  const matches = jsonlFiles.filter((filePath) =>
    basename(filePath).endsWith(`-${threadId}.jsonl`),
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0] ?? null;

  let bestMatch: { path: string; mtime: number } | null = null;
  let fallback: string | null = null;
  for (const filePath of matches) {
    fallback ??= filePath;
    try {
      const s = await stat(filePath);
      if (!bestMatch || s.mtimeMs > bestMatch.mtime) {
        bestMatch = { path: filePath, mtime: s.mtimeMs };
      }
    } catch {
      // Keep a filename match as fallback; thread id in the filename is enough.
    }
  }

  return bestMatch?.path ?? fallback;
}

/** TTL for session file path cache (ms). Prevents redundant filesystem scans
 *  when getActivityState and getSessionInfo are called in the same refresh cycle. */
const SESSION_FILE_CACHE_TTL_MS = 30_000;

/** Module-level session file cache shared across the agent instance lifetime.
 *  Keyed by Codex thread id when available, otherwise workspace path. */
const sessionFileCache = new Map<string, { path: string | null; expiry: number }>();

function getSessionMetadataString(session: Session, key: string): string | null {
  const value = session.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function getCachedSessionFile(
  cacheKey: string,
  resolveSessionFile: () => Promise<string | null>,
): Promise<string | null> {
  const cached = sessionFileCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.path;
  }
  const result = await resolveSessionFile();
  sessionFileCache.set(cacheKey, {
    path: result,
    expiry: Date.now() + SESSION_FILE_CACHE_TTL_MS,
  });
  return result;
}

/** Find session file with caching to avoid double scans per refresh cycle. */
export async function findCodexSessionFileCached(session: Session): Promise<string | null> {
  let jsonlFiles: string[] | null = null;
  const getJsonlFiles = async (): Promise<string[]> => {
    jsonlFiles ??= await collectJsonlFiles(CODEX_SESSIONS_DIR);
    return jsonlFiles;
  };

  const threadId = getSessionMetadataString(session, "codexThreadId");
  if (threadId) {
    const byThreadId = await getCachedSessionFile(`thread:${threadId}`, async () =>
      findCodexSessionFileByThreadId(threadId, await getJsonlFiles()),
    );
    if (byThreadId) return byThreadId;
  }

  const workspacePath = session.workspacePath;
  if (!workspacePath) return null;
  return getCachedSessionFile(`cwd:${toComparablePath(workspacePath)}`, async () =>
    findCodexSessionFile(workspacePath, await getJsonlFiles()),
  );
}

/** Reset the session file cache. Exported for testing only. */
export function resetSessionFileCache(): void {
  sessionFileCache.clear();
}

/** Aggregated data extracted from a Codex session file via streaming */
interface CodexSessionData {
  model: string | null;
  threadId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
}

/**
 * Stream a Codex JSONL session file line-by-line and aggregate the data
 * we need (model, threadId, token counts) without loading the entire file
 * into memory. This is critical because Codex rollout files can be 100 MB+.
 */
export async function streamCodexSessionData(filePath: string): Promise<CodexSessionData | null> {
  let stream: ReturnType<typeof createReadStream> | null = null;
  let rl: ReturnType<typeof createInterface> | null = null;

  try {
    const data: CodexSessionData = {
      model: null,
      threadId: null,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
    };
    stream = createReadStream(filePath, { encoding: "utf-8" });
    rl = createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
        const entry = parsed as CodexJsonlLine;

        const payload = getCodexPayload(entry);

        if (entry.type === "session_meta") {
          if (typeof payload.id === "string" && payload.id) {
            data.threadId = payload.id;
          } else if (typeof payload.threadId === "string" && payload.threadId) {
            data.threadId = payload.threadId;
          }
        }

        if (!data.threadId) {
          if (typeof payload.threadId === "string" && payload.threadId) {
            data.threadId = payload.threadId;
          } else if (typeof entry.threadId === "string" && entry.threadId) {
            data.threadId = entry.threadId;
          }
        }

        if (entry.type === "turn_context" && typeof payload.model === "string" && payload.model) {
          data.model = payload.model;
        } else if (!data.model && typeof payload.model === "string" && payload.model) {
          data.model = payload.model;
        }

        // Token sources are precedence-ordered: total → last → flat → legacy.
        // `continue` ensures only one source is counted per entry.
        // `total_token_usage` is a cumulative snapshot (last-write-wins, so `=`);
        // the rest are per-turn deltas (accumulate with `+=`). Do not "fix" this.
        const totalUsage = payload.info?.total_token_usage;
        if (typeof totalUsage?.input_tokens === "number") {
          data.inputTokens = totalUsage.input_tokens;
          data.outputTokens = totalUsage.output_tokens ?? 0;
          continue;
        }

        const lastUsage = payload.info?.last_token_usage;
        if (typeof lastUsage?.input_tokens === "number") {
          data.inputTokens += lastUsage.input_tokens;
          data.outputTokens += lastUsage.output_tokens ?? 0;
          continue;
        }

        if (typeof payload.input_tokens === "number") {
          data.inputTokens += payload.input_tokens;
          data.outputTokens += payload.output_tokens ?? 0;
          continue;
        }

        if (entry.type === "event_msg" && entry.msg?.type === "token_count") {
          data.inputTokens += entry.msg.input_tokens ?? 0;
          data.outputTokens += entry.msg.output_tokens ?? 0;
          data.cachedTokens += entry.msg.cached_tokens ?? 0;
          data.reasoningTokens += entry.msg.reasoning_tokens ?? 0;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return data;
  } catch {
    return null;
  } finally {
    rl?.close();
    stream?.destroy();
  }
}

// =============================================================================
// Process detection
// =============================================================================

export async function isCodexProcessAlive(handle: RuntimeHandle): Promise<ProcessProbeResult> {
  try {
    if (handle.runtimeName === "tmux" && handle.id) {
      // ps -eo is Unix-only; guard against stale tmux handles on Windows
      if (isWindows()) return false;
      const { stdout: ttyOut } = await execFileAsync(
        "tmux",
        ["list-panes", "-t", handle.id, "-F", "#{pane_tty}"],
        { timeout: 30_000 },
      );
      const ttys = ttyOut
        .trim()
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
      if (ttys.length === 0) return false;

      const { stdout: psOut } = await execFileAsync("ps", ["-eo", "pid,tty,args"], {
        timeout: 30_000,
      });
      if (!psOut) return PROCESS_PROBE_INDETERMINATE;
      const ttySet = new Set(ttys.map((t) => t.replace(/^\/dev\//, "")));
      const processRe = /(?:^|\/)codex(?:\s|$)/;
      for (const line of psOut.split("\n")) {
        const cols = line.trimStart().split(/\s+/);
        if (cols.length < 3 || !ttySet.has(cols[1] ?? "")) continue;
        const args = cols.slice(2).join(" ");
        if (processRe.test(args)) {
          return true;
        }
      }
      return false;
    }

    const rawPid = handle.data["pid"];
    const pid = typeof rawPid === "number" ? rawPid : Number(rawPid);
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err: unknown) {
        if (err instanceof Error && "code" in err && err.code === "EPERM") {
          return true;
        }
        return false;
      }
    }

    return false;
  } catch {
    return PROCESS_PROBE_INDETERMINATE;
  }
}

// =============================================================================
// Activity-state cascade
// =============================================================================

export async function getCodexActivityState(
  session: Session,
  readyThresholdMs?: number,
  isProcessAlive: (handle: RuntimeHandle) => Promise<ProcessProbeResult> = isCodexProcessAlive,
): Promise<ActivityDetection | null> {
  const threshold = readyThresholdMs ?? DEFAULT_READY_THRESHOLD_MS;

  // Check if process is running first
  const exitedAt = new Date();
  if (!session.runtimeHandle) return { state: "exited", timestamp: exitedAt };
  const running = await isProcessAlive(session.runtimeHandle);
  if (running === PROCESS_PROBE_INDETERMINATE) return null;
  if (!running) return { state: "exited", timestamp: exitedAt };

  if (!session.workspacePath && !getSessionMetadataString(session, "codexThreadId")) {
    return null;
  }

  // 1. Try Codex's native JSONL first — it has richer blocked/input detection
  //(approval_request, error, tool_call, etc.) that hook activity must not mask.
  const sessionFile = await findCodexSessionFileCached(session);
  let nativeDetection: ActivityDetection | null = null;
  if (sessionFile) {
    const entry = await readLastJsonlEntry(sessionFile);
    if (entry) {
      nativeDetection = mapCodexJsonlEntryToActivity(entry, threshold);
      if (isActionableActivity(nativeDetection.state)) return nativeDetection;
    }

    // Session file exists but no parseable entry — fall through to AO JSONL
    // checks below instead of returning early, so waiting_input/blocked
    // from terminal parsing can still be detected.
  }

  // 2. Fallback: check AO activity JSONL (terminal- or hook-derived) for
  //waiting_input/blocked that the native JSONL may not have captured.
  const activityResults = await readCodexActivityResults(session);
  for (const activityResult of [activityResults.latest, activityResults.latestHook]) {
    const activityState = checkActivityLogState(activityResult);
    if (!activityState) continue;
    const nativeTime = nativeDetection?.timestamp?.getTime() ?? 0;
    const activityTime = activityState.timestamp?.getTime() ?? 0;
    if (activityResult?.entry.source !== "hook" || activityTime >= nativeTime) {
      return activityState;
    }
  }

  // 3. Compare non-actionable native and AO activity fallback evidence by
  //timestamp so stale hook activity cannot override newer native work.
  const activeWindowMs = Math.min(DEFAULT_ACTIVE_WINDOW_MS, threshold);
  const fallback = getActivityFallbackState(activityResults.latest, activeWindowMs, threshold);
  const fileDetection = pickNewestActivityDetection([nativeDetection, fallback]);
  if (fileDetection) return fileDetection;

  // 4. Last resort: native session file exists but nothing else — use its mtime
  if (sessionFile) {
    try {
      const s = await stat(sessionFile);
      const ageMs = Date.now() - s.mtimeMs;
      const activeWindowMs = Math.min(DEFAULT_ACTIVE_WINDOW_MS, threshold);
      if (ageMs <= activeWindowMs) return { state: "active", timestamp: s.mtime };
      if (ageMs <= threshold) return { state: "ready", timestamp: s.mtime };
      return { state: "idle", timestamp: s.mtime };
    } catch {
      // stat failed — no signal available
    }
  }

  return null;
}
