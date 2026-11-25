import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { captureInterviewSessions } from '@/lib/db/schema';

// `map` is `unknown` until the EvidenceMap type exists (staged interview, Task 2).
export type InterviewSessionRow = {
  sessionId: string;
  courseCode: string;
  map: unknown;
  mapStatus: 'pending' | 'ready' | 'failed' | 'none';
  materialsFingerprint: string | null;
  mapEditedAt: Date | null;
  createdAt: Date;
};

/** First write wins: a second create for the same session id is a no-op. */
export async function createInterviewSession(input: { sessionId: string; courseCode: string }): Promise<void> {
  await db
    .insert(captureInterviewSessions)
    .values({ sessionId: input.sessionId, courseCode: input.courseCode, mapStatus: 'pending' })
    .onConflictDoNothing();
}

export async function getInterviewSession(sessionId: string): Promise<InterviewSessionRow | null> {
  const [row] = await db
    .select()
    .from(captureInterviewSessions)
    .where(eq(captureInterviewSessions.sessionId, sessionId))
    .limit(1);
  return row ? { ...row, map: row.map ?? null } : null;
}

export async function saveEvidenceMap(
  sessionId: string,
  input: { map: unknown; status: 'ready' | 'failed' | 'none'; fingerprint: string | null },
): Promise<void> {
  await db
    .update(captureInterviewSessions)
    .set({ map: input.map, mapStatus: input.status, materialsFingerprint: input.fingerprint })
    .where(eq(captureInterviewSessions.sessionId, sessionId));
}

export async function saveEditedEvidenceMap(sessionId: string, map: unknown): Promise<void> {
  await db
    .update(captureInterviewSessions)
    .set({ map, mapEditedAt: new Date() })
    .where(eq(captureInterviewSessions.sessionId, sessionId));
}
