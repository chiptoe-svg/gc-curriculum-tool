# Faculty access panel — design

**Date:** 2026-10-07. **Status:** approved by the owner in conversation (design, plus two choices: links never expire by default; an "All courses" option).

## Purpose

Personal access links (scoped grants, `access_grants`, 2026-09-30) are minted today only with `pnpm access:grant`. The owner wants an admin page to manage faculty access: add a person with name, email and courses; see who has access; change courses; replace a lost link; revoke.

## Owner decisions (2026-10-07)

- Page lives in the admin area: **`/admin/access`**.
- **Default expiry: never.** A per-person expiry date is optional.
- **"All courses" option** per person (scope `['*']`), alongside a course picker.
- Email is sent by the owner from their own mail program via a **Compose email** (`mailto:`) button, like the partners page (`app/admin/partners/PartnersTable.tsx`). The tool never sends mail. (mailcal is out: its policy does not authorize the Anthropic provider.)

## Data

- Migration **`0054_access_grant_email.sql`** (hand-written, applied with psql, like 0051–0053): `ALTER TABLE access_grants ADD COLUMN IF NOT EXISTS email text;` Nullable. Schema: `email: text('email')` on `accessGrants`.
- The person's name is the existing `label`. Courses are `scope` (`string[]`, `['*']` for all). Permissions are `can`: always `capture`; plus `create` when "can also add new courses" is ticked. **The panel never grants `admin`.**
- Existing grants (made by the CLI) appear in the table with an empty email.

## API (all under `/api/admin/access`, admin surface)

Auth follows the existing admin routes: the middleware already requires scope `*` + `admin` on `/api/admin/**`; each route also calls `checkAdminAuth(req, { slug })` (second factor in query/body, never an Authorization header — see the comment in `app/admin/SandboxGrantsPanel.tsx`). Every response carries `Cache-Control: no-store`.

- `GET /api/admin/access` → list of grants: `{ id, label, email, scope, can, expiresAt, revokedAt, createdAt, lastUsedAt, status }` where `status` is `active | expired | revoked`. **Never** returns `tokenHash`. Built-in grants (Basic Auth) are not in the table and not listed.
- `POST /api/admin/access` body `{ label, email, courses: string[] | '*', canCreate: boolean, expiresAt: string | null }`:
  - `label` required (trimmed, 1–120 chars). `email` optional; if present must look like an email (one `@`, no spaces, ≤ 254 chars).
  - `courses`: either `'*'` or a non-empty array of codes that all exist in `courses` (reuse `checkCourses` from `scripts/access/lib.ts` — move it to `lib/` if needed); unknown codes → 400 naming them.
  - Mints with the same code path as `scripts/access/grant.ts` (`newToken`, `hashToken`, insert). Extract a shared `createGrant()` in `lib/auth/` and make the script use it too.
  - Returns `{ grant, link }` where `link` is `${PUBLIC_HTTPS_ORIGIN or https://gcworkflow.clemson.edu:8443}/?key=<token>`. The token is returned **only in this response** and never stored or logged.
- `PATCH /api/admin/access/[id]` body `{ courses?, canCreate?, label?, email?, expiresAt? }` — edits in place. Course changes take effect immediately (authorization re-reads the stored grant per request). Refuses (409) to edit a revoked grant.
- `POST /api/admin/access/[id]/reissue` — "Send a new link": in one transaction, revoke the old grant (`revoked_at = now()`) and create a new grant with the same label/email/scope/can/expiresAt. Returns `{ grant, link }` like create. Revoking (not rotating the hash) is deliberate: sessions are keyed by grant id, so a rotated hash would leave the old link's signed-in browsers alive.
- `POST /api/admin/access/[id]/revoke` — sets `revoked_at`. Idempotent.

## Page `/admin/access`

Server page + client panel, styled like the other admin pages. Linked from `/admin`.

- **Add faculty** form: Name, Email, Courses (searchable multi-select over the course list showing code + title; an **All courses** checkbox that disables the picker), "Can also add new courses" checkbox, Expires (date, empty = never).
- After create / reissue: a one-time box: "Copy this link now — it won't be shown again", the link, **Copy link**, **Compose email**. The mailto subject is "Your access to the GC Curriculum Tool"; the body greets the person by name, lists their courses (or "all courses"), gives the link, links the how-to (`/curriculum/howto`), and says the link signs them in on this browser for 30 days at a time and should not be shared.
- **Table:** Name, Email, Courses (chips; "All courses"), Can add courses, Expires, Last used, Status. Revoked rows are dimmed; a "Show revoked" toggle (default off).
- **Row actions:** Edit (inline: courses, can-add, name, email, expiry → Save), **Send a new link** (confirm: "The old link stops working now. Continue?"), **Revoke** (confirm).
- Plain words in the UI (no "grant", "scope", "token").

## Security requirements (reviewed adversarially before merge)

1. Only the admin surface can reach these routes; a scoped (non-admin) grant gets 403 from the middleware, and the routes' own `checkAdminAuth` also fails closed.
2. The token appears only in the create/reissue response body; no logs, no DB, no list output.
3. The panel can never grant `admin`, and cannot edit built-in grants.
4. Unknown course codes are rejected; `'*'` is the only wildcard.
5. Reissue is atomic: there is never a moment with two live grants for one person, nor zero rows if the insert fails (transaction).

## Testing

Red-proof every regression test.
- Route tests: list hides `tokenHash`; create validates name/email/courses, returns a working link once; PATCH changes scope and the change is honored by `authorize()`; reissue revokes the old grant and the old grant's cookie no longer resolves (`grantFromSessionCookie` → `'dead'`); revoke idempotent; non-admin → 403/401; `admin` can't be granted via any body.
- Page test: renders rows and statuses; create shows the link once with Copy and a `mailto:` whose body contains the name, courses and link.
- `scripts/access/grant.ts` still works via the shared `createGrant()`.
- Live check after deploy: create a test person for one course, open the link in a headless browser (capture page 200, another course's write 403), edit courses, reissue (old cookie → 401), revoke; leave nothing live.

## Tracking

STATE.md: new route `/admin/access`, the four API routes, migration 0054, and the shared `createGrant()`.
