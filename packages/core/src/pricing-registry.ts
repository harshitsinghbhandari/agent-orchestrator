import { DEFAULT_PRICING } from "./default-pricing.js";

export interface PricingSpec {
  provider: string;
  model: string;
  effectiveDate: string; // ISO date for when these prices took effect
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
  reasoningPerMillion?: number;
}

export class PricingRegistry {
  private static instance: PricingRegistry;
  private pricingData: PricingSpec[] = [];

  private constructor() {
    this.registerDefaults();
  }

  public static getInstance(): PricingRegistry {
    if (!PricingRegistry.instance) {
      PricingRegistry.instance = new PricingRegistry();
    }
    return PricingRegistry.instance;
  }

  /**
   * Register a pricing specification.
   */
  public register(spec: PricingSpec): void {
    if (!spec.effectiveDate || Number.isNaN(Date.parse(spec.effectiveDate))) {
      throw new Error(
        `Invalid effectiveDate for pricing: "${spec.effectiveDate}". ` +
          "Must be a valid ISO-8601 date string.",
      );
    }
    this.pricingData.push(spec);
    // Sort so latest prices (descending) are first in lookup
    this.pricingData.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  }

  /**
   * Lookup the pricing for a given model.
   * If a date is provided, returns pricing effective on that date.
   * Otherwise returns the latest pricing.
   */
  public lookup(provider: string, model: string, date?: string): PricingSpec | undefined {
    const searchDate = date || new Date().toISOString();
    
    return this.pricingData.find(spec => 
      spec.provider.toLowerCase() === provider.toLowerCase() &&
      spec.model.toLowerCase() === model.toLowerCase() &&
      spec.effectiveDate <= searchDate
    );
  }

  /**
   * Returns default pricing for an unknown model.
   */
  public getDefaultPricing(): PricingSpec {
    return {
      provider: "unknown",
      model: "default",
      effectiveDate: "1970-01-01T00:00:00Z",
      inputPerMillion: 2.5, // matches codex old default
      outputPerMillion: 10.0, // matches codex old default
    };
  }

  /**
   * Get all registered pricing specs.
   */
  public getAll(): PricingSpec[] {
    return [...this.pricingData];
  }

  private registerDefaults(): void {
    for (const spec of DEFAULT_PRICING) {
      this.register(spec);
    }
  }
}

export const pricingRegistry = PricingRegistry.getInstance();
