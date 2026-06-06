/**
 * Workstream manager (pipeline-v3, issue #199).
 *
 * A workstream is a named group of sibling worker sessions sharing a base
 * branch — created on the first `ao spawn --workstream <id>` and joined by
 * later spawns. Workstreams give pipeline-v3's workstream-scoped pipelines
 * a stable subject for fan-in triggers (`workstream.all_merged`, etc.) and
 * predicate evaluation (`all_workstream_workers_match`).
 *
 * Storage: one JSON file per workstream at
 *   {getProjectPipelinesDir(projectId)}/workstreams/{workstreamId}.json
 * The manager guarantees uniqueness of `workstreamId` within a project —
 * `getOrCreate(projectId, id)` returns the existing record if any, otherwise
 * writes a fresh one. `addMember` is idempotent (re-adding an existing
 * session is a no-op).
 *
 * Events: state mutations emit `WORKSTREAM_CREATED` and
 * `WORKSTREAM_MEMBER_ADDED` through the optional `onEvent` callback so the
 * lifecycle manager / dashboard can react without polling the disk.
 *
 * Aggregate state (which members have open PRs, which have merged, etc.) is
 * NOT stored here — the lifecycle manager recomputes it each poll from the
 * canonical session lifecycle so a workstream snapshot is always live and
 * never stale. This module only owns the membership ledger.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { atomicWriteFileSync } from "./atomic-write.js";
import { getProjectPipelinesDir } from "./paths.js";
import type { WorkstreamState } from "./types.js";

const WORKSTREAMS_SUBDIR = "workstreams";

export type WorkstreamEvent =
  | {
      type: "WORKSTREAM_CREATED";
      projectId: string;
      workstreamId: string;
      orchestratorSessionId?: string;
      baseBranch?: string;
      createdAt: string;
    }
  | {
      type: "WORKSTREAM_MEMBER_ADDED";
      projectId: string;
      workstreamId: string;
      sessionId: string;
      memberCount: number;
      addedAt: string;
    };

export interface WorkstreamManagerDeps {
  /** Override clock — defaults to `new Date()`. */
  now?: () => Date;
  /** Override storage root — defaults to {getProjectPipelinesDir(projectId)}. */
  rootForProject?: (projectId: string) => string;
  /** Receive WORKSTREAM_* events for downstream wiring (lifecycle, dashboard). */
  onEvent?: (event: WorkstreamEvent) => void;
}

export interface WorkstreamManager {
  /**
   * Read a workstream record. Returns `null` when none exists.
   */
  get(projectId: string, workstreamId: string): WorkstreamState | null;

  /**
   * Lookup-or-create. Emits WORKSTREAM_CREATED only the first time.
   *
   * `orchestratorSessionId` / `baseBranch` are recorded on the FIRST call only
   * — subsequent calls return the existing record verbatim. This keeps spawn
   * idempotent: re-running with the same id from a different shell is a
   * no-op rather than an overwrite.
   */
  getOrCreate(
    projectId: string,
    workstreamId: string,
    options?: { orchestratorSessionId?: string; baseBranch?: string },
  ): WorkstreamState;

  /**
   * Add a worker session to the workstream's member list. No-op if the
   * session is already a member. Emits WORKSTREAM_MEMBER_ADDED on first add.
   */
  addMember(projectId: string, workstreamId: string, sessionId: string): WorkstreamState;

  /** List every persisted workstream for a project. */
  list(projectId: string): WorkstreamState[];
}

export function createWorkstreamManager(deps: WorkstreamManagerDeps = {}): WorkstreamManager {
  const now = deps.now ?? (() => new Date());
  const rootForProject =
    deps.rootForProject ?? ((projectId: string) => getProjectPipelinesDir(projectId));
  const onEvent = deps.onEvent;

  function workstreamDir(projectId: string): string {
    return join(rootForProject(projectId), WORKSTREAMS_SUBDIR);
  }

  function workstreamPath(projectId: string, workstreamId: string): string {
    return join(workstreamDir(projectId), `${workstreamId}.json`);
  }

  function readRecord(projectId: string, workstreamId: string): WorkstreamState | null {
    const path = workstreamPath(projectId, workstreamId);
    if (!existsSync(path)) return null;
    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as WorkstreamState;
      // Defensive: ensure members is always an array.
      if (!Array.isArray(parsed.members)) parsed.members = [];
      return parsed;
    } catch {
      // Corrupt record — treat as missing so the caller can re-create.
      return null;
    }
  }

  function writeRecord(record: WorkstreamState): void {
    const dir = workstreamDir(record.projectId);
    mkdirSync(dir, { recursive: true });
    atomicWriteFileSync(workstreamPath(record.projectId, record.workstreamId), JSON.stringify(record, null, 2));
  }

  return {
    get(projectId, workstreamId) {
      return readRecord(projectId, workstreamId);
    },

    getOrCreate(projectId, workstreamId, options) {
      const existing = readRecord(projectId, workstreamId);
      if (existing) return existing;

      const ts = now().toISOString();
      const record: WorkstreamState = {
        workstreamId,
        projectId,
        ...(options?.orchestratorSessionId
          ? { orchestratorSessionId: options.orchestratorSessionId }
          : {}),
        ...(options?.baseBranch ? { baseBranch: options.baseBranch } : {}),
        members: [],
        createdAt: ts,
        updatedAt: ts,
      };
      writeRecord(record);
      onEvent?.({
        type: "WORKSTREAM_CREATED",
        projectId,
        workstreamId,
        ...(options?.orchestratorSessionId
          ? { orchestratorSessionId: options.orchestratorSessionId }
          : {}),
        ...(options?.baseBranch ? { baseBranch: options.baseBranch } : {}),
        createdAt: ts,
      });
      return record;
    },

    addMember(projectId, workstreamId, sessionId) {
      const existing = readRecord(projectId, workstreamId);
      if (!existing) {
        throw new Error(
          `Workstream "${workstreamId}" does not exist in project "${projectId}". Call getOrCreate first.`,
        );
      }
      if (existing.members.includes(sessionId)) return existing;

      const updated: WorkstreamState = {
        ...existing,
        members: [...existing.members, sessionId],
        updatedAt: now().toISOString(),
      };
      writeRecord(updated);
      onEvent?.({
        type: "WORKSTREAM_MEMBER_ADDED",
        projectId,
        workstreamId,
        sessionId,
        memberCount: updated.members.length,
        addedAt: updated.updatedAt,
      });
      return updated;
    },

    list(projectId) {
      const dir = workstreamDir(projectId);
      if (!existsSync(dir)) return [];
      const out: WorkstreamState[] = [];
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith(".json")) continue;
        const id = entry.slice(0, -".json".length);
        const record = readRecord(projectId, id);
        if (record) out.push(record);
      }
      return out;
    },
  };
}
