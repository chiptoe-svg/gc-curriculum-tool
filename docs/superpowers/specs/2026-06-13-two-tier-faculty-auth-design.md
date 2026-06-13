# Two-Tier Faculty Basic Auth — Design

**Date:** 2026-06-13
**Status:** approved design (operator brainstorm 2026-06-13), pre-plan
**Origin:** Operator: `gcfaculty/godfrey` should be able to edit any listed course and create new courses (full access — today's behavior); a second credential `cufaculty/tigers` should be able to create a new course and view others, but **not** edit existing courses.

## Decisions made in the brainstorm (2026-06-13)

1. **Two roles, two credentials.** `faculty` (full) and `creator` (create-only). Each is a single shared Basic-Auth credential — this adds a *tier*, not per-user identity. No SSO/magic-link/per-user accounts (that remains the deferred real-auth work).
2. **Creator view scope = public surfaces only.** A creator authenticates *only* to reach the add-course form. "Viewing others" happens on the already-public landing (`/`) and `/view/<code>` profiles, same as anyone on the LAN. The creator role is **not** granted read access to any authenticated faculty surface.
3. **After a creator creates a course → an inline "Course added" confirmation** with a link to the new course's public `/view/<code>` page. (Faculty keep today's redirect into `/capture/<code>`.)
4. **Creator gets single-add only.** The bulk "preload all from sheet" mode stays faculty-only (a roster-admin operation).
5. **Enforcement is allowlist (default-deny) for the weaker role.** A creator is allowed exactly the create paths; everything else faculty-gated is denied. Any faculty route added in the future is automatically denied to creators unless explicitly added — chosen over denylisting edit paths (which risks missing one).

## Credentials → roles

- `FACULTY_BASIC_AUTH=gcfaculty:godfrey` → role **faculty** (full: edit any course + create). **Unchanged** — same env var, same meaning.
- **New** `CREATE_ONLY_AUTH=cufaculty:tigers` → role **creator** (create only).
- Back-compat: if `CREATE_ONLY_AUTH` is unset, behavior is exactly today's (only `faculty` exists). If `FACULTY_BASIC_AUTH` is unset, the whole Basic-Auth gate no-ops as it does today (the creator role only matters when the gate is on).
- Both credentials share the **same** Basic-Auth realm (`GC Curriculum Tool - Faculty`); the browser sends whichever the user typed, and the server resolves which role it is.

## `lib/auth/basic-auth.ts` — two new pure helpers

```
resolveRole(authorizationHeader: string | null | undefined): 'faculty' | 'creator' | null
```
Decodes the `Authorization: Basic <b64>` header once (reusing the existing decode logic), exact-matches the decoded `user:password` against `FACULTY_BASIC_AUTH` then `CREATE_ONLY_AUTH`, and returns the matching role — or `null` if no/garbage header or no match. `faculty` is checked first so an (unlikely) duplicate credential resolves to the stronger role deterministically. Reads the env vars at call time (same pattern as the existing `expected` lookup in middleware).

```
creatorAllowed(pathname: string, method: string): boolean
```
Pure path/method allowlist for the creator role. Returns `true` only for:
- `GET /courses/new` (the add-course form page), and
- `POST /api/admin/courses/roster` (the create API; the mode restriction is enforced in the route, see below).

Everything else returns `false`. (Paths already public — `/`, `/view`, the other `PUBLIC_PREFIXES` — never reach this check because `requiresBasicAuth` already short-circuits them.)

The existing `authorizedForBasicAuth(header, expected)` and `requiresBasicAuth(path)` are unchanged; `resolveRole` supersedes the single-credential check inside middleware.

## Middleware enforcement (`middleware.ts`)

When `FACULTY_BASIC_AUTH` is set and `requiresBasicAuth(path)`:

