import { describe, it, expect } from 'vitest';
import {
  runCell, exitsFor, analyze, creditView, gateComparison,
  type TraceInput, type Depth,
} from '@/scripts/analysis/shortfall-trace/model';

const D = (k: number | null, u: number | null, d: number | null): Depth => ({ k, u, d });
const label = (steps: Array<{ course: string; count: number }>) => steps.map(t => `${t.course}+${t.count}`).join(',');

/** A -> B -> C, one competency "x", every course captured unless said otherwise. */
function chain(over: Partial<TraceInput> = {}): TraceInput {
  return {
    courses: ['A', 'B', 'C'],
    competencies: [{ id: 'x', foundational: false, weight: 0.5 }],
    exits: { A: { x: D(1, 1, 1) }, B: { x: D(3, 3, 3) }, C: { x: D(0, 0, 0) } },
    captured: { A: true, B: true, C: true },
    links: [
      { later: 'B', earlier: 'A', competency: 'x', expected: D(2, 2, 2) },
      { later: 'C', earlier: 'B', competency: 'x', expected: D(null, null, null) },
    ],
    required: { x: D(4, 4, 4) },
    ...over,
  };
}
const run = (inp: TraceInput, gate: 'a' | 'b' | 'c', dim: 'k' | 'u' | 'd' = 'd') =>
  runCell(inp.courses, inp.links.filter(l => l.competency === 'x'), exitsFor(inp, 'x', dim), dim, gate);

describe('forward model', () => {
  it('with no links the program level is the plain maximum exit', () => {
    const r = run(chain({ links: [] }), 'b');
    expect(r.attained).toBe(3);
    expect(r.rows.map(x => x.arrival)).toEqual([0, 0, 0]);
    expect(r.rows.map(x => x.carried)).toEqual([1, 3, 0]);
  });

  it('gate a ignores the shortfall, b loses one level per level short, c delivers nothing above arrival', () => {
    // A leaves 1; B expects 2 incoming, so B is short 1; B exits 3.
    const a = run(chain(), 'a').rows[1]!;
    const b = run(chain(), 'b').rows[1]!;
    const c = run(chain(), 'c').rows[1]!;
    expect([a.arrival, a.short, a.delivered]).toEqual([1, 1, 3]);
    expect(b.delivered).toBe(2);
    expect(c.delivered).toBe(1);
  });

  it('carried never fades: a later course with exit 0 still carries what arrived', () => {
    const r = run(chain(), 'b');
    expect(r.rows[2]!.arrival).toBe(2);
    expect(r.rows[2]!.carried).toBe(2);
    expect(r.attained).toBe(2);
  });

  it('arrival is the max over real predecessors and short the max over real links', () => {
    const inp = chain({
      courses: ['A', 'A2', 'B'],
      exits: { A: { x: D(0, 0, 1) }, A2: { x: D(0, 0, 4) }, B: { x: D(0, 0, 5) } },
      captured: { A: true, A2: true, B: true },
      links: [
        { later: 'B', earlier: 'A', competency: 'x', expected: D(0, 0, 3) },
        { later: 'B', earlier: 'A2', competency: 'x', expected: D(0, 0, 2) },
      ],
    });
    const b = run(inp, 'b').rows[2]!;
    expect(b.arrival).toBe(4);
    expect(b.short).toBe(0); // arrival 4 meets both expectations
    expect(b.delivered).toBe(5);
    const low = { ...inp, exits: { A: { x: D(0, 0, 1) }, A2: { x: D(0, 0, 2) }, B: { x: D(0, 0, 5) } } };
    const lowRow = run(low, 'b').rows[2]!;
    expect([lowRow.arrival, lowRow.short, lowRow.delivered]).toEqual([2, 1, 4]); // short against the A link (3 - 2)
  });

  it('a blank expectation counts as 0 and a missing link means no gate', () => {
    const r = run(chain({ links: [{ later: 'B', earlier: 'A', competency: 'x', expected: D(null, null, null) }] }), 'c');
    expect(r.rows[1]!.short).toBe(0);
    expect(r.rows[1]!.delivered).toBe(3);
  });

  it('an unknown exit (uncaptured or missing) counts as 0 and is flagged', () => {
    const inp = chain({ captured: { A: true, B: false, C: true } });
    const r = run(inp, 'b');
    expect(r.rows[1]!.exit).toBe(0);
    expect(r.rows[1]!.unknown).toBe(true);
    expect(r.rows[0]!.unknown).toBe(false);
    const missing = chain({ exits: { A: { x: D(1, 1, 1) }, B: {}, C: { x: D(0, 0, 0) } } });
    expect(run(missing, 'b').rows[1]!.unknown).toBe(true);
  });

  it('clamps values to 0-5', () => {
    const inp = chain({ exits: { A: { x: D(9, 9, 9) }, B: { x: D(-2, -2, -2) }, C: { x: D(0, 0, 0) } }, links: [] });
    expect(run(inp, 'a').rows.map(r => r.exit)).toEqual([5, 0, 0]);
  });
});

