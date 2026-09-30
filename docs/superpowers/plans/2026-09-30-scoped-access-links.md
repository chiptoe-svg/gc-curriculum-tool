# Scoped Access Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "shared password + `?slug=` on every request" with per-person magic links scoped to courses, exchanged once for a signed session cookie, enforced centrally in middleware with default-deny.

**Architecture:** A pure `authorize(grant, method, pathname)` decides read / course-write / create / admin from the real method and the path's `[code]` segment. `lib/auth/grants.ts` owns tokens (hashed at rest), the HMAC session cookie, the DB lookups and the two built-in grants that keep today's credentials working. The faculty branch of `middleware.ts` becomes: exchange `?key=` for a cookie (on any path), resolve cookie → Basic → 401 page, authorize → 403 page, then internally rewrite `?slug=` so the 43 untouched page checks pass. Owner-only scripts mint, list and revoke.

**Tech Stack:** Next.js 15 middleware (Node runtime, already), Drizzle + Postgres 17 (`drizzle-kit generate/migrate`), `node:crypto` (HMAC-SHA256, SHA-256, randomBytes), Vitest (`@/` alias, jsdom env), `tsx --env-file=.env.local` for scripts.

**Spec:** `docs/superpowers/specs/2026-09-30-scoped-access-links-design.md`

## Global Constraints

- Course codes compare after normalisation: URL-decode once, collapse whitespace to one space, trim, upper-case (`GC%201010` → `GC 1010`; `GC 4900ap` and `GC 4900AP` are the same course). Scope entries are normalised the same way.
- Only the real HTTP method is consulted; `X-HTTP-Method-Override` and `_method` are ignored.
- Default-deny: any gated non-GET/HEAD request not matched by the course-write or create patterns requires scope `*` **and** `admin`.
- `SESSION_SECRET` unset → no cookie is issued or accepted; `?key=` and Basic Auth still authorize the single request.
- Cookie: name `gc_session`, value `<id>.<base64url hmac>`, `HttpOnly; Secure; SameSite=Lax; Path=/`, max-age = min(grant remaining lifetime, 30 days).
- Tokens are 32 random bytes, base64url; only `sha256(token)` (hex) is stored (`token_hash`).
- The shared `FACULTY_BASIC_AUTH` and `CREATE_ONLY_AUTH` credentials and the `PROTOTYPE_SLUG` link keep working unchanged.
- No page or API route under `app/` is edited. Deploy = `pnpm build && launchctl kickstart -k gui/501/com.gc.curriculum-tool` in `~/projects/curriculum_developer-deploy` — never restart on a failed build.
- Commit after every task with the project's attribution trailer.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/auth/authorize.ts` (new) | Pure: `Grant`, `Capability`, `normalizeCode`, `classify`, `authorize`. No I/O. |
| `lib/auth/grants.ts` (new) | Tokens + hashing, session cookie sign/verify, built-in grants, DB lookups (`findGrantByToken`, `findGrantById`, `touchLastUsed`), liveness. |
| `lib/auth/gate.ts` (new) | `gate(req, deps)` — the faculty-branch decision as a pure-ish function over `NextRequest` with injected deps, returning `{kind:'next'|'redirect'|'rewrite'|'response', …}`. Middleware calls it. |
| `lib/auth/pages.ts` (new) | The 401 and 403 HTML bodies. |
| `lib/db/schema.ts` (modify) | `accessGrants` table. |
| `drizzle/0050_*.sql` (generated) | Migration. |
| `middleware.ts` (modify, faculty branch only) | Calls `gate()`; partner branch and interstitial untouched. |
| `scripts/access/lib.ts` (new) | Arg parsing + validation (pure) shared by the three commands. |
| `scripts/access/{grant,list,revoke}.ts` (new) | Owner CLI. |
| `package.json` (modify) | `access:grant`, `access:list`, `access:revoke`. |
| `.env.example`, `docs/STATE.md` (modify) | `SESSION_SECRET`; auth-model change; deferred slug-check cleanup. |
| `tests/auth/authorize.test.ts`, `tests/auth/grants.test.ts`, `tests/auth/gate.test.ts`, `tests/access/lib.test.ts` (new) | Red-first tests. |

---

### Task 1: `authorize()` — the pure scope table

