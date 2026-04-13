# State Machine Redesign

Status: Draft for human review  
Primary issue: #95  
Inputs: `STATE_MANAGEMENT_AUDIT.md`, `packages/core/src/lifecycle-manager.ts`, `packages/core/src/session-manager.ts`, `packages/core/src/types.ts`, `packages/core/src/activity-log.ts`, agent plugin activity/liveness implementations, current web dashboard projections

## Why This Exists

The current session model is not failing because of one bad heuristic. It is failing because the system asks one state machine to answer too many unrelated questions:

- Is the runtime reachable?
- Is the agent process alive?
- Is the agent actively doing work?
- Is the agent blocked on human input?
- Does a PR exist and what is its review/CI state?
- Should the dashboard demand human attention?
- Why did the session stop?

Those are different fact domains with different clocks, different error modes, and different sources of truth. Today they are collapsed into:

- `Session.status`
- `Session.activity`
- ad hoc fallback logic inside `determineStatus()`

That collapse is the root structural problem.

## Executive Position

The redesign should stop treating “session state” as a single canonical enum that directly models runtime health, work progress, PR lifecycle, and human attention all at once.

Instead:

- store facts separately
- derive projections intentionally
- make liveness a dedicated subsystem
- make attention a projection, not stored truth
- make terminal outcomes explicit with reasons
- treat “unknown” as a valid result instead of force-classifying

The immediate goal is not a prettier enum. The goal is to remove contradictory state transitions and stop false `exited` / `killed` conclusions caused by mixed concerns.

---

## 1. Current Problems

### 1.1 One enum is modeling multiple independent realities

`Session.status` currently mixes:

- workflow phase: `spawning`, `working`, `pr_open`, `review_pending`
- human-attention state: `needs_input`, `stuck`
- terminal outcome: `merged`, `killed`, `terminated`, `done`, `errored`
- cleanup mechanics: `cleanup`

These are not peers. For example:

- `review_pending` is not the same kind of fact as `killed`
- `needs_input` is not the same kind of fact as `pr_open`
- `cleanup` is an operational step, not a user-facing lifecycle phase

This makes transitions hard to reason about because every new status competes with every other status.

### 1.2 `activity` is overloaded with liveness

`ActivityState` currently includes `exited`, which means the activity channel is being used to report death. That is structurally wrong:

- activity should answer “what is the agent doing?”
- liveness should answer “is the agent alive?”

Once `exited` exists in activity, activity detection becomes a hidden kill path.

### 1.3 Three liveness systems can independently kill the session

Current core flow allows all of these to conclude death:

- `runtime.isAlive(handle)`
- `agent.getActivityState()` returning `exited`
- `agent.isProcessRunning(handle)`

These checks are not coordinated, do not share evidence, and do not preserve uncertainty. That creates contradictory outcomes during:

- spawn
- tmux/session naming mismatch
- agent bootstrap delay
- slow `ps`
- regex mismatch for process detection
- JSONL lag vs process reality

### 1.4 “Unknown” is not represented, so the code guesses

The current model often converts “I cannot verify this right now” into a real status. Examples:

- no JSONL yet during spawn
- process scan timeout
- temporary tmux inconsistency
- missing runtime identity

Instead of surfacing uncertainty, the system falls through to `killed`, `working`, or `stuck`.

### 1.5 `killed` conflates multiple termination reasons

Today `killed` can mean:

- runtime actually died
- process scan said dead
- PR was closed
- user manually killed the session
- spawn-time false positive

These are not the same operational event. They need distinct termination reasons even if the UI later groups some of them.

### 1.6 Attention is stored as lifecycle status

`needs_input` and `stuck` behave more like attention projections than lifecycle truth:

- a session can be `pr_open` and also need input
- a session can be `review_pending` and also be stale
- a session can be `working` but blocked on permissions

The current model forces attention to replace workflow phase.

### 1.7 PR lifecycle is over-coupled to agent lifecycle

Examples from current behavior:

- PR closed => session `killed`
- merged => terminal session regardless of whether the runtime is still alive

That may be convenient operationally, but it is not the same fact. PR state should not directly overwrite runtime truth.

---

## 2. Design Principles

### 2.1 Facts first, projections second

Persist raw or normalized facts from authoritative systems. Derive user-facing states from those facts. Do not persist derived labels as if they were primary truth.

### 2.2 One subsystem owns one question

- runtime subsystem answers runtime reachability
- liveness subsystem answers alive/dead/unknown
- work/activity subsystem answers current execution behavior
- PR subsystem answers PR truth
- attention subsystem answers operator urgency
- termination subsystem answers why the session ended

### 2.3 “Unknown” is valid

If a probe fails or evidence conflicts, the result should be `unknown` rather than a forced terminal state.

