package executors

import (
	"strings"
	"testing"

	"github.com/aoagents/agent-orchestrator/backend/internal/pipeline"
)

func agentStage(mode pipeline.TaskMode) pipeline.Stage {
	return pipeline.Stage{
		Name:     "review",
		Executor: pipeline.StageExecutor{Kind: pipeline.ExecutorAgent, Plugin: "claude", Mode: mode},
		Task:     pipeline.TaskSpec{Prompt: "Look for bugs."},
	}
}

func TestBuildStagePrompt_CoreShape(t *testing.T) {
	round := 3
	got := buildStagePrompt("ci", agentStage(pipeline.ModeReview), &round)

	for _, want := range []string{
		"## Pipeline Stage",
		"Pipeline: ci",
		"Stage: review",
		"Mode: review",
		"Loop round: 3",
		"## Task",
		"Look for bugs.",
		"## Reporting Findings",
		".ao/" + pipeline.FindingsFilename,
		".ao/" + pipeline.FindingsFilename + ".tmp",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("prompt missing %q\n---\n%s", want, got)
		}
	}
}

func TestBuildStagePrompt_ReviewModeFindingSchema(t *testing.T) {
	got := buildStagePrompt("ci", agentStage(pipeline.ModeReview), nil)
	if !strings.Contains(got, `"finding"`) || !strings.Contains(got, "severity") {
		t.Errorf("review mode must document the finding record schema\n%s", got)
	}
	if strings.Contains(got, "Loop round:") {
		t.Error("nil loopRound must not render a Loop round line")
	}
}

func TestBuildStagePrompt_AnswerModeJSONSchema(t *testing.T) {
	got := buildStagePrompt("ci", agentStage(pipeline.ModeAnswer), nil)
	if !strings.Contains(got, `"json"`) || !strings.Contains(got, "outputSchema") {
		t.Errorf("answer mode must document the json record schema\n%s", got)
	}
}

func TestBuildStagePrompt_BlocksMergeNotice(t *testing.T) {
	stage := agentStage(pipeline.ModeReview)
	blocks := true
	stage.Policy = &pipeline.StagePolicy{BlocksMerge: &blocks}
	got := buildStagePrompt("ci", stage, nil)
	if !strings.Contains(got, "block merge") {
		t.Errorf("blocksMerge stage must warn about blocking merge\n%s", got)
	}
}

func TestBuildStagePrompt_InputsRendered(t *testing.T) {
	stage := agentStage(pipeline.ModeReview)
	stage.Task.Inputs = map[string]any{"threshold": 5}
	got := buildStagePrompt("ci", stage, nil)
	if !strings.Contains(got, "## Inputs") || !strings.Contains(got, "threshold") {
		t.Errorf("inputs must be rendered as a JSON block\n%s", got)
	}
}

func TestBuildStagePrompt_NonAgentStageOmitsMode(t *testing.T) {
	stage := pipeline.Stage{
		Name:     "typecheck",
		Executor: pipeline.StageExecutor{Kind: pipeline.ExecutorCommand, Command: "tsc"},
	}
	got := buildStagePrompt("ci", stage, nil)
	if strings.Contains(got, "Mode:") {
		t.Errorf("command stage has no agent mode line\n%s", got)
	}
}
