# Two-Tier Faculty Basic Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second Basic-Auth credential (`CREATE_ONLY_AUTH=cufaculty:tigers`) that is a *create-only* role — it may add a single course but cannot edit any existing course; the existing `FACULTY_BASIC_AUTH=gcfaculty:godfrey` stays full-access.

**Architecture:** Two pure helpers in `lib/auth/basic-auth.ts` (`resolveRole` maps a Basic header → `'faculty' | 'creator' | null` against the two expected creds; `creatorAllowed` is a path/method allowlist for the creator role). Middleware resolves the role and enforces: no creds → 401, faculty → allow, creator → allow only on the allowlist else 403. The create API additionally refuses bulk-preload for a creator. The `/courses/new` page resolves the role server-side and tells `NewCourseForm` whether to redirect into capture (faculty) or show a "Course added" confirmation (creator).

**Tech Stack:** Next.js 15 App Router (middleware in **nodejs** runtime), TypeScript strict, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-13-two-tier-faculty-auth-design.md`

**Conventions:** tests `pnpm vitest run <path>`; full suite `pnpm test`; typecheck `pnpm tsc --noEmit` (vitest does NOT typecheck — run tsc explicitly). `@/*` maps to repo root, so the root middleware imports as `@/middleware`. The transcribe route self-enforces against `FACULTY_BASIC_AUTH` only, so a creator credential already fails it — **leave it unchanged**. Do NOT `git add` `*.jpeg` or `.playwright-mcp`.

**File map:**
- Modify `lib/auth/basic-auth.ts` — add `resolveRole` + `creatorAllowed` (keep `authorizedForBasicAuth` exported; the transcribe route still uses it).
- Test `tests/auth/basic-auth.test.ts` — extend with the two new helpers.
- Modify `middleware.ts` — replace the single-credential check with role resolution + allowlist enforcement.
- Test `tests/middleware.test.ts` — new; role enforcement (mocks db + sessions).
- Modify `app/api/admin/courses/roster/route.ts` — block `mode:'bulk'` for the creator role.
- Test `tests/app/api/roster-add.test.ts` — extend with role-based bulk gating.
- Modify `app/courses/new/page.tsx` — resolve role, pass `canCapture` to the form.
- Modify `app/courses/new/NewCourseForm.tsx` — `canCapture` prop; confirmation vs capture redirect.
- Test `tests/app/courses/new-course-form.test.tsx` — extend with the creator confirmation path.
- Modify `.env.example` + `docs/STATE.md`. (`.env.local` is the operator's real deploy env — gitignored — handled in the final task.)

---

### Task 1: `resolveRole` + `creatorAllowed` pure helpers

**Files:**
- Modify: `lib/auth/basic-auth.ts` (append after the existing `authorizedForBasicAuth` function)
- Test: `tests/auth/basic-auth.test.ts` (append new describe blocks)

- [ ] **Step 1: Write the failing tests**

Append to `tests/auth/basic-auth.test.ts`:

```typescript
import { resolveRole, creatorAllowed } from '@/lib/auth/basic-auth';

const basic = (cred: string) => 'Basic ' + Buffer.from(cred).toString('base64');
const EXPECTED = { faculty: 'gcfaculty:godfrey', creator: 'cufaculty:tigers' };

describe('resolveRole', () => {
  it('maps the faculty credential to "faculty"', () => {
    expect(resolveRole(basic('gcfaculty:godfrey'), EXPECTED)).toBe('faculty');
  });
  it('maps the creator credential to "creator"', () => {
    expect(resolveRole(basic('cufaculty:tigers'), EXPECTED)).toBe('creator');
  });
  it('returns null for an unknown credential', () => {
    expect(resolveRole(basic('someone:else'), EXPECTED)).toBeNull();
  });
  it('returns null for a missing or non-Basic header', () => {
    expect(resolveRole(null, EXPECTED)).toBeNull();
    expect(resolveRole('Bearer abc', EXPECTED)).toBeNull();
    expect(resolveRole('Basic', EXPECTED)).toBeNull();
  });
  it('returns null for undecodable base64', () => {
    expect(resolveRole('Basic !!!notb64!!!', EXPECTED)).toBeNull();
  });
  it('ignores a role whose expected credential is unset', () => {
    expect(resolveRole(basic('cufaculty:tigers'), { faculty: 'gcfaculty:godfrey', creator: undefined })).toBeNull();
    expect(resolveRole(basic('gcfaculty:godfrey'), { faculty: undefined, creator: 'cufaculty:tigers' })).toBeNull();
  });
});

describe('creatorAllowed', () => {
  it('allows GET /courses/new and POST /api/admin/courses/roster', () => {
    expect(creatorAllowed('/courses/new', 'GET')).toBe(true);
    expect(creatorAllowed('/api/admin/courses/roster', 'POST')).toBe(true);
    expect(creatorAllowed('/api/admin/courses/roster', 'post')).toBe(true);
  });
  it('denies edit surfaces and wrong methods', () => {
    expect(creatorAllowed('/capture/GC 1040', 'GET')).toBe(false);
    expect(creatorAllowed('/program', 'GET')).toBe(false);
    expect(creatorAllowed('/explore/GC 1040', 'GET')).toBe(false);
    expect(creatorAllowed('/settings', 'GET')).toBe(false);
    expect(creatorAllowed('/api/admin/courses/GC 1040', 'PATCH')).toBe(false);
    expect(creatorAllowed('/courses/new', 'POST')).toBe(false);
    expect(creatorAllowed('/api/admin/courses/roster', 'GET')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/auth/basic-auth.test.ts`
Expected: FAIL — `resolveRole`/`creatorAllowed` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `lib/auth/basic-auth.ts`:

```typescript
export type FacultyRole = 'faculty' | 'creator';

/**
 * Resolve a Basic-Auth header to a role against the two expected
 * credentials. Pure — env reads happen at the call site (middleware /
 * route) and are passed in, mirroring `authorizedForBasicAuth`.
 *
 * `faculty` is checked first so the stronger role wins deterministically.
 * A role whose expected credential is undefined never matches.
 */
