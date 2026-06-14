// Real-DB test: requires DATABASE_URL — skips when unset.
// Fixture rows under course 'ZZ 9997' are created and deleted inside the
// describe's own hooks. Tests that reconciliation_log persists round-trip.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createSnapshot, getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import type { ReconciliationLogEntry } from '@/lib/ai/schemas';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const TEST_CODE = 'ZZ 9997'; // never a real course

// Minimal jsonb payloads — queries under test don't read inside them.
const PROFILE = { course_code: TEST_CODE, scale_version: 'v1' } as never;
const INPUTS_META = {
  catalog: { description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [] },
  builderProfilePresent: false,
  materials: [],
  prereqSnapshotsUsed: [],
  scanPasses: { canvasImportedAt: null, googleDocsScannedAt: null },
} as never;

const BASE_INPUT = {
  courseCode: TEST_CODE,
  profile: PROFILE,
  inputsMeta: INPUTS_META,
  transcript: [],
  caption: null,
  captionNote: null,
  reviewerNote: null,
  model: 'test-model',
};

const SAMPLE_LOG: ReconciliationLogEntry[] = [
  {
    section: 'apparent_outcomes',
    feedback: 'The outcomes look thin on the Do side.',
    proposals: [
      {
        index: 0,
        action: 'modify',
        revised: { statement: 'Updated outcome text', k: null, u: null, d: 3 },
        rationale: 'Strengthens D coverage',
      },
    ],
    decisions: [{ index: 0, accepted: true }],
    at: '2026-06-14T12:00:00.000Z',
  },
];

describe.skipIf(!HAS_DB)('reconciliation_log round-trip', () => {
  beforeAll(async () => {
    await db.insert(courses).values({
      code: TEST_CODE,
      title: 'Reconciliation log test course',
      level: 9000,
      track: 'test',
      buildsToCareer: true,
    } as never).onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, TEST_CODE));
    await db.delete(courses).where(eq(courses.code, TEST_CODE));
  });

  it('persists and reads back the reconciliation log', async () => {
    const created = await createSnapshot({ ...BASE_INPUT, reconciliationLog: SAMPLE_LOG });
    const fetched = await getSnapshotById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.reconciliationLog).toEqual(SAMPLE_LOG);
  });

  it('reads back null when no log was provided', async () => {
    const created = await createSnapshot({ ...BASE_INPUT });
    const fetched = await getSnapshotById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.reconciliationLog).toBeNull();
  });
});
