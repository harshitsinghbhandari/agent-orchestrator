import { type NextRequest, NextResponse } from "next/server";
import { generateToken, validateToken, TOKEN_VALIDITY } from "@/lib/voice-token";

/**
 * V4: Ephemeral token endpoint for voice connections.
 *
 * Generates a short-lived token that the voice server validates.
 * This keeps the Gemini API key on the server side and provides
 * a time-limited access token for browser clients.
 */

/**
 * GET /api/voice/token - Generate a new ephemeral voice access token
 */
export async function GET(request: NextRequest) {
  // Check if voice is enabled
  const voiceEnabled =
    process.env["AO_VOICE_ENABLED"] === "true" ||
    process.env["NEXT_PUBLIC_AO_VOICE_ENABLED"] === "true";

  if (!voiceEnabled) {
    return NextResponse.json({ error: "Voice feature is not enabled" }, { status: 403 });
  }

  // Check if Gemini API key is configured
  if (!process.env["GEMINI_API_KEY"]) {
    return NextResponse.json({ error: "Voice service not configured" }, { status: 503 });
  }

  // Require authentication via dashboard token if configured
  const expectedToken = process.env["AO_DASHBOARD_TOKEN"];
  if (expectedToken) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Require VOICE_TOKEN_SECRET for secure token generation
  const secret = process.env["VOICE_TOKEN_SECRET"];
  if (!secret) {
    return NextResponse.json({ error: "Voice auth not configured (VOICE_TOKEN_SECRET required)" }, { status: 500 });
  }

  try {
    const { token, expiresAt } = generateToken();

    return NextResponse.json({
      token,
      expiresAt,
      expiresIn: TOKEN_VALIDITY,
    });
  } catch (error) {
    console.error("[voice/token] Failed to generate token:", error);
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}

/**
 * POST /api/voice/token - Validate a token (for debugging)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const result = validateToken(token);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
