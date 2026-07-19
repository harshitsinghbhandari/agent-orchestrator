package pipeline

import "time"

// Pure pipeline reducer.
//
// Signature: Reduce(state, event) -> (state', effects). The reducer is
// synchronous and pure: it never reads the clock and never performs I/O. Every
// event carries a driver-stamped Now so timestamps are fixed at enqueue time.
// Effects are intent-only; the engine (a later task) executes them and feeds
// results back as new events.
//
// Ported from the old TypeScript reducer.ts, minus the deferred USER_FOLLOWUP /
// FOLLOWUP_REPLY events (phase 2) and the dropped v0_default exit-predicate
// placeholder (greenfield).

// Reduce applies event to state, returning the next state and the effects the
// driver must execute. The input state is never mutated.
func Reduce(state EngineState, event Event) (EngineState, []Effect) {
	switch e := event.(type) {
	case TriggerFired:
		return reduceTriggerFired(state, e)
	case StageStarted:
		return reduceStageStarted(state, e)
	case StageCompleted:
		return reduceStageCompleted(state, e)
	case StageFailed:
		return reduceStageFailed(state, e)
	case NewSHADetected:
		return reduceNewSHADetected(state, e)
	case RunCancelled:
		return reduceRunCancelled(state, e)
	case RunResumed:
		return reduceRunResumed(state, e)
	case ConfigChanged:
		return reduceConfigChanged(state, e)
	case ArtifactStatusChanged:
		return reduceArtifactStatusChanged(state, e)
	case Tick:
		// Heartbeat: nothing time-based to re-evaluate in the pure reducer.
		return state, nil
	default:
		return invalidTransition(state, "unknown event type")
	}
}

func reduceTriggerFired(state EngineState, event TriggerFired) (EngineState, []Effect) {
	now := event.Now
	key := LoopKey(event.SessionID, event.Pipeline.Name)

	if runID, ok := state.CurrentRunByLoop[key]; ok {
		if _, running := state.Runs[runID]; running {
			// An active run is already in flight for this loop; the driver must
			// cancel it (NEW_SHA_DETECTED or RUN_CANCELLED) before a new run
			// can start.
			return state, nil
		}
	}

	stages, ok := buildInitialStageStates(event.Pipeline, event.StageRunIDs)
	if !ok {
		return invalidTransition(state, "TRIGGER_FIRED missing stageRunIds for one or more stages")
	}

	priorRound := len(state.HistorySummaries[key])
	isContinuation := event.Trigger == TriggerPRUpdated || event.Trigger == TriggerManual
	loopRounds := priorRound
	if isContinuation {
		loopRounds = priorRound + 1
	} else if loopRounds < 1 {
		loopRounds = 1
	}

	initialRun := RunState{
		RunID:                  event.RunID,
		PipelineID:             event.Pipeline.ID,
		PipelineName:           event.Pipeline.Name,
		SessionID:              event.SessionID,
		PipelineConfigSnapshot: event.Pipeline,
		HeadSHA:                event.HeadSHA,
		Context:                event.Context,
		LoopState:              LoopRunning,
		LoopRounds:             loopRounds,
		Stages:                 stages,
		CreatedAt:              now,
		UpdatedAt:              now,
	}

	// Run the DAG scheduler once at trigger time so vacuous routes get a single
	// skip decision instead of sitting pending forever, and parallel-startable
	// stages emit START_STAGE in one shot.
	sched := scheduleAfterChange(initialRun, now)
	runState := sched.run

	createdObs := EmitObservation{
		Name: "pipeline.run.created",
		Data: map[string]any{
			"runId":        event.RunID,
			"pipelineName": event.Pipeline.Name,
			"sessionId":    event.SessionID,
			"trigger":      event.Trigger,
			"headSha":      event.HeadSHA,
			"loopRounds":   loopRounds,
		},
	}

	// Cascade-skipping into a fully-terminal pipeline at trigger time is only
	// possible with degenerate predicates. Terminate cleanly rather than
	// leaving an orphaned record.
	if sched.allTerminal {
		stateWithRun := replaceRun(state, runState)
		stateWithRun = withCurrentRun(stateWithRun, key, event.RunID)
		preceding := append([]Effect{createdObs}, skipObservations(runState.RunID, sched.newlySkipped, runState)...)
		decision := decideRunExit(runState, stateWithRun)
		return terminateRunFromState(stateWithRun, runState, decision.reason, now, decision.loopState, preceding)
	}

	nextState := replaceRun(state, runState)
	nextState = withCurrentRun(nextState, key, event.RunID)

	effects := make([]Effect, 0, 3+len(sched.startEffects)+len(sched.newlySkipped))
	effects = append(effects,
		PersistRun{RunState: runState},
		PersistLoopState{RunID: event.RunID, LoopState: deriveLoopStateFromRun(runState, now)},
	)
	effects = append(effects, sched.startEffects...)
	effects = append(effects, createdObs)
	effects = append(effects, skipObservations(runState.RunID, sched.newlySkipped, runState)...)

	return nextState, effects
}

