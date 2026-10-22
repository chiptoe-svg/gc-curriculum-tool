import { describe, it, expect } from 'vitest';
import { bandOf, decideMembership, MEMBERSHIP_CUTOFF, type PairState } from '@/lib/catalog/membership';

const p = (c: string, o: Partial<PairState>): PairState => ({ careerTargetId: 't', competencyId: c, pinned: false, hidden: false, pinOrder: null, weight: null, ...o });

describe('bandOf', () => {
  it('uses inclusive floors 0.75 / 0.5 / 0.25', () => {
    expect(bandOf(1)).toBe('very');
    expect(bandOf(0.75)).toBe('very');
    expect(bandOf(0.7499)).toBe('important');
    expect(bandOf(0.5)).toBe('important');
    expect(bandOf(0.4999)).toBe('somewhat');
    expect(bandOf(0.25)).toBe('somewhat');
    expect(bandOf(0.2499)).toBeNull();
    expect(bandOf(null)).toBeNull();
  });
});

describe('decideMembership', () => {
  it('cutoff is 0.5', () => expect(MEMBERSHIP_CUTOFF).toBe(0.5));

  it('pinned below the cutoff shows; hidden above it does not; weight at the cutoff shows; below and null do not', () => {
    const rows = decideMembership([
      p('pin-low', { pinned: true, pinOrder: 3, weight: 0.1 }),
      p('hid-high', { hidden: true, weight: 0.9 }),
      p('at', { weight: 0.5 }),
      p('below', { weight: 0.4999 }),
      p('none', {}),
    ]);
    expect(rows.map(r => r.competencyId).sort()).toEqual(['at', 'pin-low']);
  });

  it('a hide wins over a pin', () => {
    expect(decideMembership([p('x', { pinned: true, hidden: true, pinOrder: 0, weight: 1 })])).toEqual([]);
  });

  it('pins keep their order; weight-based rows follow by weight, then id', () => {
    const rows = decideMembership([
      p('w-b', { weight: 0.6 }),
      p('w-a', { weight: 0.6 }),
      p('w-top', { weight: 0.9 }),
      p('pin', { pinned: true, pinOrder: 7, weight: null }),
    ]);
    expect(rows.map(r => [r.competencyId, r.basis, r.displayOrder])).toEqual([
      ['pin', 'pinned', 7],
      ['w-top', 'weight', 8],
      ['w-a', 'weight', 9],
      ['w-b', 'weight', 10],
    ]);
  });

  it('orders each target separately and keeps effective weight', () => {
    const rows = decideMembership([
      { ...p('a', { weight: 0.8 }), careerTargetId: 't1' },
      { ...p('a', { weight: 0.55 }), careerTargetId: 't2' },
    ]);
    expect(rows).toEqual([
      { careerTargetId: 't1', competencyId: 'a', basis: 'weight', effectiveWeight: 0.8, displayOrder: 0 },
      { careerTargetId: 't2', competencyId: 'a', basis: 'weight', effectiveWeight: 0.55, displayOrder: 0 },
    ]);
  });
});
