// @vitest-environment node
// P2 Task 7 — DB tests for the seeded stratified golden-sample draw CLI
// (scripts/catalog/draw-golden-sample.ts) and its write path
// (insertGoldenSamples). Every write runs inside a transaction that is
// rolled back, so the scratch clone's rows are never changed. Gated
// isP2ScratchDb(): needs 0059 applied for real — bundle_cards and
// bundle_golden_samples both FK to sub_competencies, so this suite seeds
// its own synthetic bundles (ids p2t-*) rather than depending on the
// real catalog's ~40 bundles. listActiveBundles and readTaskStatements are
// injected through deps so the real catalog never drives the assertions.
import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, subCompetencyMap, bundleCards, itemEmbeddings, bundleGoldenSamples, type BundleStratum } from '@/lib/db/schema';
import { cardEmbedText, textHash, GOLDEN_SIZE, type BundleSummary, type CardFields } from '@/lib/catalog/bundles';
import { taskGroupKey, type TaskRow } from '@/lib/catalog/shortlist';
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import { main, type Executor } from '@/scripts/catalog/draw-golden-sample';
import { isP2ScratchDb, SCRATCH_DB } from './p2/scratch-guard';

const RUN = isP2ScratchDb();

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Executor) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

// 10 synthetic bundles: 3 foundational, 4 technical, 2 business, 1
// workflow_ai. Every stratum has at least its GOLDEN_QUOTAS share (2/3/2/1),
// so the quota pick alone fills all 8 slots with no backfill — keeping the
// expected draw's membership (though not its order) independent of the seed.
const STRATA_BY_INDEX: BundleStratum[] = [
  'foundational', 'foundational', 'foundational',
  'technical', 'technical', 'technical', 'technical',
  'business', 'business',
  'workflow_ai',
];

function bundleSummary(i: number): BundleSummary {
  return {
    id: `p2t-${i}`, name: `Test Bundle ${i}`,
    knowDescriptor: `Know ${i}`, understandDescriptor: `Understand ${i}`, doDescriptor: `Do ${i}`,
    origin: 'gc_authored',
  };
}

function cardFieldsFor(i: number): CardFields {
  return {
    stratum: STRATA_BY_INDEX[i]!,
    includes: `Includes text ${i}`,
    excludes: `Excludes text ${i}`,
    distinctions: `Distinctions text ${i}`,
    positiveExamples: [`p1-${i}`, `p2-${i}`],
    negativeExamples: [`n1-${i}`, `n2-${i}`],
  };
}

const BUNDLES: BundleSummary[] = STRATA_BY_INDEX.map((_, i) => bundleSummary(i));
const CARDS = new Map(BUNDLES.map((b, i) => [b.id, cardFieldsFor(i)]));

// 3 synthetic task groups with known, distinct cosine scores against the
// shared card vector [1, 0, 0, 0]: A (identical direction, score 1), B
// (~0.707), C (orthogonal, score 0) — every sampled bundle's candidates
// must come out in exactly this order (A, B, C), since every card shares
// the same vector here.
const TASK_A = 'Prepare camera-ready proofs for offset printing.';
const TASK_B = 'Coordinate color proofing with the prepress vendor.';
const TASK_C = 'File quarterly departmental budget reports.';
const TASK_LABELS = [TASK_A, TASK_B, TASK_C];
const TASK_VECTORS: Record<string, number[]> = {
  [TASK_A]: [1, 0, 0, 0],
  [TASK_B]: [0.5, 0.5, 0, 0],
  [TASK_C]: [0, 1, 0, 0],
};
const CARD_VECTOR = [1, 0, 0, 0];

const SYNTHETIC_TASK_ROWS: TaskRow[] = TASK_LABELS.map((task, i) => ({
  taskId: `p2t-task-${i}`, onetSocCode: `99-000${i}.00`, task,
}));

const DEPS = {
  listActiveBundles: async () => BUNDLES,
  readTaskStatements: async () => SYNTHETIC_TASK_ROWS,
};

