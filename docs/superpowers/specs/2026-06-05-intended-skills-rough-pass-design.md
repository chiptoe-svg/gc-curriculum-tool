# Intended-Skills Rough Pass (Syllabus-Rough Cold-Start) — Design

> **Status:** design draft, 2026-06-05 — for review. The **companion increment** to the persisted prerequisite edges ([design](./2026-06-05-prerequisite-edges-design.md)), sequenced second per that spec. It addresses the cold-start problem: most courses have no captured snapshot, so prerequisite-gap views (and the program map) read mostly `no_data`. This produces a cheap, clearly-banded **intended** baseline so those surfaces are useful on day one — without corroding the evidence-based numbers.

> **Origin:** brainstorming 2026-06-05. The load-bearing constraint (intended ≠ attained; capture is reference-only; the band never upgrades on confirm) was decided in that dialogue and is binding here.

## The problem

CourseCapture is laborious; few courses are captured. The prerequisite-gap engine (`computePrereqGaps`) reads each prereq's **measured** attainment from `snapshotTargetCoverage`; with no snapshot, every gap returns `no_data`. The `/courses` data-state badge shows `no-data` almost everywhere. The feature works but renders empty.

## The honest mitigation

A **syllabus-rough "intended" estimate** — "what the course *says* it teaches" — extracted from the catalog fields a course already has. Crucially, **intended is a different quantity from attained depth** and is governed by the **evidence-above-zero rule** (CLAUDE.md): syllabus aspiration may NEVER be presented as student attainment. So intended data is:
- stored **separately** from measured attainment (its own table; never written into `snapshotTargetCoverage`),
- surfaced as the evidence ladder's lowest band (`claimed` / syllabus-asserted), always visibly flagged,
- **subordinate to measured** wherever both exist (the gap engine already prefers measured per-prereq).

## Locked design decisions (from brainstorming)

