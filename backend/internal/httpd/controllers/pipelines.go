package controllers

import (
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/httpd/apispec"
	"github.com/aoagents/agent-orchestrator/backend/internal/httpd/envelope"
	"github.com/aoagents/agent-orchestrator/backend/internal/pipeline"
	pipelinesvc "github.com/aoagents/agent-orchestrator/backend/internal/service/pipeline"
)

// The wire shapes below are v1's, kept frozen so the OpenAPI document and the
// generated frontend client do not churn while the v2 engine lands. The v2 DTO
// pass renames them (run status, stage outcomes) and adds the signal, log and
// output routes.

// ---------------------------------------------------------------------------
// Path / query params (reflected into the OpenAPI spec by apispec.Build)
// ---------------------------------------------------------------------------

// PipelineIDParam is the {id} path parameter for definition update/delete.
type PipelineIDParam struct {
	ID string `path:"id" description:"Pipeline definition identifier."`
}

// PipelineRunIDParam is the {runId} path parameter shared by run routes.
type PipelineRunIDParam struct {
	RunID string `path:"runId" description:"Pipeline run identifier."`
}

// PipelineArtifactIDParam carries both path segments of the artifact route.
type PipelineArtifactIDParam struct {
	RunID      string `path:"runId" description:"Pipeline run identifier."`
	ArtifactID string `path:"artifactId" description:"Artifact identifier."`
}

// PipelineStageIDParam carries both path segments of the stage signal route.
type PipelineStageIDParam struct {
	RunID   string `path:"runId" description:"Pipeline run identifier."`
	StageID string `path:"stageId" description:"Stage id as declared in the pipeline definition."`
}

// PipelineProjectQuery is the shared `project` scoping query for the collection
// and lifecycle routes.
type PipelineProjectQuery struct {
	Project string `query:"project,omitempty" description:"Project id the pipeline belongs to (required)."`
}

// PipelineRunsQuery is the query string for GET /pipelines/runs.
type PipelineRunsQuery struct {
	Project  string `query:"project,omitempty" description:"Project id (required)."`
	Pipeline string `query:"pipeline,omitempty" description:"Filter runs to one pipeline name."`
	Status   string `query:"status,omitempty" description:"Filter runs by loop state (running|awaiting_context|done|stalled|terminated)."`
	Limit    *int   `query:"limit,omitempty" minimum:"1" description:"Cap the number of runs returned (newest first)."`
}

// ---------------------------------------------------------------------------
// Request / response DTOs
// ---------------------------------------------------------------------------

