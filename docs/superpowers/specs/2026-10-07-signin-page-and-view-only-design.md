# Sign-in page, link requests, and view-only courses — design

**Date:** 2026-10-07. **Status:** approved by the owner in conversation. Builds on the faculty access panel ([`2026-10-07-faculty-access-panel-design.md`](./2026-10-07-faculty-access-panel-design.md) and its add-course addendum); ships after it.

## Problems (owner, 2026-10-07)

1. A personal-link holder on a new browser/device, or after their session lapses, meets the browser's Basic Auth password box. They don't have the shared password; the only way back is their original email, which they may not have kept.
2. A personal-link holder can open any course's capture page (reads are allowed for every grant) but every save on a course outside their scope fails with an error and no explanation.

## Owner decisions

- No automatic sign-in emails. People either reuse the link from their invitation email, or **request a new link, which the owner approves**.
- Build the view-only improvements.

## 1. Sign-in page

- When an unauthenticated browser requests a gated **page** (not `/api/**`), the middleware/gate responds with the existing 401 HTML page but **without** `WWW-Authenticate`, so no browser password box appears. The page (`app`-independent HTML from the gate, like today's "Sign in to continue") offers:
  - **Use your sign-in link** — "Open the link in your invitation email. It signs in this browser."
  - **Request a new link** — a form (Name, Clemson email, optional note ≤ 500 chars) that POSTs to `/api/access/request`. Same response for everyone: "Request sent. You'll get an email once it's approved." (No hint whether the email is on the access list.)
  - **Department login** — a link to `/signin/department?next=<path>`.
- `/signin/department`: returns 401 **with** `WWW-Authenticate: Basic` until valid Basic credentials arrive, then 302 to `next` (same-origin paths only — reject absolute/`//` URLs). This is the only place the browser password box appears.
- Gated **API** requests keep today's behavior (401 + `WWW-Authenticate`), so scripts and existing clients are unaffected.
- Keep the plain-HTTP interstitial behavior (redirect to `PUBLIC_HTTPS_ORIGIN`) ahead of all of this.

## 2. Link requests

- Migration **0056** (hand-written, applied by the owner/main session after review): table `access_link_requests` — `id uuid pk`, `name text not null`, `email text not null`, `note text`, `created_at timestamptz default now()`, `status text not null default 'pending'` (`pending | approved | dismissed`), `handled_at timestamptz`, `grant_id uuid null` (the grant issued on approval).
- `POST /api/access/request` — public (add to the gate's public API allowances explicitly), JSON only, same-origin only (`Sec-Fetch-Site`/`Origin` check as in the access panel fix), rate-limited per IP (existing `checkIpRateLimit`) and at most 3 pending requests per email per 24 h (extra ones are accepted silently but not stored). Validates email shape and lengths; rejects control characters. Never reveals whether the email is known.
- On `/admin/access`: a **Link requests** section above the faculty table when any are pending — name, email, note, time, and whether the email matches an active person ("on the access list" / "not on the access list"). Actions:
  - **Approve** (only for an email matching exactly one active person): runs the existing reissue (old link stops working at that moment), marks the request approved with the new `grant_id`, and shows the one-time link box with **Copy link** and **Compose email**. The main Claude session can send that email via mailcal with the owner's Telegram approval; the app itself sends no mail.
  - **Add as faculty** (email not on the list): opens the Add-faculty form prefilled with the name and email; on save, the request is marked approved.
  - **Dismiss**: marks it dismissed.
- A pending request never changes anyone's access by itself.

## 3. Longer, sliding sessions

- Personal-link sessions last **90 days** and renew on use: when a request carries a live `gc_session` whose cookie was issued more than 7 days ago, re-issue the cookie with a fresh 90-day max-age (still capped at the grant's expiry). Implement in the gate where it already sets cookies; the cookie needs an issued-at component (or a second short cookie) — choose the smallest change that keeps the HMAC integrity and is backward compatible with existing cookies (old cookies stay valid until they expire).
- Built-in Basic-Auth cookies keep today's lifetime.

## 4. View-only for other courses

- The gate already resolves the grant. Forward to server components only what they need: the middleware sets a request header (e.g. `x-gc-grant-scope`, `x-gc-grant-can`) **after stripping any incoming copies** of those headers, so a client can't spoof them. A helper `getViewerAccess()` in `lib/auth/` reads them and answers `canEdit(courseCode)` using the same `authorize()` rules as the API.
- **Course list (`/courses`)**: for a scoped viewer, a **Your courses** group first; other courses show **View** (and Explore) but not Edit/Capture.
- **Capture page** for a course the viewer can't edit: a note at the top — "You can view this course. You can edit: GC 2070, GC 3400." — and the write controls (Send, Voice, Generate, Save draft, Approve, tier moves, uploads, Reset interview) are disabled. Faculty Basic-Auth viewers and `*`-scope grants see no change.
- The API remains the enforcement point; this only removes the confusing failures.

## Security requirements (adversarial review before merge)

1. `/signin/department` cannot be used as an open redirect.
2. The request endpoint can't be used to enumerate the access list, to flood the table (rate limits), or cross-site.
3. The forwarded viewer headers can never be set by the client.
4. Removing `WWW-Authenticate` from page 401s doesn't weaken any gate decision (same allow/deny outcomes as before for every path class).
5. Sliding renewal never extends beyond the grant's expiry and never revives a revoked grant.

## Testing

Red-proof each regression test. Gate tests for: page 401 without the header, API 401 with it, `/signin/department` flow and open-redirect refusals, viewer-header stripping, sliding renewal (renews after 7 days, capped at expiry, not for revoked). Route tests for `/api/access/request` (uniform response, rate limits, validation, cross-site 403). Panel tests for the requests section (approve → reissue + link box; add-as-faculty prefill; dismiss). Page tests for "Your courses" and the capture view-only note + disabled controls. Live check after deploy with a temporary person; leave nothing live.

## Tracking

STATE.md: the sign-in page behavior, `/signin/department`, `/api/access/request`, migration 0056, 90-day sliding sessions, viewer headers, and the view-only UI.
