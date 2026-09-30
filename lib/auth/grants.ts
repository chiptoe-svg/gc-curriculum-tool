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

export type BuiltinRole = 'faculty' | 'creator';

/** First 16 hex of HMAC-SHA256(SESSION_SECRET, credential): binds a built-in
 * session to the Basic credential it was minted from, so rotating
 * FACULTY_BASIC_AUTH / CREATE_ONLY_AUTH kills every cookie minted from the old
 * value (2026-09-30 final review, I1). Keyed, not a bare hash, so a leaked
 * cookie gives no offline handle on a low-entropy shared password (tail round). */
export function credentialFingerprint(credential: string, secret: string): string {
  return createHmac('sha256', secret).update(credential).digest('hex').slice(0, 16);
}

/** id is `builtin:<role>:<fingerprint of the credential>`. Without a
 * SESSION_SECRET no cookie is ever issued or accepted, so the id is the bare
 * `builtin:<role>` (which builtinFromId never accepts). */
export function builtinGrant(role: BuiltinRole, credential: string, secret: string | undefined): Grant {
  const id = secret ? `builtin:${role}:${credentialFingerprint(credential, secret)}` : `builtin:${role}`;
  return role === 'faculty'
    ? { id, label: 'Department login', scope: ['*'], can: ['capture', 'create', 'admin'] }
    : { id, label: 'Create-only login', scope: [], can: ['create'] };
}

/** Rebuild a built-in grant from a verified cookie id against the CURRENT
 * credentials. null (dead) when the id is not a well-formed built-in id, the
 * role's credential is unset, or the fingerprint no longer matches. */
export function builtinFromId(id: string, env: { faculty?: string; creator?: string; sessionSecret?: string }): Grant | null {
  const m = /^builtin:(faculty|creator):([0-9a-f]{16})$/.exec(id);
  if (!m || !env.sessionSecret) return null;
  const role = m[1] as BuiltinRole;
  const credential = env[role];
  if (!credential || credentialFingerprint(credential, env.sessionSecret) !== m[2]) return null;
  return builtinGrant(role, credential, env.sessionSecret);
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

/**
 * Resolve a raw `gc_session` cookie value to its grant. null = no cookie;
 * 'dead' = present but unusable (bad MAC, unknown/revoked/expired grant, or a
 * built-in cookie whose credential has since rotated or been unset — I1).
 * DB errors propagate. Shared by gate() and the upload routes that sit
 * outside the middleware matcher (lib/sandbox/access.ts). `findGrantById` is
 * injected so callers (and tests) control the lookup.
 */
export async function grantFromSessionCookie(
  raw: string | undefined,
  deps: {
    findGrantById(id: string): Promise<StoredGrant | null>;
    env: { sessionSecret?: string; faculty?: string; creator?: string };
    now?: () => Date;
  },
): Promise<Grant | null | 'dead'> {
  if (!raw) return null;
  const id = deps.env.sessionSecret ? verifySession(raw, deps.env.sessionSecret) : null;
  if (!id) return 'dead';
  if (id.startsWith('builtin:')) return builtinFromId(id, deps.env) ?? 'dead';
  const stored = await deps.findGrantById(id);
  if (!stored || !isLive(stored, deps.now?.())) return 'dead';
  return stored;
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
