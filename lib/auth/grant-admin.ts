/**
 * Shared admin-side grant helpers — the faculty access panel (spec:
 * docs/superpowers/specs/2026-10-07-faculty-access-panel-design.md) and
 * scripts/access/grant.ts both mint through `createGrant`, so there is one
 * code path from label/courses/can/expiry to an inserted row + one-time
 * token. `checkCourses` moved here from scripts/access/lib.ts for the same
 * reason (the API needs it too); scripts/access/lib.ts re-exports it so the
 * CLI script and its existing test keep working unchanged.
 *
 * The panel never grants `admin` — structurally, not by validation: `can` is
 * always built here from `buildCan(canCreate)`, a fixed `['capture']` plus an
 * optional `'create'`. No caller ever threads a user-supplied `can` array
 * through to the DB, so there is no body shape that can produce `admin`.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { accessGrants } from '@/lib/db/schema';
import { newToken, hashToken } from '@/lib/auth/grants';
import { normalizeCode, type Capability } from '@/lib/auth/authorize';

export type AdminGrantStatus = 'active' | 'expired' | 'revoked';

export interface AdminGrant {
  id: string;
  label: string;
  email: string | null;
  scope: string[];
  can: Capability[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  status: AdminGrantStatus;
}

type GrantRow = {
  id: string;
  tokenHash: string;
  label: string;
  email: string | null;
  scope: string[];
  can: Capability[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export interface CreateGrantInput {
  label: string;
  email: string | null;
  scope: string[];
  can: Capability[];
  expiresAt: Date | null;
}

export interface GrantPatch {
  label?: string;
  email?: string | null;
  scope?: string[];
  can?: Capability[];
  expiresAt?: Date | null;
}

const DEFAULT_ORIGIN = 'https://gcworkflow.clemson.edu:8443';

/** `can` is always `capture` plus `create` when requested — never `admin`. */
export function buildCan(canCreate: boolean): Capability[] {
  return canCreate ? ['capture', 'create'] : ['capture'];
}

/** Codes in `scope` not present in `known` (case/whitespace-normalized); `'*'` never flags. */
export function checkCourses(scope: string[], known: string[]): string[] {
  const k = new Set(known.map(normalizeCode));
  return scope.filter((s) => s !== '*' && !k.has(normalizeCode(s)));
}

