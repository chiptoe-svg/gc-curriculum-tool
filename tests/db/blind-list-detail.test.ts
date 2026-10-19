// @vitest-environment node
// Blind list (decision 2026-10-19): readBundleDetail returns `blind` — the 20
// elements nearest the card (all + a notice if element embeddings are missing)
// and the AI's own top-25 tasks with near-duplicates folded. Scratch DB only
// (needs 0059 + 0060 + 0061); everything is rolled back; vectors are inserted
// directly, so no embedding call is ever made.
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  subCompetencies, subCompetencyMap, bundleCards, bundleMembers, bundleGoldenSamples, bundleMappingRuns,
  itemEmbeddings, bundleMappingOutcomes, bundleGoldenSamples as samples, type GoldenCandidate,
} from '@/lib/db/schema';
import { readBundleDetail, readElementDefinitions, submitBlindPicks, readAgreementInputs, ELEMENT_SHORTLIST_UNAVAILABLE, type Executor } from '@/lib/db/bundle-queries';
import { cardEmbedText } from '@/lib/catalog/bundles';
import { elementEmbedText } from '@/lib/catalog/blind-list';
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import { textHash } from '@/lib/catalog/bundles';
import { computeAgreement, itemKey } from '@/lib/catalog/agreement';
import { eq } from 'drizzle-orm';
import { isP2ScratchDb } from './p2/scratch-guard';

const RUN = isP2ScratchDb();
const B = 'blind-list-1';
const REL = '31.0';
const DIM = 60;

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Executor) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => { await fn(tx as unknown as Executor); throw new Rollback('rollback'); });
  } catch (err) {
    if (err instanceof Rollback) return;
    throw err;
  }
  throw new Error('transaction committed — expected rollback');
}

/** unit-ish vector at angle `deg` in the (0,1) plane of DIM dims; extra axis `axis` for orthogonal distinct items. */
const vecAt = (deg: number): number[] => { const v = new Array<number>(DIM).fill(0); v[0] = Math.cos(deg * Math.PI / 180); v[1] = Math.sin(deg * Math.PI / 180); return v; };
const axis = (i: number): number[] => { const v = new Array<number>(DIM).fill(0); v[2 + (i % (DIM - 2))] = 1; return v; };

const SUMMARY = { id: B, name: 'Blind list bundle', knowDescriptor: 'K', understandDescriptor: 'U', doDescriptor: 'D', origin: 'gc_authored' };
const CARD = { stratum: 'technical' as const, includes: 'inc', excludes: 'exc', distinctions: 'dist', positiveExamples: ['p1', 'p2'], negativeExamples: ['n1', 'n2'] };

function cands(n: number): GoldenCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    key: i.toString(16).padStart(16, '0'), label: `Synthetic blind task ${i}`, rank: i + 1, score: 0.9 - i / 1000,
    members: [{ taskId: `bl-t${i}`, onetSocCode: `99-${String(i).padStart(4, '0')}.00` }],
  }));
}

async function seed(tx: Executor, candidates: GoldenCandidate[]) {
  await tx.insert(subCompetencies).values({
    id: B, name: SUMMARY.name, knowDescriptor: 'K', understandDescriptor: 'U', doDescriptor: 'D',
    retired: false, mergedInto: null, origin: 'gc_authored', updatedAt: new Date(),
  });
  await tx.insert(subCompetencyMap).values({ oldSubCompetencyId: B, competencyId: B, mergeNote: null });
  await tx.insert(bundleCards).values({ competencyId: B, ...CARD, status: 'confirmed', confirmedBy: 'Owner', confirmedAt: new Date() });
  await tx.insert(bundleGoldenSamples).values({ bundleId: B, stratum: 'technical', sampleSeed: 's', candidates });
  await tx.delete(itemEmbeddings).where(sql`${itemEmbeddings.model} = ${DEFAULT_EMBEDDING_MODEL} AND ${itemEmbeddings.kind} IN ('onet_element', 'bundle_card') AND (${itemEmbeddings.kind} = 'onet_element' OR ${itemEmbeddings.ref} = ${B})`);
  await tx.insert(itemEmbeddings).values({
    kind: 'bundle_card', ref: B, model: DEFAULT_EMBEDDING_MODEL, textHash: textHash(cardEmbedText(SUMMARY, CARD)), vector: vecAt(0),
  });
}

