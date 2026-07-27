-- Pipeline definitions -------------------------------------------------------

-- name: CreatePipelineDefinition :exec
INSERT INTO pipeline_definitions (id, project_id, name, yaml_source, config_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: GetPipelineDefinition :one
SELECT id, project_id, name, yaml_source, config_json, created_at, updated_at
FROM pipeline_definitions WHERE id = ?;

-- name: GetPipelineDefinitionByName :one
SELECT id, project_id, name, yaml_source, config_json, created_at, updated_at
FROM pipeline_definitions WHERE project_id = ? AND name = ?;

-- name: ListPipelineDefinitions :many
SELECT id, project_id, name, yaml_source, config_json, created_at, updated_at
FROM pipeline_definitions WHERE project_id = ? ORDER BY name ASC;

-- name: UpdatePipelineDefinition :execrows
UPDATE pipeline_definitions
SET name = ?, yaml_source = ?, config_json = ?, updated_at = ?
WHERE id = ?;

-- name: DeletePipelineDefinition :execrows
DELETE FROM pipeline_definitions WHERE id = ?;

-- Pipeline runs --------------------------------------------------------------

-- name: UpsertPipelineRun :exec
INSERT INTO pipeline_runs (
    id, project_id, pipeline_id, pipeline_name, subject_kind, session_id,
    pr_number, pr_repo, pr_url, head_sha, pr_head_branch, pr_base_branch,
    from_fork, status, run_dir, definition_json, cancel_reason,
    created_at, updated_at, settled_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
    pipeline_name = excluded.pipeline_name,
    subject_kind = excluded.subject_kind,
    session_id = excluded.session_id,
    pr_number = excluded.pr_number,
    pr_repo = excluded.pr_repo,
    pr_url = excluded.pr_url,
    head_sha = excluded.head_sha,
    pr_head_branch = excluded.pr_head_branch,
    pr_base_branch = excluded.pr_base_branch,
    from_fork = excluded.from_fork,
    status = excluded.status,
    run_dir = excluded.run_dir,
    definition_json = excluded.definition_json,
    cancel_reason = excluded.cancel_reason,
    updated_at = excluded.updated_at,
    settled_at = excluded.settled_at;

-- name: GetPipelineRun :one
SELECT * FROM pipeline_runs WHERE id = ?;

-- name: ListPipelineRuns :many
SELECT * FROM pipeline_runs
WHERE project_id = ?
  AND (sqlc.narg('pipeline_name') IS NULL OR pipeline_name = sqlc.narg('pipeline_name'))
  AND (sqlc.narg('status') IS NULL OR status = sqlc.narg('status'))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('lim');

-- name: ListUnsettledPipelineRuns :many
-- Hydration on engine start: the runs that still owe work, oldest first so the
-- engine replays them in creation order.
SELECT * FROM pipeline_runs
WHERE project_id = ? AND settled_at IS NULL
ORDER BY created_at ASC, id ASC;

-- Pipeline stage runs --------------------------------------------------------

-- name: UpsertPipelineStageRun :exec
INSERT INTO pipeline_stage_runs (
    run_id, project_id, stage_id, outcome, attempt, entered_via, prev_stage,
    failed_stage, failed_outcome, session_id, workspace_kind, workspace_path,
    deadline_at, started_at, settled_at, reason, output_tail, nudged, pgid
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (run_id, stage_id) DO UPDATE SET
    outcome = excluded.outcome,
    attempt = excluded.attempt,
    entered_via = excluded.entered_via,
    prev_stage = excluded.prev_stage,
    failed_stage = excluded.failed_stage,
    failed_outcome = excluded.failed_outcome,
    session_id = excluded.session_id,
    workspace_kind = excluded.workspace_kind,
    workspace_path = excluded.workspace_path,
    deadline_at = excluded.deadline_at,
    started_at = excluded.started_at,
    settled_at = excluded.settled_at,
    reason = excluded.reason,
    output_tail = excluded.output_tail,
    nudged = excluded.nudged,
    pgid = excluded.pgid;

-- name: ListPipelineStageRunsByRun :many
SELECT * FROM pipeline_stage_runs WHERE run_id = ? ORDER BY stage_id ASC;

-- Pipeline stage signals -----------------------------------------------------

-- name: InsertPipelineStageSignal :exec
INSERT INTO pipeline_stage_signals (run_id, stage_id, kind, reason, created_at)
VALUES (?, ?, ?, ?, ?);

-- name: GetLatestPipelineStageSignal :one
-- Latest-wins: a stage signalled twice (once after a nudge) settles on the
-- newest signal, with the earlier one kept for the record.
SELECT run_id, stage_id, kind, reason, created_at
FROM pipeline_stage_signals
WHERE run_id = ? AND stage_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- Pipeline credentials -------------------------------------------------------

-- name: UpsertPipelineCredential :exec
INSERT INTO pipeline_credentials (project_id, name, env_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (project_id, name) DO UPDATE SET
    env_json = excluded.env_json,
    updated_at = excluded.updated_at;

-- name: GetPipelineCredential :one
SELECT env_json FROM pipeline_credentials WHERE project_id = ? AND name = ?;

-- name: ListPipelineCredentialNames :many
-- Names only. A credential value never leaves the daemon through a read path a
-- human can reach (decision D13).
SELECT name FROM pipeline_credentials WHERE project_id = ? ORDER BY name ASC;

-- name: DeletePipelineCredential :execrows
DELETE FROM pipeline_credentials WHERE project_id = ? AND name = ?;
