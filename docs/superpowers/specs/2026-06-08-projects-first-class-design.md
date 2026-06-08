# Major Projects, Class Structure & Syllabus — First-Class Profile Fields (Design)

> **Status:** design draft, 2026-06-08 — for review.
> **Author:** drafted with Claude, 2026-06-08
> **Relates:** `lib/ai/capture/schema.ts` · `lib/ai/analyze/capture-scores.ts` · `lib/ai/prompts/capture-synthesis.md` · `lib/ai/wiki/update.ts` · `lib/ai/prompts/wiki-update.md` · `lib/sheets/fetchLiveCourse.ts` · `app/capture/[code]/ProfileReviewPanel.tsx`

---

## Why this exists

The capture profile (`CaptureProfile`) is competency-centric: it extracts K/U/D depths from a course's materials but records nothing about *how the course is structured* (its topics, rhythm, grading shape) or *what projects students actually produce*. As a consequence:

- The wiki course page (`courses/<slug>.md`) has no class-structure or projects section.
- The Curriculum-Q&A assistant (`/ask`) correctly answers "the wiki doesn't have that" when asked about, for example, GC 3460's major projects — because the wiki literally doesn't.
- The per-course Google Sheet (`lib/sheets/fetchLiveCourse.ts`, `ParsedCourse.majorProjects`) already carries a `majorProjects[]` list, but wiki-update never reads it, so it never lands on a page.

This feature makes three things first-class in the profile:

1. **`class_structure`** — topics/units, cadence (weekly rhythm), assessment overview.
2. **`major_projects`** — each project: title, 1-3 sentence description, the competency statements it develops.
3. **`syllabus`** — rendered on the wiki course page as the structured live-sheet content (description, learning objectives, major projects, skills required) plus two links: the per-course `syllabusUrl` and a link to the Google Sheet.

Together these let `/ask` answer course-structure questions from source-grounded wiki text, and give faculty a richer review panel before a snapshot is written.

---

## Goals / non-goals

**Goals**

- Add `class_structure` and `major_projects` as first-class, source-grounded fields in `captureProfileSchema` (`lib/ai/capture/schema.ts`).
- Update the synthesis prompt (`lib/ai/prompts/capture-synthesis.md`) and its strict-mode JSON schema (`lib/ai/analyze/capture-scores.ts`) to extract these fields from ingested syllabus/Canvas materials, with citations.
- Add editable Class-structure and Major-projects sections to `ProfileReviewPanel` (`app/capture/[code]/ProfileReviewPanel.tsx`), consistent with how Overview is reviewed today.
- Extend `wiki-update` to read live-sheet course data (`fetchLiveCourseFromSheet`) and render Class structure, Major projects, and Syllabus sections on the wiki course page, with a fallback path when profile fields are null.
- Preserve backward compatibility: legacy snapshots (null new fields) fall back to sheet/catalog data or omit sections gracefully.

**Non-goals**

- No DB migration. Both new fields are stored in `course_capture_snapshots.profile` (JSONB). This is a schema-within-JSONB extension only.
- No numeric breakdown of assessment weightings in `class_structure.assessment` — plain prose is simpler to extract reliably; YAGNI on a structured `{tests: 3, projects: 2, …}` sub-object.
- No changes to `snapshot_target_coverage`, the career-target framework, or any coverage-scoring path. Projects are narrative enrichment, not scoring dimensions.
- No new wiki page type (projects do not earn their own pages; they belong inline on the course page).
- No rewriting of legacy snapshots — they are read-only ground truth.

---

## New profile fields

Both fields are added to `captureProfileSchema` (`lib/ai/capture/schema.ts`) as nullable/optional, following exactly the pattern used for `overview` (`courseOverviewSchema.nullable().optional()`) and `course_emphasis` (`z.array(courseEmphasisItemSchema).nullable()`).

### `classStructureSchema`

