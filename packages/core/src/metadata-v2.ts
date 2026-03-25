import { getDatabase } from "./db.js";
import type { SessionMetadata } from "./types.js";

export function readSessionMetadata(projectBaseDir: string, sessionId: string): SessionMetadata | null {
  const db = getDatabase(projectBaseDir);
  const stmt = db.prepare("SELECT metadataJson FROM sessions WHERE id = ?");
  const row = stmt.get(sessionId) as { metadataJson: string } | undefined;

  if (!row) return null;

  try {
    const raw = JSON.parse(row.metadataJson);
    return {
      worktree: raw.worktree ?? "",
      branch: raw.branch ?? "",
      status: raw.status ?? "unknown",
      tmuxName: raw.tmuxName,
      issue: raw.issue,
      pr: raw.pr,
      prAutoDetect: raw.prAutoDetect === "off" ? "off" : raw.prAutoDetect === "on" ? "on" : undefined,
      summary: raw.summary,
      project: raw.project,
      agent: raw.agent,
      createdAt: raw.createdAt,
      runtimeHandle: raw.runtimeHandle,
      restoredAt: raw.restoredAt,
      role: raw.role,
      dashboardPort: raw.dashboardPort ? Number(raw.dashboardPort) : undefined,
      terminalWsPort: raw.terminalWsPort ? Number(raw.terminalWsPort) : undefined,
      directTerminalWsPort: raw.directTerminalWsPort ? Number(raw.directTerminalWsPort) : undefined,
      opencodeSessionId: raw.opencodeSessionId,
    };
  } catch {
    return null;
  }
}

export function readSessionMetadataRaw(projectBaseDir: string, sessionId: string): Record<string, string> | null {
  const db = getDatabase(projectBaseDir);
  const stmt = db.prepare("SELECT metadataJson FROM sessions WHERE id = ?");
  const row = stmt.get(sessionId) as { metadataJson: string } | undefined;

  if (!row) return null;

  try {
    return JSON.parse(row.metadataJson);
  } catch {
    return null;
  }
}

export function writeSessionMetadata(projectBaseDir: string, sessionId: string, data: SessionMetadata): void {
  const db = getDatabase(projectBaseDir);

  const raw: Record<string, string> = {
    worktree: data.worktree,
    branch: data.branch,
    status: data.status,
  };

  if (data.tmuxName) raw.tmuxName = data.tmuxName;
  if (data.issue) raw.issue = data.issue;
  if (data.pr) raw.pr = data.pr;
  if (data.prAutoDetect) raw.prAutoDetect = data.prAutoDetect;
  if (data.summary) raw.summary = data.summary;
  if (data.project) raw.project = data.project;
  if (data.agent) raw.agent = data.agent;
  if (data.createdAt) raw.createdAt = data.createdAt;
  if (data.runtimeHandle) raw.runtimeHandle = data.runtimeHandle;
  if (data.restoredAt) raw.restoredAt = data.restoredAt;
  if (data.role) raw.role = data.role;
  if (data.dashboardPort !== undefined) raw.dashboardPort = String(data.dashboardPort);
  if (data.terminalWsPort !== undefined) raw.terminalWsPort = String(data.terminalWsPort);
  if (data.directTerminalWsPort !== undefined) raw.directTerminalWsPort = String(data.directTerminalWsPort);
  if (data.opencodeSessionId) raw.opencodeSessionId = data.opencodeSessionId;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (
      id, projectId, status, activity, branch, issueId, prUrl, prNumber,
      workspacePath, runtimeHandleJson, agentInfoJson, createdAt,
      lastActivityAt, restoredAt, metadataJson
    ) VALUES (
      @id, @projectId, @status, @activity, @branch, @issueId, @prUrl, @prNumber,
      @workspacePath, @runtimeHandleJson, @agentInfoJson, @createdAt,
      @lastActivityAt, @restoredAt, @metadataJson
    )
  `);

  stmt.run({
    id: sessionId,
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
    lastActivityAt: raw.createdAt || new Date().toISOString(),
    restoredAt: raw.restoredAt || null,
    metadataJson: JSON.stringify(raw),
  });
}

export function updateSessionMetadata(projectBaseDir: string, sessionId: string, updates: Partial<Record<string, string>>): void {
  const existing = readSessionMetadataRaw(projectBaseDir, sessionId) || {};

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value === "") {
      delete existing[key];
    } else {
      existing[key] = value;
    }
  }

  // To re-write the full record, we need a helper or just re-insert using writeSessionMetadata logic,
  // but with full fallback fields.
  const db = getDatabase(projectBaseDir);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (
      id, projectId, status, activity, branch, issueId, prUrl, prNumber,
      workspacePath, runtimeHandleJson, agentInfoJson, createdAt,
      lastActivityAt, restoredAt, metadataJson
    ) VALUES (
      @id, @projectId, @status, @activity, @branch, @issueId, @prUrl, @prNumber,
      @workspacePath, @runtimeHandleJson, @agentInfoJson, @createdAt,
      @lastActivityAt, @restoredAt, @metadataJson
    )
  `);

  stmt.run({
    id: sessionId,
    projectId: existing.project || "",
    status: existing.status || "unknown",
    activity: null,
    branch: existing.branch || null,
    issueId: existing.issue || null,
    prUrl: existing.pr || null,
    prNumber: null,
    workspacePath: existing.worktree || null,
    runtimeHandleJson: existing.runtimeHandle || null,
    agentInfoJson: null,
    createdAt: existing.createdAt || new Date().toISOString(),
    lastActivityAt: existing.createdAt || new Date().toISOString(),
    restoredAt: existing.restoredAt || null,
    metadataJson: JSON.stringify(existing),
  });
}

export function listSessionIds(projectBaseDir: string): string[] {
  const db = getDatabase(projectBaseDir);
  const stmt = db.prepare("SELECT id FROM sessions");
  const rows = stmt.all() as { id: string }[];
  return rows.map(r => r.id);
}

export function deleteSessionMetadata(projectBaseDir: string, sessionId: string): void {
  const db = getDatabase(projectBaseDir);
  const stmt = db.prepare("DELETE FROM sessions WHERE id = ?");
  stmt.run(sessionId);
}

export function reserveSessionId(projectBaseDir: string, sessionId: string): boolean {
  const db = getDatabase(projectBaseDir);

  try {
    const stmt = db.prepare(`
      INSERT INTO sessions (
        id, projectId, status, activity, branch, issueId, prUrl, prNumber,
        workspacePath, runtimeHandleJson, agentInfoJson, createdAt,
        lastActivityAt, restoredAt, metadataJson
      ) VALUES (
        @id, @projectId, @status, @activity, @branch, @issueId, @prUrl, @prNumber,
        @workspacePath, @runtimeHandleJson, @agentInfoJson, @createdAt,
        @lastActivityAt, @restoredAt, @metadataJson
      )
    `);

    db.transaction(() => {
      stmt.run({
        id: sessionId,
        projectId: "",
        status: "spawning",
        activity: null,
        branch: null,
        issueId: null,
        prUrl: null,
        prNumber: null,
        workspacePath: null,
        runtimeHandleJson: null,
        agentInfoJson: null,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        restoredAt: null,
        metadataJson: JSON.stringify({ status: "spawning", createdAt: new Date().toISOString() })
      });
    })();
    return true;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as any).code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return false;
    }
    throw err;
  }
}
