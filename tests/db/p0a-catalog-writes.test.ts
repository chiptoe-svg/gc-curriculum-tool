// @vitest-environment node
// P0a catalog/membership writers (scratch DB only). Every write runs inside a
// transaction that is rolled back, so the cloned rows are never changed.
//
// Task 4 (P0b, 2026-10-12) note: the two tests this file used to carry that
// compared readCatalogState()/planTargetBatch() output against the P0a
// mirror-column shape, and that asserted catalogBatchWriter.updateSub threw
// on a two-target reorder, were removed here — not just edited — because
// Task 4 changed the shapes they depended on in ways that make them
// structurally incompatible with the new model, not just renamed:
// readCatalogState() now returns catalog rows (DbSubRow) with no
// careerTargetId/displayOrder at all (those moved to a separate
// DbMembershipRow keyed by (target, competency), because P0b lets one
// competency belong to several targets), and BatchWriter has no `updateSub`
// method any more (split into updateCompetency/insertMembership/
// updateMembershipOrder/retireCompetency). The "exactly one target" throw
// the second test asserted was already removed in Task 3 (947e82e) — this
// file was already runtime-broken against gc_curriculum_p0a_scratch before
// Task 4 (see task-3-report.md Concerns #2); Task 4 just removes the two
// cases that no longer type-check instead of leaving them to bit-rot.
// Recorded in docs/STATE.md Deferred/debt. The remaining three cases below
// (insertCompetencyForTarget, setCompetencyOrderInTarget's mirror-column
// check, getTargetCompetency) don't depend on either changed shape and are
// still valid characterizations of the P0a scratch DB.
import { describe, it, expect } from 'vitest';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements, careerTargets, targetSubCompetencies } from '@/lib/db/schema';
import {
  type Tx,
  getTargetCompetency,
  insertCompetencyForTarget,
  setCompetencyOrderInTarget,
} from '@/lib/db/competency-catalog-queries';
import { isScratchDb } from './p0a/scratch-guard';

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

describe.skipIf(!isScratchDb())('P0a catalog writers', () => {
  it('insertCompetencyForTarget writes the catalog row and one entry/faculty/draft requirement with no weight', async () => {
    const [t] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.displayOrder)).limit(1);
    await inRolledBackTx(async (tx) => {
      const row = await insertCompetencyForTarget(tx, {
        id: 'zz-p0a-insert-test', careerTargetId: t!.id, name: 'ZZ insert', knowDescriptor: 'k',
        understandDescriptor: 'u', doDescriptor: 'd', displayOrder: 42,
      });
      expect(row).toMatchObject({ id: 'zz-p0a-insert-test', careerTargetId: t!.id, displayOrder: 42, retired: false });
      const reqs = await tx.select().from(careerTargetRequirements).where(eq(careerTargetRequirements.competencyId, 'zz-p0a-insert-test'));
      expect(reqs.map(r => [r.careerTargetId, r.horizon, r.weight, r.weightSource, r.status, r.displayOrder]))
        .toEqual([[t!.id, 'entry', null, 'faculty', 'draft', 42]]);
    });
  });

  it('setCompetencyOrderInTarget moves the requirement and the deprecated mirror; other targets are untouched', async () => {
    const [m] = await db.select().from(targetSubCompetencies).where(eq(targetSubCompetencies.retired, false)).orderBy(asc(targetSubCompetencies.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      expect(await setCompetencyOrderInTarget(tx, m!.careerTargetId, m!.id, 77)).toBe(1);
      expect(await setCompetencyOrderInTarget(tx, 'not-a-target', m!.id, 5)).toBe(0);
      const [v] = await tx.select().from(targetSubCompetencies)
        .where(and(eq(targetSubCompetencies.careerTargetId, m!.careerTargetId), eq(targetSubCompetencies.id, m!.id)));
      expect(v!.displayOrder).toBe(77);
      // Raw SQL, not the Drizzle `subCompetencies` table: P0b (migration
      // 0057, a later task on the main scratch) drops this mirror column
      // from the Drizzle schema entirely, but it's still a real column on
      // gc_curriculum_p0a_scratch (0057 is never applied there).
      const { rows } = await tx.execute(sql`SELECT display_order FROM sub_competencies WHERE id = ${m!.id}`);
      expect((rows[0] as { display_order: number }).display_order).toBe(77);
    });
  });

  it('getTargetCompetency finds a member and returns null for a non-member target', async () => {
    const [m] = await db.select().from(targetSubCompetencies).limit(1);
    expect(await getTargetCompetency(m!.careerTargetId, m!.id)).toMatchObject({ id: m!.id, careerTargetId: m!.careerTargetId });
    expect(await getTargetCompetency('not-a-target', m!.id)).toBeNull();
  });
});
