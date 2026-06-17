import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  VENDORED_SCHEMA_VERSION,
  MigrateRefusal,
  openMigrationDb,
  insertMigration,
  loadBetterSqlite3,
  type ProjectRow,
  type SessionRow,
  type Sqlite3Ctor,
} from "../../src/lib/migrate-db.js";

const _require = createRequire(import.meta.url);

// Skip the whole suite if better-sqlite3 cannot load in this environment
// (native build failure). The migrator itself refuses in that case; there is
// nothing to integration-test without it.
let sqlite3Available = true;
try {
  loadBetterSqlite3();
} catch {
  sqlite3Available = false;
}

const NOW = "2026-06-18T00:00:00.000Z";

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "proj",
    path: "/repos/proj",
    repo_origin_url: "",
    display_name: "",
    registered_at: NOW,
    kind: "single_repo",
    config: null,
    ...overrides,
  };
}

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "proj-orchestrator",
    project_id: "proj",
    num: 0,
    kind: "orchestrator",
    harness: "claude-code",
    activity_state: "idle",
    activity_last_at: NOW,
    is_terminated: 0,
    branch: "",
    workspace_path: "",
    runtime_handle_id: "",
    agent_session_id: "",
    prompt: "",
    display_name: "",
    first_signal_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe.skipIf(!sqlite3Available)("migrate-db (integration, better-sqlite3)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ao-migrate-db-"));
    dbPath = join(dir, "ao.db");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds the DB from vendored migrations at the vendored schema version", () => {
    const { db, dbCreated, schemaVersion } = openMigrationDb(dbPath);
    try {
      expect(dbCreated).toBe(true);
      expect(schemaVersion).toBe(VENDORED_SCHEMA_VERSION);
      expect(schemaVersion).toBe(12);

      const max = db
        .prepare("SELECT MAX(version_id) AS v FROM goose_db_version")
        .get() as { v: number };
      expect(max.v).toBe(12);

      const tables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(tables).toEqual(
        expect.arrayContaining(["projects", "sessions", "pr", "change_log", "goose_db_version"]),
      );
    } finally {
      db.close();
    }
  });

  // The single highest-value assertion: proves 0007 ran AND that
  // `PRAGMA writable_schema = RESET` took effect on better-sqlite3's bundled
  // SQLite — otherwise a `cursor` harness would fail the (un-widened) CHECK.
  it("applies 0007 so a widened harness (cursor) inserts successfully", () => {
    const { db } = openMigrationDb(dbPath);
    try {
      db.prepare(
        `INSERT INTO projects (id, path, repo_origin_url, display_name, registered_at, kind, config)
         VALUES ('p', '/p', '', '', ?, 'single_repo', NULL)`,
      ).run(NOW);
      expect(() =>
        db
          .prepare(
            `INSERT INTO sessions (id, project_id, num, kind, harness, activity_state, activity_last_at, created_at, updated_at)
             VALUES ('p-1', 'p', 1, 'worker', 'cursor', 'idle', ?, ?, ?)`,
          )
          .run(NOW, NOW, NOW),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("inserts projects before sessions and fires exactly one session_created CDC row", () => {
    const { db } = openMigrationDb(dbPath);
    try {
      const result = insertMigration(db, [projectRow()], [sessionRow()]);
      expect(result.projects).toEqual({ created: 1, skipped: 0, failed: 0 });
      expect(result.orchestrators).toEqual({ created: 1, skipped: 0, failed: 0 });

      const changes = db
        .prepare("SELECT event_type, project_id, session_id FROM change_log")
        .all() as Array<{ event_type: string; project_id: string; session_id: string }>;
      expect(changes).toEqual([
        { event_type: "session_created", project_id: "proj", session_id: "proj-orchestrator" },
      ]);
    } finally {
      db.close();
    }
  });

  it("is idempotent: a re-run inserts nothing and counts everything skipped", () => {
    const first = openMigrationDb(dbPath);
    insertMigration(first.db, [projectRow()], [sessionRow()]);
    first.db.close();

    const second = openMigrationDb(dbPath);
    try {
      expect(second.dbCreated).toBe(false);
      const result = insertMigration(second.db, [projectRow()], [sessionRow()]);
      expect(result.projects).toEqual({ created: 0, skipped: 1, failed: 0 });
      expect(result.orchestrators).toEqual({ created: 0, skipped: 1, failed: 0 });

      const projectCount = second.db
        .prepare("SELECT COUNT(*) AS c FROM projects")
        .get() as { c: number };
      expect(projectCount.c).toBe(1);
      // No new CDC row from the no-op session insert.
      const changeCount = second.db
        .prepare("SELECT COUNT(*) AS c FROM change_log")
        .get() as { c: number };
      expect(changeCount.c).toBe(1);
    } finally {
      second.db.close();
    }
  });

  describe("preconditions", () => {
    it("absent DB -> creates (dbCreated=true)", () => {
      expect(existsSync(dbPath)).toBe(false);
      const { db, dbCreated } = openMigrationDb(dbPath);
      db.close();
      expect(dbCreated).toBe(true);
      expect(existsSync(dbPath)).toBe(true);
    });

    it("present at >= vendored -> opens read-existing and inserts (dbCreated=false)", () => {
      openMigrationDb(dbPath).db.close();
      const { db, dbCreated, schemaVersion } = openMigrationDb(dbPath);
      try {
        expect(dbCreated).toBe(false);
        expect(schemaVersion).toBe(12);
        const result = insertMigration(db, [projectRow()], []);
        expect(result.projects.created).toBe(1);
      } finally {
        db.close();
      }
    });

    it("present below vendored -> refuses", () => {
      // Build a DB then strip versions down to 11 to simulate an older schema.
      const created = openMigrationDb(dbPath);
      created.db.prepare("DELETE FROM goose_db_version WHERE version_id >= 12").run();
      created.db.close();

      expect(() => openMigrationDb(dbPath)).toThrow(MigrateRefusal);
      try {
        openMigrationDb(dbPath);
      } catch (err) {
        expect((err as MigrateRefusal).code).toBe("SCHEMA_TOO_OLD");
      }
    });

    it("locked DB -> refuses", () => {
      openMigrationDb(dbPath).db.close();
      const Database = loadBetterSqlite3();
      const holder = new Database(dbPath);
      // Hold a write lock so the migrator's busy_timeout=0 probe sees SQLITE_BUSY.
      holder.exec("BEGIN IMMEDIATE");
      try {
        expect(() => openMigrationDb(dbPath)).toThrow(MigrateRefusal);
        try {
          openMigrationDb(dbPath);
        } catch (err) {
          expect((err as MigrateRefusal).code).toBe("DB_LOCKED");
        }
      } finally {
        holder.exec("ROLLBACK");
        holder.close();
      }
    });

    it("better-sqlite3 unavailable -> refuses", () => {
      const loader = (): Sqlite3Ctor => {
        throw new Error("Cannot find module 'better-sqlite3'");
      };
      expect(() => openMigrationDb(dbPath, { loader })).toThrow(MigrateRefusal);
      try {
        openMigrationDb(dbPath, { loader });
      } catch (err) {
        expect((err as MigrateRefusal).code).toBe("BETTER_SQLITE3_UNAVAILABLE");
      }
    });
  });
});

// Sanity guard so the suite is not silently skipped in CI where the native
// module is expected to be present.
it("better-sqlite3 is resolvable for the integration suite", () => {
  expect(() => _require.resolve("better-sqlite3")).not.toThrow();
});
