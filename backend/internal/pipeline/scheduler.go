package pipeline

import "time"

// DAG-aware scheduling for the pipeline reducer.
//
// Pure: every function takes the driver-stamped clock as a parameter; no clock
// reads, no I/O. Split out from the reducer so it can stay focused on
// event-shape transitions while the dependency / routing logic lives here.
//
// Ordering invariants (what callers can rely on):
//   - Skips cascade in a single pass: skipping a stage may make a downstream
//     stage's routes evaluate to false, marking it skipped, which may cascade
//     further. scheduleAfterChange runs the cascade to fixpoint before emitting
//     any START_STAGE effects.
//   - Stage declaration order is preserved as priority for slotting: when more
//     stages are eligible than MaxConcurrentStages allows, earlier-declared
//     stages win the available slots. This keeps linear pipelines (no
//     dependsOn) behaviorally identical to v0.
//
// Ported from the old TypeScript dag.ts (scheduler part; cycle detection lives
// in dag.go).

// scheduleResult is the output of scheduleAfterChange.
type scheduleResult struct {
	// run is the run with any newly-skipped stages applied; may equal the input.
	run RunState
	// startEffects are START_STAGE effects for stages eligible to run, capped
	// by concurrency.
	startEffects []Effect
	// newlySkipped lists stage names that transitioned pending -> skipped
	// during this call.
	newlySkipped []string
	// allTerminal is true iff every stage is in a terminal status.
	allTerminal bool
}

// scheduleAfterChange, after a state change (TRIGGER_FIRED, STAGE_COMPLETED,
// RUN_RESUMED), figures out which pending stages should be skipped (routes
// predicate failed) and which are eligible to start. Cascade skips run to
// fixpoint before emitting any START_STAGE effects, so downstream stages whose
// dependencies were just skipped get marked skipped in the same reducer step.
func scheduleAfterChange(run RunState, now time.Time) scheduleResult {
	current, newlySkipped := applyEligibleSkips(run, now)

	max := 1
	if current.PipelineConfigSnapshot.MaxConcurrentStages != nil {
		max = *current.PipelineConfigSnapshot.MaxConcurrentStages
	}
	inflight := 0
	for _, s := range current.Stages {
		if s.Status == StageStatusRunning {
			inflight++
		}
	}
	slots := max - inflight
	if slots < 0 {
		slots = 0
	}

	var startEffects []Effect
	if slots > 0 {
		for i := range current.PipelineConfigSnapshot.Stages {
			stageDef := current.PipelineConfigSnapshot.Stages[i]
			if len(startEffects) >= slots {
				break
			}
			state := current.Stages[stageDef.Name]
			if state.Status != StageStatusPending {
				continue
			}
			if !areDepsSatisfiedForStart(stageDef, current.Stages) {
				continue
			}
			if !evaluateRoutes(stageDef, current) {
				continue
			}
			startEffects = append(startEffects, StartStage{
				RunID:      current.RunID,
				StageRunID: state.StageRunID,
				Stage:      stageDef,
			})
		}
	}

	allTerminal := true
	for _, s := range current.Stages {
		if !s.Status.IsTerminal() {
			allTerminal = false
			break
		}
	}
	return scheduleResult{
		run:          current,
		startEffects: startEffects,
		newlySkipped: newlySkipped,
		allTerminal:  allTerminal,
	}
}

// applyEligibleSkips walks the pipeline and marks as skipped every pending
// stage whose:
//   - preconditions (dependsOn ∪ routes refs) are all in a terminal state
//     (only then is the activation decision deterministic), AND
//   - routes predicate evaluates to false (or, when routes is unset, any
//     dependsOn reached a non-succeeded terminal state).
//
// Iterates to fixpoint so cascade skips land in one reducer step. routes may
// reference stages outside dependsOn (e.g. a parallel branch the user wants to
// react to without forcing serialization); the scheduler waits for those
// references to be terminal too before deciding.
func applyEligibleSkips(run RunState, now time.Time) (RunState, []string) {
	current := run
	var newlySkipped []string
	changed := true
	for changed {
		changed = false
		for i := range current.PipelineConfigSnapshot.Stages {
			stageDef := current.PipelineConfigSnapshot.Stages[i]
			state := current.Stages[stageDef.Name]
			if state.Status != StageStatusPending {
				continue
			}
			if !arePreconditionsTerminal(stageDef, current.Stages) {
				continue
			}

			var shouldSkip bool
			if stageDef.Routes != nil {
				shouldSkip = !evaluatePredicateForRun(stageDef.Routes.When, current)
			} else {
				shouldSkip = !areAllDepsSucceeded(stageDef, current.Stages)
			}

			if shouldSkip {
				completed := now
				skipped := state
				skipped.Status = StageStatusSkipped
				skipped.CompletedAt = &completed
				current = patchRun(current, map[string]StageState{stageDef.Name: skipped}, now)
				newlySkipped = append(newlySkipped, stageDef.Name)
				changed = true
			}
		}
	}
	return current, newlySkipped
}

func arePreconditionsTerminal(stage Stage, stages map[string]StageState) bool {
	if !areDepsTerminal(stage, stages) {
		return false
	}
	if stage.Routes != nil {
		for _, ref := range stage.Routes.When.ReferencedStages() {
			refState, ok := stages[ref]
			if !ok || !refState.Status.IsTerminal() {
				return false
			}
		}
	}
	return true
}

func areDepsTerminal(stage Stage, stages map[string]StageState) bool {
	for _, dep := range stage.DependsOn {
		depState, ok := stages[dep]
		if !ok || !depState.Status.IsTerminal() {
			return false
		}
	}
	return true
}

func areAllDepsSucceeded(stage Stage, stages map[string]StageState) bool {
	for _, dep := range stage.DependsOn {
		depState, ok := stages[dep]
		if !ok || depState.Status != StageStatusSucceeded {
			return false
		}
	}
	return true
}

// areDepsSatisfiedForStart reports whether a stage is eligible to start. With
// no routes, every dependsOn must be succeeded so the scheduler doesn't
// optimistically start a stage whose upstream skipped or failed. When routes
// IS set the user opts into custom activation semantics (recovery branches
// with routes.when referencing failed upstream are the canonical case): we
// only require deps to be terminal (already ensured by
// arePreconditionsTerminal) and let the routes predicate make the final call.
func areDepsSatisfiedForStart(stage Stage, stages map[string]StageState) bool {
	if stage.Routes != nil {
		return areDepsTerminal(stage, stages)
	}
	return areAllDepsSucceeded(stage, stages)
}

func evaluateRoutes(stage Stage, run RunState) bool {
	if stage.Routes == nil {
		return true
	}
	return evaluatePredicateForRun(stage.Routes.When, run)
}

// evaluatePredicateForRun runs a routes-time predicate against a minimal
// PredicateCtx. The scheduler has no access to durable cross-run history, so
// History is empty; findings are surfaced from run.Findings.
func evaluatePredicateForRun(p Predicate, run RunState) bool {
	ctx := PredicateCtx{
		Run:      &run,
		History:  nil,
		Findings: run.Findings,
	}
	return Evaluate(p, ctx)
}
