# Structured Course Identity + Lecture/Lab Bundling — Design

**Date:** 2026-06-13
**Status:** approved design (operator brainstorm 2026-06-13), pre-plan
**Origin:** Operator: courses should store prefix / number / title as separate fields (today `courses.code` is a single combined text PK); and paired lecture+lab courses (e.g. GC 3460 lecture + GC 3461 lab) should be capturable as one unit — including importing two separate Canvas pages — with the add-a-course flow capturing the prefix + number(s).

## Decisions made in the brainstorm

1. **Two separable changes.** Decision A (structured identity) is independent of and cheaper than Decision B (bundling); both ship in this increment but are designed separately.
2. **Decision A — additive, do NOT split the PK.** `courses.code` ("GC 3460") stays the canonical primary key and the target of all **17 existing foreign keys**. Splitting the PK would mean rewriting every relationship for no functional gain. Add parsed columns alongside it.
3. **Decision B — "refined Option 3": one capture unit, paired codes in a child table.** Rejected Option 1 (bundles as first-class grouping with bundle-level retrieval/snapshot/matrix) because it is a cross-cutting rewrite of the unit-of-capture (Weaviate tenant, `capture_messages` session, snapshot identity, the matrix `DISTINCT ON (course_code)`) — all keyed on a single `courseCode` today. Refined Option 3 leaves the entire capture pipeline and matrix **unchanged**, and the child-table shape preserves a clean data-migration path to Option 1 if a real need for an independently-existing lab ever appears.
4. **Combined retrieval for free.** Lab-page materials live in the **primary course's single Weaviate tenant**, tagged by `source_code` for provenance display. The audit agent already retrieves across the whole tenant → it sees lecture + lab together with zero pipeline change.
5. **Canvas UI — one bundle-aware box** (not two boxes): per-page import *slots* in the header, items grouped by source when unrolled, course-level actions once in the footer. Non-bundled courses render exactly as today.

## Schema (one migration, additive — `code` PK + all FKs untouched)

`courses` gains three structured-identity columns:
- `prefix` text NOT NULL default `''` — e.g. `GC`, `ACCT`, `PCID`.
- `course_number` text NOT NULL default `''` — e.g. `3460`. **Text, not int** — preserves the data as written and composes with the suffix.
- `number_suffix` text NOT NULL default `''` — e.g. `` / `ap` / `ta` / `bl` (real values already in the roster: `GC 4900ap`, `GC 4990ta`, `GC 4900bl`, `GC 4900or`).

Backfilled by parsing `code` (see Parser). `level` is left as-is (already stored; derivable but not worth churning).

New child table `course_codes` (the lightweight "bundle"):
```
id              uuid PK default random
course_code     text NOT NULL  → courses.code  (ON DELETE CASCADE)   -- the PRIMARY course this paired code belongs to
paired_code     text NOT NULL                                        -- e.g. 'GC 3461' (the lab); NOT a courses row
role            text NOT NULL  -- 'lecture' | 'lab' | 'other'        -- the paired component's role
canvas_course_name  text                                             -- nullable; provenance of THIS page's Canvas import
canvas_imported_at  timestamptz                                      -- nullable; when THIS page was imported
created_at      timestamptz NOT NULL default now()
unique (paired_code)                                                 -- a paired code maps to one primary
index (course_code)
```
Only **paired** (secondary) codes get rows here — the primary lives on `courses`. A bundled course = a `courses` row that has ≥1 `course_codes` row. `pgEnum course_code_role` for `role`.

`course_materials` gains:
- `source_code` text **nullable** — the code the material was imported under; `null` ⇒ the primary course code. Lab-page imports stamp the lab's code. All rows keep `course_code` = the primary (so the existing tenant/retrieval/FK model is unchanged); `source_code` is provenance only.

Migration is additive (new columns with defaults + new table). Anti-drift test pins the backfill to the canonical parser (mirrors `course-category-migration.test.ts`).

## Parser — `lib/courses/parse-course-code.ts` (pure, unit-tested)

```
parseCourseCode(code): { prefix: string; number: string; suffix: string }
```
Regex `^\s*([A-Za-z]+)\s*(\d+)\s*([A-Za-z]*)\s*$` → prefix (letters, upper-cased), number (digits), suffix (trailing letters, lower-cased). Non-matching input → `{ prefix: '', number: '', suffix: '' }` (and the row keeps empty structured fields; never throws). Unit tests cover the real roster incl. `GC 3460`, `GC 4900ap`, `ACCT 2010`, `PKSC 1020`, and the empty/garbage fallback. A backfill helper maps every existing `courses.code` through it; an anti-drift test asserts the migration's backfill matches the parser for the current roster.

