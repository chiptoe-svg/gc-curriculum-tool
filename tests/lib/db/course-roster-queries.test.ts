/**
 * Tests for the course-roster query helpers added to lib/db/courses-queries.ts:
 *   getCourseDataStates, bulkCreateCourses, createCourse, courseExists,
 *   replaceIntendedCoverage, getIntendedCoverageForCourses
 *
 * DB convention: mock @/lib/db/client (same as prerequisite-edge-queries.test.ts).
 * getCourseDataStates / listUncapturedCourseCodes use db.execute (raw SQL).
 * bulkCreateCourses / createCourse use insert + select chains.
 * courseExists uses select + from + where + limit chain.
 * replaceIntendedCoverage uses db.transaction (callback receives a tx mock).
 * getIntendedCoverageForCourse / getIntendedCoverageForCourses use select chain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock state — set up before module import.
// ---------------------------------------------------------------------------

let executeMock = vi.fn();
// selectMock is called at the terminal step. Two select chains exist:
//   - courseExists:        .select().from().where().limit(n)  → selectLimitMock(n)
//   - bulkCreateCourses:   .select().from().where(arg)        → selectWhereMock(arg)
//   - getIntendedCoverageForCourse / getIntendedCoverageForCourses: .select().from().where(arg) → selectWhereMock(arg)
// We use a single mock that is reused; each test configures it as needed.
let selectLimitMock = vi.fn();
let selectWhereMock = vi.fn();
let insertMock = vi.fn();

// Transaction sub-mocks — expose the tx.delete and tx.insert calls
let txDeleteWhereMock = vi.fn();
let txInsertValuesMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    // db.execute(sql`...`) — used by getCourseDataStates, listUncapturedCourseCodes
    execute: (q: unknown) => executeMock(q),

    // select chain — two terminal shapes:
    //   .from().where().limit(n)   → courseExists
    //   .from().where(arg)         → bulkCreateCourses / getIntendedCoverageFor* (awaited directly)
    select: () => ({
      from: () => ({
        where: (arg: unknown) => ({
          // courseExists calls .limit() on the where result
          limit: (n: number) => selectLimitMock(n),
          // bulkCreateCourses / getIntendedCoverageFor* await where() directly (via then)
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

    // transaction: executes the callback with a tx object
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const tx: {
        delete: (t: unknown) => { where: (arg: unknown) => unknown };
        insert: (t: unknown) => { values: (rows: unknown) => unknown };
        transaction: (fn2: (b: unknown) => Promise<void>) => Promise<void>;
      } = {
        delete: () => ({
          where: (arg: unknown) => txDeleteWhereMock(arg),
        }),
        insert: () => ({
          values: (rows: unknown) => txInsertValuesMock(rows),
        }),
        // Nested transaction (SAVEPOINT) — execute the inner callback with a
        // sub-tx that shares the same mocks so insert/delete calls are captured.
        transaction: async (fn2: (b: unknown) => Promise<void>) => fn2(tx),
      };
      return fn(tx);
    },
  },
}));

// Import AFTER mock registration.
import {
  getCourseDataStates,
  bulkCreateCourses,
  createCourse,
  courseExists,
  replaceIntendedCoverage,
  getIntendedCoverageForCourses,
} from '@/lib/db/courses-queries';
import type { CourseDataState, CourseRosterRow, NewIntendedRow } from '@/lib/db/courses-queries';

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

  it('maps intended state when course_intended_coverage row exists and no snapshot', async () => {
    executeMock.mockResolvedValue({
      rows: [
        { code: 'GC 4100', title: 'Adv Print', level: 4, prerequisites: '', data_state: 'measured' },
        { code: 'GC 1010', title: 'Intro GC', level: 1, prerequisites: '', data_state: 'intended' },
        { code: 'GC 5000', title: 'Empty', level: 5, prerequisites: '', data_state: 'no-data' },
      ],
    });
    const result = await getCourseDataStates();
    expect(result[0]!.dataState).toBe('measured');
    expect(result[1]!.dataState).toBe('intended');
    expect(result[2]!.dataState).toBe('no-data');
  });

  it('measured wins over intended: snapshot present → measured, not intended', async () => {
    // The SQL CASE puts measured first — this test asserts the mapping is passed
    // through correctly (the precedence is enforced in SQL, not in the mapper).
    executeMock.mockResolvedValue({
      rows: [
        { code: 'GC 3010', title: 'Typography', level: 3, prerequisites: '', data_state: 'measured' },
      ],
    });
    const [row] = await getCourseDataStates();
    expect(row!.dataState).toBe('measured');
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

describe('replaceIntendedCoverage', () => {
  const MODEL = 'qwen3:14b';

  beforeEach(() => {
    txDeleteWhereMock.mockReset().mockResolvedValue(undefined);
    txInsertValuesMock.mockReset().mockResolvedValue(undefined);
  });

  it('issues a delete then an insert when rows are provided', async () => {
    const rows: NewIntendedRow[] = [
      { subCompetencyId: 'sub-1', intendedK: 2, intendedU: 2, intendedD: 1, confidence: 'medium', rationale: 'test' },
      { subCompetencyId: 'sub-2', intendedK: 1, intendedU: null, intendedD: null, confidence: 'low', rationale: 'thin' },
    ];
    await replaceIntendedCoverage('GC 3010', rows, MODEL);
    expect(txDeleteWhereMock).toHaveBeenCalledOnce();
    expect(txInsertValuesMock).toHaveBeenCalledOnce();
    const inserted = txInsertValuesMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(inserted).toHaveLength(2);
    expect(inserted[0]!['courseCode']).toBe('GC 3010');
    expect(inserted[0]!['subCompetencyId']).toBe('sub-1');
    expect(inserted[0]!['model']).toBe(MODEL);
    expect(inserted[1]!['subCompetencyId']).toBe('sub-2');
  });

  it('issues a delete but skips insert when rows is empty', async () => {
    await replaceIntendedCoverage('GC 1010', [], MODEL);
    expect(txDeleteWhereMock).toHaveBeenCalledOnce();
    expect(txInsertValuesMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('getIntendedCoverageForCourses', () => {
  beforeEach(() => {
    selectWhereMock.mockReset();
  });

  it('returns [] immediately for empty input without issuing a query', async () => {
    const result = await getIntendedCoverageForCourses([]);
    expect(result).toEqual([]);
    expect(selectWhereMock).not.toHaveBeenCalled();
  });

  it('returns rows from the db for a non-empty input', async () => {
    const fakeRows = [
      { courseCode: 'GC 2010', subCompetencyId: 'sub-1', intendedK: 2, intendedU: 1, intendedD: 1, confidence: 'medium', rationale: 'ok' },
    ];
    selectWhereMock.mockResolvedValue(fakeRows);
    const result = await getIntendedCoverageForCourses(['GC 2010']);
    expect(result).toEqual(fakeRows);
    expect(selectWhereMock).toHaveBeenCalledOnce();
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
    // Single batched insert with both rows (was a per-row loop).
    expect(insertMock).toHaveBeenCalledOnce();
    expect(insertMock.mock.calls[0]![0] as unknown[]).toHaveLength(2);
  });

  it('applies defaults for omitted optional fields (level, track, prerequisites)', async () => {
    selectWhereMock.mockResolvedValue([]);
    await bulkCreateCourses([{ code: 'GC 9999', title: 'Test Course' }]);
    expect(insertMock).toHaveBeenCalledOnce();
    const inserted = (insertMock.mock.calls[0]![0] as Array<Record<string, unknown>>)[0]!;
    expect(inserted['level']).toBe(0);
    expect(inserted['track']).toBe('unspecified');
    expect(inserted['prerequisites']).toBe('');
  });

  it('trims whitespace from codes', async () => {
    selectWhereMock.mockResolvedValue([]);
    const result = await bulkCreateCourses([{ code: '  GC 1010  ', title: 'Foundations' }]);
    expect(result.created).toEqual(['GC 1010']);
  });

  it('deduplicates input: duplicate code appears only once in created and skipped', async () => {
    // GC 1010 appears twice in input; GC 2010 appears twice and already exists
    selectWhereMock.mockResolvedValue([{ code: 'GC 2010' }]);
    const result = await bulkCreateCourses([
      { code: 'GC 1010', title: 'Foundations' },
      { code: 'GC 1010', title: 'Foundations (dup)' },
      { code: 'GC 2010', title: 'Design I' },
      { code: 'GC 2010', title: 'Design I (dup)' },
    ]);
    // created should contain GC 1010 exactly once
    expect(result.created).toEqual(['GC 1010']);
    expect(result.created.filter((c) => c === 'GC 1010')).toHaveLength(1);
    // skipped should contain GC 2010 exactly once
    expect(result.skipped).toEqual(['GC 2010']);
    expect(result.skipped.filter((c) => c === 'GC 2010')).toHaveLength(1);
    // only one insert issued (for GC 1010)
    expect(insertMock).toHaveBeenCalledOnce();
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
