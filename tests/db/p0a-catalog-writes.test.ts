// @vitest-environment node
// P0a catalog/membership writers (scratch DB only). Every write runs inside a
// transaction that is rolled back, so the cloned rows are never changed.
import { describe, it, expect } from 'vitest';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements, careerTargets, subCompetencies, targetSubCompetencies } from '@/lib/db/schema';
import {
  type Tx,
  catalogBatchWriter,
  getTargetCompetency,
  insertCompetencyForTarget,
  readCatalogState,
  setCompetencyOrderInTarget,
} from '@/lib/db/competency-catalog-queries';
import { planTargetBatch, type DbSubRow } from '@/lib/domain/target-batch';
import { CAREER_TARGETS, RETIRED_SUB_COMPETENCIES } from '@/lib/domain/seed-targets';
import { isScratchDb } from './p0a/scratch-guard';

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

describe.skipIf(!isScratchDb())('P0a catalog writers', () => {
  it('readCatalogState gives the same sub rows and the same batch plan as the pre-P0a read', async () => {
    // Pre-P0a read, from the deprecated mirror columns (identical to membership in P0a).
    const old = await db.execute(sql`SELECT id, career_target_id, name, know_descriptor, understand_descriptor,
      do_descriptor, display_order, retired FROM sub_competencies ORDER BY id`);
    const oldSubs: DbSubRow[] = (old.rows as Array<Record<string, unknown>>).map(r => ({
      id: r.id as string, careerTargetId: r.career_target_id as string, name: r.name as string,
      knowDescriptor: r.know_descriptor as string, understandDescriptor: r.understand_descriptor as string,
      doDescriptor: r.do_descriptor as string, displayOrder: r.display_order as number, retired: r.retired as boolean,
    }));

    const state = await db.transaction(async (tx) => readCatalogState(tx, false));
    const byId = (a: DbSubRow, b: DbSubRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); // JS order, not DB collation
    expect([...state.subs].sort(byId)).toEqual([...oldSubs].sort(byId));
    expect(planTargetBatch(CAREER_TARGETS, RETIRED_SUB_COMPETENCIES, state.targets, state.subs))
      .toEqual(planTargetBatch(CAREER_TARGETS, RETIRED_SUB_COMPETENCIES, state.targets, oldSubs));
  });

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
      const [c] = await tx.select().from(subCompetencies).where(eq(subCompetencies.id, m!.id));
      expect(c!.displayOrder).toBe(77);
    });
  });

  it('the batch writer refuses to reorder a competency used by two targets (P0a invariant)', async () => {
    const targets = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.displayOrder));
    const [m] = await db.select().from(targetSubCompetencies).where(eq(targetSubCompetencies.careerTargetId, targets[0]!.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      await tx.insert(careerTargetRequirements).values({
        careerTargetId: targets[1]!.id, competencyId: m!.id, horizon: 'entry', weight: null,
        weightSource: 'faculty', status: 'draft', displayOrder: 0,
      });
      await expect(catalogBatchWriter(tx).updateSub(m!.id, { displayOrder: 3 })).rejects.toThrow(/exactly one target/);
    });
  });

  it('getTargetCompetency finds a member and returns null for a non-member target', async () => {
    const [m] = await db.select().from(targetSubCompetencies).limit(1);
    expect(await getTargetCompetency(m!.careerTargetId, m!.id)).toMatchObject({ id: m!.id, careerTargetId: m!.careerTargetId });
    expect(await getTargetCompetency('not-a-target', m!.id)).toBeNull();
  });
});
