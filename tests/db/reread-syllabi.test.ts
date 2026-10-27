/** Re-read syllabi filed below 'high' (scratch; runs in a rolled-back transaction). */
import { describe, it, expect } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';
import { applyReread, planReread } from '@/scripts/capture/reread-syllabi';
import { isP2ScratchDb } from './p2/scratch-guard';

class Rollback extends Error {}
const COURSE = 'GC 1010';
const base = { courseCode: COURSE, blobUrl: '/api/storage/materials/x/y.pdf', mimeType: 'application/pdf', sizeBytes: 1, ipHash: 'test', extractionStatus: 'ok', extractedText: 'Grading: Photo Book Project 75 points', indexingStatus: 'ready' };

describe.skipIf(!isP2ScratchDb())('reread-syllabi (scratch)', () => {
  it('queues only active syllabi below high that have stored text, at high tier', async () => {
    let plan: Awaited<ReturnType<typeof planReread>> | undefined;
    let after: Array<{ fileName: string; tier: string | null; indexingStatus: string }> = [];
    let ids: string[] = [];
    await expect(db.transaction(async tx => {
      const rows = await tx.insert(courseMaterials).values([
        { ...base, fileName: 'fx-bg.pdf', isSyllabus: true, tier: 'background' },   // → queued at high
        { ...base, fileName: 'fx-mid.pdf', isSyllabus: true, tier: 'middle' },      // → queued at high
        { ...base, fileName: 'fx-high.pdf', isSyllabus: true, tier: 'high' },       // already high
        { ...base, fileName: 'fx-notsyl.pdf', isSyllabus: false, tier: 'background' }, // not a syllabus
        { ...base, fileName: 'fx-retired.pdf', isSyllabus: true, tier: 'background', retiredAt: new Date() },
        { ...base, fileName: 'fx-notext.pdf', isSyllabus: true, tier: 'background', extractedText: null, extractionStatus: 'pending', indexingStatus: 'pending' },
      ]).returning({ id: courseMaterials.id });
      ids = rows.map(r => r.id);
      plan = await planReread(tx);
      await applyReread(tx, plan.filter(p => ids.includes(p.id)));
      after = await tx.select({ fileName: courseMaterials.fileName, tier: courseMaterials.tier, indexingStatus: courseMaterials.indexingStatus })
        .from(courseMaterials).where(inArray(courseMaterials.id, ids));
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    expect(plan!.filter(p => ids.includes(p.id)).map(p => p.fileName).sort()).toEqual(['fx-bg.pdf', 'fx-mid.pdf']);
    const byName = Object.fromEntries(after.map(r => [r.fileName, r]));
    expect(byName['fx-bg.pdf']).toMatchObject({ tier: 'high', indexingStatus: 'queued' });
    expect(byName['fx-mid.pdf']).toMatchObject({ tier: 'high', indexingStatus: 'queued' });
    expect(byName['fx-high.pdf']).toMatchObject({ tier: 'high', indexingStatus: 'ready' });
    expect(byName['fx-notsyl.pdf']).toMatchObject({ tier: 'background', indexingStatus: 'ready' });
    expect(byName['fx-retired.pdf']).toMatchObject({ tier: 'background', indexingStatus: 'ready' });
    expect(byName['fx-notext.pdf']).toMatchObject({ tier: 'background', indexingStatus: 'pending' });
  });
});
