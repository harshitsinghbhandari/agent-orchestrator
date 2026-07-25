# Pipelines v2 (owner's rebuild)

## Intent, stated cleanly

Pipelines v1 exists on the `pipelines-upstream` branch, works, and has never shipped. It was built to someone else's spec, and the person now holding the release keys does not understand it well enough to own, maintain, or extend it. v2 is a redo of the existing `backend/internal/pipeline` package (not a parallel `pipeline2/`) that keeps the entire feature surface and the entire UI, and rebuilds the internals around the two things that actually hurt in v1: **stage-to-stage information transfer** and **spawned-session lifecycle**.

The mechanism is deliberately boring, and modeled on GitHub Actions. A trigger starts a whole pipeline run, never an individual stage. Every stage after the first is started by the previous stage settling, and a stage can route to a different stage on failure. Each run owns a folder under `~/.ao/pipelines/<project-id>/<run-id>/`. Agent stages write their work to `agent-outputs/<stage>.md`; the engine, and only the engine, verifies that file exists and then appends a **pointer line** to `Context.md` ("stage `review` finished, its output is at `agent-outputs/review.md`"). `Context.md` is pasted verbatim into the next agent's prompt. The agent-output files themselves are never pasted; a downstream agent reads them off disk if it wants the detail. Index in the prompt, detail on disk.

Identity is ambient: `AO_SESSION_ID`, `AO_PROJECT`, `AO_PR_NUMBER` and friends are injected wherever they can be resolved, with no declaration required. What the author controls per stage is the payload: what lands in the file the agent reads, what lands in the first prompt or system prompt, and where the agent spawns. A run does not require a session. Stages run in the local checkout by default, and in the originating session's worker space when the run came from a PR that has one.

Success is not fewer lines. Success is that the release owner can read the whole thing, predict what a pipeline will do before running it, and add a new trigger or action without touching the core.

## What it is / what it isn't

**In scope:**

- **Triggers**: PR (`created`, `updated`, `merge-ready`, `merged`) and session state (`idle`, `exited`, `blocked`). Triggers start a full run only.
- **Stage transitions**: driven by the previous stage settling. Failure can route to a different stage.
- **Run state**: `~/.ao/pipelines/<project-id>/<run-id>/Context.md` plus `~/.ao/pipelines/<project-id>/<run-id>/agent-outputs/<stage>.md`. Run id keys the folder, so concurrent runs of the same pipeline cannot collide.
- **Context.md**: written by the engine only, after it verifies the stage's output file exists. Pointer lines, not content. Pasted into the next agent's prompt.
- **Ambient env injection**: session id, project, PR repo and number, injected wherever resolvable without the author asking.
- **Author-controlled per-stage context**: the file contents an agent receives, its first prompt / system prompt, and its spawn location. Agent-only is acceptable for this build.
- **Execution location**: local checkout by default; the session's worker space when the run is PR-related and a session exists.
- **Sessionless runs**: the subject can be the project or a PR that isn't yours. No session required.
- **Session lifecycle control**: a per-agent setting for whether the spawned session is killed after its stage succeeds.
- **Concurrency control**: a toggle for whether concurrent runs on the same PR are allowed or capped at one, scoped to `pr.updated`.
- **All existing UI**: graph/canvas editor, Kanban run board, definitions page, run detail, settings modal. Nothing is cut.
- **Definitions**: stay wherever they currently live; if that turns out not to work, `~/.ao/pipelines/<project-id>/definitions`.

**Explicitly out of scope for this build:**

- Cron and scheduled triggers. Wanted, deliberately later.
- Push-to-branch triggers ("every update to `main`"). Wanted, deliberately later.
- A proper study of GitHub Actions' model, especially its failure handling. Recognized as high-value and consciously postponed rather than skipped.
- A new `pipeline2/` package. This is a redo in place.
- Cutting any part of the v1 UI to make the system smaller.

## Assumptions surfaced and confirmed

- **v1's problem is comprehension, not capability.** It functions. It is unownable by the person who has to ship it, because it is out of control to analyze, maintain, and extend, and because it encodes a spec its current owner did not write.
- **"Extendable" has a named shape**, not a vibe. The three extension axes are: more triggers, per-stage control over what the next stage receives, and control over where an agent spawns. The core should be a router between a trigger registry and an action registry.
- **Triggers only ever start whole runs.** No trigger targets a specific stage. This is the GitHub Actions model and it is chosen on purpose.
- **The information-transfer fix is an engine-written index, not richer payloads.** Pasting agent output into prompts is rejected; a verified pointer in `Context.md` is enough, and it keeps prompt size bounded regardless of output size.
- **Run id scopes all run state**, which makes concurrency safe by construction rather than by locking.
- **A large fraction of real pipelines will be Claude invoked repeatedly**, which is precisely why the engine owns the context file and agents do not.
- **Sessionless is a first-class case.** A pipeline watching someone else's PR, or running against the project generally, is normal and must work without a session anywhere in the picture.

## Alternatives considered and rejected

- **Dogfood v1 as-is instead of rebuilding.** Rejected: the pain is already concrete (stages don't transfer information usably, spawned sessions clobber the workspace with no way to kill them, no clear answer to what context a stage receives), and the owner will not ship a feature he does not understand.
- **Build v2 as a new `pipeline2/` package beside the old one.** Rejected: redo the existing package, whichever path turns out easier at the end.
- **Lean-by-subtraction.** Rejected outright. Earlier framing treated the rebuild as a cut-down (drop the canvas editor, the Kanban board, the visual authoring). The whole UI stays. Smallness was never the goal; comprehensibility was.
- **Declare every environment variable explicitly per stage.** Rejected: identity is injected ambiently wherever it can be resolved.
- **Paste agent output into the next stage's prompt.** Rejected: pointers only. The output file is read from disk by whoever needs it.
- **Let agents write `Context.md` themselves.** Rejected: engine only, and only after verifying the stage's output file exists.
- **A per-pipeline shared context file across runs.** Rejected: one per run.
- **Ship cron and push-to-branch in the same build.** Rejected as scope, not as ideas. Both are wanted; both come later.

## Small calls deferred

- `Context.md` format if markdown proves awkward. YAML, JSON, or plain text are all acceptable substitutes.
- What happens to a spawned session when its stage **fails**. Kill, keep alive for inspection, or retry. Genuinely undecided and depends on what the failure output turns out to look like.
- When concurrency is capped at one and a new push arrives mid-run: kill and restart, or ignore the push. It is a user setting either way; the default is unpicked.
- Exact environment variable names beyond the identity set.
- Whether definitions stay in their current store or move to `~/.ao/pipelines/<project-id>/definitions`.
- The GitHub Actions study, particularly how they model stage failure and recovery. Explicitly scheduled for later, not dropped.
