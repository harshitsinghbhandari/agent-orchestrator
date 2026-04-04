"use client";

/**
 * Voice Copilot panel component.
 *
 * V3 Features:
 * - Toggle button to enable/disable voice
 * - Connection status indicator
 * - Push-to-talk button with recording indicator
 * - Spacebar shortcut for push-to-talk
 * - Focus/follow mode display
 * - Query input for testing
 *
 * V5 Features:
 * - Hands-free mode with wake word detection ("Hey AO")
 * - Auto-activates Gemini streaming on wake word
 * - Resumes wake word listening after response playback
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useVoiceCopilot, type VoiceStatus, type VoiceContext } from "@/hooks/useVoiceCopilot";
import { useWakeWord } from "@/hooks/useWakeWord";

/**
 * Get status indicator color based on connection state
 */
function getStatusColor(status: VoiceStatus): string {
  switch (status) {
    case "connected":
      return "var(--color-status-working)";
    case "connecting":
      return "var(--color-status-review)";
    case "error":
      return "var(--color-status-error)";
    case "disconnected":
    default:
      return "var(--color-text-tertiary)";
  }
}

/**
 * Get status label for display
 */
function getStatusLabel(status: VoiceStatus): string {
  switch (status) {
    case "connected":
      return "Voice active";
    case "connecting":
      return "Connecting...";
    case "error":
      return "Error";
    case "disconnected":
    default:
      return "Voice off";
  }
}

/**
 * Microphone icon SVG
 */
function MicrophoneIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

/**
 * Speaker icon SVG (for playing state)
 */
function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

/**
 * Voice panel props
 */
interface VoicePanelProps {
  /** Initial expanded state */
  defaultExpanded?: boolean;
}

/**
 * V4: Get display label for focused/following session + paused state
 */
function getContextLabel(context: VoiceContext): string | null {
  const parts: string[] = [];

  if (context.notificationsPaused) {
    parts.push("Notifications paused");
  }
  if (context.followingSessionId) {
    parts.push(`Following ${context.followingSessionId}`);
  } else if (context.focusedSessionId) {
    parts.push(`Focused on ${context.focusedSessionId}`);
  }

  return parts.length > 0 ? parts.join(" • ") : null;
}

/**
 * V4: Mute icon SVG
 */
function MuteIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

/**
 * V5: Headphones icon SVG for hands-free mode
 */
function HeadphonesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

/**
 * V5: Mic handoff delay (ms) to allow SpeechRecognition to release mic
 */
const MIC_HANDOFF_DELAY = 150;

/**
 * V5: Resume delay (ms) after playback completes before restarting wake word
 */
const RESUME_DELAY = 500;

/**
 * Voice Copilot panel component
 */
