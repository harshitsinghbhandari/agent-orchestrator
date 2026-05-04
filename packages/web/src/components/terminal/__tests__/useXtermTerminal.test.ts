import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef } from "react";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be set up before module evaluation
// ---------------------------------------------------------------------------
const {
  subscribeTerminalMock,
  writeTerminalMock,
  resizeTerminalMock,
  openTerminalMock,
  closeTerminalMock,
  attachTouchScrollMock,
  registerClipboardHandlersMock,
  resolveMonoFontFamilyMock,
  buildTerminalThemesMock,
  useThemeMock,
  useMuxMock,
} = vi.hoisted(() => ({
  subscribeTerminalMock: vi.fn(() => vi.fn()),
  writeTerminalMock: vi.fn(),
  resizeTerminalMock: vi.fn(),
  openTerminalMock: vi.fn(),
  closeTerminalMock: vi.fn(),
  attachTouchScrollMock: vi.fn(() => vi.fn()),
  registerClipboardHandlersMock: vi.fn(),
  resolveMonoFontFamilyMock: vi.fn(() => "MockMono"),
  buildTerminalThemesMock: vi.fn(() => ({
    dark: { background: "#000" },
    light: { background: "#fff" },
  })),
  useThemeMock: vi.fn(() => ({ resolvedTheme: "dark" })),
  useMuxMock: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: useThemeMock,
}));

vi.mock("@/hooks/useMux", () => ({
  useMux: useMuxMock,
}));

vi.mock("@/lib/terminal-touch-scroll", () => ({
  attachTouchScroll: attachTouchScrollMock,
}));

vi.mock("../terminal-clipboard", () => ({
  registerClipboardHandlers: registerClipboardHandlersMock,
}));

vi.mock("../terminal-font", () => ({
  FONT_SIZE_KEY: "terminal-font-size",
  resolveMonoFontFamily: resolveMonoFontFamilyMock,
}));

vi.mock("../terminal-themes", () => ({
  buildTerminalThemes: buildTerminalThemesMock,
}));

// ---------------------------------------------------------------------------
// xterm dynamic-import mocks — the hook does Promise.all([import('@xterm/...')])
// Each MockTerminal exposes itself via the static `last` slot so tests can
// drive its state (buffer.active.type, options, etc.) after the hook
// constructs it.
// ---------------------------------------------------------------------------

class MockTerminal {
  static last: MockTerminal | null = null;
  options: Record<string, unknown> = {};
  cols = 80;
  rows = 24;
  buffer = { active: { type: "normal" as "normal" | "alternate", viewportY: 0, length: 24 } };

  constructor(options: Record<string, unknown>) {
    this.options = { ...options };
    MockTerminal.last = this;
  }
  loadAddon = vi.fn();
  open = vi.fn();
  focus = vi.fn();
  write = vi.fn();
  refresh = vi.fn();
  scrollToBottom = vi.fn();
  hasSelection = vi.fn(() => false);
  getSelection = vi.fn(() => "");
  clearSelection = vi.fn();
  clearTextureAtlas = vi.fn();
  dispose = vi.fn();
  onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
  onScroll = vi.fn(() => ({ dispose: vi.fn() }));
  onData = vi.fn(() => ({ dispose: vi.fn() }));
}

class MockFitAddon {
  fit = vi.fn();
}

class MockWebLinksAddon {
  activate = vi.fn();
  dispose = vi.fn();
}

vi.mock("@xterm/xterm", () => ({ Terminal: MockTerminal }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}), { virtual: true } as never);
vi.mock("@xterm/addon-fit", () => ({ FitAddon: MockFitAddon }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: MockWebLinksAddon }));

import { useXtermTerminal, type UseXtermTerminalOptions } from "../useXtermTerminal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const defaultOptions: UseXtermTerminalOptions = {
  appearance: "theme",
  variant: "agent",
  fontSize: 14,
  autoFocus: false,
};

function renderXterm<P extends UseXtermTerminalOptions = UseXtermTerminalOptions>(
  sessionId: string,
  options: P = defaultOptions as P,
  attached = true,
) {
  let lastResult: ReturnType<typeof useXtermTerminal> | undefined;
  const utils = renderHook(
    ({ opts }: { opts: P }) => {
      const ref = useRef<HTMLDivElement | null>(
        attached ? document.createElement("div") : null,
      );
      const result = useXtermTerminal(ref, sessionId, opts);
      lastResult = result;
      return { result, ref };
    },
    { initialProps: { opts: options } },
  );
  return { ...utils, getResult: () => lastResult };
}

