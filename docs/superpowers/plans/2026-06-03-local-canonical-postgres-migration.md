# Local-canonical Postgres migration (Neon as partner-handoff buffer)

> **Supersedes** [`2026-06-03-neon-to-local-postgres-migration.md`](./2026-06-03-neon-to-local-postgres-migration.md). The prior plan kept partner data + reference tables canonical on Neon. After Chip's "partner survey is one-time per employer, then feed info to local" framing, the architecture flips: **local Mac is the canonical store for everything**, and **Neon is reduced to a transient handoff buffer** for the partner survey only.

**Goal.** Migrate the data layer so local Postgres on the host Mac is the single source of truth for the entire curriculum tool. Vercel-served partner survey (`/partners/*`) writes to a small Neon buffer; faculty side ingests from that buffer into local on a schedule (and on demand).

**Architecture in one paragraph.** All faculty-facing tables (courses, materials, profiles, snapshots, capture transcripts, explore, AI settings, rate limits) live on **local Postgres** (Postgres.app on the host Mac). Career targets + sub-competencies + the partner directory **also** canonical on local — Chip edits them in faculty-facing admin tooling. When a partner magic-link is issued, a one-shot push writes the partner row + a snapshot of reference data to Neon so the Vercel-served survey can render. Partners fill out the survey and submit; data lands on Neon. A launchd cron (and an admin-facing "Pull new submissions" button) ingests `partner_submissions` from Neon to local every ~5 minutes. Once ingested, local owns the canonical copy; the Neon row stays as a backup but isn't authoritative.

