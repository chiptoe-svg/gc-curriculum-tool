import { describe, it, expect } from 'vitest';
import { compareRuns, type DriftRun } from '@/scripts/reliability/bloom-drift-lib';

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
    expect(r2.compared).toEqual({ oldRuns: 1, newRuns: 2, courses: 1 });
  });
});
