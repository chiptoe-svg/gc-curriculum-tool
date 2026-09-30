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

**Built-in grants** (never rows): `FACULTY_BASIC_AUTH` → `{scope: ['*'], can: ['capture','create','admin']}`; `CREATE_ONLY_AUTH` → `{scope: [], can: ['create']}`. `PROTOTYPE_SLUG` is **not** a grant (amended 2026-09-30): it is only the value that satisfies the page-level `isValidSlug` checks.

**Session cookie** `gc_session` = `<grant id>.<base64url HMAC-SHA256(grant id, SESSION_SECRET)>`; `HttpOnly; Secure; SameSite=Lax; Path=/`; max-age = remaining grant lifetime capped at 30 days. Carries no scope — the row is read on every request, so revocation and scope changes are immediate. Built-in grants use fixed ids (`builtin:faculty`, `builtin:creator`).

**New env var** `SESSION_SECRET` (≥ 32 random bytes). Fail-closed: unset → no cookie ever validates or is issued; magic links and Basic Auth still authorize the single request they arrive on.

## Middleware flow (faculty branch of `middleware.ts`; partner branch unchanged)

Step 2.1 (magic-link exchange) runs on **every** path, public ones included — the link is `https://…:8443/?key=…`, and `/` is public. Steps 1, 2.2–2.4, 3 and 4 run only for gated paths (not in `PUBLIC_PREFIXES`):

1. Cleartext interstitial — unchanged, first.
2. Resolve a grant, first match wins:
   1. `?key=` on **any non-`/api/` path, GET/HEAD only**: hash → look up → live → **set cookie, 302 to the same URL with `key` removed**, the redirect built from `PUBLIC_HTTPS_ORIGIN` (falling back to the request URL) so it lands on the public origin behind the proxy. On a public path a dead key — or a DB failure during the lookup — is simply ignored (`next`; the page is public anyway). `?key=` on `/api/*` or on a non-GET method is ignored (keys are for top-level navigation; a 302 on a POST would drop the body).
      **`?slug=` is NOT a credential and is never exchanged** (amended 2026-09-30 after Task 5 review). It never was one: the app has always required Basic Auth *alongside* the slug. Existing `?slug=` links therefore keep working exactly as before — Basic Auth (now setting a cookie) or a session cookie authorizes; the slug only satisfies the page-level checks. Consequence: the value the middleware injects for those checks (step 4) grants nothing by itself, so exposing it to a scoped user is harmless. The department-wide grant is reachable only through Basic Auth or a minted `*` link.
   2. `gc_session` cookie: verify HMAC → load row → live → use. Invalid/dead → clear cookie, fall through.
   3. `Authorization: Basic` → built-in grant → also set cookie.
   4. None → **401**, `WWW-Authenticate: Basic realm="GC Curriculum Tool - Faculty"`, body: a plain page — "Faculty: sign in with your access link, or the department login. Students and visitors: the course pages and wiki need no login."
3. `authorize(grant, method, pathname)` → allow, or **403** page naming the grant label and the course ("This link can edit GC 3730 only").
4. If a page request (not `/api/*`) lacks `?slug=`, `NextResponse.rewrite` with `?slug=<PROTOTYPE_SLUG>` appended (internal; browser URL unchanged) so existing page checks pass.

Cost: one DB read per gated request (as the partner path today).

## Scope table — `authorize()` (pure, no I/O)

(Table amended 2026-09-30 after the final review — see *Amendments — 2026-09-30 final review* below. It mirrors `classify()` rule for rule, in evaluation order; trailing slashes are stripped first.)

A **course code** below means the path segment right after a course prefix (`/api/capture/`, `/api/courses/`, `/api/explore/`, `/api/admin/courses/`) that, after **one** percent-decode and with **no** normalisation (no trim, no whitespace collapse, no case-fold), matches `^(?:[A-Z]{2,4} \d{4}[A-Za-z]{0,2}|EXT-[0-9a-f]{8})$`. A segment that fails to decode or to match is not a course code.