export function VoicePanel({ defaultExpanded = false }: VoicePanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [queryText, setQueryText] = useState("");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [voiceContext, setVoiceContext] = useState<VoiceContext>({
    focusedSessionId: null,
    followingSessionId: null,
    notificationsPaused: false,
  });

  // V5: Hands-free mode state
  const [handsFreeModeEnabled, setHandsFreeModeEnabled] = useState(false);
  const [wakeWordFlash, setWakeWordFlash] = useState(false);
  const resumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Memory leak fix: Track flash timeout for cleanup
  const flashTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // V5: Callback to resume wake word listening after playback
  // Memory leak fix: Clear existing timeout before creating new one
  const handlePlaybackComplete = useCallback(() => {
    if (handsFreeModeEnabled) {
      // Clear any existing resume timeout to prevent duplicates
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
      resumeTimeoutRef.current = setTimeout(() => {
        resumeTimeoutRef.current = null;
        resumeWakeWord();
      }, RESUME_DELAY);
    }
  }, [handsFreeModeEnabled]);

  const {
    status,
    isPlaying,
    isRecording,
    connect,
    disconnect,
    sendQuery,
    startRecording,
    stopRecording,
    error,
    context,
  } = useVoiceCopilot({
    onText: (text) => {
      setTranscript((prev) => [...prev.slice(-4), text]);
    },
    onError: (err) => {
      setTranscript((prev) => [...prev.slice(-4), `Error: ${err}`]);
    },
    onAction: (action) => {
      if (action.type === "send_message") {
        const msg = action.success
          ? `✓ Message sent to ${action.sessionId}`
          : `✗ Failed to send: ${action.error}`;
        setTranscript((prev) => [...prev.slice(-4), msg]);
      } else if (action.type === "merge_pr") {
        const msg = action.success
          ? `✓ PR #${action.prNumber} merged for ${action.sessionId}`
          : `✗ Failed to merge PR #${action.prNumber}: ${action.error}`;
        setTranscript((prev) => [...prev.slice(-4), msg]);
      }
    },
    onContextChange: (newContext) => {
      setVoiceContext(newContext);
    },
    onPlaybackComplete: handlePlaybackComplete,
  });

  // Memory leak fix: Track mic handoff timeout for cleanup
  const micHandoffTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // V5: Wake word detection hook
  const {
    state: wakeWordState,
    isSupported: isWakeWordSupported,
    start: startWakeWord,
    stop: stopWakeWord,
    pause: pauseWakeWord,
    resume: resumeWakeWord,
    error: wakeWordError,
  } = useWakeWord({
    onWakeWord: (wakeTranscript, matchedWord) => {
      console.log(`[voice-panel] Wake word detected: "${matchedWord}"`);
      // Flash animation with tracked timeout
      setWakeWordFlash(true);
      // Memory leak fix: Clear existing flash timeout before creating new one
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
      flashTimeoutRef.current = setTimeout(() => {
        flashTimeoutRef.current = null;
        setWakeWordFlash(false);
      }, 300);

      // Pause wake word listening and start recording after mic handoff delay
      pauseWakeWord();
      // Memory leak fix: Clear existing handoff timeout before creating new one
      if (micHandoffTimeoutRef.current) {
        clearTimeout(micHandoffTimeoutRef.current);
      }
      micHandoffTimeoutRef.current = setTimeout(() => {
        micHandoffTimeoutRef.current = null;
        startRecording();
      }, MIC_HANDOFF_DELAY);
    },
    onError: (err) => {
      setTranscript((prev) => [...prev.slice(-4), `Wake word error: ${err}`]);
    },
  });

  // Keep voiceContext in sync with hook context
  useEffect(() => {
    setVoiceContext(context);
  }, [context]);

  const isConnected = status === "connected";

  const handleToggle = useCallback(() => {
    if (isConnected) {
      disconnect();
    } else {
      connect();
    }
  }, [isConnected, connect, disconnect]);

  const handleSubmitQuery = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (queryText.trim() && isConnected) {
        setTranscript((prev) => [...prev.slice(-4), `You: ${queryText}`]);
        sendQuery(queryText);
        setQueryText("");
      }
    },
    [queryText, isConnected, sendQuery],
  );

  // V3: Push-to-talk with mouse
  const handlePushToTalkStart = useCallback(() => {
    if (isConnected && !isRecording) {
      startRecording();
    }
  }, [isConnected, isRecording, startRecording]);

  const handlePushToTalkEnd = useCallback(() => {
    if (isRecording) {
      stopRecording();
    }
  }, [isRecording, stopRecording]);

  // V3: Spacebar shortcut for push-to-talk
  useEffect(() => {
    if (!isConnected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      // Space key for push-to-talk
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        if (!isRecording) {
          startRecording();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (isRecording) {
          stopRecording();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isConnected, isRecording, startRecording, stopRecording]);

  // V5: Handle hands-free mode toggle
  // Memory leak fix: Clear all related timeouts when disabling
  const handleHandsFreeToggle = useCallback(() => {
    const newEnabled = !handsFreeModeEnabled;
    setHandsFreeModeEnabled(newEnabled);

    if (newEnabled) {
      // Start wake word listening when enabled
      startWakeWord();
    } else {
      // Stop wake word listening when disabled
      stopWakeWord();
      // Memory leak fix: Clear all pending timeouts
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
        resumeTimeoutRef.current = null;
      }
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
        flashTimeoutRef.current = null;
      }
      if (micHandoffTimeoutRef.current) {
        clearTimeout(micHandoffTimeoutRef.current);
        micHandoffTimeoutRef.current = null;
      }
    }
  }, [handsFreeModeEnabled, startWakeWord, stopWakeWord]);

  // V5: Pause wake word during recording or playback
  useEffect(() => {
    if (!handsFreeModeEnabled) return;

    if (isRecording || isPlaying) {
      // Pause wake word while recording or playing
      pauseWakeWord();
    }
  }, [handsFreeModeEnabled, isRecording, isPlaying, pauseWakeWord]);

  // V5: Stop wake word when disconnecting
  useEffect(() => {
    if (!isConnected && handsFreeModeEnabled) {
      stopWakeWord();
      setHandsFreeModeEnabled(false);
    }
  }, [isConnected, handsFreeModeEnabled, stopWakeWord]);

  // V5: Cleanup on unmount
  // Memory leak fix: Clear all tracked timeouts
  useEffect(() => {
    return () => {
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
        resumeTimeoutRef.current = null;
      }
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
        flashTimeoutRef.current = null;
      }
      if (micHandoffTimeoutRef.current) {
        clearTimeout(micHandoffTimeoutRef.current);
        micHandoffTimeoutRef.current = null;
      }
    };
  }, []);

  const contextLabel = getContextLabel(voiceContext);

  // V5: Wake word listening state for UI
  const isListeningForWakeWord = handsFreeModeEnabled && wakeWordState === "listening";

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {/* Expanded panel */}
      {isExpanded && (
        <div
          className="w-80 rounded-lg border shadow-lg"
          style={{
            backgroundColor: "var(--color-bg-surface)",
            borderColor: "var(--color-border-subtle)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: "var(--color-border-subtle)" }}
          >
            <div className="flex items-center gap-2">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: getStatusColor(status) }}
              />
              <span
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                {getStatusLabel(status)}
              </span>
              {/* V4: Paused indicator */}
              {voiceContext.notificationsPaused && (
                <div
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-xs"
                  style={{
                    backgroundColor: "var(--color-status-review)",
                    color: "white",
                  }}
                  title="Notifications are paused"
                >
                  <MuteIcon />
                  <span>Muted</span>
                </div>
              )}
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1 rounded hover:bg-[var(--color-bg-hover)]"
              aria-label="Minimize"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>

          {/* V3: Focus/Follow context indicator */}
          {contextLabel && (
            <div
              className="border-b px-4 py-2 text-xs font-medium"
              style={{
                borderColor: "var(--color-border-subtle)",
                backgroundColor: "var(--color-bg-hover)",
                color: "var(--color-accent)",
              }}
            >
              {contextLabel}
            </div>
          )}

          {/* V5: Hands-free mode toggle (only show when connected and supported) */}
          {isConnected && isWakeWordSupported && (
            <div
              className="flex items-center justify-between border-b px-4 py-2"
              style={{ borderColor: "var(--color-border-subtle)" }}
            >
              <div className="flex items-center gap-2">
                <HeadphonesIcon />
                <span
                  className="text-sm"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Hands-free mode
                </span>
              </div>
              <button
                onClick={handleHandsFreeToggle}
                className="relative h-6 w-11 rounded-full transition-colors"
                style={{
                  backgroundColor: handsFreeModeEnabled
                    ? "var(--color-accent)"
                    : "var(--color-bg-hover)",
                }}
                aria-label={handsFreeModeEnabled ? "Disable hands-free mode" : "Enable hands-free mode"}
                aria-pressed={handsFreeModeEnabled}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                  style={{
                    transform: handsFreeModeEnabled ? "translateX(22px)" : "translateX(2px)",
                  }}
                />
              </button>
            </div>
          )}

          {/* V5: Wake word listening indicator */}
          {isListeningForWakeWord && (
            <div
              className="flex items-center gap-2 border-b px-4 py-2 transition-colors"
              style={{
                borderColor: "var(--color-border-subtle)",
                backgroundColor: wakeWordFlash ? "var(--color-accent)" : "var(--color-bg-base)",
                color: wakeWordFlash ? "white" : "var(--color-text-secondary)",
              }}
            >
              <span
                className="inline-block h-2 w-2 animate-pulse rounded-full"
                style={{ backgroundColor: wakeWordFlash ? "white" : "var(--color-accent)" }}
              />
              <span className="text-sm">
                {wakeWordFlash ? "Wake word detected!" : "Listening for \"Hey AO\"..."}
              </span>
            </div>
          )}

          {/* V5: Wake word error display */}
          {handsFreeModeEnabled && wakeWordError && (
            <div
              className="border-b px-4 py-2 text-sm"
              style={{
                borderColor: "var(--color-border-subtle)",
                color: "var(--color-status-error)",
              }}
            >
              {wakeWordError}
            </div>
          )}

          {/* Transcript */}
          <div
            className="h-32 overflow-y-auto px-4 py-2 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {transcript.length === 0 ? (
              <p className="italic">
                {isConnected
                  ? handsFreeModeEnabled
                    ? "Say \"Hey AO\" or hold space to talk..."
                    : "Hold space or click mic to talk..."
                  : "Click the button to enable voice"}
              </p>
            ) : (
              transcript.map((line, i) => (
                <p key={i} className="py-1">
                  {line}
                </p>
              ))
            )}
          </div>

          {/* V3: Push-to-talk button */}
          {isConnected && (
            <div
              className="flex items-center justify-center border-t px-4 py-3"
              style={{ borderColor: "var(--color-border-subtle)" }}
            >
              <button
                type="button"
                onMouseDown={handlePushToTalkStart}
                onMouseUp={handlePushToTalkEnd}
                onMouseLeave={handlePushToTalkEnd}
                onTouchStart={handlePushToTalkStart}
                onTouchEnd={handlePushToTalkEnd}
                className="flex items-center gap-2 rounded-full px-6 py-3 font-medium transition-all"
                style={{
                  backgroundColor: isRecording
                    ? "var(--color-status-error)"
                    : "var(--color-accent)",
                  color: "white",
                  transform: isRecording ? "scale(1.05)" : "scale(1)",
                }}
                aria-label={isRecording ? "Recording..." : "Hold to talk"}
              >
                <MicrophoneIcon className={isRecording ? "animate-pulse" : ""} />
                <span className="text-sm">
                  {isRecording ? "Recording..." : "Hold to Talk"}
                </span>
              </button>
            </div>
          )}

          {/* V3: Keyboard shortcut hint */}
          {isConnected && !isRecording && (
            <div
              className="px-4 pb-2 text-center text-xs"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              Or hold <kbd className="rounded border px-1" style={{ borderColor: "var(--color-border-subtle)" }}>Space</kbd> anywhere
            </div>
          )}

          {/* Query input */}
          <form
            onSubmit={handleSubmitQuery}
            className="border-t px-4 py-3"
            style={{ borderColor: "var(--color-border-subtle)" }}
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder={isConnected ? "Or type a question..." : "Connect first"}
                disabled={!isConnected}
                className="flex-1 rounded border px-3 py-2 text-sm disabled:opacity-50"
                style={{
                  backgroundColor: "var(--color-bg-base)",
                  borderColor: "var(--color-border-subtle)",
                  color: "var(--color-text-primary)",
                }}
              />
              <button
                type="submit"
                disabled={!isConnected || !queryText.trim()}
                className="rounded px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                Send
              </button>
            </div>
          </form>

          {/* Error display */}
          {error && (
            <div
              className="border-t px-4 py-2 text-sm"
              style={{
                borderColor: "var(--color-border-subtle)",
                color: "var(--color-status-error)",
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={isExpanded ? handleToggle : () => setIsExpanded(true)}
        className="flex items-center gap-2 rounded-full px-4 py-2 shadow-lg transition-all hover:scale-105"
        style={{
          backgroundColor: isRecording
            ? "var(--color-status-error)"
            : isConnected
              ? "var(--color-status-working)"
              : "var(--color-bg-surface)",
          color: isConnected || isRecording ? "white" : "var(--color-text-primary)",
          borderWidth: isConnected || isRecording ? 0 : 1,
          borderColor: "var(--color-border-subtle)",
        }}
        aria-label={isRecording ? "Recording..." : isConnected ? "Voice active" : "Enable voice"}
      >
        {isPlaying ? (
          <SpeakerIcon className="animate-pulse" />
        ) : (
          <MicrophoneIcon className={isRecording ? "animate-pulse" : ""} />
        )}
        {!isExpanded && (
          <span className="text-sm font-medium">
            {isRecording ? "Recording..." : isConnected ? "Voice" : "Enable Voice"}
          </span>
        )}
      </button>
    </div>
  );
}
