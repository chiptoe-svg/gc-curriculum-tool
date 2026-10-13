import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  subCompetencies, bundleCards, itemEmbeddings, onetTaskStatements, bundleGoldenSamples,
  bundleGoldenPicks, bundleMembers, bundleMappingOutcomes, onetElementDefinitions,
} from '@/lib/db/schema';
import type { BundleStratum, GoldenCandidate } from '@/lib/db/schema';
import type { Tx } from '@/lib/db/competency-catalog-queries';
import type { BundleSummary, CardFields, ReviewCard } from '@/lib/catalog/bundles';
import { textHash } from '@/lib/catalog/bundles';
import type { TaskRow } from '@/lib/catalog/shortlist';
import { itemKey, type AgreementInput, type Pos } from '@/lib/catalog/agreement';
import { TASK_SHORTLIST_K } from '@/lib/ai/catalog/map-bundle-onet';

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

// ─── Task 9: reconcile + agreement inputs ──────────────────────────────────

export interface ReconcileResult { skipped: boolean; confirmed: number; added: number; disagreements: number }

/**
 * Spec §5 reconcile, plan Ruling 8. For a SUBMITTED sample, compares the
 * sample reviewer's blind picks with the bundle's members:
 *   - agreement on a proposed row → confirmed by the reviewer;
 *   - reviewer-only item → added (proposed_by 'reviewer', confirmed);
 *   - position disagreement on a proposed row → stays proposed, note records the pick;
 *   - AI-only rows are never touched.
 * Idempotent; never changes a confirmed or rejected row (a human decision).
 * Callers run it in the same transaction as the write that triggers it.
 */
export async function reconcileBundle(ex: Executor, bundleId: string): Promise<ReconcileResult> {
  const [sample] = await ex.select().from(bundleGoldenSamples).where(eq(bundleGoldenSamples.bundleId, bundleId));
  if (!sample || !sample.submittedAt || !sample.reviewer) return { skipped: true, confirmed: 0, added: 0, disagreements: 0 };
  const reviewer = sample.reviewer;
  const picks = await ex.select().from(bundleGoldenPicks).where(and(
    eq(bundleGoldenPicks.bundleId, bundleId), eq(bundleGoldenPicks.reviewer, reviewer), eq(bundleGoldenPicks.noCleanMatch, false),
  ));
  const members = await ex.select().from(bundleMembers).where(eq(bundleMembers.bundleId, bundleId));
  const k = (s: string, rel: string | null, ext: string, soc: string | null) => `${s}|${rel ?? ''}|${ext}|${soc ?? ''}`;
  const byKey = new Map(members.map(m => [k(m.source, m.release, m.externalId, m.onetSocCode), m]));
  const labelByTask = new Map<string, string>();
  for (const c of sample.candidates) for (const m of c.members) labelByTask.set(`${m.taskId}|${m.onetSocCode}`, c.label);
  let confirmed = 0, added = 0, disagreements = 0;
  for (const p of picks) {
    const m = byKey.get(k(p.source!, p.release, p.externalId!, p.onetSocCode));
    if (!m) {
      const label = p.source === 'onet_task'
        ? (labelByTask.get(`${p.externalId}|${p.onetSocCode}`) ?? p.externalId!)
        : await elementName(ex, p.release!, p.externalId!);
      const inserted = await ex.insert(bundleMembers).values({
        bundleId, source: p.source!, externalId: p.externalId!, externalLabel: label, onetSocCode: p.onetSocCode, release: p.release,
        position: p.position!, aiPosition: null, status: 'confirmed', proposedBy: 'reviewer', rationale: null,
        confirmedBy: reviewer, confirmedAt: sql`now()` as unknown as Date, reviewNote: 'blind pick (reconcile)',
      }).onConflictDoNothing().returning({ id: bundleMembers.id });
      added += inserted.length;
    } else if (m.status === 'proposed') {
      if (m.position === p.position) {
        confirmed += await confirmProposedMember(ex, m.id, p.position!, reviewer);
      } else {
        const note = `blind pick: ${p.position}`;
        // Already noted: count it, write nothing (idempotence). Otherwise the
        // guarded write decides — a row decided meanwhile is not counted.
        if (m.reviewNote === note) disagreements++;
        else disagreements += await noteProposedDisagreement(ex, m.id, note);
      }
    }
  }
  return { skipped: false, confirmed, added, disagreements };
}

