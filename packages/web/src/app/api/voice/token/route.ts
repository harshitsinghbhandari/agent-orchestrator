import { type NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes } from "crypto";

/**
 * V4: Ephemeral token endpoint for voice connections.
 *
 * Generates a short-lived token that the voice server validates.
 * This keeps the Gemini API key on the server side and provides
 * a time-limited access token for browser clients.
 *
 * Token format: base64(timestamp:randomBytes:hmac)
 * - timestamp: Unix timestamp when token was created
 * - randomBytes: Random nonce for uniqueness
 * - hmac: HMAC-SHA256 signature using VOICE_TOKEN_SECRET
 */

const TOKEN_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a voice access token
 */
function generateToken(): { token: string; expiresAt: number } {
  const secret = process.env["VOICE_TOKEN_SECRET"] || process.env["GEMINI_API_KEY"];
  if (!secret) {
    throw new Error("No secret available for token generation");
  }

  const timestamp = Date.now();
  const nonce = randomBytes(16).toString("hex");
  const data = `${timestamp}:${nonce}`;
  const hmac = createHmac("sha256", secret).update(data).digest("hex");

  const token = Buffer.from(`${data}:${hmac}`).toString("base64");
  const expiresAt = timestamp + TOKEN_VALIDITY_MS;

  return { token, expiresAt };
}

/**
 * Validate a voice access token
 */
export function validateToken(token: string): { valid: boolean; error?: string } {
  const secret = process.env["VOICE_TOKEN_SECRET"] || process.env["GEMINI_API_KEY"];
  if (!secret) {
    return { valid: false, error: "No secret configured" };
  }

  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const parts = decoded.split(":");

    if (parts.length !== 3) {
      return { valid: false, error: "Invalid token format" };
    }

    const [timestampStr, nonce, providedHmac] = parts;
    const timestamp = parseInt(timestampStr, 10);

    if (isNaN(timestamp)) {
      return { valid: false, error: "Invalid timestamp" };
    }

    // Check expiration
    const now = Date.now();
    if (now - timestamp > TOKEN_VALIDITY_MS) {
      return { valid: false, error: "Token expired" };
    }

    // Verify HMAC
    const data = `${timestamp}:${nonce}`;
    const expectedHmac = createHmac("sha256", secret).update(data).digest("hex");

    if (providedHmac !== expectedHmac) {
      return { valid: false, error: "Invalid signature" };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Token validation failed" };
  }
}

/**
 * GET /api/voice/token - Generate a new ephemeral voice access token
 */
export async function GET(_request: NextRequest) {
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

  try {
    const { token, expiresAt } = generateToken();

    return NextResponse.json({
      token,
      expiresAt,
      expiresIn: TOKEN_VALIDITY_MS,
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
