/**
 * Tests for the course-roster query helpers added to lib/db/courses-queries.ts:
 *   getCourseDataStates, bulkCreateCourses, createCourse, courseExists
 *
 * DB convention: mock @/lib/db/client (same as prerequisite-edge-queries.test.ts).
 * getCourseDataStates uses db.execute (raw SQL) — mock returns { rows: [...] }.
 * bulkCreateCourses / createCourse use insert + select chains.
 * courseExists uses select + from + where + limit chain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock state — set up before module import.
// ---------------------------------------------------------------------------

let executeMock = vi.fn();
// selectMock is called at the terminal step. Two select chains exist:
//   - courseExists:        .select().from().where().limit(n)  → selectLimitMock(n)
//   - bulkCreateCourses:   .select().from().where(inArray)    → selectWhereMock(arg)
// We use a single mock that is reused; each test configures it as needed.
let selectLimitMock = vi.fn();
let selectWhereMock = vi.fn();
let insertMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    // db.execute(sql`...`) — used by getCourseDataStates
    execute: (q: unknown) => executeMock(q),

    // select chain — two terminal shapes:
    //   .from().where().limit(n)   → courseExists
    //   .from().where(arg)         → bulkCreateCourses (where returns a Promise directly)
    select: () => ({
      from: () => ({
        where: (arg: unknown) => ({
          // courseExists calls .limit() on the where result
          limit: (n: number) => selectLimitMock(n),
          // bulkCreateCourses awaits where() directly (treated as a Promise via then)
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            selectWhereMock(arg).then(resolve, reject),
        }),
      }),
    }),

    // insert chain: .values().onConflictDoNothing()
    insert: () => ({
      values: (rows: unknown) => ({
        onConflictDoNothing: () => insertMock(rows),
      }),
    }),
  },
}));

// Import AFTER mock registration.
import {
  getCourseDataStates,
  bulkCreateCourses,
  createCourse,
  courseExists,
} from '@/lib/db/courses-queries';
import type { CourseDataState, CourseRosterRow } from '@/lib/db/courses-queries';

// ---------------------------------------------------------------------------

describe('getCourseDataStates', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('maps raw rows with measured when snapshot exists', async () => {
    executeMock.mockResolvedValue({
      rows: [
        { code: 'GC 3010', title: 'Typography', level: 3, prerequisites: 'GC 2010', data_state: 'measured' },
        { code: 'GC 2010', title: 'Design I', level: 2, prerequisites: '', data_state: 'no-data' },
      ],
    });
    const result = await getCourseDataStates();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      code: 'GC 3010',
      title: 'Typography',
      level: 3,
      prerequisites: 'GC 2010',
      dataState: 'measured',
    });
    expect(result[0]!.dataState).toBe('measured');
    expect(result[1]!.dataState).toBe('no-data');
  });

  it('returns empty array when no courses exist', async () => {
    executeMock.mockResolvedValue({ rows: [] });
    const result = await getCourseDataStates();
    expect(result).toEqual([]);
  });

  it('only produces measured or no-data (not intended)', async () => {
    executeMock.mockResolvedValue({
      rows: [
        { code: 'GC 4100', title: 'Adv Print', level: 4, prerequisites: '', data_state: 'measured' },
        { code: 'GC 1010', title: 'Intro GC', level: 1, prerequisites: '', data_state: 'no-data' },
      ],
    });
    const result = await getCourseDataStates();
    for (const row of result) {
      expect(['measured', 'no-data']).toContain(row.dataState);
    }
  });

  it('maps all required fields onto CourseRosterRow', async () => {
    executeMock.mockResolvedValue({
      rows: [
        { code: 'GC 4900', title: 'Senior Seminar', level: 4, prerequisites: 'GC 3900', data_state: 'no-data' },
      ],
    });
    const [row] = await getCourseDataStates();
    expect(row).toMatchObject({
      code: 'GC 4900',
      title: 'Senior Seminar',
      level: 4,
      prerequisites: 'GC 3900',
      dataState: 'no-data',
    });
  });
});

// ---------------------------------------------------------------------------

describe('bulkCreateCourses', () => {
  beforeEach(() => {
    selectWhereMock.mockReset();
    insertMock.mockReset().mockResolvedValue(undefined);
  });

  it('returns { created: [], skipped: [] } for empty input', async () => {
    const result = await bulkCreateCourses([]);
    expect(result).toEqual({ created: [], skipped: [] });
    expect(selectWhereMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('creates new courses and skips existing ones', async () => {
    // selectWhereMock simulates existing codes query — returns one existing row
    selectWhereMock.mockResolvedValue([{ code: 'GC 2010' }]);
    const result = await bulkCreateCourses([
      { code: 'GC 2010', title: 'Design I' },
      { code: 'GC 3010', title: 'Typography' },
    ]);
    expect(result.created).toEqual(['GC 3010']);
    expect(result.skipped).toEqual(['GC 2010']);
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it('skips all when all codes already exist', async () => {
    selectWhereMock.mockResolvedValue([{ code: 'GC 3010' }, { code: 'GC 4010' }]);
    const result = await bulkCreateCourses([
      { code: 'GC 3010', title: 'Typography' },
      { code: 'GC 4010', title: 'Senior Project' },
    ]);
    expect(result.created).toEqual([]);
    expect(result.skipped).toContain('GC 3010');
    expect(result.skipped).toContain('GC 4010');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('creates all when none exist', async () => {
    selectWhereMock.mockResolvedValue([]);
    const result = await bulkCreateCourses([
      { code: 'GC 1010', title: 'Foundations' },
      { code: 'GC 1020', title: 'Intro Print' },
    ]);
    expect(result.created).toEqual(['GC 1010', 'GC 1020']);
    expect(result.skipped).toEqual([]);
    expect(insertMock).toHaveBeenCalledTimes(2);
  });

  it('applies defaults for omitted optional fields (level, track, prerequisites)', async () => {
    selectWhereMock.mockResolvedValue([]);
    await bulkCreateCourses([{ code: 'GC 9999', title: 'Test Course' }]);
    expect(insertMock).toHaveBeenCalledOnce();
    const inserted = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted['level']).toBe(0);
    expect(inserted['track']).toBe('unspecified');
    expect(inserted['prerequisites']).toBe('');
  });

  it('trims whitespace from codes', async () => {
    selectWhereMock.mockResolvedValue([]);
    const result = await bulkCreateCourses([{ code: '  GC 1010  ', title: 'Foundations' }]);
    expect(result.created).toEqual(['GC 1010']);
  });
});

// ---------------------------------------------------------------------------

describe('createCourse', () => {
  beforeEach(() => {
    insertMock.mockReset().mockResolvedValue(undefined);
  });

  it('inserts a course with provided fields', async () => {
    await createCourse({ code: 'GC 4200', title: 'Package Design', level: 4, track: 'design' });
    expect(insertMock).toHaveBeenCalledOnce();
    const inserted = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted['code']).toBe('GC 4200');
    expect(inserted['title']).toBe('Package Design');
    expect(inserted['level']).toBe(4);
    expect(inserted['track']).toBe('design');
  });

  it('applies defaults when level/track/prerequisites are omitted', async () => {
    await createCourse({ code: 'GC 1111', title: 'Minimal' });
    const inserted = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted['level']).toBe(0);
    expect(inserted['track']).toBe('unspecified');
    expect(inserted['prerequisites']).toBe('');
  });

  it('trims code and title whitespace', async () => {
    await createCourse({ code: '  GC 2222  ', title: '  Trim Me  ' });
    const inserted = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted['code']).toBe('GC 2222');
    expect(inserted['title']).toBe('Trim Me');
  });
});

// ---------------------------------------------------------------------------

describe('courseExists', () => {
  beforeEach(() => {
    selectLimitMock.mockReset();
  });

  it('returns true when a row is found', async () => {
    selectLimitMock.mockResolvedValue([{ code: 'GC 3010' }]);
    expect(await courseExists('GC 3010')).toBe(true);
  });

  it('returns false when no row is found', async () => {
    selectLimitMock.mockResolvedValue([]);
    expect(await courseExists('GC 9999')).toBe(false);
  });
});