| # | Kind | Recognised by | Requires |
|---|---|---|---|
| 1 | Read | `GET`/`HEAD` on any gated page or API **outside the admin surface** (`/admin`, `/admin/**`, `/api/admin/**`) — incl. `/program`, `/explore/*`, `/courses`, `/ask`, `/api/ask*`, `/board/*` | any live grant |
| 2 | Read | `GET`/`HEAD` on the admin surface only at `/api/admin/courses/roster` or `/api/admin/courses/<course code>/**` (course data) | any live grant |
| 3 | Admin | every other `GET`/`HEAD` on the admin surface (`/admin`, `/admin/partners`, `/api/admin/sandbox-grants`, `/api/admin/partners`, `/api/admin/courses/intended-skills`, …) | scope `*` ∧ `admin` |
| 4 | Read | any method on `/api/ask`, `/api/ask/**`, `/api/flags`, `/api/feedback` (exact; `/api/flags/<id>` is not included) | any live grant |
| 5 | Create | `POST /courses/new`, `POST /api/admin/courses/roster` (the existing `creatorAllowed` list) | `create` |
| 6 | Admin | non-GET on `/api/admin/courses/roster/**` (bulk) | scope `*` ∧ `admin` |
| 7 | Course write | non-GET on `/api/capture/<course code>/**`, `/api/courses/<course code>/**`, `/api/explore/<course code>/**`, `/api/admin/courses/<course code>/**`; the code is upper-cased for the scope comparison | `capture` ∧ (code ∈ scope or scope `*`) |
| 8 | Admin / unclassified | **anything not matched above** — including non-GET under a course prefix whose segment is not a course code (`/api/admin/courses/intended-skills`, `GC%203730%20`, `gc%203730`, `GC3730`), `/api/program/**` writes, `/api/settings`, `PATCH /api/flags/<id>` | scope `*` ∧ `admin` |

Rules: the **real HTTP method only** (override headers ignored); the **path is the source of truth** for the course (handlers already trust it); **default-deny** — unmatched gated writes are admin-only; **capabilities are always required** — scope `*` widens *which courses*, never *what* may be done (amended 2026-09-30 after Task 1 review: the first draft let `*` bypass `capture`/`create`).

## Scripts (`scripts/access/`, run with the deploy env; `pnpm access:*`)

- `grant <label> --courses "GC 3730[,…]|*" --can capture[,create,admin] (--days N | --no-expiry)` → prints the link once. Refuses unknown course codes; `admin` requires `*`.
- `list` → short id · label · scope · can · expires · last used · status. Never tokens.
- `revoke <id>`.
Lost link = revoke + grant.

## Errors

- Expired/revoked cookie → cleared, then the normal 401 page.
- Expired/revoked `?key=` → on a gated path, falls through to cookie/Basic and otherwise the 401 page; on a public path, ignored (no cookie set).
- With `SESSION_SECRET` unset, a valid `?key=` on a gated page authorizes that request but cannot be stripped (no cookie to carry the session), so the token remains in the URL — a known exposure, acceptable only in development; production must set the secret (recorded in STATE.md Deferred/debt).
- `touchLastUsed` failures never affect the response (fire-and-forget, including synchronous throws).
- Tampered cookie (bad HMAC) → treated as absent.
- DB unavailable → 503 for gated paths (fail closed); public paths unaffected, including a public path carrying a `?key=` (the key is ignored).

## Testing

- `authorize()`: table-driven, red-first; every course route × matching / non-matching code; encoded and double-encoded codes; `GC 1010` vs `GC1010`; trailing slash; method-override header ignored; unclassified write → admin-only; read allowed for a course-scoped grant on other courses.
- Middleware: each resolution path (key → cookie + clean redirect; cookie valid / expired / revoked / tampered; Basic → cookie; none → 401); slug rewrite is internal; `SESSION_SECRET` unset → no cookie.
- Scripts: grant/list/revoke on a scratch DB; unknown code refused; `admin` without `*` refused.
- Live proof after deploy: mint a one-course link; from a fresh browser: front page and that course's capture page open; a write to another course's API → 403; revoke → next request 401.

## Rollout

Migration + `SESSION_SECRET` (`.env.local`, `.env.example`), deploy without sudo (`pnpm build && kickstart`), live proof, then issue the first real link. STATE.md: new table, env var, auth-model change, and the deferred slug-check cleanup. The shared password and existing slug links continue to work throughout.

## Files

`middleware.ts` (faculty branch), new `lib/auth/grants.ts` (lookup, cookie sign/verify, built-ins), new `lib/auth/authorize.ts` (pure scope table), `lib/db/schema.ts` + one migration, `scripts/access/{grant,list,revoke}.ts`, tests under `tests/auth/`. No page or API route is edited.