// PipelineDefinitionSummary is the wire shape for a stored definition: identity,
// name, raw YAML as authored, and timestamps. The normalized config is not
// surfaced here; the editor works from the YAML plus the JSON schema endpoint.
type PipelineDefinitionSummary struct {
	ID         string    `json:"id"`
	ProjectID  string    `json:"projectId"`
	Name       string    `json:"name"`
	YAMLSource string    `json:"yamlSource"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// ListPipelineDefinitionsResponse is the body of GET /api/v1/pipelines.
type ListPipelineDefinitionsResponse struct {
	Definitions []PipelineDefinitionSummary `json:"definitions"`
}

// PipelineDefinitionResponse is the body of create (201) and update (200).
type PipelineDefinitionResponse struct {
	Definition PipelineDefinitionSummary `json:"definition"`
}

// SavePipelineDefinitionRequest is the create/update body: the raw YAML the
// author edits. Identity and timestamps are assigned server-side.
type SavePipelineDefinitionRequest struct {
	YAMLSource string `json:"yamlSource" description:"Raw YAML pipeline definition document."`
}

// DeletePipelineDefinitionResponse is the body of DELETE /api/v1/pipelines/{id}.
type DeletePipelineDefinitionResponse struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

// ValidatePipelineDefinitionRequest is the dry-run validate body: the raw YAML
// the editor is authoring. Nothing is persisted.
type ValidatePipelineDefinitionRequest struct {
	YAMLSource string `json:"yamlSource" description:"Raw YAML pipeline definition document to validate."`
}

// PipelineValidationIssue is one validation problem: a dotted path into the
// definition document plus a human-readable message.
type PipelineValidationIssue struct {
	Path    string `json:"path" description:"Dotted path to the offending location, e.g. stages[2].dependsOn."`
	Message string `json:"message" description:"Human-readable description of the problem."`
}

// ValidatePipelineDefinitionResponse is the body of POST /api/v1/pipelines/validate.
// A validation failure is reported here as data (valid=false with the issue
// list), not as an error envelope, so the editor can render the Problems list.
type ValidatePipelineDefinitionResponse struct {
	Valid  bool                      `json:"valid"`
	Issues []PipelineValidationIssue `json:"issues"`
}

// PipelineRunSummary is the compact per-run wire shape (list + detail base).
type PipelineRunSummary struct {
	RunID             string            `json:"runId"`
	PipelineID        string            `json:"pipelineId"`
	PipelineName      string            `json:"pipelineName"`
	SessionID         string            `json:"sessionId"`
	LoopState         string            `json:"loopState"`
	TerminationReason string            `json:"terminationReason,omitempty"`
	LoopRounds        int               `json:"loopRounds"`
	HeadSHA           string            `json:"headSha"`
	StageCount        int               `json:"stageCount"`
	StageStatuses     map[string]string `json:"stageStatuses"`
	HasOpenFindings   bool              `json:"hasOpenFindings"`
	BlocksMerge       bool              `json:"blocksMerge"`
	CreatedAt         time.Time         `json:"createdAt"`
	UpdatedAt         time.Time         `json:"updatedAt"`
}

// ListPipelineRunsResponse is the body of GET /api/v1/pipelines/runs.
type ListPipelineRunsResponse struct {
	Runs []PipelineRunSummary `json:"runs"`
}

// PipelineStageView is one stage's state within a run detail.
type PipelineStageView struct {
	StageName    string     `json:"stageName"`
	StageRunID   string     `json:"stageRunId"`
	Status       string     `json:"status"`
	Attempt      int        `json:"attempt"`
	Verdict      string     `json:"verdict,omitempty"`
	StartedAt    *time.Time `json:"startedAt,omitempty"`
	CompletedAt  *time.Time `json:"completedAt,omitempty"`
	ErrorMessage string     `json:"errorMessage,omitempty"`
	// Output is a capped tail of the stage's combined stdout+stderr (command
	// stages only), empty otherwise.
	Output string `json:"output,omitempty"`
	// SessionID is the AO session the stage ran in (agent stages only), so the UI
	// can link straight to it.
	SessionID string `json:"sessionId,omitempty"`
	// Notes are human-relevant one-line annotations for the stage.
	Notes       []string `json:"notes,omitempty"`
	ArtifactIDs []string `json:"artifactIds"`
}

// PipelineArtifact is the wire shape for one artifact (a finding or a free-form
// JSON blob) attached to a run. The v2 rebuild replaces it with the `produces`
// output contract; it is kept here, frozen, only so the OpenAPI document stays
// stable while the engine is rebuilt.
type PipelineArtifact struct {
	Kind string `json:"kind"`

	FilePath        string         `json:"filePath,omitempty"`
	StartLine       int            `json:"startLine,omitempty"`
	EndLine         int            `json:"endLine,omitempty"`
	Title           string         `json:"title,omitempty"`
	Description     string         `json:"description,omitempty"`
	Category        string         `json:"category,omitempty"`
	Severity        string         `json:"severity,omitempty"`
	Confidence      float64        `json:"confidence,omitempty"`
	AnchorSignature string         `json:"anchorSignature,omitempty"`
	Data            map[string]any `json:"data,omitempty"`

	ArtifactID    string `json:"artifactId"`
	PipelineRunID string `json:"pipelineRunId"`
	StageRunID    string `json:"stageRunId"`
	StageName     string `json:"stageName"`

	Fingerprint string `json:"fingerprint,omitempty"`
	Status      string `json:"status"`

	CreatedAt     time.Time  `json:"createdAt"`
	SentToAgentAt *time.Time `json:"sentToAgentAt,omitempty"`

	BelowConfidenceThreshold bool `json:"belowConfidenceThreshold,omitempty"`
}

// PipelineRunDetail is the full reconstructed run: the summary plus per-stage
// state and the run's materialized findings.
type PipelineRunDetail struct {
	PipelineRunSummary
	Stages   []PipelineStageView `json:"stages"`
	Findings []PipelineArtifact  `json:"findings"`
}

// PipelineRunDetailResponse is the body of GET /api/v1/pipelines/runs/{runId},
// cancel, and resume.
type PipelineRunDetailResponse struct {
	Run PipelineRunDetail `json:"run"`
}

// TriggerPipelineRunRequest is the manual-trigger body.
type TriggerPipelineRunRequest struct {
	Pipeline  string `json:"pipeline" description:"Definition reference to run: its id or name."`
	SessionID string `json:"sessionId,omitempty" description:"Session id to scope the run's loop key."`
	HeadSHA   string `json:"headSha,omitempty" description:"Head commit SHA to pin the run to."`
}

// TriggerPipelineRunResponse is the body of POST /api/v1/pipelines/runs (201).
type TriggerPipelineRunResponse struct {
	RunID string `json:"runId"`
}

// PipelineArtifactResponse is the body of the artifact-fetch and
// artifact-status routes.
type PipelineArtifactResponse struct {
	Artifact PipelineArtifact `json:"artifact"`
}

// UpdatePipelineArtifactStatusRequest is the body of the artifact-status route:
// the new lifecycle status for one finding.
type UpdatePipelineArtifactStatusRequest struct {
	Status string `json:"status" description:"New artifact status: open | resolved | dismissed."`
}

// SignalPipelineStageRequest is the body of the stage signal route: how an
// agent settles its own stage, sent by `ao pipeline done|fail`.
type SignalPipelineStageRequest struct {
	Status string `json:"status" enum:"done,fail" description:"How the stage settled: done | fail."`
	Reason string `json:"reason,omitempty" description:"Why the stage failed. Carried on the failure edge and shown in run detail."`
}

// SignalPipelineStageResponse acknowledges a recorded signal. The stage does
// not settle here: the engine reads the signal on its next poll, so this is an
// acceptance receipt rather than an outcome.
type SignalPipelineStageResponse struct {
	Accepted bool `json:"accepted"`
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

// PipelinesController owns the /pipelines routes. A nil Svc (the AO_PIPELINES
// flag off) answers 501 on every one of them.
//
// The wire shapes here are still v1's. The v2 DTO pass (run status, stage
// outcomes, the signal, log and output routes, and the OpenAPI regen) is its
// own task; this controller maps v2 state onto the frozen fields so the routes
// stop returning 501 without churning the generated client.
type PipelinesController struct {
	Svc pipelinesvc.Manager
}

// Register mounts the pipeline routes. Static run/schema segments are declared
// before the {id} definition routes so chi matches them ahead of the param.
func (c *PipelinesController) Register(r chi.Router) {
	r.Get("/pipelines", c.listDefinitions)
	r.Post("/pipelines", c.createDefinition)
	r.Post("/pipelines/validate", c.validateDefinition)
	r.Get("/pipelines/schema", c.schema)

	r.Get("/pipelines/runs", c.listRuns)
	r.Post("/pipelines/runs", c.triggerRun)
	r.Get("/pipelines/runs/{runId}", c.getRun)
	r.Post("/pipelines/runs/{runId}/cancel", c.cancelRun)
	// Resume is gone in v2 (there is no resume, spec section 14.1) and the
	// artifact subsystem is deleted, but the routes stay mounted at 501 until
	// the API pass removes them from the OpenAPI document too.
	r.Post("/pipelines/runs/{runId}/resume", notImplementedHandler("POST", "/api/v1/pipelines/runs/{runId}/resume"))
	r.Get("/pipelines/runs/{runId}/artifacts/{artifactId}", notImplementedHandler("GET", "/api/v1/pipelines/runs/{runId}/artifacts/{artifactId}"))
	r.Post("/pipelines/runs/{runId}/artifacts/{artifactId}/status", notImplementedHandler("POST", "/api/v1/pipelines/runs/{runId}/artifacts/{artifactId}/status"))
	r.Post("/pipelines/runs/{runId}/stages/{stageId}/signal", c.signalStage)

	r.Put("/pipelines/{id}", c.updateDefinition)
	r.Delete("/pipelines/{id}", c.deleteDefinition)
}

// signalStagePath spells the signal route the way the OpenAPI document does.
const signalStagePath = "/api/v1/pipelines/runs/{runId}/stages/{stageId}/signal"

// signalStage records how an agent settled its own stage (spec section 6.3).
// The signal is only recorded here; the engine reads it on its next poll and
// decides the outcome, so the answer is 202 rather than the settled stage.
func (c *PipelinesController) signalStage(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", signalStagePath)
		return
	}
	var in SignalPipelineStageRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	kind := pipeline.SignalKind(strings.TrimSpace(in.Status))
	if !kind.IsKnown() {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_SIGNAL_STATUS",
			`status must be "done" or "fail"`, nil)
		return
	}

	runID := pipeline.RunID(chi.URLParam(r, "runId"))
	stageID := chi.URLParam(r, "stageId")
	if err := c.Svc.SignalStage(r.Context(), runID, stageID, kind, strings.TrimSpace(in.Reason)); err != nil {
		writePipelineSignalError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusAccepted, SignalPipelineStageResponse{Accepted: true})
}

// writePipelineSignalError maps the signal service's sentinels onto the wire
// contract, falling back to 500 for unexpected failures.
func writePipelineSignalError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, pipelinesvc.ErrRunNotFound):
		envelope.WriteAPIError(w, r, http.StatusNotFound, "not_found", "PIPELINE_RUN_NOT_FOUND", "Unknown pipeline run", nil)
	case errors.Is(err, pipelinesvc.ErrStageNotFound):
		envelope.WriteAPIError(w, r, http.StatusNotFound, "not_found", "PIPELINE_STAGE_NOT_FOUND", "Unknown pipeline stage", nil)
	case errors.Is(err, pipelinesvc.ErrStageNotRunning):
		envelope.WriteAPIError(w, r, http.StatusConflict, "conflict", "PIPELINE_STAGE_NOT_RUNNING", "Pipeline stage is not running", nil)
	case errors.Is(err, pipelinesvc.ErrUnknownSignalKind):
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_SIGNAL_STATUS", `status must be "done" or "fail"`, nil)
	default:
		envelope.WriteAPIError(w, r, http.StatusInternalServerError, "internal", "PIPELINE_SIGNAL_FAILED", "Recording the stage signal failed", nil)
	}
}

// notImplementedHandler answers the locked 501 envelope for one operation.
func notImplementedHandler(method, path string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		apispec.NotImplemented(w, r, method, path)
	}
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

func (c *PipelinesController) listDefinitions(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/pipelines")
		return
	}
	projectID, ok := requirePipelineProject(w, r)
	if !ok {
		return
	}
	defs, err := c.Svc.ListDefinitions(r.Context(), projectID)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}
	out := make([]PipelineDefinitionSummary, 0, len(defs))
	for _, d := range defs {
		out = append(out, definitionSummary(d))
	}
	envelope.WriteJSON(w, http.StatusOK, ListPipelineDefinitionsResponse{Definitions: out})
}

func (c *PipelinesController) createDefinition(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/pipelines")
		return
	}
	projectID, ok := requirePipelineProject(w, r)
	if !ok {
		return
	}
	var in SavePipelineDefinitionRequest
	if err := decodeJSONStrict(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	def, err := c.Svc.CreateDefinition(r.Context(), projectID, in.YAMLSource)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusCreated, PipelineDefinitionResponse{Definition: definitionSummary(def)})
}

func (c *PipelinesController) updateDefinition(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "PUT", "/api/v1/pipelines/{id}")
		return
	}
	var in SavePipelineDefinitionRequest
	if err := decodeJSONStrict(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	def, err := c.Svc.UpdateDefinition(r.Context(), pipeline.ID(chi.URLParam(r, "id")), in.YAMLSource)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, PipelineDefinitionResponse{Definition: definitionSummary(def)})
}

func (c *PipelinesController) deleteDefinition(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "DELETE", "/api/v1/pipelines/{id}")
		return
	}
	id := chi.URLParam(r, "id")
	if err := c.Svc.DeleteDefinition(r.Context(), pipeline.ID(id)); err != nil {
		writePipelineError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, DeletePipelineDefinitionResponse{ID: id, Deleted: true})
}

// validateDefinition dry-runs the YAML and returns the outcome as data: 200
// {valid, issues}. A validation failure is not a 4xx, because the editor wants
// the issue list as a result rather than an error envelope. Persists nothing.
func (c *PipelinesController) validateDefinition(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/pipelines/validate")
		return
	}
	projectID, ok := requirePipelineProject(w, r)
	if !ok {
		return
	}
	var in ValidatePipelineDefinitionRequest
	if err := decodeJSONStrict(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	valid, issues, err := c.Svc.ValidateDefinition(r.Context(), projectID, in.YAMLSource)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}
	out := make([]PipelineValidationIssue, 0, len(issues))
	for _, is := range issues {
		out = append(out, PipelineValidationIssue{Path: is.Path, Message: is.Message})
	}
	envelope.WriteJSON(w, http.StatusOK, ValidatePipelineDefinitionResponse{Valid: valid, Issues: out})
}

func (c *PipelinesController) schema(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/pipelines/schema")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(c.Svc.ConfigSchema())
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

func (c *PipelinesController) listRuns(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/pipelines/runs")
		return
	}
	projectID, ok := requirePipelineProject(w, r)
	if !ok {
		return
	}
	filter := pipeline.RunFilter{
		PipelineName: r.URL.Query().Get("pipeline"),
		Status:       r.URL.Query().Get("status"),
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_LIMIT", "limit must be a non-negative integer", nil)
			return
		}
		filter.Limit = n
	}
	runs, err := c.Svc.ListRuns(r.Context(), projectID, filter)
	if err != nil {
		writePipelineError(w, r, err)
		return
	}
	out := make([]PipelineRunSummary, 0, len(runs))
	for _, run := range runs {
		out = append(out, runSummary(run))
	}
	envelope.WriteJSON(w, http.StatusOK, ListPipelineRunsResponse{Runs: out})
}

func (c *PipelinesController) getRun(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/pipelines/runs/{runId}")
		return
	}
	run, err := c.Svc.GetRun(r.Context(), pipeline.RunID(chi.URLParam(r, "runId")))
	if err != nil {
		writePipelineError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, PipelineRunDetailResponse{Run: runDetail(run)})
}

// triggerRun starts a manual run. headSha in the body is ignored: v2 pins a run
// to its subject, not to a commit, and a manual PR subject arrives with the
// run API pass.
func (c *PipelinesController) triggerRun(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/pipelines/runs")
		return
	}
	projectID, ok := requirePipelineProject(w, r)
	if !ok {
		return
	}
	var in TriggerPipelineRunRequest
	if err := decodeJSONStrict(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	runID, err := c.Svc.TriggerRun(r.Context(), projectID, pipelinesvc.TriggerInput{
		Ref:       in.Pipeline,
		SessionID: in.SessionID,
	})
	if err != nil {
		writePipelineError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusCreated, TriggerPipelineRunResponse{RunID: string(runID)})
}

func (c *PipelinesController) cancelRun(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/pipelines/runs/{runId}/cancel")
		return
	}
	projectID, ok := requirePipelineProject(w, r)
	if !ok {
		return
	}
	run, err := c.Svc.CancelRun(r.Context(), projectID, pipeline.RunID(chi.URLParam(r, "runId")))
	if err != nil {
		writePipelineError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, PipelineRunDetailResponse{Run: runDetail(run)})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// requirePipelineProject reads the mandatory `project` query parameter, writing
// a 400 and returning ok=false when it is absent.
func requirePipelineProject(w http.ResponseWriter, r *http.Request) (domain.ProjectID, bool) {
	project := r.URL.Query().Get("project")
	if project == "" {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "PROJECT_REQUIRED", "project query parameter is required", nil)
		return "", false
	}
	return domain.ProjectID(project), true
}

// writePipelineError renders a service error. A *pipeline.ValidationError is
// unpacked into the envelope's details as the full issue list, so the editor
// surfaces every problem at once.
func writePipelineError(w http.ResponseWriter, r *http.Request, err error) {
	var verr *pipeline.ValidationError
	if errors.As(err, &verr) {
		issues := make([]map[string]string, 0, len(verr.Issues))
		for _, issue := range verr.Issues {
			issues = append(issues, map[string]string{"path": issue.Path, "message": issue.Message})
		}
		envelope.WriteAPIError(w, r, http.StatusUnprocessableEntity, "unprocessable", "PIPELINE_VALIDATION_FAILED",
			"pipeline definition is invalid", map[string]any{"issues": issues})
		return
	}
	envelope.WriteError(w, r, err)
}

func definitionSummary(d pipeline.Definition) PipelineDefinitionSummary {
	return PipelineDefinitionSummary{
		ID:         string(d.ID),
		ProjectID:  d.ProjectID,
		Name:       d.Name,
		YAMLSource: d.YAMLSource,
		CreatedAt:  d.CreatedAt,
		UpdatedAt:  d.UpdatedAt,
	}
}

// runSummary maps a v2 run onto the frozen wire shape. loopState carries the v2
// run status and stageStatuses the v2 stage outcomes; the fields keep their
// names until the DTO pass renames them along with the OpenAPI document.
func runSummary(run pipeline.RunState) PipelineRunSummary {
	outcomes := make(map[string]string, len(run.Stages))
	for id, st := range run.Stages {
		outcomes[id] = string(st.Outcome)
	}
	headSHA := ""
	if run.Subject.PR != nil {
		headSHA = run.Subject.PR.HeadSHA
	}
	return PipelineRunSummary{
		RunID:             string(run.RunID),
		PipelineID:        string(run.PipelineID),
		PipelineName:      run.PipelineName,
		SessionID:         run.Subject.SessionID,
		LoopState:         string(run.Status),
		TerminationReason: run.CancelReason,
		HeadSHA:           headSHA,
		StageCount:        len(run.Stages),
		StageStatuses:     outcomes,
		CreatedAt:         run.CreatedAt,
		UpdatedAt:         run.UpdatedAt,
	}
}

func runDetail(run pipeline.RunState) PipelineRunDetail {
	stages := make([]PipelineStageView, 0, len(run.Stages))
	for id, st := range run.Stages {
		view := PipelineStageView{
			StageName:    id,
			Status:       string(st.Outcome),
			Attempt:      st.Attempt,
			Verdict:      string(st.EnteredVia),
			ErrorMessage: st.Reason,
			Output:       st.OutputTail,
			SessionID:    st.SessionID,
			ArtifactIDs:  []string{},
		}
		if !st.StartedAt.IsZero() {
			started := st.StartedAt
			view.StartedAt = &started
		}
		if !st.SettledAt.IsZero() {
			settled := st.SettledAt
			view.CompletedAt = &settled
		}
		stages = append(stages, view)
	}
	sort.Slice(stages, func(i, j int) bool { return stages[i].StageName < stages[j].StageName })

	return PipelineRunDetail{
		PipelineRunSummary: runSummary(run),
		Stages:             stages,
		// The findings subsystem is deleted in v2; the field stays until the
		// DTO pass removes it from the OpenAPI document.
		Findings: []PipelineArtifact{},
	}
}
