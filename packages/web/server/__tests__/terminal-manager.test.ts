import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveTmuxSession = vi.fn();
const mockValidateSessionId = vi.fn();
const mockPtySpawn = vi.fn();
const mockChildSpawn = vi.fn(() => ({ on: vi.fn() }));

vi.mock("../tmux-utils.js", () => ({
  findTmux: vi.fn(() => "/usr/bin/tmux"),
  resolveTmuxSession: mockResolveTmuxSession,
  validateSessionId: mockValidateSessionId,
}));

vi.mock("node-pty", () => ({
  spawn: mockPtySpawn,
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  return {
    ...actual,
    spawn: mockChildSpawn,
  };
});

class FakePty {
  private dataHandlers: Array<(data: string) => void> = [];
  private exitHandlers: Array<(event: { exitCode: number; signal?: number }) => void> = [];

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void): void {
    this.exitHandlers.push(handler);
  }

  write(): void {}

  resize(): void {}

  kill(): void {}

  emitData(data: string): void {
    for (const handler of this.dataHandlers) {
      handler(data);
    }
  }

  emitExit(exitCode: number): void {
    for (const handler of this.exitHandlers) {
      handler({ exitCode });
    }
  }
}

describe("TerminalManager", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mockResolveTmuxSession.mockReset();
    mockValidateSessionId.mockReset();
    mockPtySpawn.mockReset();
    mockChildSpawn.mockClear();
    mockResolveTmuxSession.mockReturnValue("606634cae37f-aa-33");
    mockValidateSessionId.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("deduplicates concurrent open requests onto a single attach", async () => {
    const pty = new FakePty();
    mockPtySpawn.mockReturnValue(pty);

    const { TerminalManager } = await import("../mux-websocket.js");
    const manager = new TerminalManager("/usr/bin/tmux");

    const firstOpen = manager.open("aa-33");
    const secondOpen = manager.open("aa-33");

    expect(mockPtySpawn).toHaveBeenCalledTimes(1);

    pty.emitData("\u001b[?2004h");

    await expect(Promise.all([firstOpen, secondOpen])).resolves.toEqual([
      "606634cae37f-aa-33",
      "606634cae37f-aa-33",
    ]);
  });

  it("retries early tmux missing-session output before reporting opened", async () => {
    const firstPty = new FakePty();
    const secondPty = new FakePty();
    mockPtySpawn.mockReturnValueOnce(firstPty).mockReturnValueOnce(secondPty);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { TerminalManager } = await import("../mux-websocket.js");
    const manager = new TerminalManager("/usr/bin/tmux");

    const openPromise = manager.open("aa-33");

    firstPty.emitData("can't find session: aa-33\r\n");
    firstPty.emitExit(1);
    await vi.advanceTimersByTimeAsync(0);

    const openedLogsBeforeRetry = logSpy.mock.calls.filter(([message]) =>
      String(message).includes("Opened terminal aa-33"),
    );
    expect(openedLogsBeforeRetry).toHaveLength(0);

    secondPty.emitData("\u001b[?2004h");

    await expect(openPromise).resolves.toBe("606634cae37f-aa-33");
    expect(mockPtySpawn).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("attach raced tmux availability; retrying"),
    );

    const openedLogs = logSpy.mock.calls.filter(([message]) =>
      String(message).includes("Opened terminal aa-33"),
    );
    expect(openedLogs).toHaveLength(1);
  });
});
