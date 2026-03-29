import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import type { SessionId, SessionMetadata } from "../types.js";
import { parseKeyValueContent } from "../key-value.js";
import { MetadataError } from "../errors.js";

// Helper for atomic file writes using promises
async function atomicWriteFileAsync(path: string, content: string): Promise<void> {
  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, path);
}

function serializeMetadata(data: Record<string, string>): string {
  return (
    Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}

const VALID_SESSION_ID = /^[a-zA-Z0-9_-]+$/;

function validateSessionId(sessionId: SessionId): void {
  if (!VALID_SESSION_ID.test(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
}

function metadataPath(dataDir: string, sessionId: SessionId): string {
  validateSessionId(sessionId);
  return join(dataDir, sessionId);
}

export interface MetadataService {
  get(dataDir: string, sessionId: SessionId): Promise<SessionMetadata | null>;
  update(dataDir: string, sessionId: SessionId, updates: Partial<Record<string, string>>): Promise<void>;
  archive(dataDir: string, sessionId: SessionId): Promise<void>;
}

export const metadataService: MetadataService = {
  async get(dataDir: string, sessionId: SessionId): Promise<SessionMetadata | null> {
    const path = metadataPath(dataDir, sessionId);
    try {
      const content = await fs.readFile(path, "utf-8");
      const raw = parseKeyValueContent(content);

      return {
        worktree: raw["worktree"] ?? "",
        branch: raw["branch"] ?? "",
        status: raw["status"] ?? "unknown",
        tmuxName: raw["tmuxName"],
        issue: raw["issue"],
        pr: raw["pr"],
        prAutoDetect:
          raw["prAutoDetect"] === "off" ? "off" : raw["prAutoDetect"] === "on" ? "on" : undefined,
        summary: raw["summary"],
        project: raw["project"],
        agent: raw["agent"],
        createdAt: raw["createdAt"],
        runtimeHandle: raw["runtimeHandle"],
        restoredAt: raw["restoredAt"],
        role: raw["role"],
        dashboardPort: raw["dashboardPort"] ? Number(raw["dashboardPort"]) : undefined,
        terminalWsPort: raw["terminalWsPort"] ? Number(raw["terminalWsPort"]) : undefined,
        directTerminalWsPort: raw["directTerminalWsPort"]
          ? Number(raw["directTerminalWsPort"])
          : undefined,
        opencodeSessionId: raw["opencodeSessionId"],
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw new MetadataError(`Failed to read metadata for session ${sessionId}`, sessionId, err instanceof Error ? err : new Error(String(err)));
    }
  },

  async update(dataDir: string, sessionId: SessionId, updates: Partial<Record<string, string>>): Promise<void> {
    const path = metadataPath(dataDir, sessionId);
    let existing: Record<string, string> = {};

    try {
      try {
        const content = await fs.readFile(path, "utf-8");
        existing = parseKeyValueContent(content);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      }

      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) continue;
        if (value === "") {
          const { [key]: _, ...rest } = existing;
          existing = rest;
        } else {
          existing[key] = value;
        }
      }

      await fs.mkdir(dirname(path), { recursive: true });
      await atomicWriteFileAsync(path, serializeMetadata(existing));
    } catch (err: unknown) {
      throw new MetadataError(`Failed to update metadata for session ${sessionId}`, sessionId, err instanceof Error ? err : new Error(String(err)));
    }
  },

  async archive(dataDir: string, sessionId: SessionId): Promise<void> {
    const path = metadataPath(dataDir, sessionId);
    try {
      const content = await fs.readFile(path, "utf-8");
      const archiveDir = join(dataDir, "archive");
      await fs.mkdir(archiveDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archivePath = join(archiveDir, `${sessionId}_${timestamp}`);
      await atomicWriteFileAsync(archivePath, content);
      await fs.unlink(path);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw new MetadataError(`Failed to archive metadata for session ${sessionId}`, sessionId, err instanceof Error ? err : new Error(String(err)));
    }
  }
};
