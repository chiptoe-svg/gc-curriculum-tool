import { describe, it, expect } from 'vitest';
import { depthBand, isMentionOnly } from '@/lib/program/depth-band';

describe('depthBand', () => {
  it('maps the 0-5 scale into the four bands', () => {
    expect(depthBand(0)).toEqual({ key: 'none', short: '—', word: 'not present' });
    expect(depthBand(1)).toEqual({ key: 'low', short: 'L', word: 'low (1–2)' });
    expect(depthBand(2)).toEqual({ key: 'low', short: 'L', word: 'low (1–2)' });
    expect(depthBand(3)).toEqual({ key: 'working', short: 'W', word: 'working (3)' });
    expect(depthBand(4)).toEqual({ key: 'high', short: 'H', word: 'high (4–5)' });
    expect(depthBand(5)).toEqual({ key: 'high', short: 'H', word: 'high (4–5)' });
  });

  it('passes null through (no data ≠ a band)', () => {
    expect(depthBand(null)).toBeNull();
  });

  it('clamps out-of-range values rather than throwing', () => {
    expect(depthBand(-1)!.key).toBe('none');
    expect(depthBand(7)!.key).toBe('high');
  });
});

describe('isMentionOnly (A16 — K1-only dissociation case)', () => {
  it('flags K1 with no engagement (U0/D0, or U null)', () => {
    expect(isMentionOnly(1, 0, 0)).toBe(true);
    expect(isMentionOnly(1, null, 0)).toBe(true);
  });

  it('does not flag engaged or absent cells', () => {
    expect(isMentionOnly(1, 1, 0)).toBe(false); // some Understand evidence
    expect(isMentionOnly(1, 0, 1)).toBe(false); // some Do evidence
    expect(isMentionOnly(2, 0, 0)).toBe(false); // K2 is recognition, not mere mention
    expect(isMentionOnly(0, 0, 0)).toBe(false); // not present at all
    expect(isMentionOnly(null, null, 2)).toBe(false); // foundational with real D
  });
});
