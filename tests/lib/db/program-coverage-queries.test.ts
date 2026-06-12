// Real-DB test (repo exception to the mock-client convention): requires
// DATABASE_URL — run with it set (see .env.local). Skips (not fails) when
// DATABASE_URL is unset. Fixture rows under course 'ZZ 9998' are created
// and deleted inside the describe's own hooks.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getMatrixData } from '@/lib/db/program-coverage-queries';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const TEST_CODE = 'ZZ 9998'; // never a real course

// Minimal jsonb payloads — the matrix query never reads inside these.
const PROFILE = { course_code: TEST_CODE, scale_version: 'v1' } as never;
const INPUTS_META = { catalog: {}, builderProfilePresent: false, materials: [], prereqSnapshotsUsed: [], scanPasses: {} } as never;

function snapshot(instructorName: string | null, createdAt: Date) {
  return {
    courseCode: TEST_CODE,
    profile: PROFILE,
    inputsMeta: INPUTS_META,
    scaleVersion: 'v1',
    model: 'test',
    instructorName,
    createdAt,
  };
}

describe.skipIf(!HAS_DB)('getMatrixData per-instructor rows (A8)', () => {
  beforeAll(async () => {
    await db.insert(courses).values({
      code: TEST_CODE, title: 'Matrix test course', level: 9000, track: 'test', buildsToCareer: true,
    } as never).onConflictDoNothing();
    await db.insert(courseCaptureSnapshots).values([
      snapshot('Erica Walker', new Date('2026-06-01T00:00:00Z')), // older — superseded for this instructor
      snapshot('Erica Walker', new Date('2026-06-10T00:00:00Z')), // newest for Walker
      snapshot('Carl Blue', new Date('2026-06-05T00:00:00Z')),    // only one for Blue
    ]);
  });

  afterAll(async () => {
    await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, TEST_CODE));
    await db.delete(courses).where(eq(courses.code, TEST_CODE));
  });

  it('returns one row per (course, instructor), each the latest snapshot for that instructor', async () => {
    const data = await getMatrixData();
    const rows = data.courses.filter(c => c.courseCode === TEST_CODE);
    expect(rows).toHaveLength(2);
    const byInstructor = new Map(rows.map(r => [r.instructorName, r]));
    expect([...byInstructor.keys()].sort()).toEqual(['Carl Blue', 'Erica Walker']);
    // Walker's row must be her NEWEST snapshot, not the older one.
    expect(new Date(byInstructor.get('Erica Walker')!.snapshotCreatedAt).toISOString())
      .toBe('2026-06-10T00:00:00.000Z');
  });
});