// withCurrentRun returns a copy of state with key pointing at runID in
// CurrentRunByLoop (copy-on-write).
func withCurrentRun(state EngineState, key string, runID RunID) EngineState {
	current := make(map[string]RunID, len(state.CurrentRunByLoop)+1)
	for k, v := range state.CurrentRunByLoop {
		current[k] = v
	}
	current[key] = runID
	state.CurrentRunByLoop = current
	return state
}

// skipObservations builds pipeline.stage.terminated observations for stages the
// DAG scheduler just skipped, mirroring the shape emitted by
// finalizeStageCompletion so consumers need no per-source schema.
func skipObservations(runID RunID, skippedNames []string, run RunState) []Effect {
	out := make([]Effect, 0, len(skippedNames))
	for _, name := range skippedNames {
		artifactCount := 0
		if s, ok := run.Stages[name]; ok {
			artifactCount = len(s.Artifacts)
		}
		out = append(out, EmitObservation{
			Name: "pipeline.stage.terminated",
			Data: map[string]any{
				"runId":         runID,
				"stageName":     name,
				"status":        StageStatusSkipped,
				"artifactCount": artifactCount,
			},
		})
	}
	return out
}

func reduceStageStarted(state EngineState, event StageStarted) (EngineState, []Effect) {
	now := event.Now
	run, ok := state.Runs[event.RunID]
	if !ok {
		return invalidTransition(state, "STAGE_STARTED for unknown runId="+string(event.RunID))
	}
	stage, ok := run.Stages[event.StageName]
	if !ok {
		return invalidTransition(state, "STAGE_STARTED for unknown stage="+event.StageName)
	}
	if stage.Status != StageStatusPending {
		return invalidTransition(state, "STAGE_STARTED requires pending; got "+string(stage.Status)+" for "+event.StageName)
	}

	started := now
	updatedStage := stage
	updatedStage.Status = StageStatusRunning
	updatedStage.StartedAt = &started
	updatedRun := patchRun(run, map[string]StageState{event.StageName: updatedStage}, now)

	return replaceRun(state, updatedRun), []Effect{
		PersistRun{RunState: updatedRun},
		EmitObservation{
			Name: "pipeline.stage.started",
			// stageRunId rotates on every retry/revival, so it is the only
			// field that uniquely identifies this execution: attempt is not
			// enough now that outdated revival keeps the counter unchanged.
			Data: map[string]any{
				"runId":      event.RunID,
				"stageName":  event.StageName,
				"stageRunId": stage.StageRunID,
				"attempt":    stage.Attempt,
			},
		},
	}
}

