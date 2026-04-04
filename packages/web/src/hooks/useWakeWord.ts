/**
 * Wake word detection hook using Web Speech API.
 *
 * Provides hands-free voice activation by continuously listening for
 * wake words ("AO", "Hey AO", "Okay AO") and triggering a callback
 * when detected.
 *
 * Uses SpeechRecognition in continuous mode for low-latency detection.
 * Automatically handles browser prefixes (webkit) and restarts on end.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SpeechRecognition,
  SpeechRecognitionConstructor,
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
} from "@/types/speech-recognition";

/**
 * Wake word detection states
 */
export type WakeWordState =
  | "idle" // Not started
  | "listening" // Actively listening for wake word
  | "detected" // Wake word was detected (transient state)
  | "paused" // Temporarily paused (e.g., during playback)
  | "error" // Error occurred
  | "unsupported"; // Browser doesn't support SpeechRecognition

/**
 * Wake word hook configuration options
 */
interface UseWakeWordOptions {
  /** Wake words to listen for (default: ["ao", "hey ao", "okay ao"]) */
  wakeWords?: string[];
  /** Callback when wake word is detected */
  onWakeWord?: (transcript: string, matchedWord: string) => void;
  /** Callback when error occurs */
  onError?: (error: string) => void;
  /** Language for recognition (default: "en-US") */
  lang?: string;
}

/**
 * Wake word hook return type
 */
interface UseWakeWordReturn {
  /** Current wake word detection state */
  state: WakeWordState;
  /** Whether SpeechRecognition is supported */
  isSupported: boolean;
  /** Start listening for wake word */
  start: () => void;
  /** Stop listening for wake word */
  stop: () => void;
  /** Resume listening after pause */
  resume: () => void;
  /** Pause listening (for mic handoff) */
  pause: () => void;
  /** Last transcript heard */
  lastTranscript: string | null;
  /** Last error message */
  error: string | null;
}

/**
 * Default wake words that trigger activation
 */
const DEFAULT_WAKE_WORDS = ["ao", "hey ao", "okay ao", "a o", "hey a o", "okay a o"];

/**
 * Get the SpeechRecognition constructor (with webkit prefix fallback)
 */
function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/**
 * Check if any wake word is present in the transcript
 * Returns the longest matching wake word to avoid partial matches
 */
function findWakeWord(transcript: string, wakeWords: string[]): string | null {
  const normalizedTranscript = transcript.toLowerCase().trim();

  // Sort by length descending to match longer phrases first (e.g., "hey ao" before "ao")
  const sortedWakeWords = [...wakeWords].sort((a, b) => b.length - a.length);

  for (const word of sortedWakeWords) {
    // Check if wake word appears at the end of transcript (most recent speech)
    // or if the transcript is just the wake word
    if (
      normalizedTranscript === word ||
      normalizedTranscript.endsWith(word) ||
      normalizedTranscript.endsWith(` ${word}`)
    ) {
      return word;
    }
  }
  return null;
}

/**
 * Hook for wake word detection using Web Speech API
 */
