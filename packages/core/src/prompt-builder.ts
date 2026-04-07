/**
 * Prompt Builder — composes layered prompts for agent sessions.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectConfig } from "./types.js";
import { estimateTokens } from "./token-utils.js";
import { modelRegistry } from "./model-registry.js";

// =============================================================================
// LAYER 1: BASE AGENT PROMPT
// =============================================================================

export const BASE_AGENT_PROMPT = `You are an AI coding agent managed by the Agent Orchestrator (ao).

## Session Lifecycle
- You are running inside a managed session. Focus on the assigned task.
- When you finish your work, create a PR and push it. The orchestrator will handle CI monitoring and review routing.
- If you're told to take over or continue work on an existing PR, run \`ao session claim-pr <pr-number-or-url>\` from inside this session before making changes.
- If CI fails, the orchestrator will send you the failures — fix them and push again.
- If reviewers request changes, the orchestrator will forward their comments — address each one, push fixes, and reply to the comments.

## Git Workflow
- Always create a feature branch from the default branch (never commit directly to it).
- Use conventional commit messages (feat:, fix:, chore:, etc.).
- Push your branch and create a PR when the implementation is ready.
- Keep PRs focused — one issue per PR.

## PR Best Practices
- Write a clear PR title and description explaining what changed and why.
- Link the issue in the PR description so it auto-closes when merged.
- If the repo has CI checks, make sure they pass before requesting review.
- Respond to every review comment, even if just to acknowledge it.`;

// =============================================================================
// TYPES
// =============================================================================

export interface PromptBuildConfig {
  project: ProjectConfig;
  projectId: string;
  issueId?: string;
  issueContext?: string;
  userPrompt?: string;
  lineage?: string[];
  siblings?: string[];
}

export interface PromptSection {
  name: string;
  content: string;
  tokens: number;
  priority: number;
  optional: boolean;
}

export interface PromptTruncationReport {
  originalTokens: number;
  finalTokens: number;
  budget: number;
  droppedSections: string[];
  truncatedSections: Array<{ name: string; originalTokens: number; finalTokens: number }>;
}

export interface PromptBuildResult {
  prompt: string;
  sections: PromptSection[];
  totalTokens: number;
  model?: string;
  promptBudget?: number;
  truncationReport?: PromptTruncationReport;
}

// =============================================================================
// LAYER 2: CONFIG-DERIVED CONTEXT
// =============================================================================

function buildConfigLayer(config: PromptBuildConfig): string {
  const { project, projectId, issueId } = config;
  const lines: string[] = [];

  lines.push("## Project Context");
  lines.push(`- Project: ${project.name ?? projectId}`);
  lines.push(`- Repository: ${project.repo}`);
  lines.push(`- Default branch: ${project.defaultBranch}`);

  if (project.tracker) {
    lines.push(`- Tracker: ${project.tracker.plugin}`);
  }

  if (issueId) {
    lines.push(`\n## Task`);
    lines.push(`Work on issue: ${issueId}`);
    lines.push(
      `Create a branch named so that it auto-links to the issue tracker (e.g. feat/${issueId}).`
    );
  }

  if (project.reactions) {
    const reactionHints: string[] = [];
    for (const [event, reaction] of Object.entries(project.reactions)) {
      if (reaction.auto && reaction.action === "send-to-agent") {
        reactionHints.push(`- ${event}: auto-handled (you'll receive instructions)`);
      }
    }
    if (reactionHints.length > 0) {
      lines.push(`\n## Automated Reactions`);
      lines.push("The orchestrator will automatically handle these events:");
      lines.push(...reactionHints);
    }
  }

  return lines.join("\n");
}

// =============================================================================
// LAYER 3: USER RULES
// =============================================================================

function readUserRules(project: ProjectConfig): string | null {
  const parts: string[] = [];

  if (project.agentRules) {
    parts.push(project.agentRules);
  }

  if (project.agentRulesFile) {
    const filePath = resolve(project.path, project.agentRulesFile);
    try {
      const content = readFileSync(filePath, "utf-8").trim();
      if (content) {
        parts.push(content);
      }
    } catch {
      // File not found or unreadable — skip silently
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function buildPromptWithMetadata(
  config: PromptBuildConfig,
  modelInfo?: { provider: string; model: string }
): PromptBuildResult {
  /**
   * Section priorities (higher = more important, kept during truncation):
   *   10: Additional Instructions — explicit user prompt, never dropped
   *    9: Issue Details — the task context
   *    8: Task Hierarchy — decomposition chain
   *    7: Config Context — project name, repo, branch
   *    6: Base Agent Prompt — AO lifecycle guidance
   *    5: User Rules — project-specific agent rules
   *    4: Parallel Work — sibling task descriptions, first to drop
   */
  const sections: PromptSection[] = [];

  sections.push({
    name: "base-agent-prompt",
    content: BASE_AGENT_PROMPT,
    tokens: estimateTokens(BASE_AGENT_PROMPT),
    priority: 6,
    optional: false,
  });

  const configContent = buildConfigLayer(config);
  sections.push({
    name: "config-context",
    content: configContent,
    tokens: estimateTokens(configContent),
    priority: 7,
    optional: false,
  });

  if (config.issueContext) {
    const content = `## Issue Details\n${config.issueContext}`;
    sections.push({
      name: "issue-details",
      content,
      tokens: estimateTokens(content),
      priority: 9,
      optional: false,
    });
  }

  const userRules = readUserRules(config.project);
  if (userRules) {
    const content = `## Project Rules\n${userRules}`;
    sections.push({
      name: "user-rules",
      content,
      tokens: estimateTokens(content),
      priority: 5,
      optional: false,
    });
  }

  if (config.lineage && config.lineage.length > 0) {
    const hierarchy = config.lineage.map((desc, i) => `${"  ".repeat(i)}${i}. ${desc}`);
    const currentLabel = config.issueId ?? "this task";
    hierarchy.push(`${"  ".repeat(config.lineage.length)}${config.lineage.length}. ${currentLabel}  <-- (this task)`);

    const content = `## Task Hierarchy\nThis task is part of a larger decomposed plan. Your place in the hierarchy:\n\n\`\`\`\n${hierarchy.join("\n")}\n\`\`\`\n\nStay focused on YOUR specific task. Do not implement functionality that belongs to other tasks in the hierarchy.`;
    sections.push({
      name: "task-hierarchy",
      content,
      tokens: estimateTokens(content),
      priority: 8,
      optional: true,
    });
  }

  if (config.siblings && config.siblings.length > 0) {
    const siblingLines = config.siblings.map((s) => `  - ${s}`);
    const content = `## Parallel Work\nSibling tasks being worked on in parallel:\n${siblingLines.join("\n")}\n\nDo not duplicate work that sibling tasks handle. If you need interfaces/types from siblings, define reasonable stubs.`;
    sections.push({
      name: "parallel-work",
      content,
      tokens: estimateTokens(content),
      priority: 4,
      optional: true,
    });
  }

  if (config.userPrompt) {
    const content = `## Additional Instructions\n${config.userPrompt}`;
    sections.push({
      name: "additional-instructions",
      content,
      tokens: estimateTokens(content),
      priority: 10,
      optional: false,
    });
  }

  const totalTokens = sections.reduce((sum, s) => sum + s.tokens, 0);
  const prompt = sections.map(s => s.content).join("\n\n");

  const result: PromptBuildResult = {
    prompt,
    sections,
    totalTokens,
  };

  if (modelInfo) {
    result.model = modelInfo.model;
    result.promptBudget = modelRegistry.getPromptBudget(modelInfo.provider, modelInfo.model);
  }

  return result;
}

