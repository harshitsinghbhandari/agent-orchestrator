/**
 * Tests for the command executor — spawns real Node child processes against
 * tmpdir, exercises the JSON-over-stdout contract, exit-code semantics,
 * timeout/abort behavior, and the fork-PR gate.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialCanonicalLifecycle } from "../lifecycle-state.js";
import {
  asRunId,
  asStageRunId,
  createCommandExecutor,
  type CommandStageExecutor,
  type RunningCommandStage,
  type Stage,
  type StartCommandStageInput,
} from "../pipeline/index.js";
import type { PRInfo, Session, SessionId, SessionManager } from "../types.js";

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "command-executor-"));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    name: "lint",
    trigger: { on: ["pr.opened"] },
    executor: { kind: "command", command: process.execPath, args: ["-e", "process.exit(0)"] },
    task: {},
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses-1" as SessionId,
    projectId: "proj-a",
    status: "working",
    activity: "active",
    activitySignal: {
      state: "valid",
      activity: "active",
      source: "runtime",
      timestamp: new Date(),
    },
    lifecycle: createInitialCanonicalLifecycle("worker", new Date()),
    branch: "feat/x",
    issueId: null,
    pr: null,
    prs: [],
    workspacePath: workspaceRoot,
    runtimeHandle: { id: "tmux-1", runtimeName: "tmux", data: {} },
    agentInfo: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    metadata: {},
    ...overrides,
  };
}

function makePR(overrides: Partial<PRInfo> = {}): PRInfo {
  return {
    number: 7,
    url: "https://github.com/org/repo/pull/7",
    title: "Test",
    owner: "org",
    repo: "repo",
    branch: "feat/x",
    baseBranch: "main",
    isDraft: false,
    isFromFork: false,
    ...overrides,
  };
}

function makeMockSM(session: Session | null = null): {
  sm: Pick<SessionManager, "get">;
} {
  const current = session ?? makeSession();
  return {
    sm: {
      get: vi.fn(async (_id: SessionId): Promise<Session | null> => (session === null ? null : current)),
    },
  };
}

function makeStartInput(overrides: Partial<StartCommandStageInput> = {}): StartCommandStageInput {
  return {
    pipelineName: "default",
    runId: asRunId("run-1"),
    stageRunId: asStageRunId("sr-1"),
    stage: makeStage(),
    sessionId: "ses-1",
    allowForkPRs: false,
    ...overrides,
  };
}

/**
 * Run startStage and wait for the child to finish (or short-circuit). Returns
 * the latched final outcome via pollStage.
 */
async function runToCompletion(
  exec: CommandStageExecutor,
  input: StartCommandStageInput,
): Promise<{
  handle: RunningCommandStage;
  outcome: Awaited<ReturnType<CommandStageExecutor["pollStage"]>>;
}> {
  const handle = await exec.startStage(input);
  await handle.done;
  const outcome = await exec.pollStage(handle);
  return { handle, outcome };
}

describe("command executor — happy path", () => {
  it("parses outcome=succeeded with verdict=pass and artifacts from stdout", async () => {
    const { sm } = makeMockSM(makeSession());
    const exec = createCommandExecutor({ sessionManager: sm });

    const script = `process.stdout.write(JSON.stringify({
      outcome: "succeeded",
      verdict: "pass",
      artifacts: [{
        kind: "finding",
        filePath: "src/a.ts",
        startLine: 1,
        endLine: 2,
        title: "unused var",
        description: "x is unused",
        category: "style",
        severity: "warning",
        confidence: 0.9
      }]
    }))`;

    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.verdict).toBe("pass");
    expect(outcome.artifacts).toHaveLength(1);
    expect(outcome.artifacts[0]).toMatchObject({ kind: "finding", title: "unused var" });
    expect(outcome.observation).toBeUndefined();
  });

  it("defaults verdict to pass when outcome=succeeded omits verdict", async () => {
    const { sm } = makeMockSM(makeSession());
    const exec = createCommandExecutor({ sessionManager: sm });

    const script = `process.stdout.write(JSON.stringify({ outcome: "succeeded" }))`;
    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.verdict).toBe("pass");
    expect(outcome.artifacts).toEqual([]);
  });
});

