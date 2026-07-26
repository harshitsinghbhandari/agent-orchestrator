// Package pipelinesvc is the read/write service boundary for the pipelines HTTP
// API. The v1 implementation was stripped ahead of the v2 rebuild; what remains
// is the seam the controller and the daemon wire against, plus the merge gate
// (which holds no opinion while pipelines are not implemented).
package pipelinesvc

import (
	"context"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/pipeline"
)

// Manager is the pipelines service the HTTP controller and the lifecycle merge
// gate depend on.
type Manager interface {
	// PRBlocksMerge reports whether the most recent settled pipeline run for a
	// PR blocks it from merging.
	PRBlocksMerge(ctx context.Context, projectID domain.ProjectID, prURL, headSHA string) (bool, error)
	// SignalStage records one `ao pipeline done|fail` against a running stage.
	// The read side is not here: the agent executor polls the concrete Service
	// through executors.SignalReader, not through this HTTP-facing seam.
	SignalStage(ctx context.Context, runID pipeline.RunID, stageID string, kind pipeline.SignalKind, reason string) error
}

// Service is the concrete Manager.
type Service struct {
	store SignalStore
}

// New builds a Service over the run and signal store.
func New(store SignalStore) *Service { return &Service{store: store} }

var _ Manager = (*Service)(nil)

// PRBlocksMerge holds no opinion: without a run store there is no settled run
// to consult, and pipelines must never fabricate a block.
func (s *Service) PRBlocksMerge(context.Context, domain.ProjectID, string, string) (bool, error) {
	return false, nil
}