/**
 * Guarded writes (review fix 1): the `status = 'proposed'` check in
 * reconcileBundle reads a snapshot, so each UPDATE re-checks it in SQL. A
 * reviewer's reject or position change that commits between the read and
 * the write therefore wins — the UPDATE matches 0 rows. Return the row count.
 */
export async function confirmProposedMember(ex: Executor, id: string, position: Pos, reviewer: string): Promise<number> {
  const rows = await ex.update(bundleMembers)
    .set({ status: 'confirmed', confirmedBy: reviewer, confirmedAt: sql`now()` as unknown as Date, reviewNote: 'blind pick agreed (reconcile)', updatedAt: sql`now()` as unknown as Date })
    .where(and(eq(bundleMembers.id, id), eq(bundleMembers.status, 'proposed'), eq(bundleMembers.position, position)))
    .returning({ id: bundleMembers.id });
  return rows.length;
}

export async function noteProposedDisagreement(ex: Executor, id: string, note: string): Promise<number> {
  const rows = await ex.update(bundleMembers)
    .set({ reviewNote: note, updatedAt: sql`now()` as unknown as Date })
    .where(and(eq(bundleMembers.id, id), eq(bundleMembers.status, 'proposed')))
    .returning({ id: bundleMembers.id });
  return rows.length;
}

async function elementName(ex: Executor, release: string, elementId: string): Promise<string> {
  const [d] = await ex.select({ n: onetElementDefinitions.elementName }).from(onetElementDefinitions)
    .where(and(eq(onetElementDefinitions.release, release), eq(onetElementDefinitions.elementId, elementId)));
  return d?.n ?? elementId;
}

type PickRow = typeof bundleGoldenPicks.$inferSelect;

/** Maps one reviewer's picks to agreement keys. Task picks key by the candidate group that holds (taskId, soc). */
function blindKeys(picks: PickRow[], candidates: GoldenCandidate[], bundleId: string): { blind: Map<string, Pos>; ranks: Map<string, number> } {
  const candByTask = new Map<string, GoldenCandidate>();
  for (const c of candidates) for (const m of c.members) candByTask.set(`${m.taskId}|${m.onetSocCode}`, c);
  const blind = new Map<string, Pos>();
  const ranks = new Map<string, number>();
  for (const p of picks) {
    if (p.noCleanMatch) continue;
    if (p.source === 'onet_element') {
      blind.set(itemKey('onet_element', p.externalId!), p.position!);
    } else {
      const c = candByTask.get(`${p.externalId}|${p.onetSocCode}`);
      if (!c) throw new Error(`readAgreementInputs: ${bundleId} pick for task ${p.externalId} (${p.onetSocCode}) is not in the sample's candidates`);
      const key = itemKey('onet_task', c.label);
      blind.set(key, p.position!);
      ranks.set(key, c.rank);
    }
  }
  return { blind, ranks };
}

/**
 * Read-only inputs for the agreement report. Only SUBMITTED samples feed
 * `inputs` and `secondReviewerPairs`; `noMatch` lists active bundles whose
 * latest ok mapping outcome had no clean match, excluding bundles whose
 * blind sample is still unsubmitted (the reviewer must not see AI output).
 * A submitted sample feeds `inputs` only once its bundle has at least one
 * `ok` mapping outcome; until then it is listed in `notYetMapped` instead, so
 * an unmapped bundle (aiCount 0) never drags the pooled figures toward 0
 * (review fix 2). Second-reviewer κ is human-vs-human and needs no mapping.
 */
