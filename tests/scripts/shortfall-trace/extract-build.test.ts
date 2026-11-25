import { describe, it, expect } from 'vitest';
import { buildExtract, type RawRows } from '@/scripts/analysis/shortfall-trace/extract-build';

const raw = (over: Partial<RawRows> = {}): RawRows => ({
  target: { id: 'prod', name: 'Production' },
  path: ['GC 1', 'GC 2', 'GC 3'],
  competencies: [
    { id: 'c1', name: 'Color', foundational: false, weight: 0.7, basis: 'weight' },
    { id: 'f1', name: 'Detail', foundational: true, weight: 0.9, basis: 'weight' },
  ],
  titles: { 'GC 1': 'One', 'GC 2': 'Two', 'GC 3': 'Three' },
  snapshots: [
    { id: 's1-old', course: 'GC 1', instructor: 'A', createdAt: '2026-01-01T00:00:00Z' },
    { id: 's1-new', course: 'GC 1', instructor: 'A', createdAt: '2026-03-01T00:00:00Z' },
    { id: 's2-unscored', course: 'GC 2', instructor: 'A', createdAt: '2026-03-01T00:00:00Z' },
  ],
  scored: ['s1-old', 's1-new'],
  levels: [
    { snapshotId: 's1-old', competencyId: 'c1', k: 1, u: 1, d: 1, method: 'scoring' },
    { snapshotId: 's1-new', competencyId: 'c1', k: 3, u: 2, d: 4, method: 'faculty' },
    { snapshotId: 's1-new', competencyId: 'f1', k: 2, u: 2, d: 3, method: 'scoring' },
  ],
  prereqs: [{ course: 'GC 2', prereq: 'GC 1', kind: 'prereq' }, { course: 'GC 3', prereq: 'GC 2', kind: 'prereq' }, { course: 'GC 3', prereq: 'GC 9', kind: 'prereq' }],
  ...over,
});

describe('buildExtract', () => {
  it('uses the newest scored non-retired snapshot, not an older one', () => {
    const x = buildExtract(raw());
    const c1 = x.courses.find(c => c.code === 'GC 1')!;
    expect(c1.captured).toBe(true);
    expect(c1.snapshotId).toBe('s1-new');
    expect(c1.depths['c1']).toEqual({ k: 3, u: 2, d: 4, method: 'faculty' });
  });

  it('stores K and U as null for a foundational competency', () => {
    const c1 = buildExtract(raw()).courses.find(c => c.code === 'GC 1')!;
    expect(c1.depths['f1']).toEqual({ k: null, u: null, d: 3, method: 'scoring' });
  });

  it('a course with no scored live snapshot is not captured and has no depths, with the reason', () => {
    const x = buildExtract(raw());
    const c2 = x.courses.find(c => c.code === 'GC 2')!;
    expect([c2.captured, c2.snapshotId, c2.depths, c2.note]).toEqual([false, null, {}, 'a live snapshot exists but has no competency levels']);
    const c3 = x.courses.find(c => c.code === 'GC 3')!;
    expect([c3.captured, c3.note]).toEqual([false, 'no live snapshot']);
  });

  it('keeps only prerequisites among the path courses', () => {
    expect(buildExtract(raw()).prereqs).toEqual([
      { course: 'GC 2', prereq: 'GC 1', kind: 'prereq' }, { course: 'GC 3', prereq: 'GC 2', kind: 'prereq' },
    ]);
  });

  it('throws when the path is not in topological order of the catalog prerequisites', () => {
    expect(() => buildExtract(raw({ path: ['GC 2', 'GC 1', 'GC 3'] }))).toThrow(/topological/);
  });
});