async function seedFixtures(tx: Executor): Promise<void> {
  // 10 synthetic sub_competencies rows + their identity sub_competency_map
  // rows (the 0057 invariant — see insertBusinessAcumen).
  await tx.insert(subCompetencies).values(BUNDLES.map(b => ({
    id: b.id, name: b.name, knowDescriptor: b.knowDescriptor, understandDescriptor: b.understandDescriptor,
    doDescriptor: b.doDescriptor, retired: false, mergedInto: null, origin: 'gc_authored' as const, updatedAt: new Date(),
  })));
  await tx.insert(subCompetencyMap).values(BUNDLES.map(b => ({
    oldSubCompetencyId: b.id, competencyId: b.id, mergeNote: null,
  })));

  // Confirmed cards for all 10.
  await tx.insert(bundleCards).values(BUNDLES.map((b) => {
    const c = CARDS.get(b.id)!;
    return {
      competencyId: b.id, stratum: c.stratum, includes: c.includes, excludes: c.excludes, distinctions: c.distinctions,
      positiveExamples: c.positiveExamples, negativeExamples: c.negativeExamples,
      status: 'confirmed' as const, confirmedBy: 'test-fixture', confirmedAt: new Date(), updatedAt: new Date(),
    };
  }));

  // Card vectors — same vector for every bundle, keyed by each bundle's own card text/hash.
  await tx.insert(itemEmbeddings).values(BUNDLES.map((b) => ({
    kind: 'bundle_card' as const, ref: b.id, model: DEFAULT_EMBEDDING_MODEL,
    textHash: textHash(cardEmbedText(b, CARDS.get(b.id)!)), vector: CARD_VECTOR,
  })));

  // Task-group vectors for the 3 synthetic tasks.
  await tx.insert(itemEmbeddings).values(TASK_LABELS.map((label) => ({
    kind: 'onet_task' as const, ref: taskGroupKey(label), model: DEFAULT_EMBEDDING_MODEL,
    textHash: textHash(label), vector: TASK_VECTORS[label]!,
  })));
}

