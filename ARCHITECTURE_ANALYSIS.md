# AO Backend Architecture Analysis

Raw data analysis for simplification. No recommendations — draw your own conclusions.

---

## Section 1: Module Dependency Graph

### Core Package Files

| File | Lines | Internal Imports | Exports |
|------|-------|------------------|---------|
| `session-manager.ts` | 2801 | types, metadata, lifecycle-state, prompt-builder, activity-signal, paths, opencode-session-id, opencode-agents-md, orchestrator-session-strategy, utils/session-from-metadata, utils/validation, utils, agent-selection | `SessionManagerDeps`, `createSessionManager` |
| `lifecycle-manager.ts` | 1997 | types, lifecycle-state, metadata, paths, lifecycle-transition, observability, notifier-resolution, agent-selection, activity-signal, agent-report, report-watcher, lifecycle-status-decisions | `LifecycleManagerDeps`, `createLifecycleManager` |
| `types.ts` | 1725 | observability (type only) | 95+ types/interfaces/consts |
| `config.ts` | 784 | types, paths | `collectExternalPluginConfigs`, `findConfigFile`, `findConfig`, `loadConfig`, `loadConfigWithPath`, `validateConfig`, `getDefaultConfig` |
| `observability.ts` | 738 | types, paths | `ObservabilityLevel`, `ProjectObserver`, `createCorrelationId`, `createProjectObserver`, `readObservabilitySummary` + 10 more |
| `tracker-linear/index.ts` (plugin) | 727 | (external) | Plugin module |
| `agent-report.ts` | 606 | metadata, lifecycle-state, utils/pr, utils/session-id, utils/validation | `AGENT_REPORTED_STATES`, `applyAgentReport`, `readAgentReport`, `isAgentReportFresh` + 12 more |
| `plugin-registry.ts` | 527 | types | `isPluginModule`, `normalizeImportedPluginModule`, `resolvePackageExportsEntry`, `resolveLocalPluginEntrypoint`, `createPluginRegistry` |
| `lifecycle-state.ts` | 489 | zod, utils/pr, utils/validation | `createInitialCanonicalLifecycle`, `parseCanonicalLifecycle`, `deriveLegacyStatus`, `buildLifecycleMetadataPatch`, `cloneLifecycle` |
| `lifecycle-status-decisions.ts` | 398 | activity-signal | `DETECTING_MAX_ATTEMPTS`, `hashEvidence`, `isDetectingTimedOut`, `createDetectingDecision`, `resolveProbeDecision`, `resolvePREnrichmentDecision`, `resolvePRLiveDecision` |
| `metadata.ts` | 389 | types, atomic-write, key-value, lifecycle-state, utils/session-id, utils/validation | `readMetadata`, `readMetadataRaw`, `writeMetadata`, `updateMetadata`, `mutateMetadata`, `deleteMetadata`, `listMetadata`, `reserveSessionId` + 5 more |
| `agent-workspace-hooks.ts` | 345 | (node builtins only) | `PREFERRED_GH_PATH`, `buildAgentPath`, `AO_METADATA_HELPER`, `GH_WRAPPER`, `GIT_WRAPPER`, `setupPathWrapperWorkspace` |
| `config-generator.ts` | 317 | paths | `parseRepoUrl`, `detectScmPlatform`, `detectProjectInfo`, `generateConfigFromUrl`, `configToYaml` + 6 more |
| `lifecycle-transition.ts` | 302 | lifecycle-state, metadata, lifecycle-status-decisions, utils/validation | `TransitionSource`, `TransitionResult`, `applyDecisionToLifecycle`, `applyLifecycleDecision`, `createStateTransitionDecision` |
| `report-watcher.ts` | 254 | types, agent-report | `ReportWatcherTrigger`, `shouldAuditSession`, `checkAcknowledgeTimeout`, `checkStaleReport`, `auditAgentReports` + 3 more |
| `activity-log.ts` | 253 | types | `ACTIVITY_INPUT_STALENESS_MS`, `getActivityLogPath`, `appendActivityEntry`, `readLastActivityEntry`, `checkActivityLogState`, `getActivityFallbackState`, `classifyTerminalActivity`, `recordTerminalActivity` |
| `index.ts` | 258 | (re-exports) | Public API barrel file |
| `paths.ts` | 211 | (node builtins) | `generateConfigHash`, `generateProjectId`, `generateInstanceId`, `generateSessionPrefix`, `getProjectBaseDir`, `getSessionsDir`, `getWorktreesDir`, `generateTmuxName` + 5 more |
| `prompt-builder.ts` | 207 | types | `BASE_AGENT_PROMPT`, `BASE_AGENT_PROMPT_NO_REPO`, `PromptBuildConfig`, `buildPrompt` |
| `feedback-tools.ts` | 204 | zod, atomic-write, key-value | `FEEDBACK_TOOL_NAMES`, `FeedbackReportStore`, `validateFeedbackToolInput` + 8 more |
| `orchestrator-prompt.ts` | 199 | prompts/orchestrator.md, types | `OrchestratorPromptConfig`, `generateOrchestratorPrompt` |
| `tmux.ts` | 200 | (node builtins) | `isTmuxAvailable`, `listSessions`, `hasSession`, `newSession`, `sendKeys`, `capturePane`, `killSession`, `getPaneTTY` |
| `utils.ts` | 180 | types | `shellEscape`, `escapeAppleScript`, `validateUrl`, `isGitBranchNameSafe`, `isRetryableHttpStatus`, `readLastJsonlEntry`, `resolveProjectIdForSessionId` |
| `activity-signal.ts` | 125 | types | `ACTIVITY_STRONG_WINDOW_MS`, `createActivitySignal`, `classifyActivitySignal`, `hasPositiveIdleEvidence`, `formatActivitySignalEvidence` + 3 more |
| `agent-selection.ts` | 93 | (none) | `SessionRole`, `ResolvedAgentSelection`, `resolveSessionRole`, `resolveAgentSelection` |
| `opencode-agents-md.ts` | 43 | (node builtins) | `getWorkspaceAgentsMdPath`, `writeWorkspaceOpenCodeAgentsMd` |
| `scm-webhook-utils.ts` | 35 | types | `getWebhookHeader`, `parseWebhookJsonObject`, `parseWebhookTimestamp`, `parseWebhookBranchRef` |
| `notifier-resolution.ts` | 31 | types | `ResolvedNotifierTarget`, `resolveNotifierTarget` |
| `key-value.ts` | 18 | (none) | `parseKeyValueContent` |
| `atomic-write.ts` | 11 | (node builtins) | `atomicWriteFileSync` |
| `opencode-session-id.ts` | 8 | (none) | `asValidOpenCodeSessionId` |
| `orchestrator-session-strategy.ts` | 11 | types | `NormalizedOrchestratorSessionStrategy`, `normalizeOrchestratorSessionStrategy` |

