import { describe, it, expect } from 'vitest';
import { buildInput, renderReport, compareFaculty } from '@/scripts/analysis/shortfall-trace/report';
import { analyze, type Depth } from '@/scripts/analysis/shortfall-trace/model';
import type { Extract } from '@/scripts/analysis/shortfall-trace/extract-build';

const D = (k: number | null, u: number | null, d: number | null): Depth => ({ k, u, d });
const extract: Extract = {
  rule: 'test rule', target: { id: 't', name: 'Target' }, path: ['GC 1', 'GC 2', 'GC 3'],
  competencies: [{ id: 'x', name: 'Color', foundational: false, weight: 0.5, basis: 'weight' }],
  courses: [
    { code: 'GC 1', title: 'One', captured: true, snapshotId: 'abcdef12-0000', snapshotCreatedAt: '2026-03-01T00:00:00Z', liveSnapshots: 1, note: null, depths: { x: { k: 1, u: 1, d: 1, method: 'scoring' } } },
    { code: 'GC 2', title: 'Two', captured: true, snapshotId: 'bbbbbbbb-0000', snapshotCreatedAt: '2026-03-01T00:00:00Z', liveSnapshots: 2, note: null, depths: { x: { k: 3, u: 3, d: 3, method: 'faculty' } } },
    { code: 'GC 3', title: 'Three', captured: false, snapshotId: null, snapshotCreatedAt: null, liveSnapshots: 0, note: 'no live snapshot', depths: {} },
  ],
  prereqs: [],
};
const link = { later: 'GC 2', earlier: 'GC 1', competency: 'x', expected: D(2, 2, 2) };

describe('buildInput', () => {
  it('turns the extract and worksheet into a trace input; uncaptured courses are not captured', () => {
    const inp = buildInput(extract, { x: D(4, 4, 4) }, [link]);
    expect(inp.courses).toEqual(['GC 1', 'GC 2', 'GC 3']);
    expect(inp.captured).toEqual({ 'GC 1': true, 'GC 2': true, 'GC 3': false });
    expect(inp.exits['GC 2']!['x']).toEqual(D(3, 3, 3));
    expect(inp.competencies[0]).toEqual({ id: 'x', foundational: false, weight: 0.5 });
  });
});

describe('renderReport', () => {
  const inp = buildInput(extract, { x: D(4, 4, 4) }, [link]);
  const run = { name: 'Dry run', input: inp, analysis: analyze(inp), warnings: [] as string[] };

  it('starts with the synthetic line when asked, and labels uncaptured values', () => {
    const md = renderReport(extract, [run], { synthetic: true });
    expect(md.split('\n')[0]).toMatch(/^SYNTHETIC/);
    expect(md).toMatch(/not captured/);
    expect(md).toMatch(/captured snapshot/);
    expect(md).toMatch(/What this target loses without the course/);
    expect(md).toMatch(/80%/);
  });

  it('has no synthetic line for real worksheets', () => {
    expect(renderReport(extract, [run], { synthetic: false }).split('\n')[0]).not.toMatch(/SYNTHETIC/);
  });
});

describe('compareFaculty', () => {
  it('reports shortfalls and fix sets that one faculty member has and the other does not, never an average', () => {
    const a = analyze(buildInput(extract, { x: D(4, 4, 4) }, [link]));
    const b = analyze(buildInput(extract, { x: D(2, 2, 2) }, [link]));
    const lines = compareFaculty([{ name: 'A', analysis: a }, { name: 'B', analysis: b }]).join('\n');
    expect(lines).toMatch(/x D/);
    expect(lines).toMatch(/A: gap/);
    expect(lines).toMatch(/B: no shortfall/);
  });
  it('says so when the two agree', () => {
    const a = analyze(buildInput(extract, { x: D(4, 4, 4) }, [link]));
    expect(compareFaculty([{ name: 'A', analysis: a }, { name: 'B', analysis: a }]).join('\n')).toMatch(/identical/);
  });
});
