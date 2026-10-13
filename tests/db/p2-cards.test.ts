// @vitest-environment node
// P2 Task 5 — tests for lib/db/bundle-queries.ts and
// scripts/catalog/draft-bundle-cards.ts's --apply path. Every DB write runs
// inside a transaction that is rolled back, so the scratch clone's rows are
// never changed. Gated isP2ScratchDb(): needs 0059 applied for real.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { bundleCards } from '@/lib/db/schema';
import { listActiveBundles, upsertConfirmedCards, type Executor } from '@/lib/db/bundle-queries';
import { main } from '@/scripts/catalog/draft-bundle-cards';
import type { ReviewCard } from '@/lib/catalog/bundles';
import { isP2ScratchDb, SCRATCH_DB } from './p2/scratch-guard';

const RUN = isP2ScratchDb();

// The four owner-approved business-acumen competencies inserted in P1 Task
// 5, origin='gc_authored', unretired.
const BUSINESS_ACUMEN_IDS = [
  'customer-relationship-management',
  'negotiation-persuasion',
  'business-financial-literacy',
  'contracts-ip-licensing',
];

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Executor) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

function card(competencyId: string, overrides: Partial<ReviewCard> = {}): ReviewCard {
  return {
    competencyId,
    name: 'Test card name',
    stratum: 'business',
    includes: 'includes text',
    excludes: 'excludes text',
    distinctions: 'distinctions text',
    positiveExamples: ['p1', 'p2'],
    negativeExamples: ['n1', 'n2'],
    ...overrides,
  };
}

function writeTmpReviewFile(contents: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'p2-cards-test-'));
  const file = join(dir, 'review.json');
  writeFileSync(file, JSON.stringify(contents, null, 2));
  return file;
}

describe.skipIf(!RUN)('P2 Task 5 — listActiveBundles (scratch DB only)', () => {
  it('returns only retired=false rows, and includes the four gc_authored business-acumen ids', async () => {
    const bundles = await listActiveBundles(db);
    const ids = new Set(bundles.map(b => b.id));
    for (const id of BUSINESS_ACUMEN_IDS) {
      expect(ids.has(id), `expected active bundle list to include ${id}`).toBe(true);
    }
    // Every row carries the fields a BundleSummary needs.
    for (const b of bundles) {
      expect(typeof b.id).toBe('string');
      expect(typeof b.name).toBe('string');
      expect(typeof b.knowDescriptor).toBe('string');
      expect(typeof b.understandDescriptor).toBe('string');
      expect(typeof b.doDescriptor).toBe('string');
    }
  });
});

describe.skipIf(!RUN)('P2 Task 5 — upsertConfirmedCards (scratch DB only)', () => {
  it('inserts a new card, then updates it on a second call, with status=confirmed and confirmed_by set', async () => {
    await inRolledBackTx(async (tx) => {
      const id = BUSINESS_ACUMEN_IDS[0] as string;

      const firstResult = await upsertConfirmedCards(tx, [card(id)], 'first-reviewer');
      expect(firstResult).toEqual({ inserted: 1, updated: 0 });

      const [row1] = await tx.select().from(bundleCards).where(eq(bundleCards.competencyId, id));
      expect(row1?.status).toBe('confirmed');
      expect(row1?.confirmedBy).toBe('first-reviewer');
      expect(row1?.confirmedAt).not.toBeNull();

      const secondResult = await upsertConfirmedCards(tx, [card(id, { includes: 'updated includes text' })], 'second-reviewer');
      expect(secondResult).toEqual({ inserted: 0, updated: 1 });

      const [row2] = await tx.select().from(bundleCards).where(eq(bundleCards.competencyId, id));
      expect(row2?.status).toBe('confirmed');
      expect(row2?.confirmedBy).toBe('second-reviewer');
      expect(row2?.includes).toBe('updated includes text');
    });
  });
});

describe.skipIf(!RUN)('P2 Task 5 — draft-bundle-cards.ts main() --apply (scratch DB only)', () => {
  it('refuses an empty _approval review file, returns non-zero, and writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      // Give a card for EVERY active bundle so the only thing wrong with
      // this file is the empty _approval — isolates the approval gate from
      // the file's completeness check.
      const activeIds = (await listActiveBundles(tx)).map(b => b.id);
      const file = writeTmpReviewFile({
        _approval: '',
        drafted: { model: 'test-model', promptVersion: 'bundle-card-draft@1', at: new Date().toISOString(), costUsdCents: 0 },
        cards: activeIds.map(id => card(id)),
      });

      const code = await main(
        ['--apply', '--file', file, '--confirmed-by', 'x', '--expect-db', SCRATCH_DB],
        { executor: tx },
      );
      expect(code).not.toBe(0);

      const rows = await tx.select().from(bundleCards);
      expect(rows).toHaveLength(0);
    });
  });

  it('refuses before any read when --expect-db does not match the connected database', async () => {
    // A --file path that does not exist: if assertExpectedDb ran AFTER any
    // file read (rather than before), this would fail with a distinct
    // file-not-found error (exit 3) instead of the db-mismatch refusal
    // (exit 1) — proving the read order, not just "something failed".
    const code = await main(['--apply', '--file', '/nonexistent/path/does-not-exist.json', '--confirmed-by', 'x', '--expect-db', 'gc_curriculum']);
    expect(code).toBe(1);
  });
});
