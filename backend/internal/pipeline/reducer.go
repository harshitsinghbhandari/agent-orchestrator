package pipeline

import (
	"fmt"
	"maps"
	"time"
)

// Reduce applies one event to one run and returns the next run state plus the
// effects the driver should execute. It is the whole transition core: fan-out,
// joins, cascading skip and run settlement all live here.
//
// The reducer is per-run (one run is an independent snapshot) and pure: it
// never mutates its input, never reads the clock, and never touches the world.
// Purity is load-bearing, because the engine keeps the pre-reduce state around
// until the returned effects have been walked.
//
// Effects come back in the order the driver should apply them: Context.md
// pointer lines first (the next stage's prompt reads them), then PersistRun so
// the state is durable before anything is launched, then the stage commands,
// then RunSettled last.
func Reduce(run RunState, ev Event) (RunState, []Effect) {
	if fired, ok := ev.(TriggerFired); ok {
		return reduceTriggerFired(run, fired)
	}
	// A settled run is done: late events from an executor that was already
	// torn down change nothing.
	if run.Status.isSettled() {
		return run, nil
	}

	switch e := ev.(type) {
	case StageLaunched:
		return reduceStageLaunched(run, e)
	case AgentSignaled:
		if !e.Done || !e.ArtifactOK {
			// An explicit fail, and a done whose artifact is missing, are
			// failure routing and the nudge: the next task owns both.
			return run, nil
		}
		// Nothing declared means nothing verified, and the signal was the whole
		// contract.
		outcome := OutcomeSucceededUnverified
		if s := run.Def.StageByID(e.Stage); s != nil && s.Produces != "" {
			outcome = OutcomeSucceeded
		}
		return settleSuccess(run, e.Stage, outcome, e.Now)
	case CommandExited:
		if e.ExitCode != 0 {
			return run, nil // failure settlement: next task
		}
		return settleSuccess(run, e.Stage, OutcomeSucceeded, e.Now)
	default:
		// StageLaunchFailed, SessionIdle, SessionGone, NudgeDelivered, Tick and
		// CancelRequested are failure routing, the nudge, deadlines and
		// cancellation, all owned by the second half of the reducer.
		return run, nil
	}
}

// reduceTriggerFired seeds the run: every reachable stage lands `pending` so
// the board renders the whole shape immediately, and the entry stage starts.
func reduceTriggerFired(run RunState, e TriggerFired) (RunState, []Effect) {
	next := run.clone()
	next.RunID = e.RunID
	next.RunDir = e.RunDir
	next.Subject = e.Subject
	next.Def = e.Def
	next.PipelineName = e.Def.Name
	if e.Subject.ProjectID != "" {
		next.ProjectID = e.Subject.ProjectID
	}
	if next.CreatedAt.IsZero() {
		next.CreatedAt = e.Now
	}
	next.UpdatedAt = e.Now
	next.Stages = map[string]*StageState{}

	plan, err := ComputePlan(&next.Def, e.Subject)
	if err != nil {
		return failAtPlanTime(next, err, e.Now)
	}

	for _, id := range plan.Reachable {
		next.Stages[id] = &StageState{
			ID:      id,
			Outcome: OutcomePending,
			// A failure-entered stage keeps the symbolic "inherit" here: the
			// tree it gets is whichever stage routes into it, known only when
			// that happens.
			WorkspaceKind: plan.Workspaces[id],
		}
	}

	next.Status = RunRunning
	entry := next.Def.EntryStage()
	starts := []Effect{startStage(&next, entry.ID, EntryTrigger, "", e.Now)}

	// advance writes through next, so it has to run before next is copied into
	// the result.
	effects := append([]Effect{PersistRun{}}, advance(&next, starts, e.Now)...)
	return next, effects
}

// failAtPlanTime settles the run before any stage runs, which is the point of
// planning at start: the one impossible workspace combination fails with the
// reason stated rather than half way through (spec section 5.3).
//
// The reason lands on the entry stage because that is the stage that never got
// to run, and it is what run detail renders.
func failAtPlanTime(next RunState, planErr error, now time.Time) (RunState, []Effect) {
	if entry := next.Def.EntryStage(); entry != nil {
		next.Stages[entry.ID] = &StageState{
			ID:         entry.ID,
			Outcome:    OutcomeFailed,
			EnteredVia: EntryTrigger,
			SettledAt:  now,
			Reason:     planErr.Error(),
		}
	}
	next.Status = RunFailed
	next.SettledAt = now
	return next, []Effect{PersistRun{}, RunSettled{Status: RunFailed}}
}

