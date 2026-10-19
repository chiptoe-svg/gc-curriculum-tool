import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));

import { flagsFor, type ScoringFlags } from '@/lib/db/scoring-flags';

describe('flagsFor', () => {
  it('returns the flags for a known id', () => {
    const m = new Map<string, ScoringFlags>([['a', { foundational: true, scoring: 'direct' }]]);
    expect(flagsFor(m, 'a')).toEqual({ foundational: true, scoring: 'direct' });
  });
  it('throws naming the id when it is missing (fails closed)', () => {
    expect(() => flagsFor(new Map(), 'ghost-id')).toThrow(/ghost-id/);
  });
});