async function seedElements(tx: Executor, near: number): Promise<string[]> {
  const defs = await readElementDefinitions(REL, tx);
  const sorted = [...defs].sort((a, b) => a.elementId.localeCompare(b.elementId));
  // The first `near` elements sit at increasing angles from the card (rank = index); the rest are 90 degrees away.
  await tx.insert(itemEmbeddings).values(sorted.map((d, i) => ({
    kind: 'onet_element' as const, ref: d.elementId, model: DEFAULT_EMBEDDING_MODEL, textHash: textHash(elementEmbedText(d)),
    vector: i < near ? vecAt(1 + i) : vecAt(90 + (i % 7)),
  })));
  return sorted.map(d => d.elementId);
}

async function seedTaskVectors(tx: Executor, candidates: GoldenCandidate[], vecs: (i: number) => number[]) {
  await tx.delete(itemEmbeddings).where(sql`${itemEmbeddings.kind} = 'onet_task' AND ${itemEmbeddings.model} = ${DEFAULT_EMBEDDING_MODEL} AND ${itemEmbeddings.ref} = ANY(${sql.raw(`ARRAY[${candidates.map(c => `'${c.key}'`).join(',')}]`)})`);
  await tx.insert(itemEmbeddings).values(candidates.map((c, i) => ({
    kind: 'onet_task' as const, ref: c.key, model: DEFAULT_EMBEDDING_MODEL, textHash: textHash(c.label), vector: vecs(i),
  })));
}

