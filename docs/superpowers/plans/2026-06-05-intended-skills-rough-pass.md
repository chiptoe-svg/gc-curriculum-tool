# Intended-Skills Rough Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A cheap one-LLM-call-per-course extractor that produces **intended** (syllabus-asserted) K/U/D per sub-competency for uncaptured courses, banded evidence-ladder `claimed`, feeding the prerequisite-gap engine's already-wired `basis:'intended'` seam + the `/courses` `intended` data-state badge — so cold-start gap views are non-empty, without corroding measured numbers.

**Architecture:** New `course_intended_coverage` table (migration 0031) is the sole home for intended depths; never merged into measured `snapshotTargetCoverage`. A new `intended-skills-extract` AI function reads catalog fields + the sub-competency catalog. `computePrereqGaps` is fed intended rows at its existing seam (per-prereq measured-wins handled by the pure engine — no engine logic change). `getCourseDataStates` produces the reserved `intended` state. **Binding rule:** intended is reference-only in CourseCapture (this plan does NOT touch capture).

**Tech stack:** Existing — Next.js 15, Drizzle + local Postgres 17, Vitest, Vercel AI SDK structured output, slug-gated admin + daily-cap pattern, strict-mode JSON-schema + walker-test discipline.

**Design:** [`docs/superpowers/specs/2026-06-05-intended-skills-rough-pass-design.md`](../specs/2026-06-05-intended-skills-rough-pass-design.md).

---

## Scope notes
- **Do NOT touch CourseCapture** — the reference-panel is deferred; the binding "reference-only / band-sticky" rule is documented in the spec for the future. v1 = engine + map consumers only.
- **No engine logic change** — `computePrereqGaps`'s pure core already does per-prereq measured-over-intended; this plan only *feeds* intended rows at the seam.
- **Branch `feat/intended-skills`** (don't work on main).

---

## Task 1: Migration 0031 — `course_intended_coverage`

**Files:** Modify `lib/db/schema.ts`; Create `drizzle/0031_*.sql`.

- [ ] **Step 1:** Add to `schema.ts` (confirm `primaryKey`, `index`, `integer`, `text`, `timestamp` imported):
```typescript
/**
 * Syllabus-rough INTENDED coverage — "what the course says it teaches", a
 * different quantity from measured attainment. Evidence-ladder band: claimed.
 * NEVER merged into snapshot_target_coverage. Migration 0031.
 * Design: docs/superpowers/specs/2026-06-05-intended-skills-rough-pass-design.md
 */
export const courseIntendedCoverage = pgTable('course_intended_coverage', {
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  subCompetencyId: text('sub_competency_id').notNull().references(() => subCompetencies.id, { onDelete: 'cascade' }),
  intendedK: integer('intended_k'),
  intendedU: integer('intended_u'),
  intendedD: integer('intended_d'),
  confidence: text('confidence').notNull(),
  rationale: text('rationale').notNull().default(''),
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.courseCode, t.subCompetencyId] }),
  courseIdx: index('idx_course_intended_coverage_course').on(t.courseCode),
}));
```
- [ ] **Step 2:** `pnpm db:generate` → inspect `drizzle/0031_*.sql` (pure additive CREATE TABLE + PK + index + 2 FKs; STOP if any destructive op). **Step 3:** apply (`set -a; source .env.local; set +a; pnpm db:migrate`). **Step 4:** verify `\d course_intended_coverage`. **Step 5:** commit `feat(schema): 0031 — course_intended_coverage (syllabus-rough intended depths)`.

---

## Task 2: Intended-coverage queries + `intended` data-state

**Files:** Modify `lib/db/courses-queries.ts` (cohesive with `getCourseDataStates`); Create/extend the test.

- [ ] **Step 1 (failing test):** `replaceIntendedCoverage(courseCode, rows)` deletes the course's existing intended rows then inserts the new set (idempotent re-run); `getIntendedCoverageForCourse(courseCode)` returns them; `getIntendedCoverageForCourses(codes[])` batch-returns keyed rows (used by the gap engine); `getCourseDataStates` now returns `intended` when a `course_intended_coverage` row exists and no snapshot, `measured` when a snapshot exists (measured wins), `no-data` otherwise.

- [ ] **Step 2:** Implement:
```typescript
export interface IntendedCoverageRow {
  courseCode: string; subCompetencyId: string;
  intendedK: number | null; intendedU: number | null; intendedD: number | null;
  confidence: 'high' | 'medium' | 'low'; rationale: string;
}
export interface NewIntendedRow {
  subCompetencyId: string; intendedK: number | null; intendedU: number | null; intendedD: number | null;
  confidence: 'high' | 'medium' | 'low'; rationale: string;
}

/** Replace a course's intended coverage atomically (delete-then-insert in a tx). */
export async function replaceIntendedCoverage(courseCode: string, rows: NewIntendedRow[], model: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(courseIntendedCoverage).where(eq(courseIntendedCoverage.courseCode, courseCode));
    if (rows.length === 0) return;
    await tx.insert(courseIntendedCoverage).values(rows.map(r => ({
      courseCode, subCompetencyId: r.subCompetencyId,
      intendedK: r.intendedK, intendedU: r.intendedU, intendedD: r.intendedD,
      confidence: r.confidence, rationale: r.rationale, model,
    })));
  });
}

export async function getIntendedCoverageForCourse(courseCode: string): Promise<IntendedCoverageRow[]> {
  const rows = await db.select().from(courseIntendedCoverage).where(eq(courseIntendedCoverage.courseCode, courseCode));
  return rows as IntendedCoverageRow[];
}

/** Batch lookup for the gap engine: intended rows for a set of (prereq) courses. */
export async function getIntendedCoverageForCourses(courseCodes: string[]): Promise<IntendedCoverageRow[]> {
  if (courseCodes.length === 0) return [];
  const rows = await db.select().from(courseIntendedCoverage).where(inArray(courseIntendedCoverage.courseCode, courseCodes));
  return rows as IntendedCoverageRow[];
}

/** Course codes that lack any measured snapshot (the rough-pass targets). */
export async function listUncapturedCourseCodes(): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT c.code FROM courses c
    WHERE NOT EXISTS (SELECT 1 FROM course_capture_snapshots s WHERE s.course_code = c.code)
    ORDER BY c.code
  `);
  return rows.rows.map((r: any) => r.code as string);
}
```
- [ ] **Step 3:** Update `getCourseDataStates`'s SQL `CASE` so it is: `measured` when a snapshot exists, else `intended` when a `course_intended_coverage` row exists, else `no-data`:
```sql
CASE
  WHEN EXISTS (SELECT 1 FROM course_capture_snapshots s WHERE s.course_code = c.code) THEN 'measured'
  WHEN EXISTS (SELECT 1 FROM course_intended_coverage i WHERE i.course_code = c.code) THEN 'intended'
  ELSE 'no-data'
