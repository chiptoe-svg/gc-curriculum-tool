import { createHash } from 'node:crypto';
import type { BundleStratum } from '@/lib/db/schema';
import { formatDescriptorLines } from '@/lib/catalog/descriptors';

export const STRATA = ['foundational', 'technical', 'business', 'workflow_ai'] as const satisfies readonly BundleStratum[];

export interface BundleSummary { id: string; name: string; knowDescriptor: string | null; understandDescriptor: string | null; doDescriptor: string; origin: string }
export interface CardFields { stratum: BundleStratum; includes: string; excludes: string; distinctions: string; positiveExamples: string[]; negativeExamples: string[] }
export interface ReviewCard extends CardFields { competencyId: string; name: string }
export interface CardsReviewFile { _approval: string; drafted: { model: string; promptVersion: string; at: string; costUsdCents: number }; cards: ReviewCard[] }

export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Ruling 7: the vector carries what the bundle IS, not what it excludes. */
export function cardEmbedText(bundle: BundleSummary, card: CardFields): string {
  return [
    bundle.name,
    ...formatDescriptorLines(bundle),
    `Includes: ${card.includes}`,
    `Examples: ${card.positiveExamples.join('; ')}`,
  ].join('\n');
}

function nonEmptyString(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`cards file: ${where} must be a non-empty string`);
  return v.trim();
}

function examples(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > 3) throw new Error(`cards file: ${where} must have 2–3 entries`);
  return v.map((e, i) => nonEmptyString(e, `${where}[${i}]`));
}

export function parseCardsReviewFile(json: unknown, activeBundleIds: ReadonlySet<string>, opts: { requireApproval: boolean }): CardsReviewFile {
  if (typeof json !== 'object' || json === null) throw new Error('cards file: not an object');
  const o = json as Record<string, unknown>;
  const approval = typeof o._approval === 'string' ? o._approval.trim() : '';
  if (opts.requireApproval && approval === '') throw new Error('cards file: _approval is empty — the owner has not approved this file');
  const drafted = o.drafted as CardsReviewFile['drafted'] | undefined;
  if (!drafted || typeof drafted.model !== 'string') throw new Error('cards file: drafted block missing');
  if (!Array.isArray(o.cards)) throw new Error('cards file: cards must be an array');
  const seen = new Set<string>();
  const cards: ReviewCard[] = o.cards.map((raw, i) => {
    const c = raw as Record<string, unknown>;
    const id = nonEmptyString(c.competencyId, `cards[${i}].competencyId`);
    if (!activeBundleIds.has(id)) throw new Error(`cards file: ${id} is not an active catalog competency`);
    if (seen.has(id)) throw new Error(`cards file: duplicate card for ${id}`);
    seen.add(id);
    const stratum = c.stratum;
    if (typeof stratum !== 'string' || !(STRATA as readonly string[]).includes(stratum)) throw new Error(`cards file: ${id}: stratum must be one of ${STRATA.join(', ')}`);
    return {
      competencyId: id,
      name: nonEmptyString(c.name, `${id}.name`),
      stratum: stratum as BundleStratum,
      includes: nonEmptyString(c.includes, `${id}.includes`),
      excludes: nonEmptyString(c.excludes, `${id}.excludes`),
      distinctions: nonEmptyString(c.distinctions, `${id}.distinctions`),
      positiveExamples: examples(c.positiveExamples, `${id}.positiveExamples`),
      negativeExamples: examples(c.negativeExamples, `${id}.negativeExamples`),
    };
  });
  for (const id of activeBundleIds) if (!seen.has(id)) throw new Error(`cards file: no card for active competency ${id}`);
  cards.sort((a, b) => a.competencyId.localeCompare(b.competencyId));
  return { _approval: approval, drafted, cards };
}

// ─── Task 7: seeded stratified golden-sample draw ──────────────────────────

/** Ruling 3: quotas across the 4 strata, summing to GOLDEN_SIZE. */
export const GOLDEN_QUOTAS: Readonly<Record<BundleStratum, number>> = { foundational: 2, technical: 3, business: 2, workflow_ai: 1 };
export const GOLDEN_SIZE = 8;

function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates shuffle, seeded by `seed`. Does not mutate `items`. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rand = mulberry32(parseInt(textHash(seed).slice(0, 8), 16));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Spec §4: 8 bundles, seeded, spread across strata (Ruling 3 quotas), shortfalls filled from the rest. */
export function drawGoldenSample(bundles: Array<{ id: string; stratum: BundleStratum }>, seed: string): Array<{ id: string; stratum: BundleStratum }> {
  const pool = seededShuffle([...bundles].sort((a, b) => a.id.localeCompare(b.id)), seed);
  const picked: Array<{ id: string; stratum: BundleStratum }> = [];
  for (const stratum of STRATA) {
    picked.push(...pool.filter(b => b.stratum === stratum).slice(0, GOLDEN_QUOTAS[stratum]));
  }
  const pickedIds = new Set(picked.map(p => p.id));
  for (const b of pool) {
    if (picked.length >= Math.min(GOLDEN_SIZE, bundles.length)) break;
    if (!pickedIds.has(b.id)) { picked.push(b); pickedIds.add(b.id); }
  }
  return picked;
}
