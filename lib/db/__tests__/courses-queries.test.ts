import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }), orderBy: () => [] }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
  },
}));

import { listCourses, getCourseByCode, upsertCourses, recordSyncResult, getSyncState, updateBuilderStatus, listApprovedCourses } from '@/lib/db/courses-queries';

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
