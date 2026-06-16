# Partner Handoff → Mac-Only Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase out the Vercel + Neon + Resend trio entirely. Partner-facing magic-link survey moves to the Mac via Tailscale Funnel; partner invites become manual-send (admin UI shows magic links + mailto helper + tracking); partner data migrates from Neon to local Postgres; Vercel, Neon, and Resend get torn down.

**Architecture:** Today the system runs across three external dependencies — Vercel hosts the `/partners/*` survey, Neon hosts the database (shared between Vercel and the Mac), Resend sends partner invite emails. Each one exists because the Mac couldn't reach external partners directly. The Tailscale Funnel we shipped 2026-06-03 changes that: the Mac now has a public-HTTPS surface (`https://admins-mac-studio-2.tailb723c1.ts.net`) that can serve `/partners/*` directly. With that single change, the architectural reason for each external dependency disappears. This plan migrates in 4 phases — each independently shippable + revertable — so the cutover never blocks an in-flight partner from finishing their survey.

**Tech Stack:** Existing — Next.js 15 App Router on the Mac, Drizzle ORM, Postgres (Neon → local). New: Postgres.app 16 on the Mac as the local DB target. Removed: Resend (`lib/email/*`), Vercel-side config, Neon serverless driver. The admin-facing UI gets a small CSV export helper for the manual-send workflow.

---

## Background — the four things being changed

The current state can be drawn as four hops:

```
Faculty (LAN HTTP / HTTPS funnel) → Mac Next.js → Neon (DB)
                                  → Resend (email)
                                  ↘
                                    Vercel Next.js (mirrored deployment)
Partners (anywhere) → Vercel Next.js → Neon (DB)
```

After this plan:

```
Faculty (LAN HTTP / HTTPS funnel) → Mac Next.js → Local Postgres
Partners (anywhere)               → Mac Next.js via Tailscale Funnel → Local Postgres
Admin sends invites manually (mailto: from Outlook / Apple Mail)
```

One process, one DB, one URL host (the funnel for external use, LAN IP for local browsing).

### Why each external dep can go away

- **Vercel** existed because partners are external and LAN IP wasn't reachable. Funnel solves that.
- **Neon** existed because Vercel needed a publicly-reachable DB. Without Vercel, the Mac talks to a local DB on the same machine — sub-ms queries, no cloud cost, FERPA-cleaner.
- **Resend** existed for transactional invites. At your scale (~10–30 partners total, ~5–10 invites per cycle), manual-send from the admin's own email account is higher-deliverability AND more personal — strictly better in every dimension that matters at this volume.

### Tradeoffs to be honest about

- **Single point of failure:** Mac down = partners can't fill out the survey. At ~10 partners filling out a 15-min survey once each, a few hours of Mac downtime per year is acceptable — partners retry, or admin reaches out. Different math if partner volume grows to hundreds.
- **Tailscale Funnel bandwidth meter:** partner survey traffic counts against the same meter as faculty traffic. Survey is ~50 KB total per partner; not a real concern at this scale.
- **Manual-send friction:** ~30 seconds per invite (click mailto:, tweak, send). Acceptable to ~50 invites/cycle; painful at 200+.

### What stays unchanged

- Faculty side architecture (the HTTP/HTTPS split shipped 2026-06-03)
- Database schema (just changing where Postgres is hosted)
- Partner-facing UI flow (welcome → submit → done — same screens, same paths)
- Admin partner management page (gains buttons; loses the auto-send pipeline)
- Magic-link token generation + expiry behavior

---

## File structure

**Modified files:**

- `app/admin/partners/PartnersTable.tsx` — gains Copy-link button, Compose-email (mailto:) button, Mark-invited button per row; "Copy all unsent as CSV" header action. Removes the "Resend invite" button.
- `app/api/admin/partners/import/route.ts` — no longer calls `sendPartnerInvite`; just creates the partner row. Returns the magic-link URL in the response so the admin UI can immediately show it.
- `app/api/admin/partners/[partnerId]/resend-invite/route.ts` — repurposed as `/api/admin/partners/[partnerId]/mark-invited` (POST sets `invitedAt = now()`). Same partnerId param; just a status flip.
- `lib/partners/queries.ts` — minor: add `markInvited(partnerId)` if it doesn't already exist in the shape we need; `magicLinkUrl(partner)` helper that builds the URL from `PARTNERS_BASE_URL + token`.
- `.env.local` — `PARTNERS_BASE_URL` flips from the Vercel URL to the funnel URL. Eventually `DATABASE_URL` flips from Neon to local. Resend env vars get deleted at teardown.
- `lib/db/client.ts` — at Phase C, points at local Postgres instead of Neon serverless. Probably swaps `@neondatabase/serverless` for `pg` (node-postgres).
- `drizzle.config.ts` — at Phase C, points at local Postgres.
- `package.json` — `resend` dep removed at Phase D; `@neondatabase/serverless` removed at Phase C; `pg` + `@types/pg` added at Phase C.
- `docs/STATE.md` — new row per phase shipped; `What's live` section updated; deferred-debt list updated.
- `vercel.json` (if exists) — deleted at Phase D.

**Deleted files (at Phase D):**

- `lib/email/resend.ts`
- `lib/email/send-partner-invite.tsx`
- `tests/email/send-partner-invite.test.ts`
- `tests/api/admin-partners-resend.test.ts` (or rewritten as `admin-partners-mark-invited.test.ts`)

**Untouched (intentionally):**

- All `/partners/[token]/*` page and route code — same flow, just served from a different host
- Partner DB schema (tables, columns, types)
- Auth model (magic token still gates everything partner-facing)
- The Tailscale Funnel mount configuration (root mount from 2026-06-03 already exposes `/partners/*`)

