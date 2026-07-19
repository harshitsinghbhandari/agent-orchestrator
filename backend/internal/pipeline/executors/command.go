package executors

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/aoagents/agent-orchestrator/backend/internal/pipeline"
)

// commandOutputCapBytes bounds captured stdout/stderr (1 MiB) so a runaway shim
// cannot OOM the engine.
const commandOutputCapBytes = 1 << 20

// ForkStatus classifies the linked session's PR provenance for the fork gate.
// The nil-safe Unknown value is the fail-safe default: a PR whose fork status
// the SCM plugin cannot determine is treated as untrusted.
type ForkStatus int

const (
	// ForkUnknown means fork status could not be determined; blocked by default.
	ForkUnknown ForkStatus = iota
	// ForkNo means the PR is not from a fork (or there is no PR); safe to run.
	ForkNo
	// ForkYes means the PR is from a fork; blocked unless allowForkPRs.
	ForkYes
)

// CommandSession is the linked-session facts the command executor needs: where
// to run (workspace + cwd) and whether the PR is from a fork. Injected so the
// executor stays decoupled from session storage.
type CommandSession struct {
	WorkspacePath string
	Fork          ForkStatus
	// PRNumber is surfaced in the fork-skip observation; 0 when there is no PR.
	PRNumber int
}

// CommandSessions resolves the linked worker session for a command stage.
type CommandSessions interface {
	Get(ctx context.Context, sessionID string) (CommandSession, bool, error)
}

// CommandSpec is the resolved subprocess the runner should start.
type CommandSpec struct {
	Command string
	Args    []string
	Env     map[string]string
	Dir     string
	// OutputCap bounds captured stdout/stderr bytes.
	OutputCap int
}

// CommandResult is a finished subprocess. ExitCode is meaningful only when
// Signal is empty; a non-empty Signal means the process was killed.
type CommandResult struct {
	ExitCode     int
	Signal       string
	Stdout       string
	Stderr       string
	StdoutCapped bool
	// Err is set when the process failed to spawn or wait errored for a reason
	// other than a non-zero exit (which is reported via ExitCode).
	Err error
}

// CommandProcess is a started subprocess. Done closes on exit, after which
// Result is readable. Kill terminates the process tree (the runner owns
// SIGTERM->SIGKILL escalation so detached shells do not outlive the stage).
type CommandProcess interface {
	Done() <-chan struct{}
	Result() CommandResult
	Kill()
}

// CommandRunner starts a subprocess for a command stage. The production impl
// (osRunner) shells out; unit tests inject a fake so no real process is spawned.
type CommandRunner interface {
	Start(ctx context.Context, spec CommandSpec) (CommandProcess, error)
}

// commandHandle is the running-stage token for a command stage. child is nil
// when the stage short-circuited before spawn (fork gate or a start error);
// final is then pre-populated.
type commandHandle struct {
	stageIdentity
	child CommandProcess
	final *Outcome
}

// CommandExecutor shells out a stage's command in the linked session's
// workspace and maps its JSON-over-stdout result to a verdict. Fork PRs are
// gated before any subprocess spawns.
type CommandExecutor struct {
	runner   CommandRunner
	sessions CommandSessions
}

// NewCommandExecutor builds a command executor over the given runner + session
// seams.
func NewCommandExecutor(runner CommandRunner, sessions CommandSessions) *CommandExecutor {
	return &CommandExecutor{runner: runner, sessions: sessions}
}

var _ StageExecutor = (*CommandExecutor)(nil)