## Display — `formatCourseLabel(course, pairedCodes)` (pure, unit-tested)

- No paired codes → `code` unchanged (`"GC 3460"`).
- Paired codes sharing the prefix → collapse the numbers: `"GC 3460/3461"`, with a muted role hint (`"lecture + lab"`). Differing prefixes → `"GC 3460 + XX 1234"`.
- Used on `/` (public catalog), `/courses`, the capture header, `/view`, and the matrix row label. The matrix still has ONE row per primary code; the label just shows the bundled identifier.

## Add-a-course flow (`/courses/new` + `NewCourseForm`)

Fields become: **Prefix** (text, default "GC"), **Course number** (text, required — may itself carry a suffix, e.g. `4900ap`), Title (required), Catalog URL (optional). Plus an optional **"+ Add a paired course (e.g. lab)"** disclosure → a second **course number** + **role** select (lecture/lab/other). On submit:
- POST composes `code = prefix.trim() + ' ' + number.trim()` then runs **`parseCourseCode(code)`** to populate the three structured columns canonically — ONE parse path, so a suffix typed into the number field (`4900ap`) is handled without a separate suffix field. Creates the `courses` row; if a paired course was given, composes its code the same way and creates one `course_codes` row (paired_code + role).
- Redirect into `/capture/<primary code>` as today.
- Validation: primary code must be unique (existing roster check); paired_code must not collide with an existing `courses.code` or another `course_codes.paired_code`. Inline errors; form persists.
- The roster add-API (`/api/admin/courses/roster`, the single-add `mode:'one'` path) gains optional `prefix`/`number`/`pairedCode`/`pairedRole` — back-compat: a bare `code` still works (parsed on insert).

## Two-page Canvas import (CanvasBox, bundle-aware)

`CanvasBox` receives the course's `pairedCodes` (from `course_codes`). When ≥1 paired code exists:
- **Header = import slots, one per code** (primary + each paired): `"Lecture · GC 3460 · imported 6/3/26"` / `"Lab · GC 3461 · not yet imported · Import"`. Each slot's Import opens the existing token field and POSTs the existing canvas-import flow, with a new `sourceCode` param so the imported materials are stamped `source_code = <that code>`. Provenance (`canvas_course_name`/`canvas_imported_at`) is written to the matching `course_codes` row (or to `courses.canvas_*` for the primary — already there).
- **Unrolled items grouped by `source_code`** under "Lecture (GC 3460)" / "Lab (GC 3461)" subheaders.
- **Course-level actions once, in the footer**: Reimport-all and Scan-linked-docs (unchanged — they already operate on the whole course/tenant).
- **No paired code → renders exactly as today** (single import, no slots, no grouping).
- The canvas-import route gains an optional `sourceCode` (defaults to the primary `code`); materials it writes carry that `source_code`. `canvas-reextract` and `scan-linked-docs` are unchanged (course-level).

## What is explicitly UNCHANGED (the point of refined Option 3)

- `courses.code` primary key and all 17 FKs.
- The capture pipeline: one `capture_messages` session per primary code, one Weaviate tenant (`coursecapture-<primary-slug>`), one synthesis call, one Course Outcome Profile, one immutable snapshot — all attributed to the primary code. The interview simply now sees the lab page's materials too (same tenant).
- `/program` matrix: one row per primary code; the lab number never appears as its own row. `builds_to_career`, `category`, prereq edges, intended coverage, flags — all on the primary, untouched.

## Out of scope (recorded — deferred / non-goals)

- Splitting the `code` PK into structured PK components.
- Option 1 (bundle-level retrieval across separate tenants; lab as an independently navigable/prereq-able/separately-captured course). The `course_codes` child table is the migration seam if this is ever needed: "promote a paired_code to its own `courses` row" is a data migration, not a redesign.
- Bundles larger than primary+paired, or non-lecture/lab groupings — the `role` enum + child-table shape permit it later; the UI ships lecture+lab.
- Writing structured identity back to the Google Sheet, or reading prefix/number as separate sheet columns (the sheet stays the combined-code source; parse on sync).

## Testing

- Pure: `parseCourseCode` (roster + edge cases), `formatCourseLabel` (no-pair / shared-prefix collapse / differing-prefix), the backfill anti-drift test.
- Queries: `course_codes` create/list-by-primary; `course_materials.source_code` round-trip.
- Routes: roster add with `prefix`/`number`/`pairedCode`; canvas-import with `sourceCode` stamps materials.
- Component: `NewCourseForm` paired-course disclosure → correct POST body + redirect; `CanvasBox` bundle-aware (two import slots when paired codes present, grouped items, single footer actions; today's single-import render when none).
