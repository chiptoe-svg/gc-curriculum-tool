# Objective evidence guide — design

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
| `objective` | The objective text, verbatim from `courses.learning_objectives` |
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

1. `courses.learning_objectives` and the course title.
2. The latest capture snapshot profile:
   - competencies with their evidence and citations;
   - `course_emphasis` (points per competency);
   - `objective_misalignments` and `verification_summary.catalog_vs_evidence`.
3. The course's active `Canvas: Assignments` material. This holds assignment names, points and rubric criteria inline. It is the full text, not the digest, since names must match exactly.

Coverage today: 18 captured courses, all 18 with `Canvas: Assignments`, and 16 with stated objectives. The two without objectives get no guide. Their wiki section says no stated objectives are on file.

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
- **Cost:** about $0.05–0.20 per course on gpt-5.4. The backfill of 16 courses costs about $1–4.

## Storage

New table `course_objective_guides`, migration `0051`:

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
- **One-time backfill:** `scripts/backfill-objective-guides.ts`, with `--dry-run` and per-course output, covering the 16 captured courses with objectives.

## Where it shows

- **Public wiki course page** (`app/wiki/[type]/[slug]/page.tsx`): a fourth section under `CourseViewsPanel`, titled **"Documenting the objectives this semester"**.
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