describe('shortfalls', () => {
  it('reports required minus attained, only where positive, with the chain feeding the peak course', () => {
    const r = analyze(chain({ required: { x: D(null, null, 4) } }));
    expect(r.shortfalls).toHaveLength(1);
    const s = r.shortfalls[0]!;
    expect([s.competency, s.dim, s.required, s.attained, s.gap]).toEqual(['x', 'd', 4, 2, 2]);
    expect(s.peakCourse).toBe('B');
    expect(s.chain).toEqual(['A', 'B']);
  });

  it('a blank required depth is no requirement', () => {
    expect(analyze(chain({ required: { x: D(null, null, null) } })).shortfalls).toEqual([]);
    expect(analyze(chain({ required: {} })).shortfalls).toEqual([]);
  });

  it('foundational competencies are judged on D only, K and U ignored, links ignored', () => {
    const inp = chain({ competencies: [{ id: 'x', foundational: true, weight: 1 }], required: { x: D(5, 5, 4) } });
    const r = analyze(inp);
    expect(r.shortfalls.map(s => s.dim)).toEqual(['d']);
    // links are dropped for a foundational competency: attained is the plain max exit (3), not the gated 2
    expect(r.shortfalls[0]!.attained).toBe(3);
  });
});

describe('what-ifs and minimal fix sets', () => {
  it('single what-ifs list every +1 that shrinks the gap, and mark the ones that close it', () => {
    // attained 2 (B delivers 2 under b), need 3.
    const s = analyze(chain({ required: { x: D(null, null, 3) } })).shortfalls[0]!;
    // +1 on A: arrival 2, B not short, delivers 3. +1 on B: delivers 3. +1 on C: changes nothing.
    expect(s.singles.filter(x => x.closes).map(x => x.course).sort()).toEqual(['A', 'B']);
    expect(s.singles.find(x => x.course === 'C')).toBeUndefined();
  });

  it('lists every minimal fix set, no single winner, no non-minimal supersets', () => {
    const s = analyze(chain({ required: { x: D(null, null, 3) } })).shortfalls[0]!;
    expect(s.fixSets.map(f => label(f.steps)).sort()).toEqual(['A+1', 'B+1', 'C+3']); // C has no link, so C+3 alone reaches 3
  });

  it('allows repeated steps on one cell and finds a pair when no single step works', () => {
    // Need 5, attained 2. B+2 gives exit 5 but B is still short 1 (delivers 4); A+1 removes the shortfall.
    const s = analyze(chain({ required: { x: D(null, null, 5) } })).shortfalls[0]!;
    const sets = s.fixSets.map(f => label(f.steps)).sort();
    expect(sets).toContain('A+1,B+2');
    expect(s.fixSets.every(f => f.size <= 3)).toBe(true);
    expect(s.fixSets.every(f => f.size === f.steps.reduce((n, t) => n + t.count, 0))).toBe(true);
  });

  it('says so when nothing closes within three steps', () => {
    const z = D(0, 0, 0);
    const s = analyze(chain({ exits: { A: { x: z }, B: { x: z }, C: { x: z } }, links: [], required: { x: D(null, null, 5) } })).shortfalls[0]!;
    expect(s.fixSets).toEqual([]);
    expect(s.noFixWithinThree).toBe(true);
  });

  it('labels a fix that touches an uncaptured course as unverified', () => {
    const inp = chain({
      captured: { A: true, B: true, C: false }, exits: { A: { x: D(1, 1, 1) }, B: { x: D(2, 2, 2) }, C: {} },
      links: [], required: { x: D(null, null, 3) },
    });
    const s = analyze(inp).shortfalls[0]!;
    const byLabel = Object.fromEntries(s.fixSets.map(f => [label(f.steps), f]));
    expect(Object.keys(byLabel).sort()).toEqual(['A+2', 'B+1', 'C+3']);
    expect(byLabel['B+1']!.unverified).toBe(false);
    expect(byLabel['C+3']!.unverified).toBe(true);
  });
});

