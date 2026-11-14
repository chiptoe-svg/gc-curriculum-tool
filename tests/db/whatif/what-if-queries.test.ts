// @vitest-environment node
// What-if tables and queries (migration 0066). Scratch DB only; every case
// runs inside a transaction that is rolled back.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots, courseWhatIfs, courseWhatIfMessages } from '@/lib/db/schema';
import type { Tx } from '@/lib/db/competency-catalog-queries';
import {
  createWhatIf, getWhatIf, listWhatIfsForCourse, countWhatIfsByCourse, renameWhatIf, saveWhatIfPage,
  addWhatIfUsage, deleteWhatIf, appendWhatIfMessage, listWhatIfMessages, insertWhatIfAttachment,
  listWhatIfAttachments, listActiveSubCompetencies,
} from '@/lib/db/what-if-queries';
import type { KnockOn, WhatIfEstimate, WhatIfProfile, WhatIfProse } from '@/lib/what-if/types';
import { isWhatIfScratchDb } from './scratch-guard';

const courseCode = 'GC WI1';

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx, baseSnapshotId: string) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(courses).values({ code: courseCode, title: 'What-if test', level: 1, track: 'core' });
      const [snap] = await tx.insert(courseCaptureSnapshots).values({
        courseCode, profile: {}, inputsMeta: {}, scaleVersion: 'v1', model: 'test', instructorName: 'WI Test',
      } as never).returning({ id: courseCaptureSnapshots.id });
      await fn(tx, snap!.id);
      throw new Rollback('rollback');
    });
  } catch (err) {
    if (err instanceof Rollback) return;
    throw err;
  }
  throw new Error('transaction committed — expected rollback');
}

const input = (baseSnapshotId: string) => ({ courseCode, baseSnapshotId, ownerGrantId: 'g1', ownerKind: 'personal' as const, authorName: 'A' });
const ESTIMATE: WhatIfEstimate = { changeItems: [], movedRatings: [], newCompetencies: [], incomingChanges: [] };
const PROFILE: WhatIfProfile = { ratings: [], incomingChanges: [] };
const KNOCK_ON: KnockOn = { laterCourses: [], earlierCourses: [], careerTargets: [], notComputed: [] };
const PROSE: WhatIfProse = { description: 'd', whatChanges: 'w', neighbors: 'n', questions: ['q'] };
const PAGE = { title: 'T', summary: 's', estimate: ESTIMATE, profile: PROFILE, knockOn: KNOCK_ON, prose: PROSE };

