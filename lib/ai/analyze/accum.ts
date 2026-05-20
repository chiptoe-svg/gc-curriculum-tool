export interface CallTelemetry {
  costUsdCents: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
}

export class TelemetryAccumulator {
  private cost = 0;
  private cached = 0;
  private uncached = 0;
  private completion = 0;

  add(t: CallTelemetry): void {
    this.cost += t.costUsdCents;
    this.cached += t.cachedTokens;
    this.uncached += t.uncachedPromptTokens;
    this.completion += t.completionTokens;
  }

  totals(): CallTelemetry {
    return {
      costUsdCents: this.cost,
      cachedTokens: this.cached,
      uncachedPromptTokens: this.uncached,
      completionTokens: this.completion,
    };
  }
}
