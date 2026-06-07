/**
 * Agent executor — bridge between the pipeline engine and a real AO session.
 *
 * For each stage:
 *   1. Spawn a fresh AO session (its own worktree, runtime, dashboard card)
 *      via the existing session manager.
 *   2. Inject the task as the initial prompt by stitching Layer 4 onto the
 *      caller-provided prompt.
 *   3. Wait until the session reaches `idle` AND a `findings.jsonl` artifact
 *      exists at `{workspacePath}/.ao/pipeline-findings.jsonl`.
 *   4. Harvest findings, parse them as ArtifactInput records, return them.
 *   5. Kill the session — worktree cleanup goes through the normal
 *      session-archive path inside SessionManager.kill().
 *
 * The executor is intentionally thin: it does not touch the reducer or the
 * pipeline store. Engine-side wiring (calling `startStage`, polling, dispatching
 * STAGE_COMPLETED / STAGE_FAILED) lives in pipeline/engine.ts.
 *
 * The session is fully talk-to-able for its entire lifetime: `ao send`,
 * dashboard chat, terminal attach all work as for any session, since this
 * executor leans on the standard SessionManager.spawn() path.
 */

import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { type SessionId, type SessionManager } from "../../types.js";
import { buildStagePrompt } from "../stage-prompt.js";
import {
  PIPELINE_FINDINGS_FILENAME,
  type ArtifactInput,
  type PrContext,
  type RunId,
  type Stage,
  type StageRunId,
} from "../types.js";

export interface AgentExecutorDeps {
  sessionManager: SessionManager;
}

export interface StartStageInput {
  /** Pipeline name — used for prompt context only. */
  pipelineName: string;
  /** Project the stage executes in. */
  projectId: string;
  /** Run/stage ids the engine has allocated; passed through to results. */
  runId: RunId;
  stageRunId: StageRunId;
  stage: Stage;
  /** Issue id this run is scoped to, if any. Threaded into session metadata. */
  issueId?: string;
  /** Loop counter from the engine. Surfaced in the prompt only. */
  loopRound?: number;
  /**
   * PR context for the run, threaded into both the prompt (so the agent
   * knows what's being reviewed) and the spawn (so the worktree is pinned
   * to the PR head SHA via `checkoutSha`). Absent for manual / orchestrator
   * triggers that aren't scoped to a PR.
   */
  prContext?: PrContext;
}

/**
 * Handle for a stage that's running. Treat as opaque — the engine just keeps
 * it around and threads it back into pollStage / cancelStage.
 */
export interface RunningAgentStage {
  runId: RunId;
  stageRunId: StageRunId;
  stageName: string;
  sessionId: SessionId;
  workspacePath: string;
  startedAt: number;
  /** Snapshot of the inputs used to start, for diagnostic logging. */
  input: StartStageInput;
}

/**
 * Side-channel observations the executor wants the engine to route through
 * `EMIT_OBSERVATION`. Currently used for `finding-truncation` warnings when
 * `parseFindingsFile` caps a runaway findings file.
 */
export interface AgentExecutorObservation {
  name: string;
  data: Record<string, unknown>;
}

export type StageOutcome =
  | { status: "running" }
  | {
      status: "completed";
      artifacts: ArtifactInput[];
      observations?: AgentExecutorObservation[];
    }
  | { status: "failed"; errorMessage: string; observations?: AgentExecutorObservation[] };

export interface AgentStageExecutor {
  startStage(input: StartStageInput): Promise<RunningAgentStage>;
  /**
   * Poll a running stage. Returns `{ status: "running" }` until the session
   * reaches `idle` AND the findings file exists. On completion, harvests
   * findings, kills the session, and returns the artifacts.
   *
   * Side effect: when status transitions to `completed` or `failed`, the
   * underlying session is killed before returning.
   */
  pollStage(handle: RunningAgentStage): Promise<StageOutcome>;
  /** Kill the underlying session early. Idempotent. */
  cancelStage(handle: RunningAgentStage): Promise<void>;
}

/**
 * Thrown when the executor cannot construct a fresh session for a stage —
 * usually because the stage's executor is not `agent` or the session manager
 * spawn fails. Caller (engine) maps this to STAGE_FAILED. Underlying error is
 * attached as `Error.cause` (TS5+ / Node 16.9+).
 */
export class AgentExecutorSpawnError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentExecutorSpawnError";
  }
}

/** File name of the conventional findings drop, exposed for tests/UI. */
export const STAGE_FINDINGS_RELATIVE_PATH = join(".ao", PIPELINE_FINDINGS_FILENAME);

/**
 * Maximum bytes the executor reads from a stage's findings file (#197 / 8d).
 * Beyond this cap, additional lines are dropped and a
 * `pipeline.findings.truncated` observation is emitted. The number is
 * generous enough for legitimate review output (thousands of findings) but
 * small enough to keep a misbehaving agent from OOMing the engine.
 */
