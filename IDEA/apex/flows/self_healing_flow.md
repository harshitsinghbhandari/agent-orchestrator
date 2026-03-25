# Flow — Self-Healing (Failure Recovery)

## Status
✅ **SPEC**

## Purpose
This flow describes the core APEX "immune system" response when a **Critic Agent (L6)** rejects a code artifact. Instead of a simple retry, the **Self-Healing Agent (L6)** performs a structured diagnosis to adapt the generation strategy and prevent failure loops.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant L4O as L4: Orchestration
    participant L5E as L5: Execution (Pods)
    participant L6Q as L6: Quality (Tiers)
    participant L2B as L2: Brain (Failures)
    participant User as User (Human Gate)

    Note over L5E: Generator produces buggy code
    L5E->>L4O: Emit TASK_COMPLETED (Diff Payload)
    
    L4O->>L6Q: Trigger Quality Tier 2 (Semantic)
    activate L6Q
    L6Q-->>L6Q: Logic validation fail
    L6Q->>L4O: Emit CRITIC_VERDICT (FAIL @ T2)
    deactivate L6Q
    
    Note over L4O: Failure detected; route to Self-Heal
    L4O->>L6Q: Activate Self-Healing Agent (L6.2)
    L6Q->>L4O: Emit SELF_HEAL_INITIATED
    
    L6Q->>L2B: Query failures/ namespace (Pattern Match)
    L2B-->>L6Q: No match found
    
    Note over L6Q: Deep Inference Root Cause Analysis
    L6Q-->>L6Q: Diagnose: Missing edge case in prompt
    L6Q->>L2B: Emit BRAIN_WRITE (New failure pattern)
    L6Q->>L4O: Emit DIAGNOSIS_READY (Strategy: Add constraint)
    
    L4O->>L5E: Re-assign DAG Node with Strategy adaptation
    L5E->>L4O: Emit TASK_STARTED (Retry #1)
    
    Note over L5E: Generator produces corrected code
    L5E->>L4O: Emit TASK_COMPLETED (Corrected)
    
    L4O->>L6Q: Re-run 5-Tier Critic Pipeline
    L6Q->>L4O: Emit CRITIC_VERDICT (T1-T5 PASS)
    
    Note over L4O: If failure counter > 3:
    L4O->>User: Human Gate Triggered (Manual Intervention)
```

## Failure Recovery Protocol

### 1. Detection & Initiation
When a quality tier emits `CRITIC_VERDICT (FAIL)`, the **Orchestrator (L4)** increments the retry counter for that specific DAG node. If the counter is within the **Retry Budget (3)**, it triggers the **Self-Healing Agent (L6)**.

### 2. Diagnosis (The 4-Step Protocol)
1. **Pattern Matching**: The agent queries the `failures/` namespace in the **APEX Brain (L2)** for similar failure signatures. If a prior fix exists, it is prioritized.
2. **Root Cause Analysis (RCA)**: Using the **Deep model tier (L0)**, the agent traces the failure back through the node context, prompt, and tool outputs. It identifies whether the cause was "Plan Decision", "Model Generation", or "Context Signal Loss".
3. **Strategy Adaptation**: Based on RCA, the agent selects an adaptation:
    - **Rewrite Prompt**: Inject explicit constraints to avoid the detected error.
    - **Expand Context**: Fetch missing symbols from **LSP (L1)** or **Brain (L2)**.
    - **Decomposition**: Sub-divide the failing node into smaller, lower-risk tasks.
4. **Memory Update**: The failure and its diagnosis are written back to the **APEX Brain** via `BRAIN_WRITE` to prevent future repetition across the entire project.

### 3. Re-Execution
The **Orchestrator** re-dispatches the task to the **Generator Agent** with the updated strategy. The cycle repeats until the **Critic Pipeline** passes or the budget is exhausted.

## Recovery Constraints & Budgets
| Constraint | Limit | Action on Breach |
|---|---|---|
| **Max Retry per Tier** | 2 | Escalate to **Self-Healing RCA**. |
| **Max Retry per Node** | 3 | Trigger `HUMAN_GATE_TRIGGERED`. |
| **Cost Cap per Cycle** | $2.00 | Pause node, notify **Observability (L8)**. |
| **Recovery Latency** | ≤ 2 min | Flag as "High Latency Failure" in **Brain**. |

## Human Escalation Gates
If the **Self-Healing Agent** cannot resolve the issue within the budget, it triggers a `HUMAN_GATE_TRIGGERED` event with a **Diagnostic Artifact**:
- **Why it failed**: The RCA report.
- **What was tried**: List of failed adaptations.
- **Human Choice**: 
    1. **Skip Critic**: Manually approve the current diff (high risk).
    2. **Refine Intent**: Change the original task request.
    3. **Manual Fix**: Developer provides the fix; agent learns from it.
