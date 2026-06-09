import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetDemand } from '@/lib/db/schema';

/**
 * Reads/writes the per-(target, sub-competency) employer demand store
 * (demand-measurement side of the Q1 sufficiency seam). NOTE: the
 * career_target_demand table ships via migration 0032 which is NOT YET applied —
 * every caller is gated behind DEMAND_COVERAGE_SEAM, so these run only once the
 * migration is applied + the feature activated. Spec:
 * docs/superpowers/specs/2026-06-07-demand-coverage-sufficiency-seam-design.md
 */

export interface TargetDemandRow {
  careerTargetId: string;
  subCompetencyId: string;
  kDemand: number | null;
  uDemand: number | null;
  dDemand: number | null;
  contributingPositionIds: string[];
  generatedAt: Date;
}

export interface TargetDemandUpsert {
  subCompetencyId: string;
  k: number | null;
  u: number | null;
  d: number | null;
  contributingPositionIds: string[];
}

/** Full replace of a target's demand rows (delete-then-insert in one tx) so a
 *  recompute drops sub-competencies that no longer have any demand. */
export async function upsertTargetDemand(careerTargetId: string, rows: TargetDemandUpsert[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(careerTargetDemand).where(eq(careerTargetDemand.careerTargetId, careerTargetId));
    if (rows.length === 0) return;
    await tx.insert(careerTargetDemand).values(rows.map(r => ({
      careerTargetId,
      subCompetencyId: r.subCompetencyId,
      kDemand: r.k,
      uDemand: r.u,
      dDemand: r.d,
      contributingPositionIds: r.contributingPositionIds,
    })));
  });
}

export async function getTargetDemand(careerTargetId: string): Promise<TargetDemandRow[]> {
  const rows = await db
    .select()
    .from(careerTargetDemand)
    .where(eq(careerTargetDemand.careerTargetId, careerTargetId));
  return rows as TargetDemandRow[];
}
