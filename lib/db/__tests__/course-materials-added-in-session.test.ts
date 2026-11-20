/** Scratch-database only; skips elsewhere. Deletes its tagged course (cascades the session and material). */
import { describe, it, expect, afterAll } from 'vitest';

try { process.loadEnvFile('.env.local'); } catch { /* no .env.local: the suite skips */ }
const SCRATCH = /\/gc_curriculum_builder_scratch(\?|$)/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('insertMaterial addedInSession (scratch database)', () => {
  const code = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionId = crypto.randomUUID();

  afterAll(async () => {
    const { db } = await import('@/lib/db/client');
    const { courses } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    await db.delete(courses).where(eq(courses.code, code));
  });

  it('writes and returns addedInSession, and the session lookup finds its course', async () => {
    const { db } = await import('@/lib/db/client');
    const { courses, captureSessions } = await import('@/lib/db/schema');
    const q = await import('@/lib/db/course-materials-queries');
    await db.insert(courses).values({ code, title: 't', level: 1, track: 'x' });
    await db.insert(captureSessions).values({ sessionId, courseCode: code, revisionMode: 'fresh' });
    const row = await q.insertMaterial({
      courseCode: code, fileName: 'f.pdf', blobUrl: 'local:x', mimeType: 'application/pdf',
      sizeBytes: 1, ipHash: 'h', addedInSession: sessionId,
    });
    expect(row.addedInSession).toBe(sessionId);
    expect(await q.getCaptureSessionCourse(sessionId)).toBe(code);
    expect(await q.getCaptureSessionCourse(crypto.randomUUID())).toBeNull();
  });
});
