/**
 * Command executor — spawns a shell command in the stage's worktree and
 * parses a single TaskResult JSON object from its stdout.
 *
 * # JSON-over-stdout contract
 *
 * The spawned process must write **exactly one JSON object** to stdout that
 * conforms to `CommandTaskResult`:
 *
 *   { "outcome": "succeeded" | "failed" | "neutral" | "skipped",
 *     "verdict"?:  "pass" | "fail" | "neutral",
 *     "artifacts"?: ArtifactInput[],
 *     "reason"?: string }
 *
 * Exit-code semantics:
 *   - Exit 0     → stdout is parsed. Malformed/empty stdout → STAGE_FAILED.
 *   - Exit != 0  → the shim itself crashed. The executor collapses to
 *                  `{outcome: "failed"}` regardless of what landed on stdout
 *                  (a partial dump is worse than a clean failure label).
 *
 * **Shims wrapping tsc / eslint / vitest etc. must invert their wrapped
 * exit code.** A pipeline `typecheck` shim should call `tsc`, capture its
 * output, emit findings as JSON, and then exit 0 even when tsc found errors —
 * otherwise this executor will discard the findings and surface a generic
 * shim-crash. The `verdict` field is how the shim says "tool ran successfully
 * but the project is broken" (verdict=fail), not the exit code.
 *
 * # Fork-PR gating
 *
 * Command stages skip themselves (stage status = succeeded, verdict = neutral,
 * no artifacts) when the linked worker session's PR is from a fork and the
 * pipeline hasn't opted in via `Pipeline.allowForkPRs`. `isFromFork === null`
 * (SCM plugin cannot determine fork status) is fail-safe — also blocks. This
 * prevents a hostile PR from executing arbitrary code in CI via the pipeline.
 *
 * # Lifecycle
 *
 * Follows the same start/poll/cancel handle pattern as the agent executor so
 * the engine can drive command and agent stages through one inflight loop.
 *  - `startStage`  → spawn (or short-circuit on fork gate / missing workspace)
 *  - `pollStage`   → check whether the child has exited yet
 *  - `cancelStage` → SIGTERM → 5s grace → SIGKILL (process-tree kill via
 *                    `killProcessTree`, so detached shells don't outlive us)
 */

import { spawn, type ChildProcess } from "node:child_process";

import { isWindows, killProcessTree } from "../../platform.js";
import type { Session, SessionId, SessionManager } from "../../types.js";
import type {
  ArtifactInput,
  RunId,
  Stage,
  StageRunId,
  Verdict,
} from "../types.js";

/** Outcome label a shim writes to stdout. */
export type CommandTaskOutcome = "succeeded" | "failed" | "neutral" | "skipped";

/** Shape the shim writes to stdout as a single JSON object. */
export interface CommandTaskResult {
  outcome: CommandTaskOutcome;
  /** Optional explicit verdict; otherwise derived from `outcome`. */
  verdict?: Verdict;
  /** Findings / json artifacts produced by the shim. */
  artifacts?: ArtifactInput[];
  /** Human-readable rationale; surfaced in observation/error metadata. */
  reason?: string;
}

/** Stdout/stderr capture cap (1 MiB). Prevents a runaway shim from OOMing us. */
export const COMMAND_OUTPUT_CAP_BYTES = 1024 * 1024;

/** Grace period between SIGTERM and SIGKILL on cancel. */
export const COMMAND_KILL_GRACE_MS = 5_000;

export interface StartCommandStageInput {
  pipelineName: string;
  runId: RunId;
  stageRunId: StageRunId;
  stage: Stage;
  /**
   * The linked worker session this run was triggered for. The executor reads
   * `session.workspacePath` (cwd for the spawn) and `session.pr.isFromFork`
   * (for fork-PR gating). Engine resolves the session through SessionManager
   * before calling so this module stays decoupled from session storage.
   */
  sessionId: SessionId | string;
  /** From `Pipeline.allowForkPRs`. Defaults to `false` in the engine wiring. */
  allowForkPRs: boolean;
}

