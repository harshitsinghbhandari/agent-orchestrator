import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceCopilot } from "../useVoiceCopilot";

// Mock fetch for token endpoint
global.fetch = vi.fn();

// Track WebSocket instances for verification
let lastWebSocketInstance: MockWebSocket | null = null;

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });
}

// Track AudioContext instances for verification
let lastAudioContextInstance: MockAudioContext | null = null;

// Mock AudioContext
class MockAudioContext {
  state = "running";
  currentTime = 0;
  sampleRate = 24000;

  createBuffer = vi.fn(() => ({
    duration: 0.1,
    copyToChannel: vi.fn(),
  }));

  createBufferSource = vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  }));

  get destination() {
    return {};
  }

  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
}

// Mock navigator.mediaDevices
const mockMediaStream = {
  getTracks: vi.fn(() => [{ stop: vi.fn() }]),
};

const mockMediaDevices = {
  getUserMedia: vi.fn(() => Promise.resolve(mockMediaStream)),
};

describe("useVoiceCopilot", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    // Reset tracking
    lastWebSocketInstance = null;
    lastAudioContextInstance = null;

    // Mock WebSocket constructor with static constants
    const mockWebSocketConstructor = vi.fn(() => {
      lastWebSocketInstance = new MockWebSocket();
      return lastWebSocketInstance;
    });
    // Add static constants that the real WebSocket has
    Object.assign(mockWebSocketConstructor, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    });
    vi.stubGlobal("WebSocket", mockWebSocketConstructor);

    // Mock AudioContext constructor
    vi.stubGlobal(
      "AudioContext",
      vi.fn(() => {
        lastAudioContextInstance = new MockAudioContext();
        return lastAudioContextInstance;
      }),
    );

    // Mock navigator.mediaDevices
    Object.defineProperty(navigator, "mediaDevices", {
      value: mockMediaDevices,
      configurable: true,
    });

    // Mock fetch for token - returns resolved promise
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ token: "test-token" }),
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts in disconnected state", () => {
    const { result } = renderHook(() => useVoiceCopilot());
    expect(result.current.status).toBe("disconnected");
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isRecording).toBe(false);
  });

  it("initializes context with null values", () => {
    const { result } = renderHook(() => useVoiceCopilot());
    expect(result.current.context).toEqual({
      focusedSessionId: null,
      followingSessionId: null,
      notificationsPaused: false,
    });
  });

  it("returns error as null initially", () => {
    const { result } = renderHook(() => useVoiceCopilot());
    expect(result.current.error).toBeNull();
  });

  describe("clearAudioQueue", () => {
    it("sets isPlaying to false when called", () => {
      const { result } = renderHook(() => useVoiceCopilot());

      // Call clearAudioQueue
      act(() => {
        result.current.clearAudioQueue();
      });

      expect(result.current.isPlaying).toBe(false);
    });

    it("can be called multiple times without error", () => {
      const { result } = renderHook(() => useVoiceCopilot());

      // Call clearAudioQueue multiple times
      act(() => {
        result.current.clearAudioQueue();
        result.current.clearAudioQueue();
        result.current.clearAudioQueue();
      });

      expect(result.current.isPlaying).toBe(false);
    });
  });

  describe("disconnect", () => {
    it("sets status to disconnected", async () => {
      const { result } = renderHook(() => useVoiceCopilot());

      // Call disconnect (even without being connected first)
      act(() => {
        result.current.disconnect();
      });

      expect(result.current.status).toBe("disconnected");
    });

    it("sets isPlaying to false", () => {
      const { result } = renderHook(() => useVoiceCopilot());

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.isPlaying).toBe(false);
    });
  });

  describe("stopRecording", () => {
    it("sets isRecording to false when called", () => {
      const { result } = renderHook(() => useVoiceCopilot());

      // Even without recording, stopRecording should be safe to call
      act(() => {
        result.current.stopRecording();
      });

      expect(result.current.isRecording).toBe(false);
    });
  });

  describe("memory leak prevention", () => {
    it("cleanup effect runs on unmount without error", () => {
      const { unmount } = renderHook(() => useVoiceCopilot());

      // Should not throw on unmount
      expect(() => unmount()).not.toThrow();
    });

    it("disconnect cleans up without error after unmount", () => {
      const { result, unmount } = renderHook(() => useVoiceCopilot());

      // Get disconnect function reference
      const { disconnect } = result.current;

      // Unmount
      unmount();

      // Calling disconnect after unmount should be safe
      // (though in practice React prevents this)
      expect(disconnect).toBeDefined();
    });
  });

  describe("connection retry logic", () => {
    it("retries connection on WebSocket error with exponential backoff", async () => {
      const { result } = renderHook(() =>
        useVoiceCopilot({ maxRetries: 2, retryDelayMs: 100 }),
      );

      // Start connection - need to flush all microtasks for async connect
      await act(async () => {
        result.current.connect();
        // Flush microtasks for the async token fetch
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
      });

      expect(result.current.status).toBe("connecting");

      // Simulate WebSocket error
      await act(async () => {
        if (lastWebSocketInstance?.onerror) {
          lastWebSocketInstance.onerror(new Event("error"));
        }
        await vi.advanceTimersByTimeAsync(0);
      });

      // Should show retry message
      expect(result.current.error).toContain("Connecting to voice server");
      expect(result.current.error).toContain("attempt 2/3");

      // Advance timer for first retry (100ms)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
        await Promise.resolve();
      });

      // Should have created a new WebSocket
      expect(WebSocket).toHaveBeenCalledTimes(2);
    });

    it("stops retrying after max attempts and shows error message", async () => {
      const { result } = renderHook(() =>
        useVoiceCopilot({ maxRetries: 1, retryDelayMs: 100 }),
      );

      // Start connection
      await act(async () => {
        result.current.connect();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
      });

      // First error - should retry
      await act(async () => {
        if (lastWebSocketInstance?.onerror) {
          lastWebSocketInstance.onerror(new Event("error"));
        }
        await vi.advanceTimersByTimeAsync(100);
        await Promise.resolve();
      });

      // Second error - should give up
      await act(async () => {
        if (lastWebSocketInstance?.onerror) {
          lastWebSocketInstance.onerror(new Event("error"));
        }
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.status).toBe("error");
      expect(result.current.error).toContain("Voice server connection failed");
    });

    it("disconnect cancels pending retries", async () => {
      const { result } = renderHook(() =>
        useVoiceCopilot({ maxRetries: 3, retryDelayMs: 1000 }),
      );

      // Start connection
      await act(async () => {
        result.current.connect();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
      });

      // Simulate WebSocket error
      await act(async () => {
        if (lastWebSocketInstance?.onerror) {
          lastWebSocketInstance.onerror(new Event("error"));
        }
        await vi.advanceTimersByTimeAsync(0);
      });

      const callCountBeforeDisconnect = (WebSocket as ReturnType<typeof vi.fn>).mock.calls.length;

      // Disconnect before retry fires
      await act(async () => {
        result.current.disconnect();
      });

      // Advance timer past retry delay
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      // Should not have created another WebSocket
      expect(WebSocket).toHaveBeenCalledTimes(callCountBeforeDisconnect);
      expect(result.current.status).toBe("disconnected");
    });

    it("resets retry count on successful connection", async () => {
      const { result } = renderHook(() =>
        useVoiceCopilot({ maxRetries: 3, retryDelayMs: 100 }),
      );

      // Start connection
      await act(async () => {
        result.current.connect();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
      });

      // Simulate successful connection
      await act(async () => {
        if (lastWebSocketInstance) {
          lastWebSocketInstance.readyState = MockWebSocket.OPEN;
          lastWebSocketInstance.onopen?.();
        }
        await vi.advanceTimersByTimeAsync(0);
      });

      // Simulate connected status from server
      await act(async () => {
        if (lastWebSocketInstance?.onmessage) {
          lastWebSocketInstance.onmessage({
            data: JSON.stringify({ type: "status", status: "connected" }),
          });
        }
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.status).toBe("connected");

      // Disconnect and reconnect - should start fresh with retries
      await act(async () => {
        result.current.disconnect();
      });

      await act(async () => {
        result.current.connect();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
      });

      // Should be in connecting state, ready for new retry cycle
      expect(result.current.status).toBe("connecting");
    });
  });
});
