/**
 * Gemini Live API client wrapper.
 *
 * Manages the bidirectional WebSocket connection to Gemini for real-time
 * voice generation. Handles session lifecycle, function calling, and
 * audio output streaming.
 */

import {
  GoogleGenAI,
  Modality,
  Type,
  type LiveServerMessage,
  type Session,
  type FunctionDeclaration,
} from "@google/genai";
import { executeFunctionCall, createConversationContext, type ConversationContext } from "./voice-functions";
import type { DashboardSession } from "./types";

/**
 * MVP function declarations for Gemini (using proper SDK types)
 */
const MVP_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "list_sessions",
    description: "List active agent sessions with their current status",
    parameters: {
      type: Type.OBJECT,
      properties: {
        status: {
          type: Type.STRING,
          enum: ["working", "stuck", "needs_input", "pr_open", "approved", "all"],
          description: "Filter by session status. Use 'all' to list all sessions.",
        },
      },
    },
  },
  {
    name: "get_session_summary",
    description: "Get summary of what a specific agent session is working on",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sessionId: {
          type: Type.STRING,
          description: "Session ID like 'ao-94'",
        },
      },
      required: ["sessionId"],
    },
  },
];

/**
 * System instruction for the voice copilot
 */
const SYSTEM_INSTRUCTION = `You are the voice interface for Agent Orchestrator (AO), a system that manages parallel AI coding agents.

Your role:
- Announce important events concisely (CI failures, review requests, stuck sessions, merge-ready PRs)
- Answer questions about session status and agent activity
- Keep responses brief and actionable — this is spoken audio, not text
- Use session IDs like "ao-94" consistently
- When listing multiple sessions, group by urgency
- If you don't know something, say so and suggest checking the dashboard

Event announcements should be:
- Clear and concise (under 15 seconds of speech)
- Action-oriented ("Session ao-94 needs your attention — CI is failing")
- Not repetitive (don't re-explain what the user already knows)

When using functions:
- Use list_sessions to get current session states
- Use get_session_summary for details on a specific session
- Always call the function first, then speak based on the results`;

/**
 * Gemini Live session state
 */
export type GeminiSessionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * Audio chunk from Gemini
 */
export interface AudioChunk {
  data: string; // Base64-encoded PCM audio
  mimeType: string;
}

/**
 * Callbacks for Gemini session events
 */
export interface GeminiCallbacks {
  onStateChange?: (state: GeminiSessionState) => void;
  onAudio?: (chunk: AudioChunk) => void;
  onError?: (error: Error) => void;
  /** V2: Now returns FunctionResult with result string and optional sessionId for context */
  onFunctionCall?: (name: string, args: Record<string, unknown>) => Promise<{ result: string; sessionId: string | null }>;
}

/**
 * Gemini Live client wrapper
 */
export class GeminiLiveClient {
  private ai: GoogleGenAI | null = null;
  private session: Session | null = null;
  private state: GeminiSessionState = "disconnected";
  private callbacks: GeminiCallbacks;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private connectionStartTime: number | null = null;
  private readonly maxConnectionDurationMs = 14 * 60 * 1000; // 14 minutes (before 15min limit)

