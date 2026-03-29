---
name: code-quality-audit
description: Comprehensive code quality audit that combines ruthless analysis with a solution-focused refactoring roadmap. Reads source code files, produces a brutal audit report with per-file quality scores, and generates prioritized refactoring improvements.
---

## Overview

This skill provides two-phase code quality review:

1. **Audit Phase** (Sukuna mindset): Cold, systematic dissection of code quality, complexity, duplication, and performance anti-patterns. Identifies fatal flaws with surgical precision.
2. **Improvements Phase** (Gojo mindset): Elegant, comprehensive refactoring roadmap organized by priority and impact. Offers perceptive solutions.

Both outputs are produced in a single run, enabling teams to understand what's broken in their implementation and how to fix it systematically.

## Activation Rules

**Explicit triggers only.** This skill activates ONLY when the user explicitly mentions:
- "audit code"
- "code quality audit"
- "brutal code review"
- "Sukuna code review" 
- Similar explicit phrases requesting a code quality review.

**Required input:** User must provide or reference source code files (e.g., Python, JS, Go, etc.) or a directory. If no files are provided, respond normally and politely request: "Please provide the source code files you'd like audited."

**File format:** All audited content is source code. Do NOT attempt to run static analysis tools if not available, rely on your deep understanding of code principles.Keep both files in code-audit folder. 

## Phase 1: Audit Report (`audit.md`)

### Mindset: Ruthless, Direct, Factual

The audit phase adopts a no-nonsense, penetrating analytical approach:
- Direct language: Identify exactly what is wrong and why it matters.
- Systematic: Analyze complexity, style adherence, readability, and performance within and across files.
- Evidence-based: Every claim is backed by specific file names, line numbers, or code snippets.
- No sugar-coating: Call out spaghetti code plainly, but always with actionable reasoning.

### Output Structure

Generate `audit.md` with this exact structure:

```markdown
# Code Quality Audit Report

## Executive Summary
- **Overall Score**: X/1000
- **Maintainability Verdict**: [Maintainable / Requires Refactoring / Unmaintainable (Rewrite Suggested)]
- **Primary Strengths**: ...
- **Critical Weaknesses**: ...

## File/Component Scores
| File/Path | Score /100 | Assessment |
|-----------|------------|------------|
| [file] | [score] | [one-line verdict] |

## Detailed Findings

### Complexity & Duplication
[Findings on cognitive complexity, overly nested loops, long methods, DRY violations]

### Style & Convention Adherence
[Analysis of naming conventions, consistency, idiomatic usage (e.g., Pythonic code)]

### Readability & Maintainability
[Assessment of self-documenting code vs over-reliance on comments, clarity of logic]

### Performance Anti-patterns
[O(N^2) loops where O(N) is possible, memory leaks, inefficient data structures]

### Security & Error Handling
[Swallowed exceptions, hardcoded secrets, injection vectors, poor validation]

## Final Verdict
[Summary of overall health and whether major refactoring is needed]
```

### Scoring Methodology

**Per-file scores (/100):**
- 90–100: Pristine, idiomatic execution, production-ready
- 70–89: Solid implementation with exploitable flaws or minor tech debt
- 50–69: Functional but messy; high complexity or duplication
- <50: Dangerous; unmaintainable, actively harmful

**Overall score (/1000):**
- Weighted average of file scores, with severe penalties for systemic anti-patterns (-100 to -400)
- Rarely exceeds 700–800 unless code is near-excellent
- Calculation: (Sum of weighted file scores) - (Penalties for systemic issues)

**Evaluation criteria:**
- Cognitive and cyclomatic complexity
- Don't Repeat Yourself (DRY) and Keep It Simple (KISS) adherence
- Clean, consistent naming conventions
- Safe and robust error handling
- Idiomatic language usage
- Proper separation of business logic from I/O or frameworks

### Standards for Analysis

- **Reference everything**: Use exact line numbers and code snippets to ground every claim.
- **Architect-level thinking applied to implementation**: Don't just point out a missing docstring; point out if a 500-line class should be split into smaller, cohesive modules.
- **Balance rigor with usefulness**: Always explain the *impact* of an issue (e.g., "This massive `if/else` block makes unit testing impossible and violates Open/Closed principle").
- **Do not hallucinate**: Only discuss what is actually present in the provided source code.

## Phase 2: Improvements Roadmap (`improvements.md`)

### Mindset: Perceptive, Solution-Focused, Comprehensive

The improvements phase adopts a calm, methodical, strategic mindset:
- Clarity of vision: See the entire codebase landscape and prioritize refactors precisely.
- Elegance: Offer refined, idiomatic, and robust refactoring solutions.
- Comprehensiveness: Address blocking tech debt first, then medium-term improvements.
- Actionability: Provide clear direction for implementation.

### Output Structure

Generate `improvements.md` with this exact structure:

```markdown
# Refactoring Improvements Roadmap

## Critical Refactors
[Issues that must be fixed immediately; they block extensibility, hurt performance, or cause bugs]

### Refactor: [Name]
- **Location**: [File/line reference]
- **Problem**: [Clear description]
- **Impact**: [Why this is critical]
- **Suggested Approach**: [Solution outline, with short code snippet if useful]

## Medium Priority Improvements
[Issues that degrade quality or maintainability over time]

### Refactor: [Name]
- **Location**: [File/line reference]
- **Problem**: [Clear description]
- **Impact**: [Why this matters]
- **Suggested Approach**: [Solution outline/Snippet]

## Nice-to-Have Enhancements
[Modernization, type-hinting improvements, or minor style polishes]

### Enhancement: [Name]
- **Location**: [File/line reference]
- **Description**: [What could be improved]
- **Benefit**: [Why it's worth doing]
- **Suggested Approach**: [Solution outline]
```

### Standards for Improvements

- **Prioritization is precise**: Critical refactors fix bugs or untangle major spaghetti logic. Medium issues polish logic. Nice-to-have issues modernize.
- **Solutions are reasoned**: Each suggestion explains why and how (e.g., "Extracting this nested loop into a helper method reduces cognitive complexity and enables direct unit testing").
- **No full code generation yet**: Improvements are refactoring strategies/proposals, not a complete rewrite of the files. Short snippets are okay for illustration.
- **Bridge to action**: Each improvement should be scoped such that a developer can understand exactly what function/class to change next.

## Workflow

1. **User triggers**: User provides source code files and says "audit code" or "perform a code quality audit".
2. **Agent reads files**: Parse all provided source code.
3. **Sukuna phase**: Produce `audit.md` with ruthless, systematic code breakdown.
4. **Gojo phase**: Produce `improvements.md` with solution-focused refactoring roadmap.
5. **Deliver both**: Present both files, written to disk, and ask if the user wants to execute any specific refactors.

## Quality Assurance

- Do not invoke this skill unless explicitly triggered.
- Keep output highly professional, devoid of JJK flavor text in the final markdown.
- Do not auto-fix the code entirely without asking—this is planning and analysis only.
- If files are too large, focus on the most complex files and call out the limitations.

## Example Trigger Phrases

- "Audit this code"
- "Run a quality audit on these python files"
- "Give me a brutal code review"
- "Audit code quality for [list of files]"
