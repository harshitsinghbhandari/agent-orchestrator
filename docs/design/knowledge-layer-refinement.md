# AO Knowledge Layer — Design Refinement

Date: 2026-05-10

Companion to `docs/design/knowledge-layer-understanding.md` (on branch `session/ao-138`).

This doc takes positions on the parts the original left open: the artifact shape, who writes it, the read path, decay, trust, and failure modes. It does not propose code yet. It is the substrate for an issue or PRD.

## Status

- Design discussion only
- No implementation, no PR, no branch beyond the original `session/ao-138` work
- Builds on the approved three-layer design (L1 / L2 / L3)
- Sharpens Phase 1 scope from "capture + replay" into a specific schema, write path, and read path

## What the original doc settled, and what it left open

Settled:

- Three-layer hierarchy (L1 session artifacts → L2 project knowledge → L3 global profile)
- The hook points: `session-manager.ts:kill()`, `lifecycle-manager.ts` terminal transitions, `prompt-builder.ts` injection
- Phase 1 should prove the full loop (capture → store → retrieve → prompt effect), not just archival

Left open:

1. What an artifact actually contains
2. Who writes it and when
3. How (and when) future agents read it
4. How stale knowledge is detected and removed
5. Whether `deferred[]` is a feature or a graveyard
6. Whether agents can trust what other agents wrote
7. How the schema evolves without breaking past artifacts

This doc takes a position on each.

## 1. What is an artifact?

Four candidate content types, with very different costs and value:

| Type | Description | Cost to capture | Value to future agents |
|------|-------------|-----------------|------------------------|
| A — Mechanical session record | id, agent, duration, outcome, PR, files touched | free (already in session metadata + git) | low — recoverable from git |
| B — Decision record | "tried X, switched to Y because Z", deviations, rejected paths | high — requires agent to author | high — but mostly for humans auditing |
| C — Side documents | scratch markdown, plans, ad-hoc analysis the agent produced | medium — exists if agent makes it | unclear — needs curation |
| D — Gotchas / negative knowledge | "this fails on Windows because…", "this test is flaky", "build silently breaks if NODE_ENV unset" | medium — agent has to recognize and articulate | **highest** — the entire value prop of cross-session memory |

**Ranking: D >> B > A. C is a v2 problem.**

Reasoning:

- The CLAUDE.md auto-memory rules already say *don't save what git can tell you*. Same principle applies — Type A is mostly bookkeeping.
- A future agent reading "PR #1234 merged, touched 3 files" learns nothing actionable. A future agent reading "the CI failure on Windows is because the path helper didn't strip the drive letter" learns exactly what would have cost it 30 minutes.
- Full transcripts (the naive "session output" reading) are useless as artifacts. No future agent reads 50k tokens of transcript. They'd need summarization — and a summary is just Type B written after the fact.
- Type C without a curation mechanism becomes a junk drawer. Defer.

## 2. Who writes it?

Three options:

1. **Agent self-authoring at end of session** — agent writes structured fields before exit. Highest quality, requires cooperation, may produce empty records when agents don't cooperate.
2. **Harness-authored from logs (post-hoc summary)** — extract heuristically from JSONL/transcript. Automatic. **Produces plausible nonsense.** An LLM summarizing its own transcript invents clean causality from messy reality. The decision to switch approaches gets retconned into "I correctly identified that X wouldn't work" when actually the agent flailed for 20 minutes and got lucky.
3. **Hybrid** — harness pre-fills mechanical fields, agent narrates the rest.

**Position: ship Option 1, opt-in via system prompt template, modeled on the existing `ao report` system (see §3).**

- Bake the request into the agent's system prompt: "Before exiting, fill in the artifact record. Be honest. An empty record is better than a fake one."
- Do not make it a hard lifecycle phase. Forcing it produces garbage to satisfy the constraint.
- Empty records are honest. Measure cooperation rate over time and optimize for it.

Option 2 is the trap. If we ever build it, it should be a fallback for crashed sessions, not the primary path.

Option 3 is the eventual end state, but starting there means shipping the hard part ("getting agents to write meaningfully") to "later" forever.

This author pattern is not new infrastructure — AO already has it. See §3.

## 3. Relation to the existing agent report system