END AS data_state
```
- [ ] **Step 4:** tests green; `npx tsc --noEmit --skipLibCheck 2>&1 | grep courses-queries || echo clean`. **Step 5:** commit `feat(db): intended-coverage queries + intended data-state`.

---

## Task 3: `intended-skills-extract` AI function

**Files:** Create `lib/ai/prompts/intended-skills-extract.md`, `lib/ai/analyze/intended-skills-extract.ts`, `tests/ai/intended-skills-extract-schema.test.ts`; Modify `lib/ai/function-settings.ts`, `lib/ai/prompts/load.ts`.

- [ ] **Step 1 — register:** add `'intended-skills-extract'` to `AI_FUNCTION_IDS` + `DEFAULT_TIERS` (`'default'`, rationale comment) + labels/descriptions if present (count 20→21); add to `PromptName` union.
- [ ] **Step 2 — prompt** (`includes: shared/depth-scale.md`): "You read a course's catalog text (description, learning objectives, major projects, required skills) and the sub-competency catalog. Emit the **INTENDED** K/U/D depth the course teaches/assesses toward for each sub-competency the catalog text plausibly implies — this is **syllabus aspiration, NOT verified student attainment**. Anchor depths to the depth scale but treat them as intended. Sub-competencies are listed WITH their `id` in brackets; emit `sub_competency_id` = the bracketed id, never invent one. Omit sub-competencies the text doesn't imply. Lower `confidence` when the text is thin/generic. Emit `[]` if the catalog text is empty/uninformative. Never claim attainment."
- [ ] **Step 3 — schema + runner** (`lib/ai/analyze/intended-skills-extract.ts`):
  - `IntendedSkills` Zod: `{ items: z.array(z.object({ sub_competency_id: z.string().min(1), intended_k: nullable int 0-5, intended_u: <same>, intended_d: <same>, confidence: enum, rationale: z.string().min(1).max(600) })) }`.
  - `intendedSkillsJsonSchema` strict-mode (every prop in `required`; nullable ints `['integer','null']`, min0 max5; `additionalProperties:false`).
  - `extractIntendedSkills(input: { courseCode, catalog: { description, learningObjectives: string[], majorProjects: string[], skillsRequired: string[] }, subCompetencies: Array<{ id, name, knowDescriptor, understandDescriptor, doDescriptor }> })` → userMessage renders the catalog text + the sub-competencies WITH ids (reuse the `prereq-edge-seed.ts` rendering pattern) → `provider.complete` (verified contract) → `{ items, model, costUsdCents, durationMs }`.
- [ ] **Step 4 — walker test:** reuse the strict-mode `assertStrictMode` walker on `intendedSkillsJsonSchema` + Zod accept/reject.
- [ ] **Step 5:** `tsc` clean for the new files; commit `feat(ai): intended-skills-extract function (prompt + runner + strict schema + walker test)`.

---

## Task 4: Wire the gap-engine `intended` seam

**Files:** Modify `lib/program/prereq-gaps.ts` (DB wrapper only — NOT the pure engine); Modify `tests/program/prereq-gaps.test.ts` (add a DB-less integration-style test of the wrapper's feeding, or a pure test confirming intended rows flow through).

- [ ] **Step 1:** At the `INTENDED-BASIS SEAM` in `computePrereqGaps`'s DB wrapper: after collecting the relied `(prereqCourseCode, subCompetencyId)` pairs, batch-load intended coverage for the distinct relied prereq codes via `getIntendedCoverageForCourses(...)`. For each relied `(prereq, subComp)`, in addition to the existing measured row (when a snapshot coverage row exists), push a `DeliveredAttainment{ prereqCourseCode, subCompetencyId, k: intendedK, u: intendedU, d: intendedD, basis: 'intended' }` when a matching `course_intended_coverage` row exists. **Push BOTH measured and intended when both exist** — the pure engine's per-prereq logic already prefers measured per prereq, so no precedence code is needed here. Remove/replace the seam's TODO comment with the real lookup.
- [ ] **Step 2:** Confirm no change to `computeGapsFromInputs` (the pure core). The per-prereq measured-over-intended + `basis` rollup already exist (verified in the prereq build).
- [ ] **Step 3 (test):** Add a wrapper-level test if the repo's mock convention supports it (mock `listEdgesForFocal` + the snapshot/intended lookups); OR, at minimum, a pure-engine test asserting: a relied prereq with only an intended row contributes `basis:'intended'`; a relied prereq with both measured+intended uses measured (already covered by the prereq build's per-prereq tests — reference it). 
- [ ] **Step 4:** `tsc` clean; `pnpm vitest run tests/program/prereq-gaps.test.ts` green; commit `feat(prereq-gaps): feed intended coverage at the basis:'intended' seam (per-prereq, measured-wins)`.

---

## Task 5: Admin route — seed intended skills

**Files:** Create `app/api/admin/courses/intended-skills/route.ts`.

- [ ] **Step 1:** Slug-gated POST (mirror `prereq-edges` route auth + daily-cap pattern):
  - Body `{ mode: 'one', code }` → seed one course. `{ mode: 'all-uncaptured' }` → `listUncapturedCourseCodes()` then seed each (loop; one AI call per course).
  - For each course: load catalog fields (`getCourseByCode`) + the sub-competency catalog (`listTargets` → flatMap subCompetencies, as in the prereq route) → `checkDailyCap` BEFORE each call (stop the loop + report partial if the cap trips) → `extractIntendedSkills(...)` → validate each `sub_competency_id` against the catalog (drop unknown → report) → `replaceIntendedCoverage(code, validRows, model)` → `recordSpend(costUsdCents)` in a `finally` per the prereq-edges fix.
  - Return `{ seeded: [{ code, count }], skippedNoCatalogText: [...], stoppedAtCap?: boolean }`. 404 if a `mode:'one'` code is unknown. 400 on bad body.
- [ ] **Step 2:** `tsc` clean; commit `feat(api): admin intended-skills seed route (one / all-uncaptured, daily-cap gated)`.

---

## Task 6: Docs

**Files:** Modify `docs/STATE.md`, `docs/superpowers/README.md`; light touch on `docs/background.html` (the intended-vs-attained method is already documented from the prereq increment — just add a sentence that the rough pass is how `intended` data is produced).

- [ ] STATE.md: add `course_intended_coverage` to the schema/tables list + migration 0031; add `intended-skills-extract` to the AI tier table (count 20→21); add the admin route; flip the spec row "spec'd → shipped"; bump Last-verified SHA + date.
- [ ] README.md: plan row → Done.
- [ ] background.html: one sentence under the existing prerequisite-gap/intended-vs-attained section noting the rough pass is the mechanism that produces `intended` (syllabus-asserted, `claimed`-band) coverage — and restate the reference-only-in-capture rule.
- [ ] Commit `docs: intended-skills rough pass shipped — STATE/README + method note`.

---

## Final review
Full `tsc` (0) + `pnpm vitest run` green, then a focused adversarial review (schema strict-mode, the seam feeding measured+intended correctly, slug+daily-cap on the route, evidence-above-zero never violated / intended never written to snapshot_target_coverage), fix confirmed findings, then `superpowers:finishing-a-development-branch`.

## Self-review checklist (author)
- ✅ **Spec coverage:** table (T1), queries + `intended` state (T2), extractor (T3), seam wiring (T4), admin seed route (T5), docs (T6). Capture untouched (binding rule). Engine logic unchanged (only fed).
- ✅ **No placeholders:** load-bearing code (schema, queries, seam) complete; AI/route carry precise specs + the verified `provider.complete` contract + the prereq-route pattern to mirror.
- ✅ **Type consistency:** `courseIntendedCoverage`, `IntendedCoverageRow`/`NewIntendedRow`, `replaceIntendedCoverage`, `getIntendedCoverageForCourses`, `listUncapturedCourseCodes`, `IntendedSkills`/`intendedSkillsJsonSchema`, `extractIntendedSkills` — consistent across tasks.
- ✅ **Honesty invariants:** intended never written to `snapshotTargetCoverage`; banded `claimed`; measured-wins per-prereq (pure engine, unchanged); capture not touched.
