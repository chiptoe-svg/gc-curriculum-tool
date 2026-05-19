import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partnerSessions } from '@/lib/db/schema';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'gc_partner_sess';

export async function createSession(partnerId: string) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [row] = await db.insert(partnerSessions).values({ partnerId, expiresAt }).returning();
  if (!row) throw new Error('createSession: insert returned no row');
  return { id: row.id, expiresAt };
}

export async function lookupSession(id: string) {
  const rows = await db.select().from(partnerSessions).where(eq(partnerSessions.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function revokeSession(id: string) {
  await db.delete(partnerSessions).where(eq(partnerSessions.id, id));
}