---

## Phase A — Manual-send admin UI (drop Resend)

Replace the auto-send invite pipeline with a per-row admin workflow: see the magic link, copy it, compose a personalized email in your own client, mark the partner as invited. Resend goes away; the partner-side URL still points at Vercel (unchanged until Phase B).

### Task A1: Add `markInvited` query + magic-link helper

**Files:**
- Modify: `lib/partners/queries.ts`

- [ ] **Step 1: Read the existing queries file to see what's there**

```bash
cd /Users/admin/projects/curriculum_developer
grep -nE '^export (async )?function' lib/partners/queries.ts
```

If `markInvited` already exists, skip to Step 3. If not, continue.

- [ ] **Step 2: Add `markInvited` if it doesn't exist**

Append to `lib/partners/queries.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { partners } from '@/lib/db/schema';

/**
 * Stamp invitedAt = now() on a partner row. Idempotent — multiple
 * marks just overwrite the timestamp. Called by the admin UI's
 * "Mark invited" button after the admin sends the email manually.
 */
export async function markInvited(partnerId: string): Promise<void> {
  await db
    .update(partners)
    .set({ invitedAt: new Date() })
    .where(eq(partners.id, partnerId));
}
```

If the file already imports `eq`, `db`, and `partners`, don't duplicate the import lines — just add the function.

- [ ] **Step 3: Add `magicLinkUrl` helper to the same file**

Append:

```typescript
/**
 * Build the partner-survey magic-link URL from PARTNERS_BASE_URL +
 * the partner's magic_token. PARTNERS_BASE_URL is currently the
 * Vercel deploy URL; flips to the Tailscale Funnel URL in Phase B.
 */
export function magicLinkUrl(partner: { magicToken: string }): string {
  const base = process.env.PARTNERS_BASE_URL?.trim();
  if (!base) throw new Error('PARTNERS_BASE_URL not set');
  return `${base.replace(/\/$/, '')}/partners/${partner.magicToken}`;
}
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/partners/queries.ts
git commit -m "feat(partners): markInvited + magicLinkUrl helpers for manual-send UI

Prep for replacing the auto-send invite pipeline with admin-driven
manual sending. markInvited is what the 'Mark invited' button will
call after the admin sends the email from their own client;
magicLinkUrl builds the survey URL from PARTNERS_BASE_URL +
partner.magicToken."
```

### Task A2: Replace import-route auto-send with link-return

**Files:**
- Modify: `app/api/admin/partners/import/route.ts`
- Modify: `app/admin/partners/ImportCsvDialog.tsx` (if it consumes the response)

- [ ] **Step 1: Read the current import route**

```bash
cd /Users/admin/projects/curriculum_developer
cat app/api/admin/partners/import/route.ts
```

You'll see a loop that creates each partner + calls `sendPartnerInvite`. The new behavior: create the partner, return its id + name + email + magic-link URL in the response. Admin UI uses that to immediately render the new partners in the table with their copy/compose buttons.

- [ ] **Step 2: Modify the route to skip email + return links**

Replace the import-creation loop's body. The exact line numbers will vary; the change is:

```typescript
// Before:
const created = await createPartner(row);
inserted++;
try {
  await sendPartnerInvite({
    firstName: created.firstName,
    email: created.email,
    token: created.magicToken,
  });
} catch (e) {
  /* keep going; admin can resend */
}

// After:
const created = await createPartner(row);
inserted++;
createdPartners.push({
  id: created.id,
  firstName: created.firstName,
  lastName: created.lastName,
  email: created.email,
  company: created.company,
  magicLinkUrl: magicLinkUrl(created),
});
```

Where `createdPartners` is a new array declared above the loop, and `magicLinkUrl` is imported from `lib/partners/queries`.

Remove the `sendPartnerInvite` import + the `logPartnerEvent` call for the "invite_sent" event (if present — the admin marking the partner invited later will write a different event type).

In the response JSON, include `createdPartners` so the UI can display them immediately:

```typescript
return NextResponse.json({
  inserted,
  skipped,
  createdPartners,
});
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors. If the route had other Resend imports (`@/lib/email/resend`), remove those too.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/partners/import/route.ts
git commit -m "refactor(partners): import route returns links instead of sending invites

CSV import no longer triggers Resend. Response now includes a
createdPartners array with each new partner's magicLinkUrl so the
admin UI can immediately show copy/compose buttons. ImportCsvDialog
consumes this in the next commit."
```

### Task A3: Repurpose resend-invite route as mark-invited

**Files:**
- Move: `app/api/admin/partners/[partnerId]/resend-invite/route.ts` → `app/api/admin/partners/[partnerId]/mark-invited/route.ts`
- Modify: the new route's body

- [ ] **Step 1: Move the file**

```bash
cd /Users/admin/projects/curriculum_developer
mkdir -p 'app/api/admin/partners/[partnerId]/mark-invited'
git mv 'app/api/admin/partners/[partnerId]/resend-invite/route.ts' \
      'app/api/admin/partners/[partnerId]/mark-invited/route.ts'
rmdir 'app/api/admin/partners/[partnerId]/resend-invite'
```

- [ ] **Step 2: Replace the route body**

Open `app/api/admin/partners/[partnerId]/mark-invited/route.ts` and replace the entire file with:

