import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbInsertOnConflict = vi.fn();
const dbInsertReturning = vi.fn();
const dbUpdateWhere = vi.fn();
const dbSelectFromWhere = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: dbInsertReturning,
        onConflictDoUpdate: () => dbInsertOnConflict(),
      }),
    }),
    update: () => ({ set: () => ({ where: dbUpdateWhere }) }),
    select: () => ({ from: () => ({ where: dbSelectFromWhere }) }),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  courseKuds: {},
  courseKudRuns: {},
}));

import {
  getCourseKud,
  insertKudRun,
  upsertCourseKud,
  saveKudDraft,
  acceptCourseKud,
  resetKudApproval,
  listKudRunsForCourse,
} from '@/lib/db/course-kud-queries';
import type { CourseKudResult } from '@/lib/domain/types';

beforeEach(() => vi.clearAllMocks());

const fakeResult: CourseKudResult = {
  thresholdConcept: 'Color is a physical interaction.',
  know: ['CMYK model', 'Halftone mechanics', 'Substrate compatibility'],
  understand: ['Why dot gain propagates', 'How adhesion works', 'Why process choice matters'],
  do: ['Select Pantone standard', 'Conduct testing', 'Interpret results'],
  confidenceNotes: 'Do bullets grounded in labs.',
};

describe('getCourseKud', () => {
  it('returns null when no record exists', async () => {
    dbSelectFromWhere.mockResolvedValue([]);
    expect(await getCourseKud('GC 3460')).toBeNull();
  });

  it('returns the kud row when it exists', async () => {
    const row = {
      courseCode: 'GC 3460',
      thresholdConcept: 'Color is physical.',
      know: [],
      understand: [],
      do: [],
      manuallyEdited: false,
      sourceRunId: null,
      approvedAt: null,
      approvedByIpHash: null,
      updatedAt: new Date(),
    };
    dbSelectFromWhere.mockResolvedValue([row]);
    const result = await getCourseKud('GC 3460');
    expect(result?.courseCode).toBe('GC 3460');
  });
});

describe('insertKudRun', () => {
  it('inserts a run row and returns the id', async () => {
    dbInsertReturning.mockResolvedValue([{ id: 'run-uuid-1' }]);
    const id = await insertKudRun({
      courseCode: 'GC 3460',
      result: fakeResult,
      profileSnapshot: { learningObjectives: [], majorProjects: [], skillsRequired: [] },
      model: 'claude-sonnet-4-6',
      costUsdCents: 12,
    });
    expect(id).toBe('run-uuid-1');
  });

  it('throws when no row returned', async () => {
    dbInsertReturning.mockResolvedValue([]);
    await expect(insertKudRun({
      courseCode: 'GC 3460',
      result: fakeResult,
      profileSnapshot: { learningObjectives: [], majorProjects: [], skillsRequired: [] },
      model: 'claude-sonnet-4-6',
      costUsdCents: 12,
    })).rejects.toThrow('insertKudRun: no row returned');
  });
});

describe('upsertCourseKud', () => {
  it('calls onConflictDoUpdate (upsert)', async () => {
    dbInsertOnConflict.mockResolvedValue(undefined);
    await upsertCourseKud({
      courseCode: 'GC 3460',
      thresholdConcept: fakeResult.thresholdConcept,
      know: fakeResult.know,
      understand: fakeResult.understand,
      do: fakeResult.do,
      sourceRunId: 'run-uuid-1',
    });
    expect(dbInsertOnConflict).toHaveBeenCalledTimes(1);
  });
});

describe('saveKudDraft', () => {
  it('updates the kud row', async () => {
    dbUpdateWhere.mockResolvedValue(undefined);
    await saveKudDraft({
      courseCode: 'GC 3460',
      thresholdConcept: 'Updated concept.',
      know: ['k1', 'k2', 'k3'],
      understand: ['u1', 'u2', 'u3'],
      do: ['d1', 'd2', 'd3'],
      manuallyEdited: true,
    });
    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
  });
});

describe('acceptCourseKud', () => {
  it('updates the row with approvedAt and ipHash', async () => {
    dbUpdateWhere.mockResolvedValue(undefined);
    await acceptCourseKud('GC 3460', new Date(), 'abc123hash');
    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
  });
});

describe('resetKudApproval', () => {
  it('clears approvedAt and approvedByIpHash', async () => {
    dbUpdateWhere.mockResolvedValue(undefined);
    await resetKudApproval('GC 3460');
    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
  });
});

describe('listKudRunsForCourse', () => {
  it('returns empty array when no runs exist', async () => {
    dbSelectFromWhere.mockReturnValue({ orderBy: () => Promise.resolve([]) });
    expect(await listKudRunsForCourse('GC 3460')).toEqual([]);
  });
});
