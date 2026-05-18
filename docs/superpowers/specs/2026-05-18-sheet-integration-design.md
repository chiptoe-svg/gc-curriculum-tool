# Sheet Integration — Design

**Date:** 2026-05-18
**Builds on:** `2026-05-17-gc-curriculum-tool-v1-design.md` (M-trial prototype)

## Goal

Faculty pick GC courses from a dropdown instead of pasting SimpleSyllabus text. Course data comes from the shared Google Sheet (28 standardized course tabs, see `PopulateGCSheet.gs`). Data is snapshotted to our Postgres DB and refreshed via an admin "Resync" button — not live-read on every analysis.

## Why snapshot, not live sync

DB is already canonical for everything else (career targets, analyses, flags). Adding `courses` as another mirrored table keeps the runtime free of a Google Sheets dependency mid-analysis. A typo in a sheet cell can't take down a 30-second demo. Tradeoff: faculty edits to the sheet require a deliberate Resync click; mitigated by a visible "Last synced: 3h ago" badge.

## Architecture

### New DB table `courses`

| Column                | Type      | Notes                                                  |
| --------------------- | --------- | ------------------------------------------------------ |
| `code`                | text PK   | e.g. `GC 3460`, `GC 4900ap`                            |
| `title`               | text      |                                                        |
| `level`               | int       | 1–4                                                    |
| `track`               | text      |                                                        |
| `description`         | text      |                                                        |
| `prerequisites`       | text      | free text from sheet                                   |
| `syllabus_url`        | text      | nullable                                               |
| `learning_objectives` | jsonb     | `string[]`                                             |
| `major_projects`      | jsonb     | `string[]`                                             |
| `skills_required`     | jsonb     | `string[]`                                             |
| `last_synced_at`      | timestamp | UTC, updated on every successful upsert                |

### Resync flow

1. `POST /api/admin/resync-courses` (slug-gated like other admin endpoints).
2. Read sheet ID from `GOOGLE_SHEET_ID` env var (the shared sheet with anyone-with-link view).
3. Fetch the `Index` tab via `gviz/tq?out=csv&sheet=Index` — get the list of expected course codes from column A.
4. For each code, fetch `gviz/tq?out=csv&sheet=GC%20XXXX`. Parse the label/value rows into the schema. Upsert into `courses`.
5. Return `{ synced: <count>, errors: [...], lastSyncedAt }` for the admin UI.

### Sheet parser

Each course tab is a column-A-label / column-B-value layout with section headers (`Learning Objectives`, `Major Projects`, `Skills/Competencies Required`) above indented bullet rows. Parser:
- Top-level rows (`Course Code`, `Title`, `Level`, etc.) → fields on the record.
- Section header rows + following indented rows (empty column A, value in column B) → string arrays.
- Empty cells → empty string or empty array.

### Public read endpoints

- `GET /api/courses` — list of `{ code, title, level, track }` for dropdown population. Slug-gated.
- `GET /api/courses/:code` — full record. Slug-gated.

### UI changes (PrototypeForm)

- The Course and Prior Coursework textareas are replaced by a **Combobox** (search-by-code-or-title) + a populated, editable details block showing the course's `description`, `learningObjectives`, `majorProjects`, `skillsRequired`. Each is editable; edited fields get a small "Edited" badge and a "Reset to sheet version" link.
- Multi-course chain support persists: the Prior Coursework section is an array of these blocks (add/remove).
- On submit, the client formats the (possibly-edited) fields into the labeled-markdown syllabus shape the existing `/api/analyze` already accepts. **The analyze endpoint and prompts do not change.**

### Admin panel addition

In the existing career-target editor panel: a "Course Sync" section with a "Resync from Sheet" button, a "Last synced: <relative time>" badge, and a list of the most recent sync errors (if any).

## What does not change

- `/api/analyze` request/response shape and all Manning-skill prompts.
- The career-target editor.
- Rate limiting and daily cap.
- The deploy target (Vercel) or AI provider (OpenAI gpt-5.4).

## Open / accepted decisions

- **Editable structured fields, with "Edited" indicator.** Accepted: lets faculty experiment ("does sharpening the objectives sharpen the gap analysis?") and see exactly what the AI will read. Tradeoff acknowledged: edits don't write back to the sheet; "Reset to sheet version" link handles the round-trip.
- **Paste-in textarea removed entirely.** All M-trial courses are in the sheet; no need for an ad-hoc-syllabus fallback.
- **Sheet ID + sheet name come from env**, not hard-coded, so we can swap to a different sheet for a future Brand Comm or Production cohort trial without code changes.

## Out of scope for this increment

- Editing course records inside the tool (sheet remains the source).
- Writing edits back to the sheet (Google OAuth + write permissions = much bigger lift).
- Automatic scheduled resync.
- Showing a per-course history of analyses.