### 2.4 Terminal outcomes require explicit reason

A session must not become terminal without a termination reason such as:

- user_killed
- runtime_lost
- process_confirmed_dead
- spawn_failed
- pr_closed_policy
- merged
- cleanup_complete

### 2.5 Attention does not replace workflow phase

The system should be able to say:

- workflow phase: `pr_open`
- attention: `needs_input`

without collapsing one into the other.

### 2.6 Source quality matters

Not all evidence should be treated equally. Recent structured activity is stronger than a stale `ps` scan. A single weak signal should not unilaterally terminate the session.

### 2.7 Migration must be incremental

The redesign should not require one “big bang” rewrite. New fact domains and derived projections should coexist with the current model until confidence is high.

---

## 3. Proposed Fact Domains

This section is the core redesign.

### 3.1 Runtime Facts

Question: can AO still reach the runtime container/session/process handle?

Suggested shape:

```ts
interface RuntimeFact {
  state: "reachable" | "unreachable" | "unknown";
  observedAt: Date;
  source: "runtime-plugin";
  handlePresent: boolean;
  handleStable: boolean;
  details?: string;
}
```

Notes:

- `reachable` is not the same as “agent alive”
- `handleStable` captures spawn-time/synthesized-handle uncertainty
- runtime facts come from runtime plugins only

### 3.2 Agent Liveness Facts

Question: do we believe the agent is alive?

Suggested shape:

```ts
interface LivenessFact {
  state: "alive" | "dead" | "unknown";
  confidence: "high" | "medium" | "low";
  observedAt: Date;
  evidence: {
    runtimeReachable: boolean | null;
    processRunning: boolean | null;
    recentStructuredActivity: boolean | null;
    lastStructuredActivityAt?: Date;
  };
}
```

Notes:

- this is the only place allowed to conclude death
- `dead` requires explicit multi-signal confirmation or a direct terminal event
- recent structured activity should veto death conclusions during disagreement windows

### 3.3 Work Facts

Question: what is the agent doing?

Suggested shape:

```ts
interface WorkFact {
  state: "booting" | "active" | "ready" | "idle" | "waiting_input" | "blocked" | "unknown";
  observedAt: Date;
  source: "native-jsonl" | "ao-jsonl" | "terminal" | "git" | "fallback";
  trigger?: string;
}
```

Notes:

- remove `exited` from work/activity entirely
- `booting` is useful during spawn and early startup
- `unknown` is better than pretending to know

### 3.4 Workflow Facts

Question: where is the session in its intended delivery lifecycle?

Suggested shape:

```ts
interface WorkflowFact {
  phase:
    | "spawning"
    | "executing"
    | "pr_open"
    | "ci_failing"
    | "awaiting_review"
    | "changes_requested"
    | "approved"
    | "merge_ready"
    | "merged"
    | "cleanup"
    | "completed";
  observedAt: Date;
  source: "session-manager" | "scm" | "cleanup";
}
```

Notes:

- these are workflow phases, not operator alerts
- `executing` is clearer than overloading `working`

### 3.5 PR Facts

Question: what is the truth about the PR?

Suggested shape:

```ts
interface PRFact {
  existence: "missing" | "present" | "unknown";
  state: "open" | "merged" | "closed" | "unknown";
  ci: "passing" | "failing" | "pending" | "unknown";
  review: "none" | "pending" | "changes_requested" | "approved" | "unknown";
  mergeability: "mergeable" | "blocked" | "unknown";
  observedAt: Date;
}
```

Notes:

- PR truth should not directly kill the runtime
- policy can later decide what to do when PR closes

### 3.6 Attention Facts

Question: does a human need to look at this now?

Suggested shape:

```ts
interface AttentionFact {
  level: "none" | "monitor" | "respond" | "review" | "merge";
  reasons: string[];
  observedAt: Date;
}
```

Notes:

- derive from work, workflow, PR, and termination facts
- do not persist as root truth unless needed for audit/history

### 3.7 Termination Facts

Question: if the session ended, why?

Suggested shape:

```ts
interface TerminationFact {
  terminal: boolean;
  reason:
    | "none"
    | "user_killed"
    | "runtime_lost"
    | "process_confirmed_dead"
    | "spawn_failed"
    | "merged"
    | "pr_closed"
    | "cleanup_complete"
    | "errored";
  observedAt?: Date;
  details?: string;
}
```

Notes:

- this replaces the current ambiguity inside `killed`
- terminality becomes explicit and explainable

---

## 4. Recommended Derived Projections

These are the labels humans see. They should be derived, not authoritative.

### 4.1 Dashboard Session Summary

The dashboard likely still needs a compact headline status. That can be derived from facts:

