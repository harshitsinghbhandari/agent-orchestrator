import type { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { Client, GatewayIntentBits, type Message } from "discord.js";
import { loadConfig } from "@composio/ao-core";
import { getSessionManager } from "../lib/create-session-manager.js";
import { getThreadMapPath } from "@composio/ao-plugin-notifier-discord";

interface ThreadMapEntry {
  sessionId: string;
  threadId: string;
  projectId: string;
  createdAt: string;
}

/** Load thread map from disk */
function loadThreadMap(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const data = JSON.parse(readFileSync(getThreadMapPath(), "utf-8")) as ThreadMapEntry[];
    for (const entry of data) {
      map.set(entry.threadId, entry.sessionId);
    }
  } catch {
    // File doesn't exist or is invalid — return empty map
  }
  return map;
}

/** Parse command from message content */
function parseCommand(content: string): { type: "approve" | "reject" | "kill" | "skip" | "text"; text: string } {
  const trimmed = content.trim().toLowerCase();

  if (trimmed === "y" || trimmed === "yes") {
    return { type: "approve", text: "y\n" };
  }

  if (trimmed === "n" || trimmed === "no") {
    return { type: "reject", text: "n\n" };
  }

  if (trimmed === "kill") {
    return { type: "kill", text: "" };
  }

  if (trimmed === "skip") {
    return { type: "skip", text: "\n" };
  }

  return { type: "text", text: content };
}

export function registerDiscordBot(program: Command): void {
  program
    .command("discord-bot")
    .description("Discord bot for two-way interaction with agent sessions")
    .action(async () => {
      const config = loadConfig();

      // Extract Discord config from notifiers
      const discordConfig = Object.values(config.notifiers).find((n) => n.plugin === "discord");
      const botToken = (discordConfig as Record<string, unknown> | undefined)?.botToken as string | undefined;

      if (!botToken) {
        console.error(chalk.red("No Discord bot token found in config."));
        console.error(chalk.yellow("Add botToken to notifiers.discord in agent-orchestrator.yaml"));
        process.exit(1);
      }

      console.log(chalk.cyan("Starting Discord bot..."));

      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      let shuttingDown = false;

      const shutdown = (code: number): void => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(chalk.yellow("\nShutting down Discord bot..."));
        client.destroy();
        process.exit(code);
      };

      process.on("SIGINT", () => shutdown(0));
      process.on("SIGTERM", () => shutdown(0));

      client.on("ready", () => {
        console.log(chalk.green(`✓ Discord bot ready as ${client.user?.tag}`));
        console.log(chalk.dim("Listening for replies in session threads..."));
      });

      client.on("messageCreate", async (message: Message) => {
        // Ignore bot's own messages
        if (message.author.bot) return;

        // Only process messages in threads
        if (!message.channel.isThread()) return;

        const threadId = message.channel.id;

        // Reload thread map on every message (file I/O is negligible)
        const threadMap = loadThreadMap();
        const sessionId = threadMap.get(threadId);

        if (!sessionId) {
          // Not a session thread — ignore
          return;
        }

        console.log(chalk.dim(`[${sessionId}] Received: ${message.content}`));

        const command = parseCommand(message.content);
        const sessionManager = await getSessionManager(config);

        try {
          if (command.type === "kill") {
            // Kill session
            await sessionManager.kill(sessionId);
            await message.reply(`✅ Killed session ${sessionId}`);
            console.log(chalk.yellow(`[${sessionId}] Killed`));
          } else {
            // Send input to session
            await sessionManager.send(sessionId, command.text);

            // Confirm with emoji based on command type
            const emoji = command.type === "approve"
              ? "✅"
              : command.type === "reject"
                ? "❌"
                : command.type === "skip"
                  ? "⏭️"
                  : "📨";

            await message.react(emoji);
            console.log(chalk.green(`[${sessionId}] Sent: ${command.text.replace("\n", "\\n")}`));
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          await message.reply(`❌ Error: ${errorMsg}`);
          console.error(chalk.red(`[${sessionId}] Error: ${errorMsg}`));
        }
      });

      client.on("error", (err) => {
        console.error(chalk.red("Discord client error:"), err);
      });

      await client.login(botToken);
    });
}
