# GitHub Polling vs Webhooks: Architecture Investigation & Migration Plan

## Executive Summary

AO currently uses a **30-second polling loop** to detect GitHub state changes (CI results, reviews, merges). The codebase already has **full webhook ingestion infrastructure** — the SCM GitHub plugin can parse and verify native GitHub webhooks, and the web dashboard exposes a `POST /api/webhooks/[...slug]` endpoint that triggers immediate lifecycle checks.

**Key finding:** The webhook path is already implemented and functional. The real question is not "how to add webhook support" but rather "how to make webhooks the primary path and reduce polling frequency." Composio CLI can serve as an additional webhook relay for environments where direct GitHub webhook configuration is impractical.

---

## Part 1: Current Polling Architecture

### 1.1 Polling Loop

| Property | Value |
|----------|-------|
| **Location** | `packages/core/src/lifecycle-manager.ts` (lines 2070–2083) |
| **Default interval** | 30 seconds |
| **Configurable** | Yes, via `lifecycleManager.start(intervalMs)` |
| **Guard** | Re-entrancy flag prevents overlapping poll cycles |
| **Startup** | Immediate `pollAll()` + `setInterval` |

```typescript
start(intervalMs = 30_000): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => void pollAll(), intervalMs);
  void pollAll();
}
```

### 1.2 What Gets Polled (Per Session, Per Cycle)

| Data | Source | API Cost |
|------|--------|----------|
| Agent process alive | Runtime plugin (tmux/process) | 0 (local) |
| Agent activity state | JSONL/terminal | 0 (local) |
| PR state (open/merged/closed) | GitHub GraphQL batch | ~1 point (batched) |
| CI check status/conclusion | GitHub GraphQL batch | ~1 point (batched) |
| Review decision | GitHub GraphQL batch | ~1 point (batched) |
| Pending review comments | GitHub GraphQL | ~1 point |
| Automated review comments (bots) | GitHub REST (paginated) | 1+ points |
| Merge conflicts | Enrichment cache | 0 (from batch) |

### 1.3 Batch Optimization Strategy

The SCM GitHub plugin (`packages/plugins/scm-github/src/graphql-batch.ts`, 1026 lines) uses a **2-guard ETag strategy** to minimize API calls:

```
[Poll cycle]
  ├── Guard 1: HEAD /repos/{owner}/{repo}/pulls?state=open
  │   └── Returns 304? → No PR changes, skip batch
  ├── Guard 2: HEAD /repos/{owner}/{repo}/commits/{sha}/status
  │   └── Returns 304? → No CI changes, skip batch
  └── If either guard says "changed":
      └── GraphQL batch: fetch all PR data in one query (up to 25 PRs)
```

**Cost summary:**
- Best case (no changes): **0 API points** (ETag 304s)
- Typical case: **~52 points** per batch (1 GraphQL query)
- Worst case (batch fails, individual REST fallback): **~5 calls per PR**

### 1.4 State Machine Transitions

When polled data differs from cached state, the lifecycle manager fires transitions:

```
spawning → working → pr_open → ci_failed / review_pending
                                    │              │
                            changes_requested   approved
                                    │              │
                                    └→ mergeable → merged → cleanup → done
```

Each transition can trigger a **reaction** (send-to-agent, notify human, auto-merge) with configurable retries and escalation.

### 1.5 Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `packages/core/src/lifecycle-manager.ts` | 2096 | Polling loop + state machine + reactions |
| `packages/core/src/lifecycle-status-decisions.ts` | — | Evidence → decision mapping |
| `packages/plugins/scm-github/src/graphql-batch.ts` | 1026 | Batch PR enrichment + ETag guards |
| `packages/plugins/scm-github/src/index.ts` | 1066 | SCM plugin (REST fallbacks, webhook parsing) |
| `packages/plugins/scm-github/src/lru-cache.ts` | — | Cache for ETags + PR metadata |

### 1.6 Limitations of Current Polling

