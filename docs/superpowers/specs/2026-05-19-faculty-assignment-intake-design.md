# Faculty Assignment Intake — Design

**One-line:** Let faculty upload their actual course assignment materials (rubrics, worksheets, tests, project briefs, expectations), have AI analyze them into an evidence-grounded course profile — learning objectives, skills, competencies — that lands as editable system data and feeds the curriculum analysis.

---

## Background & motivation

The curriculum tool's analysis is only as good as its picture of each course. Today that picture comes entirely from the shared Google Sheet: a thin `description`, plus flat `learningObjectives` / `majorProjects` / `skillsRequired` lists, mirrored into the `courses` table. That catalog data is shallow and often stale — it describes what a course is *supposed* to do, not what its actual assignments make students do.

Faculty already hold the ground truth: real rubrics, worksheets, exams, project overviews, and stated expectations. This feature lets them upload that material per course and uses AI to distill it into an **evidence-grounded course profile**. The profile is richer than the catalog, is owned and editable by faculty, and is what the analyze routes consume — so coverage scoring, scaffolding evaluation, and prerequisite analysis all run against what courses *actually* teach.

The M-trial dual-analysis plan flagged this work as a queued follow-on: "Will produce enriched KUDs that the `draftKUD` helper can optionally pull from instead of regenerating from raw syllabus."

## Goals

- Faculty upload real assignment files (PDF, DOCX) per course through a slug-gated intake.
- Text-extractable files are parsed directly; scanned/image-based files are read by a vision-capable model.
- AI distills the materials into a per-course profile: a prose summary, learning objectives, skills, and evidence-grounded competencies, plus a read-only "divergence from the catalog" view.
- The profile lands automatically as editable system data (`course_profiles`); faculty review and curate it in place.
- The analyze routes transparently prefer a course's profile over the thin catalog syllabus when one exists.

## Non-goals

- No write-back into the Sheet-mirrored `courses.*` fields (a resync would clobber it). The profile is a separate, faculty-owned artifact.
- No automatic scheduled re-analysis. Analysis is faculty-triggered.
- No partner-facing surface. This is faculty-only, under `/preview/[slug]`.
- No structural coupling between profile `competencies` and career-target Know/Understand/Do. The profile improves the *input* to `draftKUD`; it does not replace the K/U/D drafting step.

---

## Architecture overview

Three stages, per course:

1. **Upload + extraction.** Faculty drag-drop files into one zone (uncategorized — the AI infers each file's type). Each file is stored in Vercel Blob. Server-side, text is extracted immediately: DOCX via `mammoth`, digital PDFs via `pdf-parse`. A PDF that yields too little text for its page count is treated as image-based and sent to a vision-capable model for transcription. Extracted text and a per-file status are stored on the file row and shown back to faculty.

2. **Analysis.** Faculty click "Analyze materials." One AI call **per file** classifies the material and extracts the competencies and skills it evidences, with quotes. A final **synthesis call** merges all per-file findings with the catalog description into the enriched profile.

3. **Profile.** The synthesis output is written to an immutable run-history row **and** to the current editable `course_profiles` row. Faculty review and edit it. The analyze routes consume it.

**Key boundary — vision is confined to extraction.** Image/binary handling lives only in the upload-time transcription step. Every downstream AI call (per-file analysis, synthesis) operates on plain text, so the analysis pipeline stays uniform and testable.

```
upload ──► Vercel Blob ──► extract text (mammoth / pdf-parse)
                                │
                                └─ image-based? ──► vision transcription
                                                          │
                          course_materials.extractedText ◄┘

analyze ──► per-file analyzeMaterial() (parallel) ──► synthesizeCourseProfile()
                                                              │
                              course_profile_runs (history) ◄─┤
                              course_profiles (current)      ◄┘

/api/analyze, /api/analyze/target-chain
       └─ resolveCourseContext(courseLabel) ──► prefers course_profiles, else catalog syllabus
```

---

## Data model

Three new tables. All `courseCode` columns reference `courses.code` with `onDelete: 'cascade'`.

### `course_materials` — one row per uploaded file

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `courseCode` | text | → `courses.code` |
| `fileName` | text | original upload name |
| `blobUrl` | text | Vercel Blob URL |
| `mimeType` | text | |
| `sizeBytes` | integer | |
| `pageCount` | integer nullable | populated for PDFs |
| `extractionMethod` | text nullable | `'text'` \| `'vision'` |
| `extractionStatus` | text | `'pending'` \| `'ok'` \| `'low_text'` \| `'failed'` |
| `extractedText` | text nullable | populated once extraction succeeds |
| `analysisFinding` | jsonb nullable | cached per-file AI result (see below) |
| `analysisModel` | text nullable | model used for the per-file call |
| `analysisCostUsdCents` | integer nullable | |
| `uploadedAt` | timestamptz | default now |
| `ipHash` | text | SHA-256 of uploader IP, consistent with other tables |

`analysisFinding` shape: `{ materialType: string, competencies: Array<{ name, description, evidenceQuotes: string[] }>, skills: string[], notes: string }`.

### `course_profiles` — the current, editable profile (one row per course)

| Column | Type | Notes |
| --- | --- | --- |
| `courseCode` | text pk | → `courses.code` |
| `summary` | text | prose: what the course actually develops |
| `learningObjectives` | jsonb (`string[]`) | editable list |
| `skills` | jsonb (`string[]`) | editable list |
| `competencies` | jsonb | structured, with evidence — see below |
| `catalogDivergence` | jsonb | `{ reinforced: string[], additions: string[], gaps: string[] }` |
| `sourceRunId` | uuid nullable | the `course_profile_runs` row that seeded the current content |
| `manuallyEdited` | boolean | default false; set true on any faculty edit |
| `updatedAt` | timestamptz | default now |

`competencies` shape: `Array<{ name: string, description: string, level: string, evidence: Array<{ fileName: string, quote: string }> }>`. `level` is an AI-assigned proficiency descriptor (e.g. "introduced" / "developed" / "mastered") — a free string, not coupled to career-target K/U/D.

`learningObjectives` and `skills` are flat `string[]` — mirroring the catalog vocabulary and keeping their editor a simple list editor. `competencies` is the new evidence-grounded artifact; full evidence for every objective/skill remains traceable through `course_profile_runs` and per-file `analysisFinding`.

### `course_profile_runs` — immutable history of AI analysis runs

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `courseCode` | text | → `courses.code` |
| `result` | jsonb | the full generated profile (summary, learningObjectives, skills, competencies, catalogDivergence) |
| `materialCount` | integer | files included in the run |
| `model` | text | |
| `costUsdCents` | integer | total run cost (per-file + synthesis) |
| `createdAt` | timestamptz | default now |

History is retained for provenance, cost audit, and as a safety net when a re-analysis overwrites a manually-edited profile. "Current profile" is the `course_profiles` row; the newest run is just its provenance source.

---

## Upload & extraction pipeline

**Endpoint:** `POST /api/courses/[code]/materials` — one file per request, so the UI can show per-file progress and per-file failure without an all-or-nothing batch.

1. **Validate** — slug gate (`isValidSlug`), IP rate limit, file size cap (~15 MB), MIME allowlist (`application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`). Reject violations with a clear 4xx.
2. **Store** — upload the file to Vercel Blob via `@vercel/blob` `put()`. Insert a `course_materials` row with `extractionStatus = 'pending'`.
3. **Extract** —
   - DOCX → `mammoth` raw-text extraction. `extractionMethod = 'text'`.
   - PDF → `pdf-parse`. Record `pageCount`. If extracted text is below a per-page threshold (heuristic: average < ~100 chars/page), the PDF is treated as image-based.
   - Image-based PDF → a vision transcription call (see below). `extractionMethod = 'vision'`.
4. **Finalize** — store `extractedText`; set `extractionStatus`:
   - `'ok'` — meaningful text extracted.
   - `'low_text'` — extraction ran but produced very little text even after vision (e.g. a near-blank or unreadable scan); surfaced as a soft warning so faculty can replace the file.
   - `'failed'` — extraction threw; surfaced as an error with a retry/replace affordance.

**Vision transcription.** The AI provider abstraction (`lib/ai/provider.ts`) gains a document-transcription method — conceptually `transcribeDocument({ fileBytes, mimeType }) → { text, costUsdCents, ... }`. It hands the raw file to a vision-capable model and returns transcribed text. To bound cost and latency, transcription is capped at ~40 pages per file; a longer file is transcribed up to the cap and flagged. Transcription cost is checked against `checkDailyCap` before the call and recorded with `recordSpend` after.

Extraction runs synchronously within the upload request. One file per request keeps each request bounded; `maxDuration` is set to 120s, and the page cap keeps a single file's vision work within that budget.

**Deleting a file** — `DELETE /api/courses/[code]/materials/[id]` removes the Blob object and the row. Deletion does not retroactively change an existing profile; the profile only changes on the next analysis.

---

## Analysis pipeline

**Endpoint:** `POST /api/courses/[code]/analyze-materials`.

Guards first: IP rate limit + `checkDailyCap` before any AI call (the `applyAnalyzeGuards` pattern from `lib/ai/analyze/guards.ts`).

1. **Per-file analysis.** For each `course_materials` row with `extractionStatus = 'ok'` and no cached `analysisFinding`, call `analyzeMaterial({ courseContext, fileName, extractedText })`. `courseContext` is the catalog course record (code, title, level, track, description). The call returns structured output: `{ materialType, competencies, skills, notes }`, stored as `analysisFinding` on the row along with `analysisModel` and `analysisCostUsdCents`. Files with an existing cached finding are skipped — so re-analyzing after adding one file only runs that file's call. Per-file calls run in parallel, reusing the memoized-`loadPrompt` warm-up established in the analyze refactor.
2. **Synthesis.** `synthesizeCourseProfile({ course, catalogSyllabus, findings })` makes one AI call that merges every per-file finding with the catalog description into the enriched profile: `summary`, `learningObjectives`, `skills`, `competencies` (with evidence), and `catalogDivergence`.
3. **Persist.** Insert a `course_profile_runs` row (result, materialCount, model, summed cost). Then write the current `course_profiles` row:
   - **First analysis** (no existing `course_profiles` row) — create it from the run; `manuallyEdited = false`, `sourceRunId` set.
   - **Re-analysis** — replace the `course_profiles` content with the new run; `manuallyEdited` reset to false, `sourceRunId` updated. If the existing profile had `manuallyEdited = true`, the UI warns before the call ("re-analyzing replaces the current profile and your edits — previous versions stay in history").
4. **Cost** — `recordSpend` for the total; the run row stores the cost.

Errors: if synthesis fails, per-file `analysisFinding` rows already written are kept, so a retry re-runs only the synthesis. Analyzing a course with zero `ok` files → 400 with a clear message.

Two new prompts join the existing prompt set (`lib/ai/prompts/`, registered in the `PromptName` union): `analyze-material` and `synthesize-course-profile`. Each pairs a Zod schema with a JSON schema for structured output, following the existing analyze/synthesis pattern.

---

## Faculty UI

Slug-gated, parallel to the existing target admin (`/preview/[slug]/targets`). Reuses shadcn primitives and existing styling.

**`/preview/[slug]/courses`** — index. Lists all 28 GC courses from the `courses` table. Each row shows a status badge:
- *No materials* — no `course_materials` rows.
- *N files, not analyzed* — files uploaded, no `course_profiles` row.
- *Profile ready* — `course_profiles` exists, `manuallyEdited = false`.
- *Profile (edited)* — `course_profiles` exists, `manuallyEdited = true`.

**`/preview/[slug]/courses/[code]`** — per-course page, three zones:

1. **Materials** — a drag-drop upload zone; a list of uploaded files each showing extraction status (`ok` / `low_text` / `failed`) and a delete button; upload progress per file.
2. **Analyze** — an "Analyze materials" button, disabled when there are no `ok` files. Shows the last run's date, file count, and cost. Re-analyzing a manually-edited profile shows the overwrite warning first.
3. **Profile** — the editable profile:
   - `summary` — editable textarea.
   - `learningObjectives`, `skills` — editable string lists (add / edit / remove).
   - `competencies` — editable list of `{ name, description, level }`; the `evidence` quotes are shown read-only (they are AI-extracted provenance, not faculty-authored).
   - `catalogDivergence` — read-only panel: where the real assignments reinforce, add to, or leave gaps against the catalog description.
   - A Save action persists via `PATCH /api/courses/[code]/profile` and sets `manuallyEdited = true`.

---

## Analyze-route integration

Transparent — no client changes to the M-trial forms.

A new server-side helper `resolveCourseContext(courseLabel, fallbackSyllabusText)`:
- Treats `courseLabel` as the course code (the M-trial forms pick courses by code) and looks up the `course_profiles` row.
- **Profile found** — builds the course context from the enriched profile (summary + learning objectives + skills + competencies) merged with the catalog's structural fields (level, track, prerequisites) that the profile does not duplicate.
- **No profile** — returns `fallbackSyllabusText` unchanged (today's behavior).

`/api/analyze` and `/api/analyze/target-chain` call `resolveCourseContext` per course before `draftKUD`. Courses with a profile get richer, evidence-grounded analysis automatically; courses without one are completely unaffected. The profile improves the *input* to `draftKUD` — `draftKUD` still drafts Know/Understand/Do as it does today.

---

## Cost, guards, and error handling

- **Upload** — slug gate, IP rate limit, file-size cap, MIME allowlist, vision page cap. Vision transcription cost is gated by `checkDailyCap` and recorded with `recordSpend`.
- **Analyze-materials** — IP rate limit + `checkDailyCap` before any AI call; total cost recorded with `recordSpend` and stored on the run row.
- **Extraction failures** flag the individual file (`failed` / `low_text`) and never block other files or the rest of the pipeline.
- **Analyzing zero readable files** → 400 with a clear message.
- **Synthesis failure** keeps the cached per-file findings, so a retry is cheap (re-runs synthesis only).
- All AI work uses the existing `getProvider()` abstraction and structured-output (Zod + JSON schema) pattern.

## Testing strategy

Vitest, following the established patterns (`vi.hoisted` mocks, `FakeProvider`, route tests with mocked DB/provider):

- **Extraction** — unit tests for the extraction dispatcher with mocked `mammoth` / `pdf-parse` and a mocked `transcribeDocument`; cover text, image-based, and failure paths and the `extractionStatus` outcomes.
- **Helpers** — `analyzeMaterial`, `synthesizeCourseProfile`, `resolveCourseContext` (profile-present and fallback paths).
- **Routes** — upload (mocked Blob + extraction), analyze-materials (mocked helpers, including the cached-finding skip and zero-readable-files 400), profile `PATCH`.
- **Components** — the upload zone and the profile editor (Vitest + `@testing-library/react`).

## New dependencies & configuration

- npm packages: `@vercel/blob`, `mammoth`, `pdf-parse`.
- Environment: `BLOB_READ_WRITE_TOKEN` (Vercel Blob).
- `lib/ai/provider.ts` gains a document-transcription method; the OpenAI provider implements it against a vision-capable model.
- One new Drizzle migration adds the three tables.

---

## Scope & decomposition

This is a large feature — file infrastructure, vision transcription, two AI pipelines, a new admin area, a profile editor, and analyze-route integration. It is one spec, but the implementation decomposes into roughly **three plans**, each independently shippable and testable:

1. **Plan 1 — Schema, upload & extraction.** The three tables + migration; Vercel Blob integration; the upload route; text extraction (`mammoth`, `pdf-parse`); the provider's vision transcription method; the `course_materials` portion of the per-course UI (upload zone + file list with status).
2. **Plan 2 — Analysis pipeline & profile.** The `analyze-material` and `synthesize-course-profile` prompts + schemas; `analyzeMaterial` and `synthesizeCourseProfile` helpers; the analyze-materials route; writing `course_profile_runs` + `course_profiles`; the read-only profile display.
3. **Plan 3 — Editor & analyze integration.** The profile editor + `PATCH` route; the `/preview/[slug]/courses` index; `resolveCourseContext` and wiring it into the two analyze routes.

Plan order is decided at writing-plans time; this mirrors how the Industry Partner Input tool was built across three plans.

## What's NOT in this design (deferred)

- **Field-level provenance for `learningObjectives` / `skills`.** These are flat `string[]` in the profile; per-objective evidence lives in `course_profile_runs` and per-file `analysisFinding`, not inline. Inline evidence for every objective is a later enhancement.
- **A proposal/diff-and-apply flow on re-analysis.** v1 overwrites the profile (with a warning and full run history). A "review the new run as a proposal, then apply" flow is deferred.
- **Editing AI-extracted evidence quotes.** Evidence is read-only provenance.
- **OCR for standalone image files** (JP/PNG) — v1 accepts PDF/DOCX only; image-based PDFs are covered via vision, but bare image uploads are out of scope.
- **Cross-course rollups** (e.g. a program-wide view of profile coverage) — out of scope; this feature is per-course.
- **Scheduled or automatic re-analysis** — analysis is always faculty-triggered.