A late but important observation: AO already has an agent self-authoring path that solves several of the problems raised in §2 and §4. The knowledge layer should leverage it, not replicate it.

### 3.1 What `ao report` provides

The `ao acknowledge` and `ao report <state>` commands (defined in `packages/cli/src/commands/report.ts` and `packages/core/src/agent-report.ts`) let agents declare workflow transitions from inside their session. Each call writes to an append-only audit trail per session, displayed by `ao status --reports`.

Each report contains:

- `timestamp`, `actor`, `source` (`acknowledge` | `report`)
- `reportState` — one of `started`, `working`, `waiting`, `needs_input`, `fixing_ci`, `addressing_reviews`, `pr_created`, `draft_pr_created`, `ready_for_review`, `completed`
- `note` — optional freeform string
- `prNumber`, `prUrl`, `prIsDraft` — optional PR metadata

The system prompt template already conditions agents to call these commands at workflow milestones. Cooperation is not theoretical — it is deployed.

### 3.2 What this collapses in the knowledge-layer design

Three open problems shrink:

1. **Author pattern (§2)** — already exists. `ao record-artifact` (or whatever it ends up being called) should mirror `ao report`: same session-id resolution via `AO_SESSION_ID`, same opt-in invocation via the system prompt, same append-only persistence model. Not a new pattern — an extension of a proven one.

2. **Clean-exit assumption (§4.1)** — partially mitigated. Reports happen *throughout* the session, not just at exit. Each `ao report working --note "..."` is a checkpoint with narrative content. If an agent crashes after five reports, you have five timestamped breadcrumbs. The Phase 1.5 mid-session capture mechanism in §8 overlaps heavily with what reports already do.

3. **Capture seam** — moves earlier. The natural moment to ask the agent to author an artifact is *when it calls a terminal-ish report state* (`completed`, `pr_created`, `ready_for_review`), not when `kill()` runs. The agent is still alive and cooperating. `kill()` becomes a fallback path for when the agent never reported.

### 3.3 What does not collapse

The differences matter and the systems should remain separate:

| Reports | Artifacts |
|---------|-----------|
| Workflow state (what phase) | Reusable knowledge (what was learned) |
| Read by humans via `ao status --reports` | Read by future agents via prompt injection |
| Per-session, lives with session metadata | Project-scoped, persists past session |
| Fixed enum of states | Free-form gotchas with structured scope |
| Feeds the lifecycle fallback matrix | Does not affect lifecycle |

Conflating them would pollute the lifecycle's fallback matrix (which is already careful — see the header comment in `agent-report.ts`) and would muddle the user-facing meaning of `ao report`.

### 3.4 Implication for the v1 schema

The `phase` field added in §8 maps cleanly onto report sources:

| Artifact `phase` | Source |
|------------------|--------|
| `final` | Authored at terminal report state (`completed` / `pr_created` / `ready_for_review`) |
| `checkpoint` | Authored at non-terminal report (mid-session, optional) |
| `extracted` | Post-mortem fallback when the agent never authored anything (rare, low-trust) |

This is not a schema change — it is recognition that the field already names the three capture seams that exist in the codebase.

## 4. Failure modes the original doc missed

### 4.1 The write path assumes clean exits

The original design says "agent writes record before exit." Reality:

- Sessions crash (OOM, timeout, API error)
- Sessions get `ao stop`'d mid-work
- Sessions hang and get garbage-collected
- The agent is in step 8 of a 15-step plan and hits a wall

Estimated rate of clean exits where the agent says "I'm done, let me compose my artifact": **20–30%.** The remaining 70–80% are interruptions, failures, or abandonments.

This is the worst possible inversion: **the sessions where gotchas actually live are the ones least likely to produce records.**

Mitigations, in increasing complexity:

1. **Leverage the report cadence** (free) — each `ao report` call is already a timestamped checkpoint with an optional `note`. Mid-session knowledge capture can ride on this rather than invent a new mechanism. See §3.
2. **Periodic checkpoint** — agent writes what it knows so far every N minutes. Cheap. May produce stale partial records.
3. **On-error capture** — lifecycle detects a failure state and asks the agent to dump what happened before teardown. Higher quality, requires the agent to still be responsive.
4. **Transcript-extraction fallback for crashes** — lower quality, but better than nothing for the truly dead. Use only as last resort to avoid the "plausible nonsense" failure of Option 2 above.

