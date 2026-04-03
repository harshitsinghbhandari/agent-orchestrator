"use client";

/**
 * Voice Copilot panel component.
 *
 * Provides:
 * - Toggle button to enable/disable voice
 * - Connection status indicator
 * - Query input for testing
 */

import { useState, useCallback } from "react";
import { useVoiceCopilot, type VoiceStatus } from "@/hooks/useVoiceCopilot";

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
 * Voice Copilot panel component
 */
export function VoicePanel({ defaultExpanded = false }: VoicePanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [queryText, setQueryText] = useState("");
  const [transcript, setTranscript] = useState<string[]>([]);

  const { status, isPlaying, connect, disconnect, sendQuery, error } =
    useVoiceCopilot({
      onText: (text) => {
        setTranscript((prev) => [...prev.slice(-4), text]);
      },
      onError: (err) => {
        setTranscript((prev) => [...prev.slice(-4), `Error: ${err}`]);
      },
    });

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

          {/* Transcript */}
          <div
            className="h-32 overflow-y-auto px-4 py-2 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {transcript.length === 0 ? (
              <p className="italic">
                {isConnected
                  ? "Listening for events..."
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
                placeholder={isConnected ? "Ask a question..." : "Connect first"}
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
          backgroundColor: isConnected
            ? "var(--color-status-working)"
            : "var(--color-bg-surface)",
          color: isConnected ? "white" : "var(--color-text-primary)",
          borderWidth: isConnected ? 0 : 1,
          borderColor: "var(--color-border-subtle)",
        }}
        aria-label={isConnected ? "Voice active" : "Enable voice"}
      >
        {isPlaying ? (
          <SpeakerIcon className="animate-pulse" />
        ) : (
          <MicrophoneIcon />
        )}
        {!isExpanded && (
          <span className="text-sm font-medium">
            {isConnected ? "Voice" : "Enable Voice"}
          </span>
        )}
      </button>
    </div>
  );
}
