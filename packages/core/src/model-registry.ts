export interface ModelSpec {
  provider: string;
  model: string;
  maxContextTokens: number;
  safePromptBudget: number;
  supportsCacheRead: boolean;
  supportsCacheWrite: boolean;
  supportsReasoning: boolean;
}

export class ModelRegistry {
  private static instance: ModelRegistry;
  private registry: Map<string, ModelSpec> = new Map();

  private constructor() {
    this.registerDefaults();
  }

  public static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  /**
   * Register a model specification.
   */
  public register(spec: ModelSpec): void {
    const key = this.makeKey(spec.provider, spec.model);
    this.registry.set(key, spec);
  }

  /**
   * Get a model specification by provider and model name.
   */
  public get(provider: string, model: string): ModelSpec | undefined {
    const key = this.makeKey(provider, model);
    return this.registry.get(key);
  }

  /**
   * Returns the prompt budget (safe buffer for tokens).
   * Defaults to 100k if model is unknown.
   */
  public getPromptBudget(provider: string, model: string): number {
    const spec = this.get(provider, model);
    if (spec) {
      return spec.safePromptBudget;
    }
    const fallback = this.getDefaultEstimate();
    console.warn(
      `[model-registry] Unknown model context for ${provider}/${model}. ` +
        `Using fallback budget of ${fallback.safePromptBudget.toLocaleString()} tokens.`,
    );
    return fallback.safePromptBudget;
  }

  /**
   * Default spec for unknown models.
   */
  public getDefaultEstimate(): ModelSpec {
    return {
      provider: "unknown",
      model: "default",
      maxContextTokens: 128000,
      safePromptBudget: 100000,
      supportsCacheRead: false,
      supportsCacheWrite: false,
      supportsReasoning: false,
    };
  }

  private makeKey(provider: string, model: string): string {
    return `${provider.toLowerCase()}/${model.toLowerCase()}`;
  }

  private registerDefaults(): void {
    const defaults: ModelSpec[] = [
      {
        provider: "anthropic",
        model: "claude-3-5-sonnet-20241022",
        maxContextTokens: 200000,
        safePromptBudget: 160000,
        supportsCacheRead: true,
        supportsCacheWrite: true,
        supportsReasoning: false,
      },
      {
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
        maxContextTokens: 200000,
        safePromptBudget: 160000,
        supportsCacheRead: true,
        supportsCacheWrite: true,
        supportsReasoning: false,
      },
      {
        provider: "anthropic",
        model: "claude-3-7-sonnet-20250219",
        maxContextTokens: 200000,
        safePromptBudget: 160000,
        supportsCacheRead: true,
        supportsCacheWrite: true,
        supportsReasoning: true,
      },
      {
        provider: "anthropic",
        model: "claude-3-7-sonnet-latest",
        maxContextTokens: 200000,
        safePromptBudget: 160000,
        supportsCacheRead: true,
        supportsCacheWrite: true,
        supportsReasoning: true,
      },
      {
        provider: "openai",
        model: "gpt-4o",
        maxContextTokens: 128000,
        safePromptBudget: 100000,
        supportsCacheRead: true,
        supportsCacheWrite: false,
        supportsReasoning: false,
      },
      {
        provider: "openai",
        model: "gpt-4o-latest",
        maxContextTokens: 128000,
        safePromptBudget: 100000,
        supportsCacheRead: true,
        supportsCacheWrite: false,
        supportsReasoning: false,
      },
      {
        provider: "openai",
        model: "o3-mini",
        maxContextTokens: 200000,
        safePromptBudget: 160000,
        supportsCacheRead: true,
        supportsCacheWrite: false,
        supportsReasoning: true,
      },
      {
        provider: "openai",
        model: "o1",
        maxContextTokens: 200000,
        safePromptBudget: 160000,
        supportsCacheRead: true,
        supportsCacheWrite: false,
        supportsReasoning: true,
      },
      {
        provider: "openai",
        model: "codex",
        maxContextTokens: 200000,
        safePromptBudget: 160000,
        supportsCacheRead: false,
        supportsCacheWrite: false,
        supportsReasoning: false,
      }
    ];

    for (const spec of defaults) {
      this.register(spec);
    }
  }
}

export const modelRegistry = ModelRegistry.getInstance();