export function buildPrompt(config: PromptBuildConfig): string {
  return buildPromptWithMetadata(config).prompt;
}

/**
 * Truncates a prompt result to fit within a given budget, prioritizing
 * sections so that the most important ones are kept.
 */
export function truncatePrompt(result: PromptBuildResult, budget: number): PromptBuildResult {
  if (result.totalTokens <= budget) {
    return result;
  }

  const report: PromptTruncationReport = {
    originalTokens: result.totalTokens,
    finalTokens: 0,
    budget,
    droppedSections: [],
    truncatedSections: [],
  };

  // Deep-clone sections so we don't mutate the original PromptBuildResult
  const sortedSections = result.sections.map(s => ({ ...s })).sort((a, b) => a.priority - b.priority);
  
  let currentTokens = result.totalTokens;

  for (let i = 0; i < sortedSections.length; i++) {
    const section = sortedSections[i];
    
    // Always keep the highest-priority section fully intact
    if (i === sortedSections.length - 1 || section.priority >= 10) {
      continue;
    }

    if (currentTokens <= budget) {
      break;
    }

    const deficit = currentTokens - budget;
    const oldTokens = section.tokens;

    if (section.optional) {
      // Entirely drop this optional section
      currentTokens -= oldTokens;
      report.droppedSections.push(section.name);
      section.tokens = 0;
      section.content = "";
    } else {
      // Truncate required section (prefer cutting at a newline to avoid mid-word breaks)
      const keepTokens = Math.max(0, oldTokens - deficit);
      const keepChars = keepTokens * 4;

      if (keepChars < 40) {
        section.content = `${section.content.slice(0, 40)}\n\n[... truncated, ${oldTokens} tokens omitted]`;
      } else {
        // Find the last newline before the cut point (at least halfway to preserve context)
        const truncated = section.content.substring(0, keepChars);
        const lastNewline = truncated.lastIndexOf("\n");
        const safeCut = lastNewline > keepChars * 0.5 ? lastNewline : keepChars;
        section.content = `${section.content.substring(0, safeCut)}\n\n[... truncated, ${oldTokens - keepTokens} tokens omitted]`;
      }

      section.tokens = estimateTokens(section.content);
      currentTokens = currentTokens - oldTokens + section.tokens;
      report.truncatedSections.push({
        name: section.name,
        originalTokens: oldTokens,
        finalTokens: section.tokens,
      });
    }
  }

  report.finalTokens = currentTokens;

  // Re-join prompt in original section order (use cloned sections by priority, re-sort by original index)
  // Since sections have unique names, map by name to get updated content from sortedSections
  const updatedByName = new Map(sortedSections.map(s => [s.name, s]));
  const finalSections = result.sections
    .map(s => updatedByName.get(s.name) ?? s)
    .filter(s => s.tokens > 0);
  const finalPrompt = finalSections.map(s => s.content).join("\n\n");
  
  console.warn(
    `⚠ Prompt truncated: ${report.originalTokens} → ${report.finalTokens} tokens ` +
    `(dropped: ${report.droppedSections.join(', ') || 'none'}; ` +
    `truncated: ${report.truncatedSections.map(t => `${t.name} ${t.originalTokens} -> ${t.finalTokens}`).join(', ') || 'none'})`
  );

  return {
    ...result,
    prompt: finalPrompt,
    sections: finalSections,
    totalTokens: report.finalTokens,
    truncationReport: report,
  };
}
