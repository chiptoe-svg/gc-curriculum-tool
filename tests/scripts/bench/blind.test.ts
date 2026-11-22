import { describe, it, expect } from 'vitest';
import { makePairs, unblind, tallyBlind, secondJudgeIds } from '@/scripts/bench/lib/blind';

const cell = (d: number, excerpt = 'x') => ({ sub: 's', k: 1, u: 0, d, excerpt });
const inputs = Array.from({ length: 6 }, (_, i) => ({
  course: 'GC 1', sub: `s${i}`, baseline: cell(1, 'base'),
  candidates: [{ label: 'agent / m:off', cell: cell(2, 'agent') }],
}));

describe('unblind', () => {
  it('unblind maps A/B back by key', () => {
    const key = { 'pair-0001': { A: 'agent / m:off', B: 'baseline' } };
    expect(unblind(key, 'pair-0001', 'A')).toBe('agent / m:off');
    expect(unblind(key, 'pair-0001', 'B')).toBe('baseline');
    expect(unblind(key, 'pair-0001', 'tie')).toBe('tie');
    expect(() => unblind(key, 'pair-9999', 'A')).toThrow(/pair-9999/);
  });
});

describe('makePairs', () => {
  it('is reproducible for a seed and never shows the baseline label in pairs', () => {
    const a = makePairs(inputs, 7), b = makePairs(inputs, 7), c = makePairs(inputs, 8);
    expect(a).toEqual(b);
    expect(c.key).not.toEqual(a.key);
    expect(JSON.stringify(a.pairs)).not.toContain('baseline');
  });
  it('secondJudgeIds draws a seeded 20% sample of pair ids', () => {
    const { pairs } = makePairs(Array.from({ length: 50 }, (_, i) => ({ ...inputs[0]!, sub: `s${i}` })), 3);
    const x = secondJudgeIds(pairs, 99), y = secondJudgeIds(pairs, 99);
    expect(x).toEqual(y);
    expect(x.length).toBe(10);
    expect(new Set(x).size).toBe(x.length);
  });
});

describe('tallyBlind', () => {
  const { key } = makePairs(inputs, 7);
  const ids = Object.keys(key);
  const verdictsFor = (winners: Array<'A' | 'B' | 'tie'>) => ids.map((id, i) => ({ id, winner: winners[i % winners.length]!, reason: 'r' }));
  // winner that is the agent label for this pair
  const agentWins = (n: number) => ids.map((id, i) => ({ id, winner: (key[id]!.A === 'baseline' ? 'B' : 'A') as 'A' | 'B', reason: 'r' })).slice(0, n);
  const summary = (armBreaks: number, armStab: number | null, baseStab: number | null = 0.5) => [
    { label: 'baseline', cells: 10, breaks: 3, stability: baseStab },
    { label: 'agent / m:off', cells: 10, breaks: armBreaks, stability: armStab },
  ];

  it('tally applies the decision rule: fewer breaks + >=50% + stability >= baseline → adopt, else not', () => {
    const v = agentWins(ids.length); // agent wins every pair: 100%
    const adopt = tallyBlind({ key, verdicts: v, summary: summary(2, 0.6) })[0]!;
    expect(adopt.adopt).toBe(true);
    expect(tallyBlind({ key, verdicts: v, summary: summary(3, 0.6) })[0]!.adopt).toBe(false); // breaks not fewer
    expect(tallyBlind({ key, verdicts: v, summary: summary(2, 0.4) })[0]!.adopt).toBe(false); // stability lower
    expect(tallyBlind({ key, verdicts: v, summary: summary(2, null) })[0]!.adopt).toBe(false); // undefined stability
    expect(tallyBlind({ key, verdicts: v, summary: summary(2, 0.6, null) })[0]!.adopt).toBe(false); // baseline stability undefined
    const lose = tallyBlind({ key, verdicts: agentWins(0).concat(ids.slice(0, 4).map(id => ({ id, winner: (key[id]!.A === 'baseline' ? 'A' : 'B') as 'A' | 'B', reason: 'r' }))), summary: summary(2, 0.6) })[0]!;
    expect(lose.prefExTies).toBeLessThan(0.5);
    expect(lose.adopt).toBe(false);
  });

  it('A-position rate reported', () => {
    const v = ids.map((id, i) => ({ id, winner: (i < 4 ? 'A' : 'B') as 'A' | 'B', reason: 'r' })); // 4 of 6 non-tie verdicts at A
    const t = tallyBlind({ key, verdicts: v, summary: summary(2, 0.6) });
    expect(t[0]!.aPositionRate).toBeCloseTo(4 / 6);
    expect(verdictsFor(['tie'])).toHaveLength(ids.length);
  });
});
