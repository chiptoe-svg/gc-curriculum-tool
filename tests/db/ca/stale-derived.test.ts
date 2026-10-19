// @vitest-environment node
// listStaleSnapshots must ignore scoring='derived' competencies (they are never
// scored, so they must never make a snapshot permanently stale). Runs only on
// the CA scratch DB (0060 applied), in one rolled-back transaction passed as
// `tx` into listStaleSnapshots' executor parameter.
import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots, snapshotCompetencyCoverage, subCompetencies } from '@/lib/db/schema';
import { listStaleSnapshots } from '@/lib/db/program-coverage-queries';
import { isCaScratchDb } from './scratch-guard';

const RUN = isCaScratchDb();
const CODE = 'ZZ 9971';

class Rollback extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => { await fn(tx); throw new Rollback('rollback'); });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e; // surface the real assertion/DB error
    return;
  }
  throw new Error('transaction was not rolled back');
}

describe.skipIf(!RUN)('listStaleSnapshots ignores derived competencies (CA scratch)', () => {
  it('a snapshot scored on every direct competency is not stale, and no missing list holds the derived id', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.insert(courses).values({ code: CODE, title: 'CA stale fixture', level: 9000, track: 'test', buildsToCareer: true } as never);
      const [snap] = await tx.insert(courseCaptureSnapshots).values({
        courseCode: CODE, profile: { course_code: CODE, scale_version: 'v1' } as never,
        inputsMeta: { catalog: {}, builderProfilePresent: false, materials: [], prereqSnapshotsUsed: [], scanPasses: {} } as never,
        scaleVersion: 'v1', model: 'test', instructorName: 'CA Test', createdAt: new Date('2026-10-19T00:00:00Z'),
      } as never).returning({ id: courseCaptureSnapshots.id });
      const snapshotId = snap!.id;

      const [donor] = await tx.select().from(subCompetencies).where(eq(subCompetencies.retired, false)).limit(1);
      const DERIVED_ID = 'zz-derived-fixture';
      await tx.insert(subCompetencies).values({
        ...donor!, id: DERIVED_ID, name: 'ZZ derived fixture', scoring: 'derived', foundational: false,
        knowDescriptor: 'k', understandDescriptor: 'u', retired: false, mergedInto: null,
      } as never);

      const direct = (await tx.select({ id: subCompetencies.id }).from(subCompetencies)
        .where(and(eq(subCompetencies.retired, false), eq(subCompetencies.scoring, 'direct')))).map(r => r.id);
      expect(direct.length).toBeGreaterThan(0);
      expect(direct).not.toContain(DERIVED_ID);

      await tx.insert(snapshotCompetencyCoverage).values(direct.map(id => ({
        snapshotId, competencyId: id, kDepth: 1, uDepth: 1, dDepth: 1,
        matchedCompetency: null, evidenceExcerpt: null, confidence: 'high' as const, rationale: 'fixture', model: 'test',
      })));

      const stale = await listStaleSnapshots(tx);
      expect(stale.find(s => s.snapshotId === snapshotId)).toBeUndefined();
      for (const s of stale) expect(s.missingCompetencyIds).not.toContain(DERIVED_ID);
    });
  });
});