// reduceStageLaunched moves a stage from pending to running and stamps its
// deadline from the moment it actually started, not from when the run did.
func reduceStageLaunched(run RunState, e StageLaunched) (RunState, []Effect) {
	if st := run.Stages[e.Stage]; st == nil || st.Outcome != OutcomePending {
		return run, nil
	}
	next := run.clone()
	st := next.Stages[e.Stage]
	st.Outcome = OutcomeRunning
	st.StartedAt = e.Now
	st.SessionID = e.SessionID
	st.WorkspacePath = e.WorkspacePath
	if st.Attempt == 0 {
		st.Attempt = 1
	}
	if s := next.Def.StageByID(e.Stage); s != nil {
		st.DeadlineAt = e.Now.Add(s.EffectiveDeadline(next.Def.Defaults))
	}
	next.Status = RunRunning
	next.UpdatedAt = e.Now
	return next, []Effect{PersistRun{}}
}

// settleSuccess settles a running stage successfully and lets the run advance:
// on_success fans out, joins that are now complete start, and whatever can no
// longer be entered is skipped.
func settleSuccess(run RunState, stageID string, outcome Outcome, now time.Time) (RunState, []Effect) {
	if st := run.Stages[stageID]; st == nil || st.Outcome != OutcomeRunning {
		return run, nil
	}
	next := run.clone()
	st := next.Stages[stageID]
	st.Outcome = outcome
	st.SettledAt = now
	next.UpdatedAt = now

	effects := make([]Effect, 0, 4)
	// Context.md gets a pointer line only for a verified artifact: an
	// unverified success has nothing to point at.
	if def := next.Def.StageByID(stageID); outcome == OutcomeSucceeded && def != nil && def.Produces != "" {
		effects = append(effects, AppendContext{
			Line: fmt.Sprintf("stage `%s` finished, its output is at agent-outputs/%s", stageID, def.Produces),
		})
	}
	effects = append(effects, PersistRun{})

	// advance writes through next, so it has to run before next is copied into
	// the result.
	starts := startSuccessTargets(&next, stageID, now)
	effects = append(effects, advance(&next, starts, now)...)
	return next, effects
}

// advance runs the two passes that follow any settlement, then settles the run
// if nothing is left in flight. It takes the stage commands the caller already
// decided on, so they land in effect order ahead of RunSettled.
//
// run is already a copy-on-write clone by the time advance sees it, so it is
// written through in place.
func advance(run *RunState, effects []Effect, now time.Time) []Effect {
	skipUnreachable(run, now)
	if !allSettled(run) {
		return effects
	}
	run.Status = settledRunStatus(run)
	run.SettledAt = now
	return append(effects, RunSettled{Status: run.Status})
}

// startSuccessTargets takes the settled stage's on_success edges. A list fans
// out and the targets start concurrently; a target that is a join starts only
// once every stage in its needs has succeeded.
func startSuccessTargets(run *RunState, from string, now time.Time) []Effect {
	src := run.Def.StageByID(from)
	if src == nil {
		return nil
	}
	effects := make([]Effect, 0, len(src.OnSuccess))
	for _, target := range src.OnSuccess {
		def := run.Def.StageByID(target)
		if def == nil || !canEnter(run, target) || !needsMet(run, def) {
			continue
		}
		// A join has no sole predecessor, so AO_PREV_* stays unset there
		// (spec section 12.2). Same ambiguity that rejects `inherit` at a join.
		prev := from
		if len(def.Needs) > 1 {
			prev = ""
		}
		effects = append(effects, startStage(run, target, EntrySuccess, prev, now))
	}
	return effects
}

// canEnter reports whether a stage can still be entered: it must be seeded,
// pending, and not already committed to a launch. The attempt check is what
// makes a second arrival at the same stage a no-op.
func canEnter(run *RunState, id string) bool {
	st := run.Stages[id]
	return st != nil && st.Outcome == OutcomePending && st.Attempt == 0
}

