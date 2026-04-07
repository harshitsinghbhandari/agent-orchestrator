import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWakeWord } from "../useWakeWord";

// Mock SpeechRecognition class
function createMockSpeechRecognition() {
  const listeners: {
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onerror: ((event: { error: string; message: string }) => void) | null;
    onresult: ((event: MockSpeechRecognitionEvent) => void) | null;
  } = {
    onstart: null,
    onend: null,
    onerror: null,
    onresult: null,
  };

  const mockRecognition = {
    continuous: false,
    interimResults: false,
    lang: "",
    maxAlternatives: 1,
    // Note: start() and stop() don't auto-fire events - use _fireStart/_fireEnd manually
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    set onstart(handler: (() => void) | null) {
      listeners.onstart = handler;
    },
    set onend(handler: (() => void) | null) {
      listeners.onend = handler;
    },
    set onerror(handler: ((event: { error: string; message: string }) => void) | null) {
      listeners.onerror = handler;
    },
    set onresult(
      handler: ((event: MockSpeechRecognitionEvent) => void) | null,
    ) {
      listeners.onresult = handler;
    },
    // Test helpers - use these to manually trigger events
    _fireStart() {
      listeners.onstart?.();
    },
    _fireEnd() {
      listeners.onend?.();
    },
    _fireError(error: string, message = "") {
      listeners.onerror?.({ error, message });
    },
    _fireResult(transcript: string, isFinal = false) {
      const event = createMockResultEvent(transcript, isFinal);
      listeners.onresult?.(event);
    },
  };

  return mockRecognition;
}

interface MockSpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      length: number;
      isFinal: boolean;
      [index: number]: {
        transcript: string;
        confidence: number;
      };
    };
  };
}

function createMockResultEvent(transcript: string, isFinal: boolean): MockSpeechRecognitionEvent {
  return {
    resultIndex: 0,
    results: {
      length: 1,
      0: {
        length: 1,
        isFinal,
        0: {
          transcript,
          confidence: 0.9,
        },
      },
    },
  };
}

type MockRecognition = ReturnType<typeof createMockSpeechRecognition>;

