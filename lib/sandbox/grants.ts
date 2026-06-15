import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { sandboxGrants } from '@/lib/db/schema';

export const GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface GrantValidityFields {
  active: boolean;
  revokedAt: Date | null;
  expiresAt: Date;
}

/** A grant is usable iff active, not revoked, and not past expiry. */
export function isGrantValid(g: GrantValidityFields): boolean {
  return g.active && g.revokedAt === null && g.expiresAt.getTime() > Date.now();
}

/** Mint a generic, course-LESS invite (the tester defines their course at the link). */
export async function createGrant(input: { label?: string | null } = {}) {
  const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
  const expiresAt = new Date(Date.now() + GRANT_TTL_MS);
  const [row] = await db.insert(sandboxGrants).values({
    token, courseCode: null, label: input.label ?? null, expiresAt,
  }).returning();
  if (!row) throw new Error('createGrant: insert returned no row');
  return row;
}

export async function getGrantByToken(token: string) {
  const rows = await db.select().from(sandboxGrants).where(eq(sandboxGrants.token, token)).limit(1);
  return rows[0] ?? null;
}

export async function getGrantById(id: string) {
  const rows = await db.select().from(sandboxGrants).where(eq(sandboxGrants.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listGrants() {
  return db.select().from(sandboxGrants).orderBy(desc(sandboxGrants.createdAt));
}

export async function revokeGrant(id: string) {
  await db.update(sandboxGrants).set({ active: false, revokedAt: new Date() }).where(eq(sandboxGrants.id, id));
}
