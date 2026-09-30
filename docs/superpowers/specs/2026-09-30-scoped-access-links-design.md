# Scoped access links — design

**Date:** 2026-09-30 · **Status:** approved in brainstorming, awaiting plan · **Supersedes:** nothing (adds to the auth model in `lib/auth/basic-auth.ts` + `middleware.ts`)

## Problem

Faculty surfaces are gated by two independent mechanisms on every request: HTTP Basic Auth with one shared department password, and a `?slug=` key checked by each of 43 pages. There is no session, so the browser re-prompts on any hiccup and any URL without the slug shows "Access link required" even when authenticated. Access is all-or-nothing (one password for everyone) and revocation means rotating it for everyone. A faculty member (2026-09-29) could not get in at all; the owner, remote, saw a password prompt on the public home page. The sibling alumni app (`gc_alumni/db/review_app.py`) uses one gate with a magic link, a one-time Basic Auth, and a 30-day session cookie, and is experienced as reliable.

## Goals

1. One login per person, then a cookie: no repeated prompts, no slug in every URL.
2. A magic link per person, scoped to specific courses, revocable individually.
3. Nothing in circulation breaks: the shared password and the existing `?slug=` links keep working.
4. Enforcement is a single audited boundary with default-deny for unclassified writes.

## Non-goals (deliberately)

- Per-instructor scope (chosen: per course; the capture snapshot already records the instructor).
- An admin UI for minting (chosen: scripts run by the owner).
- Per-person keys for the wiki MCP bearer (same table can carry them later; not in this change).
- Removing the 43 page-level `isValidSlug` checks (separate cleanup; the middleware satisfies them).
- Campus SSO (separate CCIT track; this design is the bridge until it lands).

## Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Scope granularity | **Per course** — a grant lists roster course codes, or `*`. |
| Program-wide pages for a scoped grant | **Everything readable, `/ask` included**; writes limited to scope. |
| Minting | **Owner-only scripts** (`pnpm access:grant/list/revoke`). |
| Enforcement architecture | **Central in middleware, default-deny**, path-derived course code, per-route helper only for the two create paths already enumerated by `creatorAllowed`. |

## Data model