| Limitation | Impact |
|------------|--------|
| **30s latency** | CI failures, reviews, merges detected 0–30s late |
| **Wasted API calls** | Most polls return "no change" (304s are cheap but not free) |
| **Rate limit pressure** | At scale (50+ PRs), even batched queries consume meaningful quota |
| **Review comment throttle** | Review backlog only checked every 2 minutes (intentional to reduce cost) |
| **No real-time feedback** | Agent sits idle for up to 30s after CI fails |
| **Scalability ceiling** | GraphQL batch limited to 25 PRs; 100 PRs = 4 batches per cycle |
| **Single-threaded poll** | One slow API call delays all session checks |

---

## Part 2: Existing Webhook Infrastructure (Already Built!)

### 2.1 Webhook Endpoint

**File:** `packages/web/src/app/api/webhooks/[...slug]/route.ts`

The Next.js web dashboard already exposes a catch-all webhook endpoint:

```
POST /api/webhooks/{scm-plugin-name}
```

Flow:
1. Match incoming request path to configured project SCM webhooks
2. Verify signature (HMAC SHA-256 for GitHub)
3. Parse event into `SCMWebhookEvent` struct
4. Find affected sessions (by PR number or branch name)
5. Call `lifecycleManager.check(sessionId)` for each — **immediate re-evaluation**

### 2.2 GitHub SCM Plugin Webhook Support

**File:** `packages/plugins/scm-github/src/index.ts` (lines 229–424)

Already implements:
- `verifyWebhook()` — HMAC-SHA256 signature verification
- `parseWebhook()` — Full event parsing for:
  - `pull_request` (opened/closed/synchronized/merged)
  - `pull_request_review` (submitted — APPROVED/CHANGES_REQUESTED)
  - `pull_request_review_comment` (created)
  - `issue_comment` (on PRs)
  - `check_run` / `check_suite` (CI status changes)
  - `status` (commit status updates)
  - `push` (new commits)

### 2.3 Configuration Schema

Already defined in types.ts:

```typescript
interface SCMWebhookConfig {
  enabled?: boolean;
  path?: string;              // Custom webhook URL path
  secretEnvVar?: string;      // Env var name containing HMAC secret
  signatureHeader?: string;   // Default: "x-hub-signature-256"
  eventHeader?: string;       // Default: "x-github-event"
  deliveryHeader?: string;    // Default: "x-github-delivery"
  maxBodyBytes?: number;      // Payload size limit
}
```

### 2.4 What's Missing

The infrastructure is complete but **not actively used in production** because:

1. **No automatic webhook registration** — Users must manually configure GitHub webhooks to point at the AO dashboard URL
2. **The polling loop still runs at full speed** — Even with webhooks enabled, polling doesn't back off
3. **No tunnel/relay for local development** — GitHub can't reach `localhost:3000`
4. **No documentation/setup wizard** — The `ao setup` command doesn't configure webhooks

---

## Part 3: Composio CLI as Webhook Relay

### 3.1 What Composio Offers

Composio provides two relevant capabilities:

**True webhooks (real-time):**
| Trigger | Events |
|---------|--------|
| `GITHUB_PULL_REQUEST_EVENT` | PR opened/closed/synchronized |
| `GITHUB_COMMIT_EVENT` | New commits pushed |

**Poll-based triggers (1–2 min interval):**
| Trigger | Events |
|---------|--------|
| `GITHUB_CHECK_SUITE_STATUS_CHANGED_TRIGGER` | CI status/conclusion changes |
| `GITHUB_PULL_REQUEST_REVIEW_SUBMITTED_TRIGGER` | Review submitted |
| `GITHUB_PR_REVIEW_COMMENT_CREATED_TRIGGER` | New review comments |
| `GITHUB_ISSUE_COMMENT_CREATED_TRIGGER` | New issue comments |

### 3.2 How Integration Would Work

```bash
# 1. Set up trigger subscriptions
composio dev triggers create GITHUB_PULL_REQUEST_EVENT \
  --trigger-config '{ "owner": "ComposioHQ", "repo": "agent-orchestrator" }'

composio dev triggers create GITHUB_CHECK_SUITE_STATUS_CHANGED_TRIGGER \
  --trigger-config '{ "owner": "ComposioHQ", "repo": "agent-orchestrator", "ref": "main", "interval": 1 }'

# 2. Forward events to AO's existing webhook endpoint
composio dev listen --toolkits github --forward http://localhost:3000/api/webhooks/github --json
```

