import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, bundleCards, itemEmbeddings, onetTaskStatements, bundleGoldenSamples } from '@/lib/db/schema';
import type { BundleStratum, GoldenCandidate } from '@/lib/db/schema';
import type { Tx } from '@/lib/db/competency-catalog-queries';
import type { BundleSummary, CardFields, ReviewCard } from '@/lib/catalog/bundles';
import { textHash } from '@/lib/catalog/bundles';
import type { TaskRow } from '@/lib/catalog/shortlist';

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

// ─── Task 6: embedding cache ────────────────────────────────────────────────

export async function readTaskStatements(release: string, ex: Executor = db): Promise<TaskRow[]> {
  return ex.select({ taskId: onetTaskStatements.taskId, onetSocCode: onetTaskStatements.onetSocCode, task: onetTaskStatements.task })
    .from(onetTaskStatements).where(eq(onetTaskStatements.release, release));
}

export interface EmbedItem { kind: 'bundle_card' | 'onet_task'; ref: string; text: string }

/** Embeds only items whose (kind, ref, model, sha256(text)) row is absent. Batches through `embed`. */
export async function embedMissing(ex: Executor, items: EmbedItem[], model: string, embed: (texts: string[]) => Promise<number[][]>): Promise<{ cached: number; embedded: number }> {
  const existing = await ex.select({ kind: itemEmbeddings.kind, ref: itemEmbeddings.ref, textHash: itemEmbeddings.textHash })
    .from(itemEmbeddings).where(eq(itemEmbeddings.model, model));
  const have = new Set(existing.map(r => `${r.kind}|${r.ref}|${r.textHash}`));
  const missing = items.filter(i => !have.has(`${i.kind}|${i.ref}|${textHash(i.text)}`));
  if (missing.length === 0) return { cached: items.length, embedded: 0 };
  const vectors = await embed(missing.map(m => m.text));
  if (vectors.length !== missing.length) throw new Error(`embedMissing: got ${vectors.length} vectors for ${missing.length} texts`);
  for (let i = 0; i < missing.length; i += 200) {
    await ex.insert(itemEmbeddings).values(missing.slice(i, i + 200).map((m, j) => ({
      kind: m.kind, ref: m.ref, model, textHash: textHash(m.text), vector: vectors[i + j]!,
    }))).onConflictDoNothing();
  }
  return { cached: items.length - missing.length, embedded: missing.length };
}

export async function readVectors(ex: Executor, kind: EmbedItem['kind'], wanted: Array<{ ref: string; text: string }>, model: string): Promise<Map<string, number[]>> {
  if (wanted.length === 0) return new Map();
  const hashByRef = new Map(wanted.map(w => [w.ref, textHash(w.text)]));
  const rows = await ex.select({ ref: itemEmbeddings.ref, textHash: itemEmbeddings.textHash, vector: itemEmbeddings.vector })
    .from(itemEmbeddings)
    .where(and(eq(itemEmbeddings.kind, kind), eq(itemEmbeddings.model, model), inArray(itemEmbeddings.ref, [...hashByRef.keys()])));
  const out = new Map<string, number[]>();
  for (const r of rows) if (hashByRef.get(r.ref) === r.textHash) out.set(r.ref, r.vector);
  return out;
}

// ─── Task 7: golden-sample draw ────────────────────────────────────────────

/** Plain insert of each sampled bundle's seed + top-50 candidates (Ruling 4) into bundle_golden_samples. */
export async function insertGoldenSamples(
  ex: Executor,
  rows: Array<{ bundleId: string; stratum: BundleStratum; seed: string; candidates: GoldenCandidate[] }>,
): Promise<void> {
  if (rows.length === 0) return;
  await ex.insert(bundleGoldenSamples).values(rows.map(r => ({
    bundleId: r.bundleId, stratum: r.stratum, sampleSeed: r.seed, candidates: r.candidates,
  })));
}
