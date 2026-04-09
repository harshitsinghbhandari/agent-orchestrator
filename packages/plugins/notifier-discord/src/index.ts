import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  validateUrl,
  type PluginModule,
  type Notifier,
  type OrchestratorEvent,
  type NotifyAction,
  type NotifyContext,
  type EventPriority,
  type Session,
  CI_STATUS,
} from "@composio/ao-core";
import { isRetryableHttpStatus, normalizeRetryConfig } from "@composio/ao-core/utils";

export const manifest = {
  name: "discord",
  slot: "notifier" as const,
  description: "Notifier plugin: Discord webhook notifications with rich embeds and thread support",
  version: "0.1.0",
};

// Discord embed color codes (decimal)
const PRIORITY_COLOR: Record<EventPriority, number> = {
  urgent: 0xed4245, // red
  action: 0x5865f2, // blurple
  warning: 0xfee75c, // yellow
  info: 0x57f287, // green
};

const PRIORITY_EMOJI: Record<EventPriority, string> = {
  urgent: "\u{1F6A8}", // rotating light
  action: "\u{1F449}", // point right
  warning: "\u{26A0}\u{FE0F}", // warning
  info: "\u{2139}\u{FE0F}", // info
};

const DISCORD_WEBHOOK_URL_RE =
  /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\//;

const EMBED_DESCRIPTION_MAX = 4096;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Shared thread map file path for bot integration */
export function getThreadMapPath(): string {
  return join(homedir(), ".ao", "discord-thread-map.json");
}

interface ThreadMapEntry {
  sessionId: string;
  threadId: string;
  projectId: string;
  createdAt: string;
}

