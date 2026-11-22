import { describe, it, expect } from 'vitest';
import { assertSafeDb, checkCreditCeiling, pendingKeys, assertNoPaidKey, scrubPaidKey, assertPaidArgs, makeBlindPairs, keyId } from '@/scripts/bench/agent-judge';

describe('assertSafeDb', () => {
  it('rejects live and accepts bench/scratch', () => {
    expect(() => assertSafeDb('postgres://u:p@127.0.0.1:5433/gc_curriculum')).toThrow();
    expect(() => assertSafeDb('postgres://u:p@127.0.0.1:5433/gc_curriculum?sslmode=x')).toThrow();
    expect(() => assertSafeDb('')).toThrow();
    expect(() => assertSafeDb('postgres://u:p@h:5433/gc_curriculum_bench')).not.toThrow();
    expect(() => assertSafeDb('postgres://u:p@h:5433/gc_curriculum_builder_scratch?x=1')).not.toThrow();
  });
});
describe('paid guards', () => {
  it('a set key throws without --paid', () => {
    expect(() => assertNoPaidKey({ OPENAI_API_KEY: 'sk-x' }, false)).toThrow();
    expect(() => assertNoPaidKey({ OPENAI_API_KEY: 'sk-x' }, true)).not.toThrow();
  });
  it('campus mode scrubs the key so a paid call is impossible', () => {
    const env: Record<string, string | undefined> = { OPENAI_API_KEY: 'sk-x' };
    expect(scrubPaidKey(env, false)).toBe(true);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(() => assertNoPaidKey(env, false)).not.toThrow();
  });
  it('--paid without --max-credits throws', () => {
    expect(() => assertPaidArgs(true, null)).toThrow();
    expect(() => assertPaidArgs(true, 5)).not.toThrow();
    expect(() => assertPaidArgs(false, null)).not.toThrow();
  });
});
describe('checkCreditCeiling', () => {
  it('throws once spent exceeds max', () => {
    expect(() => checkCreditCeiling(5, 5)).not.toThrow();
    expect(() => checkCreditCeiling(5.01, 5)).toThrow();
    expect(() => checkCreditCeiling(99, null)).not.toThrow();
  });
});
describe('pendingKeys', () => {
  it('skips finished keys', () => {
    const a = { model: 'm', arm: 'single', course: 'GC 1', run: 1 }, b = { ...a, run: 2 };
    expect(pendingKeys([a, b], [keyId(a)])).toEqual([b]);
    expect(pendingKeys([a, b], [a])).toEqual([b]);
  });
});
describe('makeBlindPairs', () => {
  const cell = (d: number) => ({ sub: 's', k: 1, u: 0, d, excerpt: 'x' });
  const inputs = Array.from({ length: 40 }, (_, i) => ({ course: 'GC 1', sub: `s${i}`, baseline: cell(1), candidates: [{ label: 'agent', cell: cell(2) }] }));
  it('is reproducible for a seed and randomizes A/B', () => {
    const a = makeBlindPairs(inputs, 7), b = makeBlindPairs(inputs, 7), c = makeBlindPairs(inputs, 8);
    expect(a).toEqual(b);
    expect(c.key).not.toEqual(a.key);
    const aIsBase = Object.values(a.key).filter(k => k.A === 'baseline').length;
    expect(aIsBase).toBeGreaterThan(5); expect(aIsBase).toBeLessThan(35);
    expect(JSON.stringify(a.pairs)).not.toContain('baseline');
  });
});

import { summarizeArm } from '@/scripts/bench/agent-judge';
describe('summarizeArm', () => {
  const profile = 'Students build a poster brief for the client every term in studio.';
  const cell = (excerpt: string, d = 2, sub = 's') => ({ sub, k: null, u: null, d, excerpt });
  const base = (runs: Array<{ cells: ReturnType<typeof cell>[]; retrieved: Array<{ id: string; text: string }> }>) =>
    summarizeArm([{ course: 'GC 1', subs: ['s'], profile, runs }]);

  it('an excerpt found only in a retrieved chunk is grounded and not a break', () => {
    const r = base([{ cells: [cell('kerning accuracy counts for twenty points')], retrieved: [{ id: 'c', text: 'Rubric: kerning accuracy counts for twenty points.' }] }]);
    expect(r.breaks).toBe(0); expect(r.groundedRetrieved).toBe(1); expect(r.groundedProfile).toBe(0);
  });
  it('an excerpt in the profile counts as profile-grounded', () => {
    const r = base([{ cells: [cell('poster brief for the client every term')], retrieved: [] }]);
    expect(r.breaks).toBe(0); expect(r.groundedProfile).toBe(1);
  });
  it('an excerpt found nowhere is a break', () => {
    const r = base([{ cells: [cell('invented sentence found nowhere at all')], retrieved: [{ id: 'c', text: 'other' }] }]);
    expect(r.breaks).toBe(1); expect(r.above).toBe(1);
  });
  it('stability averages over cells across 2+ runs', () => {
    const r = base([{ cells: [cell('poster brief for the client every term', 2)], retrieved: [] }, { cells: [cell('poster brief for the client every term', 5)], retrieved: [] }]);
    expect(r.stability).toBeCloseTo(2 / 3); // k,u both null=none agree; d band differs
    expect(base([{ cells: [cell('x', 2)], retrieved: [] }]).stability).toBeNaN();
  });
});
