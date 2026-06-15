# External-Access Scoped Link — Design

**Date:** 2026-06-15
**Status:** approved design (operator brainstorm 2026-06-15), pre-plan
**Origin:** Sub-project **4 of 4** of the external-university-testing arc — the piece that ties the others together. (1) course scope & lifecycle, (2) IMSCC import, (3) OKF bundle export are shipped. This adds the **operator-minted scoped link** that lets one outside tester self-serve **capture + view + bundle** for *one sandbox course*, fully isolated from the GC program record. It closes the loop the scope model left open: a sandbox course is invisible everywhere (`isProgramVisible` = false → opaque 404 on `/view`/`/okf`/`/okf-bundle`); this is the *selective* grant that opens that one course to that one tester.

## Decisions made in the brainstorm (2026-06-15)

1. **Access scope:** full self-serve — the link opens the whole CourseCapture flow (`/capture/<course>` + its APIs: materials upload, `.imscc` import, interview, approve) **and** the read surfaces (`/view/<course>`, `/okf`, `/okf-bundle`) for the one sandbox course.
2. **Identity:** anonymous link **bound to the course** (no per-tester pre-registration). On first use the tester enters **name + institution**, which becomes the capture snapshot's `instructor_name`.
3. **Mechanism: a scoped session bound to one course** (the shipped partner-session pattern), authorized centrally. Rejected per-course-slug (churns the faculty auth model, leaks tokens in URLs) and a separate `/sandbox/.../capture` app tree (duplicates routing).
4. **Mint location:** `/admin`.
5. **Lifecycle:** grants are **reusable** (capture is multi-session) until a **30-day** expiry or operator **revoke**; scoped session TTL **24h** (re-opening the link re-mints).
6. **Security posture (load-bearing):** a scoped session can reach **only its one sandbox course's** `/capture`, `/view`, `/okf`, `/okf-bundle`, and `/api/courses/<that-course>/*` — nothing else. Every other surface (`/program`, `/explore`, `/admin`, `/ask`, `/wiki`, `/settings`, any *other* course) stays Basic-Auth-gated → opaque 404/401 to the tester. Enforced centrally.

## Background — how access works today

- **Middleware** (`middleware.ts`, Node runtime) dispatches by prefix: `/partners/*` → mints a `partner_sessions` cookie; everything not in `PUBLIC_PREFIXES` is HTTP-Basic-Auth-gated. `PUBLIC_PREFIXES` = `/partners`, `/api/partners`, `/view`, `/api/mcp`, … (so `/view` + its `/okf`,`/okf-bundle` children bypass Basic Auth).
- **The faculty `slug`** (`lib/slug.ts:isValidSlug`) is a **single global secret** (`PROTOTYPE_SLUG`), not per-course. The capture page (`/capture/[code]/page.tsx`) and the course APIs check `isValidSlug(slug)` **in addition to** middleware Basic Auth. So a tester cannot be handed "the slug" — it's the faculty master key and isn't course-scoped.
- **Scope gate:** `isProgramVisible(course)` (`scope='gc' AND status='offered'`) gates `/view`,`/okf`,`/okf-bundle` (opaque 404 otherwise) and every program rollup. A sandbox course (`external`/`sandbox`) is already invisible.
- **Partner-session machinery to mirror:** `lib/partners/sessions.ts` (`createSession`/`lookupSession`/`revokeSession`, 24h TTL, cookie), `partner_sessions` table, `handlePartnerSession` in middleware.

## Architecture (one paragraph)

The operator mints a **grant** (random token bound to one sandbox course) from `/admin` and sends the tester `…/sandbox/<token>`. That path is public; the entry page validates the grant, takes the tester's name on first use, mints a **scoped session** cookie bound to `{course, instructorName}`, and redirects into `/capture/<course>`. Two centralized authorization helpers recognize that session: middleware **skips Basic Auth** for the bound course's `/capture` + `/api/courses/<course>/*`, and the read routes treat a bound session as **readable** alongside `isProgramVisible`. The session never matches any other course or any non-course surface, so the tester is boxed into their one sandbox course. The faculty path (Basic-Auth + slug) is untouched.

## Components

