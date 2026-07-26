// Package pipelinesvc is the read/write service boundary for the pipelines HTTP
// API. The v1 implementation was stripped ahead of the v2 rebuild; what remains
// is the seam the controller and the daemon wire against, plus the merge gate
// (which holds no opinion while pipelines are not implemented).
package pipelinesvc

import (
	"context"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
)

// TriggerInput is the manual-trigger request: a definition reference (id or
// name) plus optional session and head SHA.
type TriggerInput struct {
	Ref       string
	SessionID string
	HeadSHA   string
}

// Manager is the pipelines service the HTTP controller and the lifecycle merge
// gate depend on.
type Manager interface {
	// PRBlocksMerge reports whether the most recent settled pipeline run for a
	// PR blocks it from merging.
	PRBlocksMerge(ctx context.Context, projectID domain.ProjectID, prURL, headSHA string) (bool, error)
}

// Service is the concrete Manager.
type Service struct{}

// New builds a Service.
func New() *Service { return &Service{} }

var _ Manager = (*Service)(nil)

// PRBlocksMerge holds no opinion: without a run store there is no settled run
// to consult, and pipelines must never fabricate a block.
func (s *Service) PRBlocksMerge(context.Context, domain.ProjectID, string, string) (bool, error) {
	return false, nil
}
