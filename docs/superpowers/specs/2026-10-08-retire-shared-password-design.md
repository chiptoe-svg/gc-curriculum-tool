# Retire the shared department password (2026-10-08)

Owner decisions (2026-10-08): the shared department password ("Department login", FACULTY_BASIC_AUTH / creator Basic credentials) goes away completely. Build and deploy now **with the password still accepted**; switch it off with one setting after the 17 faculty invitations go out. A simple sign-in page now; the full request-a-link flow (spec 2026-10-07 §2) is planned Sunday 2026-10-11. Supersedes the "Department login" option in `2026-10-07-signin-page-and-view-only-design.md` §1.

Observed bug that started this: the owner opened a fresh personal admin link in Safari, which already held a `gc_session` cookie for the built-in "Department login" grant (minted from Basic Auth). `gate()` ignores `?key=` whenever a live session cookie exists ("a stray ?key= must never swap an established session"), so the browser stayed "Department login" and `/admin/access` returned "This link can't do that".

## Requirements

1. **A personal link replaces a department session.** In `gate()`, a valid `?key=` is exchanged when the existing session cookie is absent, dead, **or belongs to a built-in grant** (`builtin:` id). A live *personal* session is still never swapped by a stray key (keep that rule).
2. **Setting `DEPARTMENT_LOGIN` (`on` | `off`, default `on`).** When `off`:
   - Basic credentials are never accepted on any path (pages or APIs); `fromBasic` returns null.
   - A `gc_session` cookie for a built-in grant is treated as dead (cleared on the response), so those browsers fall through to sign-in.
   - Gated **pages** with no valid session get the sign-in page (below) with status 401 and **no** `WWW-Authenticate` header (no browser password box).
   - Gated **APIs** with no valid session get 401 JSON, no `WWW-Authenticate`.
   - When `on`: today's behavior, except requirement 1.
   - Only the exact value `off` disables it; unset or `on` = enabled; any other value = enabled **plus a logged warning** (the default stays as today until the owner flips it).
3. **Sign-in page (simple).** Plain HTML from the gate, matching the existing "Sign in to continue" page style: heading "Sign in with your link"; "Open the personal link in your invitation email. It signs in this browser." ; "Lost it, or it isn't working? Email {contact} for a new one." Contact text from env `SIGNIN_CONTACT` (default "Chip Tonkin"). No mention of a department password. Keep the plain-HTTP → HTTPS interstitial ahead of this.
4. **Routes that check the password themselves** must instead rely on the request's resolved grant and the same `authorize()` rules as the gate, and must **fail closed** (never become open when an env var is unset): `app/api/courses/[code]/materials/route.ts`, `app/api/transcribe/route.ts`, `app/api/courses/[code]/imscc-import/route.ts`, `app/api/admin/courses/roster/route.ts`, `app/courses/new/page.tsx`. Audit `git grep FACULTY_BASIC_AUTH|resolveRole|builtinGrant` for any other direct use. Comments that say "Gated by /api/admin/* middleware (FACULTY_BASIC_AUTH)" get updated to describe the grant gate.
5. **Progress dashboards `/board/**`** must work for a personal grant with `admin` capability (the owner's link) both with `DEPARTMENT_LOGIN=on` and `off`. Confirm how `/board` is gated today and make the minimal change.
6. **Machine callers:** `scripts/howto/screenshots.cjs` must authenticate with a personal link key (env `HOWTO_KEY`, exchanged for a cookie) instead of Basic. Report (read-only, no edits) any other project under `~/projects/` that sends Basic credentials to this app's gated paths.
7. **Tests** for every behavior above, including: key replaces builtin session; key does NOT replace a live personal session; `off` rejects Basic on page + API; `off` clears builtin cookie; sign-in page has no `WWW-Authenticate`; each converted route rejects no-grant requests and accepts an authorized grant, with the env var unset. Red-proof the key-replaces-builtin test and one fail-closed route test.
8. Docs: `.env.example` (`DEPARTMENT_LOGIN`, `SIGNIN_CONTACT`), `docs/STATE.md` (what's live; Deferred: flip `DEPARTMENT_LOGIN=off` after invitations; request-link flow Sunday).

Out of scope: the request-a-link flow, 90-day sliding sessions, view-only courses (all in the 2026-10-07 spec, Sunday).
