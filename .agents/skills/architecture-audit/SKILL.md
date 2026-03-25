---
name: architecture-audit
description: Comprehensive architecture audit that combines ruthless analysis with solution-focused improvement planning. Reads architecture Markdown files, produces a brutal audit report with file/component scores, and generates a prioritized improvements roadmap.
---

## Overview

This skill provides two-phase architecture review:

1. **Audit Phase** (Sukuna mindset): Cold, systematic dissection of architecture consistency, feasibility, and quality. Identifies fatal flaws with surgical precision.
2. **Improvements Phase** (Gojo mindset): Elegant, comprehensive improvement roadmap organized by priority and impact. Offers perceptive solutions.

Both outputs are produced in a single run, enabling teams to understand what's broken and how to fix it systematically.

## Activation Rules

**Explicit triggers only.** This skill activates ONLY when the user explicitly mentions:
- "audit architecture"
- "architecture audit"
- "brutal audit"
- "Sukuna audit" 
- Similar explicit phrases requesting an architecture review

**Required input:** User must provide or reference architecture-related Markdown files (e.g., `architecture.md`, `design.md`, `layers.md`, `README-architecture.md`, or paste content directly). If no files are provided, respond normally and politely request: "Please provide the architecture Markdown files you'd like audited."

**File format:** All audited content is in Markdown (text descriptions, tables, Mermaid/PlantUML diagrams, decision records, etc.). Do NOT attempt to audit raw source code—this skill is for architecture documentation.

## Phase 1: Audit Report (`audit.md`)

### Mindset: Ruthless, Direct, Factual

The audit phase adopts a no-nonsense, penetrating analytical approach:
- Direct language: Identify exactly what is wrong and why it matters.
- Systematic: Analyze consistency within files, across files, against architectural principles.
- Evidence-based: Every claim is backed by specific references to provided content.
- No sugar-coating: Call out weaknesses plainly, but always with actionable reasoning.

### Output Structure

Generate `audit.md` with this exact structure:

```markdown
# Architecture Audit Report

## Executive Summary
- **Overall Score**: X/1000
- **Feasibility Verdict**: [Feasible / Partially Feasible / Not Feasible]
- **Primary Strengths**: ...
- **Critical Weaknesses**: ...

## File/Component Scores
| File/Path | Score /100 | Assessment |
|-----------|------------|------------|
| [file] | [score] | [one-line verdict] |

## Detailed Findings

### Consistency Analysis
[Findings on consistency within and across files]

### Feasibility & Scalability Assessment
[Analysis of whether the architecture can support stated goals/scale]

### Architectural Quality
[Assessment of modularity, separation of concerns, adherence to principles]

### Maintainability & Evolution
[How easy is it to understand, modify, extend?]

### Identified Risks
[Technical debt, single points of failure, etc.]

## Final Verdict
[Summary of overall health and whether major rework is needed]
```

### Scoring Methodology

**Per-file scores (/100):**
- 90–100: Excellent execution, minimal gaps, production-ready
- 70–89: Solid foundation with exploitable weaknesses
- 50–69: Functional but mediocre; multiple issues present
- <50: Dangerous; actively harmful or incoherent

**Overall score (/1000):**
- Weighted average of file scores, with severe penalties for cross-file inconsistencies (-100 to -400) and systemic architectural failures
- Rarely exceeds 700–800 unless architecture is near-excellent
- Calculation: (Sum of weighted file scores) - (Penalties for systemic issues)

**Evaluation criteria:**
- Consistency across files (files align with each other, no contradictions)
- Modularity and separation of concerns
- Adherence to declared architectural patterns (layered, hexagonal, microservices, etc.)
- Feasibility for stated scale and goals
- Performance and scalability awareness
- Error handling and failure mode design
- Testability and evolution-friendliness
- Security considerations (if relevant)

### Standards for Analysis

- **Reference everything**: Use specific section names, line references, or quotes from provided files to ground every claim.
- **Handle incomplete information gracefully**: If files lack detail, explicitly note: "X cannot be fully assessed—insufficient specification in [file]."
- **Balance rigor with usefulness**: Always explain the *impact* of an issue (e.g., "This will fail under load because…" or "This violates single-responsibility principle, making changes risky").
- **Do not hallucinate**: Only discuss what is actually present in the provided files.

## Phase 2: Improvements Roadmap (`improvements.md`)

### Mindset: Perceptive, Solution-Focused, Comprehensive

The improvements phase adopts a calm, methodical, strategic mindset:
- Clarity of vision: See the entire problem landscape and prioritize precisely.
- Elegance: Offer refined, well-reasoned solutions.
- Comprehensiveness: Address not just critical issues but also medium-term and aspirational improvements.
- Actionability: Provide clear direction for implementation.

### Output Structure

Generate `improvements.md` with this exact structure:

```markdown
# Architecture Improvements Roadmap

## Critical Issues
[Issues that must be fixed before or during implementation; they block success or introduce unacceptable risk]

### Issue: [Name]
- **Location**: [File/section reference]
- **Problem**: [Clear description]
- **Impact**: [Why this matters]
- **Suggested Approach**: [Solution outline, pseudocode if helpful]

## Medium Priority Issues
[Issues that should be addressed soon; they degrade quality, maintainability, or scalability]

### Issue: [Name]
- **Location**: [File/section reference]
- **Problem**: [Clear description]
- **Impact**: [Why this matters]
- **Suggested Approach**: [Solution outline]

## Nice-to-Have Enhancements
[Optimizations, future-proofing, or quality-of-life improvements; not blocking but valuable]

### Enhancement: [Name]
- **Location**: [File/section reference]
- **Description**: [What could be improved]
- **Benefit**: [Why it's worth doing]
- **Suggested Approach**: [Solution outline]
```

### Standards for Improvements

- **Prioritization is precise**: Critical issues are those that, if unresolved, cause failure or severe degradation. Medium issues weaken quality or evolution. Nice-to-have issues polish and future-proof.
- **Solutions are reasoned**: Each suggestion explains why it works and what constraint it respects (e.g., "This refactoring maintains API compatibility while reducing coupling").
- **No code generation yet**: Improvements are structural/strategic proposals, not full implementations.
- **Bridge to action**: Each improvement should be scoped such that a developer can understand the next step.

## Workflow

1. **User triggers**: User provides architecture files and says something like "audit architecture" or "perform an architecture audit".
2. **Agent reads files**: Parse all provided Markdown content.
3. **Sukuna phase**: Produce `audit.md` with ruthless, systematic analysis.
4. **Gojo phase**: Produce `improvements.md` with solution-focused roadmap.
5. **Deliver both**: Present both files to the user, ideally written to disk so they can save and iterate.

## Quality Assurance

- Do not invoke this skill unless explicitly triggered.
- Do not mention JJK, anime references, or flavor text in the generated files—keep them professional.
- Do not auto-fix or generate code—this is planning and analysis only.
- Do not skip sections of the output structure, even if findings are minor.
- If files are insufficient to assess a category, explicitly state: "Cannot assess [category]—insufficient detail in provided files."

## Example Trigger Phrases

- "Audit this architecture"
- "Run an architecture audit on these files"
- "Give me a brutal architecture review"
- "Perform an architecture audit: [list of files]"
