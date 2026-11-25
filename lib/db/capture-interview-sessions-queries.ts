import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { captureInterviewSessions } from '@/lib/db/schema';
import type { EvidenceMap } from '@/lib/capture/staged/evidence-map';

export type InterviewSessionRow = {
  sessionId: string;
  courseCode: string;
  map: EvidenceMap | null;
  mapStatus: 'pending' | 'ready' | 'failed' | 'none';
  materialsFingerprint: string | null;
  mapEditedAt: Date | null;
  mapStartedAt: Date | null;
  createdAt: Date;
};

/** First write wins: a second create for the same session id is a no-op. */
export async function createInterviewSession(input: { sessionId: string; courseCode: string }): Promise<void> {
  await db
    .insert(captureInterviewSessions)
    .values({ sessionId: input.sessionId, courseCode: input.courseCode, mapStatus: 'pending', mapStartedAt: new Date() })
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

/**
 * Claim the right to run a pre-read: true for exactly one caller. Refused while another read is in flight
 * (pending and started less than `staleSeconds` ago) and once the instructor has edited the map.
 */
export async function claimPreRead(sessionId: string, staleSeconds = 240): Promise<boolean> {
  const r = await db
    .update(captureInterviewSessions)
    .set({ mapStatus: 'pending', mapStartedAt: sql`now()` })
    .where(and(
      eq(captureInterviewSessions.sessionId, sessionId),
      isNull(captureInterviewSessions.mapEditedAt),
      sql`(${captureInterviewSessions.mapStatus} <> 'pending' OR ${captureInterviewSessions.mapStartedAt} IS NULL OR ${captureInterviewSessions.mapStartedAt} < now() - make_interval(secs => ${staleSeconds}))`,
    ))
    .returning({ sessionId: captureInterviewSessions.sessionId });
  return r.length > 0;
}

/** Saves a read's result unless the instructor has edited the map meanwhile; an edited row just leaves 'pending'. */
export async function saveEvidenceMap(
  sessionId: string,
  input: { map: EvidenceMap | null; status: 'ready' | 'failed' | 'none'; fingerprint: string | null },
): Promise<void> {
  await db
    .update(captureInterviewSessions)
    .set({ map: input.map, mapStatus: input.status, materialsFingerprint: input.fingerprint })
    .where(and(eq(captureInterviewSessions.sessionId, sessionId), isNull(captureInterviewSessions.mapEditedAt)));
  await db
    .update(captureInterviewSessions)
    .set({ mapStatus: 'ready' })
    .where(and(
      eq(captureInterviewSessions.sessionId, sessionId),
      eq(captureInterviewSessions.mapStatus, 'pending'),
      sql`${captureInterviewSessions.mapEditedAt} IS NOT NULL`,
    ));
}

/** An edited map is the instructor's final word: when its read is gone, settle the status to 'ready'. */
export async function markEditedReady(sessionId: string): Promise<void> {
  await db
    .update(captureInterviewSessions)
    .set({ mapStatus: 'ready' })
    .where(and(
      eq(captureInterviewSessions.sessionId, sessionId),
      sql`${captureInterviewSessions.mapEditedAt} IS NOT NULL`,
      sql`${captureInterviewSessions.mapStatus} <> 'ready'`,
    ));
}

export async function saveEditedEvidenceMap(sessionId: string, map: EvidenceMap): Promise<void> {
  await db
    .update(captureInterviewSessions)
    .set({ map, mapEditedAt: new Date() })
    .where(eq(captureInterviewSessions.sessionId, sessionId));
}
