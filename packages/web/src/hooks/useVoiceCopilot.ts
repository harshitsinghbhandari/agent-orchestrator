/**
 * Voice Copilot hook for browser-side WebSocket connection and audio playback.
 *
 * Manages:
 * - WebSocket connection to voice server
 * - Audio playback via Web Audio API
 * - Connection state
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice copilot connection status
 */
export type VoiceStatus = "disconnected" | "connecting" | "connected" | "error";

/**
 * Server → Browser message types
 */
interface ServerMessage {
  type: "status" | "audio" | "error" | "text";
  status?: VoiceStatus;
  data?: string;
  mimeType?: string;
  error?: string;
}

/**
 * Voice copilot hook options
 */
interface UseVoiceCopilotOptions {
  /** WebSocket server URL (default: ws://localhost:3002) */
  serverUrl?: string;
  /** Auto-connect on mount (default: false) */
  autoConnect?: boolean;
  /** Callback when text response is received */
  onText?: (text: string) => void;
  /** Callback when error occurs */
  onError?: (error: string) => void;
}

/**
 * Voice copilot hook return type
 */
interface UseVoiceCopilotReturn {
  /** Current connection status */
  status: VoiceStatus;
  /** Whether voice is currently playing */
  isPlaying: boolean;
  /** Connect to voice server */
  connect: () => void;
  /** Disconnect from voice server */
  disconnect: () => void;
  /** Send a text query */
  sendQuery: (text: string) => void;
  /** Last error message */
  error: string | null;
}

/**
 * Decode base64 PCM audio and play via Web Audio API
 */
async function playPCMAudio(
  audioContext: AudioContext,
  base64Data: string,
  _mimeType: string,
): Promise<void> {
  // Decode base64 to raw bytes
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Gemini outputs PCM 16-bit mono 24kHz
  const sampleRate = 24000;
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit

  // Convert Int16 PCM to Float32
  const numSamples = bytes.length / bytesPerSample;
  const float32Data = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    // Little-endian 16-bit signed integer
    const sample = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    // Convert to signed
    const signedSample = sample > 32767 ? sample - 65536 : sample;
    // Normalize to -1.0 to 1.0
    float32Data[i] = signedSample / 32768;
  }

  // Create AudioBuffer
  const audioBuffer = audioContext.createBuffer(numChannels, numSamples, sampleRate);
  audioBuffer.copyToChannel(float32Data, 0);

  // Play the buffer
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  source.start();
}

/**
 * Hook for managing voice copilot connection and audio playback
 */
export function useVoiceCopilot(
  options: UseVoiceCopilotOptions = {},
): UseVoiceCopilotReturn {
  const {
    serverUrl = "ws://localhost:3002",
    autoConnect = false,
    onText,
    onError,
  } = options;

  const [status, setStatus] = useState<VoiceStatus>("disconnected");
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Array<{ data: string; mimeType: string }>>([]);
  const isProcessingRef = useRef(false);

  /**
   * Process audio queue sequentially
   */
  const processAudioQueue = useCallback(async () => {
    if (isProcessingRef.current || audioQueueRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    setIsPlaying(true);

    while (audioQueueRef.current.length > 0) {
      const chunk = audioQueueRef.current.shift();
      if (chunk && audioContextRef.current) {
        try {
          await playPCMAudio(audioContextRef.current, chunk.data, chunk.mimeType);
          // Small delay between chunks for smoother playback
          await new Promise((r) => setTimeout(r, 50));
        } catch (err) {
          console.error("[voice] Audio playback error:", err);
        }
      }
    }

    isProcessingRef.current = false;
    setIsPlaying(false);
  }, []);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: ServerMessage = JSON.parse(event.data);

        switch (message.type) {
          case "status":
            if (message.status) {
              setStatus(message.status);
              if (message.status === "error") {
                setError("Connection error");
              }
            }
            break;

          case "audio":
            if (message.data && message.mimeType) {
              audioQueueRef.current.push({
                data: message.data,
                mimeType: message.mimeType,
              });
              processAudioQueue();
            }
            break;

          case "text":
            if (message.data) {
              onText?.(message.data);
            }
            break;

          case "error":
            if (message.error) {
              setError(message.error);
              onError?.(message.error);
            }
            break;
        }
      } catch (err) {
        console.error("[voice] Failed to parse message:", err);
      }
    },
    [onText, onError, processAudioQueue],
  );

  /**
   * Connect to voice server
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus("connecting");
    setError(null);

    // Initialize AudioContext on user gesture
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    }

    // Resume AudioContext if suspended (browser autoplay policy)
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }

    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Request Gemini connection
      ws.send(JSON.stringify({ type: "connect" }));
    };

    ws.onmessage = handleMessage;

    ws.onerror = (event) => {
      console.error("[voice] WebSocket error:", event);
      setStatus("error");
      setError("WebSocket connection failed");
    };

    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
    };
  }, [serverUrl, handleMessage]);

  /**
   * Disconnect from voice server
   */
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      // Request graceful disconnect
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "disconnect" }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  /**
   * Send a text query to the voice assistant
   */
  const sendQuery = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "query", text }));
    }
  }, []);

  // Auto-connect if enabled
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  return {
    status,
    isPlaying,
    connect,
    disconnect,
    sendQuery,
    error,
  };
}
