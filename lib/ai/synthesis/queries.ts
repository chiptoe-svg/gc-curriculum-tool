import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

export interface SalaryDistribution {
  p25?: number;
  p50?: number;
  p75?: number;
  n: number;
}

export interface UnmappedLabel {
  label: string;
  count: number;
}

export async function countSubmittedForTarget(targetId: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM partner_submissions
    WHERE status = 'submitted' AND career_target_id = ${targetId}
  `);
  return (r.rows[0] as { n: number } | undefined)?.n ?? 0;
}

export async function countUniquePartnersForTarget(targetId: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(DISTINCT partner_id)::int AS n
    FROM partner_submissions
    WHERE status = 'submitted' AND career_target_id = ${targetId}
  `);
  return (r.rows[0] as { n: number } | undefined)?.n ?? 0;
}

export async function sumPartnerWeightsForTarget(targetId: string): Promise<number> {
  // Sum distinct partners' weights — a partner who submitted 3 positions for the
  // same target still counts once for the weighted-sum stat (their voice isn't
  // amplified by repeating themselves).
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(weight), 0)::int AS s
    FROM partners
    WHERE id IN (
      SELECT DISTINCT partner_id
      FROM partner_submissions
      WHERE status = 'submitted' AND career_target_id = ${targetId}
    )
  `);
  return (r.rows[0] as { s: number | null } | undefined)?.s ?? 0;
}

export async function salaryDistributionForTarget(targetId: string): Promise<SalaryDistribution> {
  // Take the midpoint of low/high when both present; fall back to whichever is set.
  // Currency is ignored in v1 — most partners will be USD; we can normalize later.
  const r = await db.execute(sql`
    WITH samples AS (
      SELECT
        CASE
          WHEN salary_range_low IS NOT NULL AND salary_range_high IS NOT NULL
            THEN (salary_range_low + salary_range_high) / 2
          ELSE COALESCE(salary_range_low, salary_range_high)
        END AS sal
      FROM partner_submissions
      WHERE status = 'submitted'
        AND career_target_id = ${targetId}
        AND (salary_range_low IS NOT NULL OR salary_range_high IS NOT NULL)
    )
    SELECT
      PERCENTILE_DISC(0.25) WITHIN GROUP (ORDER BY sal)::int AS p25,
      PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY sal)::int AS p50,
      PERCENTILE_DISC(0.75) WITHIN GROUP (ORDER BY sal)::int AS p75,
      COUNT(*)::int AS n
    FROM samples
  `);
  const row = r.rows[0] as { p25: number | null; p50: number | null; p75: number | null; n: number } | undefined;
  const n = row?.n ?? 0;
  if (n === 0) return { n: 0 };
  return {
    p25: row?.p25 ?? undefined,
    p50: row?.p50 ?? undefined,
    p75: row?.p75 ?? undefined,
    n,
  };
}

export async function nearbyUnmappedLabelsForTarget(_targetId: string): Promise<UnmappedLabel[]> {
  // For v1, "nearby" just means "every unmapped label on any submission". A future
  // iteration can use embedding similarity to filter to labels actually adjacent
  // to this target. The point of the stat is to surface emerging target gaps.
  const r = await db.execute(sql`
    SELECT
      unmapped_target_label AS label,
      COUNT(*)::int AS count
    FROM partner_submissions
    WHERE status = 'submitted'
      AND unmapped_target_label IS NOT NULL
      AND career_target_id IS NULL
    GROUP BY unmapped_target_label
    ORDER BY count DESC, unmapped_target_label
    LIMIT 20
  `);
  return r.rows as unknown as UnmappedLabel[];
}
