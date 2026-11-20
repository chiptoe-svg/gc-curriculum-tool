/** Scratch-database only; skips elsewhere. Deletes its tagged course (cascades the session and materials). */
import { describe, it, expect, afterAll } from 'vitest';

try { process.loadEnvFile('.env.local'); } catch { /* no .env.local: the suite skips */ }
const SCRATCH = /\/gc_curriculum_builder_scratch(\?|$)/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('claimNextQueued order (scratch database)', () => {
  const code = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionId = crypto.randomUUID();

  afterAll(async () => {
    const { db } = await import('@/lib/db/client');
    const { courses } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    await db.delete(courses).where(eq(courses.code, code));
  });

  it('claims a file added in the interview before an older upload', async () => {
    const { db } = await import('@/lib/db/client');
    const { courses, captureSessions } = await import('@/lib/db/schema');
    const q = await import('@/lib/db/course-materials-queries');
    await db.insert(courses).values({ code, title: 't', level: 1, track: 'x' });
    await db.insert(captureSessions).values({ sessionId, courseCode: code, revisionMode: 'fresh' });
    const mk = (name: string, addedInSession?: string) =>
      q.insertMaterial({
        courseCode: code, fileName: name, blobUrl: 'local:x', mimeType: 'application/pdf',
        sizeBytes: 1, ipHash: 'h', ...(addedInSession ? { addedInSession } : {}),
      });
    const older = await mk('older.pdf');
    const tagged = await mk('tagged.pdf', sessionId);
    await q.updateIndexingStatus({ id: older.id, status: 'queued' });
    await q.updateIndexingStatus({ id: tagged.id, status: 'queued' });
    // Other queued rows on the scratch DB may be claimed too; claim until both of ours are out.
    const order: string[] = [];
    for (let i = 0; i < 200 && order.length < 2; i++) {
      const row = await q.claimNextQueued();
      if (!row) break;
      if (row.id === older.id || row.id === tagged.id) order.push(row.id);
    }
    expect(order).toEqual([tagged.id, older.id]);
  });

  it('getMaterialStatusInCourse returns only id and statuses, and nothing for another course', async () => {
    const { db } = await import('@/lib/db/client');
    const { courses } = await import('@/lib/db/schema');
    const q = await import('@/lib/db/course-materials-queries');
    const other = `${code}-b`;
    await db.insert(courses).values({ code: other, title: 't', level: 1, track: 'x' });
    try {
      const m = await q.insertMaterial({
        courseCode: code, fileName: 's.pdf', blobUrl: 'local:x', mimeType: 'application/pdf', sizeBytes: 1, ipHash: 'h',
      });
      expect(await q.getMaterialStatusInCourse(code, m.id)).toEqual({
        id: m.id, indexingStatus: m.indexingStatus, extractionStatus: m.extractionStatus,
      });
      expect(await q.getMaterialStatusInCourse(other, m.id)).toBeNull();
    } finally {
      const { eq } = await import('drizzle-orm');
      await db.delete(courses).where(eq(courses.code, other));
    }
  });
});
