/**
 * Competency catalog writes (P0a migration 0056; P0b migration 0057 drops
 * the deprecated mirror columns this file used to also write). sub_competencies
 * is the catalog; career_target_requirements records which targets use a
 * competency and its position in each (display_order), and a competency can
 * now be shared by more than one target (P0b merges). Membership is READ
 * from the view target_sub_competencies, which since migration 0062 reads
 * career_target_membership: pins and hides (faculty rows) plus importance
 * weight (spec 2026-10-21-p3-membership-from-weights-design.md). Every write
 * that can change membership takes lockMembership first and calls
 * rebuildMembership before it commits. Spec §8 P0a; plan
 * docs/superpowers/plans/2026-10-11-competency-catalog-p0a.md;
 * docs/superpowers/plans/2026-10-12-competency-catalog-p0b.md.
 */
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetMembership, careerTargetRequirements, careerTargets, subCompetencies, targetSubCompetencies } from '@/lib/db/schema';
import { lockMembership, rebuildMembership, setPin, setHide } from '@/lib/db/membership-queries';
import type { Executor } from '@/lib/db/bundle-queries';
import type { BatchWriter, DbMembershipRow, DbSubRow, DbTargetRow } from '@/lib/domain/target-batch';

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

/** Next display_order for a new pin in the target: last pin + 1, or 0 (weight-based members follow the pins). */
export async function nextDisplayOrderForTarget(careerTargetId: string, ex: Executor = db): Promise<number> {
  const [row] = (await ex.execute(sql`
    SELECT coalesce(max(display_order) + 1, 0)::int AS next FROM career_target_requirements
    WHERE career_target_id = ${careerTargetId} AND weight_source = 'faculty' AND status <> 'hidden'`)).rows as Array<{ next: number }>;
  return row!.next;
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
    // P1 hostile-review fix wave, m2: this is the faculty "add competency"
    // path (POST /api/targets/[id]/sub-competencies) — a human-authored
    // row, not a migrated one. Without this, the DB default ('migrated')
    // applied, giving these rows a wrong provenance record.
    origin: 'gc_authored',
    updatedAt: new Date(),
  });
  await lockMembership(tx);
  await setPin(tx, row.careerTargetId, row.id, row.displayOrder);
  await rebuildMembership(tx);
  const [created] = await tx
    .select()
    .from(targetSubCompetencies)
    .where(and(eq(targetSubCompetencies.careerTargetId, row.careerTargetId), eq(targetSubCompetencies.id, row.id)));
  return created!;
}

/** Set a pinned competency's position within one target. Returns rows updated (0 = not pinned). The caller locks and rebuilds. */
export async function setCompetencyOrderInTarget(
  tx: Tx,
  careerTargetId: string,
  competencyId: string,
  displayOrder: number,
): Promise<number> {
  const updated = await tx
    .update(careerTargetRequirements)
    .set({ displayOrder, updatedAt: new Date() })
    .where(and(
      eq(careerTargetRequirements.careerTargetId, careerTargetId), eq(careerTargetRequirements.competencyId, competencyId),
      eq(careerTargetRequirements.weightSource, 'faculty'), ne(careerTargetRequirements.status, 'hidden'),
    ))
    .returning({ id: careerTargetRequirements.id });
  return updated.length;
}

/**
 * Remove a competency from one target (P0b: a competency can be shared by
 * several targets). Since the membership addendum (spec
 * 2026-10-21-p3-membership-from-weights-design.md §4) removal is a HIDE: the
 * faculty pin becomes a `hidden` faculty row, and the onet/employer weight
 * rows stay (they are data, not membership), so a later recompute cannot
 * bring the competency back. Returns 'unlinked' when no target lists the
 * competency afterward (P0b Amendment 1: unlinked is a valid active state;
 * removing the last target never retires the catalog row).
 *
 * Refuses, changing nothing, when the target does not currently list the
 * competency. lockMembership is taken first (the same lock order as every
 * other membership writer) and serializes removals against each other and the
 * recompute; the FOR UPDATE on the catalog row then guards the row itself, and
 * the post-write membership is re-read after rebuildMembership.
 *
 * Retiring (sub_competencies.retired = true) is a separate, explicit catalog
 * action — not a side effect of this function.
 */
export async function retireCompetencyFromTarget(
  tx: Tx,
  careerTargetId: string,
  competencyId: string,
): Promise<'unlinked' | 'removed-from-target'> {
  // Advisory lock FIRST, as every membership writer does: a rebuild's FK check
  // takes KEY SHARE on member competency rows, so holding this row FOR UPDATE
  // while waiting for the advisory lock deadlocks (final review Important 1).
  await lockMembership(tx);
  const [locked] = await tx.select({ id: subCompetencies.id }).from(subCompetencies).where(eq(subCompetencies.id, competencyId)).for('update');
  if (!locked) {
    throw new Error(`retireCompetencyFromTarget: ${competencyId} does not exist`);
  }
  const targetsBefore = await targetIdsForCompetency(tx, competencyId);
  if (!targetsBefore.includes(careerTargetId)) {
    throw new Error(`retireCompetencyFromTarget: ${careerTargetId} is not a member of ${competencyId}`);
  }
  await setHide(tx, careerTargetId, competencyId);
  await rebuildMembership(tx);
  const targetsAfter = await targetIdsForCompetency(tx, competencyId);
  if (targetsAfter.length === 0) {
    return 'unlinked';
  }
  return 'removed-from-target';
}