**Files:**
- Create: `lib/auth/authorize.ts`
- Test: `tests/auth/authorize.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Capability = 'capture' | 'create' | 'admin';
  export interface Grant { id: string; label: string; scope: string[]; can: Capability[] }
  export type Kind = { kind: 'read' } | { kind: 'course-write'; code: string } | { kind: 'create' } | { kind: 'admin' };
  export function normalizeCode(raw: string): string;
  export function classify(method: string, pathname: string): Kind;
  export type Decision = { ok: true } | { ok: false; reason: 'needs-capture' | 'needs-create' | 'needs-admin' | 'out-of-scope'; code?: string };
  export function authorize(grant: Grant, method: string, pathname: string): Decision;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/auth/authorize.test.ts
import { describe, it, expect } from 'vitest';
import { authorize, classify, normalizeCode, type Grant } from '@/lib/auth/authorize';

const scoped: Grant = { id: 'g1', label: 'Danita — GC 3730', scope: ['GC 3730'], can: ['capture'] };
const creator: Grant = { id: 'g2', label: 'creator', scope: [], can: ['create'] };
const admin: Grant = { id: 'g3', label: 'dept', scope: ['*'], can: ['capture', 'create', 'admin'] };

describe('normalizeCode', () => {
  it.each([
    ['GC%201010', 'GC 1010'], ['GC 1010', 'GC 1010'], ['gc  4900ap', 'GC 4900AP'], [' GC 3460 ', 'GC 3460'],
  ])('%s → %s', (raw, want) => expect(normalizeCode(raw)).toBe(want));
  it('does not double-decode', () => expect(normalizeCode('GC%25201010')).toBe('GC%201010'));
});

describe('classify', () => {
  it('GET/HEAD anywhere gated is a read', () => {
    for (const p of ['/program', '/explore/GC%203730', '/courses', '/ask', '/api/ask', '/api/program/coverage', '/board/curriculum', '/capture/GC%201010', '/api/capture/GC%201010/context', '/admin'])
      for (const m of ['GET', 'HEAD']) expect(classify(m, p)).toEqual({ kind: 'read' });
  });
  it.each([
    ['POST', '/api/capture/GC%203730/chat', 'GC 3730'],
    ['DELETE', '/api/capture/GC%203730/messages/abc', 'GC 3730'],
    ['PUT', '/api/courses/GC%203730/materials/1', 'GC 3730'],
    ['POST', '/api/explore/GC%203730/scenarios/9/adopt', 'GC 3730'],
    ['PATCH', '/api/admin/courses/GC%203730/prereq-edges', 'GC 3730'],
    ['POST', '/api/courses/gc%204900ap/canvas-import', 'GC 4900AP'],
    ['POST', '/api/capture/GC%203730/', 'GC 3730'],
  ])('%s %s is a course write on %s', (m, p, code) => expect(classify(m, p)).toEqual({ kind: 'course-write', code }));
  it('the two create paths', () => {
    expect(classify('POST', '/courses/new')).toEqual({ kind: 'create' });
    expect(classify('POST', '/api/admin/courses/roster')).toEqual({ kind: 'create' });
  });
  it('everything else non-GET is admin (default-deny)', () => {
    for (const p of ['/api/admin/courses/roster/extra', '/api/admin/synthesis', '/api/program/coverage/refresh', '/api/settings', '/api/flags', '/api/some-future-route', '/api/courses', '/api/capture'])
      expect(classify('POST', p)).toEqual({ kind: 'admin' });
  });
});

describe('authorize', () => {
  it('reads are free for any grant', () => {
    expect(authorize(scoped, 'GET', '/capture/GC%201010')).toEqual({ ok: true });
    expect(authorize(creator, 'GET', '/program')).toEqual({ ok: true });
  });
  it('course write in scope', () => expect(authorize(scoped, 'POST', '/api/capture/GC%203730/chat')).toEqual({ ok: true }));
  it('course write out of scope', () =>
    expect(authorize(scoped, 'POST', '/api/capture/GC%201010/chat')).toEqual({ ok: false, reason: 'out-of-scope', code: 'GC 1010' }));
  it('course write needs the capture capability', () =>
    expect(authorize(creator, 'POST', '/api/capture/GC%203730/chat')).toEqual({ ok: false, reason: 'needs-capture', code: 'GC 3730' }));
  it('scope * covers every course', () => expect(authorize(admin, 'POST', '/api/courses/GC%202400/materials')).toEqual({ ok: true }));
  it('create', () => {
    expect(authorize(creator, 'POST', '/api/admin/courses/roster')).toEqual({ ok: true });
    expect(authorize(scoped, 'POST', '/api/admin/courses/roster')).toEqual({ ok: false, reason: 'needs-create' });
    expect(authorize(admin, 'POST', '/courses/new')).toEqual({ ok: true });
  });
  it('admin/unclassified writes need * and admin', () => {
    expect(authorize(admin, 'POST', '/api/admin/synthesis')).toEqual({ ok: true });
    expect(authorize(scoped, 'POST', '/api/admin/synthesis')).toEqual({ ok: false, reason: 'needs-admin' });
    expect(authorize({ ...admin, scope: ['GC 1010'] }, 'POST', '/api/admin/synthesis')).toEqual({ ok: false, reason: 'needs-admin' });
  });
  it('scope matching is normalised on both sides', () =>
    expect(authorize({ ...scoped, scope: ['gc 4900AP'] }, 'POST', '/api/capture/GC%204900ap/chat')).toEqual({ ok: true }));
  it('lower-case method is treated as its upper-case form', () =>
    expect(authorize(scoped, 'post', '/api/capture/GC%201010/chat').ok).toBe(false));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/auth/authorize.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/authorize`.

- [ ] **Step 3: Implement**

```ts
// lib/auth/authorize.ts
/**
 * The scope table — the single security boundary for faculty writes.
 * Pure: no I/O, no env. See docs/superpowers/specs/2026-09-30-scoped-access-links-design.md.
 */
export type Capability = 'capture' | 'create' | 'admin';
export interface Grant { id: string; label: string; scope: string[]; can: Capability[] }
export type Kind =
  | { kind: 'read' }
  | { kind: 'course-write'; code: string }
  | { kind: 'create' }
  | { kind: 'admin' };
export type Decision =
  | { ok: true }
  | { ok: false; reason: 'needs-capture' | 'needs-create' | 'needs-admin' | 'out-of-scope'; code?: string };

/** URL-decode ONCE, collapse whitespace, trim, upper-case. Never double-decodes. */
export function normalizeCode(raw: string): string {
  let s = raw;
  try { s = decodeURIComponent(raw); } catch { /* keep raw */ }
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

// Course-bound API families: the [code] is the segment right after the prefix.
const COURSE_WRITE_PREFIXES = ['/api/capture/', '/api/courses/', '/api/explore/', '/api/admin/courses/'];
// The two create paths (same list creatorAllowed enumerates today).
const CREATE_PATHS = new Set(['/courses/new', '/api/admin/courses/roster']);
const ROSTER_BULK = '/api/admin/courses/roster'; // its sub-paths are admin, not create

export function classify(method: string, pathname: string): Kind {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return { kind: 'read' };
  const path = pathname.replace(/\/+$/, '') || '/';
  if (CREATE_PATHS.has(path)) return { kind: 'create' };
  if (path.startsWith(ROSTER_BULK + '/')) return { kind: 'admin' };
  for (const prefix of COURSE_WRITE_PREFIXES) {
    if (path.startsWith(prefix)) {
      const seg = path.slice(prefix.length).split('/')[0] ?? '';
      if (seg) return { kind: 'course-write', code: normalizeCode(seg) };
    }
  }
  return { kind: 'admin' };
}

function inScope(grant: Grant, code: string): boolean {
  return grant.scope.some(s => s === '*' || normalizeCode(s) === code);
}

export function authorize(grant: Grant, method: string, pathname: string): Decision {
  const k = classify(method, pathname);
  switch (k.kind) {
    case 'read': return { ok: true };
    case 'course-write':
      if (grant.scope.includes('*')) return { ok: true };
      if (!grant.can.includes('capture')) return { ok: false, reason: 'needs-capture', code: k.code };
      return inScope(grant, k.code) ? { ok: true } : { ok: false, reason: 'out-of-scope', code: k.code };
    case 'create':
      return grant.scope.includes('*') || grant.can.includes('create') ? { ok: true } : { ok: false, reason: 'needs-create' };
    case 'admin':
      return grant.scope.includes('*') && grant.can.includes('admin') ? { ok: true } : { ok: false, reason: 'needs-admin' };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/auth/authorize.test.ts` — Expected: all PASS. Then `npx tsc --noEmit -p .` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/authorize.ts tests/auth/authorize.test.ts
