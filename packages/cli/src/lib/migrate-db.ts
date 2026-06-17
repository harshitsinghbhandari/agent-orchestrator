/**
 * Offline SQLite writer for `ao migrate` (#2129).
 *
 * Runs with the rewrite daemon STOPPED. Creates the rewrite's `~/.ao/data/ao.db`
 * from a vendored copy of its goose migrations when absent, or inserts into an
 * existing (>= vendored) schema. Never re-runs migrations on a present DB.
 *
 * The vendored migrations under `./migrations/` are pinned to aoagents/ReverbCode
 * @ commit 43ae7eb (see the checksum test in __tests__/lib/migrations.test.ts).
 * `VENDORED_SCHEMA_VERSION` must equal the highest vendored migration number.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Highest vendored migration number. The `>= vendored` guard pivots on this. */
export const VENDORED_SCHEMA_VERSION = 12;

// Minimal structural type for the slice of better-sqlite3 we use (no @types dep).
export interface BetterSqlite3Statement {
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}
export interface BetterSqlite3Database {
  pragma(source: string, options?: { simple?: boolean }): unknown;
  exec(source: string): void;
  prepare(source: string): BetterSqlite3Statement;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  /** Lift the safe-mode guard so `writable_schema` edits (0007) are permitted. */
  unsafeMode(enabled: boolean): void;
  close(): void;
}
export type Sqlite3Ctor = new (
  path: string,
  options?: { fileMustExist?: boolean },
) => BetterSqlite3Database;

/**
 * A refusal: a precondition that means the caller must abort and leave the user
 * on legacy. Carries a stable `code` for the summary/exit-code contract.
 */
export class MigrateRefusal extends Error {
  constructor(
    readonly code:
      | "BETTER_SQLITE3_UNAVAILABLE"
      | "DB_LOCKED"
      | "SCHEMA_TOO_OLD",
    message: string,
  ) {
    super(message);
    this.name = "MigrateRefusal";
  }
}

/**
 * Lazy-load better-sqlite3 via createRequire so a native build failure surfaces
 * as a catchable refusal rather than an import-time crash (mirrors
 * packages/core/src/events-db.ts).
 */
export function loadBetterSqlite3(): Sqlite3Ctor {
  const _require = createRequire(import.meta.url);
  try {
    return _require("better-sqlite3") as Sqlite3Ctor;
  } catch (err) {
    throw new MigrateRefusal(
      "BETTER_SQLITE3_UNAVAILABLE",
      "better-sqlite3 is not available. Install it (it ships as an optional native dependency) and retry: " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

/** Directory holding the vendored `0001…0012.sql` files (works in src and dist). */
function defaultMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "migrations");
}

interface ParsedMigration {
  versionId: number;
  noTransaction: boolean;
  blocks: string[];
}

/**
 * Extract the executable `-- +goose Up` StatementBegin/End blocks from a goose v3
 * `.sql` file. CDC trigger bodies contain semicolons, so each StatementBegin…End
 * span is kept whole (a naive `;`-split would corrupt them).
 */
function parseGooseUp(versionId: number, sql: string): ParsedMigration {
  const noTransaction = /--\s*\+goose\s+NO\s+TRANSACTION/i.test(sql);

  const upIdx = sql.indexOf("-- +goose Up");
  let up = upIdx >= 0 ? sql.slice(upIdx) : sql;
  const downIdx = up.indexOf("-- +goose Down");
  if (downIdx >= 0) up = up.slice(0, downIdx);

  const blocks: string[] = [];
  const re = /--\s*\+goose\s+StatementBegin\b([\s\S]*?)--\s*\+goose\s+StatementEnd\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(up)) !== null) {
    const text = m[1].trim();
    if (text) blocks.push(text);
  }
  return { versionId, noTransaction, blocks };
}

/** Load + parse all vendored migrations in numeric order. */
function loadMigrations(migrationsDir: string): ParsedMigration[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  return files.map((file) => {
    const versionId = parseInt(file.slice(0, 4), 10);
    return parseGooseUp(versionId, readFileSync(join(migrationsDir, file), "utf-8"));
  });
}

/**
 * Stamp `goose_db_version` in the exact goose v3.27.1 sqlite3 format (one row per
 * applied migration; no version-0 seed row). After this, the rewrite's
 * `SELECT MAX(version_id)` reads the vendored version and boot-time `goose.Up`
 * applies nothing older.
 */
