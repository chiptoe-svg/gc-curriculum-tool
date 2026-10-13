import { createHash } from 'node:crypto';
import type { BundleStratum } from '@/lib/db/schema';

export const STRATA = ['foundational', 'technical', 'business', 'workflow_ai'] as const satisfies readonly BundleStratum[];

export interface BundleSummary { id: string; name: string; knowDescriptor: string; understandDescriptor: string; doDescriptor: string; origin: string }
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
    `Know: ${bundle.knowDescriptor}`,
    `Understand: ${bundle.understandDescriptor}`,
    `Do: ${bundle.doDescriptor}`,
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