```typescript
import { NextResponse } from 'next/server';
import { markInvited, logPartnerEvent } from '@/lib/partners/queries';

interface RouteContext { params: Promise<{ partnerId: string }> }

/**
 * POST /api/admin/partners/[partnerId]/mark-invited
 * Body: {}
 * Returns: { invitedAt: ISO string }
 *
 * Stamps invitedAt on the partner row. Called by the admin UI's
 * "Mark invited" button after the admin sends the magic-link email
 * from their own client (Outlook, Apple Mail, etc.).
 *
 * No email is sent from this endpoint — the admin sends it manually.
 * The endpoint exists only to record that the admin has done so, so
 * the table can show "invited 3 days ago" and the admin knows who
 * still needs a nudge.
 */
export async function POST(_req: Request, { params }: RouteContext): Promise<Response> {
  const { partnerId } = await params;
  if (!partnerId) return NextResponse.json({ error: 'partnerId required' }, { status: 400 });

  await markInvited(partnerId);
  await logPartnerEvent({ partnerId, eventType: 'invite_marked_sent' });

  return NextResponse.json({ invitedAt: new Date().toISOString() });
}
```

If `logPartnerEvent` doesn't exist on `@/lib/partners/queries`, check the actual exports + remove that line (the event log is nice-to-have).

- [ ] **Step 3: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(partners): /resend-invite route → /mark-invited (no email sent)

Same partnerId-keyed POST; just stamps invitedAt and logs the
'invite_marked_sent' event. Admin sends the actual email manually
from their own client; this endpoint records that they did so."
```

### Task A4: Admin UI — magic-link + Copy + Compose mailto: + Mark invited

**Files:**
- Modify: `app/admin/partners/PartnersTable.tsx`

- [ ] **Step 1: Read the current table component**

```bash
cd /Users/admin/projects/curriculum_developer
wc -l app/admin/partners/PartnersTable.tsx
grep -nE '<th>|<td>|function|interface ' app/admin/partners/PartnersTable.tsx | head -20
```

This is the existing per-row table that currently shows Resend-invite buttons. Identify which column has Actions; that's where the new buttons go.

- [ ] **Step 2: Add the new helpers + buttons**

In `app/admin/partners/PartnersTable.tsx`, replace the existing `resend` function with three new handlers. Find the `async function resend(id: string)` block and replace it with:

```typescript
async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    // No alert — the button label can flash "Copied ✓" via local state if needed
  } catch {
    // Fallback for non-secure contexts (we shouldn't hit this since
    // /admin is now on the HTTPS funnel — but be defensive)
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); }
    finally { document.body.removeChild(ta); }
  }
}