- if `termination.terminal === true`, show terminal headline
- else if `attention.level === "merge"`, show merge-ready
- else if `attention.level === "respond"`, show needs human input
- else show workflow phase

This preserves a simple UI without forcing the backend to persist a misleading single state.

### 4.2 Legacy Compatibility Projection

For migration, derive the current `Session.status` and `Session.activity` shape from the new facts:

- `status` becomes a compatibility projection
- `activity` becomes a compatibility projection

This lets existing API consumers work while the internals move to the new model.

---

## 5. State Transition Rules

The redesign should move from “enum-to-enum transition rules” to “fact update rules + projection rules”.

### 5.1 Runtime Rules

- runtime plugins update runtime facts only
- runtime reachability alone must not declare death
- synthesized or unstable handles produce `unknown`, not `unreachable`

### 5.2 Liveness Rules

- only the liveness subsystem may emit `dead`
- `dead` requires either:
  - an explicit terminal event from spawn/runtime teardown, or
  - multi-signal confirmation from liveness evidence
- recent structured activity within a defined freshness window should block `dead`
- disagreement yields `unknown`, not `dead`

### 5.3 Work Rules

- work facts never encode death
- `waiting_input` and `blocked` are work facts with freshness semantics
- stale actionable work facts decay to `idle` or `unknown`, not permanent operator alerts

### 5.4 Workflow Rules

- workflow phase is advanced by session-manager and SCM facts
- workflow phase is not overwritten by attention
- workflow phase is not overwritten by liveness except when terminality is confirmed

### 5.5 PR Rules

- PR closed does not automatically equal process death
- PR merged does not automatically mean runtime already stopped
- policy may choose to terminate after PR close/merge, but that must be explicit

### 5.6 Attention Rules

Suggested derivation order:

1. terminal with actionable remediation => `respond`
2. waiting_input or blocked => `respond`
3. CI failure / changes requested / conflicts => `review`
4. merge ready => `merge`
5. stale execution without clear failure => `monitor`
6. otherwise => `none`

### 5.7 Termination Rules

- terminality requires explicit reason
- multiple terminal causes should prefer the earliest authoritative reason
- later observations can add evidence but should not rewrite history silently

---

## 6. Source-of-Truth Hierarchy

The redesign should make precedence explicit.

### 6.1 Direct Event Sources

Highest authority:

- session-manager spawn success/failure events
- explicit user kill/terminate actions
- runtime destroy results
- SCM merged/closed state

These are event facts, not heuristics.

### 6.2 Structured Agent Data

Next authority:

- native JSONL
- AO activity JSONL
- agent-native session APIs

These are better than terminal scraping because they encode semantics.

### 6.3 Runtime Probes

Next authority:

- runtime plugin reachability
- process existence probes

Useful, but less authoritative than explicit lifecycle events and structured activity.

### 6.4 Fallback Heuristics

Lowest authority:

- terminal-output parsing
- file mtimes
- recent git commit heuristics

These should influence attention/work projections, not directly terminate sessions unless corroborated.

### 6.5 Conflict Resolution Rule

When sources disagree:

- preserve explicit events
- prefer structured activity over weak probes for “alive”
- prefer `unknown` over terminal conclusion when signals conflict
- record the disagreement for observability/debugging

---

## 7. Migration Plan From Current Model

This should be incremental and measurable.

### Phase 0: Vocabulary and Observability

- document the current model and intended replacement
- add observability for probe disagreement without behavior change
- emit structured liveness evidence in logs/metrics

Goal:

- learn how often runtime/process/activity disagree in production

### Phase 1: Introduce Fact Types in Core

- add new internal fact objects alongside existing `Session.status` and `Session.activity`
- keep existing API responses unchanged
- teach polling code to populate:
  - runtime facts
  - liveness facts
  - work facts
  - PR facts

Goal:

- gather new truth without breaking consumers

### Phase 2: Make Liveness Single-Owner

- centralize all liveness reasoning in one core module
- stop allowing `getActivityState()` to report death
- stop allowing fallback process checks to unilaterally kill sessions

Goal:

- remove the false `exited`/`killed` root cause without redesigning the full UI yet

### Phase 3: Derive Legacy Status From Facts

- convert `Session.status` into a derived compatibility field
- derive `activity` from work facts only
- add termination reason and attention projection to APIs

Goal:

- preserve compatibility while shifting semantics under the hood

### Phase 4: Update Web and API Consumers

- move dashboard logic to use:
  - workflow phase
  - attention
  - termination reason
  - liveness evidence
- reduce reliance on ambiguous status strings

Goal:

- eliminate UI confusion caused by overloaded legacy fields

### Phase 5: Deprecate Legacy State Shapes

