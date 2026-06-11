# Course Categories + Career-Mapping Flag — Design

**Date:** 2026-06-11
**Status:** Proposed
**Supersedes:** nothing (new surface)

---

## Problem

The public landing page (`/`, http://130.127.162.180:3000) lists every course in the GC
curriculum grouped by **course level** (1000/2000/3000/4000 + "Other"). Level is the wrong
organizing axis for two reasons:

1. **It doesn't tell the reader what kind of requirement a course is.** GC 1010 (a core major
   course) and ENGL 1030 (a gen-ed) both sit under "1000-level," but they play completely
   different roles in the degree.
2. **It can't express what builds toward the career.** Q1 ("how well does the curriculum build
   students toward the careers we claim to prepare them for?") is answered by the program
   coverage matrix (`/program`), which today scores **every** captured course's snapshot against
   every career target. But not every course is part of the path we claim: GC Tech electives are
   *optional*, and Major Requirements include *either/or* choices (a student takes STAT 2220 **or**
   STAT 3090, never both). Counting all of them inflates or distorts coverage.

Two things are needed, and they are **not the same thing**:

- **A.** A clean way to *organize and display* courses by their role in the degree.
- **B.** A way to *mark which courses count* toward the career-coverage analysis.

A single `category` field cannot do both. A course's display bucket (e.g. "Specialty Area / GC
Tech") does not determine whether it builds to the career — within a bucket some courses map and
some don't, and the set that maps will eventually be track- and student-dependent. So **B** needs
its own flag, decoupled from **A**.

There is also a third, smaller need the user raised: a way to **add a course** from the landing
page so it can subsequently go through CourseCapture.

---

## Goals

1. Add two **decoupled** columns to `courses`:
   - `category` — a 4-way enum, drives display grouping on the landing page.
   - `builds_to_career` — a boolean, gates inclusion in the career-coverage analysis.
2. Backfill the existing 46 courses: assign each a category; set `builds_to_career = true` for
   the 16 GC Core courses only, `false` for everything else.
3. Reorganize the landing page (`app/page.tsx`) to group by `category` in a fixed display order.
4. Surface an **Add a course** affordance on the landing page that routes through the existing
   Basic-Auth funnel (no new public write path). New courses default to `category = 'other'`,
   `builds_to_career = false`, and are immediately CourseCapture-able.
5. Filter the career-coverage analysis on `builds_to_career` at its two choke points
   (`getMatrixData`, `listStalePairs`) so only flagged courses feed the matrix.

## Non-goals (deferred — see "Deferred" section)

- Alternate **tracks** / swapping courses into "core" to see coverage impact.
- **Per-student** elective-contribution views ("if I take elective X, how does my path change?").
- Rich per-course category/flag editing UI beyond the minimum needed to file a newly-added course.

---

## Data model

Two new columns on the existing `courses` table (`lib/db/schema.ts:81`). Both are decoupled and
independently settable.

### `category` — display bucket

A Postgres enum with four values, plus the column:

```ts
export const courseCategory = pgEnum('course_category', [
  'gc_core',    // GC Core
  'specialty',  // Specialty Area / GC Tech
  'major_req',  // Major Requirements + GenEds
  'other',      // Other courses (default for newly-added courses)
]);

// in courses table:
category: courseCategory('category').notNull().default('other'),
```

**Display order** (fixed, defined in `app/page.tsx`, not by enum order):
GC Core → Specialty Area / GC Tech → Major Requirements + GenEds → Other courses.

`other` is the default so a newly-added course lands in the catch-all bucket with no further action.

### `builds_to_career` — analysis inclusion flag

```ts
buildsToCareer: boolean('builds_to_career').notNull().default(false),
```

Default `false` — a new course does **not** silently enter the career analysis. Near-term, only
the 16 GC Core courses are `true` (set by the backfill). This flag is the **single source of
truth** for "is this course part of the path we claim to build toward."

### `catalog_url` — Clemson course catalog link (optional)

```ts
catalogUrl: text('catalog_url'),  // nullable
```

