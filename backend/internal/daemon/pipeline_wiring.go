package daemon

import (
	"context"
	"log/slog"
)

// pipelineStack is the single wiring seam for the pipelines subsystem. The v1
// engine supervisor and CDC trigger bridge were stripped ahead of the v2
// rebuild, so the stack is currently empty and its lifecycle is a no-op.
type pipelineStack struct{}

// startPipelineEngine is a no-op until the v2 engine is wired back in. It still
// runs behind the AO_PIPELINES flag so the enablement path stays exercised.
func startPipelineEngine(_ context.Context, log *slog.Logger) *pipelineStack {
	log.Info("pipelines v2: engine not yet wired")
	return &pipelineStack{}
}

// Stop tears the stack down. Nil-safe, so callers need no extra guard.
func (p *pipelineStack) Stop(context.Context) {}