function stampGooseVersion(db: BetterSqlite3Database, versionIds: number[]): void {
  db.exec(`
    CREATE TABLE goose_db_version (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL,
      is_applied INTEGER NOT NULL,
      tstamp TIMESTAMP DEFAULT (datetime('now'))
    );
  `);
  const insert = db.prepare("INSERT INTO goose_db_version (version_id, is_applied) VALUES (?, 1)");
  const stamp = db.transaction((ids: number[]) => {
    for (const id of ids) insert.run(id);
  });
  stamp(versionIds);
}

/**
 * Build the schema by running the vendored migrations through a minimal
 * goose-compatible runner. NO-TRANSACTION files (0007's writable_schema rewrite)
 * run outside a transaction; everything else is wrapped per-file.
 */
function runGooseMigrations(db: BetterSqlite3Database, migrationsDir: string): void {
  const migrations = loadMigrations(migrationsDir);
  for (const migration of migrations) {
    if (migration.noTransaction) {
      // 0007 rewrites sqlite_master via `PRAGMA writable_schema`. better-sqlite3
      // blocks sqlite_master writes in safe mode, so lift the guard for the file.
      db.unsafeMode(true);
      try {
        for (const block of migration.blocks) db.exec(block);
      } finally {
        db.unsafeMode(false);
      }
    } else {
      const apply = db.transaction((blocks: string[]) => {
        for (const block of blocks) db.exec(block);
      });
      apply(migration.blocks);
    }
  }
  stampGooseVersion(
    db,
    migrations.map((m) => m.versionId),
  );
}

/** Read MAX(version_id); returns 0 if the goose table is absent (not a v-stamped DB). */
function readSchemaVersion(db: BetterSqlite3Database): number {
  try {
    const row = db.prepare("SELECT MAX(version_id) AS v FROM goose_db_version").get() as {
      v: number | null;
    } | null;
    return row?.v ?? 0;
  } catch {
    return 0;
  }
}

/** Probe for a write lock (a running rewrite daemon) with no wait. */
function assertNotLocked(db: BetterSqlite3Database): void {
  db.pragma("busy_timeout = 0");
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec("ROLLBACK");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/SQLITE_BUSY|database is locked/i.test(message)) {
      throw new MigrateRefusal(
        "DB_LOCKED",
        "The target database is locked. A rewrite daemon appears to be running; stop it (ao stop) and retry.",
      );
    }
    throw err;
  }
}

export interface OpenOptions {
  /** Override the better-sqlite3 loader (tests / mocking the missing-module path). */
  loader?: () => Sqlite3Ctor;
  /** Override the vendored migrations directory (tests). */
  migrationsDir?: string;
}

export interface OpenResult {
  db: BetterSqlite3Database;
  dbCreated: boolean;
  /** MAX(version_id) after preconditions — the `schemaVersion` reported in the summary. */
  schemaVersion: number;
}

/**
 * Apply the LOCKED precondition guard and return an open DB ready for inserts:
 *   - better-sqlite3 unavailable  -> REFUSE (BETTER_SQLITE3_UNAVAILABLE)
 *   - absent                      -> CREATE at the vendored schema (dbCreated=true)
 *   - present + locked            -> REFUSE (DB_LOCKED)
 *   - present + MAX(version) < 12  -> REFUSE (SCHEMA_TOO_OLD)
 *   - present + MAX(version) >= 12 -> open as-is (dbCreated=false)
 *
 * Existence is checked FIRST so a refusal never leaves a stray empty DB
 * (better-sqlite3 creates the file on open unless `fileMustExist`).
 */