export function resolveRole(
  authorizationHeader: string | null | undefined,
  expected: { faculty: string | undefined; creator: string | undefined },
): FacultyRole | null {
  const header = authorizationHeader ?? '';
  if (!header.toLowerCase().startsWith('basic ')) return null;
  const b64 = header.slice(6).trim();
  if (!b64) return null;
  let decoded: string;
  try {
    decoded = atob(b64);
  } catch {
    return null;
  }
  if (expected.faculty && decoded === expected.faculty) return 'faculty';
  if (expected.creator && decoded === expected.creator) return 'creator';
  return null;
}

/**
 * Path/method allowlist for the create-only role. A creator may reach ONLY
 * the add-course form and the create API; the route enforces single-add
 * (no bulk). Default-deny: anything not listed here is forbidden, so future
 * faculty routes are automatically off-limits to creators.
 */
const CREATOR_ALLOWED: ReadonlyArray<{ path: string; method: string }> = [
  { path: '/courses/new', method: 'GET' },
  { path: '/api/admin/courses/roster', method: 'POST' },
];

export function creatorAllowed(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  return CREATOR_ALLOWED.some((r) => r.path === pathname && r.method === m);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/auth/basic-auth.test.ts`
Expected: PASS (existing `requiresBasicAuth`/`authorizedForBasicAuth` tests still green too).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/basic-auth.ts tests/auth/basic-auth.test.ts
git commit -m "feat(auth): resolveRole + creatorAllowed helpers for two-tier faculty auth"
```

---

### Task 2: Middleware role enforcement

**Files:**
- Modify: `middleware.ts` (the import on line 6 and the Basic-Auth block, lines 29–41)
- Test: `tests/middleware.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/middleware.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Prevent the real node-postgres pool + session module from loading.
vi.mock('@/lib/db/client', () => ({ db: {} }));
vi.mock('@/lib/partners/sessions', () => ({ SESSION_COOKIE: 'gc_partner', createSession: vi.fn() }));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const auth = (cred: string) => 'Basic ' + Buffer.from(cred).toString('base64');
function reqFor(path: string, opts: { method?: string; cred?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = auth(opts.cred);
  return new NextRequest(`http://localhost${path}`, { method: opts.method ?? 'GET', headers });
}

beforeEach(() => {
  vi.stubEnv('FACULTY_BASIC_AUTH', 'gcfaculty:godfrey');
  vi.stubEnv('CREATE_ONLY_AUTH', 'cufaculty:tigers');
});
afterEach(() => vi.unstubAllEnvs());

