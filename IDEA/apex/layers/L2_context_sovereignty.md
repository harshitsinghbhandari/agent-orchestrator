# Layer L2 — Context Sovereignty

## Status
⚠️ **PARTIALLY SPECIFIED**
- SPEC sections: 5-layer context stack (C1-C5), Context Assembly Order, Brain Namespace Structure, TTL Policies.
- UNDERSPECIFIED sections: Context Compression Strategy (learned vs heuristic), Brain Write Conflict Resolution, "M-Query" definition.

## Purpose
Continuous assembly andintelligent reduction of the information relevant to a specific task. Manages the "APEX Brain" for cross-session persistent knowledge.

## Inputs
- **Perception Update**: From L1 (new symbols, graph deltas).
- **Decision Event**: From L3/L4 (choices made by architect/generator).
- **Failure Report**: From L6 (diagnosis results).

## Outputs
- **Compressed Context (C1-C5)**: Assembled payload for L0 inference calls.
- **Brain Lookup**: Namespace data for planning/diagnosis lookups.

## Internal Architecture

### 5-Layer Context Assembly
| Tier | Name | Priority | TTL | Source |
|---|---|---|---|---|
| **C5** | Task Context | 1 | Per-Task | Current request, active errors, diffs. |
| **C4** | Action Context | 2 | 30m | Rolling window of last 50 dev actions. |
| **C3** | Semantic Context | 3 | Per-LLM call | RAG retrieval from embeddings / graph. |
| **C2** | Session Memory | 4 | Project Life | Decision logs, failed attempts, architecture. |
| **C1** | Identity Context | 5 | Permanent | Tech stack rules, code conventions. |

### The APEX Brain
- `/decisions/`: Architectural choices + rationales.
- `/failures/`: Diagnosis results to prevent recurrence.
- `/patterns/`: Identifed idiomatic code structures.
- `/dependencies/`: Library quirks and version incompatibilities.
- `/preferences/`: Developer workflow settings.

## Failure Modes
| Mode | Detection | Degradation | Recovery |
|---|---|---|---|
| **Storage Corruption** | Checksum failure on query | Loss of cross-session memory. | Restore from git-backed snapshot or re-index codebase. |
| **Context Overflow** | Context length > Model Limit | LLM rejection or truncation. | Apply emergency compression (progressive truncation of C3/C4). |
| **Stale Context** | TTL audit check | Agents reasoning on old error state. | Flush C5/C4 and force refresh from L1. |

## Resource Requirements
- **Storage**: SSD for Brain indexing (2-10GB typical).
- **RAM**: Memory cache for active assembly window.
- **LLM Calls**: 1 compression/summarization call per N inference calls (Phase 3).

## Dependencies
- Indexed storage (e.g., Redis or local vector DB).
- Embedding model (from L0).

## Phase Mapping
- **Phase 2**: C1, C3, and C5 layers; basic Brain namespaces.
- **Phase 3**: Full 5-tier assembly with summarization model and C4 action stream.

## Open Questions
- What is the specific algorithm for "weighted assembly" when context exceeds the window?
- Is the Brain storage format human-readable (Markdown) or internal (Protobuf/JSON)?
- How does "M-Query" resolve cross-namespace dependencies?
