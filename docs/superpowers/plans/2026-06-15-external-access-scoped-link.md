# External-Access Scoped Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator-minted, course-bound link that lets one external tester self-serve capture + view + OKF-bundle for **one sandbox course**, isolated from everything else.

**Architecture:** A `sandbox_grants` (token→course) + `sandbox_sessions` (24h, carries self-entered name) pair mirrors the partner-session machinery. A `/sandbox/<token>` public entry mints a scoped session. Authorization lives in one module (`lib/sandbox/access.ts`): middleware, for a bound session on an allowlisted path, rewrites the request to inject the faculty `slug` (skipping Basic Auth and satisfying the routes unchanged); read routes use `isCourseReadableBy`. `imscc-import` (matcher-excluded) accepts the session directly.

**Tech Stack:** Next.js 15 App Router (Node-runtime middleware), TypeScript strict, Drizzle/Postgres, Vitest. Reuses `lib/partners/*` patterns, `lib/slug.ts:getPrototypeSlug`, `lib/courses/program-visibility.ts`.

**Spec:** [`docs/superpowers/specs/2026-06-15-external-access-scoped-link-design.md`](../specs/2026-06-15-external-access-scoped-link-design.md)

---

### Task 1: Schema — `sandbox_grants` + `sandbox_sessions`

**Files:**
- Modify: `lib/db/schema.ts`
- Generate: a new migration under `drizzle/`

- [ ] **Step 1: Add the tables** to `lib/db/schema.ts` (place after the `partnerSessions` table; mirror its style):

```ts
export const sandboxGrants = pgTable('sandbox_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: text('token').notNull().unique(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  active: boolean('active').notNull().default(true),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const sandboxSessions = pgTable('sandbox_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  grantId: uuid('grant_id').notNull().references(() => sandboxGrants.id, { onDelete: 'cascade' }),
  courseCode: text('course_code').notNull(),
  instructorName: text('instructor_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0040_*.sql` (or next number) creating both tables. Inspect it — two `CREATE TABLE` statements, the FKs, the unique on `token`.

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies cleanly against local Postgres (`127.0.0.1:5433`).

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (expect exit 0).
```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(sandbox): sandbox_grants + sandbox_sessions tables"
```

---

### Task 2: Grant queries — `lib/sandbox/grants.ts`

**Files:**
- Create: `lib/sandbox/grants.ts`
- Test: `tests/lib/sandbox/grants.test.ts`

- [ ] **Step 1: Write the failing test** (mock the db client, mirroring existing query tests):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Record<string, unknown[]> = {};
vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({ values: (v: unknown) => ({ returning: async () => { calls.insert = [v]; return [{ id: 'g1', ...(v as object) }]; } }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => calls._rows ?? [] }) }) }),
    update: () => ({ set: (s: unknown) => ({ where: async () => { calls.update = [s]; } }) }),
  },
}));

import { isGrantValid } from '@/lib/sandbox/grants';

beforeEach(() => { for (const k of Object.keys(calls)) delete calls[k]; });

