import { describe, it, expect, vi } from 'vitest';

const noopInsert = { onConflictDoUpdate: () => Promise.resolve(), onConflictDoNothing: () => Promise.resolve() };
const capturedValues: unknown[] = [];
let updateReturning: unknown[] = [];

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }), orderBy: () => [] }) }),
    insert: () => ({
      values: (v: unknown) => {
        capturedValues.push(v);
        return noopInsert;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updateReturning),
        }),
      }),
    }),
  },
}));

import { listCourses, getCourseByCode, upsertCourses, recordSyncResult, getSyncState, updateBuilderStatus, listApprovedCourses, createCourse, updateCourseClassification } from '@/lib/db/courses-queries';

describe('courses-queries module', () => {
  it('exports the expected functions', () => {
    expect(typeof listCourses).toBe('function');
    expect(typeof getCourseByCode).toBe('function');
    expect(typeof upsertCourses).toBe('function');
    expect(typeof recordSyncResult).toBe('function');
    expect(typeof getSyncState).toBe('function');
  });

  it('upsertCourses with empty array returns 0 without calling db', async () => {
    expect(await upsertCourses([])).toBe(0);
  });
});

describe('updateBuilderStatus', () => {
  it('exports the function', () => {
    expect(typeof updateBuilderStatus).toBe('function');
  });
});

describe('listApprovedCourses', () => {
  it('exports the function', () => {
    expect(typeof listApprovedCourses).toBe('function');
  });
});

describe('createCourse', () => {
  it('passes catalogUrl (trimmed) into the insert values payload', async () => {
    capturedValues.length = 0;
    await createCourse({ code: 'GC 1000', title: 'Test Course', catalogUrl: '  https://catalog.clemson.edu/gc1000  ' });
    expect(capturedValues).toHaveLength(1);
    const payload = capturedValues[0] as Record<string, unknown>;
    expect(payload.catalogUrl).toBe('https://catalog.clemson.edu/gc1000');
  });
});

describe('updateCourseClassification', () => {
  it('returns true when the mocked .returning() yields one row', async () => {
    updateReturning = [{ code: 'GC 1010' }];
    const result = await updateCourseClassification('GC 1010', { buildsToCareer: true });
    expect(result).toBe(true);
  });

  it('returns false when the mocked .returning() yields []', async () => {
    updateReturning = [];
    const result = await updateCourseClassification('GC 1010', { buildsToCareer: true });
    expect(result).toBe(false);
  });
});