describe.skipIf(!RUN)('P2 Task 7 — draw-golden-sample.ts main() (scratch DB only)', () => {
  it('--apply draws 8 samples, each with candidates ranked by cosine (A, B, C)', async () => {
    await inRolledBackTx(async (tx) => {
      await seedFixtures(tx);

      const code = await main(['--apply', '--seed', 's1', '--expect-db', SCRATCH_DB], { executor: tx, ...DEPS });
      expect(code).toBe(0);

      const rows = await tx.select().from(bundleGoldenSamples);
      expect(rows).toHaveLength(GOLDEN_SIZE);
      for (const row of rows) {
        expect(row.sampleSeed).toBe('s1');
        expect(row.candidates).toHaveLength(3);
        expect(row.candidates.map(c => c.label)).toEqual([TASK_A, TASK_B, TASK_C]);
        expect(row.candidates.map(c => c.rank)).toEqual([1, 2, 3]);
        expect(row.candidates[0]!.score).toBeCloseTo(1, 6);
        expect(row.candidates[1]!.score).toBeCloseTo(Math.SQRT1_2, 6);
        expect(row.candidates[2]!.score).toBeCloseTo(0, 6);
      }
    });
  });

  it('a dry run (no --apply) writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      await seedFixtures(tx);

      const code = await main(['--seed', 's1', '--expect-db', SCRATCH_DB], { executor: tx, ...DEPS });
      expect(code).toBe(0);

      const rows = await tx.select().from(bundleGoldenSamples);
      expect(rows).toHaveLength(0);
    });
  });

  it('a second --apply without --replace refuses (exit 3), and adds nothing', async () => {
    await inRolledBackTx(async (tx) => {
      await seedFixtures(tx);
      const deps = { executor: tx, ...DEPS };

      const first = await main(['--apply', '--seed', 's1', '--expect-db', SCRATCH_DB], deps);
      expect(first).toBe(0);

      const second = await main(['--apply', '--seed', 's2', '--expect-db', SCRATCH_DB], deps);
      expect(second).toBe(3);

      const rows = await tx.select().from(bundleGoldenSamples);
      expect(rows).toHaveLength(GOLDEN_SIZE);
      expect(rows.every(r => r.sampleSeed === 's1')).toBe(true);
    });
  });

  it('--replace refuses with exit 5 once any sample has been submitted, and redraws nothing', async () => {
    await inRolledBackTx(async (tx) => {
      await seedFixtures(tx);
      const deps = { executor: tx, ...DEPS };

      const first = await main(['--apply', '--seed', 's1', '--expect-db', SCRATCH_DB], deps);
      expect(first).toBe(0);

      const [sample] = await tx.select({ bundleId: bundleGoldenSamples.bundleId }).from(bundleGoldenSamples).limit(1);
      await tx.update(bundleGoldenSamples)
        .set({ reviewer: 'test-reviewer', submittedAt: new Date() })
        .where(eq(bundleGoldenSamples.bundleId, sample!.bundleId));

      const replaced = await main(['--apply', '--replace', '--seed', 's2', '--expect-db', SCRATCH_DB], deps);
      expect(replaced).toBe(5);

      const rows = await tx.select().from(bundleGoldenSamples);
      expect(rows).toHaveLength(GOLDEN_SIZE);
      expect(rows.every(r => r.sampleSeed === 's1')).toBe(true);
    });
  });

  it('--replace succeeds (new seed, new rows) when nothing has been submitted', async () => {
    await inRolledBackTx(async (tx) => {
      await seedFixtures(tx);
      const deps = { executor: tx, ...DEPS };

      const first = await main(['--apply', '--seed', 's1', '--expect-db', SCRATCH_DB], deps);
      expect(first).toBe(0);

      const replaced = await main(['--apply', '--replace', '--seed', 's2', '--expect-db', SCRATCH_DB], deps);
      expect(replaced).toBe(0);

      const rows = await tx.select().from(bundleGoldenSamples);
      expect(rows).toHaveLength(GOLDEN_SIZE);
      expect(rows.every(r => r.sampleSeed === 's2')).toBe(true);
    });
  });

  it('refuses (exit 3) with a clear message when an active bundle lacks a confirmed card', async () => {
    await inRolledBackTx(async (tx) => {
      // Seed everything EXCEPT the bundle_cards rows.
      await tx.insert(subCompetencies).values(BUNDLES.map(b => ({
        id: b.id, name: b.name, knowDescriptor: b.knowDescriptor, understandDescriptor: b.understandDescriptor,
        doDescriptor: b.doDescriptor, retired: false, mergedInto: null, origin: 'gc_authored' as const, updatedAt: new Date(),
      })));
      await tx.insert(subCompetencyMap).values(BUNDLES.map(b => ({
        oldSubCompetencyId: b.id, competencyId: b.id, mergeNote: null,
      })));

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const code = await main(['--apply', '--seed', 's1', '--expect-db', SCRATCH_DB], { executor: tx, ...DEPS });
      expect(code).toBe(3);
      // Asserts the EXPLICIT refusal fired (not some other error that happens
      // to also map to exit 3 — e.g. a crash reading an absent card's stratum).
      // (mockRestore() clears mock.calls, so this read happens before it.)
      expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/no confirmed card for 'p2t-\d+' — run draft-bundle-cards --apply first/);
      errorSpy.mockRestore();

      const rows = await tx.select().from(bundleGoldenSamples);
      expect(rows).toHaveLength(0);
    });
  });

  it('refuses (exit 3) when a task-group vector is missing', async () => {
    await inRolledBackTx(async (tx) => {
      // Seed everything except the onet_task vectors (only the bundle_card ones).
      await tx.insert(subCompetencies).values(BUNDLES.map(b => ({
        id: b.id, name: b.name, knowDescriptor: b.knowDescriptor, understandDescriptor: b.understandDescriptor,
        doDescriptor: b.doDescriptor, retired: false, mergedInto: null, origin: 'gc_authored' as const, updatedAt: new Date(),
      })));
      await tx.insert(subCompetencyMap).values(BUNDLES.map(b => ({
        oldSubCompetencyId: b.id, competencyId: b.id, mergeNote: null,
      })));
      await tx.insert(bundleCards).values(BUNDLES.map((b) => {
        const c = CARDS.get(b.id)!;
        return {
          competencyId: b.id, stratum: c.stratum, includes: c.includes, excludes: c.excludes, distinctions: c.distinctions,
          positiveExamples: c.positiveExamples, negativeExamples: c.negativeExamples,
          status: 'confirmed' as const, confirmedBy: 'test-fixture', confirmedAt: new Date(), updatedAt: new Date(),
        };
      }));
      await tx.insert(itemEmbeddings).values(BUNDLES.map((b) => ({
        kind: 'bundle_card' as const, ref: b.id, model: DEFAULT_EMBEDDING_MODEL,
        textHash: textHash(cardEmbedText(b, CARDS.get(b.id)!)), vector: CARD_VECTOR,
      })));
      // No onet_task vectors inserted.

      const code = await main(['--apply', '--seed', 's1', '--expect-db', SCRATCH_DB], { executor: tx, ...DEPS });
      expect(code).toBe(3);

      const rows = await tx.select().from(bundleGoldenSamples);
      expect(rows).toHaveLength(0);
    });
  });
});