describe("command executor — exit-code semantics", () => {
  it("collapses non-zero exit to STAGE_FAILED regardless of stdout content", async () => {
    const { sm } = makeMockSM(makeSession());
    const exec = createCommandExecutor({ sessionManager: sm });

    // The shim writes a "succeeded" result but exits non-zero — this is the
    // exact scenario the executor must defend against (partial-write crashes).
    const script = `process.stdout.write(JSON.stringify({ outcome: "succeeded" })); process.exit(2)`;
    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.errorMessage).toContain("code 2");
  });

  it("fails when exit 0 produces no JSON on stdout", async () => {
    const { sm } = makeMockSM(makeSession());
    const exec = createCommandExecutor({ sessionManager: sm });

    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", ""] },
        }),
      }),
    );
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.errorMessage).toMatch(/no JSON on stdout/);
  });

  it("fails on malformed JSON in stdout (exit 0)", async () => {
    const { sm } = makeMockSM(makeSession());
    const exec = createCommandExecutor({ sessionManager: sm });

    const script = `process.stdout.write("{ outcome: succeeded ")`;
    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.errorMessage).toMatch(/unparseable JSON/);
  });

  it("fails on JSON that doesn't match the TaskResult schema", async () => {
    const { sm } = makeMockSM(makeSession());
    const exec = createCommandExecutor({ sessionManager: sm });

    const script = `process.stdout.write(JSON.stringify({ result: "ok" }))`;
    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.errorMessage).toMatch(/failed validation/);
  });

  it("surfaces shim-reported outcome=failed with the reason", async () => {
    const { sm } = makeMockSM(makeSession());
    const exec = createCommandExecutor({ sessionManager: sm });

    const script = `process.stdout.write(JSON.stringify({ outcome: "failed", reason: "tsc errored: 17 problems" }))`;
    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.errorMessage).toContain("tsc errored: 17 problems");
  });
});

