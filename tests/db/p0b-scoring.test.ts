// @vitest-environment node
// listStaleSnapshots (P0b Task 5 — per-competency scoring, no career-target
// context). Needs the post-0057 schema (sub_competencies with no deprecated
// mirror columns; snapshot_competency_coverage keyed (snapshot, competency)),
// so this is gated on isP0bMainDb(), same as the other post-0057 DB tests.
//
// Everything runs inside ONE rolled-back transaction, passed explicitly as
// `tx` into listStaleSnapshots (its `executor` param) — a read through the
// bare `db` singleton runs on a different pooled connection and would never
// see this transaction's own uncommitted insert/delete.
import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots, snapshotCompetencyCoverage, subCompetencies } from '@/lib/db/schema';
import { listStaleSnapshots } from '@/lib/db/program-coverage-queries';
import { isP0bMainDb } from './p0b/scratch-guard';

const RUN = isP0bMainDb();

const TEST_CODE = 'ZZ 9993'; // never a real course — distinct from the other DB tests' fixture codes

class Rollback extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

const PROFILE = { course_code: TEST_CODE, scale_version: 'v1' } as never;
const INPUTS_META = { catalog: {}, builderProfilePresent: false, materials: [], prereqSnapshotsUsed: [], scanPasses: {} } as never;

describe.skipIf(!RUN)('listStaleSnapshots (P0b, post-0057)', () => {
  it("deleting one survivor cell for a fully-scored snapshot makes it stale with exactly that id missing", async () => {
    await inRolledBackTx(async (tx) => {
      // Fixture course + snapshot — builds_to_career, default scope 'gc' / status 'offered'.
      await tx.insert(courses).values({
        code: TEST_CODE, title: 'P0b scoring test course', level: 9000, track: 'test', buildsToCareer: true,
      } as never);
      const [snap] = await tx.insert(courseCaptureSnapshots).values({
        courseCode: TEST_CODE, profile: PROFILE, inputsMeta: INPUTS_META, scaleVersion: 'v1', model: 'test',
        instructorName: 'P0b Test', createdAt: new Date('2026-10-12T00:00:00Z'),
      } as never).returning({ id: courseCaptureSnapshots.id });
      const snapshotId = snap!.id;

      // The full active catalog — this snapshot is scored against ALL of it.
      const activeIds = (await tx.select({ id: subCompetencies.id }).from(subCompetencies).where(eq(subCompetencies.retired, false)))
        .map(r => r.id);
      expect(activeIds.length).toBeGreaterThan(0);

      await tx.insert(snapshotCompetencyCoverage).values(activeIds.map(id => ({
        snapshotId, competencyId: id, kDepth: 1, uDepth: 1, dDepth: 1,
        matchedCompetency: null, evidenceExcerpt: null, confidence: 'high' as const, rationale: 'fixture', model: 'test',
      })));

      // Fully scored: this snapshot must not appear in the stale list.
      const beforeDelete = await listStaleSnapshots(tx);
      expect(beforeDelete.find(s => s.snapshotId === snapshotId)).toBeUndefined();

      // Delete exactly one cell.
      const removedId = activeIds[0]!;
      await tx.delete(snapshotCompetencyCoverage).where(and(
        eq(snapshotCompetencyCoverage.snapshotId, snapshotId),
        eq(snapshotCompetencyCoverage.competencyId, removedId),
      ));

      const afterDelete = await listStaleSnapshots(tx);
      const staleRow = afterDelete.find(s => s.snapshotId === snapshotId);
      expect(staleRow).toBeDefined();
      expect(staleRow!.missingCompetencyIds).toEqual([removedId]);
      expect(staleRow!.courseCode).toBe(TEST_CODE);
    });
  });
});