export function computeStatus(
  g: { revokedAt: Date | null; expiresAt: Date | null },
  now = new Date(),
): AdminGrantStatus {
  if (g.revokedAt) return 'revoked';
  if (g.expiresAt && g.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

/** `${origin}/?key=<token>` — never stored or logged beyond the single response that returns it. */
export function buildAccessLink(token: string, origin = DEFAULT_ORIGIN): string {
  return `${origin.replace(/\/$/, '')}/?key=${token}`;
}

function toAdminGrant(row: GrantRow, now = new Date()): AdminGrant {
  return {
    id: row.id,
    label: row.label,
    email: row.email,
    scope: row.scope,
    can: row.can,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    status: computeStatus(row, now),
  };
}

/** Trimmed, 1-120 chars. */
export function validateLabel(raw: unknown): { label: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'label must be a string' };
  const label = raw.trim();
  if (label.length < 1 || label.length > 120) return { error: 'label must be 1-120 characters' };
  return { label };
}

/** Optional. Empty/whitespace/undefined/null all mean "no email" (not an
 * error). Otherwise: one '@', no whitespace, <=254 chars. */
export function validateEmail(raw: unknown): { email: string | null } | { error: string } {
  if (raw === undefined || raw === null) return { email: null };
  if (typeof raw !== 'string') return { error: 'email must be a string' };
  const email = raw.trim();
  if (email === '') return { email: null };
  if (email.length > 254 || /\s/.test(email) || email.split('@').length !== 2 || email.startsWith('@') || email.endsWith('@')) {
    return { error: 'email must look like an email address' };
  }
  return { email };
}

/** Optional ISO-ish date string; undefined/null means never expires. */
export function validateExpiresAt(raw: unknown): { expiresAt: Date | null } | { error: string } {
  if (raw === undefined || raw === null) return { expiresAt: null };
  if (typeof raw !== 'string') return { error: 'expiresAt must be a date string or null' };
  const expiresAt = new Date(raw);
  if (isNaN(expiresAt.getTime())) return { error: 'expiresAt must be a valid date' };
  return { expiresAt };
}

/** `'*'` or a non-empty array of course codes, all present in `known`
 * (normalized before comparing and before storing). Unknown codes are named
 * in the error so the caller can 400 with a useful message. */
export function resolveScope(courses: unknown, known: string[]): { scope: string[] } | { error: string } {
  if (courses === '*') return { scope: ['*'] };
  if (!Array.isArray(courses) || courses.length === 0 || !courses.every((c) => typeof c === 'string')) {
    return { error: "courses must be '*' or a non-empty array of course codes" };
  }
  const scope = courses.map((c) => normalizeCode(c));
  const unknown = checkCourses(scope, known);
  if (unknown.length) return { error: `not in the roster: ${unknown.join(', ')}` };
  return { scope };
}

/** Mints a token, inserts the grant, and returns it with the token — the ONLY
 * place the raw token is ever available (never stored, never logged again). */
export async function createGrant(input: CreateGrantInput): Promise<AdminGrant & { token: string }> {
  const token = newToken();
  const [row] = await db
    .insert(accessGrants)
    .values({
      tokenHash: hashToken(token),
      label: input.label,
      email: input.email,
      scope: input.scope,
      can: input.can,
      expiresAt: input.expiresAt,
    })
    .returning();
  return { ...toAdminGrant(row as GrantRow), token };
}

/** Every grant minus `tokenHash`, for the admin list view. Built-in grants
 * (Basic Auth) are never rows here, so they never need excluding. */
export async function listGrantsForAdmin(now = new Date()): Promise<AdminGrant[]> {
  const rows = (await db.select().from(accessGrants).orderBy(accessGrants.createdAt)) as GrantRow[];
  return rows.map((r) => toAdminGrant(r, now));
}

/** Edits fields in place. `'revoked'` when the grant is revoked (refuse to
 * edit, per spec) and `'not-found'` when the id doesn't exist. Only the keys
 * present in `patch` are written. */
export async function patchGrant(id: string, patch: GrantPatch): Promise<'ok' | 'not-found' | 'revoked'> {
  const rows = (await db.select().from(accessGrants).where(eq(accessGrants.id, id)).limit(1)) as GrantRow[];
  const existing = rows[0];
  if (!existing) return 'not-found';
  if (existing.revokedAt) return 'revoked';

  const set: Partial<GrantRow> = {};
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.email !== undefined) set.email = patch.email;
  if (patch.scope !== undefined) set.scope = patch.scope;
  if (patch.can !== undefined) set.can = patch.can;
  if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt;
  if (Object.keys(set).length === 0) return 'ok';

  await db.update(accessGrants).set(set).where(eq(accessGrants.id, id));
  return 'ok';
}

/** Sets `revoked_at`. Idempotent: a grant already revoked is left alone (its
 * original revoke time is never overwritten) and still reports `'ok'`. */
export async function revokeGrant(id: string): Promise<'ok' | 'not-found'> {
  const rows = (await db.select().from(accessGrants).where(eq(accessGrants.id, id)).limit(1)) as GrantRow[];
  const existing = rows[0];
  if (!existing) return 'not-found';
  if (!existing.revokedAt) {
    await db.update(accessGrants).set({ revokedAt: new Date() }).where(eq(accessGrants.id, id));
  }
  return 'ok';
}

/**
 * "Send a new link": revoke the old grant and mint a replacement with the
 * same label/email/scope/can/expiresAt, in one transaction — so there is
 * never a moment with two live grants for one person, nor zero rows if the
 * insert fails. Revoking (not rotating the old row's hash) is deliberate:
 * sessions are keyed by grant id, so a rotated hash would leave the old
 * link's already-signed-in browsers alive; revoking kills them via
 * `isLive`/`grantFromSessionCookie`. Returns null if `id` doesn't exist.
 */
export async function reissueGrant(id: string): Promise<{ grant: AdminGrant; token: string } | null> {
  return db.transaction(async (tx) => {
    const rows = (await tx.select().from(accessGrants).where(eq(accessGrants.id, id)).limit(1)) as GrantRow[];
    const existing = rows[0];
    if (!existing) return null;

    await tx.update(accessGrants).set({ revokedAt: new Date() }).where(eq(accessGrants.id, id));

    const token = newToken();
    const [row] = await tx
      .insert(accessGrants)
      .values({
        tokenHash: hashToken(token),
        label: existing.label,
        email: existing.email,
        scope: existing.scope,
        can: existing.can,
        expiresAt: existing.expiresAt,
      })
      .returning();
    return { grant: toAdminGrant(row as GrantRow), token };
  });
}
