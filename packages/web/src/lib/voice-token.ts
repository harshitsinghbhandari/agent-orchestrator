/**
 * Voice token utilities for V4 ephemeral token support.
 *
 * Generates and validates short-lived tokens that keep the
 * Gemini API key on the server side.
 *
 * Token format: base64(timestamp:nonce:hmac)
 * - timestamp: Unix timestamp when token was created
 * - nonce: 16 random bytes (hex)
 * - hmac: HMAC-SHA256 signature using secret
 */

import { createHmac, randomBytes } from "crypto";

const TOKEN_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the token secret (VOICE_TOKEN_SECRET or GEMINI_API_KEY)
 */
function getSecret(): string | undefined {
  return process.env["VOICE_TOKEN_SECRET"] || process.env["GEMINI_API_KEY"];
}

/**
 * Generate a voice access token
 */
export function generateToken(): { token: string; expiresAt: number } {
  const secret = getSecret();
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
  const secret = getSecret();
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
 * Token validity duration in milliseconds
 */
export const TOKEN_VALIDITY = TOKEN_VALIDITY_MS;