git commit -m "feat(auth): pure authorize() scope table with default-deny (Task 1 of scoped access links)"
```

---

### Task 2: `access_grants` table + migration

**Files:**
- Modify: `lib/db/schema.ts` (append after `partners`)
- Generate: `drizzle/0050_*.sql` via `pnpm db:generate`

**Interfaces:**
- Produces: `accessGrants` Drizzle table with columns `id, tokenHash, label, scope, can, expiresAt, revokedAt, createdAt, lastUsedAt`.

- [ ] **Step 1: Add the table**

```ts
// lib/db/schema.ts — after the partners table
/**
 * Per-person, per-course access links (spec 2026-09-30). `token_hash` is
 * sha256(token); the token itself is shown once by `pnpm access:grant` and
 * never stored. `scope` holds roster course codes or the single value '*'.
 */
export const accessGrants = pgTable('access_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull(),
  scope: jsonb('scope').$type<string[]>().notNull().default([]),
  can: jsonb('can').$type<('capture' | 'create' | 'admin')[]>().notNull().default([]),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});
```
(`jsonb` string arrays follow `careerTargetHints` on `partners`, so no new Drizzle types.)

- [ ] **Step 2: Generate and inspect the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0050_<name>.sql` containing `CREATE TABLE "access_grants"` with a unique index on `token_hash`. Open it and confirm nothing else changed.

- [ ] **Step 3: Apply locally and typecheck**

Run: `pnpm db:migrate` (against the local Postgres on 127.0.0.1:5433) then `npx tsc --noEmit -p .`
Expected: migration applied; 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(auth): access_grants table (Task 2 of scoped access links)"
```

---

### Task 3: `grants.ts` — tokens, cookie, built-ins, lookups

**Files:**
- Create: `lib/auth/grants.ts`
- Test: `tests/auth/grants.test.ts` (pure parts only; DB functions are thin wrappers exercised in Task 8's live proof)

**Interfaces:**
- Consumes: `Grant`, `Capability` from Task 1; `accessGrants` from Task 2.
- Produces:
  ```ts
  export const SESSION_COOKIE = 'gc_session';
  export const MAX_COOKIE_AGE_S = 30 * 24 * 3600;
  export function newToken(): string;                       // 32 random bytes, base64url
  export function hashToken(token: string): string;         // sha256 hex
  export function signSession(id: string, secret: string): string;           // `${id}.${b64url(hmac)}`
  export function verifySession(value: string | undefined, secret: string): string | null; // grant id or null
  export function builtinGrant(role: 'faculty' | 'creator'): Grant;
  export interface StoredGrant extends Grant { expiresAt: Date | null; revokedAt: Date | null; lastUsedAt: Date | null }
  export function isLive(g: { expiresAt: Date | null; revokedAt: Date | null }, now?: Date): boolean;
  export function cookieMaxAge(g: { expiresAt: Date | null }, now?: Date): number;
  export async function findGrantByToken(token: string): Promise<StoredGrant | null>;
  export async function findGrantById(id: string): Promise<StoredGrant | null>;
  export async function touchLastUsed(id: string, now?: Date): Promise<void>; // only if stale > 1h
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/auth/grants.test.ts
import { describe, it, expect } from 'vitest';
import { newToken, hashToken, signSession, verifySession, builtinGrant, isLive, cookieMaxAge, MAX_COOKIE_AGE_S } from '@/lib/auth/grants';

