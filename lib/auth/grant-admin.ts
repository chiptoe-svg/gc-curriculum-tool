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
import { and, eq, isNull } from 'drizzle-orm';
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

/** C0 controls + DEL — rejected in label/email (fix round 1, L6). */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Strict `8-4-4-4-12` hex UUID shape — validate before any query touches
 * the DB (fix round 1, L3), so a malformed id 400s instead of risking a raw
 * Postgres `22P02 invalid input syntax for type uuid` 500 (which would also
 * skip the route's `no-store` header). Tightened in fix round 2 (N5): the
 * previous `/^[0-9a-f-]{36}$/i` accepted any 36-char mix of hex digits and
 * hyphens regardless of placement — 36 bare hyphens, or 36 `a`s with none —
 * which still reach the DB and 500 the same way. */
export function isValidGrantId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
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

/** Trimmed, 1-120 chars, no control characters. */
export function validateLabel(raw: unknown): { label: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'label must be a string' };
  const label = raw.trim();
  if (label.length < 1 || label.length > 120) return { error: 'label must be 1-120 characters' };
  if (CONTROL_CHARS.test(label)) return { error: 'label must not contain control characters' };
  return { label };
}

/** Optional. Empty/whitespace/undefined/null all mean "no email" (not an
 * error). Otherwise: one '@', no whitespace, no control characters, <=254 chars. */
export function validateEmail(raw: unknown): { email: string | null } | { error: string } {
  if (raw === undefined || raw === null) return { email: null };
  if (typeof raw !== 'string') return { error: 'email must be a string' };
  const email = raw.trim();
  if (email === '') return { email: null };
  if (CONTROL_CHARS.test(email)) return { error: 'email must not contain control characters' };
  if (email.length > 254 || /\s/.test(email) || email.split('@').length !== 2 || email.startsWith('@') || email.endsWith('@')) {
    return { error: 'email must look like an email address' };
  }
  return { email };
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC instant for 23:59:59.999 America/New_York on the given
 * `YYYY-MM-DD` date, DST-aware via Intl (no tz library installed). Returns
 * null for a string that isn't a real calendar date (e.g. 2026-02-30). */
function endOfDayEastern(dateStr: string): Date | null {
  const m = DATE_ONLY.exec(dateStr);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Reject non-calendar dates: Date.UTC normalizes overflow (e.g. day 30 of
  // a 28-day February rolls into March), so round-tripping catches it.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset',
    hour: '2-digit',
  }).formatToParts(new Date(Date.UTC(year, month - 1, day, 12)));
  const offsetValue = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const offsetMatch = /GMT([+-]\d{2}):?(\d{2})?/.exec(offsetValue);
  const offsetMinutes = offsetMatch
    ? (offsetMatch[1]!.startsWith('-') ? -1 : 1) * (Math.abs(Number(offsetMatch[1])) * 60 + Number(offsetMatch[2] ?? 0))
    : -300; // fall back to standard EST if Intl ever fails to report an offset

  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - offsetMinutes * 60_000);
}

/** Optional date string; undefined/null/empty means never expires. A plain
 * `YYYY-MM-DD` date (what an `<input type="date">` sends) is interpreted as
 * end of that day in America/New_York (fix round 1, L5) — not UTC midnight,
 * which would make a link entered as "expires Oct 10" die the evening of
 * Oct 9 Eastern. A full ISO/date-time string is parsed as given. */
export function validateExpiresAt(raw: unknown): { expiresAt: Date | null } | { error: string } {
  if (raw === undefined || raw === null) return { expiresAt: null };
  if (typeof raw !== 'string') return { error: 'expiresAt must be a date string or null' };
  if (raw.trim() === '') return { expiresAt: null };
  if (DATE_ONLY.test(raw)) {
    const expiresAt = endOfDayEastern(raw);
    if (!expiresAt) return { error: 'expiresAt must be a valid date' };
    return { expiresAt };
  }
  const expiresAt = new Date(raw);
  if (isNaN(expiresAt.getTime())) return { error: 'expiresAt must be a valid date' };
  return { expiresAt };
}