  constructor(callbacks: GeminiCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Get current session state
   */
  getState(): GeminiSessionState {
    return this.state;
  }

  /**
   * Set state and notify callback
   */
  private setState(state: GeminiSessionState): void {
    this.state = state;
    this.callbacks.onStateChange?.(state);
  }

  /**
   * Connect to Gemini Live API
   */
  async connect(apiKey: string): Promise<void> {
    if (this.state === "connecting" || this.state === "connected") {
      return;
    }

    this.setState("connecting");

    try {
      this.ai = new GoogleGenAI({ apiKey });

      this.session = await this.ai.live.connect({
        model: "gemini-2.0-flash-live-001",
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
          tools: [{ functionDeclarations: MVP_FUNCTION_DECLARATIONS }],
        },
        callbacks: {
          onopen: () => this.handleOpen(),
          onmessage: (msg) => this.handleMessage(msg),
          onerror: (err) => this.handleError(err),
          onclose: () => this.handleClose(),
        },
      });

      this.connectionStartTime = Date.now();
      this.reconnectAttempts = 0;
    } catch (error) {
      this.setState("error");
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Disconnect from Gemini Live API
   */
  async disconnect(): Promise<void> {
    if (this.session) {
      try {
        await this.session.close();
      } catch {
        // Ignore close errors
      }
      this.session = null;
    }
    this.ai = null;
    this.connectionStartTime = null;
    this.setState("disconnected");
  }

  /**
   * Check if connection is near the 15-minute limit and reconnect if needed
   */
  async checkConnectionAge(): Promise<void> {
    if (!this.connectionStartTime || this.state !== "connected") {
      return;
    }

    const age = Date.now() - this.connectionStartTime;
    if (age > this.maxConnectionDurationMs) {
      // Proactive reconnect before timeout
      const apiKey = process.env["GEMINI_API_KEY"];
      if (apiKey) {
        await this.disconnect();
        await this.connect(apiKey);
      }
    }
  }

  /**
   * Send a text message to Gemini for voice response
   */
  async sendText(text: string): Promise<void> {
    if (!this.session || this.state !== "connected") {
      throw new Error("Not connected to Gemini Live API");
    }

    await this.checkConnectionAge();

    await this.session.sendClientContent({
      turns: [
        {
          role: "user",
          parts: [{ text }],
        },
      ],
      turnComplete: true,
    });
  }

  /**
   * Inject an event for voice announcement
   */
  async injectEvent(eventMessage: string, context?: string): Promise<void> {
    const fullMessage = context
      ? `[AO Event] ${eventMessage}\n\nContext: ${context}`
      : `[AO Event] ${eventMessage}`;

    await this.sendText(fullMessage);
  }

  /**
   * Handle WebSocket open
   */
  private handleOpen(): void {
    this.setState("connected");
  }

  /**
   * Handle WebSocket message
   */
  private async handleMessage(message: LiveServerMessage): Promise<void> {
    // Handle audio output
    if (message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        if (part.inlineData?.data && part.inlineData?.mimeType) {
          this.callbacks.onAudio?.({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          });
        }
      }
    }

    // Handle function calls
    if (message.toolCall?.functionCalls) {
      for (const fc of message.toolCall.functionCalls) {
        if (!fc.name || !fc.id) continue;

        const funcResult = await this.callbacks.onFunctionCall?.(
          fc.name,
          (fc.args as Record<string, unknown>) ?? {},
        );
        const result = funcResult?.result;

        // Send function response back to Gemini
        if (this.session && result) {
          await this.session.sendToolResponse({
            functionResponses: [
              {
                id: fc.id,
                name: fc.name,
                response: { result },
              },
            ],
          });
        }
      }
    }
  }

  /**
   * Handle WebSocket error
   */
  private handleError(error: ErrorEvent | Error): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.callbacks.onError?.(err);
  }

  /**
   * Handle WebSocket close
   */
  private async handleClose(): Promise<void> {
    const wasConnected = this.state === "connected";
    this.setState("disconnected");
    this.session = null;
    this.connectionStartTime = null;

    // Auto-reconnect if we were connected and haven't exceeded attempts
    if (wasConnected && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const apiKey = process.env["GEMINI_API_KEY"];
      if (apiKey) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        await this.connect(apiKey);
      }
    }
  }
}

/**
 * Create a Gemini Live client with session data fetching and context tracking (V2)
 */
export function createGeminiClient(
  fetchSessions: () => Promise<DashboardSession[]>,
): GeminiLiveClient {
  // V2: Track conversation context for session retention
  const context: ConversationContext = createConversationContext();

  const client = new GeminiLiveClient({
    onFunctionCall: async (name, args) => {
      const sessions = await fetchSessions();
      const result = executeFunctionCall(name, args, sessions, context);

      // V2: Update context if session was resolved
      if (result.sessionId) {
        context.lastSessionId = result.sessionId;
        context.lastUpdatedAt = Date.now();
      }

      return result;
    },
  });

  return client;
}