func reduceStageCompleted(state EngineState, event StageCompleted) (EngineState, []Effect) {
	now := event.Now
	run, ok := state.Runs[event.RunID]
	if !ok {
		return invalidTransition(state, "STAGE_COMPLETED for unknown runId="+string(event.RunID))
	}
	stage, ok := run.Stages[event.StageName]
	if !ok {
		return invalidTransition(state, "STAGE_COMPLETED for unknown stage="+event.StageName)
	}
	if stage.Status != StageStatusRunning {
		return invalidTransition(state, "STAGE_COMPLETED requires running; got "+string(stage.Status)+" for "+event.StageName)
	}

	newArtifacts := make([]Artifact, len(event.Artifacts))
	newIDs := make([]ArtifactID, len(event.Artifacts))
	for idx, input := range event.Artifacts {
		a := materializeArtifact(input, event.RunID, stage.StageRunID, event.StageName, idx, now)
		newArtifacts[idx] = a
		newIDs[idx] = a.ArtifactID
	}

	completed := now
	updatedStage := stage
	updatedStage.Status = StageStatusSucceeded
	updatedStage.CompletedAt = &completed
	updatedStage.Verdict = event.Verdict
	updatedStage.Artifacts = append(append([]ArtifactID{}, stage.Artifacts...), newIDs...)

	return finalizeStageCompletion(state, run, event.StageName, updatedStage, newArtifacts, now)
}

func reduceStageFailed(state EngineState, event StageFailed) (EngineState, []Effect) {
	now := event.Now
	run, ok := state.Runs[event.RunID]
	if !ok {
		return invalidTransition(state, "STAGE_FAILED for unknown runId="+string(event.RunID))
	}
	stage, ok := run.Stages[event.StageName]
	if !ok {
		return invalidTransition(state, "STAGE_FAILED for unknown stage="+event.StageName)
	}
	if stage.Status != StageStatusRunning && stage.Status != StageStatusPending {
		return invalidTransition(state, "STAGE_FAILED requires running|pending; got "+string(stage.Status)+" for "+event.StageName)
	}

	completed := now
	updatedStage := stage
	updatedStage.Status = StageStatusFailed
	updatedStage.CompletedAt = &completed
	updatedStage.ErrorMessage = event.ErrorMessage

	return finalizeStageCompletion(state, run, event.StageName, updatedStage, nil, now)
}

// finalizeStageCompletion applies a stage's terminal status, materializes its
// artifacts and fingerprints, re-runs the DAG scheduler for downstream stages,
// and terminates the run (checking convergence then exit predicates) once every
// stage is terminal. Shared by STAGE_COMPLETED and STAGE_FAILED.
func finalizeStageCompletion(state EngineState, run RunState, stageName string, updatedStage StageState, newArtifacts []Artifact, now time.Time) (EngineState, []Effect) {
	// Accumulate finding fingerprints onto the run so summarizeRun can return
	// them at termination. Append rather than recompute so the reducer never
	// re-reads stored artifacts.
	var newFingerprints []string
	var newFindings []Artifact
	for i := range newArtifacts {
		a := newArtifacts[i]
		if a.Kind == ArtifactKindFinding {
			if a.Fingerprint != "" {
				newFingerprints = append(newFingerprints, a.Fingerprint)
			}
			newFindings = append(newFindings, a)
		}
	}

	runWithFingerprints := run
	if len(newFingerprints) > 0 {
		runWithFingerprints.Fingerprints = append(append([]string{}, run.Fingerprints...), newFingerprints...)
	}
	updatedRun := patchRun(runWithFingerprints, map[string]StageState{stageName: updatedStage}, now)
	// Mirror finding artifacts onto run.findings for the predicate evaluator.
	if len(newFindings) > 0 {
		updatedRun.Findings = append(append([]Artifact{}, run.Findings...), newFindings...)
	}

	var effects []Effect

	if len(newArtifacts) > 0 {
		effects = append(effects, AppendArtifacts{
			RunID:      run.RunID,
			StageRunID: updatedStage.StageRunID,
			Artifacts:  newArtifacts,
		})
	}

	effects = append(effects, EmitObservation{
		Name: "pipeline.stage.terminated",
		Data: map[string]any{
			"runId":         run.RunID,
			"stageName":     stageName,
			"status":        updatedStage.Status,
			"verdict":       updatedStage.Verdict,
			"artifactCount": len(updatedStage.Artifacts),
		},
	})

	// Failure-tolerant scheduling: STAGE_FAILED no longer immediately
	// terminates the run. scheduleAfterChange cascade-skips stages whose
	// dependsOn is no longer satisfiable AND starts any recovery branch whose
	// routes predicate now matches the failure. The run terminates only once
	// every stage is terminal.
	sched := scheduleAfterChange(updatedRun, now)
	effects = append(effects, skipObservations(run.RunID, sched.newlySkipped, sched.run)...)

	if sched.allTerminal {
		// Convergence detection runs BEFORE the regular exit decision: when the
		// prior stallWindow-1 runs plus this one expose the same finding
		// fingerprint set, terminate as converged -> stalled so a loop that hit
		// a fixpoint doesn't ping-pong forever.
		if isConverged(state, sched.run) {
			return terminateRunFromState(replaceRun(state, sched.run), sched.run, TerminationConverged, now, LoopStalled, effects)
		}
		decision := decideRunExit(sched.run, state)
		return terminateRunFromState(replaceRun(state, sched.run), sched.run, decision.reason, now, decision.loopState, effects)
	}

	// Not terminal: persist first, then start eligible stages.
	out := make([]Effect, 0, len(effects)+1+len(sched.startEffects))
	out = append(out, PersistRun{RunState: sched.run})
	out = append(out, effects...)
	out = append(out, sched.startEffects...)

	return replaceRun(state, sched.run), out
}

