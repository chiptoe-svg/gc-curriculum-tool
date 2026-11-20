/**
 * planChangedRefresh: after the /program button scores stale snapshots, rebuild only what the new
 * scores changed (owner, 2026-11-19), not every program page once per scored snapshot.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/membership-queries', () => ({ readTargetCompetencyList: async () => [] }));
vi.mock('@/lib/db/client', () => ({ db: { select: vi.fn() } }));

import { planChangedRefresh, type RefreshInputs } from '../refresh-all';

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const inputs: RefreshInputs = {
  snapshots: [
    { id: 'a-new', courseCode: 'GC 1010', createdAt: d('2026-03-01') },
    { id: 'b-1', courseCode: 'GC 4800', createdAt: d('2026-02-01') },
    { id: 'c-new', courseCode: 'GC 3460', createdAt: d('2026-05-01') },
    { id: 'c-old', courseCode: 'GC 3460', createdAt: d('2026-04-01') },
  ],
  competencySlugs: ['comp-1', 'comp-2', 'comp-new'],
  targetSlugs: ['t-1', 't-2', 't-3'],
  hasProductiveFailure: true,
};
const listed = [
  { careerTargetId: 't-1', competencyId: 'comp-new' },
  { careerTargetId: 't-1', competencyId: 'comp-1' },
  { careerTargetId: 't-2', competencyId: 'comp-2' },
  { careerTargetId: 't-3', competencyId: 'comp-new' },
];

describe('planChangedRefresh', () => {
  it('plans the new competency page, the targets that list it, then the index', () => {
    const plan = planChangedRefresh(inputs, { competencyIds: ['comp-new'], courseSnapshotIds: [] }, listed);
    expect(plan.programPages.map(p => p.path)).toEqual([
      'competencies/comp-new.md', 'targets/t-1.md', 'targets/t-3.md', 'index.md',
    ]);
    expect(plan.programBatches.flat().map(p => p.path)).toEqual(plan.programPages.map(p => p.path));
    expect(plan.courses).toEqual([]);
  });

  it('plans a course page only when its LATEST snapshot came out above zero', () => {
    const plan = planChangedRefresh(inputs, { competencyIds: ['comp-new'], courseSnapshotIds: ['c-old', 'b-1'] }, listed);
    expect(plan.courses.map(c => [c.courseCode, c.snapshotId])).toEqual([['GC 4800', 'b-1']]);
  });

  it('keeps the full manifest so the index and pages can link every page', () => {
    const plan = planChangedRefresh(inputs, { competencyIds: ['comp-new'], courseSnapshotIds: [] }, listed);
    expect(plan.manifest.map(p => p.path)).toEqual(expect.arrayContaining([
      'courses/gc-1010.md', 'competencies/comp-1.md', 'targets/t-2.md', 'concepts/three-act-structure.md',
    ]));
  });

  it('plans nothing when nothing was scored', () => {
    const plan = planChangedRefresh(inputs, { competencyIds: [], courseSnapshotIds: [] }, listed);
    expect(plan.programPages).toEqual([]);
    expect(plan.programBatches).toEqual([]);
    expect(plan.courses).toEqual([]);
  });

  it('skips a scored competency that has no wiki page to generate (not listed by any target, no coverage)', () => {
    const plan = planChangedRefresh(inputs, { competencyIds: ['orphan'], courseSnapshotIds: ['a-new'] }, listed);
    expect(plan.programPages).toEqual([]);
    expect(plan.courses.map(c => c.courseCode)).toEqual(['GC 1010']);
  });
});
