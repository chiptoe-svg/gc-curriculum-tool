/** Re-sort background files with the graded-material sorter (scratch; rolled-back transaction). */
import { describe, it, expect } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';
import { applyRetier, planRetier } from '@/scripts/capture/retier-graded-files';
import { isP2ScratchDb } from './p2/scratch-guard';

class Rollback extends Error {}
const base = { courseCode: 'GC 1010', blobUrl: '/api/storage/materials/x/y.pdf', mimeType: 'application/pdf', sizeBytes: 1, ipHash: 'test', extractionStatus: 'ok', extractedText: 'Assignment 4: build a brand playbook. Rubric: 40 points', indexingStatus: 'ready', tier: 'background', isSyllabus: false };

describe.skipIf(!isP2ScratchDb())('retier-graded-files (scratch)', () => {
  it('asks the sorter about active background files with text, and queues the ones it calls high', async () => {
    const asked: string[] = [];
    const classify = async (sig: { fileName: string; peekText?: string }) => {
      if (sig.fileName.startsWith('fx-')) { asked.push(sig.fileName); expect(sig.peekText).toMatch(/^Assignment 4/); }
      return sig.fileName.includes('brief') ? 'high' as const : 'background' as const;
    };
    let ids: string[] = [];
    let plan: Awaited<ReturnType<typeof planRetier>> = [];
    let after: Array<{ fileName: string; tier: string | null; indexingStatus: string }> = [];
    await expect(db.transaction(async tx => {
      const rows = await tx.insert(courseMaterials).values([
        { ...base, fileName: 'fx-brief.pdf' },                                       // → high, queued
        { ...base, fileName: 'fx-reading.pdf' },                                     // stays background
        { ...base, fileName: 'fx-mid-brief.pdf', tier: 'middle' },                   // not background: not asked
        { ...base, fileName: 'fx-syl-brief.pdf', isSyllabus: true },                 // syllabus: own command
        { ...base, fileName: 'fx-ignored-brief.pdf', ignored: true },                // set aside
        { ...base, fileName: 'fx-retired-brief.pdf', retiredAt: new Date() },
        { ...base, fileName: 'fx-notext-brief.pdf', extractedText: null, indexingStatus: 'failed' },
        { ...base, fileName: 'fx-student_late_123_brief.png' },                        // skipped by name
      ]).returning({ id: courseMaterials.id });
      ids = rows.map(r => r.id);
      plan = (await planRetier(tx, classify, ['_late_123_'])).filter(p => ids.includes(p.id));
      await applyRetier(tx, plan);
      after = await tx.select({ fileName: courseMaterials.fileName, tier: courseMaterials.tier, indexingStatus: courseMaterials.indexingStatus })
        .from(courseMaterials).where(inArray(courseMaterials.id, ids));
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    expect(asked.sort()).toEqual(['fx-brief.pdf', 'fx-reading.pdf']);
    expect(plan.map(p => p.fileName)).toEqual(['fx-brief.pdf']);
    const byName = Object.fromEntries(after.map(r => [r.fileName, r]));
    expect(byName['fx-brief.pdf']).toMatchObject({ tier: 'high', indexingStatus: 'queued' });
    expect(byName['fx-reading.pdf']).toMatchObject({ tier: 'background', indexingStatus: 'ready' });
    expect(byName['fx-mid-brief.pdf']).toMatchObject({ tier: 'middle', indexingStatus: 'ready' });
  });
});
