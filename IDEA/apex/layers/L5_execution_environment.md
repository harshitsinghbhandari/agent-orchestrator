# Layer L5 — Execution Environment

## Status
⚠️ **PARTIALLY SPECIFIED**
- SPEC sections: Hybrid Local/Cloud Routing, Zero-Trust Sandbox Model, Tool Manifest categories.
- UNDERSPECIFIED sections: Container Orchestration (Docker vs K8s vs KVM), Network Sync for Cloud Repos (cloning strategy), "Meta-tool" composition logic.

## Purpose
The physical body of APEX. Provides isolated sandboxes (pods) for agent execution, offering high-fidelity tool access while maintaining security boundaries and ephemeral state.

## Inputs
- **Pod Spawn Request**: From L4 (agent type, task node, context subset).
- **Tool Invocations**: From the executing agent instance.

## Outputs
- **Tool Results**: stdout, stderr, file diffs, test artifacts.
- **Audit Log**: Immutable trace of every shell command and file edit.

## Internal Architecture

### 1. Hybrid Routing Logic
- **Local**: File reads, LSP queries, quick edits, git operations.
- **Cloud VM**: Ephemeral containers for parallel tasks, long-running builds, and UI browser tests.

### 2. Zero-Trust Sandbox (Pod)
- No persistent filesystem access (destroyed on node completion).
- Explicit permission required for file deletion.
- Network access limited to declared MCP endpoints and LLM APIs.

## Failure Modes
| Mode | Detection | Degradation | Recovery |
|---|---|---|---|
| **Sandbox Breakout** | Runtime audit alert | Security integrity compromised. | Immediate pod termination; invalidate developer session. |
| **Provisioning Latency** | Timeout (>60s) for VM | Execution delay / Task stall. | Re-route to local if task risk is low; alert observability. |
| **Tool Execution Error** | Non-zero exit code | Task node failure in DAG. | Structured error returned to Critic (L6) for diagnosis. |

## Resource Requirements
- **Compute**: 1-2 vCPUs and 2-4GB RAM per agent pod.
- **Disk**: 10GB ephemeral storage per clone.
- **Latency**: VM spin-up <30s target.

## Dependencies
- Container runtime (e.g., Docker/K8s).
- MCP (Model Context Protocol) server registry.

## Phase Mapping
- **Phase 1**: Local execution only (single pod).
- **Phase 3**: Full hybrid local/cloud VM pod fleet.

## Open Questions
- How are secrets injected into pod environment variables without persistent storage?
- Does each pod contain a full clone of the repository, or an incremental git worktree?
- How do we handle "Meta-tool" (composed primitive tools) registration in a stateless pod?