## Amendments — 2026-09-30 final review

The final whole-branch review found one critical and three important gaps. The rulings below are part of this design; the scope table above has been rewritten to match `classify()` exactly.

**C1 — the admin surface is not part of "everything readable".** "Everything readable" was too broad: `/admin/partners` renders partner magic links and `GET /api/admin/sandbox-grants` returns raw tokens. `GET`/`HEAD` on `/admin`, `/admin/**` and `/api/admin/**` is admin-kind (scope `*` ∧ `admin`), with two carve-outs that keep their read kind: course data at `/api/admin/courses/<course code>/**` and the roster create path `/api/admin/courses/roster`. A scoped grant, and the create-only built-in, get 403 there; the department built-in is unaffected.

**I1 — built-in sessions are bound to the credential they were minted from.** A built-in grant's id is `builtin:<faculty|creator>:<fp>`, `fp` = the first 16 hex of HMAC-SHA256 keyed by `SESSION_SECRET` over the Basic credential (tail round: keyed rather than a bare sha256, so a leaked cookie cannot be used to crack a low-entropy shared password offline; mint and verify use the same secret, and with `SESSION_SECRET` unset no cookie exists to fingerprint). On every request the gate recomputes the fingerprint from the **current** `FACULTY_BASIC_AUTH` / `CREATE_ONLY_AUTH`; if that variable is unset or the fingerprint differs, the cookie is dead (cleared, 401 unless Basic is also presented). Rotating the shared credential therefore revokes its cookies immediately, restoring the pre-cookie meaning of "rotate the password". Cookies in the old fingerprint-less shape are dead.

**I2 — only a strictly-shaped course code makes a course path.** The segment after a course prefix is a course code only if, after one percent-decode and with **no** normalisation, it matches `^(?:[A-Z]{2,4} \d{4}[A-Za-z]{0,2}|EXT-[0-9a-f]{8})$`. Anything else under `/api/capture/`, `/api/courses/`, `/api/explore/` or `/api/admin/courses/` (other than the roster create path) is admin-kind — so `POST /api/admin/courses/intended-skills` (the bulk seeding job) needs `admin`, and `GC%203730%20` (trailing space), `gc%203730` and `GC3730` fail closed rather than being trimmed or case-folded into a real code. The review proposed `[A-Z]?` for the suffix; it was widened to fit the live `courses.code` data (2026-09-30: `GC 4900ap`, `GC 4900bl`, `GC 4900or`, `GC 4990ta` carry lower-case two-letter suffixes; `EXT-<8 hex>` is the generated sandbox namespace in `lib/sandbox/courses.ts`). The code is upper-cased only for the scope comparison.

**I3a — `/ask`, flags and feedback are readable.** `/api/ask`, `/api/ask/**`, `/api/flags` and `/api/feedback` are read-kind for any live grant, any method — interaction endpoints without privilege, as "Everything readable, `/ask` included" already promised. `PATCH /api/flags/<id>` (resolving a flag) is not included and stays admin.

**I3b — uploads outside the matcher.** `/api/courses/<code>/materials` and `/api/courses/<code>/imscc-import` are excluded from the middleware matcher (body-replay) and authorize inline through `resolveScopedSession` in `lib/sandbox/access.ts`. That helper now also resolves a `gc_session` cookie (percent-decoded first, as `NextRequest.cookies` does — Next writes `builtin%3Afaculty%3A…`; an undecodable value counts as absent) — on exactly those two paths, for a non-GET that `classify` makes a course write — and runs it through `authorize()`; a pass binds the session to the route's own decoded `[code]`, so a scoped link holder with `capture` on that course can upload, import and bulk-wipe materials. Any failure (no cookie, bad MAC, dead grant, DB error) yields no binding and the route falls back to Basic (fail closed). `/api/transcribe` checks Basic inline with no such hook, so it is **deferred**: scoped link holders cannot transcribe until that route is edited. The "No page or API route is edited" constraint stands.

**Deferred — `?key=` over plain HTTP.** A key sent over cleartext HTTP to a public path (e.g. LAN `:3000/`) is exchanged there; links are minted with the HTTPS origin, so mitigation is deferred and recorded in STATE.md Deferred/debt.
