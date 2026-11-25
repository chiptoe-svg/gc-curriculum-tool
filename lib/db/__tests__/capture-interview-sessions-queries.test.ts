/** Scratch-database only; skips elsewhere. Deletes its tagged course (cascades the interview session). */
import { describe, it, expect, afterAll } from 'vitest';
import type { EvidenceMap } from '@/lib/capture/staged/evidence-map';

const EMPTY: EvidenceMap = {
  summary: '', graded_work: [], tests: [], competencies: [], assumed_skills: [], objectives: [], conflicts: [], unreadable: [],
};

try { process.loadEnvFile('.env.local'); } catch { /* no .env.local: the suite skips */ }
const SCRATCH = /\/gc_curriculum_builder_scratch(\?|$)/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('capture-interview-sessions-queries (scratch database)', () => {
  const code = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionId = crypto.randomUUID();

  afterAll(async () => {
    const { db } = await import('@/lib/db/client');
    const { courses } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    await db.delete(courses).where(eq(courses.code, code));
  });

  it('creates pending with a null map; a second create is a no-op; save and edit round-trip', async () => {
    const { db } = await import('@/lib/db/client');
    const { courses } = await import('@/lib/db/schema');
    const q = await import('@/lib/db/capture-interview-sessions-queries');
    await db.insert(courses).values({ code, title: 't', level: 1, track: 'x' });

    expect(await q.getInterviewSession(crypto.randomUUID())).toBeNull();

    await q.createInterviewSession({ sessionId, courseCode: code });
    const first = await q.getInterviewSession(sessionId);
    expect(first?.mapStatus).toBe('pending');
    expect(first?.map).toBeNull();
    expect(first?.courseCode).toBe(code);

    await q.saveEvidenceMap(sessionId, { map: { ...EMPTY, summary: 'one' }, status: 'ready', fingerprint: 'fp1' });
    await q.createInterviewSession({ sessionId, courseCode: code });
    const saved = await q.getInterviewSession(sessionId);
    expect(saved?.mapStatus).toBe('ready');
    expect(saved?.map).toEqual({ ...EMPTY, summary: 'one' });
    expect(saved?.materialsFingerprint).toBe('fp1');
    expect(saved?.mapEditedAt).toBeNull();

    await q.saveEditedEvidenceMap(sessionId, { ...EMPTY, summary: 'two' });
    const edited = await q.getInterviewSession(sessionId);
    expect(edited?.map).toEqual({ ...EMPTY, summary: 'two' });
    expect(edited?.mapEditedAt).toBeInstanceOf(Date);
  });
});
