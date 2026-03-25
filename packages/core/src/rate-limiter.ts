export class TokenBucketRateLimiter {
  private maxTokens: number;
  private refillRatePerSecond: number;
  private tokens: number;
  private lastRefillTime: number;

  constructor(maxTokens: number, refillRatePerSecond: number) {
    this.maxTokens = maxTokens;
    this.refillRatePerSecond = refillRatePerSecond;
    this.tokens = maxTokens;
    this.lastRefillTime = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTime) / 1000;
    const tokensToAdd = elapsedSeconds * this.refillRatePerSecond;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }

  async acquire(count: number = 1): Promise<void> {
    while (true) {
      this.refill();

      if (this.tokens >= count) {
        this.tokens -= count;
        return;
      }

      // Wait until enough tokens might have accumulated
      const tokensNeeded = count - this.tokens;
      const waitTimeMs = Math.ceil((tokensNeeded / this.refillRatePerSecond) * 1000);

      await new Promise(resolve => setTimeout(resolve, Math.max(10, waitTimeMs)));
    }
  }

  tryAcquire(count: number = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }
}
