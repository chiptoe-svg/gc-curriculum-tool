// @vitest-environment node
// Blind list: embed-items also embeds every O*NET element definition (kind
// 'onet_element', text "name: description"), incremental by text hash.
// Scratch DB only (needs 0059 + 0061); every write is rolled back; the embedder is stubbed.
import { describe, it, expect, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { itemEmbeddings, onetElementDefinitions } from '@/lib/db/schema';
import { main, type Executor } from '@/scripts/catalog/embed-items';
import { elementEmbedText } from '@/lib/catalog/blind-list';
import { DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import { isP2ScratchDb, SCRATCH_DB } from './p2/scratch-guard';

const RUN = isP2ScratchDb();

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

describe.skipIf(!RUN)('embed-items embeds O*NET elements (scratch DB only)', () => {
  it('dry run reports the onet_element count and writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const defs = await tx.select().from(onetElementDefinitions).where(eq(onetElementDefinitions.release, '31.0'));
      const logs: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
      const code = await main(['--expect-db', SCRATCH_DB], { executor: tx });
      spy.mockRestore();
      expect(code).toBe(0);
      expect(logs.join('\n')).toContain(`${defs.length} onet_element`);
    });
  });

  it('an embed/insert failure on --apply exits 3 with a message naming migration 0061', async () => {
    await inRolledBackTx(async (tx) => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await main(['--apply', '--expect-db', SCRATCH_DB], { executor: tx, embed: async () => { throw new Error('boom'); } });
      const msg = err.mock.calls.map(c => c.join(' ')).join('\n');
      err.mockRestore(); log.mockRestore();
      expect(code).toBe(3);
      expect(msg).toMatch(/is migration 0061 applied\?/);
    });
  });

  it('apply embeds the missing elements with "name: description", then a rerun embeds nothing new', async () => {
    await inRolledBackTx(async (tx) => {
      const defs = await tx.select().from(onetElementDefinitions).where(eq(onetElementDefinitions.release, '31.0'));
      expect(defs.length).toBeGreaterThan(0);
      const calls: string[][] = [];
      const embed = async (texts: string[]) => { calls.push(texts); return texts.map(t => [t.length, 1]); };
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(await main(['--apply', '--expect-db', SCRATCH_DB], { executor: tx, embed })).toBe(0);
      const sent = calls.flat();
      for (const d of defs) expect(sent).toContain(elementEmbedText(d));
      const rows = await tx.select().from(itemEmbeddings)
        .where(and(eq(itemEmbeddings.kind, 'onet_element'), eq(itemEmbeddings.model, DEFAULT_EMBEDDING_MODEL)));
      expect(rows.map(r => r.ref).sort()).toEqual(defs.map(d => d.elementId).sort());

      calls.length = 0;
      expect(await main(['--apply', '--expect-db', SCRATCH_DB], { executor: tx, embed })).toBe(0);
      spy.mockRestore();
      expect(calls.flat().filter(t => defs.some(d => elementEmbedText(d) === t))).toEqual([]);
    });
  });
});
