# State Machine Redesign Decision Framing

Status: Draft for human decision-making  
Audience: Maintainers deciding the redesign direction before implementation  
Goal: Surface the decisions that must be made before changing session/state behavior

## How To Use This Document

This is not a solution document. It is a decision worksheet.

The intended output from a 2-3 hour review is:

- explicit product and operational decisions
- clarified invariants
- answers to ambiguous behaviors
- a small number of “not now” deferrals

If these questions are answered clearly, implementation can be scoped cleanly. If they are not, any redesign will smuggle policy decisions into code by accident.

---

## 1. Core Framing Questions

These are the highest-leverage questions.

### 1.1 What is a session supposed to represent?

Choose one or clarify the boundary:

- a running agent process
- a unit of work on an issue/task
- a workflow record that may outlive the process
- a PR-oriented work item
- a container for all of the above

Why this matters:

- if a session represents a process, process death should dominate
- if a session represents work, process death may be recoverable and not terminal
- if a session represents workflow, PR state may matter more than runtime state

### 1.2 What kinds of truths need to be represented separately?

Decide whether these must remain separate:

- runtime reachability
- process liveness
- work/activity state
- PR/workflow state
- operator attention state
- termination reason

Question:

- should these be separate first-class facts, or should some continue to be collapsed?

### 1.3 What should be stored versus derived?

Decide which of the following should be persisted as truth:

- workflow phase
- activity/work state
- attention level
- termination reason
- “stuck”
- “needs input”

Question:

- which values are authoritative facts, and which are projections for UI/notifications?

---

## 2. Session Lifecycle Policy Questions

### 2.1 When does a session officially begin?

Possible definitions:

- when the session ID is reserved
- when metadata is written
- when the runtime is created
- when the prompt is delivered
- when the agent acknowledges work

Question:

- which point should count as “session exists and may be shown/tracked normally”?

### 2.2 When is a session considered active?

Question:

- is “active” about recent output, recent structured activity, recent tool use, recent file changes, or something else?

### 2.3 When is a session considered complete?

Possible answers:

- when the PR is opened
- when the PR is approved
- when the PR is merged
- when the agent says it is done
- when cleanup/archive finishes

Question:

- what user-visible milestone should “complete” mean?

### 2.4 What should terminal mean?

Question:

- should terminal mean “cannot progress further”, “will no longer be polled”, “runtime is dead”, or “workflow ended”?

---

## 3. PR-Related Decision Points

These are currently under-specified and likely to drive surprising behavior.

### 3.1 What should happen when a PR is opened?

Questions:

- should session workflow immediately change to a PR phase?
- should opening a PR change operator attention?
- should the agent keep working after PR creation by default?
- should PR existence ever affect liveness interpretation?

### 3.2 What should happen when a PR is closed?

Questions:

- does PR closure mean the session should terminate?
- if yes, is that always true or only for some closure causes?
- if no, should the session continue working, pause, or request human input?
- should the system distinguish “closed by agent”, “closed by reviewer”, and “closed by human outside AO”?

### 3.3 What should happen when a PR is merged?

Questions:

- should merge immediately end the session?
- should the runtime/process be killed automatically?
- should the session remain inspectable as live if the agent is still running?
- does merge imply success regardless of process state?

### 3.4 What should happen when a PR is clicked in the UI?

Questions:

- is click behavior purely navigational?
- should clicking imply ownership transfer, investigation mode, terminal attachment, or nothing?
- should UI interaction ever mutate session state?

### 3.5 What should happen when PR state disagrees with agent state?

Examples:

- PR merged but agent still producing output
- PR closed but agent still alive
- PR open but runtime is gone

Questions:

- which truth wins in UI?
- which truth wins operationally?
- should the disagreement be surfaced explicitly?

---

## 4. Runtime and Liveness Decision Points

### 4.1 What should happen when the runtime dies?

Questions:

- should the session immediately become terminal?
- should the system wait for corroborating evidence first?
- should the session be marked recoverable versus unrecoverable?
- should UI say “runtime lost”, “session killed”, or something else?

### 4.2 What should happen when the process appears dead but recent activity exists?

Questions:

- should recent structured activity override process death temporarily?
- for how long?
- is disagreement treated as “alive”, “dead”, or “unknown”?

### 4.3 What should happen when the runtime exists but the agent process does not?

Questions:

- is this a dead session, a booting session, a broken runtime, or an unknown state?
- should the answer differ during spawn versus steady-state?

### 4.4 What should happen when probes fail?

Examples:

- `ps` times out
- tmux returns inconsistent data
- JSONL is missing
- activity parser throws

Questions:

- should failure preserve prior state, yield `unknown`, or force a fallback classification?
- what level of uncertainty is acceptable before showing a terminal state?

### 4.5 When should the system declare death?

Questions:

- can any single probe declare death?
- should death require corroboration?
- should there be a confidence or evidence threshold?
- should user-triggered termination be treated differently from inferred death?

---

## 5. Signal Disagreement Questions

This is the heart of the current ambiguity.

### 5.1 What should happen when signals disagree?

Examples:

- runtime alive, process dead
- runtime dead, recent activity exists
- process alive, no activity for a long time
- PR merged, runtime alive

Questions:

- should the system prefer explicit events over heuristics?
- should it prefer “unknown” over a decisive label?
- what disagreements should be surfaced to the user rather than hidden?

### 5.2 Do we want a first-class “unknown” state?