| File | New/Changed | Responsibility |
|---|---|---|
| `lib/db/schema.ts` + migration | **changed** | `sandbox_grants` + `sandbox_sessions` tables (below). |
| `lib/sandbox/grants.ts` | **new** | `createGrant`/`listGrants`/`getGrantByToken`/`revokeGrant`. Pure-ish DB. |
| `lib/sandbox/sessions.ts` | **new** | `createScopedSession`/`lookupScopedSession`/`revokeScopedSession` (+ `SCOPED_SESSION_COOKIE`, 24h TTL) — mirror of `lib/partners/sessions.ts`. |
| `lib/sandbox/access.ts` | **new** | The two authorization predicates (below): `resolveScopedSession(req)` and the path→course extractor. The single place the security boundary is decided. |
| `app/sandbox/[token]/page.tsx` | **new** | Public entry: validate grant → name form (first use) → mint session → redirect to `/capture/<course>`. |
| `app/sandbox/[token]/start/route.ts` | **new** | `POST` handler the name form submits to (mints the session cookie, redirects). |
| `middleware.ts` | **changed** | Add `/sandbox` to `PUBLIC_PREFIXES`; before the faculty Basic-Auth gate, allow `/capture/<c>` + `/api/courses/<c>/*` when a scoped session bound to `<c>` is present. |
| `app/capture/[code]/page.tsx` | **changed** | Accept a bound scoped session as authorization (alternative to `isValidSlug`); thread the session's `instructorName` into capture. |
| course-scoped API routes | **changed (shared helper)** | Where they call `isValidSlug(slug)`, also accept a bound scoped session via a shared `authorizeCourseWrite(req, code, slug)` helper. |
| `app/view/[code]/okf/route.ts`, `app/view/[code]/okf-bundle/route.ts`, `app/view/[code]/page.tsx` | **changed** | Read gate becomes the shared `isCourseReadableBy(req, course)` helper (= `isProgramVisible(course)` OR a bound scoped session for `course.code`). |
| `/admin` grant UI + `app/api/admin/sandbox-grants/route.ts` | **new** | Operator mint/list/revoke; shows the shareable link; "create sandbox course + mint link" convenience. |

## Data model

```
sandbox_grants
  id           uuid pk
  token        text unique not null         -- random URL token (the link)
  course_code  text not null fk → courses.code (on delete cascade)
  label        text                          -- operator note ("UGA pilot — Dr. Lee")
  created_at   timestamptz not null default now()
  expires_at   timestamptz not null          -- default now()+30d at mint
  active       boolean not null default true
  revoked_at   timestamptz                   -- set on revoke

sandbox_sessions
  id              uuid pk
  grant_id        uuid not null fk → sandbox_grants.id (on delete cascade)
  course_code     text not null               -- denormalized from the grant for fast checks
  instructor_name text not null               -- self-entered; becomes snapshot.instructor_name
  created_at      timestamptz not null default now()
  expires_at      timestamptz not null         -- now()+24h
```

A grant is **valid** iff `active && revoked_at IS NULL && expires_at > now()`. A session is **valid** iff `expires_at > now()` and its grant is still valid.

## Authorization — the two predicates (`lib/sandbox/access.ts`)

**`resolveScopedSession(req): { courseCode, instructorName } | null`** — read the `gc_sandbox_sess` cookie, `lookupScopedSession`, re-check the grant is still valid; return the bound course + name or null. Used by everything below; this is the *only* path that grants external access.

1. **Write/capture access** — `authorizeCourseWrite(req, code, slug)`: returns true if `isValidSlug(slug)` (faculty; Basic Auth already enforced by middleware) **OR** a scoped session whose `courseCode === code`. Used by the capture page and every course-scoped API in place of the bare `isValidSlug` check.
2. **Read access** — `isCourseReadableBy(req, course)`: `isProgramVisible(course) || resolveScopedSession(req)?.courseCode === course.code`. Used by `/view`, `/okf`, `/okf-bundle`.

**Middleware** gains, before the Basic-Auth block: if the path is `/capture/<c>` or `/api/courses/<c>/*` (extract `<c>` = `decodeURIComponent` of the segment) **and** `resolveScopedSession(req)?.courseCode === c`, `return NextResponse.next()` (skip Basic Auth). Otherwise the existing gate runs unchanged. The course-segment match is exact — a session for `GC X` never opens `GC Y` or a non-course path.

## Entry flow (`/sandbox/[token]`)

