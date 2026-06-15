# External-Access Scoped Link — Design

**Date:** 2026-06-15
**Status:** approved design (operator brainstorm 2026-06-15), pre-plan
**Origin:** Sub-project **4 of 4** of the external-university-testing arc — the piece that ties the others together. (1) course scope & lifecycle, (2) IMSCC import, (3) OKF bundle export are shipped. This adds the **operator-minted scoped link** that lets one outside tester self-serve **capture + view + bundle** for *one sandbox course*, fully isolated from the GC program record. It closes the loop the scope model left open: a sandbox course is invisible everywhere (`isProgramVisible` = false → opaque 404 on `/view`/`/okf`/`/okf-bundle`); this is the *selective* grant that opens that one course to that one tester.

## AMENDMENT (2026-06-15, post-deploy) — generic invite + tester-creates-course

The first build shipped a **course-bound** grant (operator picks the course at mint time). That's backwards for external testing: the operator doesn't know the tester's course. Superseded by this front-door redesign (the **security model below is unchanged** — same two gates, allowlist, `authorizeCourseWrite`, `isCourseReadableBy`, slug-leak protection; only the mint/entry/course-creation changes):

- **Generic invite grant.** The operator mints a link with just a **label + expiry — no course**. `sandbox_grants.course_code` becomes **nullable** (unused for generic invites). Mint UI drops the course-code input.
- **Tester creates their course at the link.** `/sandbox/[token]` collects **course code + title + name**. On submit, the system **creates a sandbox course** (`scope='external'`, `status='sandbox'`) with a **namespaced, generated internal code** (`EXT-<rand>`, collision-proof — never touches a real GC course); the tester's entered code+title become the course's **display label** (`courses.title`), and their name is the `instructor_name`. The scoped session binds to the generated `EXT-…` code; redirect to `/capture/<EXT-…>`.
- **Operator visibility = a list + full results.** Two parts: **(a) discovery** — `/admin` (faculty-gated, alongside the mint panel) lists the **created sandbox courses** (display title, tester name, capture status, date) each with **Review** (`/capture/<EXT-…>?slug=`) and **View profile** (`/view/<EXT-…>?slug=`) links. (They also appear in the faculty `/courses` "External / sandbox" section.) **(b) full results** — `isCourseReadableBy` gains a **faculty-slug override**: `isProgramVisible(course) || boundSession || isValidSlug(<query slug>)`, so the operator can open the rendered `/view` profile + download the `/okf-bundle` for any sandbox course by appending their own `?slug=` (the same way the faculty slug is used on every other faculty surface — the operator HAS it; only **testers** must never see it, which is unchanged). The tester's own access stays via their session; no slug ever reaches them.
- **Unchanged:** the entire least-privilege security model (Decision 6 + the two-gate authorization), the OKF bundle / IMSCC / scope-model integration, the 24h session / 30-day grant lifecycle. A session is still bound to exactly one course (now a tester-created one) and isolated identically.

Decisions 1–2 below are superseded by this amendment (identity is still self-entered name; the link is now course-*less* until the tester defines their course).

## Decisions made in the brainstorm (2026-06-15)

