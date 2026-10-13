// @vitest-environment node
// P2 Task 6 — DB tests for lib/db/bundle-queries.ts's embedding cache
// (embedMissing, readVectors). Every write runs inside a transaction that
// is rolled back, so the scratch clone's rows are never changed. Gated
// isP2ScratchDb(): needs 0059 applied for real. item_embeddings has no FK
// to any other table, so synthetic refs are fine.
import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/client';
import { itemEmbeddings } from '@/lib/db/schema';
import { embedMissing, readVectors, type EmbedItem, type Executor } from '@/lib/db/bundle-queries';
import { isP2ScratchDb } from './p2/scratch-guard';

const RUN = isP2ScratchDb();
const MODEL = 'test-model';

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Executor) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

/** Fake embedder: one 2-vector [text.length, 1] per text, in order. Records every call's texts. */
function fakeEmbedder(): { embed: (texts: string[]) => Promise<number[][]>; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    embed: async (texts: string[]) => {
      calls.push(texts);
      return texts.map(t => [t.length, 1]);
    },
  };
}

describe.skipIf(!RUN)('P2 Task 6 — embedMissing / readVectors (scratch DB only)', () => {
  it('embeds everything on the first call', async () => {
    await inRolledBackTx(async (tx) => {
      const { embed, calls } = fakeEmbedder();
      const items: EmbedItem[] = [
        { kind: 'bundle_card', ref: 'test-bundle-a', text: 'Bundle A card text' },
        { kind: 'onet_task', ref: 'test-task-group-1', text: 'Prepare proofs' },
      ];

      const result = await embedMissing(tx, items, MODEL, embed);
      expect(result).toEqual({ cached: 0, embedded: 2 });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(items.map(i => i.text));

      const rows = await tx.select().from(itemEmbeddings);
      expect(rows).toHaveLength(2);
    });
  });

  it('embeds 0 and does not call embed on a second call with the same items', async () => {
    await inRolledBackTx(async (tx) => {
      const items: EmbedItem[] = [
        { kind: 'bundle_card', ref: 'test-bundle-a', text: 'Bundle A card text' },
        { kind: 'onet_task', ref: 'test-task-group-1', text: 'Prepare proofs' },
      ];

      const first = fakeEmbedder();
      await embedMissing(tx, items, MODEL, first.embed);

      const second = fakeEmbedder();
      const result = await embedMissing(tx, items, MODEL, second.embed);
      expect(result).toEqual({ cached: 2, embedded: 0 });
      expect(second.calls).toHaveLength(0);
    });
  });

  it('embeds exactly 1 item after its text changes, and readVectors returns the NEW vector, never the stale one', async () => {
    await inRolledBackTx(async (tx) => {
      const original: EmbedItem[] = [
        { kind: 'bundle_card', ref: 'test-bundle-a', text: 'Bundle A card text' },
        { kind: 'onet_task', ref: 'test-task-group-1', text: 'Prepare proofs' },
      ];
      await embedMissing(tx, original, MODEL, fakeEmbedder().embed);

      const changed: EmbedItem[] = [
        { kind: 'bundle_card', ref: 'test-bundle-a', text: 'Bundle A card text — CHANGED' },
        { kind: 'onet_task', ref: 'test-task-group-1', text: 'Prepare proofs' },
      ];
      const second = fakeEmbedder();
      const result = await embedMissing(tx, changed, MODEL, second.embed);
      expect(result).toEqual({ cached: 1, embedded: 1 });
      expect(second.calls).toEqual([['Bundle A card text — CHANGED']]);

      // Both the stale and the new row exist (text_hash is part of the pkey) —
      // readVectors must pick the one matching the CURRENT text.
      const rows = await tx.select().from(itemEmbeddings);
      expect(rows.filter(r => r.ref === 'test-bundle-a')).toHaveLength(2);

      const vectors = await readVectors(tx, 'bundle_card', [{ ref: 'test-bundle-a', text: changed[0]!.text }], MODEL);
      expect(vectors.get('test-bundle-a')).toEqual([changed[0]!.text.length, 1]);
    });
  });

  it('throws on a vector-count mismatch from embed, and inserts nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const items: EmbedItem[] = [
        { kind: 'bundle_card', ref: 'test-bundle-a', text: 'Bundle A card text' },
        { kind: 'onet_task', ref: 'test-task-group-1', text: 'Prepare proofs' },
      ];
      const badEmbed = async (texts: string[]) => texts.slice(0, -1).map(t => [t.length, 1]); // one short

      await expect(embedMissing(tx, items, MODEL, badEmbed)).rejects.toThrow(/got \d+ vectors for \d+ texts/);

      const rows = await tx.select().from(itemEmbeddings);
      expect(rows).toHaveLength(0);
    });
  });
});
