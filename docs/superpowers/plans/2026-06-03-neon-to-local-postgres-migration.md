# Neon → Local Postgres migration

> **Status:** drafted, awaiting scope confirmation. Not started.

**Goal.** Move the curriculum-tool's data layer from Neon (cloud) to a local Postgres on the host Mac, except for the partner-facing magic-link survey, which stays on Neon so the Vercel `/partners/*` deploy continues to function.

**Architecture (one paragraph).** Today the app uses a single Neon Postgres for every table. After this migration: two databases. **Local** (Postgres.app on the host Mac, port `5432`, `gc_curriculum` db) holds all faculty-facing data — courses, materials, profiles, snapshots, capture transcripts, explore targets, AI settings, coverage scores, rate-limit tables. **Neon** keeps only the small set of partner-facing tables — `partners`, `partner_sessions`, `partner_events`, `partner_submissions`, plus the reference tables both sides read (`career_targets`, `sub_competencies`). Drizzle gets two clients (`dbLocal`, `dbPartners`); each query file imports the right one. No cross-DB joins — the small number of queries that need data from both run two fetches and merge in JS. Backups: local DB gets its own pg_dump cron (existing pg_dump → local). Neon partner data gets a smaller pg_dump cron + retains Neon's own PITR for free.

**Tech stack.** Postgres.app 16 (or `postgresql@16` via Homebrew), Drizzle ORM (already in use, two configs), the existing `lib/db/client.ts` split into `client-local.ts` + `client-partners.ts`.

---

## Why migrate

- **Data sovereignty.** Faculty audits ingest course materials including syllabi, rubrics, occasionally student-facing assignments. Storing this on a third-party cloud (Neon) is a soft FERPA exposure even when the data is technically benign. Local DB removes it.
- **Cost ceiling.** Neon's free tier has compute-hour limits; the heavy ingest + capture + scoring traffic is faculty-facing and grows with adoption. Hosting locally removes the meter.
- **Failure-mode alignment.** Faculty surfaces already depend on the Mac being up (Next.js, omlx, Docling, whisper.cpp, Weaviate). The DB being on the Mac doesn't add a failure mode — it consolidates an existing one.
- **Latency.** Local Postgres on the same machine as the app server is sub-millisecond; Neon adds 50–100ms per query times N queries per page.

## Why partner-facing stays on Neon

