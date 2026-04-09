import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { NotifyAction, OrchestratorEvent, Session } from "@composio/ao-core";
import { create, manifest, getThreadMapPath } from "./index.js";

function makeEvent(overrides: Partial<OrchestratorEvent> = {}): OrchestratorEvent {
  return {
    id: "evt-1",
    type: "reaction.escalated",
    priority: "urgent",
    sessionId: "ao-5",
    projectId: "ao",
    timestamp: new Date("2026-03-20T12:00:00Z"),
    message: "CI failed after 5 retries",
    data: { attempts: 5, reason: "ci_failed" },
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ao-5",
    projectId: "test-project",
    status: "working",
    activity: "active",
    branch: "feat/test",
    issueId: "TEST-123",
    pr: null,
    workspacePath: "/tmp/workspace",
    runtimeHandle: null,
    agentInfo: null,
    createdAt: new Date("2026-03-20T10:00:00Z"),
    lastActivityAt: new Date("2026-03-20T12:00:00Z"),
    metadata: {},
    ...overrides,
  };
}

describe("notifier-discord", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has correct manifest", () => {
    expect(manifest.name).toBe("discord");
    expect(manifest.slot).toBe("notifier");
  });

  it("posts to Discord webhook URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });
    await notifier.notify(makeEvent());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://discord.com/api/webhooks/123/abc");
  });

  it("sends Discord embed with correct structure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });
    await notifier.notify(makeEvent());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.username).toBe("Agent Orchestrator");
    expect(body.embeds).toHaveLength(1);

    const embed = body.embeds[0];
    expect(embed.title).toContain("ao-5");
    expect(embed.title).toContain("reaction.escalated");
    expect(embed.description).toBe("CI failed after 5 retries");
    expect(embed.color).toBe(0xed4245); // red for urgent
    expect(embed.timestamp).toBe("2026-03-20T12:00:00.000Z");
    expect(embed.footer.text).toBe("Agent Orchestrator");
  });

  it("includes project and priority fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });
    await notifier.notify(makeEvent());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const fields = body.embeds[0].fields;
    expect(fields).toContainEqual(expect.objectContaining({ name: "Project", value: "ao" }));
    expect(fields).toContainEqual(expect.objectContaining({ name: "Priority", value: "urgent" }));
  });

  it("includes PR link when available", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });
    await notifier.notify(makeEvent({ data: { prUrl: "https://github.com/org/repo/pull/42" } }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const prField = body.embeds[0].fields.find((f: { name: string }) => f.name === "Pull Request");
    expect(prField.value).toContain("https://github.com/org/repo/pull/42");
  });

  it("includes CI status when available", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });
    await notifier.notify(makeEvent({ data: { ciStatus: "passing" } }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const ciField = body.embeds[0].fields.find((f: { name: string }) => f.name === "CI");
    expect(ciField.value).toContain("passing");
  });

  it("notifyWithActions includes action links", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });
    const actions: NotifyAction[] = [
      { label: "View PR", url: "https://github.com/org/repo/pull/42" },
      { label: "retry" },
    ];
    await notifier.notifyWithActions!(makeEvent(), actions);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const actionsField = body.embeds[0].fields.find((f: { name: string }) => f.name === "Actions");
    expect(actionsField.value).toContain("View PR");
    expect(actionsField.value).toContain("retry");
  });

  it("post sends plain content message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });
    await notifier.post!("Session ao-5 completed successfully");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.content).toBe("Session ao-5 completed successfully");
    expect(body.embeds).toBeUndefined();
  });

  it("uses custom username when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({ webhookUrl: "https://discord.com/api/webhooks/123/abc", username: "AO Bot" });
    await notifier.notify(makeEvent());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.username).toBe("AO Bot");
  });

  it("includes avatar_url when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      avatarUrl: "https://example.com/avatar.png",
    });
    await notifier.notify(makeEvent());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.avatar_url).toBe("https://example.com/avatar.png");
  });

  it("includes thread_id when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      threadId: "1234567890",
    });
    await notifier.notify(makeEvent());

    // Discord requires thread_id as a URL query param, not in the JSON body
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe("https://discord.com/api/webhooks/123/abc?thread_id=1234567890");
  });

  it("is a no-op when webhookUrl not configured", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create();
    await notifier.notify(makeEvent());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No webhookUrl configured"));
  });

  it("uses correct color for each priority", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });

    await notifier.notify(makeEvent({ priority: "info" }));
    let body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].color).toBe(0x57f287); // green

    await notifier.notify(makeEvent({ priority: "warning" }));
    body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.embeds[0].color).toBe(0xfee75c); // yellow
  });

  it("handles 204 No Content as success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({ webhookUrl: "https://discord.com/api/webhooks/123/abc" });
    await expect(notifier.notify(makeEvent())).resolves.toBeUndefined();
  });

  it("retries on 5xx response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve("down") })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      retries: 1,
      retryDelayMs: 50,
    });
    const promise = notifier.notify(makeEvent());

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(50);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await promise;
    vi.useRealTimers();
  });

  it("does not retry on 4xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
    vi.stubGlobal("fetch", fetchMock);

    const notifier = create({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      retries: 2,
      retryDelayMs: 1,
    });
    await expect(notifier.notify(makeEvent())).rejects.toThrow("Discord webhook failed (401)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("Thread Management", () => {
    const threadMapPath = getThreadMapPath();

    beforeEach(() => {
      // Clean up thread map before each test
      if (existsSync(threadMapPath)) {
        unlinkSync(threadMapPath);
      }
    });

    afterEach(() => {
      // Clean up thread map after each test
      if (existsSync(threadMapPath)) {
        unlinkSync(threadMapPath);
      }
    });

    it("creates thread on session spawn", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "thread-123" }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        channelId: "channel-456",
      });

      const session = makeSession({ id: "ao-5", issueId: "TEST-123" });
      await notifier.onSessionSpawned!(session);

      // Verify thread creation REST call
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe("https://discord.com/api/v10/channels/channel-456/threads");
      expect(call[1].method).toBe("POST");
      expect(call[1].headers.Authorization).toBe("Bot bot-token-123");

      const body = JSON.parse(call[1].body);
      expect(body.name).toBe("ao-5: TEST-123");
      expect(body.type).toBe(11); // PUBLIC_THREAD
      expect(body.auto_archive_duration).toBe(1440); // 24 hours
    });

    it("creates thread without issueId", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "thread-123" }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        channelId: "channel-456",
      });

      const session = makeSession({ id: "ao-5", issueId: null });
      await notifier.onSessionSpawned!(session);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.name).toBe("ao-5");
    });

    it("persists thread mapping to disk", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "thread-123" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "thread-456" }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        channelId: "channel-456",
      });

      const session = makeSession({ id: "ao-5", projectId: "test-proj" });
      await notifier.onSessionSpawned!(session);

      // Verify thread map file exists
      expect(existsSync(threadMapPath)).toBe(true);

      // Verify file permissions (0o600 on non-Windows)
      if (process.platform !== "win32") {
        const stats = statSync(threadMapPath);
        expect(stats.mode & 0o777).toBe(0o600);
      }

      // Verify content
      const content = JSON.parse(readFileSync(threadMapPath, "utf-8"));
      expect(content).toHaveLength(1);
      expect(content[0]).toMatchObject({
        sessionId: "ao-5",
        threadId: "thread-123",
        projectId: "test-proj",
      });
      expect(content[0].createdAt).toBeDefined();
      const firstCreatedAt = content[0].createdAt;

      // Spawn second session
      const session2 = makeSession({ id: "ao-6", projectId: "test-proj" });
      await notifier.onSessionSpawned!(session2);

      // Verify createdAt preserved for first session
      const content2 = JSON.parse(readFileSync(threadMapPath, "utf-8"));
      expect(content2).toHaveLength(2);
      const firstSessionEntry = content2.find((e: { sessionId: string }) => e.sessionId === "ao-5");
      expect(firstSessionEntry.createdAt).toBe(firstCreatedAt);
    });

    it("routes notifications to session thread", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "thread-123" }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        channelId: "channel-456",
      });

      // Create thread
      const session = makeSession({ id: "ao-5" });
      await notifier.onSessionSpawned!(session);

      // Send notification
      await notifier.notify(makeEvent({ sessionId: "ao-5" }));

      // Verify webhook URL includes thread_id query param
      const notificationUrl = fetchMock.mock.calls[1][0];
      expect(notificationUrl).toBe("https://discord.com/api/webhooks/123/abc?thread_id=thread-123");
    });

    it("falls back to base webhook URL for unknown session", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        channelId: "channel-456",
      });

      // Send notification for session without thread
      await notifier.notify(makeEvent({ sessionId: "unknown-session" }));

      const url = fetchMock.mock.calls[0][0];
      expect(url).toBe("https://discord.com/api/webhooks/123/abc");
    });

    it("archives thread on session termination", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "thread-123" }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200 }); // archive call
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        channelId: "channel-456",
      });

      // Create thread
      const session = makeSession({ id: "ao-5" });
      await notifier.onSessionSpawned!(session);

      // Terminate session
      await notifier.onSessionTerminated!(session);

      // Verify archive REST call
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const archiveCall = fetchMock.mock.calls[1];
      expect(archiveCall[0]).toBe("https://discord.com/api/v10/channels/thread-123");
      expect(archiveCall[1].method).toBe("PATCH");
      expect(archiveCall[1].headers.Authorization).toBe("Bot bot-token-123");

      const body = JSON.parse(archiveCall[1].body);
      expect(body.archived).toBe(true);
    });

    it("removes thread from mapping on termination", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "thread-123" }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        channelId: "channel-456",
      });

      const session = makeSession({ id: "ao-5" });
      await notifier.onSessionSpawned!(session);

      // Verify thread in map
      let content = JSON.parse(readFileSync(threadMapPath, "utf-8"));
      expect(content).toHaveLength(1);

      // Terminate
      await notifier.onSessionTerminated!(session);

      // Verify thread removed from map
      content = JSON.parse(readFileSync(threadMapPath, "utf-8"));
      expect(content).toHaveLength(0);
    });

    it("loads existing thread map on initialization", async () => {
      // Pre-populate thread map
      const aoDir = join(homedir(), ".ao");
      mkdirSync(aoDir, { recursive: true });
      const existingMap = [
        {
          sessionId: "ao-1",
          threadId: "thread-existing",
          projectId: "proj-1",
          createdAt: new Date().toISOString(),
        },
      ];
      writeFileSync(threadMapPath, JSON.stringify(existingMap), "utf-8");

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        channelId: "channel-456",
      });

      // Send notification to existing session
      await notifier.notify(makeEvent({ sessionId: "ao-1" }));

      const url = fetchMock.mock.calls[0][0];
      expect(url).toBe("https://discord.com/api/webhooks/123/abc?thread_id=thread-existing");
    });

    it("handles thread creation failure gracefully", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: () => Promise.resolve("Missing permissions"),
        });
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        channelId: "channel-456",
      });

      const session = makeSession({ id: "ao-5" });
      await notifier.onSessionSpawned!(session);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create thread for session ao-5"),
        expect.any(Error),
      );

      // Verify thread map is either empty or doesn't exist
      if (existsSync(threadMapPath)) {
        const content = JSON.parse(readFileSync(threadMapPath, "utf-8"));
        expect(content).toHaveLength(0);
      } else {
        // No file created is also correct behavior
        expect(true).toBe(true);
      }
    });

    it("handles thread archival failure gracefully", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "thread-123" }),
        })
        .mockRejectedValueOnce(new Error("Network error"));
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        channelId: "channel-456",
      });

      const session = makeSession({ id: "ao-5" });
      await notifier.onSessionSpawned!(session);
      await notifier.onSessionTerminated!(session);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to archive thread thread-123"),
        expect.any(Error),
      );

      // Thread still removed from map despite archival failure
      const content = JSON.parse(readFileSync(threadMapPath, "utf-8"));
      expect(content).toHaveLength(0);
    });

    it("is a no-op when botToken not configured", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        channelId: "channel-456",
        // botToken missing
      });

      const session = makeSession({ id: "ao-5" });
      await notifier.onSessionSpawned!(session);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(existsSync(threadMapPath)).toBe(false);
    });

    it("is a no-op when channelId not configured", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        // channelId missing
      });

      const session = makeSession({ id: "ao-5" });
      await notifier.onSessionSpawned!(session);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(existsSync(threadMapPath)).toBe(false);
    });

    it("handles malformed thread map gracefully", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);

      // Write invalid JSON (sessionId as number instead of string)
      const aoDir = join(homedir(), ".ao");
      mkdirSync(aoDir, { recursive: true });
      writeFileSync(threadMapPath, '[{"sessionId": 123, "threadId": "thread-1"}]', "utf-8");

      const notifier = create({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        botToken: "bot-token-123",
        channelId: "channel-456",
      });

      // Should start with empty map, log validation warning
      await notifier.notify(makeEvent({ sessionId: "ao-1" }));

      const url = fetchMock.mock.calls[0][0];
      expect(url).toBe("https://discord.com/api/webhooks/123/abc"); // No thread routing

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Thread map validation failed"),
        expect.anything(),
      );
    });
  });
});