func reduceNewSHADetected(state EngineState, event NewSHADetected) (EngineState, []Effect) {
	key := LoopKey(event.SessionID, event.PipelineName)
	runID, ok := state.CurrentRunByLoop[key]
	if !ok {
		return state, nil
	}
	run, ok := state.Runs[runID]
	if !ok || run.HeadSHA == event.SHA {
		return state, nil
	}
	// Run becomes outdated; the loop key is freed so the driver can spawn a new
	// TRIGGER_FIRED for the new SHA.
	return terminateRun(state, run, TerminationOutdated, event.Now, LoopTerminated)
}

func reduceRunCancelled(state EngineState, event RunCancelled) (EngineState, []Effect) {
	run, ok := state.Runs[event.RunID]
	if !ok {
		return invalidTransition(state, "RUN_CANCELLED for unknown runId="+string(event.RunID))
	}
	if run.LoopState != LoopRunning && run.LoopState != LoopAwaitingContext {
		return invalidTransition(state, "RUN_CANCELLED requires running|awaiting_context; got "+string(run.LoopState))
	}
	finalState := LoopTerminated
	if event.Reason == TerminationStageFailure {
		finalState = LoopStalled
	}
	return terminateRun(state, run, event.Reason, event.Now, finalState)
}

func reduceConfigChanged(state EngineState, event ConfigChanged) (EngineState, []Effect) {
	key := LoopKey(event.SessionID, event.PipelineName)
	runID, ok := state.CurrentRunByLoop[key]
	if !ok {
		return state, nil
	}
	run, ok := state.Runs[runID]
	if !ok {
		return state, nil
	}
	return terminateRun(state, run, TerminationConfigChange, event.Now, LoopTerminated)
}

func reduceArtifactStatusChanged(state EngineState, event ArtifactStatusChanged) (EngineState, []Effect) {
	now := event.Now
	run, ok := state.Runs[event.RunID]
	if !ok {
		return invalidTransition(state, "ARTIFACT_STATUS_CHANGED for unknown runId="+string(event.RunID))
	}

	updatedRun := run
	idx := -1
	for i := range run.Findings {
		if run.Findings[i].ArtifactID == event.ArtifactID {
			idx = i
			break
		}
	}
	if idx >= 0 {
		findings := append([]Artifact{}, run.Findings...)
		findings[idx].Status = event.Status
		updatedRun.Findings = findings
	}
	updatedRun.UpdatedAt = now

	effects := []Effect{
		UpdateArtifactStatus{
			RunID:      event.RunID,
			StageRunID: event.StageRunID,
			ArtifactID: event.ArtifactID,
			Status:     event.Status,
		},
		PersistRun{RunState: updatedRun},
		EmitObservation{
			Name: "pipeline.artifact.status_changed",
			Data: artifactStatusObsData(event),
		},
	}
	return replaceRun(state, updatedRun), effects
}

