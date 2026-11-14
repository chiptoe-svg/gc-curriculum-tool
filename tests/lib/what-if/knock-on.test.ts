import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeliveredAttainment, RelyEdge } from '@/lib/program/prereq-gaps';
import type { MatrixData } from '@/lib/db/program-coverage-queries';
import type { WhatIfProfile, WhatIfRating } from '@/lib/what-if/types';

type CoverageRow = { subCompetencyId: string; matchedCompetency: string | null; kDepth: number | null; uDepth: number | null; dDepth: number | null };
let coverageRows: CoverageRow[] = [];
vi.mock('@/lib/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: async () => coverageRows }) }) },
}));

import {
  resolveWhatIfDepths, laterCourseLines, earlierCourseLines, careerLines,
} from '@/lib/what-if/knock-on';

const label = (id: string) => `label:${id}`;
const del = (prereqCourseCode: string, subCompetencyId: string, d: number | null, basis: 'measured' | 'intended' = 'measured'): DeliveredAttainment =>
  ({ prereqCourseCode, subCompetencyId, k: null, u: null, d, basis });
const edge = (prereqCourseCode: string, subCompetencyId = 'color-management', expectedD = 3): RelyEdge =>
  ({ prereqCourseCode, subCompetencyId, expectedK: null, expectedU: null, expectedD });
const pred = (d: number | null, subCompetencyId = 'color-management') => ({ subCompetencyId, k: null, u: null, d });

describe('laterCourseLines', () => {
  const base = { focalCourseCode: 'GC 3400', label };

  it('reports a gap the change would open', () => {
    const out = laterCourseLines({
      ...base, focalBaseline: [del('GC 3400', 'color-management', 3)], predicted: [pred(1)],
      perCourse: [{ courseCode: 'GC 4400', edges: [edge('GC 3400')], delivered: [del('GC 3400', 'color-management', 3)] }],
    });
    expect(out).toEqual([{ courseCode: 'GC 4400', subCompetencyId: 'color-management', effect: 'opened', label: 'label:color-management' }]);
  });

  it('does not report an opened gap when another prerequisite still delivers it', () => {
    const out = laterCourseLines({
      ...base, focalBaseline: [del('GC 3400', 'color-management', 3)], predicted: [pred(1)],
      perCourse: [{
        courseCode: 'GC 4400', edges: [edge('GC 3400'), edge('GC 2400')],
        delivered: [del('GC 3400', 'color-management', 3), del('GC 2400', 'color-management', 3)],
      }],
    });
    expect(out).toEqual([]);
  });

  it('reports a gap the change would close', () => {
    const out = laterCourseLines({
      ...base, focalBaseline: [del('GC 3400', 'color-management', 1)], predicted: [pred(3)],
      perCourse: [{ courseCode: 'GC 4400', edges: [edge('GC 3400')], delivered: [del('GC 3400', 'color-management', 1)] }],
    });
    expect(out).toEqual([{ courseCode: 'GC 4400', subCompetencyId: 'color-management', effect: 'closed', label: 'label:color-management' }]);
  });

  it('never reports "opened" when there was no data before', () => {
    const out = laterCourseLines({
      ...base, focalBaseline: [], predicted: [pred(1)],
      perCourse: [{ courseCode: 'GC 4400', edges: [edge('GC 3400')], delivered: [] }],
    });
    expect(out).toEqual([]);
  });

  it('uses the predicted row instead of every focal row for that sub-competency', () => {
    const rows = [del('GC 3400', 'color-management', 3), del('GC 3400', 'color-management', 4)];
    const out = laterCourseLines({
      ...base, focalBaseline: rows, predicted: [pred(1)],
      perCourse: [{ courseCode: 'GC 4400', edges: [edge('GC 3400')], delivered: rows }],
    });
    expect(out.map(l => l.effect)).toEqual(['opened']);
  });

  it('takes the focal rows from the base snapshot, not from the loaded rows', () => {
    // loaded rows say D1 (a newer snapshot); the base snapshot says D3
    const out = laterCourseLines({
      ...base, focalBaseline: [del('GC 3400', 'color-management', 3)], predicted: [pred(1)],
      perCourse: [{ courseCode: 'GC 4400', edges: [edge('GC 3400')], delivered: [del('GC 3400', 'color-management', 1)] }],
    });
    expect(out.map(l => l.effect)).toEqual(['opened']);
  });
});

