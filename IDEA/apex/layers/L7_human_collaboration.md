# Layer L7 — Human Collaboration

## Status
⚠️ **PARTIALLY SPECIFIED**
- SPEC sections: 4 Gate Types (Plan, Diff, Security, PR), Auto-Skip Thresholds (Confidence/Risk), Review Gate Statuses (APPROVED, REJECTED, COMMENTED).
- UNDERSPECIFIED sections: **Gate Timeout Behavior** (Idling vs Cancellation), Notification Channels (Slack/Email/Webhooks), "Trust Mode" scope and revocation.

## Purpose
The interface between autonomous operation and human oversight. Confidence-gated checkpoints ensure risky architectural changes or ambiguous requests are validated by the developer.

## Inputs
- **Plan Artifact**: From L3 (Large/XL tasks).
- **Diff/Evidence**: From L6 (completed artifacts).
- **Confidence Score**: From any Agent Instance.

## Outputs
- **Gate Result**: `REVIEW_APPROVED` or `REVIEW_REJECTED`.
- **Feedback Event**: Human comments re-routed to L3/L4 for re-planning/re-generation.

## Internal Architecture

### 1. Human Collaboration Gates
| Gate | Trigger Condition | Success Criteria |
|---|---|---|
| **G1: Plan Approval** | Task = Large/XL OR Risk > 0.5. | Human approves the DAG structure. |
| **G2: Diff Review** | Significant change or low confidence. | Human approves the code artifact diff. |
| **G3: Security Gate** | Tier 4 FAIL or HIGH-risk path. | Human approves security mitigation. |
| **G4: PR Review** | End of Task completion. | Human approves final commit + PR description. |

### 2. Auto-Skip Conditions
- Task Confidence > 95% AND Risk Score < 0.2.
- Developer has enabled "Trust Mode" for this file scope.
- Small/Medium task with no schema or API contract changes.

## Failure Modes
| Mode | Detection | Degradation | Recovery |
|---|---|---|---|
| **Human Delay (Stall)** | Timeout policy exceeded | Task blocks downstream nodes. | Async notification (multiple channels); Optional auto-cancel. |
| **Conflicting Feedback** | Multiple rejection loops | Re-generation loop (tokens). | Escalate to "Voice/Chat Discovery" or trigger voice call (Phase 3+). |
| **Gate Bypass** | Unauthorized gate status | Risk of unreviewed code merge. | Mandatory Git commit hooks for Gate proofs. |

## Resource Requirements
- **Human Attention**: Intermittent, depending on task complexity.
- **External Services**: Webhooks or Notification APIs.

## Dependencies
- L3 (for plan artifacts).
- L6 (for quality evidence).

## Phase Mapping
- **Phase 1**: Sequential diff approval (G4 only).
- **Phase 3**: Full multi-gate collaboration system.

## Open Questions
- How are inline comments on Mermaid diagrams mapped back to DAG nodes?
- Can "Trust Mode" be scoped to specific directories (e.g., tests/ vs src/)?
- What is the persistence model for Human Review history?
