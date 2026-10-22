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
 * sub-competencies get retired = true. Touches ONLY career_targets, sub_competencies
 * and career_target_requirements (membership + display order, P0a) — snapshot_target_coverage,
 * course data and everything else are out of reach of the writer (lib/domain/target-batch.ts).
 *
 * scripts/seed-career-targets.ts (INSERT ... ON CONFLICT DO NOTHING) is for an
 * empty DB only; it cannot update existing rows, so it is not reused here
 * beyond its column mapping.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/targets/apply-target-batch.ts [--dry-run|--apply]
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { CAREER_TARGETS, RETIRED_SUB_COMPETENCIES } from '@/lib/domain/seed-targets';
import { planTargetBatch, applyPlan, formatPlan } from '@/lib/domain/target-batch';
import { catalogBatchWriter, readCatalogState } from '@/lib/db/competency-catalog-queries';
import { rebuildMembership } from '@/lib/db/membership-queries';

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(a => a !== '--apply' && a !== '--dry-run');
  if (unknown.length) throw new Error(`unknown argument(s): ${unknown.join(' ')}`);
  if (args.includes('--apply') && args.includes('--dry-run')) throw new Error('pass --dry-run or --apply, not both');
  const apply = args.includes('--apply');

  console.log(`apply-target-batch: ${apply ? 'APPLY' : 'DRY RUN (read-only, nothing written)'}`);

  await db.transaction(async (tx) => {
    if (!apply) await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const state = await readCatalogState(tx, apply);
    const plan = planTargetBatch(CAREER_TARGETS, RETIRED_SUB_COMPETENCIES, state.targets, state.subs, state.memberships);
    console.log(formatPlan(plan));
    if (plan.errors.length) throw new Error('plan has errors; nothing written');
    if (!apply) return;

    await applyPlan(plan, catalogBatchWriter(tx));
    await rebuildMembership(tx); // membership addendum: pins changed; readCatalogState(tx, true) holds the lock
    const after = await readCatalogState(tx, false);
    const check = planTargetBatch(CAREER_TARGETS, RETIRED_SUB_COMPETENCIES, after.targets, after.subs, after.memberships);
    const c = check.counts;
    if (
      c.targetsUpdated || c.competenciesUpdated || c.competenciesInserted || c.competenciesRetired ||
      c.membershipsInserted || c.membershipsReordered
    ) {
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