For Phase 1: capture at the agent's terminal report state (`ao report completed | pr_created | ready_for_review`); fall back to `kill()` only when the agent never reported. Instrument the silent-exit rate and revisit checkpointing if it is high.

### 4.2 The read path is completely undefined

The original doc designs the write side. The entire value of artifacts is in the read side. Unanswered:

- When does a future agent see artifacts? Session start? Mid-session when it opens a relevant file? On error?
- Which artifacts? All for the project? Last 10? Ones matching current file paths? High-gotcha-density ones?
- How much context budget? 10 artifacts × 500 tokens = 5k tokens injected before the agent even starts. Not free.
- What's the ranking signal? Recency? File overlap? Issue label match? Manual feedback from consuming agents?

Without answers, the write pipeline ships and nobody reads from it. §5 of this doc takes a position.

### 4.3 Signal decay is unaddressed

A gotcha from January about `foo.ts` is useless in May if `foo.ts` was rewritten. But the artifact still says it. A future agent reads "the test in `bar.test.ts` is flaky" — but that test was deleted in March.

Artifacts have a half-life. The original schema has no way to express it. Options:

- **TTL** — auto-expire after N days. Crude but honest. False positives (still-relevant gotcha dropped) and false negatives (stale gotcha lives until TTL).
- **Cross-reference with git** — if the file mentioned in the gotcha was touched since the artifact was written, flag as "potentially stale". Better signal, more code.
- **Consumer feedback** — let reading agents mark artifacts as wrong/obsolete. Requires a feedback loop you don't have yet.

For Phase 1: TTL (e.g. 30 days, configurable, displayed alongside the gotcha so the agent can judge). It's the only mechanism that works without a feedback loop.

### 4.4 The `deferred` field is a trap

Deferred items sound useful. In practice they become a TODO list nobody owns:

- "I didn't add error handling to the retry loop" — issue? comment? note for next agent?
- "The migration script needs to handle empty tables" — that's an issue, not an artifact field
- "Could optimize the query but ran out of budget" — actionable, but by the time someone reads it the context is gone

Position: **drop `deferred[]` from v1.** Either auto-promote to GitHub issues (with a `from-artifact` label) or don't store. Don't make it a permanent resident of the artifact schema.

If reintroduced later, it must come with a lifecycle: deferred items have an owner, an expiry, or get promoted to issues automatically.

### 4.5 Trust is unaddressed

Agent A writes a gotcha: "the build silently fails if `NODE_ENV` isn't set." Is that true? Did Agent A verify it, or did it encounter it once and assume?

If future agents treat artifacts as gospel, a confused or hallucinating agent poisons the knowledge store. If they treat artifacts as hints, the value drops.

Trust scoring options:

- Weight by session outcome (merged PR > abandoned > errored)
- Weight by agent identity if "known-good" agents exist
- Let consuming agents upvote/downvote ("this saved me" / "this was wrong")
- Start with no trust model and add one when there's enough data to measure accuracy

Position for Phase 1: **no explicit trust score, but include source signals in the artifact** (outcome, agent name, date). Let the consuming agent see them and judge. Add scoring later when you can measure.

### 4.6 The docs field (Type C) has no lifecycle

Agent writes scratch notes to `.ao/notes/session-123/`. Then what? They sit forever? Who cleans them up? Does a future agent read all notes from all past sessions?

Without curation, junk drawer. With curation, you're building a CMS.

Position: **Type C is a v2 problem.** Leave the pointer field out of v1 entirely. Don't even reserve space for it in the schema. Adding it later is cheap; supporting it half-built is expensive.

### 4.7 Schema versioning will hurt

`schemaVersion: 1` is optimistic. When you need to add fields (and you will), readers must:

- Handle multiple versions, OR
- Run migration scripts on existing artifacts, OR
- Adopt strict append-only semantics (never rename/remove fields, only add; readers ignore unknown fields)

Position: **append-only with permissive readers.** Boring but safe. Old readers ignore new fields. New readers handle missing fields gracefully. No migrations.

This means the v1 schema must be deliberately small — every field is permanent.

## 5. The read path

### 5.1 When does the agent read?

Three distinct read times:

1. **Session start (push, eager injection)** — orchestrator selects artifacts and inlines them in the system prompt. Cheap, predictable, easy to budget. Weakness: at start time, you don't yet know what files the agent will touch.
2. **On-demand (pull)** — agent has a tool: `ao knowledge query <files|topic>`. Higher precision because the query carries context. Requires agent cooperation.
3. **Mid-task triggers (push, reactive)** — when CI fails, when the agent edits a specific file, inject the relevant gotcha at that moment. Highest signal-to-noise, hardest to wire up.

**Phase 1: ship (1) only. Stub (2) for Phase 2. (3) is the right end state, premature now.**

### 5.2 How does selection work?

Selection signals, ranked by cost:

| Signal | Cost | Useful for |
|--------|------|------------|
| Recency | free | weak baseline only |
| Files touched in past sessions overlapping current file scope | cheap (already in session metadata) | gotchas about specific code |
| Issue labels / area match | cheap | subsystem-scoped gotchas |
| Agent-authored tags (`#windows`, `#flaky`, `#tmux`) | cheap, requires cooperation | cross-cutting gotchas |
| Title/prompt keyword overlap | medium | similar tasks |
| Embeddings | expensive, indirect | last resort |

The tag approach is the sleeper. It pushes selection intelligence to the agent at *write* time, when the agent actually understands what the gotcha is about, instead of trying to reconstruct relevance at read time. Tags are grep-able, no vector store, no semantic drift.

### 5.3 Gotchas are file-scoped, not session-scoped

This is the structural insight that changes the design.

A gotcha about `lifecycle-manager.ts` should fire **every time any agent opens that file**, regardless of which session originally wrote it. Same for symbols, env vars, tools.

That means each gotcha needs structured scope:

```json
{
  "text": "...",
  "scope": { "files": [], "symbols": [], "tags": [] },
  "writtenAt": "2026-05-10T12:00:00Z",
  "writtenBy": "session-abc",
  "outcome": "merged"
}
```

And it means **even Phase 1 needs a poor-man's L2: a single project-scoped gotchas index** aggregated from all artifacts. Not the full L2 of "derived knowledge with file-affinity clustering" — just an append/dedupe pipeline:

```
artifact written → extract gotchas[] → append to knowledge/gotchas.jsonl
```

Without that index, every read scans every artifact. With it, the prompt builder filters one small file.

### 5.4 Phase 1 read-path proposal

- **Mode**: push only, at session start
- **Source**: aggregated `~/.agent-orchestrator/{hash}-{projectId}/knowledge/gotchas.jsonl`
- **Selection**, in priority order:
  1. Gotchas tagged with any tag in the agent's prompt or issue labels
  2. Gotchas scoped to files mentioned in the prompt or recently touched
  3. Recency tiebreaker
- **Budget**: hard cap, 500 tokens. Truncate oldest first
- **Format**: bulleted list with date and source session id, so agents can judge staleness
- **Empty case**: section omitted entirely. Don't inject "no gotchas yet" — that's noise

This is mostly recency-based in practice for the first few weeks (because there will be too few gotchas for filtering to do anything), but the structure is forward-compatible.

## 6. Stripped-down v1 schema

An earlier draft proposed a three-section split (`session` / `record` / `docs`). After applying every position in §4, the v1 schema collapses to:

```json
{
  "schemaVersion": 1,
  "session": {
    "id": "session-abc",
    "agent": "claude-code",
    "outcome": "merged",
    "prUrl": "https://github.com/.../pull/1234",
    "issueId": "AO-138",
    "startedAt": "2026-05-10T10:00:00Z",
    "endedAt": "2026-05-10T11:30:00Z",
    "filesTouched": ["packages/core/src/foo.ts"]
  },
  "summary": "Fixed Windows CI path handling. Took 3 attempts — first two broke POSIX paths.",
  "gotchas": [
    {
      "text": "On Windows, the path helper must strip the drive letter before comparing — case-insensitive comparison alone misses C:\\ vs c:\\",
      "scope": { "files": ["packages/core/src/platform.ts"], "tags": ["windows"] }
    }
  ]
}
```

That's it. Three top-level fields: `session`, `summary`, `gotchas`. Everything else removed:

- No `decisions[]` — high-cost to author, low value to future agents (mostly useful for humans)
- No `deferred[]` — graveyard risk, promote to issues instead
- No `docs[]` — Type C deferred to v2

