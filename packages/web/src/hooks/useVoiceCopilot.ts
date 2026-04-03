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

  // Return a promise that resolves when the chunk finishes playing
  return new Promise((resolve) => {
    // Play the buffer
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.onended = () => resolve();
    source.start();
  });
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
  const nextPlayTimeRef = useRef<number>(0);
  const onTextRef = useRef(onText);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTextRef.current = onText;
    onErrorRef.current = onError;
  }, [onText, onError]);

  /**
   * Process audio queue sequentially
   */
  const processAudioQueue = useCallback(async () => {
    if (isProcessingRef.current || audioQueueRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    setIsPlaying(true);

    // Initialize nextPlayTime if it's been a while or starting fresh
    if (audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      if (nextPlayTimeRef.current < now) {
        // Add a small buffer (100ms) for initial playback to allow for network jitter
        nextPlayTimeRef.current = now + 0.1;
      }
    }

    while (audioQueueRef.current.length > 0) {
      const chunk = audioQueueRef.current.shift();
      if (chunk && audioContextRef.current) {
        try {
          if (audioContextRef.current.state === "suspended") {
            await audioContextRef.current.resume();
          }

          // Decode and schedule the chunk
          const binaryString = atob(chunk.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const sampleRate = 24000;
          const numSamples = bytes.length / 2;
          const float32Data = new Float32Array(numSamples);
          for (let i = 0; i < numSamples; i++) {
            const sample = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
            const signedSample = sample > 32767 ? sample - 65536 : sample;
            float32Data[i] = signedSample / 32768;
          }

          const audioBuffer = audioContextRef.current.createBuffer(1, numSamples, sampleRate);
          audioBuffer.copyToChannel(float32Data, 0);

          const source = audioContextRef.current.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContextRef.current.destination);

          // Schedule at the precise end of the previous chunk
          const startTime = nextPlayTimeRef.current;
          source.start(startTime);
          nextPlayTimeRef.current += audioBuffer.duration;

          // Wait until just before the next chunk needs to be processed
          // (resolving slightly before to avoid underrun)
          const delayMs = (startTime - audioContextRef.current.currentTime) * 1000;
          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        } catch (err) {
          console.error("[voice] Audio playback error:", err);
        }
      }
    }

    isProcessingRef.current = false;
    // We don't set isPlaying(false) immediately because audio might still be playing
    // in the buffers we scheduled. But for simple UI, this is okay for now.
    // Better: set timeout until nextPlayTimeRef.current
    const finalDelay = (nextPlayTimeRef.current - (audioContextRef.current?.currentTime || 0)) * 1000;
    setTimeout(() => setIsPlaying(false), Math.max(0, finalDelay));
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
              if (message.status === "error" || message.status === "disconnected") {
                // Clear queue on error or disconnect
                audioQueueRef.current = [];
                if (message.status === "error") {
                  setError("Connection error or interrupted");
                }
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
              onTextRef.current?.(message.data);
            }
            break;

          case "error":
            if (message.error) {
              setError(message.error);
              onErrorRef.current?.(message.error);
            }
            break;
        }
      } catch (err) {
        console.error("[voice] Failed to parse message:", err);
      }
    },
    [processAudioQueue],
  );

  /**
   * Connect to voice server
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
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

    console.log(`[voice] Connecting to ${serverUrl}...`);
    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[voice] WebSocket connected");
      // Request Gemini connection
      ws.send(JSON.stringify({ type: "connect" }));
    };

    ws.onmessage = handleMessage;

    ws.onerror = (event) => {
      console.error("[voice] WebSocket error event:", event);
      setStatus("error");
      setError("WebSocket connection failed. Ensure server is running on port 3002.");
    };

    ws.onclose = (event) => {
      console.log(`[voice] WebSocket closed: ${event.code} ${event.reason}`);
      setStatus("disconnected");
      wsRef.current = null;
    };
  }, [serverUrl, handleMessage]);

  /**
   * Disconnect from voice server
   */
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      const ws = wsRef.current;
      // Request graceful disconnect if open
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "disconnect" }));
        } catch (err) {
          console.error("[voice] Error sending disconnect:", err);
        }
      }
      
      // Close only if not already closed/closing
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
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
      // Only disconnect on unmount if we were the one who connected
      // Actually, standard practice is to cleanup on unmount
      if (wsRef.current) {
        const ws = wsRef.current;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }
    };
  }, [autoConnect, connect]);

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