**Tech stack.** Postgres.app 16 (per Chip's pref, Decision 2 of the prior plan). Drizzle ORM with two clients (`dbLocal` = default `db`, `dbNeon` = partner-handoff buffer). Existing pg-backup cron extends to cover both.

---

## Why this beats the prior plan

| Prior plan | This plan |
|---|---|
| `career_targets`/`sub_competencies` canonical on Neon, faculty reads cross-DB | Both canonical on local, snapshot pushed to Neon when a magic-link is issued |
| Two ever-live DBs both load-bearing | Local load-bearing; Neon is a buffer with bounded retention |
| Faculty queries the Neon client for reference data (~50ms per page) | Faculty queries local (~0ms); no cross-DB at faculty surfaces |
| Synthesis reads `partner_submissions` from Neon | Synthesis reads the ingested local copies |
| Mirror complexity for reference data | Push-on-link-generation (one direction, on demand) |

Cleaner mental model: **the partner survey is an ingest pipeline, structurally like Canvas import — external data enters the local system, gets ingested, then everything happens locally.**

---

## Data flow per partner (the whole lifecycle)

```
                                       LAN Mac
       ┌─────────────────────────────────────────────────────────────┐
       │  Local Postgres (canonical for EVERYTHING)                  │
       │  • all faculty tables                                       │
       │  • career_targets, sub_competencies (canonical)             │
       │  • partners directory + magic-link tokens (canonical)       │
       │  • partner_submissions (ingested from Neon)                 │
       └──────┬────────────────────────────────────▲─────────────────┘
              │ (1) on issue-magic-link:           │ (3) cron: poll Neon
              │     pushPartnerSetup(partnerId)    │     for new partner_submissions,
              │     copies partner row +           │     copy into local
              │     reference snapshot to Neon     │
              ▼                                    │
       ┌─────────────────────────────────────────────────────────────┐
       │  Neon (partner-handoff buffer)                              │
       │  • partners            (one row per issued link)            │
       │  • partner_sessions    (live session telemetry)             │
       │  • partner_events                                            │
       │  • partner_submissions (where partner writes)               │
       │  • career_targets      (snapshot for survey UI)             │
       │  • sub_competencies    (snapshot for survey UI)             │
       └────────────────────────▲────────────────────────────────────┘
                                │ (2) partner browser → Vercel → Neon
                       ┌────────┴──────────┐
                       │  Partner browser  │
                       └───────────────────┘
```

### Three sync touchpoints

1. **Issue magic link** (faculty admin action on LAN) → push partner row + reference snapshot to Neon. On-demand; sync function: `pushPartnerSetup(partnerId)`.
2. **Partner submits** (Vercel route → Neon, no change). Happens once per partner.
3. **Ingest** (local cron every ~5 min + admin "Pull now" button) → copy any new `partner_submissions` from Neon into local. Sync function: `ingestPartnerSubmissions()`.

After ingest, local owns the canonical submission. Neon retains a copy (cheap; useful as a backup), but it's not authoritative.

---

## What stays where, definitively

### Local Postgres (host Mac) — canonical for all

Everything in the current `lib/db/schema.ts`, MINUS the legacy `prototype_*` tables (dropped during migration; M-trial dead code), PLUS the partner-survey tables. So: every current table that isn't a prototype legacy carryover.

### Neon — buffer only

- `partners` (the rows for any partner with an outstanding or recently-completed link — pushed there by `pushPartnerSetup`)
- `partner_sessions`, `partner_events` (live during the session; not pulled back, just retained for debugging)
- `partner_submissions` (where the partner writes; ingested back to local)
- `career_targets`, `sub_competencies` (snapshot mirrored at link-issue time so the survey can render)

The Neon copy is **deliberately not authoritative**. If Neon's down between issuing a link and the partner using it, that link breaks — but Chip can re-issue it once Neon is back. Partner data ingested to local stays valid even if Neon is wiped.

### Dropped during migration

- `prototype_target_edits`, `prototype_runs`, `prototype_flags` — M-trial dead code, not used by any current surface

---

## File structure (after migration)

```
lib/db/
  client.ts                (default db: LOCAL_DATABASE_URL)
  client-neon.ts           (NEW — dbNeon: NEON_DATABASE_URL, partner handoff only)
  schema.ts                (unchanged — all tables defined here, both DBs run the same schema)

lib/partner-sync/
  push-partner-setup.ts    (NEW — called when admin issues a magic link)
  ingest-submissions.ts    (NEW — called by cron + admin button)

scripts/
  setup-local-db.sh        (NEW — createdb, run migrations, set sane defaults)
  migrate-neon-to-local.ts (NEW — one-shot: copy all current Neon data into local)
  partner-sync-cron.sh     (NEW — launchd-driven, calls ingest-submissions every 5 min)

~/Library/LaunchAgents/
  com.gc.partner-sync.plist (NEW — runs partner-sync-cron.sh every 5 min)
```

**Key design choice:** both databases run the SAME Drizzle schema. Only a few tables are *actively used* on Neon at any one time (the partner-related ones); the rest exist there as empty/historical from the migration but stay there. Schema parity keeps Drizzle simple — no fork of `schema.ts`, no two configs.

---

## Decisions baked in (from Chip's responses)

1. ✓ **"Career capture piece" = partner-facing survey.**
2. ✓ **Local Postgres = Postgres.app.**
3. ✓ **Architecture: local-canonical with Neon as buffer** (revised from prior plan's reference-on-Neon model).
4. ✓ **Cutover = one-shot during quiet window** (~10 min downtime acceptable).

---

## Task 1: Install + provision local Postgres

**Files:** `scripts/setup-local-db.sh` (new), `.env.local` (modified)

- [ ] **Step 1:** Install Postgres.app — download .app, drag to Applications, launch.

```bash
# Add the bin dir to PATH so `psql`, `createdb` etc. resolve
echo 'export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
which psql
# expect /Applications/Postgres.app/Contents/Versions/latest/bin/psql
```

- [ ] **Step 2:** Create local DB

```bash
createdb gc_curriculum
psql gc_curriculum -c 'select version()'
# expect PostgreSQL 16.x on aarch64-apple-darwin
```

- [ ] **Step 3:** Add `LOCAL_DATABASE_URL` to `.env.local`; rename existing `DATABASE_URL` to `NEON_DATABASE_URL` for clarity. Keep `DATABASE_URL` as an alias for `LOCAL_DATABASE_URL` so legacy one-off scripts still work.

```
LOCAL_DATABASE_URL=postgresql://admin@localhost:5432/gc_curriculum
NEON_DATABASE_URL=postgresql://...neon...
DATABASE_URL=${LOCAL_DATABASE_URL}   # alias for legacy scripts
```

- [ ] **Step 4:** Verify connectivity with a one-line node test.

- [ ] **Step 5:** Commit `scripts/setup-local-db.sh` wrapping the createdb + PATH instructions so a fresh machine can be brought up with one script.

---

## Task 2: Split the Drizzle client

**Files:** `lib/db/client.ts` (modified), `lib/db/client-neon.ts` (new)

Schema stays unified (one `schema.ts`); only the client splits.

- [ ] **Step 1:** Rename current `client.ts` content into using `LOCAL_DATABASE_URL`. Continue exporting `db`.

- [ ] **Step 2:** Create `client-neon.ts`. Same Drizzle setup, points at `NEON_DATABASE_URL`. Exports `dbNeon`.

```typescript
// lib/db/client-neon.ts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

const url = process.env.NEON_DATABASE_URL;
if (!url) throw new Error('NEON_DATABASE_URL not set — required for partner-handoff buffer');
export const dbNeon = drizzle(neon(url), { schema });
```

- [ ] **Step 3:** Verify `pnpm exec tsc --noEmit` clean.

- [ ] **Step 4:** Commit.

---

## Task 3: Apply schema to local

**Files:** existing `drizzle/` directory (no changes — same migrations run against both DBs)

- [ ] **Step 1:** Run the existing migration sequence against local. The same migrations Neon has applied will recreate the schema on local.

```bash
DATABASE_URL=postgresql://admin@localhost:5432/gc_curriculum \
  pnpm exec drizzle-kit migrate
```

- [ ] **Step 2:** Verify all tables exist (`psql gc_curriculum -c '\dt'`).

- [ ] **Step 3:** No commit (no file changes).

---

## Task 4: Backfill data Neon → local

**Files:** `scripts/migrate-neon-to-local.ts` (new)

- [ ] **Step 1:** Write the migration script. For each table (excluding `prototype_*`):

```typescript
// Pull from Neon, insert into local. ON CONFLICT (id) DO NOTHING so the
// script is idempotent — re-runnable if interrupted.
import { dbNeon } from '@/lib/db/client-neon';
import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

const TABLES_IN_ORDER = [
  // FK-dependent order: parents before children
  'courses',
  'course_materials',
  'course_capture_profiles',
  'course_capture_snapshots',
  'capture_messages',
  // ... (every non-prototype table)
];

for (const tableName of TABLES_IN_ORDER) {
  const rows = await dbNeon.execute(sql.raw(`SELECT * FROM ${tableName}`));
  let copied = 0;
  for (const row of rows.rows) {
    const cols = Object.keys(row);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    const values = cols.map(c => row[c]);
    const conflict = cols.includes('id') ? 'ON CONFLICT (id) DO NOTHING' : '';
    await db.execute(sql.raw(
      `INSERT INTO ${tableName} (${cols.join(',')}) VALUES (${placeholders}) ${conflict}`,
      values,
    ));
    copied++;
  }
  console.log(`${tableName}: ${copied} rows copied`);
}
```

- [ ] **Step 2:** Dry-run with `--dry-run` flag (count rows per table; no inserts). Verify against Neon counts.

- [ ] **Step 3:** Run for real. Logs the per-table copy count.

- [ ] **Step 4:** Spot-check via psql: a course's full profile + materials + snapshots load via the local DB.

- [ ] **Step 5:** Commit the script (idempotent — can be re-run during cutover to catch deltas).

---

## Task 5: Partner-sync code

**Files:** `lib/partner-sync/push-partner-setup.ts` (new), `lib/partner-sync/ingest-submissions.ts` (new)

### `pushPartnerSetup(partnerId)`

Called from the admin route that issues a magic link. Pushes:
- The partner row (from local) into Neon
- A snapshot of `career_targets` + `sub_competencies` (upserted — Neon's copy gets overwritten each time so it always reflects the most recent canonical state)

- [ ] **Step 1:** Write the function. Use `dbNeon` for writes; `db` for reads.

- [ ] **Step 2:** Wire into existing admin partner-create route (currently writes directly to Neon — switch it to write local first, then call `pushPartnerSetup`).

- [ ] **Step 3:** Test: create a new test partner via admin UI; verify the partner row + reference data appear on Neon.

- [ ] **Step 4:** Commit.

### `ingestPartnerSubmissions()`

Polls Neon for `partner_submissions` rows whose `id` isn't in local. Copies them across.

- [ ] **Step 1:** Write the function.

- [ ] **Step 2:** Add an admin route `POST /api/admin/partners/ingest-submissions` that calls it. Returns counts.

- [ ] **Step 3:** Add the launchd plist `com.gc.partner-sync.plist` running `scripts/partner-sync-cron.sh` every 5 minutes; script calls the API route locally (or invokes a thin tsx wrapper).

- [ ] **Step 4:** Test: submit via a test partner survey; verify ingest pulls it within 5 min OR via the manual button immediately.

- [ ] **Step 5:** Commit.

---

## Task 6: Cutover

- [ ] **Step 1:** Announce window (evening, no active faculty audits).

- [ ] **Step 2:** Stop the launchd Next.js service.

- [ ] **Step 3:** Re-run `migrate-neon-to-local.ts` to catch any deltas since the dry-run.

- [ ] **Step 4:** Set `DATABASE_URL` env var to point at local (`LOCAL_DATABASE_URL` value).

- [ ] **Step 5:** Restart Next.js via launchd.

- [ ] **Step 6:** Smoke test:
  - `/capture/GC 4800` — existing profile + materials load
  - `/explore/GC 4400` — existing snapshots + targets load
  - `/program` — coverage matrix loads
  - `/wiki` — wiki index loads
  - `/partners/<existing-token>` (via Vercel URL) — partner survey still renders

- [ ] **Step 7:** Issue a new test magic link via admin UI; verify `pushPartnerSetup` pushes to Neon and the survey works.

- [ ] **Step 8:** Submit the test survey; verify `ingestPartnerSubmissions` pulls it to local within 5 min.

- [ ] **Step 9:** Monitor for 24 hours.

---

## Task 7: Backups update

**Files:** existing `pg-backup` launchd plist + `scripts/pg-backup.sh`

Local DB now has the canonical data → backup priority shifts to local.

- [ ] **Step 1:** Modify `scripts/pg-backup.sh` to dump the local DB (full). Neon backup becomes optional / smaller cadence since it's a transient buffer.

- [ ] **Step 2:** Verify the next scheduled run produces a local dump cleanly.

- [ ] **Step 3:** Commit.

---

## Task 8: STATE.md + CLAUDE.md update

- [ ] STATE.md: schema-management section gets a "two databases" subsection. Local-canonical model documented. Mention partner-handoff sync touchpoints (push-on-issue, ingest-cron).
- [ ] CLAUDE.md: architecture paragraph notes local-first Postgres + Neon-as-buffer.
- [ ] Commit.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Local Postgres goes down with the Mac | Same failure mode as Next.js dev server. Extend the existing launchd watchdog to monitor Postgres. |
| Partner submission lost between Neon write and local ingest | Two-layer defense: (a) Neon retains the row for ≥30 days; (b) ingest is idempotent + cron'd every 5 min + admin "Pull now" button for manual recovery. |
| Reference data drift between local (canonical) and Neon (snapshot) when Chip edits | Edits push to Neon synchronously via the existing admin-edit route — same mechanism as `pushPartnerSetup`. Stale Neon = stale survey but no faculty-side impact. |
| Cutover misses some writes during the ~10 min window | The migration script is idempotent. Step 3 of cutover re-runs it after stopping Next.js, catching any in-flight writes. |
| Cron fails silently → submissions pile up in Neon, unseen by faculty | Cron logs to `~/.local/state/gc-curriculum-tool/partner-sync.log`. Admin UI surfaces "Last successful ingest: T" + a manual button. Watchdog cron checks ingest is fresh. |

---

## Open questions (none — Chip's input received)

Plan is ready to execute in order: Task 1 (install) → 2 (client split) → 3 (apply schema to local) → 4 (backfill) → 5 (partner-sync code) → 6 (cutover) → 7 (backups) → 8 (docs).

Estimated wall-clock: 4-5 hours of focused work + a quiet-window cutover.

Want me to start Task 1?
