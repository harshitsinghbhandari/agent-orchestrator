// =============================================================================
// PORTFOLIO — Cross-project aggregation
// =============================================================================

import type { Session } from "./session.js";

/** A project entry in the portfolio index (merged from discovery + registration + preferences) */
export interface PortfolioProject {
  id: string;                          // Stable portfolio identity (configProjectKey, with collision suffix if needed)
  name: string;                        // Human-readable display name
  configPath: string;                  // Absolute path to agent-orchestrator.yaml
  configProjectKey: string;            // Key in config.projects map
  repoPath: string;                    // Absolute local filesystem path
  repo?: string;                       // "owner/repo" for SCM
  defaultBranch?: string;
  sessionPrefix: string;
  source: "discovered" | "registered" | "config"; // How this entry was found
  enabled: boolean;                    // User can disable without removing
  pinned: boolean;                     // User preference for ordering
  lastSeenAt: string;                  // ISO timestamp
  resolveError?: string;               // Present only when the project is degraded
}

/** User preferences overlay (canonical, small file) */
export interface PortfolioPreferences {
  version: 1;
  defaultProjectId?: string;
  projectOrder?: string[];             // Ordered project IDs for display
  projects?: Record<string, {          // Per-project preferences
    pinned?: boolean;
    enabled?: boolean;
    displayName?: string;
  }>;
}

/** Registered projects (explicit `ao project add`) */
export interface PortfolioRegistered {
  version: 1;
  projects: Array<{
    path: string;                      // Repo path
    configProjectKey?: string;         // Key in config if multi-project YAML
    addedAt: string;                   // ISO timestamp
  }>;
}

/** Aggregated portfolio session with project context */
export interface PortfolioSession {
  session: Session;
  project: PortfolioProject;
}