Table `access_grants` (Drizzle migration; sits beside `partners`, which already holds `magic_token`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | what the session cookie carries |
| `token_hash` | text unique | SHA-256 of a 32-byte base64url token; the token itself is shown once by the grant script and never stored |
| `label` | text | e.g. "Danita Swaney — GC 3730" |
| `scope` | text[] | course codes exactly as in the roster (`GC 3730`), or the single value `*` |
| `can` | text[] | subset of `capture`, `create`, `admin` |
| `expires_at` | timestamptz null | null = no expiry (must be requested explicitly) |
| `revoked_at` | timestamptz null | set by `access:revoke`; checked every request |
| `created_at` | timestamptz | |
| `last_used_at` | timestamptz null | written at most once per hour |

**Built-in grants** (never rows): `FACULTY_BASIC_AUTH` → `{scope: ['*'], can: ['capture','create','admin']}`; `CREATE_ONLY_AUTH` → `{scope: [], can: ['create']}`; `PROTOTYPE_SLUG` presented as `?key=` or `?slug=` → the department-wide grant.

**Session cookie** `gc_session` = `<grant id>.<base64url HMAC-SHA256(grant id, SESSION_SECRET)>`; `HttpOnly; Secure; SameSite=Lax; Path=/`; max-age = remaining grant lifetime capped at 30 days. Carries no scope — the row is read on every request, so revocation and scope changes are immediate. Built-in grants use fixed ids (`builtin:faculty`, `builtin:creator`).

**New env var** `SESSION_SECRET` (≥ 32 random bytes). Fail-closed: unset → no cookie ever validates or is issued; magic links and Basic Auth still authorize the single request they arrive on.

## Middleware flow (faculty branch of `middleware.ts`; partner branch unchanged)

For a request to a gated path (not in `PUBLIC_PREFIXES`):

1. Cleartext interstitial — unchanged, first.
2. Resolve a grant, first match wins:
   1. `?key=` (or legacy `?slug=`): hash → look up (or match built-in) → live → **set cookie, 302 to the same URL with `key`/`slug` removed**.
   2. `gc_session` cookie: verify HMAC → load row → live → use. Invalid/dead → clear cookie, fall through.
   3. `Authorization: Basic` → built-in grant → also set cookie.
   4. None → **401**, `WWW-Authenticate: Basic realm="GC Curriculum Tool - Faculty"`, body: a plain page — "Faculty: sign in with your access link, or the department login. Students and visitors: the course pages and wiki need no login."
3. `authorize(grant, method, pathname)` → allow, or **403** page naming the grant label and the course ("This link can edit GC 3730 only").
4. If a page request (not `/api/*`) lacks `?slug=`, `NextResponse.rewrite` with `?slug=<PROTOTYPE_SLUG>` appended (internal; browser URL unchanged) so existing page checks pass.

Cost: one DB read per gated request (as the partner path today).

## Scope table — `authorize()` (pure, no I/O)

| Kind | Recognised by | Requires |
|---|---|---|
| Read | `GET`/`HEAD` on any gated page or API (incl. `/program`, `/explore/*`, `/courses`, `/ask`, `/api/ask*`, `/board/*`) | any live grant |
| Course write | non-GET where the course code is in the path: `/api/capture/[code]/**`, `/api/courses/[code]/**`, `/api/explore/[code]/**`, `/api/admin/courses/[code]/**`; `[code]` URL-decoded and normalised (`GC%201010` → `GC 1010`) | `capture` ∧ code ∈ scope, or scope `*` |
| Create | `POST /courses/new`, the single-add roster API (the existing `creatorAllowed` list) | `create` or scope `*` |
| Admin / unclassified | any other gated non-GET (`/api/admin/**` bulk, `/api/program/**` writes, `/api/settings`, `/api/flags`, **and anything not matched above**) | scope `*` ∧ `admin` |

Rules: the **real HTTP method only** (override headers ignored); the **path is the source of truth** for the course (handlers already trust it); **default-deny** — unmatched gated writes are admin-only.

## Scripts (`scripts/access/`, run with the deploy env; `pnpm access:*`)

- `grant <label> --courses "GC 3730[,…]|*" --can capture[,create,admin] (--days N | --no-expiry)` → prints the link once. Refuses unknown course codes; `admin` requires `*`.
- `list` → short id · label · scope · can · expires · last used · status. Never tokens.
- `revoke <id>`.
Lost link = revoke + grant.

## Errors

- Expired/revoked cookie → cleared, then the normal 401 page.
- Expired/revoked `?key=` → 401 page (no cookie set).
- Tampered cookie (bad HMAC) → treated as absent.
- DB unavailable → 503 for gated paths (fail closed), public paths unaffected.

## Testing

- `authorize()`: table-driven, red-first; every course route × matching / non-matching code; encoded and double-encoded codes; `GC 1010` vs `GC1010`; trailing slash; method-override header ignored; unclassified write → admin-only; read allowed for a course-scoped grant on other courses.
- Middleware: each resolution path (key → cookie + clean redirect; cookie valid / expired / revoked / tampered; Basic → cookie; none → 401); slug rewrite is internal; `SESSION_SECRET` unset → no cookie.
- Scripts: grant/list/revoke on a scratch DB; unknown code refused; `admin` without `*` refused.
- Live proof after deploy: mint a one-course link; from a fresh browser: front page and that course's capture page open; a write to another course's API → 403; revoke → next request 401.

## Rollout

Migration + `SESSION_SECRET` (`.env.local`, `.env.example`), deploy without sudo (`pnpm build && kickstart`), live proof, then issue the first real link. STATE.md: new table, env var, auth-model change, and the deferred slug-check cleanup. The shared password and existing slug links continue to work throughout.

## Files

`middleware.ts` (faculty branch), new `lib/auth/grants.ts` (lookup, cookie sign/verify, built-ins), new `lib/auth/authorize.ts` (pure scope table), `lib/db/schema.ts` + one migration, `scripts/access/{grant,list,revoke}.ts`, tests under `tests/auth/`. No page or API route is edited.