A link to the course's Clemson catalog entry. **Optional** — a brand-new course may not yet have a
catalog page. Distinct from the existing nullable `syllabus_url` (an instructor's syllabus): the
catalog URL is the institution's official course record. Captured at add-course time and editable
later; rendered as an outbound link on the course view where present.

**Why a boolean and not derived from category:** the set of career-building courses will become
track- and choice-dependent (STAT 2220 *or* STAT 3090; optional GC Tech electives). Category is a
stable display fact; `builds_to_career` is an analysis decision that will later vary per
track/student. They must be able to diverge — e.g. a future track might flip one Specialty course
to `true` without moving it out of the Specialty display bucket.

---

## Categorization (the 46 existing courses)

Cross-checked against the live DB — these 46 codes are exactly what exists, and the assignment
partitions them with no overlaps and no leftovers (16 + 14 + 16 + 0 = 46).

### GC Core (16) — `category='gc_core'`, `builds_to_career=true`
GC 1010, GC 1020, GC 1040, GC 1050, GC 2070, GC 2400, GC 3400, GC 3460, GC 3500, GC 3800,
GC 4060, GC 4400, GC 4440, GC 4480, GC 4500, GC 4800

### Specialty Area / GC Tech (14) — `category='specialty'`, `builds_to_career=false`
GC 3620, GC 3700, GC 3710, GC 3720, GC 3730, GC 3740, GC 3760, GC 3780, GC 3790, GC 4070,
GC 4900ap, GC 4900bl, GC 4900or, GC 4990ta

### Major Requirements + GenEds (16) — `category='major_req'`, `builds_to_career=false`
ACCT 2010, ACCT 2020, MGT 2010, MKT 3010, PKSC 1020, STAT 2220, STAT 2300, STAT 3090, STAT 3300,
ENGL 1030, ENSP 2000, PSYC 2010, ECON 2000, ECON 2110, PCID 3040, PCID 3140

### Other courses (0) — `category='other'`, `builds_to_career=false`
Empty at seed time. Newly-added courses land here by default.

---

## Career-mapping exclusion — design decision (FLAG FOR REVIEW)

**Decision Ⓑ (my stated assumption):** the career-coverage analysis includes a course's snapshot
**iff `builds_to_career = true`**. Near-term that is exactly the 16 GC Core courses. Specialty,
Major Requirements, and Other are all excluded.

This is the user's stated near-term intent ("lets just assume the GC core classes map"). I'm
flagging it explicitly because it has a visible consequence: **the `/program` coverage matrix will
drop from 46 potential course-columns to the GC Core snapshots only.** Major Requirements courses
(STAT, ACCT, etc.) that may currently carry coverage cells will no longer contribute. If you want
Major Requirements *included* in the near-term mapping, that's a one-line change to the backfill
(set their flag `true`) — say so and I'll adjust before implementing.

---

## Migration approach

Standard `db:generate` + `db:migrate`. **No journal surgery.** Verified that both `db:migrate`
(drizzle-kit → `drizzle-orm/node-postgres/migrator`) and the programmatic migrator apply by a
**created_at watermark**: they run only journal entries whose `when` exceeds the max applied
`created_at` (1780677077341 = migration 0031). The drifted hashes on 0003/0022/0023 sit below the
watermark and never re-run; the only entry above it is 0032 (an inert, flag-gated empty
`career_target_demand` table) which applies harmlessly. `db:generate` diffs `schema.ts` against the
snapshot files in `drizzle/meta/`, untouched by the hash drift, so the generated migration will be
a clean `ALTER TABLE courses` (+ enum create).

**Implementation note:** at generate time, read the emitted SQL and confirm it contains *only* the
`category` enum + column and `builds_to_career` column. If `db:generate` emits anything about other
tables, stop — that signals snapshot drift and is out of scope for this feature.

The migration must also **backfill** the 46 courses (a data step inside the migration or an
idempotent seed run immediately after). Putting the `UPDATE … SET category=…, builds_to_career=…`
statements in the migration keeps prod and dev in sync via the normal apply path.

---

## Surfaces touched

### 1. `lib/db/schema.ts`
Add `courseCategory` pgEnum + `category`, `buildsToCareer`, and `catalogUrl` columns to `courses`.

### 2. `drizzle/00NN_*.sql` (generated) + backfill
Generated ALTER + enum, plus `UPDATE courses SET category=…, builds_to_career=…` for the 46 codes,
grouped by category (4 statements using `code IN (…)` lists). `catalog_url` is left NULL on
backfill (no catalog links on record yet).

### 3. `app/page.tsx` — landing page reorg
Replace level-based grouping with category-based grouping in the fixed display order. Each section
header shows the human label ("GC Core", "Specialty Area / GC Tech", "Major Requirements +
GenEds", "Other courses"). Within a section, sort by code. Empty categories render nothing (so
"Other courses" is hidden until a course is added). The per-row View/Edit links are unchanged.

`listCoursesWithStatus()` (`lib/db/capture-status-queries.ts`) must return `category` so the page
can group on it. Add `category: courses.category` to its select + groupBy and to the
`CourseStatusRow`/`CourseWithStatus` type.

### 4. Add-a-course affordance on the landing page
A "+ Add a course" control near the top of `/`. Because `/` is a public, unauthenticated,
read-only surface, it must **not** host a write path. Instead the control is a link to the existing
authenticated roster page on the funnel:
`${funnelOrigin}/courses?slug=${slug}` — the same funnel + slug pattern the per-row "Edit ↗" links
already use. That page already has a working "+ Add a course" form (POST
`/api/admin/courses/roster`, `mode:'one'`). New courses created there inherit the DB defaults
(`category='other'`, `builds_to_career=false`) and immediately appear under "Other courses" with a
"Not started" pill, ready for CourseCapture.

**Add-course form gains an optional Catalog URL field.** Extend the `mode:'one'` path:
`NewCourseInput` + `createCourse` (`lib/db/courses-queries.ts`) and the roster route's `mode:'one'`
branch accept an optional `catalogUrl`; the `/courses` add form (`CourseRosterControls.tsx`) gains
a non-required "Clemson catalog URL" input alongside the existing code/title/level/track fields.
Empty input → NULL. Light validation: if present, must parse as an `http(s)` URL, else 400.

This reuses the existing, tested, auth-gated write path and keeps the public surface read-only.
If `funnelOrigin`/`slug` are unset (local dev without funnel env), the control is hidden — matching
how the page already conditionally renders Edit links and the Faculty hub button.

### 5. Career-coverage filter — `lib/db/program-coverage-queries.ts`
Add `AND c.builds_to_career = true` (or the Drizzle equivalent) at the two choke points so only
flagged courses feed the analysis:

- **`getMatrixData()`** (line 210) — the matrix read. Its SQL already
  `JOIN courses c ON c.code = s.course_code`; add `AND c.builds_to_career` to the WHERE.
- **`listStalePairs()`** (line 103) — the scoring work-list. Its `latestSnapshots` query selects
  from `course_capture_snapshots` without joining `courses`; add a `JOIN courses c ON
  c.code = course_code WHERE c.builds_to_career = true` so excluded courses are never scored
  (avoids wasting AI scoring calls on courses that won't appear in the matrix).

**Important — existing cells:** courses now excluded may already have rows in
`snapshot_target_coverage` from prior scoring. The matrix read filters on the course join, so
excluded courses simply stop appearing — no cell deletion needed. The cells become dormant; if a
course is later flipped back to `true` they reappear without rescoring. (Document this in STATE.md
Deferred/debt: "coverage cells for `builds_to_career=false` courses are retained but hidden.")

### 6. Minimal category/flag editing (RECOMMENDED — flag for review)
Without any edit path, a newly-added course is stranded in "Other" forever and can never be
flagged to build toward the career. The minimum to avoid that dead-end:

- A `PATCH /api/admin/courses/[code]` route (auth via `checkAdminAuth`) accepting
  `{ category?, buildsToCareer?, catalogUrl? }`.
- A small control on the authenticated `/courses` roster page: per course, a category `<select>`,
  a `builds_to_career` checkbox, and a catalog-URL input, independently settable.

This is the smallest thing that makes the two new fields *editable* rather than *seed-only*.
**Alternative (more YAGNI):** ship seed + defaults only, no editing UI, and defer editing until
tracks are built — accepting that added courses stay in "Other"/excluded until then. I recommend
the minimal PATCH + control; flag if you'd rather defer it.

---

## Testing

- **Schema/migration:** a test asserting the 46 courses have the expected `category` +
  `builds_to_career` after backfill (counts per category: 16/14/16/0; `builds_to_career` true
  count = 16).
- **`getMatrixData` / `listStalePairs`:** with a fixture of courses spanning all four categories +
  both flag values, assert only `builds_to_career=true` courses appear in matrix courses / stale
  pairs.
- **Landing page:** render test asserting sections appear in the fixed order and a course lands in
  the right section; empty "Other" section is not rendered.
- **PATCH route (if included):** auth rejection without slug/token; successful category + flag
  update; flag and category settable independently.
- Run the full suite — this touches `courses` schema, capture-status query shape, and program
  queries, so expect to update existing fixtures/assertions that select from `courses`.

---

## Deferred

- **Track modeling** — alternate tracks; swapping courses into/out of the career-building set to
  see coverage impact. `builds_to_career` is the seam this will hang off (a future `track_courses`
  join table, or a per-track override of the boolean).
- **Per-student elective-contribution view** — "if I take elective X, how does my path fill in?"
- **Coverage cells for excluded courses** are retained-but-hidden (not deleted) — noted above; a
  future cleanup could prune them, but retention is cheaper and reversible.

---

## STATE.md updates on commit

- Schema change (2 columns + 1 enum on `courses`) → schema/migration trigger.
- New AI-scoring scope (matrix now gated on `builds_to_career`) → "What's live" note.
- New route `PATCH /api/admin/courses/[code]` (if included) → routes trigger.
- Deferred/debt: track modeling; per-student elective view; retained-but-hidden excluded cells;
  the Ⓑ exclusion decision (GC Core only maps, near-term).
