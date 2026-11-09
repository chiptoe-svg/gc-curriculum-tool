import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { captureSessions } from '@/lib/db/schema';

/** How an instructor is revising an approved course (spec 2026-11-08):
 *  a few specific things changed / re-check the whole course / start over. */
export type RevisionMode = 'targeted' | 'recheck' | 'fresh';

export const REVISION_MODES: readonly RevisionMode[] = ['targeted', 'recheck', 'fresh'];

export function isRevisionMode(v: unknown): v is RevisionMode {
  return typeof v === 'string' && (REVISION_MODES as readonly string[]).includes(v);
}

/** Store a session's mode. The first write wins: the mode is fixed for the
 *  session, so a later call for the same session is a no-op. */
export async function recordSessionMode(input: {
  sessionId: string;
  courseCode: string;
  revisionMode: RevisionMode;
  baselineSnapshotId: string | null;
}): Promise<void> {
  await db.insert(captureSessions).values({
    sessionId: input.sessionId,
    courseCode: input.courseCode,
    revisionMode: input.revisionMode,
    baselineSnapshotId: input.baselineSnapshotId,
  }).onConflictDoNothing({ target: captureSessions.sessionId });
}

export async function getSessionMode(
  sessionId: string,
): Promise<{ revisionMode: RevisionMode; baselineSnapshotId: string | null } | null> {
  const [row] = await db
    .select({ revisionMode: captureSessions.revisionMode, baselineSnapshotId: captureSessions.baselineSnapshotId })
    .from(captureSessions)
    .where(eq(captureSessions.sessionId, sessionId));
  return row ?? null;
}
