import { describe, it, expect } from 'vitest';
import { compareRuns, mayCall, bloomShare, type DriftRun } from '@/scripts/reliability/bloom-drift-lib';

const cell = (k: number | null, u: number | null, d: number) => ({ competency: 'x', k, u, d });
const run = (course: string, r: number, label: string, cells: DriftRun['cells'], statements: string[] = []): DriftRun =>
  ({ course, run: r, label, cells, statements });

describe('compareRuns', () => {
  const base = [cell(2, 2, 3), cell(3, 1, 2)];
  it('identical runs give zeros', () => {
    const a = [run('A', 1, 'old', base), run('A', 2, 'old', base)];
    const b = [run('A', 1, 'new', base), run('A', 2, 'new', base)];
    const r = compareRuns(a, b);
    expect(r.withinNoise).toEqual({ k: 0, u: 0, d: 0 });
    expect(r.between).toEqual({ k: 0, u: 0, d: 0 });
    expect(r.meanShift).toEqual({ k: 0, u: 0, d: 0 });
  });
  it('a uniform +1 on every U cell gives meanShift.u === 1', () => {
    const up = base.map(c => ({ ...c, u: (c.u ?? 0) + 1 }));
    const r = compareRuns([run('A', 1, 'old', base)], [run('A', 1, 'new', up)]);
    expect(r.meanShift.u).toBe(1);
    expect(r.meanShift.k).toBe(0);
    expect(r.between.u).toBe(1);
  });
  it('ignores null K/U (foundational) in the means', () => {
    const r = compareRuns([run('A', 1, 'old', [cell(null, null, 2), cell(2, 2, 2)])], [run('A', 1, 'new', [cell(null, null, 2), cell(2, 2, 2)])]);
    expect(r.meanShift).toEqual({ k: 0, u: 0, d: 0 });
  });
  it('bloomShare counts statements with at least one process name, case-insensitive', () => {
    const r = compareRuns(
      [run('A', 1, 'old', base, ['Students make prints', 'Students Recall steps'])],
      [run('A', 1, 'new', base, ['Students explain why', 'Students critique layouts'])],
    );
    expect(r.bloomShare).toEqual({ old: 0.5, new: 1 });
  });
  it('withinNoise is the mean absolute difference between runs of the same version', () => {
    const hi = [cell(3, 3, 3)], lo = [cell(1, 1, 1)];
    const r = compareRuns([run('A', 1, 'old', hi), run('A', 2, 'old', lo)], [run('A', 1, 'new', hi), run('A', 2, 'new', lo)]);
    expect(r.withinNoise).toEqual({ k: 2, u: 2, d: 2 });
    expect(r.meanShift).toEqual({ k: 0, u: 0, d: 0 });
  });
  it('reports how many runs and courses were compared, so empty input cannot pass', () => {
    const r = compareRuns([], []);
    expect(r.compared).toEqual({ oldRuns: 0, newRuns: 0, courses: 0 });
    const r2 = compareRuns([run('A', 1, 'old', base)], [run('A', 1, 'new', base), run('B', 1, 'new', base)]);
    expect(r2.compared).toEqual({ oldRuns: 1, newRuns: 1, courses: 1 }); // course B is new-only, so it does not count
  });
});

describe('mayCall (paid-run ceiling)', () => {
  it('allows a call while spend plus the largest call so far stays under the cap', () => {
    expect(mayCall(0, 1.75, 0)).toBe(true);
    expect(mayCall(1.4, 1.75, 0.3)).toBe(true);
  });
  it('refuses once spend reaches the cap', () => {
    expect(mayCall(1.75, 1.75, 0.1)).toBe(false);
  });
  it('refuses when the largest call so far would cross the cap', () => {
    expect(mayCall(1.5, 1.75, 0.3)).toBe(false);
  });
  it('a null cap means a free run: always allowed', () => {
    expect(mayCall(99, null, 5)).toBe(true);
  });
});

describe('bloomShare matches verb forms, not look-alike nouns', () => {
  const r = (statements: string[]): DriftRun => ({ course: 'A', run: 1, label: 'x', cells: [], statements });
  it('does not count production, checklist, planographic, organization, generation', () => {
    expect(bloomShare([r(['Print production overview', 'Uses a checklist', 'Planographic printing', 'Team organization', 'Next-generation presses'])])).toBe(0);
  });
  it('counts real process verbs in any tense', () => {
    expect(bloomShare([r(['Students produce labels', 'Students planned a run', 'Students check proofs', 'Students organized files', 'Students generating ideas'])])).toBe(1);
  });
});

describe('compare counts only runs in courses on both sides', () => {
  const cell = { competency: 'x', k: 1, u: 1, d: 1 };
  const run = (course: string, label: string): DriftRun => ({ course, run: 1, label, cells: [cell], statements: [] });
  it('a course present on one side only does not count toward the minimum', () => {
    const r = compareRuns([run('A', 'old'), run('B', 'old')], [run('A', 'new')]);
    expect(r.compared).toEqual({ oldRuns: 1, newRuns: 1, courses: 1 });
  });
});