export async function readAgreementInputs(ex: Executor = db): Promise<{
  inputs: AgreementInput[];
  noMatch: Array<{ bundleId: string; note: string | null }>;
  notYetMapped: string[];
  secondReviewerPairs: Array<{ bundleId: string; a: Array<Pos | 'none'>; b: Array<Pos | 'none'> }>;
}> {
  const allSamples = await ex.select().from(bundleGoldenSamples).orderBy(asc(bundleGoldenSamples.bundleId));
  const samples = allSamples.filter(s => s.submittedAt !== null && s.reviewer !== null);
  const unsubmitted = new Set(allSamples.filter(s => s.submittedAt === null).map(s => s.bundleId));

  const outcomes = await ex.select({
    bundleId: bundleMappingOutcomes.bundleId, noCleanMatch: bundleMappingOutcomes.noCleanMatch, note: bundleMappingOutcomes.note,
  }).from(bundleMappingOutcomes).where(eq(bundleMappingOutcomes.status, 'ok'))
    .orderBy(asc(bundleMappingOutcomes.bundleId), desc(bundleMappingOutcomes.createdAt));
  const latest = new Map<string, { noCleanMatch: boolean; note: string | null }>();
  for (const o of outcomes) if (!latest.has(o.bundleId)) latest.set(o.bundleId, o);

  const inputs: AgreementInput[] = [];
  const notYetMapped: string[] = [];
  const secondReviewerPairs: Array<{ bundleId: string; a: Array<Pos | 'none'>; b: Array<Pos | 'none'> }> = [];
  let elementKeys: string[] | null = null;

  for (const s of samples) {
    const members = await ex.select().from(bundleMembers).where(and(eq(bundleMembers.bundleId, s.bundleId), ne(bundleMembers.proposedBy, 'reviewer')));
    const ai = new Map<string, Pos>();
    for (const m of members) {
      if (m.source !== 'onet_element' && m.source !== 'onet_task') continue;
      ai.set(itemKey(m.source, m.source === 'onet_element' ? m.externalId : m.externalLabel), m.aiPosition ?? m.position);
    }
    const picks = await ex.select().from(bundleGoldenPicks).where(eq(bundleGoldenPicks.bundleId, s.bundleId));
    const own = blindKeys(picks.filter(p => p.reviewer === s.reviewer), s.candidates, s.bundleId);
    if (!latest.has(s.bundleId)) notYetMapped.push(s.bundleId);
    else inputs.push({ bundleId: s.bundleId, ai, blind: own.blind, blindTaskRanks: own.ranks, shortlistK: TASK_SHORTLIST_K });

    const reviewers = [...new Set(picks.map(p => p.reviewer))].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    if (reviewers.length >= 2) {
      if (elementKeys === null) {
        const defs = await ex.selectDistinct({ id: onetElementDefinitions.elementId }).from(onetElementDefinitions);
        elementKeys = defs.map(d => itemKey('onet_element', d.id));
      }
      const [ra, rb] = [blindKeys(picks.filter(p => p.reviewer === reviewers[0]), s.candidates, s.bundleId).blind,
        blindKeys(picks.filter(p => p.reviewer === reviewers[1]), s.candidates, s.bundleId).blind];
      const universe = [...new Set([...elementKeys, ...s.candidates.map(c => itemKey('onet_task', c.label)), ...ra.keys(), ...rb.keys()])].sort();
      secondReviewerPairs.push({
        bundleId: s.bundleId,
        a: universe.map(key => ra.get(key) ?? 'none'),
        b: universe.map(key => rb.get(key) ?? 'none'),
      });
    }
  }

  const active = new Set((await listActiveBundles(ex)).map(b => b.id));
  const noMatch = [...latest.entries()]
    .filter(([id, o]) => o.noCleanMatch && active.has(id) && !unsubmitted.has(id))
    .map(([bundleId, o]) => ({ bundleId, note: o.note }));

  return { inputs, noMatch, notYetMapped, secondReviewerPairs };
}