- The `/partners/*` magic-link survey is served by Vercel for partner accessibility (partners are external to Clemson; they can't hit a LAN IP).
- Vercel functions need a reachable DB. Neon (free tier covers this workload) provides one. Pointing the Vercel side at the local Mac would require either a public-facing local DB (security nightmare) or a tunnel (extra moving piece).
- The partner data volume is small (handful of partner rows, dozens of submissions per career target) — well within Neon's free tier indefinitely.

## What stays where

### Local (host Mac Postgres)

Everything faculty-facing:

- `courses` — catalog
- `course_materials` — uploaded + Canvas + YouTube transcripts
- `course_capture_profiles` — draft profiles
- `course_capture_snapshots` — immutable historical records
- `capture_messages` — append-only chat transcripts
- `capture_conversations` — v1 conversation rows
- `course_profiles` + `course_profile_runs` — Course Builder profiles
- `course_kuds` + `course_kud_runs` — legacy KUD chart authoring
- `coverage_scores` — legacy coverage runs
- `course_explore_targets` + `course_explore_analyses` + `course_explore_what_ifs`
- `snapshot_target_coverage` — Phase 1A matrix scores
- `synthesis_runs` — Phase 1B synthesis (computed locally; only consumes partner data)
- `ai_function_settings` — per-function model overrides
- `daily_cost` — AI-cost rate limit (faculty-facing path only)
- `ip_hourly` — IP rate limit (faculty-facing path; partner-side has its own)
- `sheet_sync_state` — Google Sheets catalog sync state

### Neon (partner-facing)

- `partners` — partner directory + magic-link tokens
- `partner_sessions` — survey session tokens
- `partner_events` — survey telemetry
- `partner_submissions` — what partners submit

### Reference data — single source of truth on Neon (read by both)

- `career_targets` — career destinations the program prepares students for
- `sub_competencies` — the KUD sub-competencies under each target

These are slowly-changing reference data (~12 targets total) edited by Chip via admin tooling. Partners need them at submission time; faculty need them for program coverage. **Keeping on Neon is simpler** than mirroring — faculty's local app reads these from Neon over the network on the rare query that needs them. ~12 rows, ~50ms — fine.

### Legacy (delete during migration, don't bother moving)

- `prototype_target_edits` — M-trial era, dead
- `prototype_runs` — M-trial era, dead
- `prototype_flags` — M-trial era, dead

---

## Pre-implementation decisions (need Chip's sign-off)

### Decision 1: Local Postgres install

Three options. **Recommend Postgres.app** — zero configuration, GUI, runs as a normal Mac app.

| Option | Setup | Management |
|---|---|---|
| **Postgres.app** | Download .app, drag to Applications. Built-in launchd integration. | GUI for start/stop, includes psql + pgAdmin equivalents |
| Homebrew `postgresql@16` | `brew install postgresql@16 && brew services start` | Command-line, integrates with brew |
| Docker | `docker run -d --restart=always …` | Docker Desktop overhead, more isolation |

### Decision 2: Reference data placement (`career_targets`, `sub_competencies`)

**Recommend keeping on Neon as the single source of truth.** Alternative: move to local, partners sync. Mirror complexity > the cost of 50ms per faculty query.

### Decision 3: Cross-DB synthesis (`synthesis_runs`)

`/admin/synthesis` reads `partner_submissions` (Neon) + writes `synthesis_runs`. **Recommend** `synthesis_runs` on **local** (it's faculty-consumed analysis); the admin route fetches submissions from Neon over the network when synthesizing. The synthesis call already takes 30s+ — adding 50ms of network is irrelevant.

### Decision 4: Migration cutover

**Recommend a one-shot cutover during a quiet window** (evening, no active faculty audits). The faculty-facing app stops for ~10 min while we copy data and flip the env var.

Alternative: dual-write transition. Significantly more work, only worth it if downtime is a real problem. For a one-faculty-cohort pilot, the 10 min isn't worth the complexity.

---

## File structure

```
lib/db/
  client-local.ts       (NEW — Drizzle client → LOCAL_DATABASE_URL)
  client-partners.ts    (NEW — Drizzle client → PARTNERS_DATABASE_URL, was Neon)
  client.ts             (DELETE — split into the two above)
  schema-local.ts       (NEW — table defs moved off shared schema)
  schema-partners.ts    (NEW — partners + reference tables)
  schema.ts             (DELETE — split)
drizzle/                (current migrations — split into local-only + partners-only sets)
  local/                (NEW — all the migrations that built local-side tables)
  partners/             (NEW — partner-table migrations)
drizzle.config.ts       (REPLACE — point at local-only schema for default codegen)
drizzle.config.partners.ts (NEW — partners-only schema, generates partners migrations)

scripts/
  setup-local-db.sh     (NEW — one-shot: createdb gc_curriculum, run migrations)
  migrate-neon-to-local.ts (NEW — copies the moving tables, neon → local)
```

All `lib/db/*-queries.ts` files import from the right client based on which tables they touch. Most files end up touching only one DB; the few mixed ones (synthesis, program coverage when surfacing partner stats) explicitly import both and merge in JS.

---

## Task 1: Install + provision local Postgres

**Files:** `scripts/setup-local-db.sh` (new), `.env.local` (modified)

- [ ] **Step 1: Install Postgres.app**

```bash
# Manual step — confirm via:
which postgres
# expect /Applications/Postgres.app/Contents/Versions/latest/bin/postgres
# add to PATH if Postgres.app isn't already there
```

- [ ] **Step 2: Create local DB**

```bash
createdb gc_curriculum
```

- [ ] **Step 3: Add `LOCAL_DATABASE_URL` to `.env.local`**

```
LOCAL_DATABASE_URL=postgresql://admin@localhost:5432/gc_curriculum
PARTNERS_DATABASE_URL=postgresql://...neon...   # rename the existing DATABASE_URL
```

Keep the old `DATABASE_URL` as an alias for `LOCAL_DATABASE_URL` to avoid breaking any one-off scripts that hard-code it; mark deprecated in the env-example.

- [ ] **Step 4: Verify connectivity**

```bash
psql gc_curriculum -c 'select 1'
```

- [ ] **Step 5: Commit `scripts/setup-local-db.sh`** wrapping steps 2-4 so a fresh machine can be brought up with one script.

---

## Task 2: Split the schema

**Files:** `lib/db/schema.ts` (delete), `lib/db/schema-local.ts` (new), `lib/db/schema-partners.ts` (new)

- [ ] **Step 1: `schema-partners.ts` contains:**
  - `partners`, `partnerSessions`, `partnerEvents`, `partnerSubmissions`
  - `careerTargets`, `subCompetencies` (reference data)

- [ ] **Step 2: `schema-local.ts` contains:** everything else, minus the legacy `prototype_*` tables (which get dropped, not moved).

- [ ] **Step 3: Update every `from '@/lib/db/schema'` import** across the codebase to one of the new two paths. The TypeScript compiler will surface every site; mechanical fix.

- [ ] **Step 4: Verify** `pnpm exec tsc --noEmit` is clean.

- [ ] **Step 5: Commit**

---

## Task 3: Split the Drizzle client

**Files:** `lib/db/client.ts` (delete), `lib/db/client-local.ts` (new), `lib/db/client-partners.ts` (new)

- [ ] **Step 1: `client-local.ts`** — same as current `client.ts` but reads `LOCAL_DATABASE_URL`. Exports `db` (kept as the default so most call sites don't need changes — the LOCAL db is the default).

- [ ] **Step 2: `client-partners.ts`** — reads `PARTNERS_DATABASE_URL`. Exports `dbPartners`.

- [ ] **Step 3: Add a barrel `client.ts`** that re-exports both for any call site that needs both:

```typescript
export { db } from './client-local';
export { dbPartners } from './client-partners';
```

- [ ] **Step 4: Update partner-touching queries** (`lib/db/partners-queries.ts`, `lib/db/partner-submissions-queries.ts`, `lib/db/career-targets-queries.ts`, `lib/db/sub-competencies-queries.ts`) to import from `client-partners` instead of the default `db`. Use `dbPartners` directly in those files.

- [ ] **Step 5: Commit**

---

## Task 4: Split the migrations

**Files:** `drizzle/` (reorganize), `drizzle.config.ts` + `drizzle.config.partners.ts`

This is the trickiest task. Existing migrations 0000-0026 are a mixed history. Two approaches:

| Approach | Description | Tradeoff |
|---|---|---|
| **A. Reset to baseline** | Snapshot the current schema as a single new migration `0000_baseline.sql` per database. Wipe old migration files. | Clean. Loses the migration history but we have it in git. |
| **B. Split in place** | Per migration, mark whether it touches local-only / partners-only / both. The "both" ones get split into two files. | Preserves history. Painful — 27 migrations to triage. |

**Recommend A.** The drizzle migration history is internal — git already preserves the actual history.

- [ ] **Step 1: Generate baseline migrations**

```bash
# Wipe + regenerate
rm -rf drizzle/
mkdir -p drizzle/local drizzle/partners
pnpm exec drizzle-kit generate --config drizzle.config.ts            # → drizzle/local/0000_baseline.sql
pnpm exec drizzle-kit generate --config drizzle.config.partners.ts   # → drizzle/partners/0000_baseline.sql
```

- [ ] **Step 2: Verify** the generated SQL covers all the right tables for each side.

- [ ] **Step 3: Apply local migration to the fresh local DB**

```bash
pnpm exec drizzle-kit migrate --config drizzle.config.ts
```

- [ ] **Step 4: Verify** every table exists on local with `\dt` in psql.

- [ ] **Step 5: Commit**

---

## Task 5: Backfill data Neon → local

**Files:** `scripts/migrate-neon-to-local.ts` (new)

- [ ] **Step 1: Write the migration script**

For each table moving local:

```typescript
// Copy by streaming rows from Neon and inserting into local.
// Use ON CONFLICT DO NOTHING in case the script is re-run.
const rows = await dbPartners.execute(sql`SELECT * FROM ${tableName}`);
for (const row of rows.rows) {
  await db.execute(sql`INSERT INTO ${tableName} VALUES (${row.col1}, ...) ON CONFLICT (id) DO NOTHING`);
}
```

Order matters for foreign keys: `courses` before `course_materials`, snapshots before snapshot-derived tables, etc. Encode the order in the script.

- [ ] **Step 2: Dry-run on a copy**

```bash
# Verify counts match
pnpm exec tsx --env-file=.env.local scripts/migrate-neon-to-local.ts --dry-run
```

- [ ] **Step 3: Run for real**

```bash
pnpm exec tsx --env-file=.env.local scripts/migrate-neon-to-local.ts
```

- [ ] **Step 4: Spot-check** a course's full profile + materials + snapshots load via the local DB.

- [ ] **Step 5: Commit the script** (idempotent — can be re-run if the cutover gets messy).

---

## Task 6: Cutover

- [ ] **Step 1: Announce window.** Faculty get a heads-up. Auto-set the app to a maintenance message during the cutover? (Optional — for a small cohort, just do it during a quiet window.)

- [ ] **Step 2: Stop the launchd Next.js service**

```bash
launchctl bootout gui/501/com.gc.curriculum-tool
```

- [ ] **Step 3: Re-run migrate-neon-to-local.ts** to catch any rows written between the dry-run and now.

- [ ] **Step 4: Restart Next.js**

```bash
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.gc.curriculum-tool.plist
```

- [ ] **Step 5: Smoke test:** open `/capture/GC 4800`, verify the existing profile + materials load. Open `/partners/<token>` (via Vercel URL), verify the partner survey still works.

- [ ] **Step 6: Monitor** for 24 hours.

---

## Task 7: Backups update

**Files:** existing `pg-backup` launchd plist + `scripts/pg-backup.sh`

- [ ] **Step 1: Split the backup script** into local + partners halves. Each pg_dumps its respective DB.

- [ ] **Step 2: Update launchd plist** to run both.

- [ ] **Step 3: Verify** the next scheduled run produces both dumps cleanly.

- [ ] **Step 4: Commit**

---

## Task 8: STATE.md + CLAUDE.md update

- [ ] STATE.md: schema-management section gets a "two databases" subsection. List which tables live where.
- [ ] CLAUDE.md: architecture paragraph notes local-first, partner-on-Neon split.
- [ ] Commit

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Local Postgres goes down with the Mac | Same failure mode as the Next.js dev server. Already mitigated by the launchd watchdog (extend to monitor Postgres as well). |
| Backup discipline becomes critical (no Neon PITR for local) | Existing pg-backup cron + GitHub-backed retention. Add a Neon `pg_dump` of the partner-only tables for parity. |
| Mistakes during the table split (a table imported from the wrong client) | TypeScript catches most. Smoke tests catch the rest. The cutover-day plan includes spot-checks on each major surface. |
| Reference data drift between Neon and local if we ever cache locally | Avoided by keeping reference data on Neon as single source. |
| Future need to host externally (open the tool up to non-Clemson use) | A move back to managed Postgres later is straightforward — same Drizzle schema, just point env vars elsewhere. The two-DB split actually makes a future move easier, not harder. |

---

## Open questions for Chip

1. Confirm "career capture piece" means **partner-facing survey** (`/partners/*` + `partner_*` tables + reference data). Yes/no.
2. Postgres.app vs. Homebrew vs. Docker — preference?
3. Reference data on Neon (recommended) vs. local-with-sync — preference?
4. Cutover window — any time blocks faculty would notice 10 minutes of downtime?

Once those four are answered, I can execute Task 1 immediately and ship the rest in the order listed. Estimated wall-clock: half-day of focused work + a quiet-window cutover.
