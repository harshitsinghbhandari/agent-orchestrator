import {
  shellEscape,
  normalizeAgentPermissionMode,
  recordTerminalActivity,
  isWindows,
  type Agent,
  type AgentSessionInfo,
  type AgentLaunchConfig,
  type ActivityState,
  type ActivityDetection,
  type CostEstimate,
  type PluginModule,
  type ProcessProbeResult,
  type ProjectConfig,
  type RuntimeHandle,
  type Session,
  type WorkspaceHooksConfig,
} from "@aoagents/ao-core";
import { execFile, execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import {
  findCodexSessionFileCached,
  getCodexActivityState,
  isCodexProcessAlive,
  setupCodexHookActivityUpdater,
  streamCodexSessionData,
  resetSessionFileCache,
} from "./activity-detection.js";

const execFileAsync = promisify(execFile);
// =============================================================================
// Plugin Manifest
// =============================================================================

export const manifest = {
  name: "codex",
  slot: "agent" as const,
  description: "Agent plugin: OpenAI Codex CLI",
  version: "0.1.1",
  displayName: "OpenAI Codex",
};

// =============================================================================
// Workspace Setup (delegates to shared PATH-wrapper hooks from @aoagents/ao-core)
// =============================================================================

// =============================================================================
// Binary Resolution
// =============================================================================

/**
 * Resolve the Codex CLI binary path.
 * Checks (in order): which, common fallback locations.
 * Returns "codex" as final fallback (let the shell resolve it at runtime).
 */
export async function resolveCodexBinary(): Promise<string> {
  if (isWindows()) {
    return resolveCodexBinaryWindows();
  }

  // 1. Try `which codex`
  try {
    const { stdout } = await execFileAsync("which", ["codex"], { timeout: 10_000 });
    const resolved = stdout.trim();
    if (resolved) return resolved;
  } catch {
    // Not found via which
  }

  // 2. Check common locations (npm global, Homebrew, Cargo — Codex is now Rust-based)
  const home = homedir();
  const candidates = [
    "/usr/local/bin/codex",
    "/opt/homebrew/bin/codex",
    join(home, ".cargo", "bin", "codex"),
    join(home, ".npm", "bin", "codex"),
  ];

  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Not found at this location
    }
  }

  // 3. Fallback: let the shell resolve it
  return "codex";
}

/**
 * Windows-specific binary lookup. `which` does not exist on Windows; the
 * equivalent is `where.exe`, which can return multiple lines (PATHEXT
 * variants). npm-installed CLIs land as `<name>.cmd` shims, while
 * Rust/Cargo installs produce `<name>.exe`. We prefer the .cmd shim because
 * it forwards to the right node binary, then fall back to .exe.
 */
async function resolveCodexBinaryWindows(): Promise<string> {
  for (const target of ["codex.cmd", "codex.exe"]) {
    try {
      const { stdout } = await execFileAsync("where.exe", [target], {
        timeout: 10_000,
        windowsHide: true,
      });
      const first = stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
      if (first) return first.trim();
    } catch {
      // Not on PATH — try next target
    }
  }

  // Fall back to common npm/Cargo install locations so AO works even when
  // the user installed Codex into a directory not currently on PATH.
  const appData = process.env["APPDATA"];
  const home = homedir();
  const candidates = [
    appData ? join(appData, "npm", "codex.cmd") : null,
    appData ? join(appData, "npm", "codex.exe") : null,
    join(home, ".cargo", "bin", "codex.exe"),
  ].filter((p): p is string => p !== null);

  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Not at this location
    }
  }

  // Last resort: bare name. PowerShell will hit PATHEXT to find codex.cmd.
  // Combined with the `& ` prefix from formatLaunchCommand this still works.
  return "codex";
}

// =============================================================================
// Agent Implementation
// =============================================================================

/** Append approval-policy flags to a command parts array */
function appendApprovalFlags(
  parts: string[],
  permissions: string | undefined,
  allowDangerousBypass = true,
): void {
  const mode = normalizeAgentPermissionMode(permissions);
  if (mode === "permissionless") {
    if (allowDangerousBypass) {
      parts.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      parts.push("--ask-for-approval", "never");
    }
  } else if (mode === "auto-edit") {
    parts.push("--ask-for-approval", "never");
  } else if (mode === "suggest") {
    parts.push("--ask-for-approval", "untrusted");
  }
}

/** Append model and reasoning flags to a command parts array */
function appendModelFlags(parts: string[], model: string | undefined): void {
  if (!model) return;
  parts.push("--model", shellEscape(model));

  // Auto-detect o-series models and enable reasoning via config override.
  // Codex does not have a --reasoning flag; reasoning is controlled via
  // the model_reasoning_effort config key.
  if (/^o[34]/i.test(model)) {
    parts.push("-c", "model_reasoning_effort=high");
  }
}