1. **Intended ≠ attained.** Stored in its own table, banded `claimed`, never merged into measured coverage.
2. **CourseCapture is reference-only (BINDING RULE).** The rough pass feeds the prereq engine + the program map. It does **NOT** prefill the CourseCapture instructor flow's answer fields. If intended data is ever surfaced *inside* capture, it must be a clearly-dimmed **"from your syllabus — verify against what students actually did"** reference/checklist, never pre-populated attainment. **Confirming a prefilled item is not evidencing it** — the credibility band is sticky and can be upgraded out of `claimed` *only* by real evidence (assessment items / graded artifacts), never by confirmation. (Rationale: prefilling answers invites acquiescence bias and would launder aspiration → attainment — the exact failure the evidence rule exists to prevent. The capture agent already reads the syllabus as context, so explicit prefill adds little benefit for large anchoring cost.)
3. **v1 builds the engine + map consumers only; the capture reference-panel is DEFERRED** (built later, if at all, under rule #2) — keeps v1 focused and avoids any anchoring risk until we've seen the extraction quality on real syllabi.
4. **measured wins, per-prereq** — already implemented in `computePrereqGaps` (the `intended` branch is wired and inert; this increment makes it produce data).

## Data model

New table `course_intended_coverage` — one row per `(courseCode, subCompetency)` the syllabus implies the course teaches toward:

```ts
export const courseIntendedCoverage = pgTable('course_intended_coverage', {
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  subCompetencyId: text('sub_competency_id').notNull().references(() => subCompetencies.id, { onDelete: 'cascade' }),
  intendedK: integer('intended_k'),   // INTENDED depth (syllabus aspiration), nullable per dim
  intendedU: integer('intended_u'),
  intendedD: integer('intended_d'),
  confidence: text('confidence').notNull(),   // 'high' | 'medium' | 'low' (extraction confidence)
  rationale: text('rationale').notNull().default(''),  // what in the catalog implied this
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.courseCode, t.subCompetencyId] }),
  courseIdx: index('idx_course_intended_coverage_course').on(t.courseCode),
}));
```
Migration `0031`. This is the ONLY place intended depths live. `snapshotTargetCoverage` (measured) is untouched.

## The AI function — `intended-skills-extract`

New default-tier function (module under `lib/ai/analyze/`, registered in `function-settings.ts`, count 20→21; `PromptName` union entry). For one course it reads the catalog fields that exist on an **uncaptured** course — `description`, `learningObjectives[]`, `majorProjects[]`, `skillsRequired[]` (and `syllabusUrl` text if readily available; v1 may use only the on-row fields) — plus the sub-competency catalog (each `{id, name, K/U/D descriptors}`, rendered WITH ids, per the proven `prereq-edge-seed` pattern). It emits, per sub-competency the course plausibly teaches toward, the **intended** `k/u/d` depth + `confidence` + a `rationale` quoting the catalog evidence.

- **Prompt framing (honesty):** "Score what the syllabus/catalog SAYS the course teaches or assesses — INTENDED coverage, not verified student attainment. Anchor depths to the depth scale, but understand these are aspirational. Emit only sub-competencies the catalog text actually implies; omit the rest. Never present this as evidence of attainment." Strict-mode JSON schema (every property in `required`, nullable ints `['integer','null']`, `additionalProperties:false`) + recursive walker test.

## Consumers (v1)

1. **Prereq gap engine.** In `computePrereqGaps`'s DB wrapper, at the documented `INTENDED-BASIS SEAM`: for each relied `(prereqCourse, subComp)` with **no measured** snapshot row, look up `course_intended_coverage` and, if present, contribute a `DeliveredAttainment{ basis:'intended', k/u/d }`. The pure engine already handles per-prereq measured-over-intended + the `basis` rollup — **no engine logic change**, just feed the seam. Gap results then show `basis:'intended'` (already rendered as "syllabus-promise — not verified" in the per-course gap view).
2. **`/courses` data-state badge.** Extend `getCourseDataStates`: `measured` (snapshot exists) → else `intended` (a `course_intended_coverage` row exists) → else `no-data`. The `intended` badge style is already wired in the UI.

## Admin trigger

Slug-gated route (mirror the `prereq-edge-seed` route + daily-cap pattern): `POST /api/admin/courses/intended-skills` with `{ mode:'one', code }` or `{ mode:'all-uncaptured' }` (seed every course lacking a measured snapshot — the bulk cold-start action). Each course = one AI call; daily-cap-checked before, `recordSpend` after (in a `finally`, per the prereq-edges fix). Re-running replaces a course's intended rows (delete-then-insert for that course).

## Honesty + non-goals

- **Evidence-above-zero preserved.** Intended depths are never attainment. The band is `claimed`; the gap view flags it; the data-state badge distinguishes it. measured always wins.
- **No CourseCapture prefill** (rule #2). The capture reference-panel is deferred; when/if built, it is reference-only and band-sticky.
- **No auto-re-seed** on syllabus change (manual re-run for v1).
- **No program-wide viz** (inherits the prereq spec's deferral).
- **`syllabusUrl` fetching/PDF extraction** beyond on-row catalog fields is out of v1 (use the catalog fields the sync already populates).

## Risks (surfaced in brainstorming, accepted with mitigations)

- **Noisy extraction** from thin syllabi → mitigated by the `claimed` band + "not verified" flags + faculty can ignore/override; never feeds measured.
- **False-coverage complacency** (a populated map looks "done") → the `intended` badge + the gap view's explicit "syllabus-promise" labels keep the distinction visible; the program-map (deferred) must render `intended` distinctly from `measured`.
- **Staleness** → manual re-run; auto-re-seed deferred.

## Success criteria

- Running the extractor on an uncaptured course populates `course_intended_coverage` with banded intended depths keyed to real sub-competency ids.
- A prereq whose only data is intended now contributes a `basis:'intended'` delivered value to `computePrereqGaps` (per-prereq; suppressed by a measured row on the *same* prereq, not on a sibling), surfaced as "syllabus-promise — not verified."
- `/courses` shows the `intended` data-state badge for such courses.
- CourseCapture is unchanged — no prefill; the binding reference-only/band-sticky rule is documented for any future capture integration.
- Strict-mode schema clean (walker test); evidence-above-zero never violated (intended never written to `snapshotTargetCoverage`).

## Related

- [`docs/superpowers/specs/2026-06-05-prerequisite-edges-design.md`](./2026-06-05-prerequisite-edges-design.md) — the engine this feeds; the `basis: measured|intended|none` seam.
- `lib/program/prereq-gaps.ts` — the `INTENDED-BASIS SEAM` comment marks the injection point.
- `lib/db/courses-queries.ts` — `getCourseDataStates` (`intended` state reserved).
- `lib/ai/analyze/prereq-edge-seed.ts` — the catalog-id-rendering pattern to reuse for the prompt.
- `docs/STATE.md` — update on build: new table, migration 0031, AI function (20→21), the admin route; flip this spec "spec'd → shipped".