function composeEmailHref(partner: PartnerRow, magicLink: string): string {
  const subject = `Your GC industry input — 15-min survey link`;
  const body = [
    `Hi ${partner.firstName},`,
    '',
    `Thanks for being willing to share your perspective on what ${partner.company} looks for in entry-level graphic-communications hires. The survey takes ~15 minutes and helps us audit how well the GC curriculum is preparing students for roles like yours.`,
    '',
    `Your personal link:`,
    magicLink,
    '',
    `Let me know if you have any trouble accessing it.`,
    '',
    `— Chip`,
  ].join('\n');
  // mailto: percent-encoding via encodeURIComponent. Some clients
  // (Outlook) want %20 for spaces; encodeURIComponent handles that.
  return `mailto:${encodeURIComponent(partner.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function markInvited(partnerId: string) {
  const res = await fetch(`/api/admin/partners/${partnerId}/mark-invited`, {
    method: 'POST',
  });
  if (!res.ok) {
    alert(`Mark-invited failed: ${res.status}`);
    return;
  }
  // Either trigger a re-fetch via a parent callback, or update the
  // row's invitedAt in local state. Match whatever pattern the file
  // already uses to update other partner fields after a POST.
  window.location.reload();
}
```

Note: `PartnerRow` is the type already used in the table (or whatever shape `partners` are passed in as). Use the existing name. If the table receives partners through a prop named `partners` typed as some interface, reuse that interface name.

- [ ] **Step 3: Add the buttons to each row**

In the Actions column for each partner row, replace the existing "Resend invite" button with three actions. Where the old button was:

```tsx
// Before:
<button onClick={() => resend(p.id)}>Resend invite</button>

// After:
<div className="flex flex-wrap items-center gap-2 text-xs">
  <button
    type="button"
    onClick={() => copyLink(magicLinkUrl(p))}
    className="rounded border border-input bg-background px-2 py-1 hover:bg-muted"
    title="Copy the magic-link URL to your clipboard"
  >
    Copy link
  </button>
  <a
    href={composeEmailHref(p, magicLinkUrl(p))}
    className="rounded border border-input bg-background px-2 py-1 hover:bg-muted"
    title="Opens your default email client with a draft you can edit before sending"
  >
    Compose email
  </a>
  <button
    type="button"
    onClick={() => markInvited(p.id)}
    disabled={!!p.invitedAt}
    className="rounded border border-input bg-background px-2 py-1 hover:bg-muted disabled:opacity-50"
    title={p.invitedAt ? `Marked invited ${new Date(p.invitedAt).toLocaleDateString()}` : 'Record that you sent the invite'}
  >
    {p.invitedAt ? '✓ Invited' : 'Mark invited'}
  </button>
</div>
```

`magicLinkUrl(p)` is the helper we added to `lib/partners/queries.ts`. Import it at the top of the table file:

```typescript
import { magicLinkUrl } from '@/lib/partners/queries';
```

If the table is a `'use client'` component and `magicLinkUrl` references `process.env.PARTNERS_BASE_URL`, that won't work client-side. Instead: have the server-side page (which renders the table) compute the URL per partner once and pass it as a prop, OR expose `PARTNERS_BASE_URL` as a `NEXT_PUBLIC_PARTNERS_BASE_URL` env var.

Pick whichever fits the existing pattern. Easier: pass the magic-link URL down as a per-row prop computed on the server, since the parent server component already has the partners array. Read the parent page (`app/admin/partners/page.tsx`) to see what it currently passes.

- [ ] **Step 4: Add an "invited at" column to the table (if not already there)**

Most admin tables already display invitedAt. If not, add a column:

```tsx
<th>Invited</th>
// ...
<td>{p.invitedAt ? new Date(p.invitedAt).toLocaleDateString() : '—'}</td>
```

- [ ] **Step 5: Typecheck and smoke**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
launchctl kickstart -k gui/501/com.gc.curriculum-tool >/dev/null 2>&1
sleep 4
BASIC=$(grep '^FACULTY_BASIC_AUTH=' .env.local | cut -d= -f2)
SLUG=$(grep '^PROTOTYPE_SLUG=' .env.local | cut -d= -f2)
curl -sk -u "$BASIC" "http://127.0.0.1:3000/admin/partners?slug=$SLUG" \
  | grep -ciE 'Compose email|Copy link|Mark invited'
```

Expected: ≥3 matches (each of the three button labels appears at least once in the rendered HTML).

- [ ] **Step 6: Commit**

```bash
git add app/admin/partners/PartnersTable.tsx
git commit -m "feat(partners): manual-send admin UI — Copy / Compose / Mark invited

Per-row buttons replace the Resend auto-send pipeline:
- Copy link: writes the magic-link URL to clipboard
- Compose email: opens mailto: with a personalized draft using
  firstName + company that admin can edit before sending
- Mark invited: stamps invitedAt so the table shows status

Sender voice is 'Chip' by default; templated subject + body keep
each send fast (~30s) while still allowing personalization."
```

### Task A5: Smoke-test the full Phase A flow + commit

- [ ] **Step 1: End-to-end smoke**

Open the admin partners page in Safari. Add a test partner (your own email is fine). Confirm:
- Row appears with the new buttons
- "Copy link" puts the URL in your clipboard (paste somewhere to verify)
- "Compose email" opens your email client with the templated draft
- After sending, "Mark invited" stamps the row
- Re-loading the page shows "✓ Invited" on that row

- [ ] **Step 2: Verify Resend can be removed (still imported anywhere?)**

```bash
cd /Users/admin/projects/curriculum_developer
grep -rn "sendPartnerInvite\|@/lib/email/resend\|from 'resend'" --include='*.ts' --include='*.tsx' . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v 'tests/email/' | grep -v 'tests/api/admin-partners-resend.test'
```

Expected: nothing matches (or only test files that reference the old behavior, which Phase D will clean up).

If the admin "Resend invite" button in PartnersTable was removed (replaced by the three new buttons), and the import route no longer calls sendPartnerInvite, the `lib/email/*` files are now unused at runtime. Don't delete them yet — Phase D handles the teardown so we can keep Resend as a fallback through Phases B and C.

---

## Phase B — Funnel-serve `/partners/*`

The Tailscale Funnel root mount we shipped 2026-06-03 already exposes `/partners/*` because it mounts root. The DB layer still talks to Neon (the Mac has `DATABASE_URL` access via the Neon serverless driver). This phase just flips `PARTNERS_BASE_URL` so all new magic links point at the funnel.

### Task B1: Validate the funnel serves /partners/* end-to-end

- [ ] **Step 1: Pick a test partner**

Use any existing test partner OR create one via the admin UI's CSV import. Note their `magicToken` value.

- [ ] **Step 2: Test the funnel-served partner URL**

```bash
cd /Users/admin/projects/curriculum_developer
# Get the magic token
TOKEN=$(psql "$(grep '^DATABASE_URL=' .env.local | cut -d= -f2 | tr -d '\"')" -tAc \
  "SELECT magic_token FROM partners ORDER BY created_at DESC LIMIT 1")
echo "Test token: $TOKEN"
echo
echo "=== Vercel-served URL (current canonical) ==="
curl -sk -o /dev/null -w '%{http_code}\n' "$(grep '^PARTNERS_BASE_URL=' .env.local | cut -d= -f2 | tr -d '\"')/partners/$TOKEN"
echo
echo "=== Funnel-served URL (target) ==="
curl -sk -o /dev/null -w '%{http_code}\n' "https://admins-mac-studio-2.tailb723c1.ts.net/partners/$TOKEN"
```

Expected: both return 200. The funnel-served URL should render the same partner welcome screen.

If either returns 401, basic-auth is gating /partners (it shouldn't — `/partners` is in `PUBLIC_PREFIXES`). Verify `lib/auth/basic-auth.ts:PUBLIC_PREFIXES` still contains `/partners`. If 404, the funnel mount is wrong — `tailscale funnel status` should show `/` mounted at `http://127.0.0.1:3000`.

- [ ] **Step 3: Open the funnel partner URL in a real browser**

Open `https://admins-mac-studio-2.tailb723c1.ts.net/partners/<TOKEN>` in Safari. Confirm:
- The partner welcome screen renders
- Career-target picker loads
- Submission wizard works through to submit
- No console errors

If anything's broken, fix it before moving to Step 4 (the URL flip).

### Task B2: Flip `PARTNERS_BASE_URL` to the funnel

**Files:**
- Modify: `.env.local` (not committed; manual edit)
- Document: `.env.example` if it has `PARTNERS_BASE_URL`

- [ ] **Step 1: Edit `.env.local`**

Open `/Users/admin/projects/curriculum_developer/.env.local` and change:

```bash
# Before:
PARTNERS_BASE_URL=https://gc-curriculum-tool.vercel.app

# After:
PARTNERS_BASE_URL=https://admins-mac-studio-2.tailb723c1.ts.net
```

- [ ] **Step 2: Restart Next.js so the new env var is picked up**

```bash
launchctl kickstart -k gui/501/com.gc.curriculum-tool
sleep 4
```

- [ ] **Step 3: Verify new magic-link URLs use the funnel host**

In the admin UI, look at any existing partner row. The "Copy link" button should now produce a URL starting with `https://admins-mac-studio-2.tailb723c1.ts.net/partners/`.

If not, the env var didn't take effect — check `process.env.PARTNERS_BASE_URL` is being read at request time (not at build time).

- [ ] **Step 4: Update `.env.example` to reflect the new canonical value**

If `.env.example` has a `PARTNERS_BASE_URL=` line, update it to reference the funnel URL pattern (or just `PARTNERS_BASE_URL=` empty with a comment).

- [ ] **Step 5: Commit any docs/`.env.example` changes**

```bash
cd /Users/admin/projects/curriculum_developer
git diff --name-only
# If .env.example or anything else changed, commit:
git add .env.example  # if changed
git commit -m "chore(env): PARTNERS_BASE_URL points at Tailscale Funnel

Partner magic-link URLs now go to the Mac-served /partners/* paths
via the funnel; Vercel deploy remains up as a fallback for any
in-flight partners with already-issued Vercel-URL invites until
they finish or expire."
```

### Task B3: Drain check — wait for any in-flight Vercel-URL partners

Don't tear down Vercel yet. New invites go to the funnel; existing in-flight Vercel-URL invites have to finish first (or expire).

- [ ] **Step 1: Identify in-flight Vercel partners**

```bash
cd /Users/admin/projects/curriculum_developer
psql "$(grep '^DATABASE_URL=' .env.local | cut -d= -f2 | tr -d '\"')" -c "
SELECT id, first_name, last_name, company, email, invited_at, first_opened_at, last_active_at
FROM partners
WHERE invited_at IS NOT NULL
  AND first_opened_at IS NOT NULL
  AND id NOT IN (SELECT DISTINCT partner_id FROM partner_submissions WHERE submitted_at IS NOT NULL)
ORDER BY first_opened_at DESC
"
```

Expected: a list of partners who got an invite + opened it but haven't submitted yet. These have Vercel-URL invites in their inbox.

- [ ] **Step 2: Decide drain strategy**

Two options:
- **Wait:** keep Vercel up; let them finish naturally. ~2 weeks max (token TTL).
- **Re-send:** manually email each in-flight partner the new funnel URL ("Sorry, please use this updated link instead").

For zero in-flight partners, both are no-ops; move to Phase C.

- [ ] **Step 3: Document the cutover in STATE.md**

```bash
cd /Users/admin/projects/curriculum_developer
```

Add a one-line note to STATE.md's Active arc or What's live section:

> "Partner magic links cut over to Tailscale Funnel URL on YYYY-MM-DD; Vercel still up as drain for in-flight invites issued before that date."

- [ ] **Step 4: Commit STATE.md update**

```bash
git add docs/STATE.md
git commit -m "docs(state): partner magic-link URLs cut over to Tailscale Funnel"
```

---

## Phase C — Migrate partner data Neon → local

Now that nothing external depends on Neon (Vercel is in drain mode; faculty surfaces are Mac-only), migrate the database.

### Task C1: Install Postgres.app + create the local database

This is a manual setup step on the Mac — not codebase change.

- [ ] **Step 1: Install Postgres.app**

Download Postgres.app from https://postgresapp.com (or `brew install --cask postgres-app`). Launch it; initialize a server on port 5432 with Postgres 16.

- [ ] **Step 2: Add the CLI to your PATH**

```bash
sudo mkdir -p /etc/paths.d
echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
```

Then restart your terminal so `psql` is reachable.

- [ ] **Step 3: Create the `gc_curriculum` database**

```bash
createdb gc_curriculum
psql gc_curriculum -c "SELECT version();"
```

Expected: prints the Postgres 16.x version.

- [ ] **Step 4: Register port 5432 in your ~/.dev-ports.yaml**

Per the project's port-registry convention, add an entry to `~/.dev-ports.yaml`:

```yaml
- port: 5432
  owner: postgres-app
  purpose: local Postgres for GC Curriculum Tool (gc_curriculum db)
```

### Task C2: Dump Neon → restore to local

- [ ] **Step 1: Dump everything from Neon**

```bash
cd /Users/admin/projects/curriculum_developer
NEON_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2 | tr -d '\"')
pg_dump --no-owner --no-acl --clean --if-exists "$NEON_URL" > /tmp/gc_neon_dump.sql
echo "dump size: $(wc -c < /tmp/gc_neon_dump.sql) bytes"
```

Expected: a multi-MB SQL dump. If `pg_dump` fails with version-mismatch errors, install matching client tools: `brew install postgresql@16` and put `/opt/homebrew/opt/postgresql@16/bin` first in PATH for this terminal session.

- [ ] **Step 2: Restore the dump to local**

```bash
psql gc_curriculum < /tmp/gc_neon_dump.sql 2>&1 | tail -20
```

Expected: a lot of NOTICE lines about existing-table drops (the `--clean --if-exists` flags). No ERROR lines at the end.

- [ ] **Step 3: Verify row counts match**

```bash
cd /Users/admin/projects/curriculum_developer
for table in courses partners partner_submissions course_capture_snapshots capture_messages course_materials; do
  NEON_COUNT=$(psql "$NEON_URL" -tAc "SELECT COUNT(*) FROM $table" 2>/dev/null)
  LOCAL_COUNT=$(psql gc_curriculum -tAc "SELECT COUNT(*) FROM $table" 2>/dev/null)
  echo "  $table: neon=$NEON_COUNT local=$LOCAL_COUNT"
done
```

Expected: matching counts for every table.

### Task C3: Swap the DB client from Neon serverless to node-postgres

**Files:**
- Modify: `lib/db/client.ts`
- Modify: `drizzle.config.ts`
- Modify: `package.json` (deps)
- Modify: `.env.local` (DATABASE_URL value)

- [ ] **Step 1: Add node-postgres deps; remove Neon serverless**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm add pg
pnpm add -D @types/pg
pnpm remove @neondatabase/serverless
```

- [ ] **Step 2: Rewrite `lib/db/client.ts` for node-postgres**

Read the current file first:

```bash
cat lib/db/client.ts
```

Replace its contents with:

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Local Postgres on the same machine — small pool is plenty.
  // Bump if you see "too many connections" errors under load.
  max: 10,
});

export const db = drizzle(pool);
```

(If the existing client.ts has other exports — e.g., a typed schema reference — preserve those; only swap the connection plumbing.)

- [ ] **Step 3: Update `drizzle.config.ts` if needed**

`drizzle-kit` should work unchanged with a Postgres URL — but verify:

```bash
cat drizzle.config.ts
```

If the file references `@neondatabase/serverless` or `neon` anywhere, swap to the node-postgres equivalent. Most likely it just uses `process.env.DATABASE_URL`, which is provider-agnostic.

- [ ] **Step 4: Update `.env.local` DATABASE_URL**

Edit `.env.local`:

```bash
# Before:
DATABASE_URL=postgresql://...@ep-...neon.tech/neondb?sslmode=require

# After:
DATABASE_URL=postgresql://$USER@localhost:5432/gc_curriculum
```

Replace `$USER` with your actual macOS username if Postgres.app is set up with username-based auth (the default). If you set up a password, include it: `postgresql://user:pass@localhost:5432/gc_curriculum`.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors. The drizzle-orm node-postgres adapter is API-compatible with the Neon adapter for query construction.

- [ ] **Step 6: Restart Next.js, smoke-test a faculty page**

```bash
launchctl kickstart -k gui/501/com.gc.curriculum-tool
sleep 4
curl -sk -u "$(grep '^FACULTY_BASIC_AUTH=' .env.local | cut -d= -f2)" \
  "https://admins-mac-studio-2.tailb723c1.ts.net/courses?slug=$(grep '^PROTOTYPE_SLUG=' .env.local | cut -d= -f2)" \
  | head -c 200
```

Expected: the courses index page HTML — confirms the new local DB is wired correctly.

- [ ] **Step 7: Smoke-test the partner page**

```bash
# Reuse the test token from Phase B
TOKEN=$(psql gc_curriculum -tAc "SELECT magic_token FROM partners ORDER BY created_at DESC LIMIT 1")
curl -sk "https://admins-mac-studio-2.tailb723c1.ts.net/partners/$TOKEN" \
  | head -c 200
```

Expected: the partner welcome screen HTML.

- [ ] **Step 8: Commit**

```bash
git add lib/db/client.ts drizzle.config.ts package.json pnpm-lock.yaml
git commit -m "feat(db): swap Neon serverless → node-postgres pool against local Postgres

DATABASE_URL now points at local Postgres (Postgres.app, port 5432,
gc_curriculum db). All faculty + partner queries go through the
same pool. Drizzle's drizzle-orm/node-postgres adapter is
API-compatible with the Neon adapter for query construction, so
no query code changes were needed.

Migration: pg_dump from Neon → psql restore to local; verified row
counts match across courses, partners, snapshots, and capture
messages. Neon is now a backup; tear-down in Phase D."
```

### Task C4: Set up local-Postgres backup cron

**Files:**
- Modify: `scripts/backup/pg-snapshot.sh` (if it currently targets Neon)
- Modify: launchd plist (if a different cron target is needed)

- [ ] **Step 1: Read the existing pg-backup script**

```bash
cd /Users/admin/projects/curriculum_developer
cat scripts/backup/pg-snapshot.sh
```

Per STATE.md, this script already runs every 6h and writes to `~/Library/Application Support/gc-curriculum-tool/backups/`. It probably already reads `DATABASE_URL` from `.env.local` — in which case the local-DB swap is invisible to it (it'll just dump from local now).

If it hardcodes a Neon URL, edit it to read from `.env.local` instead.

- [ ] **Step 2: Verify the next backup writes a local-DB dump**

Either wait for the next 6h cron tick, or force a backup manually:

```bash
bash scripts/backup/pg-snapshot.sh
ls -la ~/Library/Application\ Support/gc-curriculum-tool/backups/ | tail -3
```

Expected: a new `.sql.gz` file from the local DB.

- [ ] **Step 3: Commit any script changes**

```bash
git add scripts/backup/pg-snapshot.sh
git commit -m "chore(backup): pg-snapshot script reads DATABASE_URL (local) instead of Neon-hardcoded

No behavior change if the script was already env-driven."
```

(Skip this commit if no file actually changed.)

---

## Phase D — Tear down Vercel, Neon, Resend

Everything's running on the Mac now. Time to remove the dead surfaces.

### Task D1: Delete Resend code

**Files:**
- Delete: `lib/email/resend.ts`
- Delete: `lib/email/send-partner-invite.tsx`
- Delete: `tests/email/send-partner-invite.test.ts`
- Delete: `tests/api/admin-partners-resend.test.ts`
- Modify: `package.json` (remove `resend` dep)
- Modify: `.env.local` (remove RESEND vars)
- Modify: `.env.example` (remove RESEND vars)

- [ ] **Step 1: Remove the files**

```bash
cd /Users/admin/projects/curriculum_developer
rm -f lib/email/resend.ts \
      lib/email/send-partner-invite.tsx \
      tests/email/send-partner-invite.test.ts \
      tests/api/admin-partners-resend.test.ts
# Remove the empty lib/email dir if nothing else lives there:
rmdir lib/email 2>/dev/null || true
```

- [ ] **Step 2: Remove the resend npm dep**

```bash
pnpm remove resend
```

- [ ] **Step 3: Verify no leftover imports**

```bash
grep -rn "from 'resend'\|from '@/lib/email/" --include='*.ts' --include='*.tsx' . 2>/dev/null | grep -v node_modules | grep -v .next
```

Expected: nothing.

- [ ] **Step 4: Remove the env vars**

Edit `.env.local` and `.env.example`. Delete these lines:

```
RESEND_API_KEY=...
RESEND_FROM_EMAIL=...
```

- [ ] **Step 5: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(email): delete Resend integration — partner invites are manual now

lib/email/{resend.ts, send-partner-invite.tsx} and their tests are
gone; resend npm dep removed; RESEND_API_KEY + RESEND_FROM_EMAIL env
vars dropped. Admin sends partner invites from their own email
client via the mailto: helper shipped in Phase A. Strictly higher
deliverability + more personal at this scale."
```

### Task D2: Delete Vercel-side config + docs

**Files:**
- Delete: `vercel.json` (if exists)
- Delete: `.vercel/` (if exists — local Vercel CLI state)
- Modify: `README.md` and `docs/STATE.md` to reflect Mac-only

- [ ] **Step 1: Identify Vercel-specific files**

```bash
cd /Users/admin/projects/curriculum_developer
ls -la vercel.json .vercel .vercelignore 2>/dev/null
find . -name 'vercel-*.sh' -not -path '*/node_modules/*' -not -path '*/.next/*' 2>/dev/null
```

- [ ] **Step 2: Remove any Vercel-specific files**

For each file found in Step 1, remove it:

```bash
rm -f vercel.json .vercelignore
rm -rf .vercel
# Plus any vercel-* scripts that exist
```

- [ ] **Step 3: Delete the Vercel project (manual, in the Vercel dashboard)**

Open https://vercel.com/dashboard, find the `gc-curriculum-tool` project, and delete it. This stops the GitHub-Actions-triggered deploys.

- [ ] **Step 4: Update README + STATE.md**

In both `README.md` and `docs/STATE.md`, find any references to "Vercel" or "two-deployment hybrid" and update to reflect Mac-only.

`docs/STATE.md` specifically: the "What's live" section's "Partner / public surfaces — Vercel" subsection should be merged into the main Mac section. Update phrasing throughout.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(vercel): remove Vercel-side config + project (deploy taken down)

Vercel project deleted from the dashboard; vercel.json + .vercel
state removed from the repo. README + STATE.md updated to reflect
single-deployment (Mac) architecture.

Partners are now served from the Mac via Tailscale Funnel; in-flight
Vercel-URL invites issued before the Phase B cutover have completed
or expired."
```

### Task D3: Decommission Neon

- [ ] **Step 1: Final backup of Neon (just in case)**

```bash
cd /Users/admin/projects/curriculum_developer
# If you removed Neon from .env.local already, hardcode the URL one last time
NEON_URL='postgresql://...your-actual-Neon-url...'
pg_dump --no-owner --no-acl "$NEON_URL" | gzip > ~/Documents/gc_neon_final_backup_$(date +%Y%m%d).sql.gz
ls -lh ~/Documents/gc_neon_final_backup_*.sql.gz
```

Expected: a `.sql.gz` file in ~/Documents. This is your last-chance backup.

- [ ] **Step 2: Delete the Neon database (manual, in the Neon console)**

Open https://console.neon.tech, find the project, and delete it.

- [ ] **Step 3: Remove Neon-specific env vars + comments**

If `.env.local` or `.env.example` mention `NEON_API_KEY`, `NEON_PROJECT_ID`, or any neon-related vars (from the monthly-branch-checkpoint backup scheme per STATE.md), delete them. Also delete any `scripts/backup/neon-*.sh` files if they existed.

- [ ] **Step 4: Update STATE.md backup section**

The four-tier backup scheme described in STATE.md mentioned "Neon's own ~7h PITR" as tier 1 and "monthly Neon branch checkpoint" as tier 3. Both are gone. Update STATE.md to reflect the new tiers:

- Tier 1: local Postgres pg_dump every 6h
- Tier 2: weekly off-site push to private repo (unchanged)
- (Tier 3 was Neon-specific; gone)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(neon): decommission Neon database, remove NEON_* env vars + scripts

Neon project deleted from the console (last full dump archived to
~/Documents/gc_neon_final_backup_*.sql.gz before deletion).

Backup tiers updated: local pg_dump every 6h + weekly off-site push.
The Neon PITR + monthly-branch-checkpoint tiers are gone."
```

### Task D4: Final smoke + push

- [ ] **Step 1: End-to-end smoke**

In Safari:
- Open `http://gcworkflow.clemson.edu:3000/` — public landing renders
- Open `/view/GC%204800` — read-only profile renders (catalog or captured)
- Open `https://admins-mac-studio-2.tailb723c1.ts.net/capture/GC%201010?slug=…` — Basic Auth prompt → editor renders → mic works
- Open `https://admins-mac-studio-2.tailb723c1.ts.net/admin/partners?slug=…` — admin table renders, buttons present
- Open a partner test URL on the funnel — welcome → submit flow works

- [ ] **Step 2: Verify everything still typechecks + tests pass**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
pnpm vitest run 2>&1 | tail -20
```

Expected: no typecheck errors; tests all pass.

- [ ] **Step 3: Push**

```bash
git push
```

Expected: all phase commits pushed cleanly.

---

## Task X: Update STATE.md (final pass)

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Add a Cross-cutting row for the migration**

In STATE.md's Cross-cutting table (near where the hybrid HTTP/HTTPS row lives), add:

```markdown
| **Mac-only deployment + manual partner invites + local Postgres** (2026-06-04) | Phased migration that retired Vercel, Neon, and Resend in favor of Mac-only operation. Partner-facing `/partners/*` survey now served from the Mac via Tailscale Funnel; database moved to local Postgres (Postgres.app 16, gc_curriculum db on port 5432); partner invites are sent manually by the admin via a mailto:-helper + per-row tracking in `/admin/partners`. Replaces the prior two-deployment hybrid described in the architecture overview. Backup chain simplifies: local pg_dump every 6h + weekly off-site push (Neon-specific tiers removed). Plan: [`2026-06-04-partner-handoff-vercel-phaseout.md`](./superpowers/plans/2026-06-04-partner-handoff-vercel-phaseout.md). | live | 2026-06-04 |
```

- [ ] **Step 2: Remove the "Partner / public surfaces — Vercel" section heading**

Find that section in STATE.md (it lists `/partners/[token]` as a Vercel-served route). The `/partners/[token]` route is now served from the Mac just like everything else. Move that row into the Mac-side faculty surfaces table or into a new "Public surfaces" subsection — pick whichever fits the doc's structure.

- [ ] **Step 3: Update the env vars list**

The env var inventory in STATE.md mentions `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEON_API_KEY`, `NEON_PROJECT_ID`. All gone. Remove them from the list.

- [ ] **Step 4: Update the architecture doc cross-link**

The `docs/architecture.html` we shipped 2026-06-03 describes the Vercel + Neon architecture. Add a note at the top of its §8 (Deployment) section: "As of 2026-06-04, the Vercel + Neon deployment has been retired; everything runs on the Mac with local Postgres + the Tailscale Funnel. See STATE.md for the current architecture."

(Or rewrite §8 entirely — admin's call. The cross-link note is the minimum.)

- [ ] **Step 5: Bump Last verified SHA**

```bash
cd /Users/admin/projects/curriculum_developer
HEAD_SHA=$(git rev-parse --short HEAD)
# Edit docs/STATE.md, change the "Last verified" line to use $HEAD_SHA and date 2026-06-04
```

- [ ] **Step 6: Commit + push**

```bash
git add docs/STATE.md docs/architecture.html
git commit -m "docs(state): record Mac-only migration; remove Vercel/Neon/Resend mentions"
git push
```

---

## Self-review checklist

- ✅ **Spec coverage:** Every architectural element of the proposal has a task — manual-send UI (A1–A5), funnel exposure (B1–B3), DB migration (C1–C4), teardown (D1–D4), final docs (X).
- ✅ **Phase independence:** Each phase is independently shippable. Phase A drops Resend without touching DB or hosting. Phase B flips the URL without touching DB. Phase C migrates DB without touching hosting. Phase D tears down what's no longer load-bearing.
- ✅ **Drain considerations:** Phase B includes an explicit drain check (Task B3) so in-flight Vercel-URL partners aren't stranded.
- ✅ **No placeholders:** Every step has actual code/commands.
- ✅ **Type/name consistency:** `magicLinkUrl`, `markInvited`, `composeEmailHref`, `PartnerRow`, `partnerId` spelled the same way across tasks.
- ✅ **Revertable:** Every commit lands in a typecheck-clean, smoke-tested state. Phase A is fully revertable until Resend code is deleted in D1. Phase B is revertable by flipping `PARTNERS_BASE_URL` back. Phase C is revertable by restoring the Neon DATABASE_URL.

---

## What this plan deliberately doesn't do

- **No partner-side UI changes.** Same welcome / picker / wizard / done screens. Just hosted in a new place.
- **No auto-send via SES/SMTP/etc.** Manual-send is the answer for your volume; deferring auto-send until proven needed.
- **No multi-DB Drizzle setup.** The local-canonical-Postgres draft plan proposed two databases (local + Neon-as-buffer); this plan goes to one DB. Simpler.
- **No partner-facing custom domain.** `*.ts.net` is fine; bookmark-able; cert-valid. If/when a real `partners.gc.clemson.edu` domain is wanted, that's a separate small project.
- **No partner-side telemetry redesign.** The existing `partner_events` table keeps recording opens/submits. Just on local DB now.
- **No reminder-email automation.** Admin sees the "Mark invited" timestamp and decides when to manually nudge. Reminders could be added later if the manual workflow surfaces a need.

---

## Cost model after migration

- **Vercel:** $0 (retired)
- **Neon:** $0 (retired)
- **Resend:** $0 (retired)
- **Tailscale Funnel:** free tier; partner traffic is negligible (~50KB per submission, ~10–30 partners/cycle)
- **OpenAI:** unchanged — only used for faculty AI functions, same as today
- **Postgres.app:** free
- **Operationally:** one machine to keep up, one DB to back up, one cert to rotate (auto via Tailscale)

The architecture's per-month external-service cost drops to zero. The faculty-AI-cost daily cap (`DAILY_COST_CAP_USD`) is the only ongoing variable expense.
