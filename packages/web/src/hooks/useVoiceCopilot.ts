/**
 * Voice Copilot hook for browser-side WebSocket connection and audio playback.
 *
 * V3 Features:
 * - WebSocket connection to voice server
 * - Audio playback via Web Audio API
 * - Microphone capture and streaming (push-to-talk)
 * - Connection state and recording state
 * - Focus/follow mode context
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
  type: "status" | "audio" | "error" | "text" | "action" | "interrupt";
  status?: VoiceStatus;
  data?: string;
  mimeType?: string;
  error?: string;
  // V4: Action result
  action?: {
    type: "send_message" | "merge_pr";
    sessionId: string;
    success: boolean;
    error?: string;
    prNumber?: number;
  };
  // V4: Context updates
  context?: {
    focusedSessionId?: string | null;
    followingSessionId?: string | null;
    notificationsPaused?: boolean;
  };
}

/**
 * V4: Voice context for focus/follow mode and notification control
 */
export interface VoiceContext {
  focusedSessionId: string | null;
  followingSessionId: string | null;
  notificationsPaused: boolean;
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
  /** V3: Callback when action result is received */
  onAction?: (action: { type: "send_message"; sessionId: string; success: boolean; error?: string }) => void;
  /** V3: Callback when context changes */
  onContextChange?: (context: VoiceContext) => void;
}

/**
 * Voice copilot hook return type
 */
interface UseVoiceCopilotReturn {
  /** Current connection status */
  status: VoiceStatus;
  /** Whether voice is currently playing */
  isPlaying: boolean;
  /** V3: Whether microphone is recording */
  isRecording: boolean;
  /** Connect to voice server */
  connect: () => void;
  /** Disconnect from voice server */
  disconnect: () => void;
  /** Send a text query */
  sendQuery: (text: string) => void;
  /** V3: Start recording audio from microphone */
  startRecording: () => Promise<void>;
  /** V3: Stop recording and send final audio */
  stopRecording: () => void;
  /** V4: Clear audio queue (for VAD interruption) */
  clearAudioQueue: () => void;
  /** Last error message */
  error: string | null;
  /** V4: Current voice context (focus/follow state + notifications paused) */
  context: VoiceContext;
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
    onAction,
    onContextChange,
  } = options;

  const [status, setStatus] = useState<VoiceStatus>("disconnected");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<VoiceContext>({
    focusedSessionId: null,
    followingSessionId: null,
    notificationsPaused: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Array<{ data: string; mimeType: string }>>([]);
  const isProcessingRef = useRef(false);
  const nextPlayTimeRef = useRef<number>(0);
  const onTextRef = useRef(onText);
  const onErrorRef = useRef(onError);
  const onActionRef = useRef(onAction);
  const onContextChangeRef = useRef(onContextChange);

  // V3: Microphone recording refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    onTextRef.current = onText;
    onErrorRef.current = onError;
    onActionRef.current = onAction;
    onContextChangeRef.current = onContextChange;
  }, [onText, onError, onAction, onContextChange]);

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
                // Stop recording and clear queue on error or disconnect
                stopRecording();
                audioQueueRef.current = [];
                if (message.status === "error") {
                  setError("Connection error or interrupted");
                }
              }
            }
            // V4: Handle context updates in status messages
            if (message.context) {
              const newContext: VoiceContext = {
                focusedSessionId: message.context.focusedSessionId ?? null,
                followingSessionId: message.context.followingSessionId ?? null,
                notificationsPaused: message.context.notificationsPaused ?? false,
              };
              setContext(newContext);
              onContextChangeRef.current?.(newContext);
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

          // V3: Handle action results
          case "action":
            if (message.action) {
              onActionRef.current?.(message.action);
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

  /**
   * V3: Send audio data to voice server
   */
  const sendAudio = useCallback((audioData: string, mimeType: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "audio", data: audioData, mimeType }));
    }
  }, []);

  /**
   * V4: Clear audio queue and stop playback (for VAD interruption)
   */
  const clearAudioQueue = useCallback(() => {
    console.log("[voice] Clearing audio queue (VAD interruption)");
    audioQueueRef.current = [];
    isProcessingRef.current = false;
    setIsPlaying(false);
    // Reset the next play time to allow immediate playback of new audio
    nextPlayTimeRef.current = 0;
  }, []);

  /**
   * V3: Start recording audio from microphone
   * Uses AudioWorklet for efficient PCM capture at 16kHz
   * V4: Clears audio queue on start (VAD interruption)
   */
  const startRecording = useCallback(async () => {
    if (isRecording) return;
    if (status !== "connected") {
      setError("Must be connected to start recording");
      return;
    }

    // V4: Clear audio queue when starting to record (VAD interruption)
    // This stops any ongoing playback when the user starts speaking
    clearAudioQueue();

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      // Create audio context for processing
      const audioContext = new AudioContext({ sampleRate: 16000 });
      micAudioContextRef.current = audioContext;

      // Create source from microphone
      const source = audioContext.createMediaStreamSource(stream);

      // Use ScriptProcessorNode for audio capture (AudioWorklet requires module loading)
      // Buffer size of 4096 gives ~256ms chunks at 16kHz
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        // Convert to base64
        const uint8Array = new Uint8Array(pcmData.buffer);
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        sendAudio(base64, "audio/pcm;rate=16000");
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Store processor for cleanup (using audioWorkletNodeRef for simplicity)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioWorkletNodeRef.current = processor as any;

      setIsRecording(true);
      console.log("[voice] Started recording");
    } catch (err) {
      console.error("[voice] Failed to start recording:", err);
      setError("Failed to access microphone");
    }
  }, [isRecording, status, sendAudio, clearAudioQueue]);

  /**
   * V3: Stop recording audio
   */
  const stopRecording = useCallback(() => {
    if (!isRecording) return;

    // Stop media stream tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Disconnect and close audio context
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    if (micAudioContextRef.current) {
      micAudioContextRef.current.close();
      micAudioContextRef.current = null;
    }

    setIsRecording(false);
    console.log("[voice] Stopped recording");
  }, [isRecording]);

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
      // Cleanup playback audio context
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      // V3: Cleanup recording resources
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (micAudioContextRef.current) {
        micAudioContextRef.current.close();
        micAudioContextRef.current = null;
      }
    };
  }, []);

  return {
    status,
    isPlaying,
    isRecording,
    connect,
    disconnect,
    sendQuery,
    startRecording,
    stopRecording,
    clearAudioQueue,
    error,
    context,
  };
}
