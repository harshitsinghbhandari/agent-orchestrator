package controllers_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aoagents/agent-orchestrator/backend/internal/config"
	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/httpd"
	"github.com/aoagents/agent-orchestrator/backend/internal/pipeline"
	pipelinesvc "github.com/aoagents/agent-orchestrator/backend/internal/service/pipeline"
)

// fakePipelineService records the last signal it was handed and answers with a
// canned error, so the handler's status mapping is what is under test.
//
// The embedded Manager supplies the rest of the interface: those methods are
// not exercised here and panic on a nil embed if a test ever reaches one, which
// is louder than a silent zero value.
type fakePipelineService struct {
	pipelinesvc.Manager

	signalErr error
	got       pipeline.StageSignal
	calls     int
}

func (f *fakePipelineService) PRBlocksMerge(context.Context, domain.ProjectID, string, string) (bool, error) {
	return false, nil
}

func (f *fakePipelineService) SignalStage(_ context.Context, runID pipeline.RunID, stageID string, kind pipeline.SignalKind, reason string) error {
	f.calls++
	f.got = pipeline.StageSignal{RunID: runID, StageID: stageID, Kind: kind, Reason: reason}
	return f.signalErr
}

func newPipelineTestServer(t *testing.T, svc pipelinesvc.Manager) *httptest.Server {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := httptest.NewServer(httpd.NewRouterWithControl(config.Config{}, log, nil, httpd.APIDeps{Pipelines: svc}, httpd.ControlDeps{}))
	t.Cleanup(srv.Close)
	return srv
}

const signalPath = "/api/v1/pipelines/runs/run-1/stages/review/signal"

func TestPipelineSignal_NilServiceReturns501(t *testing.T) {
	srv := newPipelineTestServer(t, nil)
	body, status, headers := doRequest(t, srv, "POST", signalPath, `{"status":"done"}`)
	assertJSON(t, headers)
	assertErrorCode(t, body, status, http.StatusNotImplemented, "NOT_IMPLEMENTED")
}

func TestPipelineSignal_DoneAccepted(t *testing.T) {
	svc := &fakePipelineService{}
	srv := newPipelineTestServer(t, svc)

	body, status, headers := doRequest(t, srv, "POST", signalPath, `{"status":"done"}`)
	assertJSON(t, headers)
	if status != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", status, body)
	}
	var res struct {
		Accepted bool `json:"accepted"`
	}
	mustJSON(t, body, &res)
	if !res.Accepted {
		t.Fatalf("body = %s", body)
	}
	if svc.got.RunID != "run-1" || svc.got.StageID != "review" || svc.got.Kind != pipeline.SignalDone {
		t.Fatalf("signal = %+v", svc.got)
	}
}

func TestPipelineSignal_FailCarriesReason(t *testing.T) {
	svc := &fakePipelineService{}
	srv := newPipelineTestServer(t, svc)

	body, status, _ := doRequest(t, srv, "POST", signalPath, `{"status":"fail","reason":"upstream API is down"}`)
	if status != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", status, body)
	}
	if svc.got.Kind != pipeline.SignalFail || svc.got.Reason != "upstream API is down" {
		t.Fatalf("signal = %+v", svc.got)
	}
}

func TestPipelineSignal_ErrorMapping(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"unknown run", fmt.Errorf("%w: run-1", pipelinesvc.ErrRunNotFound), http.StatusNotFound, "PIPELINE_RUN_NOT_FOUND"},
		{"unknown stage", fmt.Errorf("%w: run-1/review", pipelinesvc.ErrStageNotFound), http.StatusNotFound, "PIPELINE_STAGE_NOT_FOUND"},
		{"stage not running", fmt.Errorf("%w: run-1/review is succeeded", pipelinesvc.ErrStageNotRunning), http.StatusConflict, "PIPELINE_STAGE_NOT_RUNNING"},
		{"store unavailable", pipelinesvc.ErrStoreUnavailable, http.StatusInternalServerError, "PIPELINE_SIGNAL_FAILED"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := newPipelineTestServer(t, &fakePipelineService{signalErr: tc.err})
			body, status, headers := doRequest(t, srv, "POST", signalPath, `{"status":"done"}`)
			assertJSON(t, headers)
			assertErrorCode(t, body, status, tc.wantStatus, tc.wantCode)
		})
	}
}

func TestPipelineSignal_BadRequests(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		wantCode string
	}{
		{"unknown status", `{"status":"maybe"}`, "INVALID_SIGNAL_STATUS"},
		{"missing status", `{}`, "INVALID_SIGNAL_STATUS"},
		{"malformed json", `{"status":`, "INVALID_JSON"},
		{"empty body", ``, "INVALID_JSON"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &fakePipelineService{}
			srv := newPipelineTestServer(t, svc)
			body, status, headers := doRequest(t, srv, "POST", signalPath, tc.body)
			assertJSON(t, headers)
			assertErrorCode(t, body, status, http.StatusBadRequest, tc.wantCode)
			if svc.calls != 0 {
				t.Fatalf("service was called %d times for a rejected body", svc.calls)
			}
		})
	}
}
