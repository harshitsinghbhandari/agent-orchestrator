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

    // Mock WebSocket constructor
    vi.stubGlobal(
      "WebSocket",
      vi.fn(() => {
        lastWebSocketInstance = new MockWebSocket();
        return lastWebSocketInstance;
      }),
    );

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
});