describe.skipIf(!RUN)('readBundleDetail blind list (scratch DB only)', () => {
  it('elements: the 20 nearest the card, domain data intact, no notice', async () => {
    await inRolledBackTx(async (tx) => {
      const c = cands(30);
      await seed(tx, c);
      const ids = await seedElements(tx, 25);
      const d = (await readBundleDetail(B, tx))!;
      expect(d.blind!.elementNotice).toBeNull();
      expect(d.blind!.elements.map(e => e.elementId)).toEqual(ids.slice(0, 20));
      expect(d.blind!.elements[0]).toMatchObject({ domain: expect.any(String), description: expect.any(String) });
    });
  });

  it('elements: falls back to all of them with a one-line notice when element embeddings are missing', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx, cands(30));
      const d = (await readBundleDetail(B, tx))!; // no element vectors seeded
      const all = await readElementDefinitions(REL, tx);
      expect(d.blind!.elements).toHaveLength(all.length);
      expect(d.blind!.elementNotice).toBe(ELEMENT_SHORTLIST_UNAVAILABLE);
      expect(ELEMENT_SHORTLIST_UNAVAILABLE).toBe('element shortlist unavailable — showing all');
    });
  });

  it('elements: a partial set of embeddings also falls back (never a silently biased shortlist)', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx, cands(30));
      const ids = await seedElements(tx, 25);
      await tx.delete(itemEmbeddings).where(sql`${itemEmbeddings.kind} = 'onet_element' AND ${itemEmbeddings.ref} = ${ids[0]!}`);
      const d = (await readBundleDetail(B, tx))!;
      expect(d.blind!.elementNotice).toBe(ELEMENT_SHORTLIST_UNAVAILABLE);
      expect(d.blind!.elements).toHaveLength(ids.length);
    });
  });

  it('tasks: first 25 of the stored top-50 order, near-duplicates (>= 0.92) folded into the row, pick keys fan out', async () => {
    await inRolledBackTx(async (tx) => {
      const c = cands(50);
      await seed(tx, c);
      await seedElements(tx, 25);
      // 0 and 3 and 40 are near-duplicates (angle 0, 5, 6 degrees); every other task is orthogonal to all others.
      await seedTaskVectors(tx, c, i => (i === 0 ? vecAt(0) : i === 3 ? vecAt(10) : i === 40 ? vecAt(11) : axis(i)));
      const d = (await readBundleDetail(B, tx))!;
      const rows = d.blind!.taskRows;
      // 25 kept (indices 0..24), index 3 folds into row 0; 40 is beyond the first 25 so it is NOT shown at all.
      expect(rows).toHaveLength(24);
      expect(rows[0]!.key).toBe(c[0]!.key);
      expect(rows[0]!.similar.map(s => s.key)).toEqual([c[3]!.key]);
      expect(rows.map(r => r.key)).not.toContain(c[3]!.key);
      expect(rows.map(r => r.key)).not.toContain(c[40]!.key);
      expect(rows.map(r => r.key)).not.toContain(c[25]!.key);
      expect(rows[1]!.key).toBe(c[1]!.key);
    });
  });

  it('blindness: the blind list is identical whether or not the AI has placed anything, and never carries AI data', async () => {
    await inRolledBackTx(async (tx) => {
      const c = cands(30);
      await seed(tx, c);
      await seedElements(tx, 25);
      await seedTaskVectors(tx, c, i => axis(i));
      const before = (await readBundleDetail(B, tx))!;
      const [run] = await tx.insert(bundleMappingRuns).values({ model: 'm', promptVersion: 'v', taskShortlistK: 25, bundleCount: 1 }).returning({ id: bundleMappingRuns.id });
      await tx.insert(bundleMembers).values([
        { bundleId: B, source: 'onet_element', externalId: '2.B.5.a', externalLabel: 'x', onetSocCode: null, release: REL, position: 'core', aiPosition: 'core', status: 'proposed', proposedBy: 'm', rationale: 'SECRET-BLIND-LIST', runId: run!.id },
      ]);
      const after = (await readBundleDetail(B, tx))!;
      expect(after.members).toBeNull();
      expect(after.blind).toEqual(before.blind);
      expect(JSON.stringify(after.blind)).not.toContain('SECRET-BLIND-LIST');
    });
  });

  it('submit records what was shown; agreement leaves an AI element outside the shown 20 out of precision and counts it', async () => {
    await inRolledBackTx(async (tx) => {
      const c = cands(30);
      await seed(tx, c);
      const ids = await seedElements(tx, 25);
      await seedTaskVectors(tx, c, i => (i === 0 ? vecAt(0) : i === 3 ? vecAt(10) : axis(i)));
      const [run] = await tx.insert(bundleMappingRuns).values({ model: 'm', promptVersion: 'v', taskShortlistK: 25, bundleCount: 1 }).returning({ id: bundleMappingRuns.id });
      await tx.insert(bundleMappingOutcomes).values({ runId: run!.id, bundleId: B, status: 'ok', noCleanMatch: false, note: null });
      const inList = ids[0]!; const outside = ids[100]!;
      await tx.insert(bundleMembers).values([inList, outside].map(id => ({
        bundleId: B, source: 'onet_element' as const, externalId: id, externalLabel: id, onetSocCode: null, release: REL,
        position: 'core' as const, aiPosition: 'core' as const, status: 'proposed' as const, proposedBy: 'm', rationale: 'r', runId: run!.id,
      })));
      // Pick element 0 and the merged row 0 (keys 0 and 3).
      const res = await submitBlindPicks(tx, B, 'R', [
        { kind: 'element', elementId: inList, position: 'core' },
        { kind: 'task', groupKey: c[0]!.key, position: 'core' },
        { kind: 'task', groupKey: c[3]!.key, position: 'core' },
      ], false, REL);
      expect(res.ok).toBe(true);
      const [s] = await tx.select().from(samples).where(eq(samples.bundleId, B));
      expect(s!.shownItems!.elementIds).toEqual(ids.slice(0, 20));
      expect(s!.shownItems!.taskRows[c[0]!.key]).toEqual([c[0]!.key, c[3]!.key]);
      expect(Object.keys(s!.shownItems!.taskRows)).toHaveLength(24);

      const { inputs } = await readAgreementInputs(tx);
      const input = inputs.find(i => i.bundleId === B)!;
      expect(input.mergedItems).toBe(1);
      const row = computeAgreement(input);
      expect(row).toMatchObject({ aiCount: 1, aiOutsideList: 1, both: 1, precision: 1, noShownRecord: false });
      expect(input.ai.has(itemKey('onet_element', outside))).toBe(true);
    });
  });
});