1. `GET /sandbox/<token>` (public): `getGrantByToken` → if invalid/expired/revoked, render a friendly "this link is no longer valid" page (200, no existence leak beyond "expired/invalid").
2. If a valid scoped session already exists for this grant's course → redirect to `/capture/<course>`.
3. Else render a minimal form: **name** + **institution** → `POST /sandbox/<token>/start`.
4. `POST …/start`: re-validate grant, `createScopedSession({ grantId, courseCode, instructorName: \`${name}, ${institution}\` })`, set the `gc_sandbox_sess` cookie (httpOnly, sameSite=lax, 24h), redirect to `/capture/<course>`.

The capture page reads the scoped session's `instructorName` and uses it as the capture identity (the faculty path keeps its existing instructor handling).

## Operator UI + API

- `/admin` panel: a "Sandbox access" section — pick (or create) a sandbox course (`scope=external`, `status=sandbox`), optional label, **Mint link** → shows the full `…/sandbox/<token>` URL to copy. A list of active grants with course, label, expiry, last-used, and a **Revoke** button.
- `app/api/admin/sandbox-grants/route.ts`: `POST` mint (faculty Basic Auth — it's an `/admin` surface), `GET` list, `DELETE`/`PATCH` revoke. Token = `crypto.randomUUID()`-derived (URL-safe, ≥ partner-token entropy).
- "Create sandbox course + mint link" convenience: if the operator names a not-yet-existing course, create it `external`/`sandbox` first (reuses the scope-model columns), then mint.

## What is explicitly UNCHANGED

- The faculty auth path (middleware Basic Auth + `isValidSlug`) — untouched; `authorizeCourseWrite` keeps the slug branch.
- `isProgramVisible` and every program rollup — untouched; scoped sessions never touch them.
- The partner-session machinery (`/partners`) — untouched; this is a parallel, sibling mechanism (separate tables, separate cookie).
- Capture pipeline, snapshots, OKF serializers, scope columns — reused as-is.

## Error handling / edge cases

- Invalid/expired/revoked token → friendly entry page; expired *session* but valid grant → re-show the name form (re-mint).
- Scoped session requesting any non-granted path → falls through to Basic Auth → 401/opaque 404 (no leak).
- Grant's course flipped away from `sandbox` (e.g., operator promotes it) → `isCourseReadableBy` then relies on `isProgramVisible`; capture write still allowed by the session until expiry (acceptable; revoke to cut off).
- **Known v1 gap:** capture-surface actions that call **admin** endpoints (e.g. the "Index now" button → `POST /api/admin/v2-backfill`, an existing debt item) are NOT course-scoped, so a scoped tester can't use them. Documented, deferred — the core capture/import/interview/approve/bundle path does not depend on them.

## Testing

- **`lib/sandbox/grants` + `sessions`:** create/lookup/expire/revoke; a session is invalid once its grant is revoked or expired.
- **`access.ts` (the security core):** `authorizeCourseWrite` true for faculty slug, true for a session bound to the same course, **false** for a session bound to a *different* course and for no-auth; `isCourseReadableBy` true for program-visible, true for a bound session, false otherwise; the path→course extractor handles `%20`-encoded codes and rejects non-course paths.
- **Middleware:** a bound scoped session skips Basic Auth for *its* `/capture/<c>` and `/api/courses/<c>/x`, but a request for `/capture/<other>`, `/program`, `/admin`, or `/api/courses/<other>/x` with that same session still demands Basic Auth (401). These are the load-bearing isolation assertions.
- **Entry route:** invalid token → friendly page; valid token + form POST → session cookie set + redirect to `/capture/<course>`.
- **Read routes:** `/view/<sandbox>/okf-bundle` → 404 without a session, 200 with a bound session; `/view/<other-sandbox>/okf-bundle` → 404 even with a session bound to a different course.
- **Admin API:** mint returns a token; revoke invalidates it (a session check then fails).
- **Full suite** green; `tsc` clean.

## Relationship to the arc

Sub-project 4 of 4 — the capstone. With it, external testing is usable end-to-end: operator mints a link → tester captures *their* course in isolation → downloads the OKF bundle (sub-project 3) → the GC program record never sees it (scope model, sub-project 1), and the tester can bring content in via `.imscc` (sub-project 2) without our Canvas. Deferred beyond v1: per-tester named grants, multi-course grants, and the capture-surface admin-endpoint gap noted above.
