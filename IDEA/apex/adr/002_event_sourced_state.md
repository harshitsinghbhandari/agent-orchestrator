# ADR-002: Event-Sourced State for Agent Orchestration

## Status
✅ **ACCEPTED**

## Context
Traditional agent systems lose state on failure. If the orchestrator or an agent crashes, the system must restart from scratch. This leads to:
- Wasted tokens (re-analysis).
- Inconsistent codebase states (half-written files).
- Poor auditability (hard to trace why an agent failed).

## Decision
APEX will use **Event Sourcing** as its primary state management model. Every action, tool call, and decision is emitted as an immutable event to a synchronized bus. The state of any task or agent can be reconstructed by replaying this log.
- **Persistence**: All events are appended to a persistent event bus history.
- **Audit Tracking**: Every event has a unique `trace_id` and `timestamp`.
- **System Recovery**: A crash recovery service reads the log to resume the DAG from the last successful node.

## Alternatives Considered
- **State Snapshots**: Periodic backups of the system memory (expensive, lacks granularity).
- **Direct Orchestration (Volatile)**: Fast but loses all context on failure.
- **Relational Storage**: Strong for data but weak for replaying a sequence of events.

## Consequences
- **Positive**: Full audit trails, point-in-time recovery, and replay-based debugging.
- **Negative**: Increased event bus throughput and storage requirements.
- **Neutral**: Requires every agent to be **idempotent** (can process the same event multiple times safely).

## Implementation Notes
- **Event Replay**: While specified, the logic for replaying events to a specific point-in-time is not yet designed.
- **Idempotency**: All tool actions must include an `idempotency_key` (SHA256 of source task + type + payload).
- **Storage**: The event history persists after task completion for **Observability (L8)**.
