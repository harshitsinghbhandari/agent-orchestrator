import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import type { Terminal as TerminalType } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";

const { resizeTerminalMux, useMuxMock } = vi.hoisted(() => ({
  resizeTerminalMux: vi.fn(),
  useMuxMock: vi.fn(),
}));

vi.mock("@/hooks/useMux", () => ({
  useMux: useMuxMock,
}));

import { useFullscreenResize } from "../useFullscreenResize";

function makeTerminal(): TerminalType {
  return {
    cols: 80,
    rows: 24,
    refresh: vi.fn(),
  } as unknown as TerminalType;
}

function makeFit(): FitAddonType {
  return {
    fit: vi.fn(),
  } as unknown as FitAddonType;
}

/** Build a container whose getBoundingClientRect returns `nextHeight()` each call. */
function makeContainer(nextHeight: () => number = () => 400): HTMLDivElement {
  const div = document.createElement("div");
  const parent = document.createElement("div");
  parent.appendChild(div);
  document.body.appendChild(parent);
  div.getBoundingClientRect = () => {
    const height = nextHeight();
    return {
      height,
      width: 800,
      top: 0,
      left: 0,
      bottom: height,
      right: 800,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    };
  };
  return div;
}

function renderResize(opts: {
  fullscreen: boolean;
  terminal: TerminalType | null;
  fit: FitAddonType | null;
  container: HTMLDivElement | null;
  sessionId?: string;
  projectId?: string;
}) {
  return renderHook(
    ({ fullscreen }: { fullscreen: boolean }) => {
      const terminalRef = useRef<TerminalType | null>(opts.terminal);
      const fitRef = useRef<FitAddonType | null>(opts.fit);
      const containerRef = useRef<HTMLDivElement | null>(opts.container);
      useFullscreenResize(
        fullscreen,
        opts.sessionId ?? "session-x",
        opts.projectId,
        terminalRef,
        fitRef,
        containerRef,
      );
    },
    { initialProps: { fullscreen: opts.fullscreen } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  // Stub RAF as a setTimeout shim so we can drive resize attempts deterministically.
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      const id = setTimeout(() => cb(performance.now()), 0);
      return id as unknown as number;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => clearTimeout(id)));

  resizeTerminalMux.mockReset();
  useMuxMock.mockReturnValue({
    resizeTerminal: resizeTerminalMux,
    status: "connected",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useFullscreenResize", () => {
  it("does nothing when the mux is disconnected", async () => {
    useMuxMock.mockReturnValue({ resizeTerminal: resizeTerminalMux, status: "disconnected" });

    const terminal = makeTerminal();
    const fit = makeFit();
    const container = makeContainer();

    renderResize({ fullscreen: true, terminal, fit, container });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fit.fit).not.toHaveBeenCalled();
    expect(resizeTerminalMux).not.toHaveBeenCalled();
  });

  it("does nothing when the terminal ref is null", async () => {
    const fit = makeFit();
    const container = makeContainer();

    renderResize({ fullscreen: true, terminal: null, fit, container });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fit.fit).not.toHaveBeenCalled();
    expect(resizeTerminalMux).not.toHaveBeenCalled();
  });

  it("calls fit() and resizeTerminalMux once height stabilises", async () => {
    const terminal = makeTerminal();
    const fit = makeFit();
    const container = makeContainer(() => 400);

    renderResize({
      fullscreen: true,
      terminal,
      fit,
      container,
      sessionId: "abc",
      projectId: "proj-1",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(fit.fit).toHaveBeenCalled();
    expect(resizeTerminalMux).toHaveBeenCalledWith("abc", 80, 24, "proj-1");
  });

  it("re-runs resize via the backup 300ms timer after the RAF chain settles", async () => {
    // Backup timer doesn't bypass RAF — it resets state and starts a fresh
    // RAF chain so we get a second fit() pass. Assert exactly that: a fit
    // call fires from the initial chain, then the 300ms timer triggers
    // additional fit calls above that baseline.
    const terminal = makeTerminal();
    const fit = makeFit();
    const container = makeContainer(() => 400);

    renderResize({ fullscreen: true, terminal, fit, container });

    // Let the initial RAF chain settle first.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const baselineCalls = (fit.fit as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(baselineCalls).toBeGreaterThan(0);

    // Sit just under the backup window — no new calls should appear.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect((fit.fit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(baselineCalls);

    // Crossing 300ms must trigger the backup timer's re-run.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect((fit.fit as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      baselineCalls,
    );
  });

  it("re-runs the effect when fullscreen toggles", async () => {
    const terminal = makeTerminal();
    const fit = makeFit();
    const container = makeContainer(() => 400);

    const { rerender } = renderResize({
      fullscreen: false,
      terminal,
      fit,
      container,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const beforeToggle = (fit.fit as ReturnType<typeof vi.fn>).mock.calls.length;

    rerender({ fullscreen: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(
      (fit.fit as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(beforeToggle);
  });

  it("cleans up RAF and timers on unmount without firing further resizes", async () => {
    const terminal = makeTerminal();
    const fit = makeFit();
    const container = makeContainer(() => 400);

    const { unmount } = renderResize({ fullscreen: true, terminal, fit, container });

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fit.fit).not.toHaveBeenCalled();
    expect(resizeTerminalMux).not.toHaveBeenCalled();
  });
});
