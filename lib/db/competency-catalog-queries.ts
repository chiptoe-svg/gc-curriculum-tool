/**
 * Competency catalog writes (P0a migration 0056; P0b migration 0057 drops
 * the deprecated mirror columns this file used to also write). sub_competencies
 * is the catalog; career_target_requirements records which targets use a
 * competency and its position in each (display_order), and a competency can
 * now be shared by more than one target (P0b merges). Membership is READ
 * from the view target_sub_competencies. Spec §8 P0a; plan
 * docs/superpowers/plans/2026-10-11-competency-catalog-p0a.md;
 * docs/superpowers/plans/2026-10-12-competency-catalog-p0b.md.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements, careerTargets, subCompetencies, targetSubCompetencies } from '@/lib/db/schema';
import type { BatchWriter, DbSubRow, DbTargetRow } from '@/lib/domain/target-batch';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type TargetCompetencyRow = typeof targetSubCompetencies.$inferSelect;

export interface NewTargetCompetency {
  id: string;
  careerTargetId: string;
  name: string;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
  displayOrder: number;
  retired?: boolean;
}

/** The competency as a member of the target (old sub_competencies row shape), or null if not a member. */
export async function getTargetCompetency(careerTargetId: string, competencyId: string): Promise<TargetCompetencyRow | null> {
  const [row] = await db
    .select()
    .from(targetSubCompetencies)
    .where(and(eq(targetSubCompetencies.careerTargetId, careerTargetId), eq(targetSubCompetencies.id, competencyId)))
    .limit(1);
  return row ?? null;
}

/** Next display_order for a new competency in the target: last current one + 1, or 0. */
export async function nextDisplayOrderForTarget(careerTargetId: string): Promise<number> {
  const rows = await db
    .select({ displayOrder: targetSubCompetencies.displayOrder })
    .from(targetSubCompetencies)
    .where(and(eq(targetSubCompetencies.careerTargetId, careerTargetId), eq(targetSubCompetencies.retired, false)))
    .orderBy(asc(targetSubCompetencies.displayOrder));
  return rows.length > 0 ? rows[rows.length - 1]!.displayOrder + 1 : 0;
}

/** Create a catalog competency used by one target: catalog row + one entry/faculty/draft requirement (weight NULL). */
export async function insertCompetencyForTarget(tx: Tx, row: NewTargetCompetency): Promise<TargetCompetencyRow> {
  await tx.insert(subCompetencies).values({
    id: row.id,
    name: row.name,
    knowDescriptor: row.knowDescriptor,
    understandDescriptor: row.understandDescriptor,
    doDescriptor: row.doDescriptor,
    retired: row.retired ?? false,
    updatedAt: new Date(),
  });
  await tx.insert(careerTargetRequirements).values({
    careerTargetId: row.careerTargetId,
    competencyId: row.id,
    horizon: 'entry',
    weight: null,
    weightSource: 'faculty',
    status: 'draft',
    displayOrder: row.displayOrder,
  });
  const [created] = await tx
    .select()
    .from(targetSubCompetencies)
    .where(and(eq(targetSubCompetencies.careerTargetId, row.careerTargetId), eq(targetSubCompetencies.id, row.id)));
  return created!;
}

/** Set a competency's position within one target. Returns rows updated (0 = not a member). */
export async function setCompetencyOrderInTarget(
  tx: Tx,
  careerTargetId: string,
  competencyId: string,
  displayOrder: number,
): Promise<number> {
  const updated = await tx
    .update(careerTargetRequirements)
    .set({ displayOrder, updatedAt: new Date() })
    .where(and(eq(careerTargetRequirements.careerTargetId, careerTargetId), eq(careerTargetRequirements.competencyId, competencyId)))
    .returning({ id: careerTargetRequirements.id });
  return updated.length;
}

/**
 * Remove one target's claim on a competency (P0b: a competency can be
 * shared by several targets after a merge). Deletes every
 * career_target_requirements row for (careerTargetId, competencyId) — all
 * horizons/weight sources for that pair, nothing belonging to any other
 * target. If no other target still uses the competency afterward, the
 * catalog row itself is retired; otherwise it stays active for the
 * remaining targets.
 *
 * Self-correcting (fix round 1, 2026-10-12): refuses — and changes
 * nothing — if careerTargetId isn't currently a member of the competency,
 * instead of silently deleting zero rows and branching on a stale
 * pre-delete count (the old version could wrongly retire a competency that
 * still had its one real target intact, because a no-op delete for a bogus
 * target id still satisfied "<= 1 target before"). The post-delete
 * membership is re-read rather than inferred from the pre-delete count.
 */
