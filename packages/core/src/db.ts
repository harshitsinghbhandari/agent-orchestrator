import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { readMetadataRaw, listMetadata } from "./metadata.js";

const dbInstances = new Map<string, Database.Database>();

export function getDatabase(projectBaseDir: string): Database.Database {
  if (dbInstances.has(projectBaseDir)) {
    return dbInstances.get(projectBaseDir)!;
  }

  mkdirSync(projectBaseDir, { recursive: true });
  const dbPath = join(projectBaseDir, "state.db");
  const isNewDb = !existsSync(dbPath);

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      status TEXT,
      activity TEXT,
      branch TEXT,
      issueId TEXT,
      prUrl TEXT,
      prNumber INTEGER,
      workspacePath TEXT,
      runtimeHandleJson TEXT,
      agentInfoJson TEXT,
      createdAt TEXT,
      lastActivityAt TEXT,
      restoredAt TEXT,
      metadataJson TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT,
      nodeId TEXT,
      operation TEXT,
      model TEXT,
      inputTokens INTEGER,
      outputTokens INTEGER,
      estimatedCostUsd REAL,
      timestamp TEXT
    )
  `);

  // Run migration just in case flat files exist and DB doesn't have them
  if (isNewDb) {
    migrateV1ToV2(projectBaseDir, db);
  } else {
    migrateV1ToV2(projectBaseDir, db);
  }

  dbInstances.set(projectBaseDir, db);
  return db;
}

export function migrateV1ToV2(projectBaseDir: string, db: Database.Database): void {
  const sessionsDir = join(projectBaseDir, "sessions");
  if (!existsSync(sessionsDir)) return;

  const sessionIds = listMetadata(sessionsDir);
  if (sessionIds.length === 0) return;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO sessions (
      id, projectId, status, activity, branch, issueId, prUrl, prNumber,
      workspacePath, runtimeHandleJson, agentInfoJson, createdAt,
      lastActivityAt, restoredAt, metadataJson
    ) VALUES (
      @id, @projectId, @status, @activity, @branch, @issueId, @prUrl, @prNumber,
      @workspacePath, @runtimeHandleJson, @agentInfoJson, @createdAt,
      @lastActivityAt, @restoredAt, @metadataJson
    )
  `);

  const transaction = db.transaction((ids: string[]) => {
    for (const id of ids) {
      const raw = readMetadataRaw(sessionsDir, id);
      if (!raw) continue;

      insertStmt.run({
        id,
        projectId: raw.project || "",
        status: raw.status || "unknown",
        activity: null,
        branch: raw.branch || null,
        issueId: raw.issue || null,
        prUrl: raw.pr || null,
        prNumber: null,
        workspacePath: raw.worktree || null,
        runtimeHandleJson: raw.runtimeHandle || null,
        agentInfoJson: null,
        createdAt: raw.createdAt || new Date().toISOString(),
        lastActivityAt: raw.createdAt || new Date().toISOString(), // Fallback
        restoredAt: raw.restoredAt || null,
        metadataJson: JSON.stringify(raw),
      });
    }
  });

  transaction(sessionIds);
}
