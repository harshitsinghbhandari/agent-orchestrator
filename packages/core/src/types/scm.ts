// =============================================================================
// SCM — Plugin Slot 5
// =============================================================================

import type { Session } from "./session.js";
import type { ProjectConfig } from "./config.js";
import type { PreflightContext } from "./plugin.js";
import type { ObservabilityLevel } from "../observability.js";

/**
 * Source code management platform — PR lifecycle, CI checks, code reviews.
 * This is the richest plugin interface, covering the full PR pipeline.
 */
export interface SCM {
  readonly name: string;

  verifyWebhook?(
    request: SCMWebhookRequest,
    project: ProjectConfig,
  ): Promise<SCMWebhookVerificationResult>;

  parseWebhook?(
    request: SCMWebhookRequest,
    project: ProjectConfig,
  ): Promise<SCMWebhookEvent | null>;

  // --- PR Lifecycle ---

  /** Detect if a session has an open PR (by branch name) */
  detectPR(session: Session, project: ProjectConfig): Promise<PRInfo | null>;

  /** Resolve a PR reference (number or URL) into canonical PR metadata. */
  resolvePR?(reference: string, project: ProjectConfig): Promise<PRInfo>;

  /** Assign a PR to the currently authenticated user, if supported. */
  assignPRToCurrentUser?(pr: PRInfo): Promise<void>;

  /** Check out the PR branch into a workspace. Returns true if branch changed. */
  checkoutPR?(pr: PRInfo, workspacePath: string): Promise<boolean>;

  /** Get current PR state */
  getPRState(pr: PRInfo): Promise<PRState>;

  /** Get PR summary with stats (state, title, additions, deletions). Optional. */
  getPRSummary?(pr: PRInfo): Promise<{
    state: PRState;
    title: string;
    additions: number;
    deletions: number;
  }>;

  /** Merge a PR */
  mergePR(pr: PRInfo, method?: MergeMethod): Promise<void>;

  /** Close a PR without merging */
  closePR(pr: PRInfo): Promise<void>;

  // --- CI Tracking ---

  /** Get individual CI check statuses */
  getCIChecks(pr: PRInfo): Promise<CICheck[]>;

  /** Get failed CI jobs/steps with a bounded failed-log tail, if supported. */
  getCIFailureSummary?(pr: PRInfo, failedChecks?: CICheck[]): Promise<CIFailureSummary | null>;

  /** Get overall CI summary */
  getCISummary(pr: PRInfo): Promise<CIStatus>;

  // --- Review Tracking ---

  /** Get all reviews on a PR */
  getReviews(pr: PRInfo): Promise<Review[]>;

  /** Get the overall review decision */
  getReviewDecision(pr: PRInfo): Promise<ReviewDecision>;

  /** Get pending (unresolved) review comments */
  getPendingComments(pr: PRInfo): Promise<ReviewComment[]>;

  /**
   * Get all review threads (human + bot) with isBot flag.
   * Single GraphQL call for all review threads (human + bot) with review summaries.
   * Returns unresolved threads only.
   *
   * Optional — plugins that do not implement this method will fall back to
   * `getPendingComments()` (which lacks `isBot` classification and review
   * summaries). New SCM plugins should prefer implementing this method.
   *
   * @since 0.6.0 — replaces the removed `getAutomatedComments` method.
   */
  getReviewThreads?(pr: PRInfo): Promise<ReviewThreadsResult>;

  // --- Merge Readiness ---

  /** Check if PR is ready to merge */
  getMergeability(pr: PRInfo): Promise<MergeReadiness>;

  /**
   * Batch fetch PR data for multiple PRs in a single GraphQL query.
   * Used by the orchestrator to poll all active sessions efficiently.
   *
   * This is an optimization method that, when implemented, can dramatically
   * reduce API calls by fetching data for multiple PRs in one request
   * instead of calling getPRState/getCISummary/getReviewDecision separately
   * for each PR.
   *
   * @param prs - Array of PR information to fetch data for
   * @param observer - Optional observer for batch operation metrics
   * @returns Map keyed by "${owner}/${repo}#${number}" containing enrichment data
   */
  enrichSessionsPRBatch?(prs: PRInfo[], observer?: BatchObserver, repos?: string[]): Promise<Map<string, PREnrichmentData>>;

  /**
   * Optional: validate that this SCM's prerequisites (auth, CLI tools) are
   * present before `ao spawn` runs. Plugins should consult
   * `context.intent.willClaimExistingPR` and skip PR-write prereqs when the
   * spawn won't exercise them.
   */
  preflight?(context: PreflightContext): Promise<void>;
}

/**
 * Batch enrichment data returned by SCM plugins.
 * Contains all the information the orchestrator needs for status detection.
 */
export interface PREnrichmentData {
  /** Current PR state */
  state: PRState;
  /** Overall CI status */
  ciStatus: CIStatus;
  /** Review decision */
  reviewDecision: ReviewDecision;
  /** Whether the PR is mergeable based on CI, reviews, and merge state */
  mergeable: boolean;
  /** PR title */
  title?: string;
  /** Number of additions */
  additions?: number;
  /** Number of deletions */
  deletions?: number;
  /** Whether PR is a draft */
  isDraft?: boolean;
  /** Whether PR has merge conflicts */
  hasConflicts?: boolean;
  /** Whether PR is behind base branch */
  isBehind?: boolean;
  /** List of blockers preventing merge */
  blockers?: string[];
}

