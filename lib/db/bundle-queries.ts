import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  subCompetencies, bundleCards, itemEmbeddings, onetTaskStatements, bundleGoldenSamples,
  bundleGoldenPicks, bundleMembers, bundleMappingOutcomes, bundleMappingRuns, onetElementDefinitions,
} from '@/lib/db/schema';
import type { BundleStratum, GoldenCandidate } from '@/lib/db/schema';
import type { Tx } from '@/lib/db/competency-catalog-queries';
import type { BundleSummary, CardFields, ReviewCard } from '@/lib/catalog/bundles';
import { textHash } from '@/lib/catalog/bundles';
import type { TaskRow } from '@/lib/catalog/shortlist';
import { itemKey, type AgreementInput, type Pos } from '@/lib/catalog/agreement';
import { TASK_SHORTLIST_K } from '@/lib/catalog/shortlist';
import type { ElementDef, MemberRow } from '@/lib/ai/catalog/map-bundle-onet';

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

/** review_note values written by reconcileBundle — resetBlind keys its undo on these exact strings. */
const RECONCILE_AGREED_NOTE = 'blind pick agreed (reconcile)';
const RECONCILE_ADDED_NOTE = 'blind pick (reconcile)';
const RECONCILE_DISAGREE_PREFIX = 'blind pick: ';

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
        confirmedBy: reviewer, confirmedAt: sql`now()` as unknown as Date, reviewNote: RECONCILE_ADDED_NOTE,
      }).onConflictDoNothing().returning({ id: bundleMembers.id });
      added += inserted.length;
    } else if (m.status === 'proposed') {
      if (m.position === p.position) {
        confirmed += await confirmProposedMember(ex, m.id, p.position!, reviewer);
      } else {
        const note = `${RECONCILE_DISAGREE_PREFIX}${p.position}`;
        // Already noted, or holding a reviewer's own note (ruling D: never
        // clobbered): count it, write nothing (idempotence). Otherwise the
        // guarded write decides — a row decided meanwhile is not counted.
        if (m.reviewNote === note || (m.reviewNote !== null && !m.reviewNote.startsWith(RECONCILE_DISAGREE_PREFIX))) disagreements++;
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
    .set({ status: 'confirmed', confirmedBy: reviewer, confirmedAt: sql`now()` as unknown as Date, reviewNote: RECONCILE_AGREED_NOTE, updatedAt: sql`now()` as unknown as Date })
    .where(and(eq(bundleMembers.id, id), eq(bundleMembers.status, 'proposed'), eq(bundleMembers.position, position)))
    .returning({ id: bundleMembers.id });
  return rows.length;
}

/**
 * Writes reconcile's disagreement note on a still-proposed row. Controller
 * ruling D: only over an empty note or an earlier reconcile note ('blind
 * pick: …') — a reviewer's own note is never clobbered.
 */
export async function noteProposedDisagreement(ex: Executor, id: string, note: string): Promise<number> {
  const rows = await ex.update(bundleMembers)
    .set({ reviewNote: note, updatedAt: sql`now()` as unknown as Date })
    .where(and(
      eq(bundleMembers.id, id), eq(bundleMembers.status, 'proposed'),
      sql`(${bundleMembers.reviewNote} IS NULL OR starts_with(${bundleMembers.reviewNote}, ${RECONCILE_DISAGREE_PREFIX}))`,
    ))
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

// ─── Task 10: mapping writer ───────────────────────────────────────────────

export async function readElementDefinitions(release: string, ex: Executor = db): Promise<ElementDef[]> {
  return ex.select({
    elementId: onetElementDefinitions.elementId, elementName: onetElementDefinitions.elementName,
    domain: onetElementDefinitions.domain, description: onetElementDefinitions.description,
  }).from(onetElementDefinitions).where(eq(onetElementDefinitions.release, release))
    .orderBy(asc(onetElementDefinitions.elementId));
}

/** Inserts a mapping run row (dry_run false: dry runs write nothing — plan Ruling 10). Returns its id. */
export async function createRun(ex: Executor, r: { model: string; promptVersion: string; taskShortlistK: number; bundleCount: number }): Promise<string> {
  const [row] = await ex.insert(bundleMappingRuns).values({
    model: r.model, promptVersion: r.promptVersion, taskShortlistK: r.taskShortlistK, bundleCount: r.bundleCount, dryRun: false,
  }).returning({ id: bundleMappingRuns.id });
  return row!.id;
}

export async function finishRun(ex: Executor, runId: string, costUsdCents: number): Promise<void> {
  await ex.update(bundleMappingRuns)
    .set({ finishedAt: sql`now()` as unknown as Date, costUsdCents })
    .where(eq(bundleMappingRuns.id, runId));
}

/**
 * Writes one bundle's placement (spec §4 D). Invariant: a bundle's rows are
 * the complete old set or the complete new set — never partial — and a
 * confirmed or rejected row (a human decision) is never deleted or changed.
 *
 * In one transaction: delete the bundle's still-`proposed` rows, insert the
 * new rows as `proposed` (a conflict means a decided row already holds that
 * item — it is kept, counted in `keptDecided`), record the `ok` outcome,
 * then reconcile against a submitted blind sample (plan Ruling 8).
 *
 * Always opens its own transaction: a real one on `db`, a savepoint inside a
 * caller-owned transaction, so a failure rolls back exactly this bundle's
 * write and leaves the caller's transaction usable.
 */
export async function writeBundleProposals(
  ex: Executor,
  args: { runId: string; bundleId: string; rows: MemberRow[]; model: string; noCleanMatch: boolean; note: string | null; costUsdCents: number },
): Promise<{ deleted: number; inserted: number; keptDecided: number; reconcile: ReconcileResult }> {
  return ex.transaction(async (tx) => {
    // Reruns replace ONLY proposed rows; confirmed/rejected are never touched.
    const deleted = await tx.delete(bundleMembers)
      .where(and(eq(bundleMembers.bundleId, args.bundleId), eq(bundleMembers.status, 'proposed')))
      .returning({ id: bundleMembers.id });
    let inserted = 0;
    if (args.rows.length > 0) {
      const res = await tx.insert(bundleMembers).values(args.rows.map(r => ({
        bundleId: args.bundleId, source: r.source, externalId: r.externalId, externalLabel: r.externalLabel,
        onetSocCode: r.onetSocCode, release: r.release, position: r.position, aiPosition: r.position,
        status: 'proposed' as const, proposedBy: args.model, rationale: r.rationale, runId: args.runId,
      }))).onConflictDoNothing({
        target: [bundleMembers.bundleId, bundleMembers.source, bundleMembers.release, bundleMembers.externalId, bundleMembers.onetSocCode],
      }).returning({ id: bundleMembers.id });
      inserted = res.length;
    }
    await tx.insert(bundleMappingOutcomes).values({
      runId: args.runId, bundleId: args.bundleId, status: 'ok', noCleanMatch: args.noCleanMatch, note: args.note, costUsdCents: args.costUsdCents,
    });
    const reconcile = await reconcileBundle(tx, args.bundleId);
    // After the delete only decided rows survive, so every conflict is a decided row.
    return { deleted: deleted.length, inserted, keptDecided: args.rows.length - inserted, reconcile };
  });
}

/**
 * Records a failed outcome for one bundle; touches no members. A retry inside
 * the same run overwrites its own failure, but never an `ok` outcome.
 */
export async function recordFailedOutcome(ex: Executor, args: { runId: string; bundleId: string; note: string; costUsdCents: number }): Promise<void> {
  await ex.insert(bundleMappingOutcomes).values({
    runId: args.runId, bundleId: args.bundleId, status: 'failed', noCleanMatch: false, note: args.note, costUsdCents: args.costUsdCents,
  }).onConflictDoUpdate({
    target: [bundleMappingOutcomes.runId, bundleMappingOutcomes.bundleId],
    set: { note: args.note, costUsdCents: args.costUsdCents, createdAt: sql`now()` as unknown as Date },
    setWhere: eq(bundleMappingOutcomes.status, 'failed'),
  });
}

/** Bundles with at least one `ok` mapping outcome in any run (drives `--missing`). */
export async function bundlesWithOkOutcome(ex: Executor = db): Promise<Set<string>> {
  const rows = await ex.selectDistinct({ id: bundleMappingOutcomes.bundleId }).from(bundleMappingOutcomes)
    .where(eq(bundleMappingOutcomes.status, 'ok'));
  return new Set(rows.map(r => r.id));
}

// ─── Task 11: admin review queries (blindness enforced here) ──────────────

export const ONET_ATTRIBUTION = 'This product includes information from O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license.';
/** The release the review page shows element definitions for. */
const REVIEW_RELEASE = '31.0';

export function validateReviewer(v: unknown): { reviewer: string } | { error: string } {
  if (typeof v !== 'string') return { error: 'reviewer is required' };
  const reviewer = v.trim();
  if (reviewer.length < 1 || reviewer.length > 80) return { error: 'reviewer must be 1–80 characters' };
  return { reviewer };
}

/**
 * The ONE blindness predicate: a bundle is locked while it is in the blind
 * sample and its pick is unsubmitted. Every read and write below goes through
 * it, so AI placements never leave the server for a locked bundle.
 */
function isLockedSample(sample: { submittedAt: Date | null } | undefined): boolean {
  return sample !== undefined && sample.submittedAt === null;
}

/** True while a bundle is in the blind sample and its pick is not submitted: AI placements must not leave the server. */
export async function isBlindLocked(bundleId: string, ex: Executor = db): Promise<boolean> {
  const [s] = await ex.select({ submittedAt: bundleGoldenSamples.submittedAt }).from(bundleGoldenSamples).where(eq(bundleGoldenSamples.bundleId, bundleId));
  return isLockedSample(s);
}

/** Row-locks the sample (FOR UPDATE) so submit / reset / queue writes on one bundle serialize. */
async function lockSample(ex: Executor, bundleId: string) {
  const [s] = await ex.select().from(bundleGoldenSamples).where(eq(bundleGoldenSamples.bundleId, bundleId)).for('update');
  return s;
}

async function bundleExists(ex: Executor, bundleId: string): Promise<boolean> {
  const rows = await ex.select({ id: subCompetencies.id }).from(subCompetencies)
    .where(and(eq(subCompetencies.id, bundleId), eq(subCompetencies.retired, false)));
  return rows.length > 0;
}

/** Latest `ok` mapping outcome per bundle. */
async function latestOkOutcomes(ex: Executor, bundleIds?: string[]): Promise<Map<string, { noCleanMatch: boolean; note: string | null }>> {
  const where = bundleIds
    ? and(eq(bundleMappingOutcomes.status, 'ok'), inArray(bundleMappingOutcomes.bundleId, bundleIds))
    : eq(bundleMappingOutcomes.status, 'ok');
  const rows = await ex.select({ bundleId: bundleMappingOutcomes.bundleId, noCleanMatch: bundleMappingOutcomes.noCleanMatch, note: bundleMappingOutcomes.note })
    .from(bundleMappingOutcomes).where(where)
    .orderBy(asc(bundleMappingOutcomes.bundleId), desc(bundleMappingOutcomes.createdAt));
  const out = new Map<string, { noCleanMatch: boolean; note: string | null }>();
  for (const r of rows) if (!out.has(r.bundleId)) out.set(r.bundleId, { noCleanMatch: r.noCleanMatch, note: r.note });
  return out;
}

export interface BundleListItem { id: string; name: string; stratum: string | null; sampled: boolean; submitted: boolean; counts: { proposed: number; confirmed: number; rejected: number } | null; noCleanMatch: boolean | null }

/** Every active bundle. `counts` and `noCleanMatch` are null while blind-locked (they would reveal the AI's placements). */
export async function listBundlesForReview(ex: Executor = db): Promise<BundleListItem[]> {
  const bundles = await listActiveBundles(ex);
  const cards = await ex.select({ id: bundleCards.competencyId, stratum: bundleCards.stratum }).from(bundleCards);
  const stratum = new Map(cards.map(c => [c.id, c.stratum]));
  const samples = new Map((await ex.select({ id: bundleGoldenSamples.bundleId, submittedAt: bundleGoldenSamples.submittedAt })
    .from(bundleGoldenSamples)).map(s => [s.id, s]));
  const countRows = await ex.select({ id: bundleMembers.bundleId, status: bundleMembers.status, n: sql<number>`count(*)::int` })
    .from(bundleMembers).groupBy(bundleMembers.bundleId, bundleMembers.status);
  const counts = new Map<string, { proposed: number; confirmed: number; rejected: number }>();
  for (const r of countRows) {
    const c = counts.get(r.id) ?? { proposed: 0, confirmed: 0, rejected: 0 };
    c[r.status] = r.n;
    counts.set(r.id, c);
  }
  const outcomes = await latestOkOutcomes(ex);
  return bundles.map(b => {
    const s = samples.get(b.id);
    const locked = isLockedSample(s);
    return {
      id: b.id, name: b.name, stratum: stratum.get(b.id) ?? null,
      sampled: s !== undefined, submitted: s !== undefined && s.submittedAt !== null,
      counts: locked ? null : (counts.get(b.id) ?? { proposed: 0, confirmed: 0, rejected: 0 }),
      noCleanMatch: locked ? null : (outcomes.get(b.id)?.noCleanMatch ?? null),
    };
  });
}

export interface MemberView { id: string; source: string; externalId: string; externalLabel: string; onetSocCode: string | null; position: string; aiPosition: string | null; status: string; proposedBy: string; rationale: string | null; reviewNote: string | null; bulkConfirmed: boolean }
export interface BundleDetail {
  bundle: BundleSummary;
  card: CardFields | null;
  elements: ElementDef[];
  sample: { candidates: GoldenCandidate[]; submitted: boolean; reviewer: string | null; picks: Array<{ source: string | null; externalId: string | null; onetSocCode: string | null; position: string | null; noCleanMatch: boolean }> } | null;
  members: MemberView[] | null;
  latestOutcome: { noCleanMatch: boolean; note: string | null } | null;
}

/** One bundle for review, or null if it is not an active bundle. `members` and `latestOutcome` are null while blind-locked. */
export async function readBundleDetail(bundleId: string, ex: Executor = db): Promise<BundleDetail | null> {
  const [bundle] = await ex.select({
    id: subCompetencies.id, name: subCompetencies.name,
    knowDescriptor: subCompetencies.knowDescriptor, understandDescriptor: subCompetencies.understandDescriptor,
    doDescriptor: subCompetencies.doDescriptor, origin: subCompetencies.origin,
  }).from(subCompetencies).where(and(eq(subCompetencies.id, bundleId), eq(subCompetencies.retired, false)));
  if (!bundle) return null;
  const [cardRow] = await ex.select().from(bundleCards).where(and(eq(bundleCards.competencyId, bundleId), eq(bundleCards.status, 'confirmed')));
  const card: CardFields | null = cardRow ? {
    stratum: cardRow.stratum, includes: cardRow.includes, excludes: cardRow.excludes, distinctions: cardRow.distinctions,
    positiveExamples: cardRow.positiveExamples, negativeExamples: cardRow.negativeExamples,
  } : null;
  const elements = await readElementDefinitions(REVIEW_RELEASE, ex);
  const [s] = await ex.select().from(bundleGoldenSamples).where(eq(bundleGoldenSamples.bundleId, bundleId));
  let sample: BundleDetail['sample'] = null;
  if (s) {
    const picks = s.reviewer === null ? [] : await ex.select({
      source: bundleGoldenPicks.source, externalId: bundleGoldenPicks.externalId, onetSocCode: bundleGoldenPicks.onetSocCode,
      position: bundleGoldenPicks.position, noCleanMatch: bundleGoldenPicks.noCleanMatch,
    }).from(bundleGoldenPicks).where(and(eq(bundleGoldenPicks.bundleId, bundleId), eq(bundleGoldenPicks.reviewer, s.reviewer)))
      .orderBy(asc(bundleGoldenPicks.source), asc(bundleGoldenPicks.externalId), asc(bundleGoldenPicks.onetSocCode));
    sample = { candidates: s.candidates, submitted: s.submittedAt !== null, reviewer: s.reviewer, picks };
  }
  if (isLockedSample(s)) return { bundle, card, elements, sample, members: null, latestOutcome: null };
  const rows = await ex.select().from(bundleMembers).where(eq(bundleMembers.bundleId, bundleId))
    .orderBy(asc(bundleMembers.source), asc(bundleMembers.externalLabel), asc(bundleMembers.onetSocCode));
  const members: MemberView[] = rows.map(m => ({
    id: m.id, source: m.source, externalId: m.externalId, externalLabel: m.externalLabel, onetSocCode: m.onetSocCode,
    position: m.position, aiPosition: m.aiPosition, status: m.status, proposedBy: m.proposedBy, rationale: m.rationale,
    reviewNote: m.reviewNote, bulkConfirmed: m.bulkConfirmed,
  }));
  const latestOutcome = (await latestOkOutcomes(ex, [bundleId])).get(bundleId) ?? null;
  return { bundle, card, elements, sample, members, latestOutcome };
}

export type BlindPickInput = { kind: 'element'; elementId: string; position: Pos } | { kind: 'task'; groupKey: string; position: Pos };

/**
 * Submits the blind pick (spec §5). Requires a sampled, unsubmitted bundle.
 * In the caller's ONE transaction (plan Ruling 8): replaces this reviewer's
 * picks, sets reviewer + submitted_at, then reconciles — so the unlock and
 * the reconcile commit together or not at all.
 */
export async function submitBlindPicks(
  ex: Executor, bundleId: string, reviewer: string, picks: BlindPickInput[], noCleanMatch: boolean, release: string,
): Promise<{ ok: true; reconcile: ReconcileResult } | { ok: false; status: 404 | 409 | 400; error: string }> {
  const sample = await lockSample(ex, bundleId);
  if (!sample) return { ok: false, status: 404, error: 'bundle is not in the blind sample' };
  if (sample.submittedAt !== null) return { ok: false, status: 409, error: 'blind sample already submitted' };
  if (noCleanMatch && picks.length > 0) return { ok: false, status: 400, error: 'no clean match cannot be combined with picks' };
  if (!noCleanMatch && picks.length === 0) return { ok: false, status: 400, error: 'pick at least one item, or choose no clean match' };

  const seen = new Set<string>();
  for (const p of picks) {
    const k = p.kind === 'element' ? `e|${p.elementId}` : `t|${p.groupKey}`;
    if (seen.has(k)) return { ok: false, status: 400, error: `duplicate pick: ${p.kind === 'element' ? p.elementId : p.groupKey}` };
    seen.add(k);
  }
  const elementIds = picks.flatMap(p => (p.kind === 'element' ? [p.elementId] : []));
  if (elementIds.length > 0) {
    const found = await ex.select({ id: onetElementDefinitions.elementId }).from(onetElementDefinitions)
      .where(and(eq(onetElementDefinitions.release, release), inArray(onetElementDefinitions.elementId, elementIds)));
    const have = new Set(found.map(f => f.id));
    const unknown = elementIds.find(id => !have.has(id));
    if (unknown !== undefined) return { ok: false, status: 400, error: `unknown element: ${unknown}` };
  }
  const candByKey = new Map(sample.candidates.map(c => [c.key, c]));
  const rows: Array<typeof bundleGoldenPicks.$inferInsert> = [];
  for (const p of picks) {
    if (p.kind === 'element') {
      rows.push({ bundleId, reviewer, source: 'onet_element', externalId: p.elementId, onetSocCode: null, release, position: p.position, noCleanMatch: false });
    } else {
      const c = candByKey.get(p.groupKey);
      if (!c) return { ok: false, status: 400, error: `task group ${p.groupKey} is not one of this sample's candidates` };
      for (const m of c.members) rows.push({ bundleId, reviewer, source: 'onet_task', externalId: m.taskId, onetSocCode: m.onetSocCode, release, position: p.position, noCleanMatch: false });
    }
  }
  if (noCleanMatch) rows.push({ bundleId, reviewer, noCleanMatch: true });

  await ex.delete(bundleGoldenPicks).where(and(eq(bundleGoldenPicks.bundleId, bundleId), eq(bundleGoldenPicks.reviewer, reviewer)));
  await ex.insert(bundleGoldenPicks).values(rows);
  await ex.update(bundleGoldenSamples).set({ reviewer, submittedAt: sql`now()` as unknown as Date }).where(eq(bundleGoldenSamples.bundleId, bundleId));
  const reconcile = await reconcileBundle(ex, bundleId);
  return { ok: true, reconcile };
}

export type MemberAction =
  | { action: 'confirm'; memberIds: string[] }
  | { action: 'reject'; memberIds: string[] }
  | { action: 'set_position'; memberIds: string[]; position: Pos }
  | { action: 'add'; item: { kind: 'element'; elementId: string } | { kind: 'task'; taskId: string; onetSocCode: string }; position: Pos };

/** 404 for an unknown bundle; 409 while blind-locked. Locks the sample row first (if any). */
async function queueGate(ex: Executor, bundleId: string): Promise<{ ok: false; status: 404 | 409; error: string } | null> {
  if (!(await bundleExists(ex, bundleId))) return { ok: false, status: 404, error: 'bundle not found' };
  if (isLockedSample(await lockSample(ex, bundleId))) return { ok: false, status: 409, error: 'blind sample not submitted' };
  return null;
}

/**
 * Queue decisions. confirm / reject / set_position act ONLY on this bundle's
 * still-`proposed` rows (a decided row is never re-decided; ids elsewhere are
 * not counted). set_position confirms the row — a position change is a
 * decision, and a still-proposed row would be replaced by a mapping rerun.
 * add inserts a reviewer row, confirmed, with no ai_position.
 */
export async function applyMemberAction(
  ex: Executor, bundleId: string, reviewer: string, a: MemberAction, release: string,
): Promise<{ ok: true; changed: number } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const gate = await queueGate(ex, bundleId);
  if (gate) return gate;
  const decided = { confirmedBy: reviewer, confirmedAt: sql`now()` as unknown as Date, updatedAt: sql`now()` as unknown as Date };
  const proposedOfBundle = (ids: string[]) => and(eq(bundleMembers.bundleId, bundleId), inArray(bundleMembers.id, ids), eq(bundleMembers.status, 'proposed'));

  if (a.action === 'confirm' || a.action === 'reject') {
    const rows = await ex.update(bundleMembers)
      .set({ status: a.action === 'confirm' ? 'confirmed' : 'rejected', ...decided })
      .where(proposedOfBundle(a.memberIds)).returning({ id: bundleMembers.id });
    return { ok: true, changed: rows.length };
  }
  if (a.action === 'set_position') {
    const rows = await ex.update(bundleMembers)
      .set({
        position: a.position, status: 'confirmed', ...decided,
        // SET expressions read the row's OLD values: ai_position is preserved.
        reviewNote: sql`'position changed from ' || coalesce(${bundleMembers.aiPosition}, ${bundleMembers.position})`,
      })
      .where(proposedOfBundle(a.memberIds)).returning({ id: bundleMembers.id });
    return { ok: true, changed: rows.length };
  }

  // add
  let label: string;
  let externalId: string;
  let soc: string | null;
  if (a.item.kind === 'element') {
    const [d] = await ex.select({ n: onetElementDefinitions.elementName }).from(onetElementDefinitions)
      .where(and(eq(onetElementDefinitions.release, release), eq(onetElementDefinitions.elementId, a.item.elementId)));
    if (!d) return { ok: false, status: 404, error: `unknown element: ${a.item.elementId}` };
    label = d.n; externalId = a.item.elementId; soc = null;
  } else {
    const [t] = await ex.select({ task: onetTaskStatements.task }).from(onetTaskStatements).where(and(
      eq(onetTaskStatements.release, release), eq(onetTaskStatements.onetSocCode, a.item.onetSocCode), eq(onetTaskStatements.taskId, a.item.taskId),
    ));
    if (!t) return { ok: false, status: 404, error: `unknown task: ${a.item.taskId} (${a.item.onetSocCode})` };
    label = t.task; externalId = a.item.taskId; soc = a.item.onetSocCode;
  }
  const inserted = await ex.insert(bundleMembers).values({
    bundleId, source: a.item.kind === 'element' ? 'onet_element' : 'onet_task', externalId, externalLabel: label, onetSocCode: soc, release,
    position: a.position, aiPosition: null, status: 'confirmed', proposedBy: 'reviewer', rationale: null,
    confirmedBy: reviewer, confirmedAt: sql`now()` as unknown as Date,
  }).onConflictDoNothing().returning({ id: bundleMembers.id });
  if (inserted.length === 0) return { ok: false, status: 409, error: 'already a member; use confirm or set_position' };
  return { ok: true, changed: 1 };
}

/** Confirms every still-`proposed` row of the bundle, flagged bulk_confirmed. */
export async function bulkConfirm(ex: Executor, bundleId: string, reviewer: string): Promise<{ ok: true; changed: number } | { ok: false; status: 404 | 409; error: string }> {
  const gate = await queueGate(ex, bundleId);
  if (gate) return gate;
  const rows = await ex.update(bundleMembers)
    .set({ status: 'confirmed', bulkConfirmed: true, confirmedBy: reviewer, confirmedAt: sql`now()` as unknown as Date, updatedAt: sql`now()` as unknown as Date })
    .where(and(eq(bundleMembers.bundleId, bundleId), eq(bundleMembers.status, 'proposed')))
    .returning({ id: bundleMembers.id });
  return { ok: true, changed: rows.length };
}

/**
 * Admin reset of a SUBMITTED blind sample (controller ruling C), so a
 * resubmission starts clean. In the caller's one transaction it undoes
 * exactly what reconcileBundle did for this bundle, keyed on reconcile's own
 * review_note strings:
 *   - rows reconcile confirmed ('blind pick agreed (reconcile)') go back to
 *     proposed, confirmed_by/at and the note cleared;
 *   - rows reconcile inserted (proposed_by 'reviewer', 'blind pick (reconcile)')
 *     are deleted;
 *   - reconcile's disagreement notes ('blind pick: …') on still-proposed rows
 *     are cleared.
 * Rows a reviewer decided in the queue are NEVER touched: queue actions only
 * decide proposed rows, and none of them writes a reconcile note. Then the
 * bundle's golden picks are deleted, submitted_at cleared (the bundle is
 * blind-locked again) and the note appended to reset_note.
 */
export async function resetBlind(ex: Executor, bundleId: string, reviewer: string, note: string): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const n = note.trim();
  if (n.length < 1 || n.length > 500) return { ok: false, status: 400, error: 'a reset note of 1–500 characters is required' };
  const sample = await lockSample(ex, bundleId);
  if (!sample) return { ok: false, status: 404, error: 'bundle is not in the blind sample' };
  if (sample.submittedAt === null) return { ok: false, status: 409, error: 'blind sample not submitted' };

  await ex.update(bundleMembers)
    .set({ status: 'proposed', confirmedBy: null, confirmedAt: null, reviewNote: null, updatedAt: sql`now()` as unknown as Date })
    .where(and(eq(bundleMembers.bundleId, bundleId), eq(bundleMembers.status, 'confirmed'), ne(bundleMembers.proposedBy, 'reviewer'), eq(bundleMembers.reviewNote, RECONCILE_AGREED_NOTE)));
  await ex.delete(bundleMembers)
    .where(and(eq(bundleMembers.bundleId, bundleId), eq(bundleMembers.proposedBy, 'reviewer'), eq(bundleMembers.reviewNote, RECONCILE_ADDED_NOTE)));
  await ex.update(bundleMembers)
    .set({ reviewNote: null, updatedAt: sql`now()` as unknown as Date })
    .where(and(eq(bundleMembers.bundleId, bundleId), eq(bundleMembers.status, 'proposed'), sql`starts_with(${bundleMembers.reviewNote}, ${RECONCILE_DISAGREE_PREFIX})`));
  await ex.delete(bundleGoldenPicks).where(eq(bundleGoldenPicks.bundleId, bundleId));
  const entry = `${new Date().toISOString()} ${reviewer}: ${n}`;
  await ex.update(bundleGoldenSamples)
    .set({ submittedAt: null, resetNote: sql`coalesce(${bundleGoldenSamples.resetNote} || E'\n', '') || ${entry}` })
    .where(eq(bundleGoldenSamples.bundleId, bundleId));
  return { ok: true };
}

