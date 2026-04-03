import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createHmac, randomBytes } from "crypto";
import { GET, POST } from "../route";
import { validateToken } from "@/lib/voice-token";

describe("Voice Token API", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("GET /api/voice/token", () => {
    it("returns 403 when voice is not enabled", async () => {
      process.env["AO_VOICE_ENABLED"] = "false";
      process.env["NEXT_PUBLIC_AO_VOICE_ENABLED"] = "false";
      process.env["GEMINI_API_KEY"] = "test-key";

      const request = new NextRequest("http://localhost/api/voice/token");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Voice feature is not enabled");
    });

    it("returns 503 when Gemini API key is not configured", async () => {
      process.env["AO_VOICE_ENABLED"] = "true";
      delete process.env["GEMINI_API_KEY"];

      const request = new NextRequest("http://localhost/api/voice/token");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe("Voice service not configured");
    });

    it("returns 500 when VOICE_TOKEN_SECRET is not configured", async () => {
      process.env["AO_VOICE_ENABLED"] = "true";
      process.env["GEMINI_API_KEY"] = "test-key";
      delete process.env["VOICE_TOKEN_SECRET"];

      const request = new NextRequest("http://localhost/api/voice/token");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Voice auth not configured (VOICE_TOKEN_SECRET required)");
    });

    it("returns a valid token when configured correctly", async () => {
      process.env["AO_VOICE_ENABLED"] = "true";
      process.env["GEMINI_API_KEY"] = "test-key";
      process.env["VOICE_TOKEN_SECRET"] = "test-secret";

      const request = new NextRequest("http://localhost/api/voice/token");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.token).toBeDefined();
      expect(typeof data.token).toBe("string");
      expect(data.expiresAt).toBeDefined();
      expect(typeof data.expiresAt).toBe("number");
      expect(data.expiresIn).toBe(5 * 60 * 1000); // 5 minutes
    });

    it("generates tokens that can be validated", async () => {
      process.env["AO_VOICE_ENABLED"] = "true";
      process.env["GEMINI_API_KEY"] = "test-key";
      process.env["VOICE_TOKEN_SECRET"] = "test-secret";

      const request = new NextRequest("http://localhost/api/voice/token");
      const response = await GET(request);
      const data = await response.json();

      const validation = validateToken(data.token);
      expect(validation.valid).toBe(true);
      expect(validation.error).toBeUndefined();
    });
  });

  describe("POST /api/voice/token (validation)", () => {
    it("returns valid for a freshly generated token", async () => {
      process.env["GEMINI_API_KEY"] = "test-key";
      process.env["VOICE_TOKEN_SECRET"] = "test-secret";

      // Generate a token first
      process.env["AO_VOICE_ENABLED"] = "true";
      const getRequest = new NextRequest("http://localhost/api/voice/token");
      const getResponse = await GET(getRequest);
      const { token } = await getResponse.json();

      // Validate it
      const postRequest = new NextRequest("http://localhost/api/voice/token", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      const postResponse = await POST(postRequest);
      const data = await postResponse.json();

      expect(postResponse.status).toBe(200);
      expect(data.valid).toBe(true);
    });

    it("returns invalid for tampered tokens", async () => {
      process.env["GEMINI_API_KEY"] = "test-key";
      process.env["VOICE_TOKEN_SECRET"] = "test-secret";

      const postRequest = new NextRequest("http://localhost/api/voice/token", {
        method: "POST",
        body: JSON.stringify({ token: "invalid-token" }),
      });
      const postResponse = await POST(postRequest);
      const data = await postResponse.json();

      expect(postResponse.status).toBe(200);
      expect(data.valid).toBe(false);
      expect(data.error).toBeDefined();
    });

    it("returns error when token is missing", async () => {
      const postRequest = new NextRequest("http://localhost/api/voice/token", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const postResponse = await POST(postRequest);
      const data = await postResponse.json();

      expect(postResponse.status).toBe(400);
      expect(data.error).toBe("Token required");
    });
  });

  describe("validateToken function", () => {
    it("returns valid for a properly signed token", async () => {
      process.env["AO_VOICE_ENABLED"] = "true";
      process.env["GEMINI_API_KEY"] = "test-key";
      process.env["VOICE_TOKEN_SECRET"] = "test-secret-key";

      const getRequest = new NextRequest("http://localhost/api/voice/token");
      const getResponse = await GET(getRequest);
      const { token } = await getResponse.json();

      const result = validateToken(token);
      expect(result.valid).toBe(true);
    });

    it("returns invalid for expired tokens", () => {
      process.env["VOICE_TOKEN_SECRET"] = "test-secret-key";

      // Create a token with an old timestamp
      const oldTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const nonce = randomBytes(16).toString("hex");
      const data = `${oldTimestamp}:${nonce}`;
      const hmac = createHmac("sha256", "test-secret-key")
        .update(data)
        .digest("hex");
      const token = Buffer.from(`${data}:${hmac}`).toString("base64");

      const result = validateToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Token expired");
    });

    it("returns invalid for tokens with wrong signature", () => {
      process.env["VOICE_TOKEN_SECRET"] = "test-secret-key";

      const timestamp = Date.now();
      const nonce = "fake-nonce";
      const data = `${timestamp}:${nonce}:wrong-signature`;
      const token = Buffer.from(data).toString("base64");

      const result = validateToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid signature");
    });

    it("returns invalid for malformed tokens", () => {
      process.env["VOICE_TOKEN_SECRET"] = "test-secret-key";

      const result = validateToken("not-valid-base64-!@#$");
      expect(result.valid).toBe(false);
    });

    it("returns error when VOICE_TOKEN_SECRET is not configured", () => {
      delete process.env["VOICE_TOKEN_SECRET"];

      const result = validateToken("any-token");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Voice authentication not configured (VOICE_TOKEN_SECRET required)");
    });
  });
});