Questions:

- is `unknown` a real state we should expose?
- if yes, where: liveness, activity, workflow, attention, or all?
- if no, what should be shown instead?

### 5.3 Should stale data be treated as evidence?

Questions:

- when is old activity still relevant?
- when does it stop protecting against dead classification?
- should freshness windows differ by source type?

---

## 6. Idle, Stuck, and Waiting Decision Points

### 6.1 What should “idle” mean?

Possible meanings:

- no output recently
- no meaningful work recently
- waiting naturally for next step
- stale but healthy

Question:

- what user expectation should “idle” communicate?

### 6.2 What should “stuck” mean?

Questions:

- should “stuck” exist at all?
- is it a factual state or an operator interpretation?
- should it mean “no progress for too long”, “blocked”, “unknown but suspicious”, or something else?

### 6.3 What should happen when a session is idle for a long time?

Questions:

- should it escalate to human attention automatically?
- should it stay in the same workflow phase with a warning?
- should it become recoverable/paused?
- should idle duration thresholds differ before and after PR creation?

### 6.4 What should happen when user input is required?

Questions:

- should this override workflow phase or coexist with it?
- should UI show both “awaiting review” and “needs input” if both are true?
- does “needs input” pause automation?
- how stale can a user-input request become before it stops being actionable?

### 6.5 What should happen when blocked/error states are detected?

Questions:

- should blocked imply human attention immediately?
- should blocked be distinct from needs-input?
- should blocked sessions keep being polled for recovery?

---

## 7. UI and User Expectation Questions

### 7.1 What does the user expect one headline status to mean?

Question:

- if the UI only shows one primary badge/label, should it prioritize workflow, liveness, or attention?

### 7.2 Should UI ever hide disagreement?

Questions:

- if the process appears dead but the PR is open and recent activity exists, should the UI compress that to one label or show multiple facts?
- is “simple but misleading” acceptable?

### 7.3 What should the dashboard optimize for?

Choose priority:

- operational correctness
- low cognitive load
- fastest human triage
- preserving implementation simplicity

### 7.4 What actions should be available in each ambiguous state?

Questions:

- should users be able to restore/restart when liveness is uncertain?
- should kill/terminate be offered when a PR is merged but runtime is alive?
- should “send message” be available when runtime truth is not confirmed?

---

## 8. Recovery and Restore Policy Questions

### 8.1 What should be restorable?

Questions:

- only sessions with dead runtimes?
- sessions with closed PRs?
- sessions with merged PRs?
- sessions waiting for input?

### 8.2 What does restore mean?

Possible meanings:

- reattach to existing runtime
- recreate runtime and continue same work
- create a new session seeded from old context

Question:

- which of these behaviors should the product own under “restore”?

### 8.3 When should the system auto-recover versus wait for a human?

Questions:

- should AO attempt recovery for certain termination reasons?
- what failures are safe to auto-recover?
- what failures must require human confirmation?

---

## 9. Invariants To Decide Explicitly

These should become hard rules if accepted.

### 9.1 Possible invariants

Review and decide yes/no:

- a single weak signal must never unilaterally declare death
- activity must never encode death
- attention must not overwrite workflow truth
- PR state must not directly overwrite runtime truth
- terminal outcomes must have an explicit reason
- uncertainty should be represented rather than hidden
- UI should not mutate session state by passive inspection/clicking

### 9.2 Which invariants are product commitments versus implementation preferences?

Question:

- which of the above must hold long-term, even if implementation changes?

---

## 10. Observability and Debuggability Questions

### 10.1 What evidence should always be available when a state changes?

Questions:

- should the system record which signals were consulted?
- should it record why a status was chosen over alternatives?
- should evidence be exposed only in logs, or also in API/UI?

### 10.2 What disagreements deserve special logging?

Examples:

- recent activity plus dead process
- PR merged plus runtime alive
- waiting-input state with no visible prompt

### 10.3 How much explanation should the user get?

Question:

- should the UI show just a label, or a short “why” explanation for non-obvious states?

---

## 11. Scope-Control Questions

These are meant to prevent an implementation from turning into a total rewrite.

### 11.1 What must be solved in the first redesign pass?

Candidates:

- false dead/killed transitions
- spawn-time races
- activity/liveness separation
- explicit termination reasons
- UI simplification

Question:

- which 2-3 items are required for the first milestone?

### 11.2 What should explicitly wait?

Candidates:

- full dashboard/API redesign
- event-sourced history
- orchestrator-specific UX changes
- deep restoration semantics

Question:

- what is intentionally out of scope for phase one?

---

## 12. Recommended Human Review Output

At the end of the review, maintainers should ideally produce:

1. A short statement of what a session represents.
2. A list of fact domains that must be separated.
3. A policy answer for PR open/close/merge behavior.
4. A policy answer for runtime death and signal disagreement.
5. A decision on whether `stuck` and `needs input` are facts or projections.
6. A small set of hard invariants.
7. A phase-one scope boundary.

If those seven outputs exist, the redesign can be written without policy guesswork.

---

## 13. Suggested Review Order

To fit the 2-3 hour window:

1. Answer Sections 1-4 first.
2. Decide Sections 5-6 next.
3. Use Sections 7-9 to lock UI/invariant consequences.
4. Finish with Sections 10-11 to control rollout scope.

That should be enough to turn this from “state cleanup” into a deliberate product/architecture decision.
