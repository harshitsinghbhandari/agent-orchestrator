# APEX Non-Goals (v1.0)

To ensure the feasibility and successful implementation of the core APEX architecture, the following capabilities are explicitly excluded from the v1.0 specification. Any feature inclusion must be weighed against these constraints.

---

## 1. Multi-User/Multi-Session Collaboration
APEX v1.0 assumes a single developer working on a single task session. Concurrent multi-user edits to the same DAG or shared APEX Brain state are non-goals. Real-time collaborative features are deferred to v2.0+.

## 2. Non-Code Artifact Generation
APEX is a code-first engineering agent. Generating non-code infrastructure (e.g., Terraform, CloudFormation, Kubernetes manifests, complex CI/CD pipelines) is a non-goal for v1.0. The system focuses on source code files and their associated tests.

## 3. Multi-Repository Coordination
All operations in v1.0 are scoped to a single root repository. Cross-repo dependency management, multi-repo refactoring, and distributed repository state synchronization are non-goals.

## 4. Offline Operation
APEX depends significantly on cloud-hosted LLM APIs, cloud-based ephemeral VMs, and telemetry services. Fully offline (air-gapped) operation is not supported in the v1.0 specification.

## 5. Model Fine-Tuning
The system is designed to consume off-the-shelf, frontier-class models (e.g., Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro). Custom model training, fine-tuning, or architectural model-level optimization is a non-goal.

## 6. Full Semantic Code Merge
While the architecture aspires to "semantic merge," v1.0 will enforce file-level isolation for parallel agent pods. Two agents cannot simultaneously modify the same file; the Orchestrator will serialize such tasks or escalate them to a single agent.

## 7. Passive Intent Inference
The Perception Engine (Layer 1) describes "real-time action streaming" for intent inference. In v1.0, APEX will only act on explicit, human-authored task requests. Passive inference from developer behavior (e.g., "the agent saw me edit X, so it starts doing Y") is a non-goal for v1.0.

## 8. Autonomous Production Deployment
APEX will generate code, run tests, and provide a PR description. It will **not** autonomously merge code into production branches, trigger CI/CD deployments, or monitor production availability. The final merge decision remains with a human developer.

## 9. Cross-Language Transpilation
Converting codebases between languages (e.g., "rewrite this Java service in Go") is a non-goal. APEX operates within the established language(s) of the provided repository.

## 10. Self-Modification
APEX generates code for external projects. It does not possess the tools or the constitutional reasoning to modify its own core orchestration code, layer logic, or agent fleet definitions.