/** Disable Codex startup update checks/prompts in non-interactive sessions */
function appendNoUpdateCheckFlag(parts: string[]): void {
  parts.push("-c", "check_for_update_on_startup=false");
}

function isHookActivityEnabled(): boolean {
  return process.env["AO_CODEX_HOOK_ACTIVITY"] !== "0";
}

function appendHookActivityFlag(parts: string[]): void {
  if (!isHookActivityEnabled()) return;
  parts.push("--enable", "hooks");
}

function getSessionMetadataString(session: Session, key: string): string | null {
  const value = session.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Format a launch command for the host shell. On Windows the resolved binary
 * path is single-quoted by shellEscape (e.g. `'C:\Users\...\codex.cmd'`), and
 * PowerShell parses a leading quoted string as an expression — `'codex' -c …`
 * fails with "Unexpected token '-c' in expression or statement". Prepending
 * the call operator `& ` tells PowerShell to *invoke* the string as a command.
 * On Unix the prefix is unnecessary; bash treats `'codex' -c …` as a command.
 */
function formatLaunchCommand(parts: string[]): string {
  const cmd = parts.join(" ");
  return isWindows() ? `& ${cmd}` : cmd;
}

function createCodexAgent(): Agent {
  /** Cached resolved binary path (populated by init or first getLaunchCommand) */
  let resolvedBinary: string | null = null;
  /** Guard against concurrent resolveCodexBinary() calls */
  let resolvingBinary: Promise<string> | null = null;

  return {
    name: "codex",
    processName: "codex",

    getLaunchCommand(config: AgentLaunchConfig): string {
      const binary = resolvedBinary ?? "codex";
      const parts: string[] = [shellEscape(binary)];
      appendNoUpdateCheckFlag(parts);
      appendHookActivityFlag(parts);

      appendApprovalFlags(parts, config.permissions);
      appendModelFlags(parts, config.model);

      if (config.systemPromptFile) {
        // Codex reads developer instructions from a file via config override
        parts.push("-c", `model_instructions_file=${shellEscape(config.systemPromptFile)}`);
      } else if (config.systemPrompt) {
        // Codex accepts inline developer instructions via config override
        parts.push("-c", `developer_instructions=${shellEscape(config.systemPrompt)}`);
      }

      if (config.prompt) {
        // Use `--` to end option parsing so prompts starting with `-` aren't
        // misinterpreted as flags.
        parts.push("--", shellEscape(config.prompt));
      }

      return formatLaunchCommand(parts);
    },

    getEnvironment(config: AgentLaunchConfig): Record<string, string> {
      const env: Record<string, string> = {};
      env["AO_SESSION_ID"] = config.sessionId;
      // NOTE: AO_PROJECT_ID is the caller's responsibility (spawn.ts sets it)
      if (config.issueId) {
        env["AO_ISSUE_ID"] = config.issueId;
      }

      // PATH and GH_PATH are injected by session-manager for all agents.
      // Disable Codex's version check/update prompt for non-interactive AO sessions.
      env["CODEX_DISABLE_UPDATE_CHECK"] = "1";
      env["AO_WORKSPACE_PATH"] = config.workspacePath ?? config.projectConfig.path;
      if (!isHookActivityEnabled()) {
        env["AO_CODEX_HOOK_ACTIVITY"] = "0";
      }

      return env;
    },

    detectActivity(terminalOutput: string): ActivityState {
      if (!terminalOutput.trim()) return "idle";

      const lines = terminalOutput.trim().split("\n");
      const lastLine = lines[lines.length - 1]?.trim() ?? "";

      // If Codex is showing its input prompt, it's idle
      if (/^[>$#]\s*$/.test(lastLine)) return "idle";

      // Check last few lines for approval prompts
      const tail = lines.slice(-5).join("\n");
      if (/approval required/i.test(tail)) return "waiting_input";
      if (/\(y\)es.*\(n\)o/i.test(tail)) return "waiting_input";

      // Default to active — specific patterns (esc to interrupt, spinner
      // symbols) all map to "active" so no need to check them individually.
      return "active";
    },

    async getActivityState(
      session: Session,
      readyThresholdMs?: number,
    ): Promise<ActivityDetection | null> {
      return getCodexActivityState(session, readyThresholdMs);
    },

    async recordActivity(session: Session, terminalOutput: string): Promise<void> {
      if (!session.workspacePath) return;
      await recordTerminalActivity(session.workspacePath, terminalOutput, (output) =>
        this.detectActivity(output),
      );
    },

    async isProcessRunning(handle: RuntimeHandle): Promise<ProcessProbeResult> {
      return isCodexProcessAlive(handle);
    },

    async getSessionInfo(session: Session): Promise<AgentSessionInfo | null> {
      const sessionFile = await findCodexSessionFileCached(session);
      if (!sessionFile) return null;

      // Stream the file line-by-line to avoid loading potentially huge
      // rollout files (100 MB+) entirely into memory.
      const data = await streamCodexSessionData(sessionFile);
      if (!data) return null;

      const agentSessionId = basename(sessionFile, ".jsonl");

      let cost: CostEstimate | undefined;
      const totalInputTokens = data.inputTokens + data.cachedTokens;
      if (totalInputTokens > 0 || data.outputTokens > 0 || data.reasoningTokens > 0) {
        const estimatedCostUsd =
          (data.inputTokens / 1_000_000) * 2.5 +
          (data.cachedTokens / 1_000_000) * 0.625 +
          ((data.outputTokens + data.reasoningTokens) / 1_000_000) * 10.0;
        cost = {
          inputTokens: totalInputTokens,
          outputTokens: data.outputTokens,
          estimatedCostUsd,
        };
      }

      return {
        summary: data.model ? `Codex session (${data.model})` : null,
        summaryIsFallback: true,
        agentSessionId,
        metadata: data.threadId
          ? {
              codexThreadId: data.threadId,
              ...(data.model ? { codexModel: data.model } : {}),
            }
          : undefined,
        cost,
      };
    },

    async getRestoreCommand(session: Session, project: ProjectConfig): Promise<string | null> {
      let threadId = getSessionMetadataString(session, "codexThreadId");
      let model: string | null = getSessionMetadataString(session, "codexModel");
      if (!threadId) {
        if (!session.workspacePath) return null;

        // Find the Codex session file for this workspace
        const sessionFile = await findCodexSessionFileCached(session);
        if (!sessionFile) return null;

        // Stream the file line-by-line to avoid loading potentially huge
        // rollout files (100 MB+) entirely into memory.
        const data = await streamCodexSessionData(sessionFile);
        if (!data?.threadId) return null;
        threadId = data.threadId;
        model = data.model;
      }

      // Use Codex's native `resume` subcommand for proper conversation resume.
      // This restores the full thread state, not just a text prompt re-injection.
      // Flags are placed before the positional threadId for CLI parser compatibility.
      const binary = resolvedBinary ?? "codex";
      const parts: string[] = [shellEscape(binary), "resume"];
      appendNoUpdateCheckFlag(parts);
      appendHookActivityFlag(parts);

      appendApprovalFlags(parts, project.agentConfig?.permissions);
      const effectiveModel = (project.agentConfig?.model ?? model) as string | undefined;
      appendModelFlags(parts, effectiveModel ?? undefined);

      // Positional threadId goes last, after all flags
      parts.push(shellEscape(threadId));

      return formatLaunchCommand(parts);
    },

    async setupWorkspaceHooks(workspacePath: string, _config: WorkspaceHooksConfig): Promise<void> {
      // PATH wrappers are installed by session-manager for all agents.
      // Codex hooks are project-local, so install AO's activity updater here.
      if (!isHookActivityEnabled()) return;
      await setupCodexHookActivityUpdater(workspacePath);
    },

    async postLaunchSetup(_session: Session): Promise<void> {
      // Resolve binary path on first launch (cached for subsequent calls).
      // Uses a promise guard to prevent concurrent calls from racing.
      if (!resolvedBinary) {
        if (!resolvingBinary) {
          resolvingBinary = resolveCodexBinary();
        }
        try {
          resolvedBinary = await resolvingBinary;
        } finally {
          resolvingBinary = null;
        }
      }
      // PATH wrappers are re-ensured by session-manager.
    },
  };
}

// =============================================================================
// Plugin Export
// =============================================================================

export function create(): Agent {
  return createCodexAgent();
}

/** @internal Clear the session file cache. Exported for testing only. */
export function _resetSessionFileCache(): void {
  resetSessionFileCache();
}

export { CodexAppServerClient } from "./app-server-client.js";
export type {
  AppServerClientOptions,
  ThreadStartParams,
  TurnStartParams,
  NotificationHandler,
  ApprovalHandler,
  ApprovalDecision,
} from "./app-server-client.js";

export function detect(): boolean {
  try {
    execFileSync("codex", ["--version"], {
      stdio: "ignore",
      shell: isWindows(),
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export default { manifest, create, detect } satisfies PluginModule<Agent>;