beforeEach(() => {
  MockTerminal.last = null;

  subscribeTerminalMock.mockReset().mockImplementation(() => vi.fn());
  writeTerminalMock.mockReset();
  resizeTerminalMock.mockReset();
  openTerminalMock.mockReset();
  closeTerminalMock.mockReset();
  attachTouchScrollMock.mockReset().mockImplementation(() => vi.fn());
  registerClipboardHandlersMock.mockReset();
  resolveMonoFontFamilyMock.mockReset().mockReturnValue("MockMono");
  buildTerminalThemesMock.mockReset().mockReturnValue({
    dark: { background: "#000" },
    light: { background: "#fff" },
  });
  useThemeMock.mockReset().mockReturnValue({ resolvedTheme: "dark" });
  useMuxMock.mockReset().mockReturnValue({
    subscribeTerminal: subscribeTerminalMock,
    writeTerminal: writeTerminalMock,
    resizeTerminal: resizeTerminalMock,
    openTerminal: openTerminalMock,
    closeTerminal: closeTerminalMock,
    status: "connected",
  });

  // jsdom lacks document.fonts; the hook awaits `document.fonts.ready`.
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });

  // Stub ResizeObserver — jsdom doesn't ship one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useXtermTerminal", () => {
  it("does no work when the terminal element ref is null", async () => {
    renderXterm("session-x", defaultOptions, false);
    await act(async () => {
      await Promise.resolve();
    });

    expect(openTerminalMock).not.toHaveBeenCalled();
    expect(subscribeTerminalMock).not.toHaveBeenCalled();
  });

  it("returns initial state synchronously before xterm finishes loading", () => {
    const { getResult } = renderXterm("s1");
    const result = getResult();
    expect(result?.error).toBeNull();
    expect(result?.followOutput).toBe(true);
    expect(result?.muxStatus).toBe("connected");
    expect(typeof result?.scrollToLatest).toBe("function");
  });

  it("opens the mux terminal channel and subscribes once xterm has loaded", async () => {
    renderXterm("session-x", { ...defaultOptions, projectId: "proj-1" });

    await waitFor(() => {
      expect(openTerminalMock).toHaveBeenCalledWith("session-x", "proj-1", undefined);
    });

    expect(subscribeTerminalMock).toHaveBeenCalledWith(
      "session-x",
      expect.any(Function),
      "proj-1",
    );
    expect(registerClipboardHandlersMock).toHaveBeenCalled();
  });

  it("forwards tmuxName when provided to openTerminal", async () => {
    renderXterm("session-x", { ...defaultOptions, tmuxName: "tmux-target" });

    await waitFor(() => {
      expect(openTerminalMock).toHaveBeenCalledWith("session-x", undefined, "tmux-target");
    });
  });

  it("disposes the terminal and closes the mux channel on unmount", async () => {
    const { unmount } = renderXterm("session-x");

    await waitFor(() => {
      expect(openTerminalMock).toHaveBeenCalled();
    });

    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(closeTerminalMock).toHaveBeenCalledWith("session-x", undefined);
    expect(MockTerminal.last?.dispose).toHaveBeenCalled();
  });

  describe("scrollToLatest", () => {
    it("calls terminal.scrollToBottom when in the normal buffer", async () => {
      const { getResult } = renderXterm("session-x");

      await waitFor(() => {
        expect(MockTerminal.last).not.toBeNull();
      });

      // Default buffer.active.type is "normal".
      act(() => {
        getResult()?.scrollToLatest();
      });

      expect(MockTerminal.last?.scrollToBottom).toHaveBeenCalled();
      expect(writeTerminalMock).not.toHaveBeenCalled();
    });

    it("sends 'q' via writeTerminal when in the alternate buffer", async () => {
      const { getResult } = renderXterm("session-x", {
        ...defaultOptions,
        projectId: "proj-1",
      });

      await waitFor(() => {
        expect(MockTerminal.last).not.toBeNull();
      });

      // Flip the mock terminal into alternate-buffer mode (tmux/vim copy-mode).
      MockTerminal.last!.buffer.active.type = "alternate";

      act(() => {
        getResult()?.scrollToLatest();
      });

      expect(writeTerminalMock).toHaveBeenCalledWith("session-x", "q", "proj-1");
      expect(MockTerminal.last?.scrollToBottom).not.toHaveBeenCalled();
    });

    it("flips followOutput back to true after manual scroll", async () => {
      const { getResult } = renderXterm("session-x");

      await waitFor(() => {
        expect(MockTerminal.last).not.toBeNull();
      });

      act(() => {
        getResult()?.scrollToLatest();
      });

      expect(getResult()?.followOutput).toBe(true);
    });
  });

  describe("live theme switching", () => {
    it("swaps to the dark theme when appearance is 'dark'", async () => {
      const { rerender } = renderXterm("session-x", { ...defaultOptions });

      await waitFor(() => {
        expect(MockTerminal.last).not.toBeNull();
      });

      // Light variant initially (resolvedTheme=dark, but appearance=theme — dark wins anyway).
      // Force a light->dark flip via appearance change.
      useThemeMock.mockReturnValue({ resolvedTheme: "light" });
      rerender({ opts: { ...defaultOptions, appearance: "theme" } });

      expect(MockTerminal.last?.options.theme).toEqual({ background: "#fff" });
      expect(MockTerminal.last?.options.minimumContrastRatio).toBe(7);

      rerender({ opts: { ...defaultOptions, appearance: "dark" } });

      expect(MockTerminal.last?.options.theme).toEqual({ background: "#000" });
      expect(MockTerminal.last?.options.minimumContrastRatio).toBe(1);
    });
  });

  describe("font-size effect", () => {
    it("mutates terminal.options.fontSize and persists to localStorage", async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

      const { rerender } = renderXterm("session-x", { ...defaultOptions, fontSize: 14 });

      await waitFor(() => {
        expect(MockTerminal.last).not.toBeNull();
      });

      rerender({ opts: { ...defaultOptions, fontSize: 18 } });

      expect(MockTerminal.last?.options.fontSize).toBe(18);
      expect(setItemSpy).toHaveBeenCalledWith("terminal-font-size", "18");
    });

    it("swallows localStorage errors without breaking the resize", async () => {
      const setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("QuotaExceededError");
        });

      const { rerender } = renderXterm("session-x", { ...defaultOptions, fontSize: 14 });

      await waitFor(() => {
        expect(MockTerminal.last).not.toBeNull();
      });

      const fitMock = (MockTerminal.last!.loadAddon as Mock).mock.calls[0]?.[0] as MockFitAddon;
      const fitCallsBefore = (fitMock.fit as Mock).mock.calls.length;

      expect(() =>
        rerender({ opts: { ...defaultOptions, fontSize: 20 } }),
      ).not.toThrow();

      // The font-size effect calls fit.fit() after attempting localStorage write.
      expect((fitMock.fit as Mock).mock.calls.length).toBeGreaterThan(fitCallsBefore);
      expect(setItemSpy).toHaveBeenCalled();
    });
  });

  describe("mux-status reconnect resize", () => {
    it("re-fits and re-sends dimensions when status flips back to connected", async () => {
      // Start disconnected so the reconnect-effect's guard skips on mount.
      useMuxMock.mockReturnValue({
        subscribeTerminal: subscribeTerminalMock,
        writeTerminal: writeTerminalMock,
        resizeTerminal: resizeTerminalMock,
        openTerminal: openTerminalMock,
        closeTerminal: closeTerminalMock,
        status: "disconnected",
      });

      const { rerender } = renderXterm("session-x", { ...defaultOptions });

      await waitFor(() => {
        expect(MockTerminal.last).not.toBeNull();
      });

      const fitMock = (MockTerminal.last!.loadAddon as Mock).mock.calls[0]?.[0] as MockFitAddon;
      resizeTerminalMock.mockClear();
      (fitMock.fit as Mock).mockClear();

      // Simulate reconnection.
      useMuxMock.mockReturnValue({
        subscribeTerminal: subscribeTerminalMock,
        writeTerminal: writeTerminalMock,
        resizeTerminal: resizeTerminalMock,
        openTerminal: openTerminalMock,
        closeTerminal: closeTerminalMock,
        status: "connected",
      });
      rerender({ opts: { ...defaultOptions } });

      expect(fitMock.fit).toHaveBeenCalled();
      expect(resizeTerminalMock).toHaveBeenCalledWith("session-x", 80, 24, undefined);
    });
  });
});
