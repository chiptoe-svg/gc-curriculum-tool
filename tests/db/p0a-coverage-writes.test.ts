// @vitest-environment node
// P0a coverage write path (scratch DB only). Fixture course 'ZZ 9995' and the
// fixture competency are created and removed by this file.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  careerTargets,
  courseCaptureSnapshots,
  courses,
  snapshotCompetencyCoverage,
  targetCoverage,
} from '@/lib/db/schema';
import { invalidateCoverageForSubCompetency, upsertCoverageCell } from '@/lib/db/program-coverage-queries';
import { runCourseReset } from '@/lib/capture/run-course-reset';
import { isScratchDb } from './p0a/scratch-guard';
import { FIXTURE_COMPETENCY, addFixtureCompetency, removeFixtureCompetency } from './p0a/fixtures';

const CODE = 'ZZ 9995'; // never a real course — distinct from ZZ 9996/9997/9998/9999 used by other DB tests (reconciliation-log.test.ts collided on 9997)
const PROFILE = { course_code: CODE, scale_version: 'v1' } as never;
const INPUTS_META = { catalog: {}, builderProfilePresent: false, materials: [], prereqSnapshotsUsed: [], scanPasses: {} } as never;

async function newSnapshot(): Promise<string> {
  const [row] = await db.insert(courseCaptureSnapshots).values({
    courseCode: CODE, profile: PROFILE, inputsMeta: INPUTS_META, scaleVersion: 'v1', model: 'test',
    instructorName: 'P0a Test', createdAt: new Date('2026-10-11T00:00:00Z'),
  } as never).returning({ id: courseCaptureSnapshots.id });
  return row!.id;
}

const cell = (snapshotId: string, targetId: string, dDepth: number, rationale: string) => ({
  snapshotId, careerTargetId: targetId, subCompetencyId: FIXTURE_COMPETENCY,
  kDepth: 1, uDepth: 2, dDepth, matchedCompetency: 'fixture statement', evidenceExcerpt: 'e',
  confidence: 'high' as const, rationale, model: 'test',
});

describe.skipIf(!isScratchDb())('P0a coverage write path', () => {
  let targetId: string;

  beforeAll(async () => {
    const [t] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.displayOrder)).limit(1);
    targetId = t!.id;
    await db.insert(courses).values({ code: CODE, title: 'P0a write test', level: 9000, track: 'test' } as never).onConflictDoNothing();
    await addFixtureCompetency(targetId);
  });

  afterAll(async () => {
    await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, CODE));
    await removeFixtureCompetency();
    await db.delete(courses).where(eq(courses.code, CODE));
  });

  it('upsert keeps one cell per (snapshot, competency), visible under the owning target', async () => {
    const snapshotId = await newSnapshot();
    await upsertCoverageCell(cell(snapshotId, targetId, 3, 'first'));
    await upsertCoverageCell(cell(snapshotId, targetId, 4, 'second'));

    const rows = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
    expect(rows.map(r => [r.competencyId, r.dDepth, r.rationale])).toEqual([[FIXTURE_COMPETENCY, 4, 'second']]);

    const viewRows = await db.select().from(targetCoverage).where(eq(targetCoverage.snapshotId, snapshotId));
    expect(viewRows.map(r => [r.careerTargetId, r.subCompetencyId, r.dDepth])).toEqual([[targetId, FIXTURE_COMPETENCY, 4]]);

    // The backup table is read-only since P0a Task 7: scoring never writes
    // it. Raw SQL, not the Drizzle `snapshotTargetCoverage` table: P0b
    // (migration 0057, a later task on the main scratch) drops this table
    // from the Drizzle schema entirely, but it's still real on
    // gc_curriculum_p0a_scratch (0057 is never applied there).
    const old = await db.execute(sql`SELECT 1 FROM snapshot_target_coverage WHERE snapshot_id = ${snapshotId}`);
    expect(old.rows).toEqual([]);
  });

  it('invalidate removes every cell of the competency and returns the count', async () => {
    const s1 = await newSnapshot();
    const s2 = await newSnapshot();
    await upsertCoverageCell(cell(s1, targetId, 2, 'a'));
    await upsertCoverageCell(cell(s2, targetId, 2, 'b'));
    const before = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.competencyId, FIXTURE_COMPETENCY));

    const n = await invalidateCoverageForSubCompetency(targetId, FIXTURE_COMPETENCY);

    expect(n).toBe(before.length);
    expect(await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.competencyId, FIXTURE_COMPETENCY))).toEqual([]);
    expect(await db.select().from(targetCoverage).where(eq(targetCoverage.subCompetencyId, FIXTURE_COMPETENCY))).toEqual([]);
  });

  it('course reset with snapshots counts and removes the new-table cells', async () => {
    const snapshotId = await newSnapshot();
    await upsertCoverageCell(cell(snapshotId, targetId, 1, 'reset me'));
    const result = await runCourseReset(CODE, { scope: 'session', includeSnapshots: true });
    expect(result.snapshotCoverageDeleted).toBe(1);
    expect(await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId))).toEqual([]);
  });
});
