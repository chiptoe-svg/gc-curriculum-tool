import { describe, it, expect } from 'vitest';
import { sanitizeIntendedDepth } from '@/lib/db/courses-queries';

describe('sanitizeIntendedDepth', () => {
  it('passes through valid depth values 0–5', () => {
    for (const v of [0, 1, 2, 3, 4, 5]) {
      expect(sanitizeIntendedDepth(v)).toBe(v);
    }
  });

  it('null → null', () => {
    expect(sanitizeIntendedDepth(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(sanitizeIntendedDepth(undefined)).toBeNull();
  });

  it('6 → null (out of range)', () => {
    expect(sanitizeIntendedDepth(6)).toBeNull();
  });

  it('-1 → null (out of range)', () => {
    expect(sanitizeIntendedDepth(-1)).toBeNull();
  });

  it('NaN → null', () => {
    expect(sanitizeIntendedDepth(NaN)).toBeNull();
  });

  it('Infinity → null', () => {
    expect(sanitizeIntendedDepth(Infinity)).toBeNull();
  });

  it('-Infinity → null', () => {
    expect(sanitizeIntendedDepth(-Infinity)).toBeNull();
  });

  it('fractional in range rounds to nearest integer', () => {
    expect(sanitizeIntendedDepth(2.6)).toBe(3);
    expect(sanitizeIntendedDepth(2.4)).toBe(2);
  });

  it('fractional that rounds out of range → null (e.g. 5.7 → 6 → null)', () => {
    expect(sanitizeIntendedDepth(5.7)).toBeNull();
  });
});