1. **Access scope:** full self-serve — the link opens the whole CourseCapture flow (`/capture/<course>` + its APIs: materials upload, `.imscc` import, interview, approve) **and** the read surfaces (`/view/<course>`, `/okf`, `/okf-bundle`) for the one sandbox course.
2. **Identity:** anonymous link **bound to the course** (no per-tester pre-registration). On first use the tester enters **name + institution**, which becomes the capture snapshot's `instructor_name`.
3. **Mechanism: a scoped session bound to one course** (the shipped partner-session pattern). Middleware **skips Basic Auth** for the bound course's allowed paths; each such route/page authorizes via **`authorizeCourseWrite`** (`isValidSlug(slug)` OR a scoped session bound to that course — the session cookie is the credential). **The faculty `slug` is NEVER injected/materialized for a scoped tester** — it's a *client-exposed* credential (the capture page serializes `slug` into `CaptureClient` props + fetch URLs), so injecting it would leak the faculty master secret to the tester and into request URLs/logs. (A middleware slug-injection variant was tried and **reverted during the security review** for exactly this leak + because it missed body-read slug routes.) Rejected alternatives: per-course-slug (churns the faculty model, leaks tokens) and a separate `/sandbox/.../capture` app tree (duplicates routing).
4. **Mint location:** `/admin`.
5. **Lifecycle:** grants are **reusable** (capture is multi-session) until a **30-day** expiry or operator **revoke**; scoped session TTL **24h** (re-opening the link re-mints).
6. **Security posture (load-bearing) — least privilege.** A scoped session opens **only its one sandbox course's**:
   - `/capture/<c>` (the page) + `/view/<c>` + `/okf` + `/okf-bundle` (read);
   - the **entire `/api/capture/<c>/*` namespace** (the capture engine — chat, scores, snapshots, context, conversation, reconcile, stress-test, messages, chunks, merge-prereq-gap — all course-scoped, none institution-bound);
   - an **allowlist** under `/api/courses/<c>/`: `materials`, `imscc-import`, `kuds`, `scan-linked-docs`, `checkin`, `analyze-materials`, `parse-profile`.

   **Explicitly blocked**, even for the bound course: `/api/courses/<c>/canvas-import` + `canvas-reextract` (authenticate against *Clemson's* Canvas — useless/inapplicable to an external tester; IMSCC is their content path), `/api/courses/<c>/sync-from-sheet` (GC Google-Sheet catalog — a sandbox course has no tab), and the **bare course resource** `/api/courses/<c>` (PATCH/DELETE — a tester must never edit the course's scope/status or delete it). Every other surface (`/program`, `/explore`, `/admin`, `/ask`, `/wiki`, `/settings`, any *other* course) stays Basic-Auth-gated → opaque 404/401.

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
| `lib/sandbox/access.ts` | **new** | The security boundary, in one place: `resolveScopedSession(req)`, `courseFromScopedPath(pathname)` (extract `<c>` + decide whether the path is in the bound session's allowed set), and `isCourseReadableBy(req, course)`. |
| `app/sandbox/[token]/page.tsx` | **new** | Public entry: validate grant → name form (first use) → mint session → redirect to `/capture/<course>`. |
| `app/sandbox/[token]/start/route.ts` | **new** | `POST` handler the name form submits to (mints the session cookie, redirects). |
| `middleware.ts` | **changed** | Add `/sandbox` to `PUBLIC_PREFIXES`; before the faculty Basic-Auth gate, for a bound scoped session on an **allowed** path (per `courseFromScopedPath`), `NextResponse.next()` — skip Basic Auth (no slug injection). All blocked/other paths fall through to Basic Auth unchanged. |
| `app/capture/[code]/page.tsx` | **changed** | Accept a bound scoped session as authorization (alternative to `isValidSlug`); pass an **empty** `slug` to `CaptureClient` for a scoped tester so the faculty secret is never serialized to their browser. |
| ~22 course-scoped API routes (`/api/capture/<c>/*` + allowlisted `/api/courses/<c>/*`) | **changed (uniform)** | Replace the bare `isValidSlug(slug)` gate with `authorizeCourseWrite(req, code, slug)` — accepts the faculty slug OR a bound scoped session. Slug-location-independent (query or body), so uploads work and nothing leaks. |
| `app/api/capture/[code]/snapshots/route.ts` | **changed (1 line)** | When a scoped session is present, use its `instructorName` for the snapshot (the only spot the tester's self-entered identity must reach). Faculty path unchanged. |
| `app/api/courses/[code]/imscc-import/route.ts` | **changed** | **Exception:** this route is *excluded from the middleware matcher* (body-replay fix) and enforces its own Basic Auth, so middleware injection can't reach it. Add a direct check: accept a scoped session bound to `<code>` as an alternative to Basic-Auth+slug (via `resolveScopedSession`). The one allowlisted route that needs an in-route edit. |
| `app/view/[code]/okf/route.ts`, `app/view/[code]/okf-bundle/route.ts`, `app/view/[code]/page.tsx` | **changed** | Read gate becomes `isCourseReadableBy(req, course)` (= `isProgramVisible(course)` OR a bound scoped session for `course.code`) — these are `/view` public-prefixed routes, so middleware doesn't gate them; the scope check lives in the route. |

> Each allowlisted route + the capture page gains the `authorizeCourseWrite` gate (a uniform 2-line swap from the bare `isValidSlug` check). The faculty (Basic-Auth + slug) path is unchanged — `authorizeCourseWrite` returns true for a valid slug, so existing faculty tests stay green. `imscc-import` (matcher-excluded) accepts the session directly via the same `resolveScopedSession` check.
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

## Authorization — `lib/sandbox/access.ts` (the one place the boundary lives)

- **`resolveScopedSession(req): { courseCode, instructorName } | null`** — read the `gc_sandbox_sess` cookie, `lookupScopedSession`, re-check the grant is still valid; return the bound course + name or null. The *only* path that grants external access.
- **`courseFromScopedPath(pathname): string | null`** — returns the course code a scoped session would need to be bound to for this path to be allowed, or `null` if the path is never scoped-accessible. Allowed shapes (with `<c> = decodeURIComponent` of the segment):
  - `/capture/<c>`
  - `/api/capture/<c>/…` (any sub-path — the whole capture engine)
  - `/api/courses/<c>/<seg>/…` where `<seg> ∈ { materials, imscc-import, kuds, scan-linked-docs, checkin, analyze-materials, parse-profile }`
  - **returns `null`** for `<seg> ∈ { canvas-import, canvas-reextract, sync-from-sheet }`, for the bare `/api/courses/<c>`, and for everything else.
- **`authorizeCourseWrite(req, code, slug): boolean`** — `isValidSlug(slug) || resolveScopedSession(req)?.courseCode === code`. The per-route gate: faculty slug OR a session bound to exactly this course. Replaces the bare `isValidSlug` check in every allowlisted route + the capture page. Slug-location-independent.
- **`isCourseReadableBy(req, course): boolean`** — `isProgramVisible(course) || resolveScopedSession(req)?.courseCode === course.code`. Used by `/view`, `/okf`, `/okf-bundle`.

**Middleware**, before the Basic-Auth block:
```
const scopedCourse = courseFromScopedPath(path);
if (scopedCourse) {
  const sess = await resolveScopedSession(req);
  if (sess && sess.courseCode === scopedCourse) {
    return NextResponse.next();   // skip Basic Auth; the route/page authorizes via authorizeCourseWrite
  }
}
// else: existing faculty Basic-Auth gate runs unchanged
```
The match is exact on both the path's allowed-ness **and** the course code — a session for `GC X` never opens `GC Y`, a blocked route, or a non-course path. **No slug is injected** — the session cookie is the credential, so the faculty secret is never placed in a URL (logs) or forwarded to the tester's client.

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
- **`access.ts` (the security core):** `courseFromScopedPath` returns `<c>` for `/capture/<c>`, `/api/capture/<c>/snapshots`, and each allowlisted `/api/courses/<c>/<seg>`; returns **`null`** for `/api/courses/<c>/canvas-import`, `/canvas-reextract`, `/sync-from-sheet`, the bare `/api/courses/<c>`, `/program`, `/admin`, and any non-course path; handles `%20`-encoded codes. `isCourseReadableBy` true for program-visible, true for a bound session, false otherwise.
- **Middleware (load-bearing isolation):** with a session bound to `GC X` — the request is rewritten (slug injected) for `/capture/GC%20X`, `/api/capture/GC%20X/scores`, `/api/courses/GC%20X/materials`; but **falls through to Basic Auth (401)** for `/api/courses/GC%20X/canvas-import` (blocked route), `/capture/GC%20Y` (other course), `/api/courses/GC%20Y/materials`, `/program`, and `/admin`.
- **Entry route:** invalid token → friendly page; valid token + form POST → session cookie set + redirect to `/capture/<course>`.
- **Read routes:** `/view/<sandbox>/okf-bundle` → 404 without a session, 200 with a bound session; `/view/<other-sandbox>/okf-bundle` → 404 even with a session bound to a different course.
- **Admin API:** mint returns a token; revoke invalidates it (a session check then fails).
- **Full suite** green; `tsc` clean.

## Relationship to the arc

Sub-project 4 of 4 — the capstone. With it, external testing is usable end-to-end: operator mints a link → tester captures *their* course in isolation → downloads the OKF bundle (sub-project 3) → the GC program record never sees it (scope model, sub-project 1), and the tester can bring content in via `.imscc` (sub-project 2) without our Canvas. Deferred beyond v1: per-tester named grants, multi-course grants, and the capture-surface admin-endpoint gap noted above.