describe("command executor — timeout / cancel", () => {
  it("cancelStage SIGTERMs a long-running child within the grace window", async () => {
    const { sm } = makeMockSM(makeSession());
    // Tight grace so the SIGTERM→SIGKILL escalation completes quickly in the
    // test even when the child ignores SIGTERM.
    const exec = createCommandExecutor({ sessionManager: sm, killGraceMs: 50 });

    // Sleep ~2s — well past the test deadline if it survives.
    const script = `setTimeout(() => process.stdout.write(JSON.stringify({ outcome: "succeeded" })), 2000)`;
    const handle = await exec.startStage(
      makeStartInput({
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );
    expect(handle.child).not.toBeNull();
    expect(handle.finalOutcome).toBeNull();

    const start = Date.now();
    await exec.cancelStage(handle);
    const elapsed = Date.now() - start;

    // Should be well under the 2s sleep — SIGTERM kills the Node process
    // immediately when it's just sitting in setTimeout.
    expect(elapsed).toBeLessThan(1500);

    const outcome = await exec.pollStage(handle);
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    // The child exited via SIGTERM (signal), not via clean exit code.
    expect(outcome.errorMessage).toMatch(/signal SIG(TERM|KILL)|code null/);
  });

  it("pollStage returns running until the child exits", async () => {
    const { sm } = makeMockSM(makeSession());
    const exec = createCommandExecutor({ sessionManager: sm, killGraceMs: 50 });

    const script = `setTimeout(() => process.stdout.write(JSON.stringify({ outcome: "succeeded" })), 100)`;
    const handle = await exec.startStage(
      makeStartInput({
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );

    // Immediately after start the child is still alive.
    const earlyOutcome = await exec.pollStage(handle);
    expect(earlyOutcome.status).toBe("running");

    // Wait for the child to exit, then verify the outcome latches.
    await handle.done;
    const finalOutcome = await exec.pollStage(handle);
    expect(finalOutcome.status).toBe("completed");
  });
});

describe("command executor — fork-PR gating", () => {
  it("blocks when PR is from a fork and allowForkPRs=false", async () => {
    const { sm } = makeMockSM(makeSession({ pr: makePR({ isFromFork: true }) }));
    const exec = createCommandExecutor({ sessionManager: sm });

    // Use a script that would clearly succeed if it ran — that way the
    // assertion is "stage skipped" not "stage just happened to no-op".
    const failIfRun = `process.stdout.write(JSON.stringify({ outcome: "succeeded", artifacts: [] }))`;
    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        allowForkPRs: false,
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", failIfRun] },
        }),
      }),
    );

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.verdict).toBe("neutral");
    expect(outcome.artifacts).toEqual([]);
    expect(outcome.observation?.name).toBe("command_stage_skipped_fork_pr");
    expect(outcome.observation?.data).toMatchObject({ isFromFork: true, prNumber: 7 });
  });

  it("runs the command when fork PR is explicitly allowed via allowForkPRs=true", async () => {
    const { sm } = makeMockSM(makeSession({ pr: makePR({ isFromFork: true }) }));
    const exec = createCommandExecutor({ sessionManager: sm });

    const script = `process.stdout.write(JSON.stringify({ outcome: "succeeded", artifacts: [] }))`;
    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        allowForkPRs: true,
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.verdict).toBe("pass");
    expect(outcome.observation).toBeUndefined();
  });

  it("fail-safe: blocks when isFromFork=null (SCM could not classify)", async () => {
    const { sm } = makeMockSM(makeSession({ pr: makePR({ isFromFork: null }) }));
    const exec = createCommandExecutor({ sessionManager: sm });

    const script = `process.stdout.write(JSON.stringify({ outcome: "succeeded", artifacts: [] }))`;
    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        allowForkPRs: false,
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.verdict).toBe("neutral");
    expect(outcome.observation?.name).toBe("command_stage_skipped_fork_pr");
    expect(outcome.observation?.data).toMatchObject({ isFromFork: null });
  });

  it("runs the command for a same-repo PR (isFromFork=false)", async () => {
    const { sm } = makeMockSM(makeSession({ pr: makePR({ isFromFork: false }) }));
    const exec = createCommandExecutor({ sessionManager: sm });

    const script = `process.stdout.write(JSON.stringify({ outcome: "succeeded" }))`;
    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        allowForkPRs: false,
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.verdict).toBe("pass");
  });

  it("runs the command when there is no PR at all", async () => {
    const { sm } = makeMockSM(makeSession({ pr: null }));
    const exec = createCommandExecutor({ sessionManager: sm });

    const script = `process.stdout.write(JSON.stringify({ outcome: "succeeded" }))`;
    const { outcome } = await runToCompletion(
      exec,
      makeStartInput({
        allowForkPRs: false,
        stage: makeStage({
          executor: { kind: "command", command: process.execPath, args: ["-e", script] },
        }),
      }),
    );

    expect(outcome.status).toBe("completed");
  });
});

describe("command executor — error paths", () => {
  it("fails when the session cannot be resolved", async () => {
    const { sm } = makeMockSM(null);
    const exec = createCommandExecutor({ sessionManager: sm });

    const { outcome } = await runToCompletion(exec, makeStartInput());
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.errorMessage).toMatch(/unknown session ses-1/);
  });

  it("fails when the session has no workspacePath", async () => {
    const { sm } = makeMockSM(makeSession({ workspacePath: null }));
    const exec = createCommandExecutor({ sessionManager: sm });

    const { outcome } = await runToCompletion(exec, makeStartInput());
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.errorMessage).toMatch(/requires a workspace/);
  });

  it("rejects cwd that escapes the workspace", async () => {
    const { sm } = makeMockSM(makeSession());
    const exec = createCommandExecutor({ sessionManager: sm });

    const handle = await exec.startStage(
      makeStartInput({
        stage: makeStage({
          executor: {
            kind: "command",
            command: process.execPath,
            args: ["-e", "process.exit(0)"],
            cwd: "../outside",
          },
        }),
      }),
    );
    expect(handle.finalOutcome?.status).toBe("failed");
    if (handle.finalOutcome?.status !== "failed") return;
    expect(handle.finalOutcome.errorMessage).toMatch(/relative path inside the workspace/);
  });
});