describe('robustness', () => {
  it('reruns every minimal set under the three gates and counts one-level perturbations under gate b', () => {
    const s = analyze(chain({ required: { x: D(null, null, 3) } })).shortfalls[0]!;
    const a = s.fixSets.find(f => label(f.steps) === 'A+1')!;
    const b = s.fixSets.find(f => label(f.steps) === 'B+1')!;
    // B+1 under gate a: attained is max exit, B 3 -> 4 closes. Under c: B delivers min(4, arrival 1) = 1: does not close.
    expect(b.variants).toEqual({ a: true, b: true, c: false });
    expect(b.variantsClosed).toBe(2);
    // A+1 under c: arrival 2, no short, B delivers 3: closes in all three.
    expect(a.variants).toEqual({ a: true, b: true, c: true });
    // perturbations: 3 captured cells x 2 directions, minus clamped ones (C exit 0 cannot go down) = 5
    expect(a.perturbTotal).toBe(5);
    expect(a.perturbClosed).toBeGreaterThanOrEqual(0);
    expect(a.perturbClosed).toBeLessThanOrEqual(5);
    expect(a.perturbFraction).toBeCloseTo(a.perturbClosed / 5, 10);
  });

  it('holds only with at least 2 of 3 gate variants and at least 80% of perturbations', () => {
    const s = analyze(chain({ required: { x: D(null, null, 3) } })).shortfalls[0]!;
    for (const f of s.fixSets) {
      expect(f.holds).toBe(f.variantsClosed >= 2 && (f.perturbFraction ?? 0) >= 0.8);
    }
  });

  it('does not perturb unknown (uncaptured) values', () => {
    const inp = chain({ captured: { A: true, B: true, C: false }, exits: { A: { x: D(1, 1, 1) }, B: { x: D(2, 2, 2) }, C: {} },
      links: [], required: { x: D(null, null, 3) } });
    const f = analyze(inp).shortfalls[0]!.fixSets[0]!;
    expect(f.perturbTotal).toBe(4); // A and B, up and down
  });
});

describe('credit view and gate comparison', () => {
  it('removing a course lets students pass through and reports the drop in attained, weighted', () => {
    const inp = chain();
    const c = creditView(inp, 'b');
    const rowB = c.find(r => r.course === 'B')!;
    // Without B: A leaves 1, B passes through (carried = arrival = 1), C arrival 1 -> attained 1. Baseline 2.
    expect(rowB.drops.find(d => d.competency === 'x' && d.dim === 'd')!.drop).toBe(1);
    const rowA = c.find(r => r.course === 'A')!;
    // Without A: B arrival 0, short 2, delivers max(0, 3-2)=1 -> attained 1: drop 1.
    expect(rowA.drops.find(d => d.dim === 'd')!.drop).toBe(1);
    // weight 0.5 x drops summed over k, u, d: B loses 1 on each dim = 3 x 0.5
    expect(rowB.weightedTotal).toBeCloseTo(1.5, 10);
    const rowC = c.find(r => r.course === 'C')!;
    expect(rowC.weightedTotal).toBe(0);
  });

  it('lists the shortfalls each gate shows and flags where the gate changes the answer', () => {
    const g = gateComparison(chain({ required: { x: D(null, null, 3) } }));
    const row = g.find(r => r.competency === 'x' && r.dim === 'd')!;
    expect([row.attained.a, row.attained.b, row.attained.c]).toEqual([3, 2, 1]);
    expect([row.gap.a, row.gap.b, row.gap.c]).toEqual([0, 1, 2]);
    expect(row.differs).toBe(true);
  });
});
