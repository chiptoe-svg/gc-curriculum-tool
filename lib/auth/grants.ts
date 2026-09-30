import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { accessGrants } from '@/lib/db/schema';
import type { Grant } from '@/lib/auth/authorize';

export const SESSION_COOKIE = 'gc_session';
export const MAX_COOKIE_AGE_S = 30 * 24 * 3600;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function newToken(): string { return randomBytes(32).toString('base64url'); }
export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }

function mac(id: string, secret: string): string {
  return createHmac('sha256', secret).update(id).digest('base64url');
}
export function signSession(id: string, secret: string): string { return `${id}.${mac(id, secret)}`; }
export function verifySession(value: string | undefined, secret: string): string | null {
  if (!value || !secret) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot), given = value.slice(dot + 1);
  const want = mac(id, secret);
  const a = Buffer.from(given), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export function builtinGrant(role: 'faculty' | 'creator'): Grant {
  return role === 'faculty'
    ? { id: 'builtin:faculty', label: 'Department login', scope: ['*'], can: ['capture', 'create', 'admin'] }
    : { id: 'builtin:creator', label: 'Create-only login', scope: [], can: ['create'] };
}

export interface StoredGrant extends Grant { expiresAt: Date | null; revokedAt: Date | null; lastUsedAt: Date | null }

export function isLive(g: { expiresAt: Date | null; revokedAt: Date | null }, now = new Date()): boolean {
  if (g.revokedAt) return false;
  if (g.expiresAt && g.expiresAt.getTime() < now.getTime()) return false;
  return true;
}
export function cookieMaxAge(g: { expiresAt: Date | null }, now = new Date()): number {
  if (!g.expiresAt) return MAX_COOKIE_AGE_S;
  return Math.max(0, Math.min(MAX_COOKIE_AGE_S, Math.floor((g.expiresAt.getTime() - now.getTime()) / 1000)));
}

function toStored(r: typeof accessGrants.$inferSelect): StoredGrant {
  return { id: r.id, label: r.label, scope: r.scope, can: r.can, expiresAt: r.expiresAt, revokedAt: r.revokedAt, lastUsedAt: r.lastUsedAt };
}
export async function findGrantByToken(token: string): Promise<StoredGrant | null> {
  const rows = await db.select().from(accessGrants).where(eq(accessGrants.tokenHash, hashToken(token))).limit(1);
  return rows[0] ? toStored(rows[0]) : null;
}
export async function findGrantById(id: string): Promise<StoredGrant | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null; // built-in ids never hit the DB
  const rows = await db.select().from(accessGrants).where(eq(accessGrants.id, id)).limit(1);
  return rows[0] ? toStored(rows[0]) : null;
}
export async function touchLastUsed(id: string, now = new Date()): Promise<void> {
  const g = await findGrantById(id);
  if (!g) return;
  if (g.lastUsedAt && now.getTime() - g.lastUsedAt.getTime() < TOUCH_INTERVAL_MS) return;
  await db.update(accessGrants).set({ lastUsedAt: now }).where(eq(accessGrants.id, id));
}