export function useWakeWord(options: UseWakeWordOptions = {}): UseWakeWordReturn {
  const {
    wakeWords = DEFAULT_WAKE_WORDS,
    onWakeWord,
    onError,
    lang = "en-US",
  } = options;

  const [state, setState] = useState<WakeWordState>("idle");
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldRestartRef = useRef(false);
  const onWakeWordRef = useRef(onWakeWord);
  const onErrorRef = useRef(onError);
  const stateRef = useRef(state);
  // Memory leak fix: Track restart timeout for cleanup
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keep refs updated
  useEffect(() => {
    onWakeWordRef.current = onWakeWord;
    onErrorRef.current = onError;
  }, [onWakeWord, onError]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Check browser support
  const isSupported = typeof window !== "undefined" && getSpeechRecognition() !== null;

  /**
   * Initialize SpeechRecognition instance
   */
  const initRecognition = useCallback(() => {
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) {
      setState("unsupported");
      return null;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      console.log("[wake-word] Recognition started");
      setState("listening");
      setError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Get the most recent result
      const lastResultIndex = event.results.length - 1;
      const result = event.results[lastResultIndex];

      // Check all alternatives for wake word
      for (let i = 0; i < result.length; i++) {
        const transcript = result[i].transcript;
        setLastTranscript(transcript);

        const matchedWord = findWakeWord(transcript, wakeWords);
        if (matchedWord) {
          console.log(`[wake-word] Detected: "${matchedWord}" in "${transcript}"`);
          setState("detected");
          shouldRestartRef.current = false;

          // Stop recognition for mic handoff
          recognition.stop();

          // Notify callback
          onWakeWordRef.current?.(transcript, matchedWord);
          return;
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("[wake-word] Error:", event.error, event.message);

      // Handle specific errors
      switch (event.error) {
        case "not-allowed":
          setError("Microphone access denied");
          setState("error");
          onErrorRef.current?.("Microphone access denied");
          break;
        case "no-speech":
          // This is normal - just restart if we should be listening
          if (shouldRestartRef.current && stateRef.current === "listening") {
            recognition.start();
          }
          break;
        case "network":
          setError("Network error - check connection");
          setState("error");
          onErrorRef.current?.("Network error");
          break;
        case "aborted":
          // User aborted - don't restart
          break;
        default:
          setError(`Recognition error: ${event.error}`);
          onErrorRef.current?.(`Recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      console.log("[wake-word] Recognition ended, shouldRestart:", shouldRestartRef.current);

      // Auto-restart if we should still be listening
      if (shouldRestartRef.current && stateRef.current === "listening") {
        try {
          // Memory leak fix: Clear any existing restart timeout before creating new one
          if (restartTimeoutRef.current) {
            clearTimeout(restartTimeoutRef.current);
          }
          // Small delay to prevent rapid restart loops
          restartTimeoutRef.current = setTimeout(() => {
            restartTimeoutRef.current = null;
            if (shouldRestartRef.current && recognitionRef.current) {
              recognitionRef.current.start();
            }
          }, 100);
        } catch (err) {
          console.error("[wake-word] Failed to restart:", err);
        }
      }
    };

    return recognition;
  }, [lang, wakeWords]);

  /**
   * Start listening for wake word
   */
  const start = useCallback(() => {
    if (!isSupported) {
      setState("unsupported");
      setError("Speech recognition not supported in this browser");
      return;
    }

    // Create new recognition instance if needed
    if (!recognitionRef.current) {
      recognitionRef.current = initRecognition();
    }

    if (recognitionRef.current) {
      shouldRestartRef.current = true;
      setError(null);
      try {
        recognitionRef.current.start();
      } catch (err) {
        // May throw if already started
        console.warn("[wake-word] Start failed (may already be running):", err);
      }
    }
  }, [isSupported, initRecognition]);

  /**
   * Stop listening for wake word
   * Memory leak fix: Also clears restart timeout
   */
  const stop = useCallback(() => {
    shouldRestartRef.current = false;
    // Memory leak fix: Clear restart timeout
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.warn("[wake-word] Stop failed:", err);
      }
    }
    setState("idle");
  }, []);

  /**
   * Pause listening (for mic handoff to Gemini)
   * Memory leak fix: Also clears restart timeout
   */
  const pause = useCallback(() => {
    shouldRestartRef.current = false;
    // Memory leak fix: Clear restart timeout
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.warn("[wake-word] Pause failed:", err);
      }
    }
    setState("paused");
  }, []);

  /**
   * Resume listening after pause
   */
  const resume = useCallback(() => {
    if (!isSupported) return;

    // Create new recognition instance if needed
    if (!recognitionRef.current) {
      recognitionRef.current = initRecognition();
    }

    if (recognitionRef.current) {
      shouldRestartRef.current = true;
      setError(null);
      setState("listening");
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.warn("[wake-word] Resume failed:", err);
      }
    }
  }, [isSupported, initRecognition]);

  // Handle tab visibility changes
  useEffect(() => {
    if (!isSupported) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden - SpeechRecognition will stop automatically
        // We just mark that we shouldn't restart
        if (stateRef.current === "listening") {
          shouldRestartRef.current = false;
        }
      } else {
        // Tab visible again - restart if we were listening
        if (stateRef.current === "listening" || stateRef.current === "paused") {
          // Don't auto-restart if paused - user must explicitly resume
          if (stateRef.current === "listening") {
            shouldRestartRef.current = true;
            resume();
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isSupported, resume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      // Memory leak fix: Clear restart timeout
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    state,
    isSupported,
    start,
    stop,
    pause,
    resume,
    lastTranscript,
    error,
  };
}
