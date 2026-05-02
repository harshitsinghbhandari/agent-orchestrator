/**
 * notifier-mock plugin — Mock notifier for testing external plugin loading.
 *
 * This plugin implements the Notifier interface with functional mock behavior.
 */

import type {
  PluginModule,
  Notifier,
  OrchestratorEvent,
  NotifyAction,
  NotifyContext,
} from "@composio/ao-core";

// ---------------------------------------------------------------------------
// Notification Storage
// ---------------------------------------------------------------------------

interface StoredNotification {
  timestamp: Date;
  title: string;
  message: string;
  event: OrchestratorEvent;
  actions?: NotifyAction[];
}

const notifications: StoredNotification[] = [];

// Track calls for testing
const callLog: Array<{ method: string; args: unknown[] }> = [];

function logCall(method: string, ...args: unknown[]): void {
  callLog.push({ method, args });
  console.log(`[notifier-mock] ${method}(${JSON.stringify(args).slice(1, -1)})`);
}

// ---------------------------------------------------------------------------
// Notifier implementation
// ---------------------------------------------------------------------------

function createMockNotifier(config?: Record<string, unknown>): Notifier {
  const prefix = (config?.prefix as string) || "[MOCK]";
  const silent = config?.silent === true;

  return {
    name: "mock",

    async notify(event: OrchestratorEvent): Promise<void> {
      logCall("notify", event.type, event.sessionId);

      const title = `${prefix} ${event.priority.toUpperCase()}: ${event.sessionId}`;
      const message = event.message;

      notifications.push({
        timestamp: new Date(),
        title,
        message,
        event,
      });

      if (!silent) {
        console.log(`[notifier-mock] NOTIFICATION:`);
        console.log(`  Title: ${title}`);
        console.log(`  Message: ${message}`);
        console.log(`  Type: ${event.type}`);
        console.log(`  Priority: ${event.priority}`);
      }
    },

    async notifyWithActions(event: OrchestratorEvent, actions: NotifyAction[]): Promise<void> {
      logCall("notifyWithActions", event.type, event.sessionId, actions.length);

      const title = `${prefix} ${event.priority.toUpperCase()}: ${event.sessionId}`;
      const actionLabels = actions.map((a) => a.label).join(" | ");
      const message = `${event.message}\n\nActions: ${actionLabels}`;

      notifications.push({
        timestamp: new Date(),
        title,
        message,
        event,
        actions,
      });

      if (!silent) {
        console.log(`[notifier-mock] NOTIFICATION WITH ACTIONS:`);
        console.log(`  Title: ${title}`);
        console.log(`  Message: ${message}`);
        console.log(`  Actions: ${actions.map((a) => a.label).join(", ")}`);
      }
    },

    async post(message: string, context?: NotifyContext): Promise<string | null> {
      logCall("post", message, context);

      const postId = `mock-post-${Date.now()}`;

      if (!silent) {
        console.log(`[notifier-mock] POST:`);
        console.log(`  Message: ${message}`);
        if (context?.sessionId) console.log(`  Session: ${context.sessionId}`);
        if (context?.projectId) console.log(`  Project: ${context.projectId}`);
        if (context?.prUrl) console.log(`  PR: ${context.prUrl}`);
        console.log(`  Post ID: ${postId}`);
      }

      return postId;
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin module export
// ---------------------------------------------------------------------------

export const manifest = {
  name: "mock",
  slot: "notifier" as const,
  description: "Notifier plugin: Mock notifications for testing",
  version: "0.1.0",
};

export function create(config?: Record<string, unknown>): Notifier {
  console.log("[notifier-mock] Creating mock notifier plugin", config);
  return createMockNotifier(config);
}

/** Get all stored notifications (for testing) */
export function getNotifications(): StoredNotification[] {
  return [...notifications];
}

/** Clear stored notifications (for testing) */
export function clearNotifications(): void {
  notifications.length = 0;
}

/** Export call log for testing */
export function getCallLog(): Array<{ method: string; args: unknown[] }> {
  return [...callLog];
}

/** Clear call log for testing */
export function clearCallLog(): void {
  callLog.length = 0;
}

export default { manifest, create } satisfies PluginModule<Notifier>;