1. `role = resolveRole(req.headers.get('authorization'))`
2. `null` → **401** with the `WWW-Authenticate: Basic` challenge (today's behavior — prompt for credentials).
3. `faculty` → allow (`NextResponse.next()`) — unchanged from today.
4. `creator` → allow iff `creatorAllowed(path, req.method)`; otherwise **403** (`Forbidden`). A creator is authenticated and will never have stronger credentials, so a 403 (not a 401 re-prompt) is the correct response on an edit surface.

No request-header injection is needed: the API route re-resolves the role independently from the `Authorization` header the browser sends on every same-origin request.

## Roster route mode-guard (`app/api/admin/courses/roster/route.ts`)

The route keeps its existing `checkAdminAuth(req, { slug })` gate. Add a role check after parsing the body:
- `resolveRole(req.headers.get('authorization'))`
- if role === `creator` and `mode === 'bulk'` → **403** (`{ error: 'create-only role cannot bulk-preload' }`).
- `mode === 'one'` is allowed for both roles; `faculty` is unrestricted.

This is defense-in-depth behind the middleware allowlist: middleware already only lets a creator reach this route, and the route additionally refuses the bulk mode.

## Role-aware create page + redirect

- `app/courses/new/page.tsx` (server component) resolves the role via `headers()` from `next/headers` and passes a `canCapture: boolean` prop to `NewCourseForm` (`faculty` → `true`, `creator` → `false`). The existing `isValidSlug(slug)` access-link gate is untouched and still applies.
- `app/courses/new/NewCourseForm.tsx` (client) on a successful create:
  - `canCapture === true` → `router.push('/capture/<code>?slug=...')` (today's behavior).
  - `canCapture === false` → render an inline **"Course added"** success state naming the course code + title, with a link to the public `/view/<code>` page and a "Add another" reset. No navigation into `/capture`.
- The form fetches nothing on load, so no additional endpoint needs allowlisting for the creator.

## What is explicitly UNCHANGED

- The single `FACULTY_BASIC_AUTH` var keeps its name and meaning (the full-access credential).
- `requiresBasicAuth` / `PUBLIC_PREFIXES` / the partner magic-link path / the slug gate.
- All edit surfaces and their behavior for the `faculty` role.
- The `/api/admin/courses/roster` create logic itself (`createCourse` / `bulkCreateCourses`).

## Out of scope (deferred / non-goals)

- Per-user identity, SSO, or magic-link faculty auth — still the deferred real-auth work. This is two shared credentials mapped to two roles; you cannot attribute an action to a person or revoke one person without rotating the shared secret.
- Per-course edit ownership ("only the instructor of record may edit GC X"). The `faculty` role can edit *any* course, as today.
- More than two roles, or a general credential→role config format (YAGNI — two fixed roles).
- Granting the creator role any authenticated read access (matrix/roster/wiki). Creators view via the public surfaces only.

## Testing

- **Pure unit (`lib/auth/basic-auth.ts`):** `resolveRole` — faculty cred → `faculty`, creator cred → `creator`, no header / garbage / non-matching → `null`, env-unset cases. `creatorAllowed` — the two allowed (`GET /courses/new`, `POST /api/admin/courses/roster`) true; a representative denylist (`/capture/GC 1040`, `/program`, `/explore/...`, `/settings`, `/api/admin/courses/GC 1040` PATCH) false.
- **Middleware integration:** no creds → 401; faculty → 200 on an edit surface and on create; creator → 403 on `/capture/*`, `/program`, `/explore/*`, `/settings`; creator → 200 on `GET /courses/new`.
- **Route:** creator `mode:'one'` → succeeds; creator `mode:'bulk'` → 403; faculty `mode:'bulk'` → succeeds.
- **Page/form:** `canCapture=false` success → confirmation state + `/view/<code>` link, no `/capture` push; `canCapture=true` → `/capture` push (unchanged).

## STATE.md

Record the new `CREATE_ONLY_AUTH` env var and the two-tier auth model under the auth/deployment surface and env-var list (a tracked trigger). Note that it is back-compatible (unset = today's single-credential behavior) and that this is role-tiering, not per-user identity (the real-auth deferral still stands).