```ts
export const classStructureSchema = z.object({
  /** Ordered list of the units / topic areas / lab subjects covered. */
  topics: z.array(z.string().min(1)).min(1),
  /**
   * The weekly rhythm / meeting format, e.g.
   * "weekly 2-hour lab + 1-hour lecture" or "twice-weekly studio sessions".
   */
  cadence: z.string().min(5),
  /**
   * Plain-prose grading overview, e.g.
   * "3 tests, 2 major projects, a cumulative final, plus weekly graded labs."
   * Prose, NOT a numeric breakdown — simpler to extract reliably.
   */
  assessment: z.string().min(10),
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
});
export type CaptureClassStructure = z.infer<typeof classStructureSchema>;
```

Added to `captureProfileSchema`:

```ts
/**
 * Weekly rhythm, topic list, and grading overview.
 * Nullable: pre-2026-06-08 snapshots won't have it.
 * Populated by v3+ synthesis; null means "not yet captured" — falls back to
 * sheet/catalog data at wiki-render time.
 */
class_structure: classStructureSchema.nullable().optional(),
```

### `majorProjectItemSchema`

```ts
export const majorProjectItemSchema = z.object({
  /** Short human-readable title, e.g. "Brand Color Report" or "Prepress Packaging Spec". */
  title: z.string().min(1),
  /** 1-3 sentences describing what students produce and what they decide. */
  description: z.string().min(10),
  /**
   * The competency statements this project develops.
   * Must match or paraphrase entries in the profile's `competencies` array —
   * same convention as `course_emphasis.competency`.
   * Projects ARE the evidence for K/U/D scores; linking them closes the loop.
   */
  competencies: z.array(z.string().min(1)),
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
});
export type CaptureProjectItem = z.infer<typeof majorProjectItemSchema>;
```

Added to `captureProfileSchema`:

```ts
/**
 * Major graded projects in the course.
 * Nullable: pre-2026-06-08 snapshots won't have it.
 * When null at wiki-render time, falls back to sheet `majorProjects[]` list
 * labeled "from the course sheet — not yet captured."
 */
major_projects: z.array(majorProjectItemSchema).nullable().optional(),
```

---

## Strict-mode JSON schema discipline

`AI_PROVIDER=openai` (deployed) enforces strict structured-output: **every property listed in `properties` must appear in `required`; optional fields use nullable union types, not absence from `required`.**

The pattern is already established in `lib/ai/analyze/capture-scores.ts` (`CITATIONS_ARRAY`, `captureProfileJsonSchema`) and is the canonical reference. Both new schema objects follow it exactly:

- `class_structure` in the top-level `captureProfileJsonSchema.properties`: `type: ['object', 'null']`, with `required: ['topics', 'cadence', 'assessment', 'source', 'citations']` and `source` as `type: ['string', 'null']`, `citations` as `CITATIONS_ARRAY`.
- `major_projects` in the top-level schema: `type: ['array', 'null']`, items typed with `required: ['title', 'description', 'competencies', 'source', 'citations']`.

This must be applied **recursively** — the `source` and `citations` fields within `classStructureSchema` and `majorProjectItemSchema` follow the same nullable-union pattern as they do in `overview`, `captureCompetencySchema`, and `courseEmphasisItemSchema`.

The test that guards this (`required === properties` walker) already exists in the test suite per the project's strict-mode discipline and must pass with the new fields added.

---

## Capture synthesis changes

### Prompt (`lib/ai/prompts/capture-synthesis.md`)

Add a new section **"Class structure and major projects"** after the existing `course_emphasis` section:

**Extraction rules:**
- Read the syllabus schedule/calendar, Canvas module list, and assignment headers to populate `class_structure.topics` (ordered by when they appear, not alphabetically), `class_structure.cadence` (from meeting pattern or course header), and `class_structure.assessment` (a single plain-prose sentence summarising the graded components — e.g. "Three tests, two major projects, a cumulative final, and ten weekly graded labs.").
- Read the assignment headers and rubric documents to identify `major_projects`. Each must have a point value or be explicitly labeled "major project" or equivalent in the materials. Small in-class exercises and weekly labs are NOT major projects. Cap at 8 entries; more than that signals the filter is too loose.
- `competencies` on each project entry must match or closely paraphrase entries in `competencies` already emitted above. They are the provenance link between projects and K/U/D scores — a project that evidences D=4 color-measurement should list the color-measurement competency statement.
- When materials are too thin to support either field reliably, emit `class_structure: null` and/or `major_projects: null` (not omitted — OpenAI strict mode requires `null`, not absent). Do NOT invent a schedule or project list from the syllabus's stated objectives alone.
- `source` and `citations` follow the same derivation rules as competency citations: carry forward the chunk IDs from the materials the extraction drew on; derive `source` mechanically from the citation set.

**Output schema addendum** in the prompt's `# Output schema` section:

```jsonc
"class_structure": {
  "topics": ["<ordered unit/lab titles>", ...],
  "cadence": "<weekly rhythm>",
  "assessment": "<plain prose overview of grading>",
  "source": "materials" | "instructor" | "inferred" | null,
  "citations": [ ... ]
} | null,
"major_projects": [
  {
    "title": "<project title>",
    "description": "<1-3 sentences on what students produce>",
    "competencies": ["<competency statement>", ...],
    "source": "materials" | "instructor" | "inferred" | null,
    "citations": [ ... ]
  },
  ...
] | null
```

### JSON schema (`lib/ai/analyze/capture-scores.ts` — `captureProfileJsonSchema`)

Append `class_structure` and `major_projects` to the top-level `required` array and `properties` object following the nullable-union pattern described in "Strict-mode JSON schema discipline" above. Both fields already exist in `captureProfileSchema`'s Zod shape once the schema changes land, so this is the matching JSON Schema encoding.

---

## Faculty review UI

### Location

`app/capture/[code]/ProfileReviewPanel.tsx` — two new sections added after the existing **Course overview** (`CourseOverview.tsx`) and before **Competencies developed**.

### Section: Class Structure

Rendered only when `profile.class_structure` is non-null. Shows:

- A read-only source/citation badge (`SourceBadge`, same as on Overview) in the section header.
- **Topics** — an ordered list of `class_structure.topics` (each item editable inline via a text input, with add/remove controls, matching the `at_a_glance` bullet editing pattern in `CourseOverview`).
- **Cadence** — a single-line text input, editable.
- **Assessment** — a textarea, editable.
- A **"not yet captured" notice** (instead of the section) when `class_structure` is null, consistent with the `LegacyBanner` pattern for missing `overview`.

Reviewer edits update the local draft profile (same `setDraftProfile` / `onProfileChange` pattern used today) and are persisted when the snapshot is written.

### Section: Major Projects

Rendered only when `profile.major_projects` is non-null (and the array is non-empty). Shows:

- A read-only source/citation badge in the section header.
- Each project as a card with:
  - **Title** — editable text input.
  - **Description** — editable textarea.
  - **Develops** — a tag list of `competencies` strings (read-only, linking each to the corresponding competency card in the Competencies section below via an in-page anchor). The competency strings are not editable in this panel — they derive from the competencies array.
- Add/remove project controls (add a blank card; remove with confirmation).
- A **"not yet captured" notice** when `major_projects` is null, same pattern as Class Structure.