// needsMet reports whether every stage in the target's needs has succeeded. A
// need that settled any other way never becomes met, and the join is skipped
// by skipUnreachable rather than started here.
func needsMet(run *RunState, def *Stage) bool {
	for _, need := range def.Needs {
		st := run.Stages[need]
		if st == nil || !st.Outcome.IsSuccess() {
			return false
		}
	}
	return true
}

// startStage commits a stage to a launch and returns the effect that performs
// it. The stage stays pending until the driver reports it launched; Attempt is
// what records that a launch is already in flight.
func startStage(run *RunState, id string, via EntryEdge, prev string, now time.Time) Effect {
	st := run.Stages[id]
	st.Attempt = 1
	st.EnteredVia = via
	st.PrevStage = prev
	run.UpdatedAt = now
	return StartStage{Stage: id, Attempt: st.Attempt}
}

// skipUnreachable settles every pending stage that nothing can route into any
// more. Without it a run never settles: plan-at-start seeds the failure path
// too, and a run where everything succeeded must still close those cards.
//
// A stage is skipped, not failed. When B does not run because A died, B did
// not fail, and conflating them makes the board unreadable at exactly the
// moment someone is debugging.
func skipUnreachable(run *RunState, now time.Time) {
	dead := map[string]bool{}
	for {
		live := enterable(run, dead)
		grew := false
		for id, st := range run.Stages {
			if st.Outcome != OutcomePending || st.Attempt > 0 || live[id] || dead[id] {
				continue
			}
			// A join whose need did not succeed dies here even while another
			// need is still running, so the board stops promising a stage that
			// cannot happen. Its own targets die on the next pass.
			dead[id] = true
			grew = true
		}
		if !grew {
			break
		}
	}
	for id := range dead {
		st := run.Stages[id]
		st.Outcome = OutcomeSkipped
		st.SettledAt = now
		run.UpdatedAt = now
	}
}

// enterable is the set of stages the run can still reach: everything in flight
// (running, or committed to a launch), plus the forward closure of that over
// success and failure edges. Stages already known dead are not traversed, so
// the skip cascades down the branch behind them.
//
// A settled stage is never included: it already routed, so it cannot route
// again.
func enterable(run *RunState, dead map[string]bool) map[string]bool {
	live := make(map[string]bool, len(run.Stages))
	queue := make([]string, 0, len(run.Stages))
	for id, st := range run.Stages {
		if dead[id] {
			continue
		}
		if st.Outcome == OutcomeRunning || (st.Outcome == OutcomePending && st.Attempt > 0) {
			live[id] = true
			queue = append(queue, id)
		}
	}

	edges := run.Def.routingEdges()
	for len(queue) > 0 {
		id := queue[len(queue)-1]
		queue = queue[:len(queue)-1]
		for _, target := range edges[id] {
			st := run.Stages[target]
			if st == nil || dead[target] || live[target] || st.Outcome.IsSettled() {
				continue
			}
			live[target] = true
			queue = append(queue, target)
		}
	}
	return live
}

// allSettled reports whether no stage is pending or running, which is exactly
// when the run is over.
func allSettled(run *RunState) bool {
	for _, st := range run.Stages {
		if !st.Outcome.IsSettled() {
			return false
		}
	}
	return true
}

// settledRunStatus rolls the stage outcomes up into the run's board column:
// cancelled if the run was cancelled, else failed if any stage settled in
// {failed, no_output, no_signal, timed_out}, else succeeded. A
// succeeded_unverified stage still yields a succeeded run, and so does a
// skipped one.
func settledRunStatus(run *RunState) RunStatus {
	if run.Status == RunCancelled || run.CancelReason != "" {
		return RunCancelled
	}
	for _, st := range run.Stages {
		if st.Outcome.RoutesToFailure() {
			return RunFailed
		}
	}
	return RunSucceeded
}

// isSettled reports whether the run reached a terminal status.
func (s RunStatus) isSettled() bool {
	return s == RunSucceeded || s == RunFailed || s == RunCancelled
}

// clone returns a copy the reducer can write through without touching the
// caller's state. Def and Subject are frozen for the life of the run and only
// ever read, so they are shared rather than deep-copied; the stage map is
// rewritten entry by entry because that is the part every transition touches.
func (r RunState) clone() RunState {
	out := r
	out.Stages = make(map[string]*StageState, len(r.Stages))
	for id, st := range r.Stages {
		cp := *st
		out.Stages[id] = &cp
	}
	out.Nudged = maps.Clone(r.Nudged)
	return out
}
