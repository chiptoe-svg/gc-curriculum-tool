import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { captureSessions } from '@/lib/db/schema';

import type { RevisionMode } from '@/lib/capture/revision-copy';

export { isRevisionMode, REVISION_MODES, type RevisionMode } from '@/lib/capture/revision-copy';

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