/**
 * Observer for GraphQL batch PR enrichment operations.
 * Used by SCM plugins to report batch success/failure to the observability system.
 */
export interface BatchObserver {
  /** Record a successful batch enrichment */
  recordSuccess(data: {
    batchIndex: number;
    totalBatches: number;
    prCount: number;
    durationMs: number;
  }): void;
  /** Record a failed batch enrichment */
  recordFailure(data: {
    batchIndex: number;
    totalBatches: number;
    prCount: number;
    error: string;
    durationMs: number;
  }): void;
  /** Log a message at a specific level */
  log(level: ObservabilityLevel, message: string): void;
  /** Called after ETag guards with repos where Guard 1 returned 304 (no PR list changes). */
  reportPRListUnchangedRepos?(repos: Set<string>): void;
}

// --- PR Types ---

export interface PRInfo {
  number: number;
  url: string;
  title: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  isDraft: boolean;
}

export type PRState = "open" | "merged" | "closed";

/** PR state constants */
export const PR_STATE = {
  OPEN: "open" as const,
  MERGED: "merged" as const,
  CLOSED: "closed" as const,
} satisfies Record<string, PRState>;

export type MergeMethod = "merge" | "squash" | "rebase";

export interface SCMWebhookRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  rawBody?: Uint8Array;
  path?: string;
  query?: Record<string, string | string[] | undefined>;
}

export interface SCMWebhookVerificationResult {
  ok: boolean;
  reason?: string;
  deliveryId?: string;
  eventType?: string;
}

export type SCMWebhookEventKind = "pull_request" | "ci" | "review" | "comment" | "push" | "unknown";

export interface SCMWebhookEvent {
  provider: string;
  kind: SCMWebhookEventKind;
  action: string;
  rawEventType: string;
  deliveryId?: string;
  projectId?: string;
  repository?: {
    owner: string;
    name: string;
  };
  prNumber?: number;
  branch?: string;
  sha?: string;
  timestamp?: Date;
  data: Record<string, unknown>;
}

// --- CI Types ---

export interface CICheck {
  name: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  url?: string;
  conclusion?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface CIFailureSummary {
  failedJobs: Array<{
    name: string;
    failedStep?: string;
    runUrl: string;
    logTail?: string;
  }>;
}

export type CIStatus = "pending" | "passing" | "failing" | "none";

/** CI status constants */
export const CI_STATUS = {
  PENDING: "pending" as const,
  PASSING: "passing" as const,
  FAILING: "failing" as const,
  NONE: "none" as const,
} satisfies Record<string, CIStatus>;

// --- Review Types ---

export interface Review {
  author: string;
  state: "approved" | "changes_requested" | "commented" | "dismissed" | "pending";
  body?: string;
  submittedAt: Date;
}

export type ReviewDecision = "approved" | "changes_requested" | "pending" | "none";

export interface ReviewComment {
  id: string;
  /** GraphQL node ID of the review thread (for resolveReviewThread mutation). */
  threadId?: string;
  author: string;
  body: string;
  path?: string;
  line?: number;
  isResolved: boolean;
  createdAt: Date;
  url: string;
  /** Whether the comment was authored by a known bot */
  isBot?: boolean;
}

export interface ReviewSummary {
  author: string;
  state: string;
  body: string;
  submittedAt: Date;
}

export interface ReviewThreadsResult {
  threads: ReviewComment[];
  reviews: ReviewSummary[];
}

export interface AutomatedComment {
  id: string;
  botName: string;
  body: string;
  path?: string;
  line?: number;
  severity: "error" | "warning" | "info";
  createdAt: Date;
  url: string;
}

// --- Merge Readiness ---

export interface MergeReadiness {
  mergeable: boolean;
  ciPassing: boolean;
  approved: boolean;
  noConflicts: boolean;
  blockers: string[];
}

/**
 * Batch enrichment data returned by SCM plugins.
 * Contains all the information the orchestrator needs for status detection.
 */
export interface PREnrichmentData {
  /** Current PR state */
  state: PRState;
  /** Overall CI status */
  ciStatus: CIStatus;
  /** Review decision */
  reviewDecision: ReviewDecision;
  /** Whether the PR is mergeable based on CI, reviews, and merge state */
  mergeable: boolean;
  /** PR title */
  title?: string;
  /** Number of additions */
  additions?: number;
  /** Number of deletions */
  deletions?: number;
  /** Whether PR is a draft */
  isDraft?: boolean;
  /** Whether PR has merge conflicts */
  hasConflicts?: boolean;
  /** Whether PR is behind base branch */
  isBehind?: boolean;
  /** List of blockers preventing merge */
  blockers?: string[];
  /** Individual CI check results (populated from batch enrichment when available) */
  ciChecks?: CICheck[];
}

/**
 * Observer for GraphQL batch PR enrichment operations.
 * Used by SCM plugins to report batch success/failure to the observability system.
 */
export interface BatchObserver {
  /** Record a successful batch enrichment */
  recordSuccess(data: {
    batchIndex: number;
    totalBatches: number;
    prCount: number;
    durationMs: number;
  }): void;
  /** Record a failed batch enrichment */
  recordFailure(data: {
    batchIndex: number;
    totalBatches: number;
    prCount: number;
    error: string;
    durationMs: number;
  }): void;
  /** Log a message at a specific level */
  log(level: ObservabilityLevel, message: string): void;
}