/** Escapes LIKE metacharacters so the query is matched literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
}

/** O*NET item search for the queue's add box. ILIKE, ≤ 30 each. Returns NO membership data (blindness). */
export async function searchItems(q: string, release: string, ex: Executor = db): Promise<{ elements: ElementDef[]; tasks: Array<{ taskId: string; onetSocCode: string; task: string }> }> {
  const pat = likePattern(q.trim());
  const elements = await ex.select({
    elementId: onetElementDefinitions.elementId, elementName: onetElementDefinitions.elementName,
    domain: onetElementDefinitions.domain, description: onetElementDefinitions.description,
  }).from(onetElementDefinitions)
    .where(and(eq(onetElementDefinitions.release, release), sql`(${onetElementDefinitions.elementName} ILIKE ${pat} OR ${onetElementDefinitions.description} ILIKE ${pat})`))
    .orderBy(asc(onetElementDefinitions.elementName)).limit(30);
  const tasks = await ex.select({ taskId: onetTaskStatements.taskId, onetSocCode: onetTaskStatements.onetSocCode, task: onetTaskStatements.task })
    .from(onetTaskStatements)
    .where(and(eq(onetTaskStatements.release, release), sql`${onetTaskStatements.task} ILIKE ${pat}`))
    .orderBy(asc(onetTaskStatements.task), asc(onetTaskStatements.onetSocCode), asc(onetTaskStatements.taskId)).limit(30);
  return { elements, tasks };
}
