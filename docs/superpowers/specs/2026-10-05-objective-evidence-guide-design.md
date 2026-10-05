# Objective assessment guide — design

**Date:** 2026-10-05 · **Status:** design approved by the owner in conversation (2026-10-05); this spec awaits owner review before planning.

## Purpose

For each captured course, a short guide telling whoever teaches it what to gather from their Canvas course at the end of a semester to show the stated learning objectives were met. It reads as plain advice on demonstrating an effective class. It is also specific enough that a faculty member can paste it, unchanged, into a Canvas-connected AI agent. It must not look like an AI prompt (owner, 2026-10-05).

## Owner decisions (2026-10-05)

- Output is a plain-language guide, not a prompt-shaped block (option 1).
- It lives on the **public** wiki course page (option 1), as a fourth section under the three views.
- It runs on the **default** tier (currently gpt-5.4). There are no new model choices; the model evaluation in flight does not block this.

## What the guide contains

For each stated learning objective:

| Field | Content |
|---|---|
| `objective` | The objective text, quoted verbatim from the course syllabus |
| `measure` | `clear`: a graded item plainly measures it. `partial`: graded work touches it but doesn't isolate it. `none`: no graded measure found. |
| `evidence` | 0–3 items, each `{ assignment, rubric_row \| null }`, named exactly as in the inputs |
| `gather` | One or two sentences on what to pull at semester's end, in **class-level numbers only**. Example: "the score distribution on the 'Strategic rationale' row of the Final Brand Playbook rubric, and the share of students at proficient or above". |
| `suggestion` | Only when `measure` is `partial` or `none`: the smallest change that would create a measure, such as adding a rubric row. Otherwise null. |

The guide ends with:
- `checklist`: a deduplicated list of the Canvas items to gather (assignment, plus rubric row when relevant).
- A one-paragraph `intro` addressed to the instructor.

Never names or implies individual students. No grades for any person, only class-level distributions and shares.

## Inputs

All inputs are existing data. Nothing new is collected.

1. **The syllabus is the source of the objectives** (owner, 2026-10-05). The model quotes them verbatim from the course's syllabus material, and a deterministic check confirms each one appears in the syllabus text (whitespace- and bullet-insensitive). As with Canvas names, a miss gets one retry and is then dropped. The catalog objectives from the Google Sheet (`courses.learning_objectives`) stay exactly as they are and are still used everywhere else; the guide does not read them.
2. The latest capture snapshot profile:
   - competencies with their evidence and citations;
   - `course_emphasis` (points per competency);
   - `objective_misalignments` and `verification_summary.catalog_vs_evidence`.
3. The course's active `Canvas: Assignments` material. This holds assignment names, points and rubric criteria inline. It is the full text, not the digest, since names must match exactly.