describe('earlierCourseLines', () => {
  const change = (o: Partial<WhatIfProfile['incomingChanges'][number]>): WhatIfProfile['incomingChanges'][number] =>
    ({ kind: 'new', statement: 'Reads a proof', expected: { k: null, u: null, d: 2 }, subCompetencyId: 'color-management', linked: true, ...o });
  const run = (incomingChanges: WhatIfProfile['incomingChanges'], delivered: DeliveredAttainment[], prereqCodes = ['GC 1040']) =>
    earlierCourseLines({ incomingChanges, prereqCodes, delivered, label });

  it('is met when an earlier course delivers it', () => {
    expect(run([change({})], [del('GC 1040', 'color-management', 3)])).toEqual([
      { statement: 'Reads a proof', label: 'label:color-management', status: 'met', deliveredBy: ['GC 1040'] },
    ]);
  });
  it('is not met when delivered below the expectation', () => {
    const [l] = run([change({})], [del('GC 1040', 'color-management', 1)]);
    expect(l).toMatchObject({ status: 'not_met', deliveredBy: [] });
  });
  it('is not known with no row', () => {
    expect(run([change({})], [])[0]).toMatchObject({ status: 'not_known', deliveredBy: [] });
  });
  it('is not known, without a label, when the change is not linked', () => {
    expect(run([change({ linked: false, subCompetencyId: null })], [del('GC 1040', 'color-management', 3)])).toEqual([
      { statement: 'Reads a proof', label: null, status: 'not_known', deliveredBy: [] },
    ]);
  });
  it('lists only the courses that meet it', () => {
    const [l] = run([change({ kind: 'raised' })], [del('GC 1040', 'color-management', 3), del('GC 1020', 'color-management', 1)], ['GC 1040', 'GC 1020']);
    expect(l).toMatchObject({ status: 'met', deliveredBy: ['GC 1040'] });
  });
  it('ignores a dropped expectation', () => {
    expect(run([change({ kind: 'dropped' })], [del('GC 1040', 'color-management', 3)])).toEqual([]);
  });
});

describe('careerLines', () => {
  const matrix = (dDepth: number): MatrixData => ({
    targets: [{ id: 't1', name: 'Prepress Lead', displayOrder: 0 }],
    subCompetencies: [{ id: 'color-management', name: 'Color management' }],
    cells: [
      { snapshotId: 'snap-1', careerTargetId: 't1', subCompetencyId: 'color-management', dDepth },
      { snapshotId: 'other', careerTargetId: 't1', subCompetencyId: 'color-management', dDepth: 0 },
    ],
  } as unknown as MatrixData);

  it('reports a move down', () => {
    expect(careerLines({ focalSnapshotId: 'snap-1', predicted: [pred(1)], matrix: matrix(4) })).toEqual([
      { targetName: 'Prepress Lead', label: 'Color management', before: 'high (4–5)', after: 'low (1–2)', direction: 'down' },
    ]);
  });
  it('reports a move up', () => {
    const [l] = careerLines({ focalSnapshotId: 'snap-1', predicted: [pred(4)], matrix: matrix(1) });
    expect(l).toMatchObject({ direction: 'up', before: 'low (1–2)', after: 'high (4–5)' });
  });
  it('reports nothing inside one band', () => {
    expect(careerLines({ focalSnapshotId: 'snap-1', predicted: [pred(5)], matrix: matrix(4) })).toEqual([]);
  });
});