export interface RunningCommandStage {
  runId: RunId;
  stageRunId: StageRunId;
  stageName: string;
  /** Null when the stage short-circuited before spawn (fork gate or no workspace). */
  child: ChildProcess | null;
  startedAt: number;
  /** Resolves once the child has exited (or fired immediately on short-circuit). */
  done: Promise<CommandFinalOutcome>;
  /** Latched once `done` resolves so `pollStage` doesn't await twice. */
  finalOutcome: CommandFinalOutcome | null;
}

export interface CommandObservation {
  name: string;
  data: Record<string, unknown>;
}

type CommandFinalOutcome =
  | { status: "completed"; verdict: Verdict; artifacts: ArtifactInput[]; observation?: CommandObservation }
  | { status: "failed"; errorMessage: string };

export type CommandStageOutcome = { status: "running" } | CommandFinalOutcome;

export interface CommandStageExecutor {
  startStage(input: StartCommandStageInput): Promise<RunningCommandStage>;
  pollStage(handle: RunningCommandStage): Promise<CommandStageOutcome>;
  cancelStage(handle: RunningCommandStage): Promise<void>;
}

export interface CommandExecutorDeps {
  /** Looks up the linked worker session. Used for workspacePath + PR info. */
  sessionManager: Pick<SessionManager, "get">;
  /** Override clock for tests. */
  now?: () => number;
  /** Override grace window for tests (defaults to COMMAND_KILL_GRACE_MS). */
  killGraceMs?: number;
}

