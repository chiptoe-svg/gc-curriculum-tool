// Real-DB test: requires DATABASE_URL (a scratch DB, never live). Skips (not
// fails) when unset. Each capture session stores its revision mode and the
// approved snapshot it started from (owner 2026-11-08).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots, captureSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createSnapshot } from '@/lib/db/capture-snapshots-queries';
import { recordSessionMode, getSessionMode } from '@/lib/db/capture-sessions-queries';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const CODE = 'ZZ 9310';

describe.skipIf(!HAS_DB)('capture sessions', () => {
  let snapshotId = '';

  beforeAll(async () => {
    await db.insert(courses)
      .values({ code: CODE, title: 'Capture sessions test', level: 9000, track: 'test' } as never)
      .onConflictDoNothing();
    const snap = await createSnapshot({
      courseCode: CODE,
      profile: { course_code: CODE, scale_version: 'v1' } as unknown as CaptureProfile,
      inputsMeta: { catalog: { description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [] }, builderProfilePresent: false, materials: [], prereqSnapshotsUsed: [], scanPasses: { canvasImportedAt: null, googleDocsScannedAt: null } } as never,
      transcript: [], caption: null, captionNote: null, reviewerNote: null, model: 'test',
    });
    snapshotId = snap.id;
  });

  afterAll(async () => {
    await db.delete(captureSessions).where(eq(captureSessions.courseCode, CODE));
    await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, CODE));
    await db.delete(courses).where(eq(courses.code, CODE));
  });

  it('records a mode and reads it back', async () => {
    const sessionId = randomUUID();
    await recordSessionMode({ sessionId, courseCode: CODE, revisionMode: 'targeted', baselineSnapshotId: snapshotId });
    expect(await getSessionMode(sessionId)).toEqual({ revisionMode: 'targeted', baselineSnapshotId: snapshotId });
  });

  it('a second record for the same session is ignored', async () => {
    const sessionId = randomUUID();
    await recordSessionMode({ sessionId, courseCode: CODE, revisionMode: 'recheck', baselineSnapshotId: snapshotId });
    await recordSessionMode({ sessionId, courseCode: CODE, revisionMode: 'fresh', baselineSnapshotId: null });
    expect(await getSessionMode(sessionId)).toEqual({ revisionMode: 'recheck', baselineSnapshotId: snapshotId });
  });

  it('unknown session returns null', async () => {
    expect(await getSessionMode(randomUUID())).toBeNull();
  });
});
