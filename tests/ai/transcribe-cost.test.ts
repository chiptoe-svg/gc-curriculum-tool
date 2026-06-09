import { describe, it, expect } from 'vitest';
import { estimateWhisperCostCents } from '@/lib/ai/transcribe';

describe('estimateWhisperCostCents (F9)', () => {
  it('returns ~60 hundredth-cents (0.6¢) per MB ≈ 1 min', () => {
    expect(estimateWhisperCostCents(1024 * 1024)).toBe(60);
  });

  it('scales with size and rounds up', () => {
    expect(estimateWhisperCostCents(5 * 1024 * 1024)).toBe(300);
    expect(estimateWhisperCostCents(100)).toBe(1); // tiny clip still rounds up to a unit
  });

  it('is zero for empty audio', () => {
    expect(estimateWhisperCostCents(0)).toBe(0);
  });
});