export function openMigrationDb(dbPath: string, opts: OpenOptions = {}): OpenResult {
  let Database: Sqlite3Ctor;
  try {
    Database = (opts.loader ?? loadBetterSqlite3)();
  } catch (err) {
    if (err instanceof MigrateRefusal) throw err;
    // A custom loader (or any non-refusal failure) that cannot yield the
    // constructor means better-sqlite3 is effectively unavailable.
    throw new MigrateRefusal(
      "BETTER_SQLITE3_UNAVAILABLE",
      err instanceof Error ? err.message : String(err),
    );
  }
  const migrationsDir = opts.migrationsDir ?? defaultMigrationsDir();

  if (!existsSync(dbPath)) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    runGooseMigrations(db, migrationsDir);
    return { db, dbCreated: true, schemaVersion: readSchemaVersion(db) };
  }

  const db = new Database(dbPath, { fileMustExist: true });
  try {
    assertNotLocked(db);
    const schemaVersion = readSchemaVersion(db);
    if (schemaVersion < VENDORED_SCHEMA_VERSION) {
      throw new MigrateRefusal(
        "SCHEMA_TOO_OLD",
        `The target database is at schema v${schemaVersion}, older than this migrator expected (v${VENDORED_SCHEMA_VERSION}). Update the rewrite first.`,
      );
    }
    return { db, dbCreated: false, schemaVersion };
  } catch (err) {
    db.close();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Row shapes + inserts
// ---------------------------------------------------------------------------

/** A row for the `projects` table (§13). */
export interface ProjectRow {
  id: string;
  path: string;
  repo_origin_url: string;
  display_name: string;
  registered_at: string;
  kind: string;
  config: string | null;
}

/** A row for the `sessions` table (§13). `is_terminated` is 0/1. */
export interface SessionRow {
  id: string;
  project_id: string;
  num: number;
  kind: string;
  harness: string;
  activity_state: string;
  activity_last_at: string;
  is_terminated: 0 | 1;
  branch: string;
  workspace_path: string;
  runtime_handle_id: string;
  agent_session_id: string;
  prompt: string;
  display_name: string;
  first_signal_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertCounts {
  created: number;
  skipped: number;
  failed: number;
}

export interface InsertResult {
  projects: InsertCounts;
  orchestrators: InsertCounts;
}

const PROJECT_INSERT = `
  INSERT INTO projects (id, path, repo_origin_url, display_name, registered_at, kind, config)
  VALUES (@id, @path, @repo_origin_url, @display_name, @registered_at, @kind, @config)
  ON CONFLICT(id) DO NOTHING`;

const SESSION_INSERT = `
  INSERT INTO sessions (
    id, project_id, num, kind, harness, activity_state, activity_last_at,
    is_terminated, branch, workspace_path, runtime_handle_id, agent_session_id,
    prompt, display_name, first_signal_at, created_at, updated_at
  ) VALUES (
    @id, @project_id, @num, @kind, @harness, @activity_state, @activity_last_at,
    @is_terminated, @branch, @workspace_path, @runtime_handle_id, @agent_session_id,
    @prompt, @display_name, @first_signal_at, @created_at, @updated_at
  )
  ON CONFLICT(id) DO NOTHING`;

/**
 * Insert projects then orchestrators in one transaction (§10.4). Projects MUST
 * precede sessions: `sessions.project_id` FKs `projects(id)`, and the
 * `sessions_cdc_insert` trigger writes a `change_log` row whose `project_id` also
 * FKs `projects(id)`.
 *
 * `ON CONFLICT(id) DO NOTHING` makes this idempotent: an existing row stays
 * untouched (changes=0 -> skipped). A row that errors is counted as failed
 * (SQLite statement-level ABORT keeps the surrounding transaction usable).
 */
export function insertMigration(
  db: BetterSqlite3Database,
  projects: ProjectRow[],
  orchestrators: SessionRow[],
): InsertResult {
  db.pragma("foreign_keys = ON");

  const projectStmt = db.prepare(PROJECT_INSERT);
  const sessionStmt = db.prepare(SESSION_INSERT);

  const result: InsertResult = {
    projects: { created: 0, skipped: 0, failed: 0 },
    orchestrators: { created: 0, skipped: 0, failed: 0 },
  };

  const run = db.transaction(() => {
    for (const row of projects) {
      try {
        const info = projectStmt.run(row);
        if (info.changes === 1) result.projects.created++;
        else result.projects.skipped++;
      } catch {
        result.projects.failed++;
      }
    }
    for (const row of orchestrators) {
      try {
        const info = sessionStmt.run({ ...row, is_terminated: row.is_terminated });
        if (info.changes === 1) result.orchestrators.created++;
        else result.orchestrators.skipped++;
      } catch {
        result.orchestrators.failed++;
      }
    }
  });
  run();

  return result;
}