### 3.3 Composio SDK (Programmatic)

```typescript
import { Composio } from "composio-core";

const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

// Subscribe to trigger events
client.triggers.subscribe((event) => {
  // Transform Composio event → SCMWebhookRequest format
  // Call lifecycleManager.check() for affected sessions
});
```

### 3.4 Limitations of Composio Approach

| Issue | Impact |
|-------|--------|
| **Most triggers are poll-based** | CI status, reviews, comments use 1–2 min polling (server-side) — worse than AO's own 30s |
| **Per-resource subscription required** | Must create/destroy trigger instances as PRs are created — operational complexity |
| **Extra dependency** | Adds Composio SDK + API key requirement |
| **Event format translation** | Composio payloads differ from native GitHub webhook payloads — requires adapter |
| **Only 4 real webhooks** | Only PR events and commits are truly real-time |
| **`composio dev listen` is a sidecar** | Must run alongside AO — another process to manage |

---

## Part 4: Comparison Matrix

| Dimension | Current Polling | Native GitHub Webhooks (already built) | Composio Relay |
|-----------|----------------|---------------------------------------|----------------|
| **Latency** | 0–30s | <1s (real-time) | <1s (PR/push), 1–2min (CI/reviews) |
| **API cost** | ~52 points/cycle (optimized) | 0 (push-based) | 0 (Composio handles) |
| **Rate limit risk** | Medium (at scale) | None | None (shifted to Composio) |
| **Setup complexity** | Zero | Requires public URL + webhook config | Requires Composio account + trigger setup |
| **Local dev** | Works anywhere | Needs tunnel (ngrok/cloudflared) | `composio dev listen` handles relay |
| **Reliability** | Very high (self-contained) | Depends on network reachability | Depends on Composio uptime |
| **Code changes needed** | None | Minimal (reduce poll frequency) | New adapter plugin + trigger management |
| **Coverage** | Complete (all states) | Complete (all GitHub events) | Partial (some events poll-only) |
| **Self-hosted** | Yes | Yes | No (Composio cloud dependency) |

---

## Part 5: Recommended Implementation Plan

### Recommendation: **Hybrid approach — Native webhooks primary, polling as fallback**

The codebase already has webhook support built. The optimal strategy is:

1. **Activate native GitHub webhooks as the primary event source**
2. **Reduce polling to a slow heartbeat** (5 min) that catches missed events
3. **Use Composio as an optional relay** for environments where public URLs are unavailable

### Phase 1: Activate Existing Webhook Path (Low effort, high impact)

**Goal:** Make webhooks the primary event source for users who can expose a URL.

**Changes:**

1. **Add webhook setup to `ao setup` command** (`packages/cli/src/commands/setup.ts`)
   - Detect if web dashboard URL is publicly reachable
   - Use `gh api` to create/update webhook on the repository
   - Store webhook secret in config

2. **Add adaptive polling interval** (`packages/core/src/lifecycle-manager.ts`)
   - If webhook configured and recently received events → poll every 5 minutes (heartbeat)
   - If webhook not configured or no events in 10 min → keep 30s polling
   - Track `lastWebhookReceivedAt` per project

3. **Add health monitoring for webhooks** 
   - Track webhook delivery success/failure
   - If GitHub reports delivery failures, auto-increase polling frequency
   - Expose webhook health in dashboard

**Estimated scope:** ~200 lines of new code + config changes.

### Phase 2: Composio Relay Plugin (Medium effort, targeted users)

**Goal:** Provide webhook-like behavior for users who can't expose a public URL (local dev, behind firewalls).

**Changes:**

1. **Create `packages/plugins/relay-composio/`** — new plugin slot
   - On session start (when PR created): create Composio trigger subscriptions
   - On session end: tear down trigger subscriptions
   - Use Composio SDK `triggers.subscribe()` to receive events
   - Transform Composio event payloads → `SCMWebhookEvent` format
   - Call `lifecycleManager.check()` on affected sessions

2. **Plugin interface** (`packages/core/src/types.ts`)
   ```typescript
   export interface EventRelay {
     readonly name: string;
     start(projects: ProjectConfig[]): Promise<void>;
     stop(): Promise<void>;
     onEvent(handler: (event: SCMWebhookEvent) => Promise<void>): void;
   }
   ```

