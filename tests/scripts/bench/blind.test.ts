import { describe, it, expect } from 'vitest';
import { makePairs, unblind, tallyBlind, secondJudgeIds, renderTally, PROVISIONAL_NOTE, type Verdict } from '@/scripts/bench/lib/blind';

const cell = (d: number, excerpt = 'x') => ({ sub: 's', k: 1, u: 0, d, excerpt });
const inputs = (labels: string[]) => Array.from({ length: 6 }, (_, i) => ({
  course: 'GC 1', sub: `s${i}`, baseline: cell(1, 'base'),
  candidates: labels.map(l => ({ label: l, cell: cell(2, 'agent') })),
}));

/** Verdicts where `label` wins (or loses to baseline) on every pair it appears in. */
function verdictsFor(key: Record<string, { A: string; B: string }>, label: string, outcome: 'win' | 'lose'): Verdict[] {
  return Object.keys(key)
    .filter(id => key[id]!.A === label || key[id]!.B === label)
    .map(id => {
      const labelIsA = key[id]!.A === label;
      const winIsA = outcome === 'win' ? labelIsA : !labelIsA;
      return { id, winner: winIsA ? 'A' : 'B', reason: 'r' } as Verdict;
    });
}

const rows = (o: { agentBreaks?: number; agentStab?: number | null; singleBreaks?: number; singleStab?: number | null; singleLowStab?: number | null } = {}) => [
  { label: 'baseline', cells: 6, breaks: 3, stability: null },
  { label: 'single / m:off', cells: 6, breaks: o.singleBreaks ?? 2, stability: o.singleStab === undefined ? 0.5 : o.singleStab },
  { label: 'single / m:low', cells: 6, breaks: 2, stability: o.singleLowStab === undefined ? 0.9 : o.singleLowStab },
  { label: 'agent / m:off', cells: 6, breaks: o.agentBreaks ?? 2, stability: o.agentStab === undefined ? 0.6 : o.agentStab },
];

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
    const a = makePairs(inputs(['agent / m:off']), 7), b = makePairs(inputs(['agent / m:off']), 7), c = makePairs(inputs(['agent / m:off']), 8);
    expect(a).toEqual(b);
    expect(c.key).not.toEqual(a.key);
    expect(JSON.stringify(a.pairs)).not.toContain('baseline');
  });
  it('secondJudgeIds draws a seeded 20% sample of pair ids', () => {
    const { pairs } = makePairs(Array.from({ length: 50 }, (_, i) => ({ ...inputs(['agent / m:off'])[0]!, sub: `s${i}` })), 3);
    const x = secondJudgeIds(pairs, 99), y = secondJudgeIds(pairs, 99);
    expect(x).toEqual(y);
    expect(x.length).toBe(10);
    expect(new Set(x).size).toBe(x.length);
  });
});

describe('tallyBlind', () => {
  const { key } = makePairs(inputs(['agent / m:off', 'single / m:off']), 7);
  const agent = (t: ReturnType<typeof tallyBlind>) => t.find(x => x.label === 'agent / m:off')!;
  const single = (t: ReturnType<typeof tallyBlind>) => t.find(x => x.label === 'single / m:off')!;

  it('tally applies the decision rule: fewer breaks + >=50% + stability >= same-model single → adopt, else not', () => {
    const v = verdictsFor(key, 'agent / m:off', 'win');
    expect(agent(tallyBlind({ key, verdicts: v, summary: rows() })).adopt).toBe(true);
    expect(agent(tallyBlind({ key, verdicts: v, summary: rows({ agentBreaks: 3 }) })).adopt).toBe(false); // breaks not fewer than 3
    expect(agent(tallyBlind({ key, verdicts: v, summary: rows({ agentStab: 0.4 }) })).adopt).toBe(false); // stability below single 0.5
    expect(agent(tallyBlind({ key, verdicts: v, summary: rows({ agentStab: null }) })).adopt).toBe(false); // agent stability undefined
    expect(agent(tallyBlind({ key, verdicts: v, summary: rows({ singleStab: null }) })).adopt).toBe(false); // single stability undefined
    const lost = verdictsFor(key, 'agent / m:off', 'lose');
    const t = agent(tallyBlind({ key, verdicts: lost, summary: rows() }));
    expect(t.prefExTies).toBe(0);
    expect(t.adopt).toBe(false);
  });

  it('stability is compared with the same model\'s single arm', () => {
    // agent/m:off 0.6 beats single/m:off 0.5 but would fail against single/m:low 0.9
    const v = verdictsFor(key, 'agent / m:off', 'win');
    const t = agent(tallyBlind({ key, verdicts: v, summary: rows({ agentStab: 0.6, singleStab: 0.5, singleLowStab: 0.9 }) }));
    expect(t.baselineStability).toBe(0.5);
    expect(t.stabilityRef).toBe('single / m:off');
    expect(t.adopt).toBe(true);
    // no single arm row for the model at all: cannot be judged, so not adopted
    const noSingle = rows().filter(r => r.label !== 'single / m:off');
    const u = agent(tallyBlind({ key, verdicts: v, summary: noSingle }));
    expect(u.adopt).toBe(false);
    expect(u.reasons.join(' ')).toMatch(/single/);
  });

  it('single arm verdict ignores stability', () => {
    const v = verdictsFor(key, 'single / m:off', 'win');
    const s = single(tallyBlind({ key, verdicts: v, summary: rows({ singleStab: null, singleBreaks: 2 }) }));
    expect(s.adopt).toBe(true); // breaks 2 < 3 and 100% preference; stability unmeasured but not judged
    expect(s.stabilityRef).toBeNull();
    expect(single(tallyBlind({ key, verdicts: v, summary: rows({ singleBreaks: 3 }) })).adopt).toBe(false); // breaks still judged
  });

  it('A-position rate reported', () => {
    const ids = Object.keys(key);
    const v: Verdict[] = ids.map((id, i) => ({ id, winner: (i % 3 === 0 ? 'A' : 'B') as 'A' | 'B', reason: 'r' }));
    const aCount = v.filter(x => x.winner === 'A').length;
    const t = tallyBlind({ key, verdicts: v, summary: rows() });
    expect(t[0]!.aPositionRate).toBeCloseTo(aCount / v.length);
  });

  it('verdicts print the provisional note', () => {
    const v = [...verdictsFor(key, 'agent / m:off', 'win'), ...verdictsFor(key, 'single / m:off', 'lose')];
    const tallies = tallyBlind({ key, verdicts: v, summary: rows() });
    const out = renderTally(tallies, { verdictCount: v.length, aPositionRate: null });
    expect(out.split(PROVISIONAL_NOTE).length - 1).toBe(tallies.length);
    expect(PROVISIONAL_NOTE).toBe('(provisional vs live: Terra single not yet run)');
  });
});
