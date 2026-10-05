import { describe, it, expect, vi, beforeEach } from 'vitest';

const { selectLimit, updateSet, scrubForRecord } = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  updateSet: vi.fn(),
  scrubForRecord: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
    update: () => ({
      set: (patch: unknown) => {
        updateSet(patch);
        return { where: vi.fn(async () => undefined) };
      },
    }),
  },
}));
vi.mock('@/lib/privacy/scrub', () => ({ scrubForRecord }));

import { __mapMaterialRowForTest } from '@/lib/db/course-materials-queries';

beforeEach(() => {
  selectLimit.mockReset();
  updateSet.mockReset();
  scrubForRecord.mockReset();
});

describe('mapMaterialRow — redactions', () => {
  it('maps the redactions column and defaults a missing value to null', () => {
    const base = { id: 'a', course_code: 'GC 1010', file_name: 'f', extracted_text: 'x' };
    const red = { counts: { 'student-name': 2 }, failedReason: null };
    expect(__mapMaterialRowForTest({ ...base, redactions: red }).redactions).toEqual(red);
    expect(__mapMaterialRowForTest(base).redactions).toBeNull();
  });
});