3. **Configuration in `agent-orchestrator.yaml`:**
   ```yaml
   relay:
     plugin: composio
     config:
       composioApiKey: ${COMPOSIO_API_KEY}
       triggers:
         - GITHUB_PULL_REQUEST_EVENT
         - GITHUB_COMMIT_EVENT
         # Poll-based (1 min):
         - GITHUB_CHECK_SUITE_STATUS_CHANGED_TRIGGER
   ```

**Estimated scope:** ~400 lines (new plugin) + ~50 lines (core relay interface).

### Phase 3: Dynamic Trigger Management (Higher effort, full automation)

**Goal:** Automatically create per-PR Composio triggers for granular CI/review events.

**Changes:**

1. When a session creates a PR → create `GITHUB_PULL_REQUEST_REVIEW_SUBMITTED_TRIGGER` with that PR number
2. When session reaches terminal state → delete trigger instance
3. Handle trigger lifecycle errors gracefully (Composio downtime, quota limits)

**Estimated scope:** ~200 lines in relay plugin.

### Migration & Rollout Risks

| Risk | Mitigation |
|------|-----------|
| Webhook endpoint not reachable | Polling fallback stays active; health check auto-escalates |
| Missed webhook delivery | GitHub retries for 3 days; 5-min heartbeat poll catches gaps |
| Composio service outage | Polling fallback; relay plugin gracefully degrades |
| Double-processing (webhook + poll) | Idempotent state checks (same PR state = no-op transition) |
| Secret rotation needed | Support `secretEnvVar` reference (already in config schema) |
| Breaking webhook parser on GitHub API changes | Already handles multiple event formats with graceful fallback |

### Critical Invariants to Preserve

1. **`checkSession()` is idempotent** — calling it twice with same underlying state produces no side effects
2. **Reaction fingerprinting** — review comment/CI failure dispatches use fingerprints to prevent duplicates; webhook-triggered checks don't bypass this
3. **Throttle windows** — review backlog throttle (2 min) still applies even when webhook triggers immediate check
4. **ETag cache invalidation** — webhook receipt should invalidate relevant ETag cache entries so the next manual check gets fresh data

---

## Part 6: Concrete Code Paths That Change

### For Phase 1 (Adaptive Polling):

```
packages/core/src/lifecycle-manager.ts
  - Add `lastWebhookEventAt: Map<string, number>` tracking
  - Modify `pollAll()` to skip projects with recent webhook events
  - Add `onWebhookReceived(projectId)` method

packages/web/src/app/api/webhooks/[...slug]/route.ts
  - After successful processing, call `lifecycleManager.onWebhookReceived(projectId)`

packages/cli/src/commands/setup.ts
  - Add webhook auto-registration step
  - Generate webhook secret, store in env/config
```

### For Phase 2 (Composio Relay):

```
packages/core/src/types.ts
  - Add EventRelay interface

packages/plugins/relay-composio/
  ├── package.json
  ├── tsconfig.json
  └── src/
      ├── index.ts          # Plugin manifest + create()
      ├── trigger-manager.ts # Create/delete trigger instances
      ├── event-adapter.ts   # Composio payload → SCMWebhookEvent
      └── __tests__/

packages/core/src/lifecycle-manager.ts
  - Accept optional EventRelay in config
  - Wire relay.onEvent() → checkSession()
```

---

## Conclusion

The AO codebase is **90% ready for webhook-based operation**. The SCM GitHub plugin already parses all relevant webhook events, the web app has a functioning endpoint, and the lifecycle manager's `check(sessionId)` method provides immediate re-evaluation.

The highest-ROI next step is **Phase 1: reduce polling frequency when webhooks are active**. This requires minimal code changes (~200 lines) and dramatically reduces API consumption while achieving <1s latency for state changes.

Composio CLI is best positioned as an **optional relay for local/firewalled environments** (Phase 2), not as the primary webhook transport. Its poll-based triggers (1–2 min interval) are actually slower than AO's own 30s polling for CI and review events. The true value of Composio is as a tunnel that allows local AO instances to receive real-time PR and push events without exposing a public URL.