/** Targets that currently list the competency (career_target_membership). */
export async function targetIdsForCompetency(tx: Tx, competencyId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: careerTargetMembership.careerTargetId })
    .from(careerTargetMembership)
    .where(eq(careerTargetMembership.competencyId, competencyId));
  return rows.map(r => r.id).sort();
}

/**
 * Target-batch state: the catalog (one DbSubRow per competency, no target
 * association) and the faculty PINS (one DbMembershipRow per pinned (target,
 * competency) pair). The batch planner manages pins only: weight-based members
 * are not the batch file's to add or remove (membership addendum), and seeing
 * them would report them as "not desired" removals on every run.
 */
export async function readCatalogState(
  tx: Tx,
  lock: boolean,
): Promise<{ targets: DbTargetRow[]; subs: DbSubRow[]; memberships: DbMembershipRow[] }> {
  if (lock) {
    // Membership lock first: the same order as every other membership writer
    // (final review Minor #3). Then lock the rows the batch reads.
    await lockMembership(tx);
    await tx.select({ id: careerTargets.id }).from(careerTargets).for('update');
    await tx.select({ id: subCompetencies.id }).from(subCompetencies).for('update');
    await tx.select({ id: careerTargetRequirements.id }).from(careerTargetRequirements).for('update');
  }
  const targets = await tx.select().from(careerTargets).orderBy(asc(careerTargets.displayOrder));
  const subs = await tx.select().from(subCompetencies).orderBy(asc(subCompetencies.id));
  const memberships = (await tx.execute(sql`
    SELECT career_target_id AS "careerTargetId", competency_id AS "competencyId", min(display_order)::int AS "displayOrder"
    FROM career_target_requirements WHERE weight_source = 'faculty' AND status <> 'hidden'
    GROUP BY 1, 2 ORDER BY 1, 3, 2`)).rows as unknown as DbMembershipRow[];
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
      name: s.name,
      knowDescriptor: s.knowDescriptor,
      understandDescriptor: s.understandDescriptor,
      doDescriptor: s.doDescriptor,
      retired: s.retired,
      mergedInto: s.mergedInto ?? null,
    })),
    memberships,
  };
}

/**
 * BatchWriter for scripts/targets/apply-target-batch.ts (the caller holds
 * lockMembership via readCatalogState(tx, true) and calls rebuildMembership
 * once after all writes). Resolution 1
 * (Task 4): memberships are inserted, reordered and removed only through
 * career_target_requirements; catalog field updates go only to
 * sub_competencies. `retireCompetency` removes every membership for the id
 * (across all targets it's a member of) as part of retiring it — the only
 * automatic membership removal the writer performs; a plain "not desired,
 * not retired" removal is reported by the planner only, never applied here.
 */
export function catalogBatchWriter(tx: Tx): BatchWriter {
  return {
    async updateTarget(id, fields) {
      await tx.update(careerTargets).set({ ...fields, updatedAt: new Date() }).where(eq(careerTargets.id, id));
    },
    async insertCompetency(row) {
      await tx.insert(subCompetencies).values({
        id: row.id,
        name: row.name,
        knowDescriptor: row.knowDescriptor,
        understandDescriptor: row.understandDescriptor,
        doDescriptor: row.doDescriptor,
        retired: row.retired,
        mergedInto: row.mergedInto,
        // Final whole-branch review, n2: this is scripts/targets/apply-target-batch.ts's
        // insert path — a batch definitions file the faculty/owner authored,
        // same provenance class as m2's insertCompetencyForTarget. Without
        // this, the DB default ('migrated') applied, same wrong-provenance
        // bug on a second path the m2 fix didn't cover.
        origin: 'gc_authored',
        updatedAt: new Date(),
      });
    },
    async updateCompetency(id, fields) {
      const catalogFields: Partial<typeof subCompetencies.$inferInsert> = {};
      if (fields.name !== undefined) catalogFields.name = fields.name;
      if (fields.knowDescriptor !== undefined) catalogFields.knowDescriptor = fields.knowDescriptor;
      if (fields.understandDescriptor !== undefined) catalogFields.understandDescriptor = fields.understandDescriptor;
      if (fields.doDescriptor !== undefined) catalogFields.doDescriptor = fields.doDescriptor;
      if (fields.retired !== undefined) catalogFields.retired = fields.retired;
      if (fields.mergedInto !== undefined) catalogFields.mergedInto = fields.mergedInto;
      if (Object.keys(catalogFields).length > 0) {
        await tx.update(subCompetencies).set({ ...catalogFields, updatedAt: new Date() }).where(eq(subCompetencies.id, id));
      }
    },
    async retireCompetency(id, mergedInto) {
      await tx.delete(careerTargetRequirements).where(eq(careerTargetRequirements.competencyId, id));
      await tx.update(subCompetencies).set({ retired: true, mergedInto, updatedAt: new Date() }).where(eq(subCompetencies.id, id));
    },
    async insertMembership(careerTargetId, competencyId, displayOrder) {
      // A pin; turns an earlier hide back into a pin. The batch CLI rebuilds membership once after all writes.
      await setPin(tx, careerTargetId, competencyId, displayOrder);
    },
    async updateMembershipOrder(careerTargetId, competencyId, displayOrder) {
      await setCompetencyOrderInTarget(tx, careerTargetId, competencyId, displayOrder);
    },
  };
}