func artifactStatusObsData(event ArtifactStatusChanged) map[string]any {
	data := map[string]any{
		"runId":      event.RunID,
		"stageRunId": event.StageRunID,
		"artifactId": event.ArtifactID,
		"status":     event.Status,
	}
	if event.Actor != "" {
		data["actor"] = event.Actor
	}
	return data
}

// buildInitialStageStates seeds one pending StageState per pipeline stage using
// the driver-allocated stageRunIds. Returns false when any stage lacks an id.
func buildInitialStageStates(pipeline Pipeline, stageRunIDs map[string]StageRunID) (map[string]StageState, bool) {
	out := make(map[string]StageState, len(pipeline.Stages))
	for _, stage := range pipeline.Stages {
		id, ok := stageRunIDs[stage.Name]
		if !ok || id == "" {
			return nil, false
		}
		out[stage.Name] = StageState{
			StageRunID: id,
			Status:     StageStatusPending,
			Attempt:    1,
		}
	}
	return out, true
}

type exitDecision struct {
	reason    RunTerminationReason
	loopState LoopStateName
}

// decideRunExit chooses how a run terminates once every stage is terminal:
//  1. exitPredicates.done true -> done/completed;
//  2. exitPredicates.stalled true -> stalled/stage_failure;
//  3. v0 default: any failed stage -> stalled/stage_failure, else done/completed.
//
// The reducer consults state.HistorySummaries for the run's loop key so
// loop_rounds_at_least and history-aware composites have a real ledger.
func decideRunExit(run RunState, state EngineState) exitDecision {
	exits := run.PipelineConfigSnapshot.ExitPredicates
	ctx := PredicateCtx{
		Run:      &run,
		History:  state.HistorySummaries[LoopKey(run.SessionID, run.PipelineName)],
		Findings: run.Findings,
	}

	if exits != nil && exits.Done != nil && Evaluate(*exits.Done, ctx) {
		return exitDecision{reason: TerminationCompleted, loopState: LoopDone}
	}
	if exits != nil && exits.Stalled != nil && Evaluate(*exits.Stalled, ctx) {
		return exitDecision{reason: TerminationStageFailure, loopState: LoopStalled}
	}
	return v0DefaultExitDecision(run)
}

func v0DefaultExitDecision(run RunState) exitDecision {
	for _, s := range run.Stages {
		if s.Status == StageStatusFailed {
			return exitDecision{reason: TerminationStageFailure, loopState: LoopStalled}
		}
	}
	return exitDecision{reason: TerminationCompleted, loopState: LoopDone}
}

// isConverged reports whether the prior stallWindow-1 history summaries on this
// loop plus the just-completed run all expose the same sorted-unique finding
// fingerprint set. stallWindow is per-stage; the max across stages with the
// policy set is used, and any stage with stallWindow >= 2 activates the check.
// A window of 0 or 1 is meaningless (need at least two runs to detect
// repetition) and disables the check.
func isConverged(state EngineState, run RunState) bool {
	window := 0
	for _, stage := range run.PipelineConfigSnapshot.Stages {
		if stage.Policy != nil && stage.Policy.StallWindow != nil && *stage.Policy.StallWindow > window {
			window = *stage.Policy.StallWindow
		}
	}
	if window < 2 {
		return false
	}

	history := state.HistorySummaries[LoopKey(run.SessionID, run.PipelineName)]
	if len(history) < window-1 {
		return false
	}

	current := joinSortedUnique(run.Fingerprints)
	recent := history[len(history)-(window-1):]
	for i := range recent {
		if joinSortedUnique(recent[i].Fingerprints) != current {
			return false
		}
	}
	return true
}

// joinSortedUnique renders a fingerprint set as a stable comparison key.
func joinSortedUnique(in []string) string {
	unique := sortedUnique(in)
	out := ""
	for i, s := range unique {
		if i > 0 {
			out += "|"
		}
		out += s
	}
	return out
}
