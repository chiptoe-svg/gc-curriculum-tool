/** Cleanup of custom settings rows that duplicate their role (scratch; runs in a rolled-back transaction). */
import { describe, it, expect } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { aiFunctionSettings } from '@/lib/db/schema';
import { applyCleanup, planCleanup } from '@/scripts/ai/cleanup-role-rows';
import { isP2ScratchDb } from './p2/scratch-guard';

class Rollback extends Error {}
const IDS = ['capture-scores', 'material-digest', 'wiki-update', 'jd-extract'];

describe.skipIf(!isP2ScratchDb())('cleanup-role-rows (scratch)', () => {
  it('deletes only custom rows whose model and effort equal their role', async () => {
    let plan: Awaited<ReturnType<typeof planCleanup>> | undefined;
    let left: string[] = [];
    await expect(db.transaction(async tx => {
      await tx.delete(aiFunctionSettings).where(inArray(aiFunctionSettings.functionId, IDS));
      await tx.insert(aiFunctionSettings).values([
        { functionId: 'capture-scores', tier: 'custom', customModel: 'gpt-6.1-sol' }, // Judge = Sol low → delete
        { functionId: 'material-digest', tier: 'custom', customModel: 'gpt-6.1-sol' }, // Extract = mini → keep
        { functionId: 'wiki-update', tier: 'custom', customModel: 'gpt-5.5' }, // Write = Sol → keep
        { functionId: 'jd-extract', tier: 'extract', customModel: null }, // not custom → untouched
      ]);
      plan = await planCleanup(tx);
      await applyCleanup(tx, plan);
      left = (await tx.select({ id: aiFunctionSettings.functionId }).from(aiFunctionSettings)
        .where(inArray(aiFunctionSettings.functionId, IDS))).map(r => r.id).sort();
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    // The scratch clone carries other rows too; judge only the fixtures.
    expect(plan!.delete.filter(id => IDS.includes(id))).toEqual(['capture-scores']);
    expect(plan!.keep.map(k => k.functionId).filter(id => IDS.includes(id)).sort()).toEqual(['material-digest', 'wiki-update']);
    expect(left).toEqual(['jd-extract', 'material-digest', 'wiki-update']);
  });
});
