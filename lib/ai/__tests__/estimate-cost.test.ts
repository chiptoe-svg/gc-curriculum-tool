import { describe, it, expect } from 'vitest';
import { estimateCostCents } from '@/lib/ai/openai';

describe('estimateCostCents', () => {
  it('prices a known model in 1/100-cent units', () => {
    // gpt-6.1-sol: $2.00 / 1M in, $10.00 / 1M out → 10k in = $0.02 = 200 units; 1k out = $0.01 = 100 units
    expect(estimateCostCents('gpt-6.1-sol', 10_000, 1_000)).toBe(300);
  });
  it('falls back to workhorse pricing for an unknown model', () => {
    // FALLBACK $2.50 / $15.00 → 10k in = 250, 1k out = 150
    expect(estimateCostCents('unknown-model', 10_000, 1_000)).toBe(400);
  });
});