describe('resolveWhatIfDepths', () => {
  const rating = (o: Partial<WhatIfRating>): WhatIfRating => ({
    statement: 'Manage color', type: 'technical', status: 'moved', kud: { k: 2, u: 2, d: 4 },
    before: { k: 2, u: 2, d: 3 }, confidence: 'medium', reason: 'r', subCompetencyId: null, linked: false, ...o,
  });
  const profile = (ratings: WhatIfRating[]): WhatIfProfile => ({ ratings, incomingChanges: [] });

  beforeEach(() => { coverageRows = []; });
  const cov = (subCompetencyId: string, matchedCompetency: string, kDepth: number | null, uDepth: number | null, dDepth: number | null): CoverageRow =>
    ({ subCompetencyId, matchedCompetency, kDepth, uDepth, dDepth });
  const newLinked = (d: number, sub = 'color-management') =>
    rating({ status: 'new', before: null, statement: 'Brand new', kud: { k: null, u: null, d }, subCompetencyId: sub, linked: true });

  it('resolves a moved rating through the base snapshot coverage rows', async () => {
    coverageRows = [cov('color-management', '  manage   COLOR ', 2, 2, 3)];
    const r = await resolveWhatIfDepths('snap-1', profile([rating({})]));
    expect(r).toEqual({ resolved: [{ subCompetencyId: 'color-management', k: 2, u: 2, d: 4 }], notComputed: [] });
  });
  it('resolves a new linked rating through its sub-competency id', async () => {
    const r = await resolveWhatIfDepths('snap-1', profile([rating({ status: 'new', before: null, statement: 'Brand new', subCompetencyId: 'x-sub', linked: true })]));
    expect(r.resolved).toEqual([{ subCompetencyId: 'x-sub', k: 2, u: 2, d: 4 }]);
  });
  it('reports a moved rating with no coverage row and a new unlinked rating as not computed', async () => {
    const r = await resolveWhatIfDepths('snap-1', profile([
      rating({ statement: 'No coverage' }),
      rating({ status: 'new', before: null, statement: 'Unlinked new' }),
    ]));
    expect(r).toEqual({ resolved: [], notComputed: ['No coverage', 'Unlinked new'] });
  });
  it('gives one entry with the per-dimension maximum for a moved and a new rating on one sub-competency', async () => {
    coverageRows = [cov('color-management', 'Manage color', 1, null, 3)];
    const r = await resolveWhatIfDepths('snap-1', profile([
      rating({ kud: { k: 1, u: null, d: 2 }, before: { k: 1, u: null, d: 3 } }),
      rating({ status: 'new', before: null, statement: 'Brand new', kud: { k: 3, u: 2, d: 1 }, subCompetencyId: 'color-management', linked: true }),
    ]));
    expect(r.resolved).toEqual([{ subCompetencyId: 'color-management', k: 3, u: 2, d: 2 }]);
  });
  it('an approved statement counts at the coverage row depth, not its own (statement D2, coverage D3)', async () => {
    coverageRows = [cov('color-management', 'Manage color', null, null, 3)];
    const r = await resolveWhatIfDepths('snap-1', profile([
      rating({ status: 'approved', kud: { k: null, u: null, d: 2 }, before: { k: null, u: null, d: 2 } }),
      newLinked(1),
    ]));
    expect(r.resolved).toEqual([{ subCompetencyId: 'color-management', k: null, u: null, d: 3 }]);
  });
  it('an approved statement counts at the coverage row depth, not its own (statement D4, coverage D3)', async () => {
    coverageRows = [cov('color-management', 'Manage color', null, null, 3)];
    const r = await resolveWhatIfDepths('snap-1', profile([
      rating({ status: 'approved', kud: { k: null, u: null, d: 4 }, before: { k: null, u: null, d: 4 } }),
      newLinked(1),
    ]));
    expect(r.resolved).toEqual([{ subCompetencyId: 'color-management', k: null, u: null, d: 3 }]);
  });
  it('a moved statement keeps the coverage value on the dimensions it did not change', async () => {
    coverageRows = [cov('color-management', 'Manage color', 2, 2, 3)];
    const r = await resolveWhatIfDepths('snap-1', profile([
      rating({ kud: { k: 3, u: 3, d: 1 }, before: { k: 3, u: 3, d: 3 } }),
    ]));
    expect(r.resolved).toEqual([{ subCompetencyId: 'color-management', k: 2, u: 2, d: 1 }]);
  });
  it('gives an approved statement alone no entry of its own', async () => {
    coverageRows = [
      cov('color-management', 'Manage color', null, null, 3),
      cov('other-sub', 'Other thing', null, null, 3),
    ];
    const r = await resolveWhatIfDepths('snap-1', profile([
      rating({ status: 'approved', statement: 'Other thing' }),
      newLinked(1),
    ]));
    expect(r.resolved.map(e => e.subCompetencyId)).toEqual(['color-management']);
  });
  it('does not resolve approved ratings', async () => {
    coverageRows = [cov('color-management', 'Manage color', 2, 2, 3)];
    const r = await resolveWhatIfDepths('snap-1', profile([rating({ status: 'approved' })]));
    expect(r).toEqual({ resolved: [], notComputed: [] });
  });
});
