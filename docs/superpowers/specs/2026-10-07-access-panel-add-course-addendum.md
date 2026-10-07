# Faculty access panel — addendum: add a course from the Clemson catalog

**Date:** 2026-10-07. **Status:** approved by the owner in conversation. Extends [`2026-10-07-faculty-access-panel-design.md`](./2026-10-07-faculty-access-panel-design.md); that spec still governs everything not changed here.

## Why

Faculty from other departments (e.g. ECON 2120, ENTR 4030/4080) teach courses that aren't on the course list yet. The owner wants to add such courses from the admin access page, with titles from the Clemson catalog. This also serves the decision to retire the GC Google Sheet (STATE.md, 2026-10-07): the catalog becomes the source of titles and descriptions.

## 1. Full catalog in the app database

- Extend `scripts/catalog/sync-catalog-prereqs.ts` (or add a sibling `scripts/catalog/sync-catalog-courses.ts`) so that `--apply` upserts **every** course in `~/projects/clemson-advising-mcp/core/db/catalog.db` (`course` table: `code`, `title`, `credits`, `description`; ~4,085 rows, read-only) into Postgres.
- Store in `course_catalog_entries` (migration 0053) if it can hold the extra fields; otherwise migration **0055** adds nullable `description text`, `credits text` to it. Hand-written SQL like 0051–0054; written, **not applied** by the implementer.
- The prerequisite rows/edges behavior of the existing sync is unchanged; only tracked courses' prereqs feed `course_catalog_prereqs` as today.
- A read helper `lookupCatalogCourse(code)` → `{ code, title, description, credits } | null` in `lib/curriculum/`.

## 2. API

- `GET /api/admin/access/catalog?code=<code>` → `{ found, code, title, description, onCourseList, baseCode, baseTitle }`. For a section code (`GC 4900xx`, via `parseCourseCode` in `lib/courses/parse-course-code.ts`): `found:false`, with `baseCode`/`baseTitle` from the catalog when the base number exists. Admin surface, same auth as the other access routes; `no-store`.
- `POST /api/admin/access/courses` body `{ code, title?, category? }` (JSON only; same CSRF/origin protection as the other access routes):
  - code normalized like the roster route; refuse if already on the course list (409).
  - title: catalog title when the code is in the catalog (a supplied title is ignored for catalog codes); required (1–120 chars, no control characters) for section or non-catalog codes.
  - category default `other`; allowed: `gc_core | specialty | major_req | other`.
  - Reuse the existing course-insert path used by `POST /api/admin/courses/roster` (`mode: 'one'`) so level/track defaults and pairing behave the same. Level = first digit of the course number.

## 3. UI on `/admin/access`

- An **Add a course** section above the faculty table: Code field → on blur/Enter it looks the code up and shows the catalog title (read-only) or, for a section/non-catalog code, a Title field with a hint ("Sections of GC 4900 are titled 'Special Topics: …'") and, when relevant, "Not in the Clemson catalog — add with your own title". Section dropdown (default **Other courses**). **Add** button; success line "Added ENTR 4080 — Family Business to Other courses."
- **Shortcut in the faculty form's course picker:** when the typed text looks like a course code that isn't on the list, show an option "Add ECON 2120 — Principles of Macroeconomics" (catalog title, or "(not in catalog)" which opens the Add-a-course section prefilled). Choosing it creates the course (category Other) and selects it.

## Testing

Red-proof each regression test.
- Lookup: catalog code → title; section code → base info, `found:false`; unknown code → `found:false`, no base.
- Create: catalog code uses the catalog title even if a different one is sent; section code requires a title; duplicate → 409; control characters → 400; non-JSON → 415; cross-site → 403; non-admin → 401/403.
- Picker shortcut creates and selects the course.
- Sync: dry-run counts; apply is idempotent (run twice → same row count).

## Tracking

STATE.md: the two routes, the sync change, migration 0055 if added (written, not applied), and that the catalog now holds all Clemson courses' titles/descriptions.