### CLI Package Files (Top 20 by LOC)

| File | Lines |
|------|-------|
| `commands/start.ts` | 1731 |
| `commands/plugin.ts` | 602 |
| `commands/setup.ts` | 591 |
| `commands/status.ts` | 528 |
| `commands/doctor.ts` | 466 |
| `commands/session.ts` | 403 |
| `commands/spawn.ts` | 383 |
| `lib/update-check.ts` | 338 |
| `lib/project-detection.ts` | 239 |
| `lib/plugin-marketplace.ts` | 230 |
| `commands/send.ts` | 215 |
| `lib/web-dir.ts` | 208 |
| `lib/plugin-scaffold.ts` | 204 |
| `lib/openclaw-probe.ts` | 183 |
| `commands/verify.ts` | 183 |
| `commands/update.ts` | 170 |
| `commands/report.ts` | 169 |
| `lib/running-state.ts` | 161 |
| `commands/review-check.ts` | 152 |
| `lib/plugin-store.ts` | 148 |

---

## Section 2: Hot Spots (Fan-In Analysis)

Ranked by how many other files import from them:

### Top 10 Core Files by Fan-In

| Rank | File | Fan-In Count | Imported By |
|------|------|--------------|-------------|
| 1 | `types.ts` | **26** | All core files, all plugins, CLI, web |
| 2 | `metadata.ts` | 8 | session-manager, lifecycle-manager, lifecycle-transition, agent-report, lifecycle-state (via deps) |
| 3 | `lifecycle-state.ts` | 7 | session-manager, lifecycle-manager, lifecycle-transition, metadata, agent-report |
| 4 | `paths.ts` | 6 | session-manager, lifecycle-manager, config, observability, config-generator |
| 5 | `utils/validation.ts` | 6 | session-manager, lifecycle-state, lifecycle-transition, metadata, agent-report |
| 6 | `activity-signal.ts` | 4 | session-manager, lifecycle-manager, lifecycle-status-decisions, report-watcher |
| 7 | `agent-report.ts` | 3 | lifecycle-manager, report-watcher, session-manager (indirect) |
| 8 | `plugin-registry.ts` | 3 | index.ts, cli/create-session-manager, cli/start |
| 9 | `config.ts` | 3 | index.ts, cli/*, session-manager (via deps) |
| 10 | `observability.ts` | 3 | lifecycle-manager, session-manager (via observer pattern), cli/start |

### Import Chain for types.ts

```
types.ts
  ├── session-manager.ts (direct)
  │     ├── lifecycle-state.ts
  │     ├── metadata.ts
  │     ├── paths.ts
  │     └── (8 more utils)
  ├── lifecycle-manager.ts (direct)
  │     ├── lifecycle-state.ts
  │     ├── lifecycle-transition.ts
  │     ├── lifecycle-status-decisions.ts
  │     ├── activity-signal.ts
  │     ├── agent-report.ts
  │     └── (4 more)
  ├── plugin-registry.ts (direct)
  ├── config.ts (direct)
  ├── observability.ts (direct)
  ├── All 22 plugin packages (direct)
  ├── CLI commands (via @aoagents/ao-core)
  └── Web package (via @aoagents/ao-core)
```

### Import Chain for metadata.ts

```
metadata.ts
  ├── session-manager.ts
  │     └── (spawn, list, kill, cleanup, send, restore, claimPR)
  ├── lifecycle-manager.ts
  │     └── (updateMetadata for state transitions)
  └── lifecycle-transition.ts
        └── (applyLifecycleDecision)
```

---

## Section 3: Session Lifecycle Data Flow

### `ao spawn <issue>` → Dashboard Appearance

#### Phase 1: CLI Entry (cli/commands/spawn.ts)

```
1. loadConfig()                        → OrchestratorConfig
2. autoDetectProject(config)           → projectId
3. runSpawnPreflight(config, projectId)→ validates tmux/gh auth
4. warnIfAONotRunning(projectId)       → checks running-state.ts
5. getSessionManager(config)           → SessionManager instance
6. sm.spawn({ projectId, issueId })    → Session
```

#### Phase 2: Session Manager Spawn (core/session-manager.ts)

```
1.  resolvePlugins(project)            → { runtime, agent, workspace, tracker, scm }
2.  resolveAgentSelection(...)         → { agentName, agentConfig, role }
3.  tracker?.getIssue(issueId)         → Issue | null
4.  reserveNextSessionIdentity(...)    → { num, sessionId, tmuxName }
5.  workspace.create({...})            → { workspacePath, branch }
6.  buildPrompt({...})                 → string (agent prompt)
7.  writeMetadata(sessionsDir, sessionId, {...})
8.  runtime.create({...})              → RuntimeHandle
9.  agent.setupWorkspaceHooks(...)     → void (PATH wrappers or hooks)
10. runtime.start(handle, launchCommand, env)
11. agent.postLaunchSetup(...)         → void (optional)
12. updateMetadata(sessionsDir, sessionId, { status: "spawning" })
13. Return Session object
```

#### Phase 3: Lifecycle Polling (core/lifecycle-manager.ts)

```
Poll cycle (30s interval):
1.  sessionManager.list(projectId)     → Session[]
2.  For each session:
    a. determineStatus(session)        → DeterminedStatus
       - runtime.isAlive(handle)       → alive/dead
       - agent.getActivityState(...)   → ActivityDetection
       - agent.isProcessRunning(...)   → boolean
       - scm.detectPR(session)         → PRInfo | null
       - scm.getPRState(pr)            → PRState
       - scm.getCISummary(pr)          → CIStatus
       - scm.getReviewDecision(pr)     → ReviewDecision
    b. Compare old vs new status
    c. If transition: emit event, trigger reaction
    d. updateMetadata(...) with new lifecycle state
```

#### Phase 4: Web Dashboard (web/src/app/api/sessions/route.ts)

```
1. SSE endpoint: GET /api/sessions (5s interval)
2. loadConfig()                        → OrchestratorConfig
3. getSessionManager(config)           → SessionManager
4. sessionManager.list(projectId)      → Session[]
5. Transform to dashboard format
6. Send as SSE event

Dashboard receives:
- Session[] with status, pr, activitySignal, metadata
- Kanban columns filter by status
```

### Data Transformations Observed

| Step | Input | Output | Transform |
|------|-------|--------|-----------|
| Config load | YAML file | OrchestratorConfig | Zod validation + defaults |
| Issue fetch | issueId string | Issue object | Tracker API call |
| Session reserve | prefix + num | sessionId + tmuxName | Hash + counter |
| Metadata write | SessionMetadata | key=value file | Serialization |
| Prompt build | Issue + config | string | Template + rules |
| Runtime create | config | RuntimeHandle | tmux new-session |
| Activity detect | terminal output | ActivityState | Regex patterns |
| PR enrich | PR number | PREnrichmentData | GraphQL batch |
| Status derive | lifecycle | SessionStatus | State machine |
| SSE transform | Session[] | JSON | Dashboard format |

### Serialization/Deserialization Hops

1. **Config**: YAML → JS object → Zod validated → OrchestratorConfig
2. **Metadata**: SessionMetadata → key=value string → file → key=value string → Record<string,string> → Session
3. **Lifecycle**: CanonicalSessionLifecycle → JSON string (statePayload) → metadata → JSON parse → lifecycle
4. **PR data**: GraphQL response → PREnrichmentData → cache → status derivation
5. **Activity**: JSONL file → parse → ActivityLogEntry → classify → ActivitySignal

---

## Section 4: Interface Audit

### All Interfaces in types.ts

| Interface/Type | Line | Implementations | Consumers |
|----------------|------|-----------------|-----------|
| `SessionId` | 25 | (type alias) | 50+ files |
| `SessionKind` | 27 | (type alias) | session-manager, lifecycle-state |
| `CanonicalSessionState` | 29 | (type alias) | lifecycle-state, lifecycle-manager |
| `CanonicalSessionReason` | 39 | (type alias) | lifecycle-state, lifecycle-status-decisions |
| `CanonicalPRState` | 57 | (type alias) | lifecycle-state, scm plugins |
| `CanonicalPRReason` | 59 | (type alias) | lifecycle-state, lifecycle-status-decisions |
| `CanonicalRuntimeState` | 70 | (type alias) | lifecycle-manager |
| `CanonicalRuntimeReason` | 72 | (type alias) | lifecycle-manager |
| `SessionStateRecord` | 80 | lifecycle-state | lifecycle-manager |
| `PRStateRecord` | 90 | lifecycle-state | lifecycle-manager |
| `RuntimeStateRecord` | 98 | lifecycle-state | lifecycle-manager |
| `CanonicalSessionLifecycle` | 106 | lifecycle-state | session-manager, lifecycle-manager |
| `SessionStatus` | 114 | (type alias) | 30+ files |
| `ActivityState` | 135 | (type alias) | agent plugins, lifecycle-manager |
| `ActivitySignal` | 157 | activity-signal | lifecycle-manager |
| `ActivityDetection` | 171 | agent plugins (5) | lifecycle-manager |
| `ActivityLogEntry` | 178 | activity-log | agent plugins |
| `Session` | 282 | session-manager | lifecycle-manager, CLI, web, all plugins |
| `SessionSpawnConfig` | 369 | (input type) | session-manager |
| `OrchestratorSpawnConfig` | 381 | (input type) | session-manager |
| **`Runtime`** | 394 | 2 (tmux, process) | session-manager, lifecycle-manager |
| `RuntimeCreateConfig` | 419 | (input type) | runtime plugins |
| `RuntimeHandle` | 427 | runtime plugins | session-manager, agent plugins |
| `RuntimeMetrics` | 436 | runtime plugins | (unused in core) |
| `AttachInfo` | 442 | runtime plugins | CLI/terminal |
| **`Agent`** | 459 | 5 (claude-code, codex, aider, cursor, opencode) | session-manager, lifecycle-manager |
| `AgentLaunchConfig` | 537 | (input type) | agent plugins |
| `WorkspaceHooksConfig` | 573 | (input type) | agent plugins |
| `AgentSessionInfo` | 580 | agent plugins | session-manager |
| `CostEstimate` | 591 | agent plugins | session-manager |
| **`Workspace`** | 604 | 2 (worktree, clone) | session-manager |
| `WorkspaceCreateConfig` | 626 | (input type) | workspace plugins |
| `WorkspaceInfo` | 633 | workspace plugins | session-manager |
| **`Tracker`** | 647 | 3 (github, linear, gitlab) | session-manager |
| `Issue` | 678 | tracker plugins | session-manager, prompt-builder |
| `IssueFilters` | 690 | (input type) | tracker plugins |
| `IssueUpdate` | 697 | (input type) | tracker plugins |
| `CreateIssueInput` | 705 | (input type) | tracker plugins |
| **`SCM`** | 721 | 2 (github, gitlab) | session-manager, lifecycle-manager |
| `PRInfo` | 810 | scm plugins | session-manager, lifecycle-manager |
| `PRState` | 821 | (type alias) | lifecycle-manager |
| `SCMWebhookRequest` | 832 | (input type) | web/api |
| `SCMWebhookVerificationResult` | 841 | scm plugins | web/api |
| `SCMWebhookEvent` | 850 | scm plugins | web/api |
| `CICheck` | 870 | scm plugins | lifecycle-manager |
| `CIStatus` | 879 | (type alias) | lifecycle-manager |
| `Review` | 891 | scm plugins | (unused directly) |
| `ReviewDecision` | 898 | (type alias) | lifecycle-manager |
| `ReviewComment` | 900 | scm plugins | lifecycle-manager |
| `AutomatedComment` | 911 | scm plugins | lifecycle-manager |
| `MergeReadiness` | 924 | scm plugins | lifecycle-manager |
| `PREnrichmentData` | 936 | scm plugins | lifecycle-manager |
| `BatchObserver` | 967 | (callback type) | scm plugins |
| **`Notifier`** | 997 | 6 (desktop, slack, webhook, discord, composio, openclaw) | lifecycle-manager |
| `NotifyAction` | 1010 | notifier plugins | lifecycle-manager |
| `NotifyContext` | 1016 | notifier plugins | lifecycle-manager |
| **`Terminal`** | 1031 | 2 (iterm2, web) | CLI |
| `EventPriority` | 1049 | (type alias) | lifecycle-manager |
| `EventType` | 1052 | (type alias) | lifecycle-manager |
| `OrchestratorEvent` | 1092 | lifecycle-manager | notifier plugins |
| `ReactionConfig` | 1108 | config | lifecycle-manager |
| `ReactionResult` | 1134 | lifecycle-manager | (internal) |
| `PowerConfig` | 1150 | config | CLI |
| `OrchestratorConfig` | 1160 | config | everywhere |
| `ExternalPluginEntryRef` | 1223 | config | plugin-registry |
| `DashboardConfig` | 1253 | config | web |
| `DefaultPlugins` | 1258 | config | session-manager |
| `InstalledPluginConfig` | 1273 | config | plugin-registry |
| `RoleAgentConfig` | 1293 | config | session-manager |
| `ProjectConfig` | 1298 | config | session-manager, lifecycle-manager |
| `TrackerConfig` | 1365 | config | plugin-registry |
| `SCMConfig` | 1385 | config | plugin-registry |
| `SCMWebhookConfig` | 1405 | config | web/api |
| `NotifierConfig` | 1415 | config | plugin-registry |
| `AgentSpecificConfig` | 1434 | config | agent plugins |
| `OpenCodeAgentConfig` | 1441 | config | agent-opencode |
| `AgentPermissionMode` | 1457 | (type alias) | agent plugins |
| `PluginSlot` | 1487 | (type alias) | plugin-registry |
| `PluginManifest` | 1497 | all plugins | plugin-registry |
| `PluginModule` | 1515 | all plugins | plugin-registry |
| `SessionMetadata` | 1535 | metadata | session-manager |
| `SessionManager` | 1565 | session-manager | lifecycle-manager |
| `OpenCodeSessionManager` | 1589 | session-manager | CLI |
| `ClaimPROptions` | 1594 | (input type) | session-manager |
| `ClaimPRResult` | 1599 | session-manager | CLI |
| `CleanupResult` | 1614 | session-manager | CLI |
| `LifecycleManager` | 1621 | lifecycle-manager | CLI |
| `PluginRegistry` | 1636 | plugin-registry | session-manager, lifecycle-manager |

### Over-Abstracted (1 Implementation, 1 Consumer)

| Interface | Implementation | Consumer | Notes |
|-----------|---------------|----------|-------|
| `RuntimeMetrics` | runtime plugins | (none in core) | Defined but unused |
| `OpenCodeAgentConfig` | config | agent-opencode only | Agent-specific extension |
| `OpenCodeSessionManager` | session-manager | CLI only | Extends SessionManager |
| `AttachInfo` | runtime plugins | CLI terminal commands | Thin wrapper |

---

## Section 5: State Machine Map

### Source: lifecycle-manager.ts + lifecycle-status-decisions.ts

#### All Possible States (SessionStatus)

```typescript
export type SessionStatus =
  | "spawning"        // Initial state, agent launching
  | "detecting"       // Transient: ambiguous activity signals
  | "working"         // Agent is actively working
  | "pr_open"         // PR created, awaiting CI/review
  | "ci_failed"       // PR CI is failing
  | "review_pending"  // PR awaiting human review
  | "changes_requested" // Reviewer requested changes
  | "approved"        // PR approved, not yet mergeable
  | "mergeable"       // PR ready to merge (approved + CI green)
  | "merged"          // PR merged, terminal
  | "needs_input"     // Agent blocked on user input
  | "stuck"           // Agent idle beyond threshold
  | "errored"         // Unrecoverable error
  | "killed"          // Manually terminated
  | "done"            // Completed without PR
  | "cleanup"         // Post-terminal cleanup
```

#### All Transitions

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            SESSION STATE MACHINE                              │
└──────────────────────────────────────────────────────────────────────────────┘

spawning ─────────────┬──► working ◄────────────────────────────────┐
     │                │        │                                     │
     │                │        ├──► pr_open ──────────────────────┐  │
     │                │        │       │                          │  │
     │                │        │       ├──► ci_failed ────────────┤  │
     │                │        │       │       │                  │  │
     │                │        │       │       └──► (fix) ──► pr_open
     │                │        │       │                          │  │
     │                │        │       ├──► review_pending ───────┤  │
     │                │        │       │       │                  │  │
     │                │        │       │       ├──► changes_requested
     │                │        │       │       │       │          │  │
     │                │        │       │       │       └──► working│  │
     │                │        │       │       │                  │  │
     │                │        │       │       └──► approved ─────┤  │
     │                │        │       │               │          │  │
     │                │        │       │               └──► mergeable
     │                │        │       │                      │   │  │
     │                │        │       │                      └──► merged (terminal)
     │                │        │       │                          │
     │                │        │       └──► closed ──► killed/done│
     │                │        │                                  │
     │                │        └──► detecting ◄───────────────────┘
     │                │               │
     │                │               └──► stuck ──► needs_input
     │                │                       │           │
     │                │                       └───────────┴──► errored (terminal)
     │                │
     └──► killed (manual termination)
     │
     └──► errored (workspace creation failed, etc.)
```

#### Transition Conditions

| From | To | Condition |
|------|----|-----------|
| spawning | working | runtime.isAlive = true AND agent.getActivityState = active |
| spawning | detecting | activity probe returns null/stale |
| spawning | killed | manual `ao kill` |
| spawning | errored | workspace.create throws |
| detecting | working | activity becomes active |
| detecting | stuck | DETECTING_MAX_ATTEMPTS (3) exceeded OR 5min timeout |
| detecting | needs_input | agent.getActivityState = waiting_input |
| working | pr_open | scm.detectPR returns PRInfo |
| working | stuck | idle > threshold (default 10m) |
| working | needs_input | agent.getActivityState = waiting_input |
| working | detecting | activity probe returns null |
| pr_open | ci_failed | scm.getCISummary = "failing" |
| pr_open | review_pending | CI passing, reviews requested |
| pr_open | approved | scm.getReviewDecision = "approved" |
| pr_open | mergeable | approved AND CI passing AND no conflicts |
| pr_open | merged | scm.getPRState = "merged" |
| pr_open | closed | scm.getPRState = "closed" |
| ci_failed | pr_open | CI re-run passes |
| ci_failed | working | push new commits (resets PR state) |
| review_pending | changes_requested | scm.getReviewDecision = "changes_requested" |
| review_pending | approved | scm.getReviewDecision = "approved" |
| changes_requested | working | agent addressing comments |
| changes_requested | pr_open | re-request review after fixes |
| approved | mergeable | CI passes AND no conflicts |
| approved | ci_failed | CI fails after approval |
| mergeable | merged | scm.mergePR called or auto-merge |
| merged | cleanup | internal transition |
| cleanup | done | workspace.destroy completes |
| stuck | working | activity resumes |
| stuck | needs_input | permission prompt detected |
| stuck | killed | escalation timeout |
| needs_input | working | user provides input |
| needs_input | stuck | input timeout |
| * | killed | manual termination |
| * | errored | unrecoverable exception |

#### Side Effects Per Transition

| Transition | Side Effects |
|------------|--------------|
| → spawning | writeMetadata, runtime.create, agent.setupWorkspaceHooks |
| → working | updateMetadata(status), clear detecting counters |
| → pr_open | updateMetadata(pr URL), emit pr.created event |
| → ci_failed | emit ci.failing event, trigger "ci-failed" reaction |
| → review_pending | emit review.pending event |
| → changes_requested | emit review.changes_requested, trigger reaction |
| → approved | emit review.approved event |
| → mergeable | emit merge.ready event |
| → merged | emit merge.completed event, start cleanup |
| → needs_input | emit session.needs_input, notify human |
| → stuck | emit session.stuck, trigger "agent-stuck" reaction |
| → errored | emit session.errored, notify human |
| → killed | emit session.killed, runtime.destroy |
| → done | no notification (normal completion) |
| → cleanup | workspace.destroy, runtime.destroy |

---

## Section 6: Plugin Surface Area

### Plugin Slots Overview

| Slot | Interface Methods | Built-in Plugins | External Implementations |
|------|-------------------|------------------|-------------------------|
| **runtime** | 6 | tmux (184 LOC), process (283 LOC) | 0 |
| **agent** | 10 | claude-code (878), codex (802), aider (325), cursor (433), opencode (467) | 0 |
| **workspace** | 4 | worktree (365), clone (245) | 0 |
| **tracker** | 8 | github (380), linear (727), gitlab (230) | possible |
| **scm** | 14+ | github (1065), gitlab (830) | possible |
| **notifier** | 2 | desktop (116), slack (188), webhook (166), discord (219), composio (278), openclaw (327) | possible |
| **terminal** | 4 | iterm2 (178), web (52) | 0 |
| **lifecycle** | - | (not pluggable, in core) | - |

### Interface Method Counts

#### Runtime (6 methods)
```typescript
interface Runtime {
  create(config: RuntimeCreateConfig): Promise<RuntimeHandle>
  start(handle: RuntimeHandle, command: string, env: Record<string, string>): Promise<void>
  isAlive(handle: RuntimeHandle): Promise<boolean>
  getOutput(handle: RuntimeHandle, lines?: number): Promise<string>
  sendKeys(handle: RuntimeHandle, keys: string): Promise<void>
  destroy(handle: RuntimeHandle): Promise<void>
}
```

#### Agent (10 methods)
```typescript
interface Agent {
  getLaunchCommand(config: AgentLaunchConfig): string
  getEnvironment(config: AgentLaunchConfig): Record<string, string>
  detectActivity(terminalOutput: string): ActivityState
  getActivityState(session: Session, readyThresholdMs?: number): Promise<ActivityDetection | null>
  isProcessRunning(handle: RuntimeHandle): Promise<boolean>
  getSessionInfo(session: Session): Promise<AgentSessionInfo | null>
  getRestoreCommand?(session: Session, config: AgentLaunchConfig): string | null
  setupWorkspaceHooks?(config: WorkspaceHooksConfig): Promise<void>
  postLaunchSetup?(session: Session): Promise<void>
  recordActivity?(session: Session, terminalOutput: string): Promise<void>
}
```

#### Workspace (4 methods)
```typescript
interface Workspace {
  create(config: WorkspaceCreateConfig): Promise<WorkspaceInfo>
  destroy(workspacePath: string): Promise<void>
  exists(workspacePath: string): Promise<boolean>
  getInfo(workspacePath: string): Promise<WorkspaceInfo | null>
}
```

#### Tracker (8 methods)
```typescript
interface Tracker {
  getIssue(id: string): Promise<Issue | null>
  listIssues(filters?: IssueFilters): Promise<Issue[]>
  updateIssue(id: string, update: IssueUpdate): Promise<void>
  createIssue(input: CreateIssueInput): Promise<Issue>
  addComment(issueId: string, body: string): Promise<void>
  getComments(issueId: string): Promise<{ body: string; author: string }[]>
  closeIssue(id: string): Promise<void>
  assignIssue(id: string, assignee: string): Promise<void>
}
```

#### SCM (14+ methods)
```typescript
interface SCM {
  detectPR(session: Session, project: ProjectConfig): Promise<PRInfo | null>
  getPRState(pr: PRInfo): Promise<PRState>
  getCISummary(pr: PRInfo): Promise<CIStatus>
  getCIChecks(pr: PRInfo): Promise<CICheck[]>
  getReviewDecision(pr: PRInfo): Promise<ReviewDecision>
  getMergeability(pr: PRInfo): Promise<MergeReadiness>
  getPendingComments(pr: PRInfo): Promise<ReviewComment[]>
  getAutomatedComments(pr: PRInfo): Promise<AutomatedComment[]>
  mergePR(pr: PRInfo, method?: MergeMethod): Promise<void>
  replyToComment(pr: PRInfo, commentId: string, body: string): Promise<void>
  enrichSessionsPRBatch?(prs: PRInfo[], observer: BatchObserver): Promise<Map<string, PREnrichmentData>>
  verifyWebhook?(request: SCMWebhookRequest): Promise<SCMWebhookVerificationResult>
  parseWebhookEvent?(request: SCMWebhookRequest): Promise<SCMWebhookEvent>
  assignPR?(pr: PRInfo, assignee: string): Promise<void>
}
```

#### Notifier (2 methods)
```typescript
interface Notifier {
  notify(event: OrchestratorEvent, context: NotifyContext): Promise<NotifyAction | void>
  healthCheck?(): Promise<{ ok: boolean; message?: string }>
}
```

#### Terminal (4 methods)
```typescript
interface Terminal {
  openTab(target: string): Promise<void>
  splitPane(target: string, direction: "horizontal" | "vertical"): Promise<void>
  focusSession(target: string): Promise<void>
  closeTab(target: string): Promise<void>
}
```

### Slots with Zero External Implementations

All 7 plugin slots have only built-in implementations. External plugins are **possible** for tracker, scm, and notifier (config supports package/path specifiers), but none exist in the codebase.

---

## Section 7: Coupling Score

### Top 20 Files by LOC with Coupling Metric

| Rank | File | LOC | Direct Core References | Coupling Score |
|------|------|-----|------------------------|----------------|
| 1 | `session-manager.ts` | 2801 | 16 | **16** |
| 2 | `lifecycle-manager.ts` | 1997 | 14 | **14** |
| 3 | `types.ts` | 1725 | 1 | 1 |
| 4 | `cli/commands/start.ts` | 1731 | 12 | 12 |
| 5 | `scm-github/index.ts` | 1065 | 2 | 2 |
| 6 | `agent-claude-code/index.ts` | 878 | 3 | 3 |
| 7 | `scm-gitlab/index.ts` | 830 | 2 | 2 |
| 8 | `agent-codex/index.ts` | 802 | 4 | 4 |
| 9 | `config.ts` | 784 | 2 | 2 |
| 10 | `observability.ts` | 738 | 2 | 2 |
| 11 | `tracker-linear/index.ts` | 727 | 1 | 1 |
| 12 | `cli/commands/plugin.ts` | 602 | 5 | 5 |
| 13 | `agent-report.ts` | 606 | 5 | 5 |
| 14 | `cli/commands/setup.ts` | 591 | 6 | 6 |
| 15 | `cli/commands/status.ts` | 528 | 8 | 8 |
| 16 | `plugin-registry.ts` | 527 | 1 | 1 |
| 17 | `lifecycle-state.ts` | 489 | 3 | 3 |
| 18 | `cli/commands/doctor.ts` | 466 | 5 | 5 |
| 19 | `agent-opencode/index.ts` | 467 | 4 | 4 |
| 20 | `agent-cursor/index.ts` | 433 | 3 | 3 |

### Spider Files (>10 Direct References)

| File | References | What It Touches |
|------|------------|-----------------|
| `session-manager.ts` | 16 | types, metadata, lifecycle-state, prompt-builder, activity-signal, paths, opencode-session-id, opencode-agents-md, orchestrator-session-strategy, utils/session-from-metadata, utils/validation, utils, agent-selection, metadata (4 functions), lifecycle-state (4 functions), paths (4 functions) |
| `lifecycle-manager.ts` | 14 | types, lifecycle-state, metadata, paths, lifecycle-transition, observability, notifier-resolution, agent-selection, activity-signal, agent-report, report-watcher, lifecycle-status-decisions |
| `cli/commands/start.ts` | 12 | ao-core (types, config, lifecycle-manager, session-manager, plugin-registry, paths), CLI libs (constants, shell, format, create-session-manager, preflight, running-state, project-detection, update-check) |

### Reference Details for session-manager.ts

```
Internal imports (from packages/core):
  - types.js (27 items)
  - metadata.js (8 functions)
  - lifecycle-state.js (4 functions)
  - prompt-builder.js (1 function)
  - activity-signal.js (2 functions)
  - paths.js (4 functions)
  - opencode-session-id.js (1 function)
  - opencode-agents-md.js (1 function)
  - orchestrator-session-strategy.js (1 function)
  - utils/session-from-metadata.js (1 function)
  - utils/validation.js (2 functions)
  - utils.js (1 function)
  - agent-selection.js (2 functions)
```

### Reference Details for lifecycle-manager.ts

```
Internal imports (from packages/core):
  - types.js (20+ items)
  - lifecycle-state.js (3 functions)
  - metadata.js (1 function)
  - paths.js (1 function)
  - lifecycle-transition.js (1 function)
  - observability.js (2 functions)
  - notifier-resolution.js (1 function)
  - agent-selection.js (2 functions)
  - activity-signal.js (5 functions)
  - agent-report.js (3 functions)
  - report-watcher.js (3 functions)
  - lifecycle-status-decisions.js (7 functions)
```

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Core package files | 31 |
| Core package total LOC | ~14,500 |
| CLI package files | ~40 |
| CLI package total LOC | ~8,000 |
| Plugin packages | 22 |
| Plugin total LOC | ~8,400 |
| Web package components | ~50 |
| Total interfaces in types.ts | 95 |
| Plugin slots | 7 |
| Built-in plugins | 22 |
| External plugins | 0 |
| Session states | 16 |
| State transitions | ~40 |
| Highest fan-in file | types.ts (26 importers) |
| Highest coupling file | session-manager.ts (16 refs) |
| Largest file | session-manager.ts (2801 LOC) |