describe('isGrantValid', () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);
  it('valid when active, not revoked, unexpired', () => {
    expect(isGrantValid({ active: true, revokedAt: null, expiresAt: future })).toBe(true);
  });
  it('invalid when revoked, inactive, or expired', () => {
    expect(isGrantValid({ active: false, revokedAt: null, expiresAt: future })).toBe(false);
    expect(isGrantValid({ active: true, revokedAt: past, expiresAt: future })).toBe(false);
    expect(isGrantValid({ active: true, revokedAt: null, expiresAt: past })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/sandbox/grants.test.ts`
Expected: FAIL — cannot resolve `@/lib/sandbox/grants`.

- [ ] **Step 3: Implement `lib/sandbox/grants.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
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

export async function createGrant(input: { courseCode: string; label?: string | null }) {
  const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
  const expiresAt = new Date(Date.now() + GRANT_TTL_MS);
  const [row] = await db.insert(sandboxGrants).values({
    token, courseCode: input.courseCode, label: input.label ?? null, expiresAt,
  }).returning();
  if (!row) throw new Error('createGrant: insert returned no row');
  return row;
}

export async function getGrantByToken(token: string) {
  const rows = await db.select().from(sandboxGrants).where(eq(sandboxGrants.token, token)).limit(1);
  return rows[0] ?? null;
}

export async function listGrants() {
  return db.select().from(sandboxGrants).orderBy(desc(sandboxGrants.createdAt));
}

export async function revokeGrant(id: string) {
  await db.update(sandboxGrants).set({ active: false, revokedAt: new Date() }).where(eq(sandboxGrants.id, id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/lib/sandbox/grants.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sandbox/grants.ts tests/lib/sandbox/grants.test.ts
git commit -m "feat(sandbox): grant queries (create/get/list/revoke + isGrantValid)"
```

---

### Task 3: Scoped-session queries — `lib/sandbox/sessions.ts`

**Files:**
- Create: `lib/sandbox/sessions.ts`
- Test: `tests/lib/sandbox/sessions.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect } from 'vitest';
import { isSessionExpired, SCOPED_SESSION_COOKIE, SCOPED_SESSION_TTL_MS } from '@/lib/sandbox/sessions';

describe('scoped session helpers', () => {
  it('cookie name + 24h TTL', () => {
    expect(SCOPED_SESSION_COOKIE).toBe('gc_sandbox_sess');
    expect(SCOPED_SESSION_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
  it('isSessionExpired compares expiresAt to now', () => {
    expect(isSessionExpired({ expiresAt: new Date(Date.now() - 1000) })).toBe(true);
    expect(isSessionExpired({ expiresAt: new Date(Date.now() + 60_000) })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/sandbox/sessions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/sandbox/sessions.ts`** (mirror `lib/partners/sessions.ts`):

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/lib/sandbox/sessions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sandbox/sessions.ts tests/lib/sandbox/sessions.test.ts
git commit -m "feat(sandbox): scoped-session queries + cookie/TTL constants"
```

---

### Task 4: The authorization core — `lib/sandbox/access.ts`

**Files:**
- Create: `lib/sandbox/access.ts`
- Test: `tests/lib/sandbox/access.test.ts`

This is the security boundary. `courseFromScopedPath` is pure (no DB) — test it exhaustively.

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect } from 'vitest';
import { courseFromScopedPath } from '@/lib/sandbox/access';

describe('courseFromScopedPath (the allowlist)', () => {
  it('allows the capture page + the whole capture engine namespace', () => {
    expect(courseFromScopedPath('/capture/GC%202400')).toBe('GC 2400');
    expect(courseFromScopedPath('/api/capture/GC%202400/scores')).toBe('GC 2400');
    expect(courseFromScopedPath('/api/capture/GC%202400/snapshots/abc/use-as-draft')).toBe('GC 2400');
  });
  it('allows allowlisted /api/courses/<c> segments', () => {
    for (const seg of ['materials', 'imscc-import', 'kuds', 'scan-linked-docs', 'checkin', 'analyze-materials', 'parse-profile']) {
      expect(courseFromScopedPath(`/api/courses/GC%202400/${seg}`)).toBe('GC 2400');
    }
    expect(courseFromScopedPath('/api/courses/GC%202400/materials/some-id')).toBe('GC 2400');
  });
  it('BLOCKS institution-bound + course-admin + everything else', () => {
    for (const seg of ['canvas-import', 'canvas-reextract', 'sync-from-sheet']) {
      expect(courseFromScopedPath(`/api/courses/GC%202400/${seg}`)).toBeNull();
    }
    expect(courseFromScopedPath('/api/courses/GC%202400')).toBeNull(); // bare resource
    expect(courseFromScopedPath('/program')).toBeNull();
    expect(courseFromScopedPath('/admin')).toBeNull();
    expect(courseFromScopedPath('/explore/GC%202400')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/sandbox/access.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/sandbox/access.ts`**

```ts
import { getGrantByToken, isGrantValid } from '@/lib/sandbox/grants';
import { lookupScopedSession, SCOPED_SESSION_COOKIE } from '@/lib/sandbox/sessions';
import { isProgramVisible, type CourseVisibilityFields } from '@/lib/courses/program-visibility';

/** /api/courses/<c>/<seg> segments a scoped tester may use. Everything else
 *  under /api/courses (canvas-import, canvas-reextract, sync-from-sheet, the
 *  bare resource) is blocked. The /api/capture/<c>/* namespace is allowed whole. */
const COURSE_API_ALLOWLIST = new Set([
  'materials', 'imscc-import', 'kuds', 'scan-linked-docs', 'checkin', 'analyze-materials', 'parse-profile',
]);

/**
 * The course a scoped session must be bound to for `pathname` to be allowed,
 * or null if the path is never scoped-accessible. PURE (no DB) — the security
 * allowlist. Course codes contain spaces, URL-encoded as %20.
 */
export function courseFromScopedPath(pathname: string): string | null {
  const segs = pathname.split('/').filter(Boolean); // e.g. ['api','courses','GC%202400','materials']
  const dec = (s: string) => decodeURIComponent(s);

  // /capture/<c>
  if (segs[0] === 'capture' && segs.length >= 2 && segs[1]) return dec(segs[1]);

  if (segs[0] === 'api') {
    // /api/capture/<c>/... — entire capture engine
    if (segs[1] === 'capture' && segs.length >= 3 && segs[2]) return dec(segs[2]);
    // /api/courses/<c>/<seg> — allowlist; bare /api/courses/<c> (len 3) is blocked
    if (segs[1] === 'courses' && segs.length >= 4 && segs[2] && segs[3] && COURSE_API_ALLOWLIST.has(segs[3])) {
      return dec(segs[2]);
    }
  }
  return null;
}

/** Read the scoped-session cookie, validate the session AND its grant, return the binding. */
export async function resolveScopedSession(
  req: { headers: { get(name: string): string | null } },
): Promise<{ courseCode: string; instructorName: string } | null> {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|; )${SCOPED_SESSION_COOKIE}=([^;]+)`));
  if (!m || !m[1]) return null;
  const sess = await lookupScopedSession(m[1]);
  if (!sess) return null;
  const grant = await getGrantByToken_byId(sess.grantId); // see note
  // grant validity is re-checked via the grant row
  return { courseCode: sess.courseCode, instructorName: sess.instructorName };
}

/** Read gate for /view, /okf, /okf-bundle. */
export async function isCourseReadableBy(
  req: { headers: { get(name: string): string | null } },
  course: CourseVisibilityFields & { code: string },
): Promise<boolean> {
  if (isProgramVisible(course)) return true;
  const sess = await resolveScopedSession(req);
  return sess?.courseCode === course.code;
}
```

> **Implementer note (grant re-validation):** `resolveScopedSession` must also confirm the session's *grant* is still valid (not revoked/expired), so a revoked grant kills live sessions. `getGrantByToken` is by token, not id — add a small `getGrantById(id)` to `lib/sandbox/grants.ts` (mirror `getGrantByToken`, `eq(sandboxGrants.id, id)`) and use `isGrantValid(grant)` here; return null if the grant is missing/invalid. Replace the `getGrantByToken_byId` placeholder accordingly. Add a test in `grants.test.ts` for `getGrantById`.

- [ ] **Step 4: Run test to verify it passes** (after wiring `getGrantById`)

Run: `pnpm exec vitest run tests/lib/sandbox/access.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (exit 0).
```bash
git add lib/sandbox/access.ts lib/sandbox/grants.ts tests/lib/sandbox/access.test.ts tests/lib/sandbox/grants.test.ts
git commit -m "feat(sandbox): access core — courseFromScopedPath allowlist + resolveScopedSession + isCourseReadableBy"
```

---

### Task 5: Middleware — scoped-session slug injection

**Files:**
- Modify: `middleware.ts`
- Test: `tests/middleware.sandbox.test.ts`

- [ ] **Step 1: Write the failing test** (import the exported `middleware`, feed `NextRequest`s; mock the access + slug modules so it's deterministic):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockResolve = vi.fn();
vi.mock('@/lib/sandbox/access', async (orig) => {
  const actual = await orig<typeof import('@/lib/sandbox/access')>();
  return { ...actual, resolveScopedSession: (...a: unknown[]) => mockResolve(...a) };
});
vi.mock('@/lib/slug', () => ({ getPrototypeSlug: () => 'FACULTY-SLUG' }));
// Basic Auth env unset → faculty gate is a no-op, so non-scoped paths just pass through.

import { middleware } from '../middleware';

function req(path: string) { return new NextRequest(`http://host${path}`); }
beforeEach(() => { vi.clearAllMocks(); delete process.env.FACULTY_BASIC_AUTH; });

describe('middleware scoped-session injection', () => {
  it('rewrites with injected slug for a bound session on an allowed path', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/api/courses/GC%202400/materials'));
    expect(res.headers.get('x-middleware-rewrite')).toContain('slug=FACULTY-SLUG');
  });
  it('does NOT rewrite for a blocked route even with a bound session', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/api/courses/GC%202400/canvas-import'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });
  it('does NOT rewrite for a different course', async () => {
    mockResolve.mockResolvedValue({ courseCode: 'GC 2400', instructorName: 'x' });
    const res = await middleware(req('/capture/GC%209999'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/middleware.sandbox.test.ts`
Expected: FAIL — injection not implemented.

- [ ] **Step 3: Edit `middleware.ts`.** Add imports and the scoped block at the top of `middleware()`, before the faculty Basic-Auth section. Add `/sandbox` to `PUBLIC_PREFIXES` in `lib/auth/basic-auth.ts`.

In `lib/auth/basic-auth.ts`, add `'/sandbox',` to the `PUBLIC_PREFIXES` array.

In `middleware.ts`:
```ts
import { courseFromScopedPath, resolveScopedSession } from '@/lib/sandbox/access';
import { getPrototypeSlug } from '@/lib/slug';
```
Then, immediately after `const path = req.nextUrl.pathname;` and the `/partners/` dispatch, before the faculty block:
```ts
  // Scoped external-tester access: a session bound to course <c> opens only
  // <c>'s allowed capture surfaces. We inject the faculty slug so the existing
  // routes authorize unchanged (see lib/sandbox/access.ts for the allowlist).
  const scopedCourse = courseFromScopedPath(path);
  if (scopedCourse) {
    const sess = await resolveScopedSession(req);
    if (sess && sess.courseCode === scopedCourse) {
      const url = req.nextUrl.clone();
      url.searchParams.set('slug', getPrototypeSlug());
      return NextResponse.rewrite(url);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/middleware.sandbox.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (exit 0).
```bash
git add middleware.ts lib/auth/basic-auth.ts tests/middleware.sandbox.test.ts
git commit -m "feat(sandbox): middleware injects faculty slug for bound scoped sessions"
```

---

### Task 6: Entry route — `/sandbox/[token]`

**Files:**
- Create: `app/sandbox/[token]/page.tsx`
- Create: `app/sandbox/[token]/start/route.ts`
- Test: `app/sandbox/[token]/start/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test** for the start route:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetGrant = vi.fn();
const mockCreateSession = vi.fn();
vi.mock('@/lib/sandbox/grants', () => ({
  getGrantByToken: (...a: unknown[]) => mockGetGrant(...a),
  isGrantValid: () => true,
}));
vi.mock('@/lib/sandbox/sessions', () => ({
  createScopedSession: (...a: unknown[]) => mockCreateSession(...a),
  SCOPED_SESSION_COOKIE: 'gc_sandbox_sess',
  SCOPED_SESSION_TTL_MS: 86400000,
}));

import { POST } from '../route';

function form(name: string, institution: string) {
  const fd = new FormData(); fd.set('name', name); fd.set('institution', institution);
  return new Request('http://host/sandbox/tok/start', { method: 'POST', body: fd });
}
beforeEach(() => {
  vi.clearAllMocks();
  mockGetGrant.mockResolvedValue({ id: 'g1', courseCode: 'GC 2400', active: true, revokedAt: null, expiresAt: new Date(Date.now() + 1e6) });
  mockCreateSession.mockResolvedValue({ id: 'sess-1', expiresAt: new Date(Date.now() + 86400000) });
});

describe('POST /sandbox/[token]/start', () => {
  it('mints a session cookie and redirects to the course capture page', async () => {
    const res = await POST(form('Dr. Lee', 'UGA'), { params: Promise.resolve({ token: 'tok' }) });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/capture/GC%202400');
    expect(res.headers.get('set-cookie')).toContain('gc_sandbox_sess=sess-1');
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ courseCode: 'GC 2400', instructorName: expect.stringContaining('Dr. Lee') }));
  });
  it('rejects an invalid grant', async () => {
    mockGetGrant.mockResolvedValue(null);
    const res = await POST(form('x', 'y'), { params: Promise.resolve({ token: 'bad' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run app/sandbox/\[token\]/start`
Expected: FAIL — cannot resolve `../route`.

- [ ] **Step 3: Implement `app/sandbox/[token]/start/route.ts`:**

```ts
import { NextResponse } from 'next/server';
import { getGrantByToken, isGrantValid } from '@/lib/sandbox/grants';
import { createScopedSession, SCOPED_SESSION_COOKIE, SCOPED_SESSION_TTL_MS } from '@/lib/sandbox/sessions';

interface Ctx { params: Promise<{ token: string }>; }

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { token } = await params;
  const grant = await getGrantByToken(token);
  if (!grant || !isGrantValid(grant)) {
    return new NextResponse('This link is no longer valid.', { status: 404 });
  }
  const form = await req.formData();
  const name = String(form.get('name') ?? '').trim();
  const institution = String(form.get('institution') ?? '').trim();
  if (!name) return new NextResponse('Name is required.', { status: 400 });
  const instructorName = institution ? `${name}, ${institution}` : name;

  const session = await createScopedSession({ grantId: grant.id, courseCode: grant.courseCode, instructorName });
  const res = NextResponse.redirect(new URL(`/capture/${encodeURIComponent(grant.courseCode)}`, req.url), 303);
  res.cookies.set(SCOPED_SESSION_COOKIE, session.id, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    expires: session.expiresAt, path: '/', maxAge: Math.floor(SCOPED_SESSION_TTL_MS / 1000),
  });
  return res;
}
```

- [ ] **Step 4: Implement `app/sandbox/[token]/page.tsx`** (public entry; validate + name form). If a valid session cookie already exists, redirect straight to capture:

```tsx
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getGrantByToken, isGrantValid } from '@/lib/sandbox/grants';
import { lookupScopedSession, SCOPED_SESSION_COOKIE } from '@/lib/sandbox/sessions';

export default async function SandboxEntry({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const grant = await getGrantByToken(token);
  if (!grant || !isGrantValid(grant)) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">This link is no longer valid</h1>
        <p className="mt-3 text-muted-foreground">Ask your contact for a fresh access link.</p>
      </div>
    );
  }
  const sid = (await cookies()).get(SCOPED_SESSION_COOKIE)?.value;
  if (sid) {
    const sess = await lookupScopedSession(sid);
    if (sess && sess.courseCode === grant.courseCode) redirect(`/capture/${encodeURIComponent(grant.courseCode)}`);
  }
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Welcome — let’s capture your course</h1>
      <p className="mt-3 text-muted-foreground">Tell us who you are; this labels the captured profile.</p>
      <form method="POST" action={`/sandbox/${encodeURIComponent(token)}/start`} className="mt-6 space-y-4">
        <input name="name" required placeholder="Your name" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <input name="institution" placeholder="Institution (optional)" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Start →</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm exec vitest run app/sandbox/\[token\]/start` (PASS 2). Then `pnpm exec tsc --noEmit` (exit 0).

- [ ] **Step 6: Commit**

```bash
git add "app/sandbox/[token]" "app/sandbox/[token]/start/__tests__/route.test.ts"
git commit -m "feat(sandbox): /sandbox/[token] entry + name form + session mint"
```

---

### Task 7: Read gate — open `/view`, `/okf`, `/okf-bundle` to a bound session

**Files:**
- Modify: `app/view/[code]/okf/route.ts`, `app/view/[code]/okf-bundle/route.ts`, `app/view/[code]/page.tsx`
- Test: extend `app/view/[code]/okf-bundle/__tests__/route.test.ts`

- [ ] **Step 1: Add a failing test** to the okf-bundle route test: with a sandbox course (not program-visible) and a mocked `resolveScopedSession` returning the bound course, expect 200; with no session expect 404. Mock `@/lib/sandbox/access`'s `isCourseReadableBy` is the cleanest seam — but since the route will call `isCourseReadableBy`, mock it:

```ts
vi.mock('@/lib/sandbox/access', () => ({ isCourseReadableBy: (...a: unknown[]) => mockReadable(...a) }));
// const mockReadable = vi.fn();
// test A: mockGetCourse → sandbox course; mockReadable.mockResolvedValue(true) → 200 zip
// test B: mockReadable.mockResolvedValue(false) → 404
```

- [ ] **Step 2: Run it — FAIL** (route still uses `isProgramVisible`).

Run: `pnpm exec vitest run app/view/\[code\]/okf-bundle`

- [ ] **Step 3: Edit the three routes.** In each, replace the gate `if (!course || !isProgramVisible(course))` with:
```ts
import { isCourseReadableBy } from '@/lib/sandbox/access';
// …
if (!course || !(await isCourseReadableBy(req, course))) { /* existing 404 */ }
```
- `app/view/[code]/okf/route.ts` and `okf-bundle/route.ts`: they already have `req` — pass it.
- `app/view/[code]/page.tsx`: it's a server component **without** a `Request`. Read the cookie via `next/headers`: build a minimal `{ headers: { get: (n) => n === 'cookie' ? cookieHeader : null } }` from `(await headers()).get('cookie')` and pass that to `isCourseReadableBy`. (The helper only reads the `cookie` header.)

- [ ] **Step 4: Run tests — PASS.** Run the okf-bundle test + the existing okf route test + the view-page test; all green. `pnpm exec tsc --noEmit` exit 0.

- [ ] **Step 5: Commit**

```bash
git add "app/view/[code]/okf/route.ts" "app/view/[code]/okf-bundle/route.ts" "app/view/[code]/page.tsx" "app/view/[code]/okf-bundle/__tests__/route.test.ts"
git commit -m "feat(sandbox): /view + /okf + /okf-bundle readable by a bound scoped session"
```

---

### Task 8: `imscc-import` exception + snapshot instructor name

**Files:**
- Modify: `app/api/courses/[code]/imscc-import/route.ts`
- Modify: `app/api/capture/[code]/snapshots/route.ts`
- Test: extend `app/api/courses/[code]/imscc-import/__tests__/route.test.ts`

- [ ] **Step 1: `imscc-import` — accept a bound scoped session.** This route is excluded from the middleware matcher, so injection can't reach it; it enforces auth itself. In `runImport`, the current gate is `authorizedForBasicAuth(...)` then `isValidSlug(slug)`. Change to allow a scoped session bound to `code` as an alternative. Add:
```ts
import { resolveScopedSession } from '@/lib/sandbox/access';
```
Replace the auth/slug rejection with: compute `const scoped = await resolveScopedSession(req); const scopedOk = scoped?.courseCode === code;` and treat `scopedOk` as satisfying BOTH the Basic-Auth requirement and the slug requirement (i.e. skip both rejections when `scopedOk`). Keep the faculty path (Basic Auth + slug) exactly as-is when `!scopedOk`.

- [ ] **Step 2: Add a failing test** to the imscc route test: with `resolveScopedSession` mocked to return `{courseCode: 'GC 1010'}` and NO Basic Auth / NO slug, POST the sample cartridge → 200 (currently 401). Mock `@/lib/sandbox/access`.

- [ ] **Step 3: Run — FAIL then implement Step 1 then PASS.**

Run: `pnpm exec vitest run app/api/courses/\[code\]/imscc-import`

- [ ] **Step 4: Snapshot instructor name.** Open `app/api/capture/[code]/snapshots/route.ts`, find where `instructorName` is determined for the created snapshot. Add: `const scoped = await resolveScopedSession(req);` and prefer `scoped?.instructorName` when present (else the existing faculty value). One-line override; existing faculty behavior unchanged when no scoped session. Import `resolveScopedSession`. Verify the existing snapshots tests stay green (no scoped session in them → unchanged).

- [ ] **Step 5: Run the imscc + snapshots tests + tsc.** All green; `pnpm exec tsc --noEmit` exit 0.

- [ ] **Step 6: Commit**

```bash
git add "app/api/courses/[code]/imscc-import/route.ts" "app/api/capture/[code]/snapshots/route.ts" "app/api/courses/[code]/imscc-import/__tests__/route.test.ts"
git commit -m "feat(sandbox): imscc-import accepts scoped session; snapshot uses tester name"
```

---

### Task 9: Operator mint/list/revoke — API + `/admin` UI

**Files:**
- Create: `app/api/admin/sandbox-grants/route.ts`
- Test: `app/api/admin/sandbox-grants/__tests__/route.test.ts`
- Modify: the `/admin` page (`app/admin/page.tsx` or its client) to add a "Sandbox access" panel

- [ ] **Step 1: Write the failing test** for the API (mock grants queries + auth):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockCreate = vi.fn(); const mockList = vi.fn(); const mockRevoke = vi.fn();
vi.mock('@/lib/sandbox/grants', () => ({
  createGrant: (...a: unknown[]) => mockCreate(...a),
  listGrants: (...a: unknown[]) => mockList(...a),
  revokeGrant: (...a: unknown[]) => mockRevoke(...a),
}));
import { POST, GET, DELETE } from '../route';
beforeEach(() => { vi.clearAllMocks(); delete process.env.FACULTY_BASIC_AUTH; });

describe('admin sandbox-grants API', () => {
  it('POST mints a grant', async () => {
    mockCreate.mockResolvedValue({ id: 'g1', token: 'tok', courseCode: 'GC 2400' });
    const res = await POST(new Request('http://h/api/admin/sandbox-grants', { method: 'POST', body: JSON.stringify({ courseCode: 'GC 2400', label: 'UGA' }), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ token: 'tok' });
  });
  it('GET lists grants', async () => { mockList.mockResolvedValue([]); expect((await GET(new Request('http://h/api/admin/sandbox-grants'))).status).toBe(200); });
  it('DELETE revokes by id', async () => {
    mockRevoke.mockResolvedValue(undefined);
    const res = await DELETE(new Request('http://h/api/admin/sandbox-grants?id=g1', { method: 'DELETE' }));
    expect(res.status).toBe(200); expect(mockRevoke).toHaveBeenCalledWith('g1');
  });
});
```

- [ ] **Step 2: Run — FAIL.** Run: `pnpm exec vitest run app/api/admin/sandbox-grants`

- [ ] **Step 3: Implement `app/api/admin/sandbox-grants/route.ts`** (faculty-gated by middleware as an `/admin/*`… note: `/api/admin/*` is gated by middleware Basic Auth, so no in-route auth needed — mirror sibling admin routes):

```ts
import { NextResponse } from 'next/server';
import { createGrant, listGrants, revokeGrant } from '@/lib/sandbox/grants';

export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { courseCode?: string; label?: string };
  if (!body.courseCode) return NextResponse.json({ error: 'courseCode required' }, { status: 400 });
  const grant = await createGrant({ courseCode: body.courseCode, label: body.label ?? null });
  return NextResponse.json({ id: grant.id, token: grant.token, courseCode: grant.courseCode, expiresAt: grant.expiresAt });
}

export async function GET(): Promise<Response> {
  return NextResponse.json({ grants: await listGrants() });
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await revokeGrant(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run — PASS (3).**

- [ ] **Step 5: Add the `/admin` panel.** Read `app/admin/page.tsx` (and any client component it renders) to match its style. Add a "Sandbox access" section: a course-code input + optional label + **Mint link** button (POST to `/api/admin/sandbox-grants`, then show the full `${origin}/sandbox/${token}` URL with a copy affordance), and a list of grants (GET) each with course/label/expiry and a **Revoke** button (DELETE). Keep it consistent with the existing admin sections; no new design system.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (exit 0).
```bash
git add app/api/admin/sandbox-grants "app/admin"
git commit -m "feat(sandbox): /admin mint/list/revoke scoped-access links"
```

---

### Task 10: Full verification + STATE.md

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Typecheck + full suite.** `pnpm exec tsc --noEmit` (exit 0); `pnpm test` (all green; new sandbox tests + unchanged faculty tests).

- [ ] **Step 2: Update STATE.md.** Flip the external-testing arc to `(1)+(2)+(3)+(4) SHIPPED`. Add the new route `/sandbox/[token]` + `POST /sandbox/[token]/start` + `POST/GET/DELETE /api/admin/sandbox-grants`, the new tables `sandbox_grants`/`sandbox_sessions` (+ migration number), the new `gc_sandbox_sess` cookie, the new `lib/sandbox/*` modules, and the **security model** one-liner (middleware slug-injection on an allowlist; `imscc-import` accepts the session directly). Note the **known v1 gap**: capture-surface buttons calling `/api/admin/*` (e.g. "Index now") don't work for scoped testers (deferred). Add the env/route/schema triggers.

- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): external-access scoped link shipped (arc sub-project 4 / arc complete)"
```

- [ ] **Step 4: Deploy (operator-confirmed).** New routes + a **migration** → deploy needs `pnpm db:migrate` against prod (the same local Postgres) **before** the service restart, plus the usual ff `main` + restart + poll. **Do not deploy without explicit operator go**, and confirm the migration is safe (two new tables, no alter to existing).

---

## Notes for the implementer

- **The security boundary is `courseFromScopedPath` + the middleware match.** Never widen the allowlist or relax the exact `courseCode === scopedCourse` check without re-reading the spec's security section. The blocked routes (`canvas-import`, `canvas-reextract`, `sync-from-sheet`, bare course resource) are blocked deliberately.
- **Faculty path stays untouched.** Every change is additive (a new OR-branch or a middleware short-circuit that only fires for a valid bound session). Existing faculty tests must stay green — if one breaks, the change leaked into the faculty path.
- **`resolveScopedSession` re-checks grant validity**, so operator revoke kills live sessions on the next request.
- **Course codes have spaces** (`GC 2400` → `GC%202400`). Decode in `courseFromScopedPath`; encode in redirects/links.
- **Middleware runs in Node runtime** (it already imports `db`), so DB lookups in `resolveScopedSession` are fine there.