describe('tokens', () => {
  it('are 43-char base64url and unique', () => {
    const a = newToken(), b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a).not.toBe(b);
  });
  it('hash is sha256 hex and stable', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('session cookie', () => {
  const secret = 's'.repeat(32);
  it('round-trips', () => {
    const v = signSession('11111111-1111-1111-1111-111111111111', secret);
    expect(v).toMatch(/^11111111-1111-1111-1111-111111111111\.[A-Za-z0-9_-]+$/);
    expect(verifySession(v, secret)).toBe('11111111-1111-1111-1111-111111111111');
  });
  it('rejects tampering, wrong secret, garbage, empty', () => {
    const v = signSession('id-1', secret);
    expect(verifySession(v.replace('id-1', 'id-2'), secret)).toBeNull();
    expect(verifySession(v, 'other'.repeat(8))).toBeNull();
    expect(verifySession('nonsense', secret)).toBeNull();
    expect(verifySession(undefined, secret)).toBeNull();
    expect(verifySession(v, '')).toBeNull();
  });
});

describe('built-ins and liveness', () => {
  it('faculty is department-wide, creator is create-only', () => {
    expect(builtinGrant('faculty')).toEqual({ id: 'builtin:faculty', label: 'Department login', scope: ['*'], can: ['capture', 'create', 'admin'] });
    expect(builtinGrant('creator')).toEqual({ id: 'builtin:creator', label: 'Create-only login', scope: [], can: ['create'] });
  });
  it('isLive', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(isLive({ expiresAt: null, revokedAt: null }, now)).toBe(true);
    expect(isLive({ expiresAt: new Date('2026-10-01T00:00:00Z'), revokedAt: null }, now)).toBe(true);
    expect(isLive({ expiresAt: new Date('2026-09-30T11:59:59Z'), revokedAt: null }, now)).toBe(false);
    expect(isLive({ expiresAt: null, revokedAt: new Date('2026-09-29T00:00:00Z') }, now)).toBe(false);
  });
  it('cookieMaxAge caps at 30 days and floors at 0', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(cookieMaxAge({ expiresAt: null }, now)).toBe(MAX_COOKIE_AGE_S);
    expect(cookieMaxAge({ expiresAt: new Date('2026-09-30T13:00:00Z') }, now)).toBe(3600);
    expect(cookieMaxAge({ expiresAt: new Date('2026-09-30T11:00:00Z') }, now)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/auth/grants.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// lib/auth/grants.ts
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
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/auth/grants.test.ts` → PASS; `npx tsc --noEmit -p .` → 0.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/grants.ts tests/auth/grants.test.ts
git commit -m "feat(auth): grants — token hashing, HMAC session cookie, built-ins, lookups (Task 3)"
```

---

### Task 4: `pages.ts` — the 401 and 403 bodies

**Files:**
- Create: `lib/auth/pages.ts`
- Test: covered by Task 5's gate tests (asserting status + a phrase).

- [ ] **Step 1: Implement** (no separate test; content is asserted in Task 5)

```ts
// lib/auth/pages.ts
const STYLE = `body{font:16px/1.55 system-ui,-apple-system,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.5rem;color:#1b1d21}h1{font-size:1.4rem;margin:0 0 .75rem}p{color:#4b5563}a{color:#1b1d21;text-decoration:underline;text-decoration-color:#f56600;text-underline-offset:3px}`;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
}
export function unauthorizedPage(): string {
  return page('Sign in to continue',
    `<p>Faculty: open the access link you were given, or sign in with the department login when your browser asks.</p>` +
    `<p>Students and visitors: the <a href="/">course list</a>, course pages and the <a href="/wiki">curriculum wiki</a> need no login.</p>`);
}
export function forbiddenPage(label: string, code?: string): string {
  const what = code ? `can edit ${esc(code)}` : 'has the access it was given';
  return page('This link can’t do that',
    `<p>The access link <strong>${esc(label)}</strong> ${code ? `is not allowed to edit <strong>${esc(code)}</strong>` : 'is not allowed to make this change'}; it ${what} only.</p>` +
    `<p>Ask the department for a wider link if you need it. <a href="/">Back to the course list</a>.</p>`);
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit -p .
git add lib/auth/pages.ts && git commit -m "feat(auth): 401/403 pages (Task 4)"
```

---

### Task 5: `gate()` — the faculty-branch decision, testable

**Files:**
- Create: `lib/auth/gate.ts`
- Test: `tests/auth/gate.test.ts`

**Interfaces:**
- Consumes: `authorize`, `Grant` (Task 1); `SESSION_COOKIE`, `signSession`, `verifySession`, `builtinGrant`, `isLive`, `cookieMaxAge`, `StoredGrant` (Task 3); `unauthorizedPage`, `forbiddenPage` (Task 4); `requiresBasicAuth`, `resolveRole` (existing `lib/auth/basic-auth.ts`); `getPrototypeSlug` (existing `lib/slug.ts`).
- Produces:
  ```ts
  export interface GateDeps {
    findGrantByToken(token: string): Promise<StoredGrant | null>;
    findGrantById(id: string): Promise<StoredGrant | null>;
    touch(id: string): Promise<void>;
    env: { sessionSecret?: string; faculty?: string; creator?: string; slug?: string };
    now?: () => Date;
  }
  export type GateResult =
    | { kind: 'next'; setCookie?: CookieSpec; clearCookie?: true }
    | { kind: 'rewrite'; url: URL; setCookie?: CookieSpec }
    | { kind: 'redirect'; url: URL; setCookie: CookieSpec }
    | { kind: 'response'; status: 401 | 403 | 503; body: string; headers: Record<string, string>; clearCookie?: true };
  export interface CookieSpec { name: string; value: string; maxAge: number }
  export async function gate(req: NextRequest, deps: GateDeps): Promise<GateResult>;
  ```
  `gate` is called for EVERY request (public paths included) so the magic-link exchange works on `/`; it returns `{kind:'next'}` immediately for public paths without a key.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/auth/gate.test.ts
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { gate, type GateDeps } from '@/lib/auth/gate';
import { signSession, hashToken, type StoredGrant } from '@/lib/auth/grants';

const SECRET = 'x'.repeat(32), SLUG = 'prototypeslug123';
const danita: StoredGrant = { id: '11111111-1111-4111-8111-111111111111', label: 'Danita — GC 3730', scope: ['GC 3730'], can: ['capture'], expiresAt: null, revokedAt: null, lastUsedAt: null };
const TOKEN = 'tok_danita';
function deps(over: Partial<GateDeps> = {}): GateDeps {
  return {
    findGrantByToken: async t => (hashToken(t) === hashToken(TOKEN) ? danita : null),
    findGrantById: async id => (id === danita.id ? danita : null),
    touch: async () => {},
    env: { sessionSecret: SECRET, faculty: 'gcfaculty:pw', creator: 'creator:pw', slug: SLUG },
    now: () => new Date('2026-09-30T12:00:00Z'),
    ...over,
  };
}
const req = (path: string, init: { method?: string; cookie?: string; auth?: string } = {}) =>
  new NextRequest(new URL(path, 'https://gcworkflow.clemson.edu:8443'), {
    method: init.method ?? 'GET',
    headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.auth ? { authorization: init.auth } : {}) },
  });
const basic = (s: string) => 'Basic ' + Buffer.from(s).toString('base64');

describe('public paths', () => {
  it('pass through untouched', async () => expect(await gate(req('/view/GC%201010'), deps())).toEqual({ kind: 'next' }));
  it('exchange ?key= for a cookie and redirect clean even on /', async () => {
    const r = await gate(req(`/?key=${TOKEN}`), deps());
    expect(r.kind).toBe('redirect');
    if (r.kind !== 'redirect') return;
    expect(r.url.pathname).toBe('/'); expect(r.url.searchParams.has('key')).toBe(false);
    expect(r.setCookie.name).toBe('gc_session'); expect(r.setCookie.value.startsWith(danita.id + '.')).toBe(true);
  });
  it('ignore a dead key on a public path', async () =>
    expect(await gate(req('/?key=nope'), deps())).toEqual({ kind: 'next' }));
});

describe('gated paths — resolution order', () => {
  it('no credential → 401 page with the Basic challenge', async () => {
    const r = await gate(req('/courses'), deps());
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.status).toBe(401); expect(r.headers['WWW-Authenticate']).toContain('Basic realm=');
    expect(r.body).toContain('open the access link');
  });
  it('valid cookie → rewrite with ?slug= for pages, next for APIs', async () => {
    const cookie = `gc_session=${signSession(danita.id, SECRET)}`;
    const p = await gate(req('/capture/GC%203730', { cookie }), deps());
    expect(p.kind).toBe('rewrite'); if (p.kind === 'rewrite') expect(p.url.searchParams.get('slug')).toBe(SLUG);
    const a = await gate(req('/api/capture/GC%203730/context', { cookie }), deps());
    expect(a.kind).toBe('next');
  });
  it('legacy ?slug= link still works and is exchanged for a cookie', async () => {
    const r = await gate(req(`/courses?slug=${SLUG}`), deps());
    expect(r.kind).toBe('redirect'); if (r.kind !== 'redirect') return;
    expect(r.setCookie.value.startsWith('builtin:faculty.')).toBe(true);
    expect(r.url.searchParams.has('slug')).toBe(false);
  });
  it('tampered cookie → treated as absent (401 + clear)', async () => {
    const r = await gate(req('/courses', { cookie: 'gc_session=' + danita.id + '.bad' }), deps());
    expect(r.kind).toBe('response'); if (r.kind === 'response') { expect(r.status).toBe(401); expect(r.clearCookie).toBe(true); }
  });
  it('revoked grant behind a valid cookie → 401 + clear', async () => {
    const d = deps({ findGrantById: async () => ({ ...danita, revokedAt: new Date('2026-09-29T00:00:00Z') }) });
    const r = await gate(req('/courses', { cookie: `gc_session=${signSession(danita.id, SECRET)}` }), d);
    expect(r.kind).toBe('response'); if (r.kind === 'response') { expect(r.status).toBe(401); expect(r.clearCookie).toBe(true); }
  });
  it('Basic faculty → allowed and a cookie is set', async () => {
    const r = await gate(req('/admin', { auth: basic('gcfaculty:pw') }), deps());
    expect(r.kind).toBe('rewrite'); if (r.kind === 'rewrite') expect(r.setCookie?.value.startsWith('builtin:faculty.')).toBe(true);
  });
  it('no SESSION_SECRET → key still authorizes this request but no cookie is issued', async () => {
    const r = await gate(req(`/courses?key=${TOKEN}`), deps({ env: { faculty: 'gcfaculty:pw', slug: SLUG } }));
    expect(r.kind).toBe('rewrite'); if (r.kind === 'rewrite') expect(r.setCookie).toBeUndefined();
  });
});

describe('gated paths — authorization', () => {
  const cookie = `gc_session=${signSession(danita.id, SECRET)}`;
  it('write in scope → next', async () =>
    expect((await gate(req('/api/capture/GC%203730/chat', { cookie, method: 'POST' }), deps())).kind).toBe('next'));
  it('write out of scope → 403 page naming label and course', async () => {
    const r = await gate(req('/api/capture/GC%201010/chat', { cookie, method: 'POST' }), deps());
    expect(r.kind).toBe('response'); if (r.kind !== 'response') return;
    expect(r.status).toBe(403); expect(r.body).toContain('GC 1010'); expect(r.body).toContain('Danita');
  });
  it('unclassified write → 403 for a scoped grant, allowed for department', async () => {
    expect((await gate(req('/api/admin/synthesis', { cookie, method: 'POST' }), deps())).kind).toBe('response');
    expect((await gate(req('/api/admin/synthesis', { auth: basic('gcfaculty:pw'), method: 'POST' }), deps())).kind).toBe('next');
  });
  it('DB failure → 503, never a pass', async () => {
    const d = deps({ findGrantById: async () => { throw new Error('db down'); } });
    const r = await gate(req('/courses', { cookie }), d);
    expect(r.kind).toBe('response'); if (r.kind === 'response') expect(r.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/auth/gate.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// lib/auth/gate.ts
import type { NextRequest } from 'next/server';
import { authorize, type Grant } from '@/lib/auth/authorize';
import { SESSION_COOKIE, builtinGrant, cookieMaxAge, isLive, signSession, verifySession, type StoredGrant } from '@/lib/auth/grants';
import { forbiddenPage, unauthorizedPage } from '@/lib/auth/pages';
import { requiresBasicAuth, resolveRole } from '@/lib/auth/basic-auth';

export interface CookieSpec { name: string; value: string; maxAge: number }
export interface GateDeps {
  findGrantByToken(token: string): Promise<StoredGrant | null>;
  findGrantById(id: string): Promise<StoredGrant | null>;
  touch(id: string): Promise<void>;
  env: { sessionSecret?: string; faculty?: string; creator?: string; slug?: string };
  now?: () => Date;
}
export type GateResult =
  | { kind: 'next'; setCookie?: CookieSpec; clearCookie?: true }
  | { kind: 'rewrite'; url: URL; setCookie?: CookieSpec }
  | { kind: 'redirect'; url: URL; setCookie: CookieSpec }
  | { kind: 'response'; status: 401 | 403 | 503; body: string; headers: Record<string, string>; clearCookie?: true };

const CHALLENGE = { 'WWW-Authenticate': 'Basic realm="GC Curriculum Tool - Faculty"', 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
const HTML = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };

type Resolved = { grant: Grant; setCookie?: CookieSpec };

function cookieFor(grant: Grant, live: { expiresAt: Date | null }, deps: GateDeps): CookieSpec | undefined {
  const secret = deps.env.sessionSecret;
  if (!secret) return undefined;
  const maxAge = cookieMaxAge(live, deps.now?.());
  return maxAge > 0 ? { name: SESSION_COOKIE, value: signSession(grant.id, secret), maxAge } : undefined;
}

/** ?key= (any path) or legacy ?slug= (gated path) → grant, or null. */
async function fromKey(req: NextRequest, gated: boolean, deps: GateDeps): Promise<Resolved | null> {
  const key = req.nextUrl.searchParams.get('key') ?? (gated ? req.nextUrl.searchParams.get('slug') : null);
  if (!key) return null;
  if (deps.env.slug && key === deps.env.slug) {
    const g = builtinGrant('faculty');
    return { grant: g, setCookie: cookieFor(g, { expiresAt: null }, deps) };
  }
  const stored = await deps.findGrantByToken(key);
  if (!stored || !isLive(stored, deps.now?.())) return null;
  return { grant: stored, setCookie: cookieFor(stored, stored, deps) };
}

async function fromCookie(req: NextRequest, deps: GateDeps): Promise<Resolved | null | 'dead'> {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const id = deps.env.sessionSecret ? verifySession(raw, deps.env.sessionSecret) : null;
  if (!id) return 'dead';
  if (id === 'builtin:faculty' || id === 'builtin:creator') return { grant: builtinGrant(id.slice(8) as 'faculty' | 'creator') };
  const stored = await deps.findGrantById(id);
  if (!stored || !isLive(stored, deps.now?.())) return 'dead';
  void deps.touch(id).catch(() => {});
  return { grant: stored };
}

function fromBasic(req: NextRequest, deps: GateDeps): Resolved | null {
  const role = resolveRole(req.headers.get('authorization'), { faculty: deps.env.faculty, creator: deps.env.creator });
  if (!role) return null;
  const g = builtinGrant(role);
  return { grant: g, setCookie: cookieFor(g, { expiresAt: null }, deps) };
}

function stripKeys(url: URL): URL {
  const u = new URL(url.toString());
  u.searchParams.delete('key'); u.searchParams.delete('slug');
  return u;
}

export async function gate(req: NextRequest, deps: GateDeps): Promise<GateResult> {
  const path = req.nextUrl.pathname;
  const gated = requiresBasicAuth(path);
  try {
    // 1. Magic-link exchange — on ANY path (the link lands on the public /).
    const keyed = await fromKey(req, gated, deps);
    if (keyed) {
      if (keyed.setCookie) return { kind: 'redirect', url: stripKeys(req.nextUrl), setCookie: keyed.setCookie };
      if (!gated) return { kind: 'next' };
      // No cookie possible (no SESSION_SECRET): authorize this request only.
      return decide(req, keyed.grant, undefined, deps);
    }
    if (!gated) return { kind: 'next' };

    // 2. Cookie, then Basic.
    const c = await fromCookie(req, deps);
    if (c && c !== 'dead') return decide(req, c.grant, undefined, deps);
    const b = fromBasic(req, deps);
    if (b) return decide(req, b.grant, b.setCookie, deps);
    return { kind: 'response', status: 401, body: unauthorizedPage(), headers: CHALLENGE, ...(c === 'dead' ? { clearCookie: true as const } : {}) };
  } catch {
    return { kind: 'response', status: 503, body: 'Sign-in is temporarily unavailable.', headers: HTML };
  }
}

function decide(req: NextRequest, grant: Grant, setCookie: CookieSpec | undefined, deps: GateDeps): GateResult {
  const d = authorize(grant, req.method, req.nextUrl.pathname);
  if (!d.ok) return { kind: 'response', status: 403, body: forbiddenPage(grant.label, d.code), headers: HTML };
  const isPage = !req.nextUrl.pathname.startsWith('/api/');
  if (isPage && deps.env.slug && !req.nextUrl.searchParams.has('slug')) {
    const u = new URL(req.nextUrl.toString()); u.searchParams.set('slug', deps.env.slug);
    return { kind: 'rewrite', url: u, setCookie };
  }
  return { kind: 'next', setCookie };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/auth/gate.test.ts tests/auth` → all PASS; `npx tsc --noEmit -p .` → 0.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/gate.ts tests/auth/gate.test.ts
git commit -m "feat(auth): gate() — key exchange, cookie/Basic resolution, authorize, slug rewrite (Task 5)"
```

---

### Task 6: Wire `gate()` into `middleware.ts`

**Files:**
- Modify: `middleware.ts` — replace the block from `const facultyExpected = process.env.FACULTY_BASIC_AUTH;` through the end of the faculty `if` (currently the last ~20 lines before `return NextResponse.next();`). The partner branch and the cleartext interstitial above it are untouched.

**Interfaces:**
- Consumes: `gate`, `GateResult` (Task 5); `findGrantByToken`, `findGrantById`, `touchLastUsed`, `SESSION_COOKIE` (Task 3).

- [ ] **Step 1: Replace the faculty block**

```ts
// middleware.ts — imports (add)
import { gate } from '@/lib/auth/gate';
import { findGrantByToken, findGrantById, touchLastUsed, SESSION_COOKIE } from '@/lib/auth/grants';

// middleware.ts — replace the `const facultyExpected … }` block with:
  const result = await gate(req, {
    findGrantByToken, findGrantById, touch: touchLastUsed,
    env: {
      sessionSecret: process.env.SESSION_SECRET?.trim() || undefined,
      faculty: process.env.FACULTY_BASIC_AUTH,
      creator: process.env.CREATE_ONLY_AUTH,
      slug: process.env.PROTOTYPE_SLUG?.trim(),
    },
  });
  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };
  let res: NextResponse;
  switch (result.kind) {
    case 'next': res = NextResponse.next(); break;
    case 'rewrite': res = NextResponse.rewrite(result.url); break;
    case 'redirect': res = NextResponse.redirect(result.url, 302); break;
    case 'response': res = new NextResponse(result.body, { status: result.status, headers: result.headers }); break;
  }
  if ('setCookie' in result && result.setCookie) {
    res.cookies.set({ name: result.setCookie.name, value: result.setCookie.value, maxAge: result.setCookie.maxAge, ...cookieOpts });
  }
  if ('clearCookie' in result && result.clearCookie) {
    res.cookies.set({ name: SESSION_COOKIE, value: '', maxAge: 0, ...cookieOpts });
  }
  return res;
```
Remove the now-unused `resolveRole`/`creatorAllowed` imports from `middleware.ts` (they stay exported from `basic-auth.ts` for the existing tests). Keep `requiresBasicAuth` if the interstitial block still references it.

- [ ] **Step 2: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: 0 type errors; all tests pass (the existing `basic-auth.test.ts` still passes — nothing in `basic-auth.ts` changed).

- [ ] **Step 3: Local smoke with the dev server**

Run (from the repo, with `.env.local` present): `PORT=3100 pnpm dev` in one shell, then:
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/courses                 # 401
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "http://127.0.0.1:3100/courses?slug=$(node ~/.claude/dashboard/read-env.mjs . PROTOTYPE_SLUG)"   # 302 → /courses (slug stripped)
```
(Check `~/.dev-ports.yaml` first; 3100 is registered to the stopped voicelab — use it only while that stays stopped, then stop the dev server.)

- [ ] **Step 4: Commit**

```bash
git add middleware.ts
git commit -m "feat(auth): middleware uses gate() — magic links, session cookie, scoped authorization (Task 6)"
```

---

### Task 7: Owner scripts — grant / list / revoke

**Files:**
- Create: `scripts/access/lib.ts`, `scripts/access/grant.ts`, `scripts/access/list.ts`, `scripts/access/revoke.ts`
- Modify: `package.json` scripts
- Test: `tests/access/lib.test.ts`

**Interfaces:**
- Consumes: `newToken`, `hashToken` (Task 3); `accessGrants`, `courses` (schema); `normalizeCode` (Task 1).
- Produces:
  ```ts
  // scripts/access/lib.ts
  export interface GrantArgs { label: string; scope: string[]; can: Capability[]; expiresAt: Date | null }
  export function parseGrantArgs(argv: string[], now?: Date): GrantArgs;      // throws Error with a one-line message on bad input
  export function checkCourses(scope: string[], known: string[]): string[];  // returns unknown codes ([] = all good)
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/access/lib.test.ts
import { describe, it, expect } from 'vitest';
import { parseGrantArgs, checkCourses } from '@/scripts/access/lib';

const now = new Date('2026-09-30T12:00:00Z');
describe('parseGrantArgs', () => {
  it('parses a course grant with days', () => {
    expect(parseGrantArgs(['Danita Swaney', '--courses', 'GC 3730', '--can', 'capture', '--days', '30'], now))
      .toEqual({ label: 'Danita Swaney', scope: ['GC 3730'], can: ['capture'], expiresAt: new Date('2026-10-30T12:00:00Z') });
  });
  it('splits and normalises multiple courses and capabilities', () => {
    const a = parseGrantArgs(['x', '--courses', 'gc 1020, GC%201050', '--can', 'capture,create', '--days', '1'], now);
    expect(a.scope).toEqual(['GC 1020', 'GC 1050']); expect(a.can).toEqual(['capture', 'create']);
  });
  it('--no-expiry sets null; missing both is an error', () => {
    expect(parseGrantArgs(['x', '--courses', '*', '--can', 'admin', '--no-expiry'], now).expiresAt).toBeNull();
    expect(() => parseGrantArgs(['x', '--courses', 'GC 3730', '--can', 'capture'], now)).toThrow(/--days or --no-expiry/);
  });
  it('admin requires *', () => {
    expect(() => parseGrantArgs(['x', '--courses', 'GC 3730', '--can', 'admin', '--days', '1'], now)).toThrow(/admin requires --courses '\*'/);
  });
  it('rejects unknown capabilities and empty label', () => {
    expect(() => parseGrantArgs(['x', '--courses', 'GC 3730', '--can', 'root', '--days', '1'], now)).toThrow(/unknown capability/);
    expect(() => parseGrantArgs(['', '--courses', 'GC 3730', '--can', 'capture', '--days', '1'], now)).toThrow(/label/);
  });
});
describe('checkCourses', () => {
  it('reports codes not in the roster, ignores *', () => {
    expect(checkCourses(['GC 3730', 'GC 9999'], ['GC 3730', 'GC 1010'])).toEqual(['GC 9999']);
    expect(checkCourses(['*'], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/access/lib.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// scripts/access/lib.ts
import { normalizeCode, type Capability } from '@/lib/auth/authorize';
export interface GrantArgs { label: string; scope: string[]; can: Capability[]; expiresAt: Date | null }
const CAPS: Capability[] = ['capture', 'create', 'admin'];

export function parseGrantArgs(argv: string[], now = new Date()): GrantArgs {
  const [label = '', ...rest] = argv;
  if (!label.trim()) throw new Error('label is required: access:grant "<label>" --courses … --can … (--days N | --no-expiry)');
  const opt = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const rawCourses = opt('--courses'); const rawCan = opt('--can'); const days = opt('--days'); const noExpiry = rest.includes('--no-expiry');
  if (!rawCourses) throw new Error('--courses is required ("GC 3730,GC 3740" or "*")');
  const scope = rawCourses === '*' ? ['*'] : rawCourses.split(',').map(normalizeCode).filter(Boolean);
  const can = (rawCan ?? '').split(',').map(s => s.trim()).filter(Boolean) as Capability[];
  if (can.length === 0) throw new Error('--can is required (capture[,create,admin])');
  for (const c of can) if (!CAPS.includes(c)) throw new Error(`unknown capability "${c}" (capture, create, admin)`);
  if (can.includes('admin') && !scope.includes('*')) throw new Error("admin requires --courses '*'");
  if (!days && !noExpiry) throw new Error('--days or --no-expiry is required');
  const expiresAt = noExpiry ? null : new Date(now.getTime() + Number(days) * 86400_000);
  if (!noExpiry && !(Number(days) > 0)) throw new Error('--days must be a positive number');
  return { label: label.trim(), scope, can, expiresAt };
}
export function checkCourses(scope: string[], known: string[]): string[] {
  const k = new Set(known.map(normalizeCode));
  return scope.filter(s => s !== '*' && !k.has(normalizeCode(s)));
}
```

```ts
// scripts/access/grant.ts
/** Usage: pnpm access:grant "<label>" --courses "GC 3730[,…]|*" --can capture[,create,admin] (--days N | --no-expiry)
 *  Prints the link ONCE. Run with the deploy env: pnpm exec tsx --env-file=.env.local scripts/access/grant.ts … */
import { db } from '@/lib/db/client';
import { accessGrants, courses } from '@/lib/db/schema';
import { newToken, hashToken } from '@/lib/auth/grants';
import { parseGrantArgs, checkCourses } from './lib';

async function main() {
  const args = parseGrantArgs(process.argv.slice(2));
  const known = (await db.select({ code: courses.code }).from(courses)).map(r => r.code);
  const unknown = checkCourses(args.scope, known);
  if (unknown.length) throw new Error(`not in the roster: ${unknown.join(', ')} — add the course first or fix the code`);
  const token = newToken();
  const [row] = await db.insert(accessGrants).values({ tokenHash: hashToken(token), label: args.label, scope: args.scope, can: args.can, expiresAt: args.expiresAt }).returning({ id: accessGrants.id });
  const origin = process.env.PUBLIC_HTTPS_ORIGIN?.replace(/\/$/, '') || 'https://gcworkflow.clemson.edu:8443';
  console.log(`${origin}/?key=${token}`);
  console.error(`granted ${row!.id.slice(0, 8)}  ${args.label}  scope=${args.scope.join(',')}  can=${args.can.join(',')}  expires=${args.expiresAt?.toISOString() ?? 'never'}`);
  process.exit(0);
}
main().catch(e => { console.error('access:grant:', e instanceof Error ? e.message : e); process.exit(1); });
```

```ts
// scripts/access/list.ts
import { db } from '@/lib/db/client';
import { accessGrants } from '@/lib/db/schema';
import { isLive } from '@/lib/auth/grants';
const f = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—');
async function main() {
  const rows = await db.select().from(accessGrants).orderBy(accessGrants.createdAt);
  console.log(['id', 'label', 'scope', 'can', 'expires', 'last used', 'status'].join('\t'));
  for (const r of rows) console.log([r.id.slice(0, 8), r.label, r.scope.join(','), r.can.join(','), f(r.expiresAt), f(r.lastUsedAt), r.revokedAt ? 'revoked' : isLive(r) ? 'live' : 'expired'].join('\t'));
  process.exit(0);
}
main().catch(e => { console.error('access:list:', e instanceof Error ? e.message : e); process.exit(1); });
```

```ts
// scripts/access/revoke.ts
/** Usage: pnpm access:revoke <id or id-prefix> */
import { like, isNull, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { accessGrants } from '@/lib/db/schema';
async function main() {
  const prefix = process.argv[2];
  if (!prefix || prefix.length < 6) throw new Error('give at least 6 characters of the id (see access:list)');
  const matches = await db.select({ id: accessGrants.id, label: accessGrants.label }).from(accessGrants).where(and(like(accessGrants.id, `${prefix}%`), isNull(accessGrants.revokedAt)));
  if (matches.length !== 1) throw new Error(matches.length === 0 ? 'no live grant with that id' : 'prefix matches more than one grant — use more characters');
  await db.update(accessGrants).set({ revokedAt: new Date() }).where(like(accessGrants.id, `${matches[0]!.id}`));
  console.log(`revoked ${matches[0]!.id.slice(0, 8)}  ${matches[0]!.label}`);
  process.exit(0);
}
main().catch(e => { console.error('access:revoke:', e instanceof Error ? e.message : e); process.exit(1); });
```

`package.json` scripts (add):
```json
"access:grant": "tsx --env-file=.env.local scripts/access/grant.ts",
"access:list": "tsx --env-file=.env.local scripts/access/list.ts",
"access:revoke": "tsx --env-file=.env.local scripts/access/revoke.ts"
```
(`tsx` is already a dev dependency via the existing `wiki:*` scripts; `like` on a uuid column needs the cast Drizzle emits — if Postgres rejects `uuid LIKE text`, use `sql\`${accessGrants.id}::text LIKE ${prefix + '%'}\`` instead.)

- [ ] **Step 4: Run tests, then a real round-trip against the local DB**

```bash
npx vitest run tests/access/lib.test.ts && npx tsc --noEmit -p .
pnpm access:grant "Plan test" --courses "GC 1010" --can capture --days 1     # prints a link; note the id from stderr
pnpm access:list                                                            # shows it live
pnpm access:revoke <id-prefix>                                              # revoked
pnpm access:list                                                            # status = revoked
pnpm access:grant "Bad" --courses "GC 9999" --can capture --days 1          # exits 1: not in the roster
```

- [ ] **Step 5: Commit**

```bash
git add scripts/access tests/access package.json
git commit -m "feat(auth): access:grant / list / revoke owner scripts (Task 7)"
```

---

### Task 8: Env, docs, deploy, live proof

**Files:**
- Modify: `.env.example` (add `SESSION_SECRET`), `docs/STATE.md` (schema row, env var, auth model, deferred slug cleanup), `~/projects/curriculum_developer-deploy/.env.local` (add a real `SESSION_SECRET`)

- [ ] **Step 1: `.env.example`**

```
# Signs the faculty session cookie (scoped access links, 2026-09-30). >= 32 random bytes.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# Unset = no cookies are issued or accepted (magic links + Basic Auth still work per-request).
SESSION_SECRET=
```

- [ ] **Step 2: STATE.md** — add under Schema: `access_grants (migration 0050)`; under Env vars: `SESSION_SECRET`; under Architecture → Auth model: replace the Basic-Auth paragraph with the three ways in (magic link → cookie; cookie; Basic → cookie), the scope table summary, and "the 43 page-level `isValidSlug` checks are satisfied by an internal rewrite and are now redundant — removing them is deferred"; under Deferred/debt: that cleanup, and "wiki MCP per-person keys can reuse `access_grants` (not built)".

- [ ] **Step 3: Deploy (no sudo)**

```bash
cd ~/projects/curriculum_developer-deploy
git merge --ff-only dev
node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(32).toString('base64url'))" >> .env.local   # once; then confirm exactly one SESSION_SECRET line
pnpm install --silent; pnpm db:migrate
pnpm build && launchctl kickstart -k gui/501/com.gc.curriculum-tool     # never restart on a failed build
```

- [ ] **Step 4: Live proof (record the outputs in the commit message of Step 6)**

```bash
O=https://gcworkflow.clemson.edu:8443
S=$(node ~/.claude/dashboard/read-env.mjs ~/projects/curriculum_developer-deploy PROTOTYPE_SLUG)
F=$(node ~/.claude/dashboard/read-env.mjs ~/projects/curriculum_developer-deploy FACULTY_BASIC_AUTH)
curl -s -o /dev/null -w '%{http_code}\n' $O/                                   # 200 public, unchanged
curl -s -o /dev/null -w '%{http_code}\n' $O/courses                            # 401 (page body, Basic challenge)
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$O/courses?slug=$S"  # 302 → /courses, Set-Cookie gc_session
curl -s -o /dev/null -w '%{http_code}\n' -u "$F" $O/admin                      # 200 (Basic still works)
LINK=$(cd ~/projects/curriculum_developer-deploy && pnpm -s access:grant "Live proof — GC 1010" --courses "GC 1010" --can capture --days 1)
curl -s -c /tmp/cj -o /dev/null -w '%{http_code} %{redirect_url}\n' "$LINK"    # 302 → /, cookie jar now holds gc_session
curl -s -b /tmp/cj -o /dev/null -w '%{http_code}\n' "$O/capture/GC%201010"     # 200 — in scope, no slug in URL
curl -s -b /tmp/cj -o /dev/null -w '%{http_code}\n' "$O/capture/GC%201020"     # 200 — reads are free
curl -s -b /tmp/cj -o /dev/null -w '%{http_code}\n' -X POST "$O/api/capture/GC%201020/context"   # 403 — out of scope
curl -s -b /tmp/cj -o /dev/null -w '%{http_code}\n' -X POST "$O/api/admin/synthesis"             # 403 — admin only
cd ~/projects/curriculum_developer-deploy && pnpm -s access:revoke $(pnpm -s access:list | awk -F'\t' '$2 ~ /Live proof/ {print $1}')
curl -s -b /tmp/cj -o /dev/null -w '%{http_code}\n' "$O/capture/GC%201010"     # 401 — revoked, within one request
```
All expected codes must match before continuing. If any differs, stop and fix before issuing a real link.

- [ ] **Step 5: Issue the first real link** — `pnpm access:grant "Danita Swaney — GC 3730" --courses "GC 3730" --can capture --days 30` and hand the link to the owner to send.

- [ ] **Step 6: Commit docs**

```bash
git add .env.example docs/STATE.md
git commit -m "docs: scoped access links live — SESSION_SECRET, access_grants, auth model; slug-check cleanup deferred (Task 8)"
git push origin dev main
```

---

## Self-review

- **Spec coverage:** data model → Task 2/3; built-in grants → Task 3; cookie rules → Task 3/5/6; middleware flow incl. public-path key exchange → Task 5/6; scope table + default-deny + normalisation → Task 1; 401/403 pages → Task 4; scripts + validation → Task 7; errors (dead cookie cleared, dead key ignored on public, 503 on DB failure) → Task 5; rollout + live proof + STATE → Task 8. `last_used_at` hourly throttle → Task 3 (`touchLastUsed`) called from Task 5.
- **Placeholders:** none; every step has code or an exact command.
- **Type consistency:** `Grant`/`Capability` defined once (Task 1) and imported everywhere; `StoredGrant` (Task 3) used by Task 5's deps; `GateResult` kinds match the `switch` in Task 6; script `parseGrantArgs` returns `GrantArgs` consumed by `grant.ts`.
- **Known judgement calls:** creator built-in keeps today's behaviour (create only, cannot capture what it created); `/board/*` is a read like any other gated GET; the `uuid LIKE` cast note in Task 7 is the one spot an implementer may need to adjust.
