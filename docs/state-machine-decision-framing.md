# State Machine Redesign Decision Framing

Status: Working draft based on human review notes  
Purpose: Convert raw redesign thoughts into a cleaner decision record before implementation  
Scope: Worker sessions, orchestrator sessions, PR interaction, liveness, UI expectations, recovery policy

## Intent

This document does not define the final redesign. It records the current human decisions, strong preferences, and unresolved questions in a form that can guide implementation planning.

The key shift in thinking is:

- stop trying to infer everything from weak signals
- ask the agent to report meaningful state transitions where possible
- keep session state and PR state separate
- avoid killing sessions automatically just because a PR changed state
- expose ambiguity honestly instead of pretending the system knows more than it does

---

## 1. High-Level Position

### 1.1 What a session represents

There are effectively two session types:

- `orchestrator` session
- `worker` session

These should not be treated identically.

#### Orchestrator session

The orchestrator is a long-lived coordination agent. It may eventually track useful aggregate information such as spawned workers and related PRs, but its defining behavior is durability, not short-lived task execution.

Current position:

- orchestrators should be deliberately hard to kill
- orchestrators should not be terminated casually or by incidental state confusion
- there should not be an easy accidental path that marks an orchestrator dead

#### Worker session

A worker session is closer to a workflow record than a pure process record.

Current position:

- a worker is strongly related to PR state
- a worker is not defined only by PR state
- a merged PR does not automatically mean the worker session should be killed
- the worker session may outlive a process and may be recoverable

### 1.2 What truths should exist separately

The redesign should separate at least these concerns:

- session state
- PR state
- reason metadata explaining why the state is what it is

The preferred shape is not just “state = X”, but more like:

- process/session state: `working`, `idle`, `detecting`, `killed`
- reason: `started`, `fixing-ci`, `addressing-review-comments`, `manually-killed`, `error-in-process`
- PR state: `not-created`, `open`, `merged`, `closed`
- PR reason: `working-on-pr`, `ci-failing`, `review-comments-pending`, `merged-successfully`

Core idea:

- keep the core state simpler
- move a lot of nuance into explicit reasons

### 1.3 Stored vs derived

This remains unresolved.

Open item:

- decide what should be stored as authoritative truth versus derived for UI and notifications

Topics still needing explicit decisions:

- workflow phase
- activity/work state
- attention level
- termination reason
- `stuck`
- `needs_input`

---

## 2. Session Lifecycle Decisions

### 2.1 When a session officially begins

Current position:

- a session should officially begin when the agent explicitly acknowledges that it has started work

Preferred mechanism:

- the agent should call something like `ao acknowledge <session-id>`
- this should happen because the system prompt tells the agent to do it, rather than AO guessing from weak runtime evidence

Reasoning:

- metadata creation, runtime creation, or prompt delivery do not prove the agent actually started working
- explicit acknowledgment is closer to how a real worker would confirm task pickup

### 2.2 How to think about “active”

Current position:

- “active” is less important than correctly defining `not-started`, `working`, `stuck`, and `done`
- token usage or cost signals might help in the future, but the current priority is robust state modeling, not perfect “active” inference

Working direction:

- focus on states that matter operationally
- avoid over-optimizing a fragile definition of “active”

### 2.3 When a session is complete

Current position:

- a session is considered complete when a PR is merged or closed

Important clarification:

- complete does not mean the session must be killed immediately

### 2.4 What “terminal” means

This is unresolved.

Open item:

- define whether “terminal” means workflow complete, runtime dead, no further polling, no further automation, or fully archived

---

## 3. PR-Related Policy

### 3.1 What happens when a PR is opened

Current position:

- opening a PR should notify the user
- opening a PR should preferably notify the orchestrator too
- the PR state should move to something positive such as `pr-open`
- once PR exists, the system should begin CI polling and PR-follow-up behavior

Operational expectations after PR open:

- poll CI every 30 seconds for 5 minutes
- if still unresolved after 5 minutes, reduce to 1 minute polling
- if CI fails, switch worker focus to CI fixing first
- while CI is failing, do not prioritize review comments
- once CI is fixed, fetch comments and process them

Suggested worker/session interpretation:

- after PR creation, worker may be `idle`
- the reason should explain why, for example `pr-created`
- if CI fails or comments arrive, the worker should move back to `working`
- the reason should explain the work, for example `ci-fixing` or `resolving-comments`