/** `'*'` or a non-empty, deduped array of course codes, all present in
 * `known` (normalized before comparing and before storing). `'*'` can never
 * be mixed into the array, nor smuggled in percent-encoded (fix round 1,
 * L2) — use the literal string `'*'` for "all courses" instead. Unknown
 * codes are named in the error so the caller can 400 with a useful message. */
export function resolveScope(courses: unknown, known: string[]): { scope: string[] } | { error: string } {
  if (courses === '*') return { scope: ['*'] };
  if (!Array.isArray(courses) || courses.length === 0 || !courses.every((c) => typeof c === 'string')) {
    return { error: "courses must be '*' or a non-empty array of course codes" };
  }
  const normalized = courses.map((c) => normalizeCode(c));
  if (normalized.some((c) => c === '*')) {
    return { error: "'*' cannot be mixed with course codes — use the All-courses option for every course" };
  }
  const scope = Array.from(new Set(normalized));
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
 * edit, per spec), `'admin-managed'` when the grant's `can` includes `admin`
 * (those are CLI-minted and the panel must not touch them — fix round 1,
 * L1), and `'not-found'` when the id doesn't exist. Only the keys present in
 * `patch` are written. */
export async function patchGrant(id: string, patch: GrantPatch): Promise<'ok' | 'not-found' | 'revoked' | 'admin-managed'> {
  const rows = (await db.select().from(accessGrants).where(eq(accessGrants.id, id)).limit(1)) as GrantRow[];
  const existing = rows[0];
  if (!existing) return 'not-found';
  if (existing.can.includes('admin')) return 'admin-managed';
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

/** 5-minute grace window (G3c, security re-review 2026-10-07): a grant
 * expiring within this window is treated as NOT live "for this purpose" —
 * neither as a target worth protecting, nor as an "other" admin reliable
 * enough to cover someone else's revoke. Prevents the sequence "revoke A,
 * because B still has 60s left" from leaving zero working admins moments
 * later. */
const ADMIN_GUARD_GRACE_MS = 5 * 60 * 1000;

/**
 * Whether `g` is a REAL, currently-live admin grant for last-admin-guard
 * purposes: not revoked, `can` includes `admin`, `scope` is exactly `['*']`
 * (G3b — a course-scoped grant with `admin` in `can` gives no actual admin
 * access; `authorize()` requires `scope.includes('*')`, so such a grant
 * must never count as a protector, nor be protected itself), and not
 * expiring within `ADMIN_GUARD_GRACE_MS`.
 */
function isGuardedAdmin(g: { revokedAt: Date | null; expiresAt: Date | null; scope: string[]; can: Capability[] }, now: Date): boolean {
  if (g.revokedAt) return false;
  if (!g.scope.includes('*')) return false;
  if (!g.can.includes('admin')) return false;
  if (g.expiresAt && g.expiresAt.getTime() <= now.getTime() + ADMIN_GUARD_GRACE_MS) return false;
  return true;
}

/**
 * Sets `revoked_at`. Idempotent: a grant already revoked is left alone (its
 * original revoke time is never overwritten) and still reports `'ok'`.
 *
 * `'last-admin'` (security review F3, re-reviewed G3, 2026-10-07): refuses
 * to revoke a currently-guarded admin grant (see `isGuardedAdmin` — scope
 * `['*']`, `can` includes `admin`, live, not expiring within 5 minutes)
 * when no OTHER guarded admin grant exists. Built-in Basic Auth no longer
 * carries `admin` for anyone (2026-10-07, department login), so a DB grant
 * is the only remaining way into `/admin`/`/api/admin/**` — the owner
 * revoking their own last one would lock out every admin surface,
 * recoverable only from the CLI (`pnpm access:grant … --can
 * capture,create,admin`; note `scripts/access/revoke.ts` bypasses this
 * guard entirely — see STATE.md). A grant that isn't currently guarded
 * (already expired, expiring imminently, or course-scoped) is never
 * itself protected, and never counts as protecting another.
 *
 * ATOMIC (G3a): the whole decide-then-update runs inside one
 * `db.transaction`, reading every row with `.for('update')` — a real
 * Postgres row lock that blocks a second concurrent `revokeGrant` call's
 * own `SELECT … FOR UPDATE` on the same rows until this transaction
 * commits or rolls back. Without it, two concurrent revokes of two
 * different admin grants could each see the OTHER as live (both reading
 * before either writes) and both succeed, leaving zero admins — verified
 * with a forced interleaving in grant-admin-revoke-atomic.test.ts.
 */
export async function revokeGrant(id: string, now: Date = new Date()): Promise<'ok' | 'not-found' | 'last-admin'> {
  return db.transaction(async (tx) => {
    // One query for the whole table rather than two (target + "any other
    // live admin") — the table is small (faculty access grants) and this
    // avoids a second round trip under the same lock. `can`/`scope` are
    // jsonb columns, not filterable by a simple SQL predicate without a
    // dedicated operator, so the "does another live admin grant exist"
    // check is done in JS over all rows. `.for('update')` locks every row
    // read here for the duration of this transaction.
    const rows = (await tx.select().from(accessGrants).for('update')) as GrantRow[];
    const existing = rows.find((r) => r.id === id);
    if (!existing) return 'not-found';
    if (existing.revokedAt) return 'ok'; // idempotent — nothing to check or change

    if (isGuardedAdmin(existing, now)) {
      const anotherGuardedAdmin = rows.some((r) => r.id !== id && isGuardedAdmin(r, now));
      if (!anotherGuardedAdmin) return 'last-admin';
    }

    await tx.update(accessGrants).set({ revokedAt: now }).where(eq(accessGrants.id, id));
    return 'ok';
  });
}

export type ReissueResult = { grant: AdminGrant; token: string } | 'not-found' | 'revoked' | 'admin-managed' | 'expired';

/**
 * "Send a new link": revoke the old grant and mint a replacement with the
 * same label/email/scope/expiresAt (and `can` rebuilt from the create flag,
 * never copied verbatim — fix round 1, L1), in one transaction — so there is
 * never a moment with two live grants for one person, nor zero rows if the
 * insert fails. Revoking (not rotating the old row's hash) is deliberate:
 * sessions are keyed by grant id, so a rotated hash would leave the old
 * link's already-signed-in browsers alive; revoking kills them via
 * `isLive`/`grantFromSessionCookie`.
 *
 * Refuses (no mutation) before attempting any write:
 *   - `'not-found'` — no such id.
 *   - `'admin-managed'` — the grant's `can` includes `admin`; those are
 *     CLI-minted and the panel must not re-mint them (fix round 1, L1).
 *   - `'revoked'` — already revoked.
 *   - `'expired'` — already past its expiry; reissuing it would hand back a
 *     link that's dead on arrival (fix round 1, L5) — edit the expiry first.
 *
 * The actual atomicity guard against a double reissue (two requests for the
 * same id, sequential or concurrent) is the conditional
 * `UPDATE … WHERE id = $1 AND revoked_at IS NULL RETURNING *` below, not the
 * read above (which only decides which 409 to show without mutating). Under
 * READ COMMITTED a second UPDATE for the same id blocks on the first
 * transaction's row lock, then re-evaluates `revoked_at IS NULL` against the
 * now-committed row and matches zero rows — so at most one caller ever
 * reaches the insert (fix round 1, M1).
 */
export async function reissueGrant(id: string): Promise<ReissueResult> {
  return db.transaction(async (tx) => {
    const rows = (await tx.select().from(accessGrants).where(eq(accessGrants.id, id)).limit(1)) as GrantRow[];
    const existing = rows[0];
    if (!existing) return 'not-found';
    if (existing.can.includes('admin')) return 'admin-managed';
    const status = computeStatus(existing);
    if (status === 'revoked') return 'revoked';
    if (status === 'expired') return 'expired';

    const claimed = (await tx
      .update(accessGrants)
      .set({ revokedAt: new Date() })
      .where(and(eq(accessGrants.id, id), isNull(accessGrants.revokedAt)))
      .returning()) as GrantRow[];
    if (!claimed[0]) return 'revoked';

    const token = newToken();
    const [row] = await tx
      .insert(accessGrants)
      .values({
        tokenHash: hashToken(token),
        label: existing.label,
        email: existing.email,
        scope: existing.scope,
        can: buildCan(existing.can.includes('create')),
        expiresAt: existing.expiresAt,
      })
      .returning();
    return { grant: toAdminGrant(row as GrantRow), token };
  });
}