Reviewer interactions set `reviewerStatus` to `'edited'` on any change (same as today's `reviewed-profile-field` tracking).

---

## wiki-update changes

### Input expansion — `loadCourseInfo` + sheet pull (`lib/ai/wiki/update.ts`)

`loadCourseInfo(courseCode)` today selects only `title`, `level`, `prerequisites` from the `courses` table. It becomes:

```ts
async function loadCourseInfo(courseCode: string): Promise<CourseInfo> {
  // 1. Try the live sheet first (5s timeout, 60s in-process cache, fails silently).
  const sheetData = await fetchLiveCourseFromSheet(courseCode);
  // 2. Fall back to the DB courses row for fields the sheet didn't return.
  const dbRow = await db.select({ title, level, prerequisites })
    .from(courses).where(eq(courses.code, courseCode)).limit(1);
  // Merge: sheet fields take precedence for live content.
  return {
    title: sheetData?.title ?? dbRow[0]?.title ?? courseCode,
    level: sheetData?.level ?? dbRow[0]?.level ?? 0,
    prerequisites: ...  // same normalization logic as today
    sheetDescription: sheetData?.description ?? null,
    sheetLearningObjectives: sheetData?.learningObjectives ?? [],
    sheetMajorProjects: sheetData?.majorProjects ?? [],
    sheetSkillsRequired: sheetData?.skillsRequired ?? [],
    syllabusUrl: sheetData?.syllabusUrl ?? null,
    sheetSourceUrl: sheetData
      ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`
      : null,
  };
}
```

`CourseInfo` is a local interface in `update.ts` (not exported), so its expansion is non-breaking.

`fetchLiveCourseFromSheet` (`lib/sheets/fetchLiveCourse.ts`) is already gated on `GOOGLE_SHEET_ID` and returns `null` on any failure (network, timeout, missing tab, parse error). No new failure modes are introduced; the existing 5s timeout and 60s cache are unchanged.

### User-message assembly (`updateWikiForSnapshot`)

The `userMessage` JSON object passed to the LLM gains new fields under `snapshot`:

```jsonc
"snapshot": {
  ...existing fields (id, courseCode, courseSlug, courseTitle, courseLevel, coursePrerequisites, caption, reviewerNote, createdAt, profile)...,
  "courseDescription": "<from sheetData or null>",
  "courseLearningObjectives": ["<objective>", ...],
  "courseMajorProjects": ["<project title>", ...],
  "courseSkillsRequired": ["<skill>", ...],
  "syllabusUrl": "<url or null>",
  "sheetSourceUrl": "<Google Sheet URL or null>"
}
```

These fields come from the extended `CourseInfo`. When `GOOGLE_SHEET_ID` is unset or the sheet fetch fails, all new fields are `null` / empty arrays; the prompt and templates are written to handle that gracefully (omit section vs. render fallback).

### Course-page template (`lib/ai/prompts/wiki-update.md`)

Four new sections are added to the course-page body, inserted between the existing **Audit notes** (§7) and **Source snapshots** (§8):

#### Section 8a — Class structure

```markdown
## Class structure

- **Topics covered:** {comma-separated ordered topic list from `profile.class_structure.topics`}
- **Cadence:** {`profile.class_structure.cadence`}
- **Assessment:** {`profile.class_structure.assessment`}
```

Rule: render this section only when `profile.class_structure` is non-null. When null, omit the section entirely (do NOT render "not yet captured" noise on the wiki page — the absence is silent). There is no fallback from the sheet for class structure because `ParsedCourse` has no cadence or assessment fields.

#### Section 8b — Major projects

```markdown
## Major projects

- **{project.title}** — {project.description} Develops [[{competency-slug}]] (one wikilink per listed competency, slugified from the statement).
```

Rules:
- Render from `profile.major_projects` when non-null and non-empty.
- **Fallback:** if `profile.major_projects` is null or empty AND `snapshot.courseMajorProjects[]` is non-empty (from the sheet), render:
  ```markdown
  ## Major projects

  *The following project list comes from the course sheet — not yet captured in a profile audit.*

  - {project title from sheet}
  - {project title from sheet}
  ```
- If both are null/empty, omit the section.

Wikilink slugification for competency references: lowercase, replace spaces with hyphens, strip punctuation — the same convention used elsewhere in the course page.

#### Section 8c — Syllabus

```markdown
## Syllabus

{courseDescription — 1-3 sentences from the sheet. If null, omit the description paragraph.}

**Learning objectives:**

- {objective}

**Skills students should arrive with:**

- {skill}