### 3.2 What happens when a PR is closed

Current position:

- closed means not merged
- this should be treated as a meaningful outcome, not just a dead end

Important policy preference:

- if a PR is closed, AO should learn from it
- if review exists, that is especially valuable input

Desired future integration:

- pipe this into learning/agent-improvement work, likely related to issue `#86`
- distinguish closure causes such as:
  - closed by agent
  - closed by reviewer
  - closed externally by another human

Likely operational direction:

- learn from the closure
- then terminate or close the session deliberately

### 3.3 What happens when a PR is merged

This is one of the clearest decisions.

Current position:

- merged PR does **not** mean kill the session
- merged PR should notify the user and orchestrator
- after merge, the system should ask or offer whether to keep the session alive or kill it

Suggested UX:

- popup notification
- sidebar control
- explicit kill/keep action

Strong rule:

- do not automatically kill just because merge happened

### 3.4 What happens when a PR is clicked in the UI

Current position:

- clicking a PR should just open the link

Strong rule:

- no hidden tracking behavior
- no state mutation from clicking
- no extra intelligence layered onto a simple navigation action

### 3.5 What happens when PR state and agent state disagree

Current position:

- the system should be redesigned so this disagreement becomes rare
- if it still happens, the right response is recovery and explicit handling, not pretending the disagreement is normal

Example direction:

- if workflow says work should continue but the agent died, spawn or resume another agent with context explaining what happened and why it is taking over

---

## 4. Runtime, Process, and Liveness

### 4.1 What happens when runtime/process evidence becomes inconsistent

The following questions were answered together:

- what happens when the runtime dies
- what happens when process appears dead but recent activity exists
- what happens when runtime exists but agent process does not

Current position:

- introduce a `detecting` state
- do not immediately guess the final answer when runtime/process evidence is inconsistent
- run an explicit evidence-gathering pass

What `detecting` is meant to communicate:

- “we know something is wrong or inconsistent”
- “we are actively determining what happened”
- “the system has not given up or collapsed to a fake answer”

Evidence the system should inspect in `detecting`:

- tmux/runtime state
- agent process ID state
- logs if available
- whether the session is recoverable

### 4.2 What happens when probes fail

Current position:

- show that the system could not detect cleanly
- offer retry

Desired behavior:

- avoid pretending a probe failure equals death
- keep the failure explicit and actionable

### 4.3 When the system should declare death

Current position:

- user-triggered termination is authoritative
- otherwise, dead tmux/runtime plus dead agent process is the strongest practical evidence
- JSONL/activity logs should not be the primary basis for declaring death

Important nuance:

- runtime + process may be sufficient most of the time, but the system should still inspect surrounding context rather than making an overly shallow call

---

## 5. Signal Disagreement

### 5.1 General policy when signals disagree

Current position:

- the real goal is to eliminate avoidable disagreement, not normalize it
- JSONL is considered unreliable for final death decisions
- the system should investigate disagreement rather than flatten it into a wrong label

Current practical direction:

- disagreement should lead to `detecting`
- the system should keep scanning for a proper explanation

### 5.2 Whether to expose an `unknown` state

Current position:

- no first-class `unknown`
- use `detecting` instead

Why:

- `unknown` feels passive
- `detecting` better communicates that the system is actively resolving ambiguity

### 5.3 Whether stale data counts as evidence

This remains unresolved.

Open item:

- decide when old activity is still useful and when it should stop protecting against dead classification

---

## 6. Idle, Stuck, Needs Input, and Blocked

### 6.1 What `idle` should mean

Current position:

- idle should be a meaningful, mutable state with explicit reasons
- AO should rely less on brittle inference and more on explicit agent reporting

Preferred future direction:

- ask the agent to report state transitions with AO commands such as “I am waiting”

Examples of valid idle reasons:

- `pr-open`
- research/non-coding task completed
- answer produced, waiting for next instruction

### 6.2 What `stuck` should mean

Current position:

- stuck means the agent is not doing what it is supposed to be doing at that stage

Examples:

- PR not created and the agent is no longer progressing
- CI is failing and the agent is not actively fixing CI
- the worker likely actually needs input or intervention

Interpretation:

- stuck is not just “quiet for too long”
- stuck is about mismatch between expected work and observed behavior

### 6.3 What should happen when a session stays idle too long

Current position:

- outcome depends on the reason for idle

Examples:

- if PR is merged and the session stays idle, surface that to the user and ask whether to kill it
- other idle cases may need different follow-up based on reason

### 6.4 What should happen when user input is required

Current position:

- notify the user immediately
- make it explicit which session needs input

Policy for long-waiting permission prompts:

- if input is required for too long, send escape and dismiss the permission prompt
- when the user returns, explain that it waited too long and was dismissed
- allow the user to restart by telling the agent to continue

Illustrative threshold from current thought:

- around 10 minutes, though this is not yet formalized

### 6.5 What `blocked` or error states should mean

Current position:

- blocked is not yet clearly separated from needs-input
- if spawn or runtime work fails transiently, retry
- if the system hits repetitive issues, escalate to orchestrator and then to the user

Open item:

- define whether `blocked` is truly separate from `needs_input`, or just a specific reason category under it

---

## 7. UI and User Expectations

### 7.1 What one headline status should mean

Current position:

- the headline shown to the user should reflect truth, not convenience
- the UI should show both session state and PR state when relevant

Preferred presentation:

- not necessarily one overloaded badge
- two or three simple boxes are acceptable if that better communicates reality

### 7.2 Whether the UI should ever hide disagreement

Current position:

- no
- disagreement should surface as `detecting`

Strong rule:

- do not hide inconsistent state behind a fake confident label

### 7.3 What the dashboard should optimize for

Current position:

- usability
- correctness
- operator flexibility

Desired UX direction:

- preserve the parts of the current structure that are already good
- give users more toggles and options
- do not over-restrict the UI to what the system thinks is best

Examples:

- toggle visibility of CI state
- toggle PR state details
- terminal optional on worker session page

### 7.4 What actions should be available in ambiguous states

Current position:

- any session that the provider can resume should be resumable through AO
- kill/terminate should generally remain available for worker sessions
- when runtime truth is unresolved, sending messages should be delayed until detection completes

Illustrative interaction:

- user tries `ao send`
- AO responds that the session is in `detecting`
- once detection completes, the system or orchestrator can tell the user work can continue

---

## 8. Recovery and Restore

### 8.1 What should be restorable

Current position:

- every session that the underlying provider can restore should be restorable through AO

### 8.2 What restore means

Current position:

- restore means the underlying chat/session comes back and is ready to work again

This is not just reopening metadata. It is restoring useful working continuity.

### 8.3 When the system should auto-recover versus wait for a human

Current position:

- if the agent process died because of runtime or agent error, auto-recovery may be acceptable
- otherwise require human involvement

Open item:

- define a clearer taxonomy of recoverable vs non-recoverable failures

---

## 9. Emerging Invariants

These are not fully finalized, but several strong directions are visible.

Likely invariants:

- a weak single signal should not unilaterally declare death
- activity should not be the primary source of death decisions
- PR state should not directly overwrite session/runtime truth
- merged PR should not automatically kill the session
- clicking UI links should not mutate session state
- uncertainty/disagreement should be surfaced rather than hidden
- user-triggered kill is authoritative

Open work:

- decide which of these are permanent product invariants versus current implementation preferences

---

## 10. Observability and Debuggability

This section is still under-specified in the raw notes.

Open items:

- what evidence must be recorded on every state change
- whether evidence should be shown only in logs or also in UI/API
- which disagreements deserve special logging

Strong directional preference from the rest of the notes:

- when the system says something meaningful happened, it should be able to explain why

---

## 11. Main Open Questions Remaining

These are the most important unresolved items from the current notes:

1. What exactly counts as “terminal”?
2. What should be stored versus derived?
3. How should stale evidence be treated?
4. Is `blocked` distinct from `needs_input`, or just a reason subtype?
5. What precise timeout should govern long-waiting input prompts?
6. Which failures are safe to auto-recover?
7. What evidence must be shown during `detecting`?

---

## 12. Clean Summary of Current Position

The current human direction is clear even where details remain open:

- sessions should be modeled more like workflow records than pure process records
- orchestrators and workers should have different durability expectations
- PR state and session state should be separate
- reasons should carry more of the nuance than giant enums
- explicit agent acknowledgments/reporting are preferred over brittle inference
- merge does not imply kill
- disagreement should become `detecting`, not fake certainty
- user notifications matter a lot at PR-open, PR-merge, and needs-input moments
- restore/resume should exist wherever the provider supports it

That is enough to guide the next design pass, even before every unresolved question is closed.