/** Persist thread map to disk for bot consumption */
function persistThreadMap(entries: Map<string, string>, projectIdMap: Map<string, string>): void {
  try {
    const aoDir = join(homedir(), ".ao");
    mkdirSync(aoDir, { recursive: true });

    const data: ThreadMapEntry[] = Array.from(entries.entries()).map(([sessionId, threadId]) => ({
      sessionId,
      threadId,
      projectId: projectIdMap.get(sessionId) ?? "unknown",
      createdAt: new Date().toISOString(),
    }));

    writeFileSync(getThreadMapPath(), JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[notifier-discord] Failed to persist thread map:", err);
  }
}

/** Load thread map from disk */
function loadThreadMap(): { threads: Map<string, string>; projects: Map<string, string> } {
  const threads = new Map<string, string>();
  const projects = new Map<string, string>();

  try {
    const data = JSON.parse(readFileSync(getThreadMapPath(), "utf-8")) as ThreadMapEntry[];
    for (const entry of data) {
      threads.set(entry.sessionId, entry.threadId);
      projects.set(entry.sessionId, entry.projectId);
    }
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  return { threads, projects };
}

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp?: string;
  footer?: { text: string };
}

function buildEmbed(event: OrchestratorEvent, actions?: NotifyAction[]): DiscordEmbed {
  const emoji = PRIORITY_EMOJI[event.priority];
  const description =
    event.message.length > EMBED_DESCRIPTION_MAX
      ? event.message.slice(0, EMBED_DESCRIPTION_MAX - 1) + "\u2026"
      : event.message;
  const embed: DiscordEmbed = {
    title: `${emoji} ${event.type} — ${event.sessionId}`,
    description,
    color: PRIORITY_COLOR[event.priority],
    fields: [
      { name: "Project", value: event.projectId, inline: true },
      { name: "Priority", value: event.priority, inline: true },
    ],
    timestamp: event.timestamp.toISOString(),
    footer: { text: "Agent Orchestrator" },
  };

  // Add PR link if available
  const prUrl = typeof event.data.prUrl === "string" ? event.data.prUrl : undefined;
  if (prUrl) {
    embed.fields!.push({ name: "Pull Request", value: `[View PR](${prUrl})`, inline: false });
  }

  // Add CI status if available
  const ciStatus = typeof event.data.ciStatus === "string" ? event.data.ciStatus : undefined;
  if (ciStatus) {
    const ciEmoji = ciStatus === CI_STATUS.PASSING ? "\u{2705}" : "\u{274C}";
    embed.fields!.push({ name: "CI", value: `${ciEmoji} ${ciStatus}`, inline: true });
  }

  // Add actions as a field
  if (actions && actions.length > 0) {
    const actionLinks = actions.map((a) => {
      if (a.url) return `[${a.label}](${a.url})`;
      return `\`${a.label}\``;
    });
    embed.fields!.push({ name: "Actions", value: actionLinks.join(" | "), inline: false });
  }

  return embed;
}

async function postWithRetry(
  webhookUrl: string,
  payload: Record<string, unknown>,
  retries: number,
  retryDelayMs: number,
): Promise<void> {
  let lastError: Error | undefined;
  // Separate counter for 429 Retry-After waits so they don't consume the error
  // retry budget — a server-mandated wait shouldn't cost a retry slot.
  let rateLimitRetries = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok || response.status === 204) return;

      // Handle rate limiting: wait then retry without burning an error retry slot.
      // Use Retry-After if present, otherwise fall back to retryDelayMs.
      if (response.status === 429) {
        if (rateLimitRetries < retries) {
          const retryAfter = response.headers.get("Retry-After");
          const waitMs = retryAfter ? (parseFloat(retryAfter) || 1) * 1000 : retryDelayMs;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          rateLimitRetries++;
          attempt--; // undo the for-loop increment so error budget is preserved
          continue;
        }
        // Rate-limit budget exhausted — fail immediately rather than falling through
        // to the error retry path (which would compound the two counters).
        const body = await response.text().catch(() => "");
        lastError = new Error(`Discord webhook rate-limited (HTTP 429)${body ? `: ${body.trim()}` : ""}`);
        throw lastError;
      }

      const body = await response.text();
      lastError = new Error(`Discord webhook failed (${response.status}): ${body}`);

      if (!isRetryableHttpStatus(response.status)) {
        throw lastError;
      }
    } catch (err) {
      if (err === lastError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) {
      const delay = retryDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export function create(config?: Record<string, unknown>): Notifier {
  const webhookUrl = config?.webhookUrl as string | undefined;
  const username = (config?.username as string) ?? "Agent Orchestrator";
  const avatarUrl = config?.avatarUrl as string | undefined;
  const threadId = config?.threadId as string | undefined;
  const botToken = config?.botToken as string | undefined;
  const channelId = config?.channelId as string | undefined;

  const { retries, retryDelayMs } = normalizeRetryConfig(config);

  // Thread management (session ID → thread ID) — load existing map from disk
  const { threads: threadMap, projects: projectIdMap } = loadThreadMap();

  if (!webhookUrl) {
    console.warn(
      "[notifier-discord] No webhookUrl configured.\n" +
      "  Set it in agent-orchestrator.yaml under notifiers.discord.webhookUrl\n" +
      "  Create a webhook: Discord Server Settings > Integrations > Webhooks > New Webhook",
    );
  } else {
    validateUrl(webhookUrl, "notifier-discord");
    if (!DISCORD_WEBHOOK_URL_RE.test(webhookUrl)) {
      console.warn(
        "[notifier-discord] webhookUrl does not match expected Discord webhook format.\n" +
        "  Expected: https://discord.com/api/webhooks/... or https://discordapp.com/api/webhooks/...",
      );
    }
  }

  // If botToken + channelId are configured, enable per-session threads
  if (botToken && channelId) {
    console.log("[notifier-discord] Thread support enabled (botToken + channelId configured)");
  } else if (botToken || channelId) {
    console.warn(
      "[notifier-discord] Partial thread config detected.\n" +
      "  Thread support requires BOTH botToken and channelId.\n" +
      "  Current: botToken=" + (botToken ? "set" : "missing") + ", channelId=" + (channelId ? "set" : "missing"),
    );
  }

  // Discord requires thread_id as a URL query param, not in the JSON body
  const effectiveUrl = webhookUrl && threadId
    ? `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}thread_id=${encodeURIComponent(threadId)}`
    : webhookUrl;

  function buildPayload(embeds: DiscordEmbed[]): Record<string, unknown> {
    const payload: Record<string, unknown> = { username, embeds };
    if (avatarUrl) payload.avatar_url = avatarUrl;
    return payload;
  }

  /** Get webhook URL for a specific session (with thread if available) */
  function getWebhookUrlForSession(sessionId: string): string | undefined {
    if (!webhookUrl) return undefined;
    const threadForSession = threadMap.get(sessionId);
    if (threadForSession) {
      return `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}thread_id=${encodeURIComponent(threadForSession)}`;
    }
    return effectiveUrl;
  }

  /** Create a Discord thread via REST API */
  async function createThread(session: Session): Promise<string | null> {
    if (!botToken || !channelId) return null;

    const threadName = session.issueId
      ? `${session.id}: ${session.issueId}`
      : `${session.id}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/threads`, {
        method: "POST",
        headers: {
          "Authorization": `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: threadName,
          auto_archive_duration: 1440, // 24 hours
          type: 11, // PUBLIC_THREAD
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Discord thread creation failed (${response.status}): ${body}`);
      }

      const data = (await response.json()) as { id?: string };
      return data.id ?? null;
    } catch (err) {
      console.error(`[notifier-discord] Failed to create thread for session ${session.id}:`, err);
      return null;
    }
  }

  /** Archive a Discord thread via REST API */
  async function archiveThread(threadId: string): Promise<void> {
    if (!botToken) return;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      await fetch(`https://discord.com/api/v10/channels/${threadId}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          archived: true,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
    } catch (err) {
      console.error(`[notifier-discord] Failed to archive thread ${threadId}:`, err);
    }
  }

  return {
    name: "discord",

    async notify(event: OrchestratorEvent): Promise<void> {
      const url = getWebhookUrlForSession(event.sessionId);
      if (!url) return;
      const payload = buildPayload([buildEmbed(event)]);
      await postWithRetry(url, payload, retries, retryDelayMs);
    },

    async notifyWithActions(event: OrchestratorEvent, actions: NotifyAction[]): Promise<void> {
      const url = getWebhookUrlForSession(event.sessionId);
      if (!url) return;
      const payload = buildPayload([buildEmbed(event, actions)]);
      await postWithRetry(url, payload, retries, retryDelayMs);
    },

    async post(message: string, context?: NotifyContext): Promise<string | null> {
      const url = context?.sessionId
        ? getWebhookUrlForSession(context.sessionId)
        : effectiveUrl;
      if (!url) return null;
      const payload: Record<string, unknown> = { username, content: message };
      if (avatarUrl) payload.avatar_url = avatarUrl;
      await postWithRetry(url, payload, retries, retryDelayMs);
      return null;
    },

    async onSessionSpawned(session: Session): Promise<void> {
      const threadIdCreated = await createThread(session);
      if (threadIdCreated) {
        threadMap.set(session.id, threadIdCreated);
        projectIdMap.set(session.id, session.projectId);
        persistThreadMap(threadMap, projectIdMap);
        console.log(`[notifier-discord] Created thread ${threadIdCreated} for session ${session.id}`);
      }
    },

    async onSessionTerminated(session: Session): Promise<void> {
      const threadIdToArchive = threadMap.get(session.id);
      if (threadIdToArchive) {
        await archiveThread(threadIdToArchive);
        threadMap.delete(session.id);
        projectIdMap.delete(session.id);
        persistThreadMap(threadMap, projectIdMap);
        console.log(`[notifier-discord] Archived thread ${threadIdToArchive} for session ${session.id}`);
      }
    },
  };
}

export default { manifest, create } satisfies PluginModule<Notifier>;
