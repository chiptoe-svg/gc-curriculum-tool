import { describe, it, expect } from 'vitest';
import { TelemetryAccumulator } from '@/lib/ai/analyze/accum';

describe('TelemetryAccumulator', () => {
  it('sums each metric across multiple calls', () => {
    const a = new TelemetryAccumulator();
    a.add({ costUsdCents: 10, cachedTokens: 100, uncachedPromptTokens: 50, completionTokens: 25 });
    a.add({ costUsdCents: 5, cachedTokens: 0, uncachedPromptTokens: 30, completionTokens: 20 });
    expect(a.totals()).toEqual({
      costUsdCents: 15,
      cachedTokens: 100,
      uncachedPromptTokens: 80,
      completionTokens: 45,
    });
  });
  it('returns zeros before any add()', () => {
    expect(new TelemetryAccumulator().totals()).toEqual({
      costUsdCents: 0, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0,
    });
  });
});
