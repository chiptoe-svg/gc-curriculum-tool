import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, bundleCards } from '@/lib/db/schema';
import type { Tx } from '@/lib/db/competency-catalog-queries';
import type { BundleSummary, CardFields, ReviewCard } from '@/lib/catalog/bundles';

export type Executor = Tx | typeof db;

/** Active catalog bundles: every non-retired sub_competency (merged rows are retired by 0057's CHECK). */
export async function listActiveBundles(ex: Executor = db): Promise<BundleSummary[]> {
  return ex.select({
    id: subCompetencies.id, name: subCompetencies.name,
    knowDescriptor: subCompetencies.knowDescriptor, understandDescriptor: subCompetencies.understandDescriptor,
    doDescriptor: subCompetencies.doDescriptor, origin: subCompetencies.origin,
  }).from(subCompetencies).where(eq(subCompetencies.retired, false)).orderBy(asc(subCompetencies.id));
}

export async function readConfirmedCards(ex: Executor = db): Promise<Map<string, CardFields>> {
  const rows = await ex.select().from(bundleCards).where(eq(bundleCards.status, 'confirmed'));
  return new Map(rows.map(r => [r.competencyId, {
    stratum: r.stratum, includes: r.includes, excludes: r.excludes, distinctions: r.distinctions,
    positiveExamples: r.positiveExamples, negativeExamples: r.negativeExamples,
  }]));
}

/** Inserts or replaces each card as confirmed by `confirmedBy`. One call = one approved review file. */
export async function upsertConfirmedCards(ex: Executor, cards: ReviewCard[], confirmedBy: string): Promise<{ inserted: number; updated: number }> {
  let inserted = 0; let updated = 0;
  for (const c of cards) {
    const existing = await ex.select({ id: bundleCards.competencyId }).from(bundleCards).where(eq(bundleCards.competencyId, c.competencyId));
    const values = {
      competencyId: c.competencyId, stratum: c.stratum, includes: c.includes, excludes: c.excludes, distinctions: c.distinctions,
      positiveExamples: c.positiveExamples, negativeExamples: c.negativeExamples,
      status: 'confirmed' as const, confirmedBy, confirmedAt: sql`now()` as unknown as Date, updatedAt: sql`now()` as unknown as Date,
    };
    if (existing.length === 0) { await ex.insert(bundleCards).values(values); inserted++; }
    else { await ex.update(bundleCards).set(values).where(eq(bundleCards.competencyId, c.competencyId)); updated++; }
  }
  return { inserted, updated };
}
