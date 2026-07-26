package pipeline

import "time"

// Definition is a persisted pipeline definition. It carries BOTH the raw YAML
// as authored (YAMLSource) and the parsed config snapshot (Config): humans and
// agents edit YAML, while runs snapshot the normalized form. The envelope
// fields (ID, timestamps) are assigned by the store on create.
//
// Config is a placeholder `any` until the v2 Pipeline type lands; the store
// round-trips it through JSON either way.
type Definition struct {
	ID         ID        `json:"id"`
	ProjectID  string    `json:"projectId"`
	Name       string    `json:"name"`
	YAMLSource string    `json:"yamlSource"`
	Config     any       `json:"config"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// RunFilter narrows a ListPipelineRuns query. A zero value lists every run for
// the project, newest first. PipelineName and Status are AND-combined when set;
// Limit <= 0 means no limit.
type RunFilter struct {
	PipelineName string
	Status       string
	Limit        int
}
