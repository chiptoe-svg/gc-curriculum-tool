// Real-DB test: requires DATABASE_URL — skips when unset.
// Fixture rows under course 'ZZ 9996' are created and deleted inside the
// describe's own hooks. Tests that source_snapshot_id persists round-trip
// with preserve-on-undefined semantics.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import { courses, courseCaptureProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  getCaptureProfileByCourse,
  upsertCaptureProfile,
} from '@/lib/db/course-capture-profiles-queries';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const TEST_CODE = 'ZZ 9996'; // never a real course

// Minimal profile payload — queries under test don't read inside it.
const PROFILE = { course_code: TEST_CODE, scale_version: 'v1' } as never;

describe.skipIf(!HAS_DB)('source_snapshot_id round-trip', () => {
  beforeAll(async () => {
    // Seed a courses row so the FK on course_capture_profiles is satisfied.
    await db
      .insert(courses)
      .values({
        code: TEST_CODE,
        title: 'source_snapshot_id test course',
        level: 9000,
        track: 'test',
        buildsToCareer: true,
      } as never)
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(courseCaptureProfiles)
      .where(eq(courseCaptureProfiles.courseCode, TEST_CODE));
    await db.delete(courses).where(eq(courses.code, TEST_CODE));
  });

  it('inserts a draft with sourceSnapshotId and reads it back', async () => {
    await upsertCaptureProfile({
      courseCode: TEST_CODE,
      profile: PROFILE,
      sourceSnapshotId: 'snap-1',
    });
    const row = await getCaptureProfileByCourse(TEST_CODE);
    expect(row).not.toBeNull();
    expect(row!.sourceSnapshotId).toBe('snap-1');
  });

  it('preserves sourceSnapshotId when omitted on update (undefined)', async () => {
    // No sourceSnapshotId in the input → should not overwrite 'snap-1'.
    await upsertCaptureProfile({
      courseCode: TEST_CODE,
      profile: PROFILE,
    });
    const row = await getCaptureProfileByCourse(TEST_CODE);
    expect(row).not.toBeNull();
    expect(row!.sourceSnapshotId).toBe('snap-1');
  });

  it('clears sourceSnapshotId when explicit null is passed', async () => {
    await upsertCaptureProfile({
      courseCode: TEST_CODE,
      profile: PROFILE,
      sourceSnapshotId: null,
    });
    const row = await getCaptureProfileByCourse(TEST_CODE);
    expect(row).not.toBeNull();
    expect(row!.sourceSnapshotId).toBeNull();
  });
});
