import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  shouldSpeak,
  isSpeakableEvent,
  getDedupeKey,
  clearDedupeCache,
  cleanupDedupeCache,
  getDedupeCacheSize,
  markEventSeen,
  DEDUPE_WINDOW_MS,
  SPEAKABLE_EVENTS,
} from "../voice-dedupe";

describe("voice-dedupe", () => {
  beforeEach(() => {
    clearDedupeCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isSpeakableEvent", () => {
    it("returns true for speakable events", () => {
      for (const event of SPEAKABLE_EVENTS) {
        expect(isSpeakableEvent(event)).toBe(true);
      }
    });

    it("returns false for non-speakable events", () => {
      expect(isSpeakableEvent("session.spawned")).toBe(false);
      expect(isSpeakableEvent("pr.created")).toBe(false);
      expect(isSpeakableEvent("random.event")).toBe(false);
    });
  });

  describe("getDedupeKey", () => {
    it("creates consistent keys", () => {
      expect(getDedupeKey("ao-94", "ci.failing")).toBe("ao-94:ci.failing");
      expect(getDedupeKey("session-1", "merge.ready")).toBe("session-1:merge.ready");
    });
  });

  describe("shouldSpeak", () => {
    it("allows first occurrence of speakable event", () => {
      expect(shouldSpeak("ao-94", "ci.failing")).toBe(true);
    });

    it("blocks duplicate within dedupe window", () => {
      expect(shouldSpeak("ao-94", "ci.failing")).toBe(true);
      expect(shouldSpeak("ao-94", "ci.failing")).toBe(false);
    });

    it("allows same event for different sessions", () => {
      expect(shouldSpeak("ao-94", "ci.failing")).toBe(true);
      expect(shouldSpeak("ao-95", "ci.failing")).toBe(true);
    });

    it("allows different events for same session", () => {
      expect(shouldSpeak("ao-94", "ci.failing")).toBe(true);
      expect(shouldSpeak("ao-94", "merge.ready")).toBe(true);
    });

    it("allows event after dedupe window expires", () => {
      expect(shouldSpeak("ao-94", "ci.failing")).toBe(true);
      expect(shouldSpeak("ao-94", "ci.failing")).toBe(false);

      // Advance time past dedupe window
      vi.advanceTimersByTime(DEDUPE_WINDOW_MS + 1);

      expect(shouldSpeak("ao-94", "ci.failing")).toBe(true);
    });

    it("blocks non-speakable events", () => {
      expect(shouldSpeak("ao-94", "session.spawned")).toBe(false);
      expect(shouldSpeak("ao-94", "pr.created")).toBe(false);
    });
  });

  describe("markEventSeen", () => {
    it("marks event as seen", () => {
      expect(shouldSpeak("ao-94", "ci.failing")).toBe(true);
      markEventSeen("ao-95", "ci.failing");
      expect(shouldSpeak("ao-95", "ci.failing")).toBe(false);
    });
  });

  describe("cleanupDedupeCache", () => {
    it("removes stale entries", () => {
      shouldSpeak("ao-94", "ci.failing");
      shouldSpeak("ao-95", "merge.ready");
      expect(getDedupeCacheSize()).toBe(2);

      // Advance past dedupe window
      vi.advanceTimersByTime(DEDUPE_WINDOW_MS + 1);

      cleanupDedupeCache();
      expect(getDedupeCacheSize()).toBe(0);
    });

    it("keeps recent entries", () => {
      shouldSpeak("ao-94", "ci.failing");

      vi.advanceTimersByTime(DEDUPE_WINDOW_MS / 2);
      shouldSpeak("ao-95", "merge.ready");

      vi.advanceTimersByTime(DEDUPE_WINDOW_MS / 2 + 1);

      cleanupDedupeCache();
      // Only ao-94 should be removed (older than window)
      expect(getDedupeCacheSize()).toBe(1);
    });
  });

  describe("clearDedupeCache", () => {
    it("clears all entries", () => {
      shouldSpeak("ao-94", "ci.failing");
      shouldSpeak("ao-95", "merge.ready");
      expect(getDedupeCacheSize()).toBe(2);

      clearDedupeCache();
      expect(getDedupeCacheSize()).toBe(0);
    });
  });
});