Coverage today (2026-10-05): all 18 captured courses have `Canvas: Assignments`.
- **Syllabus on file:** GC 1010, GC 3620, GC 3800, GC 4440, GC 4800, MKT 3310, and MKT 4320 (uploaded 2026-10-05 from the owner's copy).
- **Likely a syllabus under another name:** GC 3400 (the Summer 2026 course PDF). It gets marked as the syllabus by hand at backfill time after a check.
- **No syllabus found:** GC 1020, GC 1040, GC 1050, GC 2400, GC 3400 (until confirmed), GC 3460, GC 3700, GC 3710, GC 3730, GC 3740, GC 4900ap.
  - One reason: the Canvas import has been skipping the Canvas syllabus page whenever the catalog sheet already had objectives.
  - These courses get no guide until a syllabus arrives. The wiki section says so and asks the instructor to provide one.

## A syllabus is required at ingest

Owner decision (2026-10-05): every course must have a syllabus, either imported from Canvas or uploaded by the instructor.

- **The Canvas import stops skipping the syllabus page.** `assembleCanvasMaterials` always writes `Canvas: Syllabus` when Canvas has one; the `sheetsHasCatalog` suppression is removed. A course re-imported from Canvas picks up its syllabus.
- **Syllabus flag.** Materials gain an explicit `is_syllabus` boolean, added in the same migration, so the syllabus is found by flag, not by file name. It is set:
  - by the Canvas import for `Canvas: Syllabus`;
  - by an upload made through the Syllabus box, which sends `role=syllabus` with the upload;
  - once, by a backfill, for existing materials whose name contains "syllabus".
- **Ingest page, Syllabus box.**
  - When no syllabus material exists, the box shows a required-item notice: "Add the course syllabus: import it from Canvas or upload it here." The notice is styled like the page's other blocking items, and the upload button sits in the box.
  - The capture can't move past Step 1 until a syllabus exists, using the existing Step-1 gate (`MaterialGate`).
  - Courses captured before this change keep their snapshots. They just get no guide until a syllabus is added.

## The firm rule: no invented Canvas items

The guide may name only assignments and rubric rows that appear in input 3. After generation, a deterministic check runs:

- **Parse** the known names from `Canvas: Assignments`:
  - assignment names come from the `## ` headers, with points and `[unpublished]` suffixes stripped;
  - rubric rows come from the `- ` lines under a `Rubric` header within that assignment.
- **Match** every `evidence` and `checklist` item against those names. Matching is case- and whitespace-insensitive and exact otherwise; a rubric row must belong to the named assignment.
- **On any miss,** retry once, telling the model which names were not found and listing the valid ones.
- **If a name still doesn't match,** drop the unmatched items. If that leaves an objective with no evidence, set its measure to `none`. Record the dropped names in the stored row (`dropped_names`). The guide is never published with a name that isn't in Canvas.

## AI function

- **ID:** `objective-evidence-guide`.
- **Tier:** `default`.
- **Prompt:** `lib/ai/prompts/objective-evidence-guide.md`.
  - Includes the shared depth scale only if needed; the guide does not score.
  - Rules: plain advice voice, class-level numbers only, exact names, and `none` is an acceptable honest answer.
- **Output:** a strict JSON schema. Every property is required; optional fields are nullable unions, following the OpenAI strict-mode rule in CLAUDE.md.
- **Cost:** about $0.05–0.20 per course on gpt-5.4. The backfill of about 8 courses costs about $1–2.

## Storage

New table `course_objective_guides`, plus `course_materials.is_syllabus boolean not null default false`, in migration `0051`:

| Column | Type | Notes |
|---|---|---|
| `course_code` | text PK → `courses.code`, cascade | one row per course, the latest guide only |
| `snapshot_id` | uuid → `course_capture_snapshots.id` | which capture it was built from |
| `guide` | jsonb | the validated output above |
| `dropped_names` | jsonb `string[]` | names removed by the check (normally empty) |
| `model` | text | |
| `generated_at` | timestamptz | |

The table is overwritten on regeneration. History lives in the snapshots it is built from.

## When it runs

- **After every new capture snapshot,** in `app/api/capture/[code]/snapshots/route.ts`. It runs as its own background task beside the wiki update and the program-index refresh. A failure is logged and does not affect either of those; the next snapshot retries.
- **One-time backfill:** `scripts/backfill-objective-guides.ts`, with `--dry-run` and per-course output, covering every captured course with a flagged syllabus (8 today, including GC 3400 if confirmed).

## Where it shows

- **Public wiki course page** (`app/wiki/[type]/[slug]/page.tsx`): a fourth section under `CourseViewsPanel`, titled **"Assessing the course objectives"**.
  - One row per objective: the objective, a measure label (Clearly measured / Partly measured / No graded measure yet), where the evidence is, and what to gather. The suggestion appears when there is one.
  - Then the checklist.
  - A **Copy as text** button gives the plain-text rendering. That text is what a faculty member would hand to a Canvas-connected agent, and it reads as ordinary instructions to a person.
  - A one-line footnote gives the capture it was built from and its date.
- **Loading:** at request time from the table, like `loadCourseViews`. If no row exists, the section is omitted.
- **Plain-text rendering:** a pure function `renderGuideText(guide, course)` in `lib/objective-guide/render.ts`. The copy button and any future export both use it.

## Testing

- **Unit tests** (with a red proof for each):
  - name parsing from a `Canvas: Assignments` fixture, covering points suffixes, `[unpublished]`, and rubric rows under the right assignment;
  - the match check, including case and whitespace, a rubric row under the wrong assignment, and retry-then-drop;
  - `renderGuideText` output;
  - strict-schema audit, with every property required.
- **Route test:** a snapshot POST fires the guide task, and a guide failure does not fail the response or block the wiki update.
- **Live check after the backfill:**
  - three courses, read by me against their Canvas assignment text;
  - all `dropped_names` reported;
  - the public page renders on campus HTTPS.

## Out of scope

- Pulling live grades from Canvas. The guide says what to pull; it does not pull it.
- Per-objective evidence matching inside capture scoring. That remains a separate open owner decision.
- Any faculty-only view. The owner chose public placement.

## Tracking

The following go in STATE.md in the same commit:
- the new AI function ID;
- the new table and migration;
- the new wiki section;
- the backfill.