- remove `activity: exited`
- shrink or rename `Session.status`
- migrate consumers to new fields

Goal:

- complete the redesign after compatibility confidence is high

---

## 8. Open Questions and Decision Points

These are the places where human review is needed before implementation.

### 8.1 Should PR closure automatically terminate a session?

Recommendation:

- no, not as a fact
- maybe as a policy action

Reason:

- PR state and runtime state are different domains

### 8.2 Should `stuck` remain a stored concept?

Recommendation:

- no as root truth
- yes as a derived attention reason such as `attention.reason = stale_execution`

Reason:

- “stuck” is interpretive, not factual

### 8.3 Do we want a real `booting` work state?

Recommendation:

- yes

Reason:

- spawn-time races exist because the system lacks a first-class way to say “runtime exists, agent not yet ready”

### 8.4 How much history should facts retain?

Recommendation:

- persist latest fact plus append audit events for major transitions

Reason:

- enough to debug without building a full event-sourced system immediately

### 8.5 Should liveness require strict quorum?

Recommendation:

- require corroboration for `dead`
- do not require quorum for `alive`

Reason:

- false-dead is currently much more expensive than false-alive

### 8.6 Should attention be server-derived only?

Recommendation:

- yes

Reason:

- avoids diverging client-side heuristics and keeps notifications/UI consistent

### 8.7 How should orchestrator sessions differ?

Recommendation:

- same fact model, different workflow projection

Reason:

- special cases should live in projections/policy, not in a separate state architecture

---

## 9. Issue Mapping

This is a proposed issue-to-redesign map, not a claim that every issue is fully solved by the redesign alone.

| Issue | Current symptom | Redesign area |
|---|---|---|
| #95 | conflicting liveness checks and false death conclusions | liveness single-owner, fact separation, source hierarchy |
| #70 | session killed immediately after spawn | booting state, spawn-time uncertainty, liveness veto by recent/expected startup activity |
| #80 | orchestrator shows exited while active | remove death from activity, orchestrator uses same fact model with different projection |
| #84 | need debug logging for status detection | structured liveness evidence, fact observability, source-of-truth logging |
| #91 | spawn prompt lost / readiness race | explicit booting readiness facts, spawn lifecycle events, no premature classification |
| #79 | terminal cannot find session during startup | spawn/readiness fact domain, session registration timing, API compatibility during boot |
| #1081 | terminal statuses and runtime truth interfere | terminal reason separated from live activity/liveness facts |

Potential follow-on issue buckets that may deserve explicit tickets:

- dashboard/API schema redesign
- termination-reason taxonomy
- attention projection redesign
- PR-closure policy vs fact separation

---

## 10. Recommended Phased Rollout

This is the opinionated rollout I would recommend.

### Stage A: Stabilize the current architecture without changing external schemas

- add liveness evidence objects
- centralize liveness decision-making
- stop `activity` from declaring death
- improve observability on disagreement

This stage should deliver the fastest user-visible correctness gains.

### Stage B: Introduce separate internal fact domains

- runtime fact
- liveness fact
- work fact
- PR fact
- termination fact

Keep legacy `status` and `activity` as derived outputs.

### Stage C: Move attention out of lifecycle status

- replace `needs_input` and `stuck` as stored primary states
- derive attention independently from workflow/liveness/work/PR facts

This removes a major source of contradictory UI.

### Stage D: Redesign API and dashboard projections

- expose fact domains directly
- keep a thin compatibility layer for old clients
- update the dashboard to render:
  - workflow phase
  - attention
  - liveness confidence
  - termination reason

### Stage E: Remove legacy concepts

- remove `activity: exited`
- deprecate ambiguous `killed`
- shrink the main status enum to real workflow phases only

---

## 11. Concrete Recommendations for Human Review

If reviewers only have 2-3 hours, I would ask them to focus on these decisions:

1. Do we agree that workflow, liveness, work activity, attention, and termination reason must become separate fact domains?
2. Do we agree that `activity` must stop encoding death?
3. Do we agree that PR state must stop directly overwriting runtime truth?
4. Do we agree that `stuck` and `needs_input` should become derived attention states instead of primary lifecycle states?
5. Do we agree that `unknown` is preferable to forced `killed` during disagreement windows?
6. Do we agree on the rollout order: liveness first, internal facts second, API/UI later?

If the answer to those six points is yes, implementation can be phased cleanly without redesign churn.

---

## 12. Recommended Next Step After Review

After comments land on this doc, the first implementation PR should be intentionally narrow:

- add centralized liveness facts and evidence
- remove death from activity detection paths
- keep legacy session status/activity externally intact for now

That keeps `#95` focused on correctness while avoiding an uncontrolled state-model rewrite in the same change.
