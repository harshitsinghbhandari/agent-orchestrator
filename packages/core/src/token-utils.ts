export interface SectionInput {
  name: string;
  content: string;
}

export interface SectionOutput {
  name: string;
  tokens: number;
}

/**
 * Estimates token count from a string.
 * Currently uses a simple heuristic: 4 characters per token.
 * This is generally conservative for English text with LLM tokenizers.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimates token counts for a list of prompt sections.
 */
export function estimateTokensForSection(sections: SectionInput[]): SectionOutput[] {
  return sections.map((section) => ({
    name: section.name,
    tokens: estimateTokens(section.content),
  }));
}

/**
 * Calculates total token count from a list of sections.
 */
export function totalTokens(sections: { tokens: number }[]): number {
  return sections.reduce((total, section) => total + section.tokens, 0);
}