describe("useWakeWord", () => {
  let mockRecognition: MockRecognition;

  beforeEach(() => {
    mockRecognition = createMockSpeechRecognition();

    // Mock window.SpeechRecognition
    Object.defineProperty(window, "SpeechRecognition", {
      writable: true,
      configurable: true,
      value: vi.fn(() => mockRecognition),
    });

    // Clear webkit fallback
    Object.defineProperty(window, "webkitSpeechRecognition", {
      writable: true,
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns isSupported=true when SpeechRecognition is available", () => {
    const { result } = renderHook(() => useWakeWord());
    expect(result.current.isSupported).toBe(true);
  });

  it("returns isSupported=false when SpeechRecognition is unavailable", () => {
    Object.defineProperty(window, "SpeechRecognition", {
      writable: true,
      configurable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useWakeWord());
    expect(result.current.isSupported).toBe(false);
  });

  it("uses webkitSpeechRecognition as fallback", () => {
    Object.defineProperty(window, "SpeechRecognition", {
      writable: true,
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      writable: true,
      configurable: true,
      value: vi.fn(() => mockRecognition),
    });

    const { result } = renderHook(() => useWakeWord());
    expect(result.current.isSupported).toBe(true);
  });

  it("starts in idle state", () => {
    const { result } = renderHook(() => useWakeWord());
    expect(result.current.state).toBe("idle");
  });

  it("transitions to listening state when start() is called", async () => {
    const { result } = renderHook(() => useWakeWord());

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    expect(result.current.state).toBe("listening");
    expect(mockRecognition.start).toHaveBeenCalled();
  });

  it("transitions to idle state when stop() is called", async () => {
    const { result } = renderHook(() => useWakeWord());

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    expect(result.current.state).toBe("listening");

    await act(async () => {
      result.current.stop();
      // stop() sets state directly, no need to wait
    });

    expect(result.current.state).toBe("idle");
    expect(mockRecognition.stop).toHaveBeenCalled();
  });

  it("transitions to paused state when pause() is called", async () => {
    const { result } = renderHook(() => useWakeWord());

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      result.current.pause();
    });

    expect(result.current.state).toBe("paused");
  });

  it("transitions back to listening when resume() is called from paused", async () => {
    const { result } = renderHook(() => useWakeWord());

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      result.current.pause();
    });

    await act(async () => {
      result.current.resume();
      mockRecognition._fireStart();
    });

    expect(result.current.state).toBe("listening");
  });

  it("detects default wake word 'ao'", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderHook(() => useWakeWord({ onWakeWord }));

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireResult("ao", true);
    });

    expect(onWakeWord).toHaveBeenCalledWith("ao", "ao");
    expect(result.current.state).toBe("detected");
  });

  it("detects 'hey ao' wake word", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderHook(() => useWakeWord({ onWakeWord }));

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireResult("hey ao", true);
    });

    expect(onWakeWord).toHaveBeenCalledWith("hey ao", "hey ao");
    expect(result.current.state).toBe("detected");
  });

  it("detects 'okay ao' wake word", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderHook(() => useWakeWord({ onWakeWord }));

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireResult("okay ao", true);
    });

    expect(onWakeWord).toHaveBeenCalledWith("okay ao", "okay ao");
  });

  it("detects wake word at end of longer phrase", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderHook(() => useWakeWord({ onWakeWord }));

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireResult("something something hey ao", true);
    });

    expect(onWakeWord).toHaveBeenCalledWith("something something hey ao", "hey ao");
  });

  it("detects wake word at start of phrase (command following wake word)", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderHook(() => useWakeWord({ onWakeWord }));

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireResult("hey ao what is the status", true);
    });

    expect(onWakeWord).toHaveBeenCalledWith("hey ao what is the status", "hey ao");
    expect(result.current.state).toBe("detected");
  });

  it("detects 'ao' at start of phrase", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderHook(() => useWakeWord({ onWakeWord }));

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireResult("ao check the ci status", true);
    });

    expect(onWakeWord).toHaveBeenCalledWith("ao check the ci status", "ao");
  });

  it("does not trigger on partial wake word", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderHook(() => useWakeWord({ onWakeWord }));

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireResult("hello", true);
    });

    expect(onWakeWord).not.toHaveBeenCalled();
    expect(result.current.state).toBe("listening");
  });

  it("uses custom wake words when provided", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderHook(() =>
      useWakeWord({
        wakeWords: ["computer", "jarvis"],
        onWakeWord,
      }),
    );

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    // Default wake word should not trigger
    await act(async () => {
      mockRecognition._fireResult("ao", true);
    });
    expect(onWakeWord).not.toHaveBeenCalled();

    // Custom wake word should trigger
    await act(async () => {
      mockRecognition._fireResult("jarvis", true);
    });
    expect(onWakeWord).toHaveBeenCalledWith("jarvis", "jarvis");
  });

  it("updates lastTranscript on speech results", async () => {
    const { result } = renderHook(() => useWakeWord());

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireResult("hello world", false);
    });

    expect(result.current.lastTranscript).toBe("hello world");
  });

  it("handles not-allowed error", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useWakeWord({ onError }));

    await act(async () => {
      result.current.start();
    });

    await act(async () => {
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireError("not-allowed", "Permission denied");
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("Microphone access denied");
    expect(onError).toHaveBeenCalledWith("Microphone access denied");
  });

  it("handles network error", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useWakeWord({ onError }));

    await act(async () => {
      result.current.start();
    });

    await act(async () => {
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireError("network", "Network error");
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("Network error - check connection");
    expect(onError).toHaveBeenCalledWith("Network error");
  });

  it("configures recognition with correct settings", async () => {
    const { result } = renderHook(() => useWakeWord({ lang: "es-ES" }));

    await act(async () => {
      result.current.start();
    });

    expect(mockRecognition.continuous).toBe(true);
    expect(mockRecognition.interimResults).toBe(true);
    expect(mockRecognition.lang).toBe("es-ES");
    expect(mockRecognition.maxAlternatives).toBe(3);
  });

  it("stops recognition on wake word detection for mic handoff", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderHook(() => useWakeWord({ onWakeWord }));

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireResult("ao", true);
    });

    expect(mockRecognition.stop).toHaveBeenCalled();
  });

  it("cleans up recognition on unmount", async () => {
    const { result, unmount } = renderHook(() => useWakeWord());

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    unmount();

    expect(mockRecognition.stop).toHaveBeenCalled();
  });

  it("sets error when starting on unsupported browser", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      writable: true,
      configurable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useWakeWord());

    await act(async () => {
      result.current.start();
    });

    expect(result.current.state).toBe("unsupported");
    expect(result.current.error).toBe("Speech recognition not supported in this browser");
  });

  it("handles case-insensitive wake word detection", async () => {
    const onWakeWord = vi.fn();
    const { result } = renderHook(() => useWakeWord({ onWakeWord }));

    await act(async () => {
      result.current.start();
      mockRecognition._fireStart();
    });

    await act(async () => {
      mockRecognition._fireResult("HEY AO", true);
    });

    expect(onWakeWord).toHaveBeenCalledWith("HEY AO", "hey ao");
  });

  describe("memory leak fixes", () => {
    it("clears restart timeout when stop() is called", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useWakeWord());

      await act(async () => {
        result.current.start();
        mockRecognition._fireStart();
      });

      // Trigger onend which schedules a restart timeout
      await act(async () => {
        mockRecognition._fireEnd();
      });

      // Stop before the timeout fires
      await act(async () => {
        result.current.stop();
      });

      // Advance timers - the restart should not happen because we called stop()
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // Recognition.start should only have been called once (initial start)
      expect(mockRecognition.start).toHaveBeenCalledTimes(1);
      expect(result.current.state).toBe("idle");

      vi.useRealTimers();
    });

    it("clears restart timeout when pause() is called", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useWakeWord());

      await act(async () => {
        result.current.start();
        mockRecognition._fireStart();
      });

      // Trigger onend which schedules a restart timeout
      await act(async () => {
        mockRecognition._fireEnd();
      });

      // Pause before the timeout fires
      await act(async () => {
        result.current.pause();
      });

      // Advance timers - the restart should not happen because we called pause()
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // Recognition.start should only have been called once (initial start)
      expect(mockRecognition.start).toHaveBeenCalledTimes(1);
      expect(result.current.state).toBe("paused");

      vi.useRealTimers();
    });

    it("clears restart timeout on unmount", async () => {
      vi.useFakeTimers();
      const { result, unmount } = renderHook(() => useWakeWord());

      await act(async () => {
        result.current.start();
        mockRecognition._fireStart();
      });

      // Trigger onend which schedules a restart timeout
      await act(async () => {
        mockRecognition._fireEnd();
      });

      // Unmount before the timeout fires
      unmount();

      // Advance timers - no errors should occur (timeout was cleared)
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // Recognition.start should only have been called once (initial start)
      expect(mockRecognition.start).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });
});