// Start resolves the linked session, applies the fork-PR gate, then spawns the
// command. Fork-gated stages complete as neutral with a skip observation and
// NO subprocess is ever started. A missing session/workspace or spawn failure
// short-circuits to a failed outcome.
func (e *CommandExecutor) Start(ctx context.Context, in StartInput) (Handle, error) {
	if in.Stage.Executor.Kind != pipeline.ExecutorCommand {
		return nil, fmt.Errorf("command executor cannot start stage %q with executor.kind=%s", in.Stage.Name, in.Stage.Executor.Kind)
	}
	id := stageIdentity{runID: in.RunID, stageRunID: in.StageRunID, stageName: in.Stage.Name}
	spec := in.Stage.Executor

	session, exists, err := e.sessions.Get(ctx, in.LinkedSessionID)
	if err != nil {
		return shortCircuit(id, Outcome{Status: OutcomeFailed,
			ErrorMessage: fmt.Sprintf("failed to resolve session %s for command stage %q: %v", in.LinkedSessionID, in.Stage.Name, err)}), nil
	}
	if !exists {
		return shortCircuit(id, Outcome{Status: OutcomeFailed,
			ErrorMessage: fmt.Sprintf("command stage %q references unknown session %s", in.Stage.Name, in.LinkedSessionID)}), nil
	}

	// Fork-PR gate, BEFORE spawn. ForkUnknown is fail-safe (blocks) so untrusted
	// code we cannot classify never executes.
	if session.Fork != ForkNo && !in.AllowForkPRs {
		reason := fmt.Sprintf("PR #%d is from a fork and pipeline.allowForkPRs is not enabled", session.PRNumber)
		if session.Fork == ForkUnknown {
			reason = fmt.Sprintf("SCM plugin could not determine fork status for PR #%d; blocking by default", session.PRNumber)
		}
		return shortCircuit(id, Outcome{
			Status:    OutcomeCompleted,
			Verdict:   pipeline.VerdictNeutral,
			Artifacts: nil,
			Observations: []Observation{{
				Name: "command_stage_skipped_fork_pr",
				Data: map[string]any{
					"stage":      in.Stage.Name,
					"prNumber":   session.PRNumber,
					"isFromFork": session.Fork == ForkYes,
					"reason":     reason,
				},
			}},
		}), nil
	}

	if session.WorkspacePath == "" {
		return shortCircuit(id, Outcome{Status: OutcomeFailed,
			ErrorMessage: fmt.Sprintf("command stage %q requires a workspace but session %s has none", in.Stage.Name, in.LinkedSessionID)}), nil
	}

	dir, err := resolveCwd(session.WorkspacePath, spec.Cwd)
	if err != nil {
		return shortCircuit(id, Outcome{Status: OutcomeFailed,
			ErrorMessage: fmt.Sprintf("command stage %q: %v", in.Stage.Name, err)}), nil
	}

	child, err := e.runner.Start(ctx, CommandSpec{
		Command:   spec.Command,
		Args:      spec.Args,
		Env:       pipelineEnv(in, spec.Env),
		Dir:       dir,
		OutputCap: commandOutputCapBytes,
	})
	if err != nil {
		return shortCircuit(id, Outcome{Status: OutcomeFailed,
			ErrorMessage: fmt.Sprintf("failed to spawn command %q: %v", spec.Command, err)}), nil
	}

	return &commandHandle{stageIdentity: id, child: child}, nil
}

// Poll returns OutcomeRunning until the child exits, then interprets its exit
// code + stdout into a terminal outcome. A short-circuited handle returns its
// latched outcome immediately.
func (e *CommandExecutor) Poll(_ context.Context, h Handle) (Outcome, error) {
	handle, ok := h.(*commandHandle)
	if !ok {
		return Outcome{}, fmt.Errorf("command executor: unexpected handle type %T", h)
	}
	if handle.final != nil {
		return *handle.final, nil
	}
	select {
	case <-handle.child.Done():
		out := interpretExit(handle.stageName, handle.child.Result())
		handle.final = &out
		return out, nil
	default:
		return Outcome{Status: OutcomeRunning}, nil
	}
}

// Cancel kills the subprocess tree. Idempotent and a no-op on a short-circuited
// or already-finished handle.
func (e *CommandExecutor) Cancel(_ context.Context, h Handle) error {
	handle, ok := h.(*commandHandle)
	if !ok {
		return fmt.Errorf("command executor: unexpected handle type %T", h)
	}
	if handle.child == nil || handle.final != nil {
		return nil
	}
	handle.child.Kill()
	return nil
}

// shortCircuit builds a handle whose outcome is already decided (fork gate,
// resolution failure, spawn failure). No subprocess is attached.
func shortCircuit(id stageIdentity, out Outcome) *commandHandle {
	return &commandHandle{stageIdentity: id, child: nil, final: &out}
}

// resolveCwd joins a config-provided relative cwd onto the workspace root,
// rejecting absolute paths and ".." segments so a malicious config cannot
// escape the worktree.
func resolveCwd(base, rel string) (string, error) {
	if rel == "" {
		return base, nil
	}
	if strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, "\\") || isWindowsAbs(rel) {
		return "", fmt.Errorf("command.cwd must be a relative path inside the workspace, got %q", rel)
	}
	for _, seg := range strings.FieldsFunc(rel, func(r rune) bool { return r == '/' || r == '\\' }) {
		if seg == ".." {
			return "", fmt.Errorf("command.cwd must be a relative path inside the workspace, got %q", rel)
		}
	}
	return strings.TrimRight(base, "/\\") + "/" + strings.TrimLeft(rel, "/\\"), nil
}

func isWindowsAbs(rel string) bool {
	return len(rel) >= 2 && rel[1] == ':' &&
		((rel[0] >= 'a' && rel[0] <= 'z') || (rel[0] >= 'A' && rel[0] <= 'Z'))
}

// pipelineEnv merges a fixed pipeline/PR context env block under the stage's own
// env map. The stage's YAML env wins on any key collision (it is applied last).
// Unset PR values are omitted so the subprocess never sees an empty AO_PR_* key.
func pipelineEnv(in StartInput, stageEnv map[string]string) map[string]string {
	c := in.Context
	env := make(map[string]string, len(stageEnv)+7)
	env["AO_PIPELINE_RUN_ID"] = string(in.RunID)
	env["AO_PIPELINE_STAGE"] = in.Stage.Name
	if c.PRNumber > 0 {
		env["AO_PR_NUMBER"] = strconv.Itoa(c.PRNumber)
	}
	if c.PRURL != "" {
		env["AO_PR_URL"] = c.PRURL
	}
	if c.SourceBranch != "" {
		env["AO_PR_BRANCH"] = c.SourceBranch
	}
	if c.TargetBranch != "" {
		env["AO_PR_BASE_BRANCH"] = c.TargetBranch
	}
	if c.HeadSHA != "" {
		env["AO_PR_HEAD_SHA"] = c.HeadSHA
	}
	// Stage env applied last so an author's explicit value overrides the block.
	for k, v := range stageEnv {
		env[k] = v
	}
	return env
}