**Major projects:** see [Major projects](#major-projects) above.

**Links:** {syllabusUrl link when set} · {sheetSourceUrl link when set}
```

Rules:
- Render this section only when at least one of `courseDescription`, `courseLearningObjectives[]`, `courseSkillsRequired[]`, `syllabusUrl`, or `sheetSourceUrl` is non-null/non-empty.
- The **Learning objectives** and **Skills students should arrive with** sublists are omitted when the respective arrays are empty.
- The **Major projects** cross-reference line is omitted when the Major projects section above is also absent.
- The **Links** line is omitted when both `syllabusUrl` and `sheetSourceUrl` are null.
- When no sheet data is available at all, omit the section entirely.

#### Section 8d — Outcomes

The existing **Competencies developed** section (§6) already covers outcomes. The Syllabus section above lists the catalog-stated learning objectives from the sheet. There is no separate Outcomes section needed — the two are intentionally distinct (stated intent vs. evidenced attainment) and already separated by document structure.

### Updated body-section order for course pages

1. H1
2. Overview narrative
3. At a glance
4. Who it's for
5. The arc
6. **Competencies developed** (K/U/D chips — unchanged)
7. **Audit notes** (unchanged)
8. **Class structure** (new)
9. **Major projects** (new)
10. **Syllabus** (new)
11. **Source snapshots** (renumbered from §8)
12. **Cross-references** (renumbered from §9)

The input schema block in the prompt's `## Inputs you receive in the user message` section is updated to show the new `snapshot` fields.

### Security/allowlist unchanged

The `requestedPaths` allowlist in `updateWikiForSnapshot` (`update.ts:774`) only permits paths in the deterministic `computeAffectedPages` set. The new sections are inline content on `courses/<slug>.md`, which is already in that set. No new paths are introduced; the security boundary is unaffected.

### Bounded-batch constraint unchanged

`WIKI_PAGES_PER_CALL = 6` stays. The additional inline content on the course page increases the token budget for that page but does not add pages to the affected set. The course page is always in the first batch (per the ordering note in `computeAffectedPages`), so the additional content rides in batch 1 without disturbing the batching logic.

---

## Backward compatibility

| Scenario | Behavior |
|---|---|
| Legacy snapshot, `class_structure: undefined` or `null` | `classStructureSchema.nullable().optional()` accepts it; Zod parse succeeds. Review panel shows "not yet captured" notice. Wiki omits Class-structure section. |
| Legacy snapshot, `major_projects: undefined` or `null` | Same Zod acceptance. Review panel shows notice. Wiki falls back to sheet list if present, else omits. |
| `GOOGLE_SHEET_ID` unset | `fetchLiveCourseFromSheet` returns `null`; all new `CourseInfo` fields are null/empty. Syllabus and Major-projects fallback sections are omitted. Class-structure omitted. Nothing breaks. |
| Sheet fetch timeout / error | Same as above — `fetchLiveCourseFromSheet` already returns `null` on any failure. |
| New snapshot, synthesis emits `null` for thin materials | Both fields are null. Falls through to the fallback/omit paths above. |
| v1 `captureScaleVersion` snapshots | No change — `scale_version` is `'v1'` for all existing and new snapshots; the version constant is not bumped by this feature (the new fields are additive optional fields, not a schema version break). |

---

## Open questions

1. **Competency slug derivation for wikilinks in Major-projects.** The spec calls for slugifying `competency` strings from `major_projects[].competencies` into wikilinks. This is a heuristic (lowercase + hyphenate). A project citing "Students prepare production-ready package artwork" should produce `[[students-prepare-production-ready-package-artwork]]`, which is not a real sub-competency slug. Decision needed before implementation: either (a) `competencies` on a project item stores the *sub-competency ID slug* (e.g. `production-operations`) rather than the full statement, (b) the wiki-update prompt attempts best-effort matching, or (c) wikilinks are omitted from the Major-projects section and the `competencies` list is rendered as plain text. **Recommendation: option (a) — store the sub-competency ID when a match exists, the full statement otherwise, and the prompt tries to resolve.** This is unresolved; the plan must pick one.

2. **Capture-chat priming for the new fields.** The capture auditor chat (`lib/ai/prompts/capture-synthesis.md` isn't the chat prompt — the chat is `lib/ai/prompts/capture-chat.md` or similar) may need an Audit-Area addition to probe class structure and major projects before synthesis. If the chat never discusses them, synthesis can only fall back to materials. This spec covers synthesis-only extraction; whether to add a dedicated chat area is deferred.

3. **`assessment` prose field — granularity floor.** "Plain prose overview" is deliberately underspecified for edge cases: a course whose grading is entirely studio-judgment with no stated breakdown produces `assessment: null` or a stub. The spec says emit null if materials are too thin; the synthesis prompt should make explicit that a stub like "graded at instructor discretion — no breakdown available" is preferable to null when the course is clearly graded.

---

## Suggested increments

Each increment is independently testable and shippable.

### Step 1 — Schema + types (no behavior change)

- Add `classStructureSchema`, `majorProjectItemSchema`, and the two new optional fields to `captureProfileSchema` in `lib/ai/capture/schema.ts`.
- Extend `captureProfileJsonSchema` in `lib/ai/analyze/capture-scores.ts` with the new fields, following the nullable-union strict-mode pattern.
- Add a unit test asserting `required` equals `Object.keys(properties)` recursively for the full `captureProfileJsonSchema` (the existing walker test pattern).
- **Test:** `pnpm test` passes; existing snapshot parse tests still parse without the new fields (they're `.nullable().optional()`).

### Step 2 — Synthesis extraction

- Update the `# Output schema` block and add the **"Class structure and major projects"** extraction section in `lib/ai/prompts/capture-synthesis.md`.
- Add the new fields to the synthesis prompt's output-schema illustration.
- **Test:** run synthesis against one course with rich materials (e.g. GC 3460) and verify (a) `class_structure` is non-null, (b) `major_projects` has ≥1 entry, (c) each project's `citations` resolves, (d) `captureProfileSchema.parse` succeeds on the output.

### Step 3 — Faculty review UI

- Add Class-structure and Major-projects sections to `ProfileReviewPanel.tsx`.
- Render the "not yet captured" notice for null fields (reuse `LegacyBanner` or a lightweight inline variant).
- Wire inline editing to `setDraftProfile` / `onProfileChange` (same flow as `CourseOverview` editing today).
- **Test:** render a snapshot with non-null new fields — sections appear, edits mutate draft. Render a legacy snapshot — notices appear, no crash.

### Step 4 — wiki-update input + course-page template

- Extend `loadCourseInfo` in `lib/ai/wiki/update.ts` to call `fetchLiveCourseFromSheet` and merge results into the extended `CourseInfo`.
- Extend the `userMessage` assembly in `updateWikiForSnapshot` to pass the new `CourseInfo` fields.
- Update `lib/ai/prompts/wiki-update.md` course-page template with the four new sections (Class structure, Major projects, Syllabus, and the updated body order).
- **Test:** trigger wiki regen for a course that has a non-null `class_structure` and `major_projects` in its snapshot; verify the rendered page contains those sections. Trigger for a legacy snapshot that has sheet data; verify the Major-projects fallback renders with the "from the course sheet" label.

### Step 5 — Backward-compat / fallbacks verification

- Run the full test suite against legacy fixture snapshots (null new fields) — confirm no Zod parse failures, no crashes in `ProfileReviewPanel`, no wiki-update exceptions.
- Confirm behavior with `GOOGLE_SHEET_ID` unset: sheet-dependent sections absent, no unhandled rejection in `loadCourseInfo`.
- **Test:** integration test for `updateWikiForSnapshot` with `GOOGLE_SHEET_ID=` (empty) — page content does not include Syllabus or Major-projects-fallback sections.

---

*The feature is complete when: (a) a fresh audit of GC 3460 produces non-null `class_structure` and `major_projects` in the profile; (b) the Review panel shows and allows editing both; (c) the wiki course page for GC 3460 contains Class structure, Major projects, and Syllabus sections; (d) `/ask` can answer "What are the major projects in GC 3460?" from wiki text; (e) all existing tests pass.*
