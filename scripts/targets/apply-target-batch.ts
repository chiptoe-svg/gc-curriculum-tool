#!/usr/bin/env tsx
/**
 * Bring the live career_targets / sub_competencies rows to the definitions in
 * lib/domain/seed-targets.ts (2026-10-06 target batch; spec
 * docs/superpowers/specs/2026-10-05-target-5-creative-ops-tech-draft.md).
 *
 *   --dry-run (default)  read-only transaction; prints the per-target diff + counts
 *   --apply              one transaction: lock rows, re-plan, write, re-plan to
 *                        verify nothing is left, commit
 *
 * Idempotent: a second --apply finds nothing to do. Never deletes rows; retired
 * sub-competencies get retired = true. Touches ONLY career_targets and
 * sub_competencies — snapshot_target_coverage, course data and everything else
 * are out of reach of the writer (lib/domain/target-batch.ts).
 *
 * scripts/seed-career-targets.ts (INSERT ... ON CONFLICT DO NOTHING) is for an
 * empty DB only; it cannot update existing rows, so it is not reused here
 * beyond its column mapping.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/targets/apply-target-batch.ts [--dry-run|--apply]
 */
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargets, subCompetencies } from '@/lib/db/schema';
import { CAREER_TARGETS, RETIRED_SUB_COMPETENCIES } from '@/lib/domain/seed-targets';
import {
  planTargetBatch,
  applyPlan,
  formatPlan,
  type BatchWriter,
  type DbSubRow,
  type DbTargetRow,
} from '@/lib/domain/target-batch';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function readState(tx: Tx, lock: boolean): Promise<{ targets: DbTargetRow[]; subs: DbSubRow[] }> {
  const tq = tx.select().from(careerTargets).orderBy(asc(careerTargets.displayOrder));
  const sq = tx.select().from(subCompetencies).orderBy(asc(subCompetencies.careerTargetId), asc(subCompetencies.displayOrder));
  const [targets, subs] = lock ? [await tq.for('update'), await sq.for('update')] : [await tq, await sq];
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

function drizzleWriter(tx: Tx): BatchWriter {
  return {
    async updateTarget(id, fields) {
      await tx.update(careerTargets).set({ ...fields, updatedAt: new Date() }).where(eq(careerTargets.id, id));
    },
    async updateSub(id, fields) {
      await tx.update(subCompetencies).set({ ...fields, updatedAt: new Date() }).where(eq(subCompetencies.id, id));
    },
    async insertSub(row) {
      await tx.insert(subCompetencies).values({ ...row, updatedAt: new Date() });
    },
    async retireSub(id) {
      await tx.update(subCompetencies).set({ retired: true, updatedAt: new Date() }).where(eq(subCompetencies.id, id));
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(a => a !== '--apply' && a !== '--dry-run');
  if (unknown.length) throw new Error(`unknown argument(s): ${unknown.join(' ')}`);
  if (args.includes('--apply') && args.includes('--dry-run')) throw new Error('pass --dry-run or --apply, not both');
  const apply = args.includes('--apply');

  console.log(`apply-target-batch: ${apply ? 'APPLY' : 'DRY RUN (read-only, nothing written)'}`);

  await db.transaction(async (tx) => {
    if (!apply) await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const state = await readState(tx, apply);
    const plan = planTargetBatch(CAREER_TARGETS, RETIRED_SUB_COMPETENCIES, state.targets, state.subs);
    console.log(formatPlan(plan));
    if (plan.errors.length) throw new Error('plan has errors; nothing written');
    if (!apply) return;

    await applyPlan(plan, drizzleWriter(tx));
    const after = await readState(tx, false);
    const check = planTargetBatch(CAREER_TARGETS, RETIRED_SUB_COMPETENCIES, after.targets, after.subs);
    const c = check.counts;
    if (c.targetsUpdated || c.subsUpdated || c.subsInserted || c.subsRetired) {
      throw new Error('post-apply re-plan is not empty; rolling back');
    }
    console.log('\napplied and verified (re-plan empty); committing');
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