// commandTaskResult is the single JSON object a command shim writes to stdout.
type commandTaskResult struct {
	Outcome   string                   `json:"outcome"`
	Verdict   pipeline.Verdict         `json:"verdict,omitempty"`
	Artifacts []pipeline.ArtifactInput `json:"artifacts,omitempty"`
	Reason    string                   `json:"reason,omitempty"`
}

// interpretExit maps a finished subprocess to a stage outcome per the
// JSON-over-stdout contract:
//
//   - non-zero exit / signal / spawn error -> failed (the shim itself crashed;
//     a partial stdout dump is worse than a clean failure label).
//   - exit 0 with capped/empty/unparseable/invalid stdout -> failed.
//   - exit 0 with outcome=failed -> failed (with the shim's reason).
//   - otherwise -> completed, verdict from the result (or derived from outcome),
//     with a self-skip observation for outcome=skipped.
func interpretExit(stageName string, res CommandResult) Outcome {
	if res.Err != nil {
		return Outcome{Status: OutcomeFailed, ErrorMessage: fmt.Sprintf("command stage %q spawn error: %v", stageName, res.Err)}
	}
	if res.Signal != "" || res.ExitCode != 0 {
		label := fmt.Sprintf("code %d", res.ExitCode)
		if res.Signal != "" {
			label = "signal " + res.Signal
		}
		suffix := ""
		if preview := strings.TrimSpace(res.Stderr); preview != "" {
			if len(preview) > 500 {
				preview = preview[:500]
			}
			suffix = "; stderr: " + preview
		}
		return Outcome{Status: OutcomeFailed, ErrorMessage: fmt.Sprintf("command stage %q exited with %s%s", stageName, label, suffix)}
	}
	if res.StdoutCapped {
		return Outcome{Status: OutcomeFailed, ErrorMessage: fmt.Sprintf("command stage %q stdout exceeded %d bytes", stageName, commandOutputCapBytes)}
	}

	trimmed := strings.TrimSpace(res.Stdout)
	if trimmed == "" {
		return Outcome{Status: OutcomeFailed, ErrorMessage: fmt.Sprintf("command stage %q produced no JSON on stdout", stageName)}
	}

	var result commandTaskResult
	if err := json.Unmarshal([]byte(trimmed), &result); err != nil {
		return Outcome{Status: OutcomeFailed, ErrorMessage: fmt.Sprintf("command stage %q produced unparseable JSON on stdout: %v", stageName, err)}
	}
	if verr := validateTaskResult(result); verr != "" {
		return Outcome{Status: OutcomeFailed, ErrorMessage: fmt.Sprintf("command stage %q JSON failed validation: %s", stageName, verr)}
	}

	if result.Outcome == "failed" {
		if reason := strings.TrimSpace(result.Reason); reason != "" {
			return Outcome{Status: OutcomeFailed, ErrorMessage: fmt.Sprintf("command stage %q reported outcome=failed: %s", stageName, reason)}
		}
		return Outcome{Status: OutcomeFailed, ErrorMessage: fmt.Sprintf("command stage %q reported outcome=failed", stageName)}
	}

	verdict := result.Verdict
	if verdict == "" {
		verdict = defaultVerdictFor(result.Outcome)
	}
	out := Outcome{Status: OutcomeCompleted, Verdict: verdict, Artifacts: result.Artifacts}
	if result.Outcome == "skipped" {
		data := map[string]any{"stage": stageName}
		if result.Reason != "" {
			data["reason"] = result.Reason
		}
		out.Observations = []Observation{{Name: "command_stage_self_skipped", Data: data}}
	}
	return out
}

func defaultVerdictFor(outcome string) pipeline.Verdict {
	if outcome == "succeeded" {
		return pipeline.VerdictPass
	}
	return pipeline.VerdictNeutral // "neutral" and "skipped" both map to neutral
}

// validateTaskResult returns "" when the decoded result is well-formed, else a
// human-readable reason. Decoding already rejected unknown fields and bad
// types; this enforces the outcome enum.
func validateTaskResult(r commandTaskResult) string {
	switch r.Outcome {
	case "succeeded", "failed", "neutral", "skipped":
	default:
		return fmt.Sprintf(`field "outcome" must be one of "succeeded"|"failed"|"neutral"|"skipped", got %q`, r.Outcome)
	}
	switch r.Verdict {
	case "", pipeline.VerdictPass, pipeline.VerdictFail, pipeline.VerdictNeutral:
	default:
		return fmt.Sprintf(`field "verdict" must be "pass"|"fail"|"neutral", got %q`, r.Verdict)
	}
	return ""
}