export const FINDINGS_FILE_SIZE_CAP_BYTES = 5 * 1024 * 1024;

export function createAgentExecutor(deps: AgentExecutorDeps): AgentStageExecutor {
  const { sessionManager } = deps;

  async function startStage(input: StartStageInput): Promise<RunningAgentStage> {
    if (input.stage.executor.kind !== "agent") {
      throw new AgentExecutorSpawnError(
        `agent executor cannot start stage "${input.stage.name}" with executor.kind=${input.stage.executor.kind}`,
      );
    }

    const stagePrompt = buildStagePrompt({
      pipelineName: input.pipelineName,
      stage: input.stage,
      loopRound: input.loopRound,
      ...(input.prContext ? { prContext: input.prContext } : {}),
    });

    let session;
    try {
      session = await sessionManager.spawn({
        projectId: input.projectId,
        issueId: input.issueId,
        prompt: stagePrompt,
        agent: input.stage.executor.plugin,
        // Pin the worktree to the PR head SHA so the reviewer sees the
        // diff being reviewed instead of `origin/<defaultBranch>` (#215).
        // Workspaces that can't pin a commit (workspace-clone) ignore it.
        ...(input.prContext?.headSha ? { checkoutSha: input.prContext.headSha } : {}),
      });
    } catch (err) {
      throw new AgentExecutorSpawnError(
        `Failed to spawn session for stage "${input.stage.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    }

    if (!session.workspacePath) {
      // Belt-and-suspenders: the session manager always materializes a
      // workspace for spawn(), but if a non-default workspace plugin returns
      // a session without one we cannot harvest findings from a known path.
      await safeKill(sessionManager, session.id);
      throw new AgentExecutorSpawnError(
        `Spawned session ${session.id} for stage "${input.stage.name}" has no workspacePath; cannot harvest findings`,
      );
    }

    return {
      runId: input.runId,
      stageRunId: input.stageRunId,
      stageName: input.stage.name,
      sessionId: session.id,
      workspacePath: session.workspacePath,
      startedAt: Date.now(),
      input,
    };
  }

  async function pollStage(handle: RunningAgentStage): Promise<StageOutcome> {
    const session = await sessionManager.get(handle.sessionId);
    if (!session) {
      // Session vanished between polls — treat as failure so the engine can
      // record an error rather than spinning forever waiting for an idle
      // signal that will never come.
      return {
        status: "failed",
        errorMessage: `Stage "${handle.stageName}" session ${handle.sessionId} no longer exists`,
      };
    }

    // The runtime/lifecycle escaping `idle` (e.g. session crashed, was killed
    // out-of-band, or the agent exited without producing findings) is treated
    // as a failure. The session is already terminal; nothing more to harvest.
    if (isFailedTerminalSession(session)) {
      const reason = session.lifecycle?.session.reason ?? session.status;
      return {
        status: "failed",
        errorMessage: `Stage "${handle.stageName}" session ${handle.sessionId} terminated without findings (reason=${reason})`,
      };
    }

    const findingsPath = join(handle.workspacePath, STAGE_FINDINGS_RELATIVE_PATH);
    const findingsReady = existsSync(findingsPath);
    const isIdle = session.activity === "idle";

    if (!isIdle || !findingsReady) {
      return { status: "running" };
    }

    let parseResult: ParseFindingsResult;
    try {
      parseResult = await parseFindingsFile(findingsPath);
    } catch (err) {
      // Don't kill: leave the session up so a human can inspect the bad
      // findings file. Engine will mark the stage failed.
      return {
        status: "failed",
        errorMessage: `Stage "${handle.stageName}" produced unparseable findings at ${findingsPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    await safeKill(sessionManager, handle.sessionId);
    const observations: AgentExecutorObservation[] = [];
    if (parseResult.truncated) {
      observations.push({
        name: "pipeline.findings.truncated",
        data: {
          runId: handle.runId,
          stageRunId: handle.stageRunId,
          stageName: handle.stageName,
          findingsPath,
          capBytes: FINDINGS_FILE_SIZE_CAP_BYTES,
          bytesRead: parseResult.bytesRead,
        },
      });
    }
    return observations.length > 0
      ? { status: "completed", artifacts: parseResult.artifacts, observations }
      : { status: "completed", artifacts: parseResult.artifacts };
  }

  async function cancelStage(handle: RunningAgentStage): Promise<void> {
    await safeKill(sessionManager, handle.sessionId);
  }

  return { startStage, pollStage, cancelStage };
}

function isFailedTerminalSession(session: {
  status: string;
  activity: string | null;
  lifecycle?: { session: { state: string } };
}): boolean {
  if (session.activity === "exited") return true;
  if (session.lifecycle?.session.state === "terminated") return true;
  // `done` is a healthy terminal — but for stages we never expect a session to
  // reach `done` before findings are harvested, so treat it as a failure too.
  // (Sessions only transition to `done` after PR merge / explicit completion.)
  if (session.status === "killed" || session.status === "errored" || session.status === "done") {
    return true;
  }
  return false;
}

interface ParseFindingsResult {
  artifacts: ArtifactInput[];
  /** True when the cap fired and trailing lines were dropped. */
  truncated: boolean;
  /** Bytes consumed before stopping. */
  bytesRead: number;
}

/**
 * Stream the findings JSONL line-by-line, capping at `FINDINGS_FILE_SIZE_CAP_BYTES`.
 * When the cap fires we drop the in-progress line (it may be truncated mid-token)
 * and stop reading; the caller surfaces a `pipeline.findings.truncated`
 * observation. Earlier complete lines are still returned.
 *
 * Streaming + cap fixes the OOM risk flagged in the old `readFileSync` TODO:
 * a misbehaving agent dumping its entire reasoning trace into findings would
 * have grown the engine's RSS by the full file size.
 */
async function parseFindingsFile(path: string): Promise<ParseFindingsResult> {
  const stream = createReadStream(path, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const out: ArtifactInput[] = [];
  let lineNo = 0;
  let bytesRead = 0;
  let truncated = false;

  try {
    for await (const raw of rl) {
      lineNo++;
      // `raw` is the line without its trailing newline — account for the
      // newline byte when measuring against the cap so file size matches.
      // Approximation: +1 byte per line. Good enough; we're not billing.
      bytesRead += Buffer.byteLength(raw, "utf-8") + 1;
      if (bytesRead > FINDINGS_FILE_SIZE_CAP_BYTES) {
        truncated = true;
        break;
      }
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        throw new Error(`line ${lineNo}: ${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        });
      }
      out.push(coerceArtifactInput(parsed, lineNo));
    }
  } finally {
    // Closing the readline interface destroys the underlying stream; calling
    // close() unblocks readers and releases the fd promptly when we broke
    // out early due to truncation.
    rl.close();
    stream.destroy();
  }

  return { artifacts: out, truncated, bytesRead };
}

const VALID_SEVERITIES = ["error", "warning", "info"] as const;

function coerceArtifactInput(value: unknown, lineNo: number): ArtifactInput {
  if (!value || typeof value !== "object") {
    throw new Error(`line ${lineNo}: expected object`);
  }
  const obj = value as Record<string, unknown>;
  if (obj["kind"] === "finding") {
    requireString(obj, "filePath", lineNo);
    requireNumber(obj, "startLine", lineNo);
    requireNumber(obj, "endLine", lineNo);
    requireString(obj, "title", lineNo);
    requireString(obj, "description", lineNo);
    requireString(obj, "category", lineNo);
    requireEnum(obj, "severity", VALID_SEVERITIES, lineNo);
    requireNumberInRange(obj, "confidence", 0, 1, lineNo);
    return obj as unknown as ArtifactInput;
  }
  if (obj["kind"] === "json") {
    if (!obj["data"] || typeof obj["data"] !== "object") {
      throw new Error(`line ${lineNo}: "json" artifact requires object \`data\``);
    }
    return obj as unknown as ArtifactInput;
  }
  throw new Error(`line ${lineNo}: unknown artifact kind=${JSON.stringify(obj["kind"])}`);
}

function requireString(obj: Record<string, unknown>, key: string, lineNo: number): void {
  if (typeof obj[key] !== "string") {
    throw new Error(`line ${lineNo}: missing string field "${key}"`);
  }
}

function requireNumber(obj: Record<string, unknown>, key: string, lineNo: number): void {
  if (typeof obj[key] !== "number") {
    throw new Error(`line ${lineNo}: missing numeric field "${key}"`);
  }
}

function requireNumberInRange(
  obj: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  lineNo: number,
): void {
  const value = obj[key];
  if (typeof value !== "number" || value < min || value > max) {
    throw new Error(
      `line ${lineNo}: field "${key}" must be a number in [${min}, ${max}], got ${JSON.stringify(value)}`,
    );
  }
}

function requireEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  lineNo: number,
): void {
  const value = obj[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `line ${lineNo}: field "${key}" must be one of ${allowed
        .map((v) => `"${v}"`)
        .join(", ")}, got ${JSON.stringify(value)}`,
    );
  }
}

async function safeKill(sm: SessionManager, sessionId: SessionId): Promise<void> {
  try {
    await sm.kill(sessionId, { reason: "auto_cleanup" });
  } catch {
    // Best-effort. Engine has no useful response to a kill failure here —
    // the next poll cycle in lifecycle-manager will reconcile dead runtimes.
  }
}
