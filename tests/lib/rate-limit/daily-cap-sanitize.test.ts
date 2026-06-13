import { describe, it, expect } from 'vitest';
import { sanitizeCents, MAX_SANE_CENTS } from '@/lib/rate-limit/daily-cap';

describe('sanitizeCents', () => {
  it('passes through a normal positive integer unchanged', () => {
    expect(sanitizeCents(1234)).toBe(1234);
  });

  it('passes through zero', () => {
    expect(sanitizeCents(0)).toBe(0);
  });

  it('NaN → 0', () => {
    expect(sanitizeCents(NaN)).toBe(0);
  });

  it('+Infinity → 0', () => {
    expect(sanitizeCents(Infinity)).toBe(0);
  });

  it('-Infinity → 0', () => {
    expect(sanitizeCents(-Infinity)).toBe(0);
  });

  it('negative value → 0', () => {
    expect(sanitizeCents(-50)).toBe(0);
  });

  it('-0 → 0', () => {
    expect(sanitizeCents(-0)).toBe(0);
  });

  it('fractional value is rounded to integer', () => {
    expect(sanitizeCents(3.7)).toBe(4);
    expect(sanitizeCents(3.2)).toBe(3);
  });

  it('value exactly at MAX_SANE_CENTS passes through', () => {
    expect(sanitizeCents(MAX_SANE_CENTS)).toBe(MAX_SANE_CENTS);
  });

  it('value above MAX_SANE_CENTS is clamped to MAX_SANE_CENTS', () => {
    expect(sanitizeCents(MAX_SANE_CENTS + 1)).toBe(MAX_SANE_CENTS);
    expect(sanitizeCents(Number.MAX_SAFE_INTEGER)).toBe(MAX_SANE_CENTS);
  });
});