export async function retireCompetencyFromTarget(
  tx: Tx,
  careerTargetId: string,
  competencyId: string,
): Promise<'retired' | 'removed-from-target'> {
  const targetsBefore = await targetIdsForCompetency(tx, competencyId);
  if (!targetsBefore.includes(careerTargetId)) {
    throw new Error(`retireCompetencyFromTarget: ${careerTargetId} is not a member of ${competencyId}`);
  }
  await tx
    .delete(careerTargetRequirements)
    .where(and(eq(careerTargetRequirements.careerTargetId, careerTargetId), eq(careerTargetRequirements.competencyId, competencyId)));
  const targetsAfter = await targetIdsForCompetency(tx, competencyId);
  if (targetsAfter.length === 0) {
    await tx.update(subCompetencies).set({ retired: true, updatedAt: new Date() }).where(eq(subCompetencies.id, competencyId));
    return 'retired';
  }
  return 'removed-from-target';
}

export async function targetIdsForCompetency(tx: Tx, competencyId: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: careerTargetRequirements.careerTargetId })
    .from(careerTargetRequirements)
    .where(eq(careerTargetRequirements.competencyId, competencyId));
  return rows.map(r => r.id).sort();
}

/** Target-batch state: targets + one DbSubRow per (target, competency) membership. */
export async function readCatalogState(tx: Tx, lock: boolean): Promise<{ targets: DbTargetRow[]; subs: DbSubRow[] }> {
  if (lock) {
    // A GROUP BY view cannot be locked FOR UPDATE; lock the rows it is built from.
    await tx.select({ id: careerTargets.id }).from(careerTargets).for('update');
    await tx.select({ id: subCompetencies.id }).from(subCompetencies).for('update');
    await tx.select({ id: careerTargetRequirements.id }).from(careerTargetRequirements).for('update');
  }
  const targets = await tx.select().from(careerTargets).orderBy(asc(careerTargets.displayOrder));
  const subs = await tx
    .select()
    .from(targetSubCompetencies)
    .orderBy(asc(targetSubCompetencies.careerTargetId), asc(targetSubCompetencies.displayOrder), asc(targetSubCompetencies.id));
  return {
    targets: targets.map(t => ({
      id: t.id,
      name: t.name,
      shortDefinition: t.shortDefinition,
      industryContexts: t.industryContexts,
      knowDescriptors: t.knowDescriptors,
      understandDescriptors: t.understandDescriptors,
      doDescriptors: t.doDescriptors,
      defensibilityNote: t.defensibilityNote,
      socCode: t.socCode ?? null,
    })),
    subs: subs.map(s => ({
      id: s.id,
      careerTargetId: s.careerTargetId,
      name: s.name,
      knowDescriptor: s.knowDescriptor,
      understandDescriptor: s.understandDescriptor,
      doDescriptor: s.doDescriptor,
      displayOrder: s.displayOrder,
      retired: s.retired,
    })),
  };
}

/** BatchWriter for scripts/targets/apply-target-batch.ts. */
export function catalogBatchWriter(tx: Tx): BatchWriter {
  return {
    async updateTarget(id, fields) {
      await tx.update(careerTargets).set({ ...fields, updatedAt: new Date() }).where(eq(careerTargets.id, id));
    },
    async updateSub(id, fields) {
      if (fields.displayOrder !== undefined) {
        // P0b: order lives only on career_target_requirements, one value
        // per (target, competency) — a shared competency (post-merge) gets
        // the same position applied across every target that uses it.
        const targets = await targetIdsForCompetency(tx, id);
        for (const targetId of targets) {
          await setCompetencyOrderInTarget(tx, targetId, id, fields.displayOrder);
        }
      }
      const catalogFields: Partial<typeof subCompetencies.$inferInsert> = {};
      if (fields.name !== undefined) catalogFields.name = fields.name;
      if (fields.knowDescriptor !== undefined) catalogFields.knowDescriptor = fields.knowDescriptor;
      if (fields.understandDescriptor !== undefined) catalogFields.understandDescriptor = fields.understandDescriptor;
      if (fields.doDescriptor !== undefined) catalogFields.doDescriptor = fields.doDescriptor;
      if (fields.retired !== undefined) catalogFields.retired = fields.retired;
      if (Object.keys(catalogFields).length > 0) {
        await tx.update(subCompetencies).set({ ...catalogFields, updatedAt: new Date() }).where(eq(subCompetencies.id, id));
      }
    },
    async insertSub(row) {
      await insertCompetencyForTarget(tx, row);
    },
    async retireSub(id) {
      await tx.update(subCompetencies).set({ retired: true, updatedAt: new Date() }).where(eq(subCompetencies.id, id));
    },
  };
}