export function createCommandExecutor(deps: CommandExecutorDeps): CommandStageExecutor {
  const { sessionManager } = deps;
  const now = deps.now ?? Date.now;
  const killGraceMs = deps.killGraceMs ?? COMMAND_KILL_GRACE_MS;

  async function startStage(input: StartCommandStageInput): Promise<RunningCommandStage> {
    if (input.stage.executor.kind !== "command") {
      // Engine should have dispatched only command stages here; treat as a
      // programmer error rather than a runtime failure.
      throw new Error(
        `command executor cannot start stage "${input.stage.name}" with executor.kind=${input.stage.executor.kind}`,
      );
    }
    const spec = input.stage.executor;

    let session: Session | null;
    try {
      session = await sessionManager.get(input.sessionId as SessionId);
    } catch (err) {
      return shortCircuit(input, {
        status: "failed",
        errorMessage: `failed to resolve session ${input.sessionId} for command stage "${input.stage.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
    if (!session) {
      return shortCircuit(input, {
        status: "failed",
        errorMessage: `command stage "${input.stage.name}" references unknown session ${input.sessionId}`,
      });
    }

    // --- Fork-PR gate (runs BEFORE spawn) ---
    // null is fail-safe: SCM plugins without fork awareness block by default
    // so we never execute untrusted code we cannot classify.
    const pr = session.pr;
    const isFork = pr ? pr.isFromFork : false;
    if (isFork !== false && !input.allowForkPRs) {
      const reason =
        isFork === null
          ? `SCM plugin could not determine fork status for PR ${pr?.number ?? "(none)"}; blocking by default`
          : `PR #${pr?.number} is from a fork and pipeline.allowForkPRs is not enabled`;
      const observation: CommandObservation = {
        name: "command_stage_skipped_fork_pr",
        data: {
          stage: input.stage.name,
          prNumber: pr?.number ?? null,
          isFromFork: isFork,
          reason,
        },
      };
      return shortCircuit(input, {
        status: "completed",
        verdict: "neutral",
        artifacts: [],
        observation,
      });
    }

    // Worktree is mandatory — command stages run in the session's workspace.
    if (!session.workspacePath) {
      return shortCircuit(input, {
        status: "failed",
        errorMessage: `command stage "${input.stage.name}" requires a workspace but session ${session.id} has none`,
      });
    }

    const baseCwd = session.workspacePath;
    const cwd = spec.cwd ? resolveCwd(baseCwd, spec.cwd) : baseCwd;
    const env = { ...process.env, ...(spec.env ?? {}) };

    let child: ChildProcess;
    try {
      // `shell: isWindows()` so PATHEXT (.cmd/.bat shims) is honored on
      // Windows. POSIX uses direct execve and gets shell-free spawning, which
      // avoids shell-injection via spec.command.
      child = spawn(spec.command, spec.args ?? [], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: isWindows(),
        windowsHide: true,
        detached: !isWindows(), // own process group on POSIX so killProcessTree(-pid) works
      });
    } catch (err) {
      return shortCircuit(input, {
        status: "failed",
        errorMessage: `failed to spawn command "${spec.command}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutCapped = false;
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutCapped) return;
      if (stdoutBytes + chunk.length > COMMAND_OUTPUT_CAP_BYTES) {
        stdoutChunks.push(chunk.subarray(0, COMMAND_OUTPUT_CAP_BYTES - stdoutBytes));
        stdoutBytes = COMMAND_OUTPUT_CAP_BYTES;
        stdoutCapped = true;
        return;
      }
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
    });
    // Drain stderr to /dev/null — captured for diagnostics only on shim crash.
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes >= COMMAND_OUTPUT_CAP_BYTES) return;
      const take = Math.min(chunk.length, COMMAND_OUTPUT_CAP_BYTES - stderrBytes);
      stderrChunks.push(chunk.subarray(0, take));
      stderrBytes += take;
    });

    const handle: RunningCommandStage = {
      runId: input.runId,
      stageRunId: input.stageRunId,
      stageName: input.stage.name,
      child,
      startedAt: now(),
      finalOutcome: null,
      done: new Promise<CommandFinalOutcome>((resolve) => {
        let settled = false;
        const settle = (outcome: CommandFinalOutcome) => {
          if (settled) return;
          settled = true;
          resolve(outcome);
        };

        child.on("error", (err) => {
          settle({
            status: "failed",
            errorMessage: `command spawn error: ${err instanceof Error ? err.message : String(err)}`,
          });
        });

        child.on("exit", (code, signal) => {
          const stdoutText = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderrText = Buffer.concat(stderrChunks).toString("utf-8");
          settle(
            interpretChildExit({
              stageName: input.stage.name,
              code,
              signal,
              stdoutText,
              stderrText,
              stdoutCapped,
            }),
          );
        });
      }),
    };

    // Latch the final outcome so `pollStage` and `cancelStage` see a stable
    // value without re-awaiting.
    handle.done
      .then((outcome) => {
        handle.finalOutcome = outcome;
      })
      .catch(() => {
        // `done` never rejects (we settle with a failed outcome instead), but
        // attach a no-op catch for safety.
      });

    return handle;
  }

  async function pollStage(handle: RunningCommandStage): Promise<CommandStageOutcome> {
    if (handle.finalOutcome) return handle.finalOutcome;
    return { status: "running" };
  }

  async function cancelStage(handle: RunningCommandStage): Promise<void> {
    if (!handle.child || handle.finalOutcome) return;
    const pid = handle.child.pid;
    if (pid === undefined) return;

    await killProcessTree(pid, "SIGTERM");

    // Wait up to `killGraceMs` for the child to exit on its own; if it
    // doesn't, escalate to SIGKILL. `done` always resolves (never rejects).
    await Promise.race([
      handle.done,
      new Promise<void>((r) => setTimeout(r, killGraceMs).unref?.()),
    ]);

    if (!handle.finalOutcome) {
      await killProcessTree(pid, "SIGKILL");
      // Wait one more tick for the exit listener to flush; the engine doesn't
      // need this, but it gives `cancelStage` a deterministic post-condition.
      await handle.done;
    }
  }

  return { startStage, pollStage, cancelStage };
}

/** Synchronous-style short-circuit handle for fork-gate / spawn failures. */
function shortCircuit(
  input: StartCommandStageInput,
  outcome: CommandFinalOutcome,
): RunningCommandStage {
  return {
    runId: input.runId,
    stageRunId: input.stageRunId,
    stageName: input.stage.name,
    child: null,
    startedAt: Date.now(),
    done: Promise.resolve(outcome),
    finalOutcome: outcome,
  };
}

function resolveCwd(base: string, rel: string): string {
  // `cwd` in CommandExecutor is documented as "relative to the stage
  // workspace". Disallow absolute paths so a malicious config can't escape
  // the worktree, and disallow `..` segments for the same reason.
  if (/^([a-zA-Z]:)?[\\/]/.test(rel) || rel.split(/[\\/]/).includes("..")) {
    throw new Error(`command.cwd must be a relative path inside the workspace, got "${rel}"`);
  }
  return `${base.replace(/[\\/]+$/, "")}/${rel.replace(/^[\\/]+/, "")}`;
}

interface InterpretChildExitInput {
  stageName: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdoutText: string;
  stderrText: string;
  stdoutCapped: boolean;
}

function interpretChildExit(input: InterpretChildExitInput): CommandFinalOutcome {
  // Non-zero exit (or signal) → shim crashed. Collapse to {outcome:'failed'}
  // regardless of what showed up on stdout. A half-written JSON object is
  // worse than a clean "the shim died" failure label.
  if (input.code !== 0 || input.signal) {
    const exitLabel = input.signal ? `signal ${input.signal}` : `code ${input.code}`;
    const stderrPreview = input.stderrText.trim().slice(0, 500);
    const suffix = stderrPreview ? `; stderr: ${stderrPreview}` : "";
    return {
      status: "failed",
      errorMessage: `command stage "${input.stageName}" exited with ${exitLabel}${suffix}`,
    };
  }

  if (input.stdoutCapped) {
    return {
      status: "failed",
      errorMessage: `command stage "${input.stageName}" stdout exceeded ${COMMAND_OUTPUT_CAP_BYTES} bytes`,
    };
  }

  const trimmed = input.stdoutText.trim();
  if (!trimmed) {
    return {
      status: "failed",
      errorMessage: `command stage "${input.stageName}" produced no JSON on stdout`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      status: "failed",
      errorMessage: `command stage "${input.stageName}" produced unparseable JSON on stdout: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const validated = validateTaskResult(parsed);
  if (!validated.ok) {
    return {
      status: "failed",
      errorMessage: `command stage "${input.stageName}" JSON failed validation: ${validated.error}`,
    };
  }
  const result = validated.value;

  if (result.outcome === "failed") {
    const reason = result.reason?.trim();
    return {
      status: "failed",
      errorMessage: reason
        ? `command stage "${input.stageName}" reported outcome=failed: ${reason}`
        : `command stage "${input.stageName}" reported outcome=failed`,
    };
  }

  const verdict = result.verdict ?? defaultVerdictFor(result.outcome);
  const observation: CommandObservation | undefined =
    result.outcome === "skipped"
      ? {
          name: "command_stage_self_skipped",
          data: {
            stage: input.stageName,
            ...(result.reason ? { reason: result.reason } : {}),
          },
        }
      : undefined;

  return {
    status: "completed",
    verdict,
    artifacts: result.artifacts ?? [],
    ...(observation ? { observation } : {}),
  };
}

function defaultVerdictFor(outcome: Exclude<CommandTaskOutcome, "failed">): Verdict {
  if (outcome === "succeeded") return "pass";
  return "neutral"; // "neutral" and "skipped" both map to neutral
}

interface ValidationOk {
  ok: true;
  value: CommandTaskResult;
}
interface ValidationErr {
  ok: false;
  error: string;
}

function validateTaskResult(value: unknown): ValidationOk | ValidationErr {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "expected object" };
  }
  const obj = value as Record<string, unknown>;
  const outcome = obj["outcome"];
  if (
    outcome !== "succeeded" &&
    outcome !== "failed" &&
    outcome !== "neutral" &&
    outcome !== "skipped"
  ) {
    return {
      ok: false,
      error: `field "outcome" must be one of "succeeded"|"failed"|"neutral"|"skipped", got ${JSON.stringify(outcome)}`,
    };
  }
  const verdict = obj["verdict"];
  if (verdict !== undefined && verdict !== "pass" && verdict !== "fail" && verdict !== "neutral") {
    return {
      ok: false,
      error: `field "verdict" must be "pass"|"fail"|"neutral", got ${JSON.stringify(verdict)}`,
    };
  }
  const artifacts = obj["artifacts"];
  if (artifacts !== undefined && !Array.isArray(artifacts)) {
    return { ok: false, error: `field "artifacts" must be an array if present` };
  }
  const reason = obj["reason"];
  if (reason !== undefined && typeof reason !== "string") {
    return { ok: false, error: `field "reason" must be a string if present` };
  }
  return { ok: true, value: obj as unknown as CommandTaskResult };
}
