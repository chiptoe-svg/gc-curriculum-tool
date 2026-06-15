import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { sandboxSessions } from '@/lib/db/schema';

export const SCOPED_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SCOPED_SESSION_COOKIE = 'gc_sandbox_sess';

export function isSessionExpired(s: { expiresAt: Date }): boolean {
  return s.expiresAt.getTime() < Date.now();
}

export async function createScopedSession(input: { grantId: string; courseCode: string; instructorName: string }) {
  const expiresAt = new Date(Date.now() + SCOPED_SESSION_TTL_MS);
  const [row] = await db.insert(sandboxSessions).values({
    grantId: input.grantId, courseCode: input.courseCode, instructorName: input.instructorName, expiresAt,
  }).returning();
  if (!row) throw new Error('createScopedSession: insert returned no row');
  return { id: row.id, expiresAt };
}

export async function lookupScopedSession(id: string) {
  const rows = await db.select().from(sandboxSessions).where(eq(sandboxSessions.id, id)).limit(1);
  const row = rows[0];
  if (!row || isSessionExpired(row)) return null;
  return row;
}

export async function revokeScopedSession(id: string) {
  await db.delete(sandboxSessions).where(eq(sandboxSessions.id, id));
}