Why strip this hard:

- Forces the read path to be solved for a simple shape first
- Easy for agents to write — two free-form fields
- Easy to measure adoption — % of sessions with non-empty gotchas
- No schema complexity to maintain
- Fields can be added later (append-only)

## 7. Success metric

The original doc has no success metric. "Prove the loop" is not measurable.

Proposed metric: **percentage of consuming agents that report "this gotcha saved me time".**

Operationalize with a thumbs-up signal. After a session completes, if it consumed gotchas at the start, ask the agent (in the artifact-authoring prompt): "Did any of the injected gotchas save you time? Which?"

Aggregate across sessions:

- Adoption rate (sessions with non-empty `gotchas` written)
- Hit rate (sessions where injected gotchas were rated useful)
- Stale rate (gotchas marked as no longer accurate)

If after two weeks of dogfooding on one project the hit rate is near zero, the design is wrong, not the implementation. Pull the feature.

If the metric is not measurable, the system is faith-based and should not ship.

## 8. Mid-session capture (Phase 1.5)

Not in Phase 1, but called out so the schema doesn't paint into a corner.

Triggers, in order of preference:

- **Riding the report cadence** — when an agent calls `ao report <state> --note "..."` mid-session, the note can carry incremental gotchas. Free, already integrated, no new mechanism. See §3.
- **Periodic checkpoint** — every 15 minutes, agent writes current `summary` and any `gotchas` so far (overwrites prior checkpoint). Useful when reports are sparse.
- **On-error capture** — lifecycle observes an error/stuck transition and emits a request for the agent to dump what it knows before teardown.
- **Crash fallback** — transcript-extraction, last resort, marked clearly as low-trust in the artifact metadata.

Schema implication: artifacts need a `phase` field (`"checkpoint" | "final" | "extracted"`) so consumers know how much to trust them. Adding this in v1 is cheap and forward-compatible. Recommended. The mapping from `phase` to report sources is in §3.4.

Revised v1 schema with `phase` baked in:

```json
{
  "schemaVersion": 1,
  "phase": "final",
  "session": { "...": "..." },
  "summary": "...",
  "gotchas": [{ "...": "..." }]
}
```

## 9. Open questions still

These are not Phase 1 blockers but will become real before Phase 2:

1. **Should an agent see its own past gotchas, or only other agents'?** Probably exclude same-session, include same-agent-different-session.
2. **Per-agent scoping?** A gotcha that Codex hit may not apply to Claude Code. Probably let the gotcha text qualify ("on Codex…") rather than scoping by agent.
3. **Read on session resume?** If `getRestoreCommand` is invoked, do we re-inject? Probably yes, but token-budget aware.
4. **Contradictory gotchas?** Two artifacts assert opposite things about the same file. Surface both? Pick newer? Unknown — surfaces only at scale (~50 artifacts).
5. **Cross-project gotcha leakage?** L3 territory. Phase 1 must be project-scoped on disk.
6. **Atomic writes for the gotchas index** under concurrent session terminations. Solvable with the existing atomic-write helper, but must not be skipped.

## Bottom line

Position summary:

- Artifact = `{ schemaVersion, phase, session, summary, gotchas[] }`. Three meaningful fields. Everything else is metadata or deferred.
- Author = agent self-authoring, modeled on the existing `ao report` system (§3). Opt-in via system prompt template. Empty records accepted as honest.
- Capture seam = the agent's terminal `ao report` call (`completed` / `pr_created` / `ready_for_review`) prompts artifact authoring. `session-manager.ts:kill()` is fallback only.
- Read = push only at session start, from a project-scoped aggregated gotchas index, bounded at 500 tokens, filtered by tags + file scope + recency
- Decay = TTL (30d default) with date displayed alongside gotcha text
- Schema evolution = append-only, permissive readers
- Trust = no explicit score in v1; include source signals (outcome, agent, date, `phase`) and let the reader judge
- Success metric = consuming-agent thumbs-up on injected gotchas; if not measurable, do not ship
- Build artifacts as a sibling to the existing report system (same author pattern, different storage and intent), not a parallel infrastructure

The original design is approved and coherent. This refinement narrows it to a v1 small enough to ship, hard-edged enough to measure, and structured enough not to require migration when v2 grows the system.