describe('middleware role enforcement', () => {
  it('401s with no credentials on a faculty path', async () => {
    expect((await middleware(reqFor('/capture/GC%201040'))).status).toBe(401);
  });
  it('lets faculty reach an edit surface', async () => {
    expect((await middleware(reqFor('/capture/GC%201040', { cred: 'gcfaculty:godfrey' }))).status).toBe(200);
  });
  it('403s a creator on an edit surface', async () => {
    expect((await middleware(reqFor('/capture/GC%201040', { cred: 'cufaculty:tigers' }))).status).toBe(403);
  });
  it('403s a creator on /program', async () => {
    expect((await middleware(reqFor('/program', { cred: 'cufaculty:tigers' }))).status).toBe(403);
  });
  it('lets a creator GET the add-course form', async () => {
    expect((await middleware(reqFor('/courses/new', { cred: 'cufaculty:tigers' }))).status).toBe(200);
  });
  it('lets a creator POST the create API', async () => {
    expect((await middleware(reqFor('/api/admin/courses/roster', { method: 'POST', cred: 'cufaculty:tigers' }))).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/middleware.test.ts`
Expected: FAIL — a creator currently passes the single-credential check, so `/capture` returns 200, not 403 (and `authorizedForBasicAuth` rejects the creator cred → 401 on the allowed paths). Either way the role-specific assertions fail.

- [ ] **Step 3: Implement the middleware change**

In `middleware.ts`, change the import on line 6 from:

```typescript
import { requiresBasicAuth, authorizedForBasicAuth } from '@/lib/auth/basic-auth';
```
to:
```typescript
import { requiresBasicAuth, resolveRole, creatorAllowed } from '@/lib/auth/basic-auth';
```

Then replace the Basic-Auth block (currently lines 29–41, from `const expected = process.env.FACULTY_BASIC_AUTH;` through the closing `}` of the `if (!authorizedForBasicAuth(...))` block) with:

```typescript
  const facultyExpected = process.env.FACULTY_BASIC_AUTH;
  if (facultyExpected && requiresBasicAuth(path)) {
    const role = resolveRole(req.headers.get('authorization'), {
      faculty: facultyExpected,
      creator: process.env.CREATE_ONLY_AUTH,
    });
    if (role === null) {
      return new NextResponse('Authentication required.', {
        status: 401,
        headers: {
          // Realm string must be ASCII (HTTP header = ByteString).
          'WWW-Authenticate': 'Basic realm="GC Curriculum Tool - Faculty"',
        },
      });
    }
    // Create-only role: allowed on the add-course paths, forbidden elsewhere.
    if (role === 'creator' && !creatorAllowed(path, req.method)) {
      return new NextResponse('Forbidden.', { status: 403 });
    }
  }
```

(The `return NextResponse.next();` on the original line 43 stays as the function's final statement.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts tests/middleware.test.ts
git commit -m "feat(auth): middleware enforces creator-role allowlist (403 on edit surfaces)"
```

---

### Task 3: Roster route blocks bulk for the creator role

**Files:**
- Modify: `app/api/admin/courses/roster/route.ts` (add the import + a guard after `const mode = body.mode;`)
- Test: `tests/app/api/roster-add.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `tests/app/api/roster-add.test.ts` (the file already mocks `checkAdminAuth` to accept `slug==='good'` and mocks `bulkCreateCourses: vi.fn()`):

```typescript
import { afterEach } from 'vitest';

const CREATOR_AUTH = 'Basic ' + Buffer.from('cufaculty:tigers').toString('base64');
const FACULTY_AUTH = 'Basic ' + Buffer.from('gcfaculty:godfrey').toString('base64');

describe('roster bulk gating by role', () => {
  beforeEach(() => {
    vi.stubEnv('FACULTY_BASIC_AUTH', 'gcfaculty:godfrey');
    vi.stubEnv('CREATE_ONLY_AUTH', 'cufaculty:tigers');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('blocks bulk preload for the creator role (403)', async () => {
    const res = await POST(new Request('http://x/api/admin/courses/roster?slug=good', {
      method: 'POST',
      headers: { authorization: CREATOR_AUTH },
      body: JSON.stringify({ mode: 'bulk', text: 'GC 1010 — Intro' }),
    }));
    expect(res.status).toBe(403);
  });

  it('allows bulk preload for the faculty role', async () => {
    const res = await POST(new Request('http://x/api/admin/courses/roster?slug=good', {
      method: 'POST',
      headers: { authorization: FACULTY_AUTH },
      body: JSON.stringify({ mode: 'bulk', text: 'GC 1010 — Intro' }),
    }));
    expect(res.status).toBe(200);
  });

  it('still allows single-add for the creator role', async () => {
    const res = await POST(new Request('http://x/api/admin/courses/roster?slug=good', {
      method: 'POST',
      headers: { authorization: CREATOR_AUTH },
      body: JSON.stringify({ mode: 'one', code: 'GC 1010', title: 'Intro' }),
    }));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/app/api/roster-add.test.ts`
Expected: FAIL — the creator bulk request currently returns 200 (no role guard yet).

- [ ] **Step 3: Implement the guard**

In `app/api/admin/courses/roster/route.ts`, add to the imports:

```typescript
import { resolveRole } from '@/lib/auth/basic-auth';
```

Then, immediately after `const mode = body.mode;` (currently line 53), insert:

```typescript
  // Create-only role (CREATE_ONLY_AUTH) may add a single course but not bulk-preload.
  const role = resolveRole(req.headers.get('authorization'), {
    faculty: process.env.FACULTY_BASIC_AUTH,
    creator: process.env.CREATE_ONLY_AUTH,
  });
  if (mode === 'bulk' && role === 'creator') {
    return NextResponse.json({ error: 'create-only role cannot bulk-preload' }, { status: 403 });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/app/api/roster-add.test.ts`
Expected: PASS (the existing paired-course tests still green).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/courses/roster/route.ts tests/app/api/roster-add.test.ts
git commit -m "feat(auth): roster route refuses bulk-preload for the create-only role"
```

---

### Task 4: `NewCourseForm` — confirmation vs capture redirect

**Files:**
- Modify: `app/courses/new/NewCourseForm.tsx`
- Test: `tests/app/courses/new-course-form.test.tsx` (append a case)

- [ ] **Step 1: Write the failing test**

Append to `tests/app/courses/new-course-form.test.tsx`:

```typescript
  it('shows a "Course added" confirmation (no capture redirect) when canCapture is false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<NewCourseForm slug="s" canCapture={false} />);
    fireEvent.change(screen.getByLabelText(/prefix/i), { target: { value: 'GC' } });
    fireEvent.change(screen.getByLabelText(/course number/i), { target: { value: '3460' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Junior Seminar' } });
    fireEvent.click(screen.getByRole('button', { name: /^add course$/i }));

    await waitFor(() => expect(screen.getByText(/course added/i)).toBeTruthy());
    expect(screen.getByRole('link', { name: /view course/i }).getAttribute('href')).toContain('/view/GC%203460');
    expect(pushMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/app/courses/new-course-form.test.tsx`
Expected: FAIL — `canCapture` is not a prop; the button is still "Add course & start capture"; success pushes to `/capture`.

- [ ] **Step 3: Implement the change**

In `app/courses/new/NewCourseForm.tsx`:

(a) Change the `Props` interface and signature:

```typescript
interface Props {
  slug: string;
  /** Faculty (full) → redirect into capture on success. Creator → show a
   *  confirmation instead. Defaults to true so existing callers/tests keep
   *  the capture-redirect behavior. */
  canCapture?: boolean;
}

export function NewCourseForm({ slug, canCapture = true }: Props) {
```

(b) Add a success state alongside the other `useState` hooks:

```typescript
  const [done, setDone] = useState<{ code: string } | null>(null);
```

(c) Replace the success branch (currently the `router.push(...)` on line 69) with:

```typescript
      if (canCapture) {
        // Faculty — land directly on Step 1 of CourseCapture for this code.
        router.push(`/capture/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`);
      } else {
        // Create-only role — confirm and stay out of the editor.
        setDone({ code });
      }
```

(d) Add an early return for the confirmation state, immediately before the existing `return (` of the form (the `const inputClass = ...` line can stay above it):

```typescript
  if (done) {
    const viewHref = `/view/${encodeURIComponent(done.code)}`;
    return (
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-4">
        <p className="text-sm font-medium">Course added: {done.code}</p>
        <p className="text-sm text-muted-foreground">
          The course is in the catalog. A faculty editor will capture its profile.
        </p>
        <div className="flex items-center gap-4">
          <a
            href={viewHref}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            View course →
          </a>
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setPrefix('GC');
              setCourseNumber('');
              setTitle('');
              setCatalogUrl('');
              setPairedOpen(false);
              setPairedNumber('');
              setPairedRole('lab');
              setError(null);
            }}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Add another
          </button>
        </div>
      </div>
    );
  }
```

(e) Make the intro line and submit-button label role-aware. Replace the intro paragraph text `Add a course to the roster, then go straight into CourseCapture Step 1.` with:

```typescript
        {canCapture
          ? 'Add a course to the roster, then go straight into CourseCapture Step 1.'
          : 'Add a course to the roster. It becomes available for a faculty editor to capture.'}
```

And replace the submit button label `{pending ? 'Adding…' : 'Add course & start capture'}` with:

```typescript
          {pending ? 'Adding…' : canCapture ? 'Add course & start capture' : 'Add course'}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/app/courses/new-course-form.test.tsx`
Expected: PASS — the new confirmation case passes AND the existing cases (default `canCapture`, button "Add course & start capture", capture push) still pass.

- [ ] **Step 5: Commit**

```bash
git add app/courses/new/NewCourseForm.tsx tests/app/courses/new-course-form.test.tsx
git commit -m "feat(courses): NewCourseForm confirms (no capture) for the create-only role"
```

---

### Task 5: Role-aware `/courses/new` page

**Files:**
- Modify: `app/courses/new/page.tsx`

- [ ] **Step 1: Implement the role resolution (no unit test — server component reading request headers; verified by tsc + the Task 4 form test + the Task 6 manual check)**

In `app/courses/new/page.tsx`, add to the imports:

```typescript
import { headers } from 'next/headers';
import { resolveRole } from '@/lib/auth/basic-auth';
```

Inside `NewCoursePage`, after the `isValidSlug(slug)` guard block and before the `return (`, add:

```typescript
  const role = resolveRole((await headers()).get('authorization'), {
    faculty: process.env.FACULTY_BASIC_AUTH,
    creator: process.env.CREATE_ONLY_AUTH,
  });
  // Faculty (or no gate configured → null) keep the capture redirect;
  // the create-only role gets the confirmation flow.
  const canCapture = role !== 'creator';
```

Then change the form render from `<NewCourseForm slug={slug} />` to:

```typescript
        <NewCourseForm slug={slug} canCapture={canCapture} />
```

- [ ] **Step 2: Typecheck + full suite**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: clean, green.

- [ ] **Step 3: Commit**

```bash
git add app/courses/new/page.tsx
git commit -m "feat(courses): /courses/new resolves role → passes canCapture to the form"
```

---

### Task 6: Env documentation, STATE.md, and live verification

**Files:**
- Modify: `.env.example`
- Modify: `docs/STATE.md`
- (Operator action) `.env.local` on the deploy — gitignored, not committed.

- [ ] **Step 1: Document the env var in `.env.example`**

In `.env.example`, immediately after the `FACULTY_BASIC_AUTH=` line (line 65) and its comment block, add:

```bash

# Create-only faculty credential (two-tier auth, 2026-06-13). Format: user:password.
# When set, this credential may ADD a single course (/courses/new + the single-add
# roster API) but is forbidden (403) on every edit surface. When unset, only
# FACULTY_BASIC_AUTH exists (today's single-tier behavior). Shares the same Basic
# realm as FACULTY_BASIC_AUTH.
CREATE_ONLY_AUTH=
```

- [ ] **Step 2: Set the credential in the live deploy env**

The running app serves from `~/projects/curriculum_developer-deploy` (a worktree on `main`); both checkouts share `.env.local` only if it's symlinked — they are separate files. Add the line to the **deploy** env file the launchd service reads. From the repo root:

Run:
```bash
grep -q '^CREATE_ONLY_AUTH=' ~/projects/curriculum_developer-deploy/.env.local \
  && echo "already set" \
  || printf '\nCREATE_ONLY_AUTH=cufaculty:tigers\n' >> ~/projects/curriculum_developer-deploy/.env.local
grep -n '^CREATE_ONLY_AUTH=\|^FACULTY_BASIC_AUTH=' ~/projects/curriculum_developer-deploy/.env.local
```
Expected: both `FACULTY_BASIC_AUTH=gcfaculty:godfrey` and `CREATE_ONLY_AUTH=cufaculty:tigers` present. (Also add it to the dev checkout's `.env.local` the same way if you run a dev server there.)

- [ ] **Step 3: Update `docs/STATE.md`**

- **Env vars / auth surface:** add `CREATE_ONLY_AUTH` (create-only faculty credential; create paths only, 403 elsewhere; back-compat — unset = single-tier).
- **"What's live" / auth model:** one line — two-tier faculty Basic Auth shipped (full `gcfaculty` vs create-only `cufaculty`); enforcement is a default-deny allowlist in middleware + a bulk guard in the roster route; spec link `docs/superpowers/specs/2026-06-13-two-tier-faculty-auth-design.md`.
- **Deferred / debt:** note it is role-tiering with shared credentials, not per-user identity — no per-person attribution/revocation; the real-auth (SSO/magic-link) deferral still stands. Also: `faculty` can still edit *any* course (no per-course ownership).

- [ ] **Step 4: Restart the service and verify each credential live**

Run (kickstart picks up the new env var; `next dev` recompiles on first request):
```bash
launchctl kickstart -k "gui/$(id -u)/com.gc.curriculum-tool"
sleep 8
S=http://localhost:3000
echo "no creds → /courses (expect 401):"; curl -s -o /dev/null -w '%{http_code}\n' "$S/courses?slug=$(grep '^PROTOTYPE_SLUG=' ~/projects/curriculum_developer-deploy/.env.local | cut -d= -f2-)"
echo "creator → /courses/new (expect 200):"; curl -s -o /dev/null -w '%{http_code}\n' -u cufaculty:tigers "$S/courses/new?slug=$(grep '^PROTOTYPE_SLUG=' ~/projects/curriculum_developer-deploy/.env.local | cut -d= -f2-)"
echo "creator → /capture (expect 403):"; curl -s -o /dev/null -w '%{http_code}\n' -u cufaculty:tigers "$S/capture/GC%201040"
echo "creator → /program (expect 403):"; curl -s -o /dev/null -w '%{http_code}\n' -u cufaculty:tigers "$S/program"
echo "faculty → /capture (expect 200):"; curl -s -o /dev/null -w '%{http_code}\n' -u gcfaculty:godfrey "$S/capture/GC%201040"
```
Expected: 401, 200, 403, 403, 200 respectively. (The `/courses/new` check also needs the valid slug; the `PROTOTYPE_SLUG` lookup supplies it.)

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/STATE.md
git commit -m "docs(auth): document CREATE_ONLY_AUTH (two-tier faculty auth) + STATE.md"
```

---

## Plan self-review (done at write time)

- **Spec coverage:** credentials→roles (T1 helpers + T2/T3/T5 env reads); `resolveRole`/`creatorAllowed` (T1); middleware 401/faculty-allow/creator-403 (T2); roster bulk guard (T3); role-aware page + confirmation redirect (T4, T5); STATE.md + env var (T6). The "creator view = public only" decision needs no code — it's the *absence* of any allowlist entry beyond the two create paths (T1), so a creator hitting `/courses`, `/program`, `/wiki` gets 403 (asserted in T2). ✓
- **Placeholder scan:** every code step shows complete code; commands have expected output. ✓
- **Type consistency:** `resolveRole(header, { faculty, creator })` signature identical in T1 (def), T2 (middleware), T3 (route), T5 (page). `FacultyRole` exported once. `canCapture?: boolean` consistent across T4 (form) and T5 (page caller). `creatorAllowed(path, method)` consistent in T1/T2. ✓
- **Frozen-surface guard:** the transcribe route is deliberately untouched (already rejects the creator cred by matching only `FACULTY_BASIC_AUTH`); `authorizedForBasicAuth` stays exported for it. No capture/synthesis/matrix code touched. ✓
- **Back-compat:** `CREATE_ONLY_AUTH` unset → `resolveRole` never returns `creator` → only faculty works (today's behavior); `FACULTY_BASIC_AUTH` unset → gate no-ops (`facultyExpected` falsy). ✓