describe.runIf(isWhatIfScratchDb())('what-if queries (scratch DB)', () => {
  it('a new what-if has no page and is not counted', () => inRolledBackTx(async (tx, baseSnapshotId) => {
    const w = await createWhatIf(input(baseSnapshotId), tx);
    expect(w.pageCreatedAt).toBeNull();
    expect(w.usage).toEqual({});
    expect((await countWhatIfsByCourse(tx)).get(courseCode) ?? 0).toBe(0);
    expect((await listWhatIfsForCourse(courseCode, tx)).map((r) => r.id)).toEqual([w.id]);
  }));

  it('saving a page sets page_created_at and counts it', () => inRolledBackTx(async (tx, baseSnapshotId) => {
    const w = await createWhatIf(input(baseSnapshotId), tx);
    await saveWhatIfPage(w.id, PAGE, tx);
    const saved = (await getWhatIf(w.id, tx))!;
    expect(saved.pageCreatedAt).not.toBeNull();
    expect(saved.title).toBe('T');
    expect(saved.prose).toEqual(PROSE);
    expect((await countWhatIfsByCourse(tx)).get(courseCode)).toBe(1);
    // a null title keeps the existing one
    await renameWhatIf(w.id, 'Renamed', tx);
    await saveWhatIfPage(w.id, { ...PAGE, title: null, summary: 's2' }, tx);
    const again = (await getWhatIf(w.id, tx))!;
    expect(again.title).toBe('Renamed');
    expect(again.summary).toBe('s2');
  }));

  it('addWhatIfUsage sums calls, cost and tokens per kind', () => inRolledBackTx(async (tx, baseSnapshotId) => {
    const w = await createWhatIf(input(baseSnapshotId), tx);
    await addWhatIfUsage(w.id, 'estimate', { costUsdCents: 3, promptTokens: 100, completionTokens: 10 }, tx);
    await addWhatIfUsage(w.id, 'estimate', { costUsdCents: 4, promptTokens: 200, completionTokens: 30 }, tx);
    await addWhatIfUsage(w.id, 'page', { costUsdCents: 1, promptTokens: 5, completionTokens: 6 }, tx);
    const usage = (await getWhatIf(w.id, tx))!.usage;
    expect(usage.estimate).toEqual({ calls: 2, costUsdCents: 7, promptTokens: 300, completionTokens: 40 });
    expect(usage.page).toEqual({ calls: 1, costUsdCents: 1, promptTokens: 5, completionTokens: 6 });
  }));

  it('deleting the base snapshot succeeds and leaves the what-if with no base', () => inRolledBackTx(async (tx, baseSnapshotId) => {
    const w = await createWhatIf(input(baseSnapshotId), tx);
    await tx.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.id, baseSnapshotId));
    expect((await getWhatIf(w.id, tx))!.baseSnapshotId).toBeNull();
  }));

  it('messages list oldest first; attachments store their fields', () => inRolledBackTx(async (tx, baseSnapshotId) => {
    const w = await createWhatIf(input(baseSnapshotId), tx);
    await appendWhatIfMessage(w.id, 'user', 'first', undefined, tx);
    await appendWhatIfMessage(w.id, 'assistant', 'second', { k: 1 }, tx);
    expect((await listWhatIfMessages(w.id, tx)).map((m) => [m.role, m.content, m.meta])).toEqual([
      ['user', 'first', null], ['assistant', 'second', { k: 1 }],
    ]);
    const a = await insertWhatIfAttachment({
      whatIfId: w.id, fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, blobUrl: 'blob://a',
      status: 'held_back', heldBackReason: 'looks like a roster', ferpaRisk: 'high', extractedText: null,
    }, tx);
    expect((await listWhatIfAttachments(w.id, tx)).map((r) => r.id)).toEqual([a.id]);
  }));

  it('deleteWhatIf removes messages and attachments and returns the attachment rows', () => inRolledBackTx(async (tx, baseSnapshotId) => {
    const w = await createWhatIf(input(baseSnapshotId), tx);
    await appendWhatIfMessage(w.id, 'user', 'hello', undefined, tx);
    const a = await insertWhatIfAttachment({
      whatIfId: w.id, fileName: 'a.txt', mimeType: 'text/plain', sizeBytes: 1, blobUrl: 'blob://a',
      status: 'ok', heldBackReason: null, ferpaRisk: null, extractedText: 'x',
    }, tx);
    const removed = await deleteWhatIf(w.id, tx);
    expect(removed.map((r) => r.id)).toEqual([a.id]);
    expect(await getWhatIf(w.id, tx)).toBeNull();
    expect(await listWhatIfMessages(w.id, tx)).toEqual([]);
    expect(await listWhatIfAttachments(w.id, tx)).toEqual([]);
  }));

  it('deleting the course removes its what-ifs', () => inRolledBackTx(async (tx, baseSnapshotId) => {
    const w = await createWhatIf(input(baseSnapshotId), tx);
    await appendWhatIfMessage(w.id, 'user', 'hello', undefined, tx);
    await tx.delete(courses).where(eq(courses.code, courseCode));
    expect(await getWhatIf(w.id, tx)).toBeNull();
    expect(await tx.select().from(courseWhatIfs).where(eq(courseWhatIfs.courseCode, courseCode))).toEqual([]);
    expect(await tx.select().from(courseWhatIfMessages).where(eq(courseWhatIfMessages.whatIfId, w.id))).toEqual([]);
  }));

  it('lists only active sub-competencies', () => inRolledBackTx(async (tx) => {
    const active = await listActiveSubCompetencies(tx);
    expect(active.length).toBeGreaterThan(0);
    expect(active[0]).toEqual({ id: expect.any(String), name: expect.any(String) });
  }));
});
