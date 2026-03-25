# ADR-005: Constitutional Reasoning at the Inference Layer

## Status
⚠️ **PROPOSED**

## Context
Standard agent systems rely on post-hoc output filtering. If a model generates a hallucinated API call, a separate checker must detect it and reject the output. This is:
- **Reactive**: The model's generation process is complete before the filter runs.
- **Expensive**: Requires an additional LLM call for every output.
- **Inconsistent**: Models can "fight" the filter, leading to infinite retry loops.

## Decision
APEX will move toward **Constitutional Reasoning** at the inference layer. Reasoning constraints ("The Constitution") are combined with the task prompt to shift the model's token probability distribution during generation.
- **Pre-Call Constraints**: Specific reasoning rules are injected into the context (e.g., "If uncertain about X, don't guess—search").
- **Output Validation**: Structured schemas (JSON-mode) and uncertainty flags are extracted during inference.
- **Self-Healing Integration**: If a constraint is violated, the **Self-Healing Agent (L6.2)** adapts the prompt with stricter constitutional rules.

## Contradiction & Resolution
- **Contradiction**: The original `APEX.md` (Appendix E) claimed this was achieved via "model-level integration" (shifting probability distributions). However, Layer 0's implementation describes "Prompt Wrapping" and "Output Validation."
- **Resolution**: In v1.0, APEX will use **System Prompt Constraints** and **Schema Enforcement** as the primary "Constituent" mechanisms. True model-level probability shifting (Logit Bias or custom inference engines) is **DEFERRED** to Phase 3.

## Alternatives Considered
- **Post-Hoc Filters**: Simple but reactive and expensive.
- **Fine-Tuned Models**: Highly effective but not model-agnostic.
- **Manual Oversight**: Too slow for autonomous agent scaling.

## Consequences
- **Positive**: Fewer violations, faster detection, and "correct-by-design" generation.
- **Negative**: Increases the prompt token count and requires careful constitutional authorship.
- **Neutral**: Requires clear definitions for "Reasoning Constraints" in **Layer 0 (L0)**.

## Implementation Notes
- **Constitutional Manifest**: A set of project-scoped rules stored in `APEX.md` (`/security/`, `/conventions/`).
- **Uncertainty Flags**: Models are prompted to emit specific markers (e.g., `<uncertain>`) for L3 confidence scoring.
- **Schema Enforcement**: All tool outputs and agent responses must follow strict JSON schemas.
