# M-Trial Dual Analysis Modes + Target Preview — Design

**Date:** 2026-05-19
**Status:** Approved design, ready for implementation planning.
**Sibling docs:** [v1 Curriculum Tool Design](./2026-05-17-gc-curriculum-tool-v1-design.md), [Vision](../vision/gc-curriculum-tool-vision.md).

## Why this exists

The M-trial prototype currently runs a single combined analysis: pick a focal course, paste prior coursework, pick a career target, click *Analyze*, get KUD drafts + coverage heat map + prerequisite gaps + scaffolding in one go. That's the right shape for one question — *does this course's prereqs actually prepare students for it?* — but it's the wrong shape for a different, equally important question — *does this chain of courses build toward a career target?*

The chain question doesn't have a focal course. Every course in the chain matters equally; the analysis is about whether the *set* covers the target, not whether any one course is well-prepared. Trying to use the prereq form for this question forces faculty to arbitrarily designate one course as "focal," which distorts the input and confuses the output.

This spec splits the prototype's analysis into two explicit modes with their own forms and outputs, and adds inline visibility of what the AI is scoring against (the career target's current K/U/D descriptors) so faculty can see the rubric before they run the analysis.

## v1 Scope

Three coordinated changes:

1. **Split the single Analyze button into two tabs** at the top of the prototype page (`/preview/[slug]`):
   - **Tab 1 — Career-target alignment** *(new)*: a set of 2–16 courses → coverage of the target across the chain + scaffolding (progression).
   - **Tab 2 — Prereqs feeding a course** *(existing flow, unchanged externally)*: focal course + prior coursework → coverage + prereq gaps + scaffolding.

2. **Inline K/U/D preview** of the currently-selected career target, shown on both tabs. Faculty can see the descriptors being scored against; a link jumps to the existing target editor for full editing.

3. **Refactor the analysis pipeline** into shared per-call helpers under `lib/ai/analyze/`, so both routes are thin orchestrators rather than ~300-line inline scripts.

### Out of v1

- Editing career targets inline on the analysis page (the existing editor route stays the only edit surface; we link to it).
- Drag-to-reorder courses in Tab 1 (chain order is derived from course level — `GC 1xxx` first, `GC 4xxx` last).
- Persisting Button A runs to a separate table (one `prototype_runs` table with a discriminator column is enough).
- Admin dashboards aggregating runs by analysis kind.
- Per-tab cost dashboards.

## Architecture

### Routes

| Route | Mode | Method | Notes |
|---|---|---|---|
| `/api/analyze` | course-prereqs (Tab 2) | POST | **Behavior unchanged externally.** Refactored to use shared helpers. Same request schema, same response shape. Pilot faculty mid-analysis see no difference at deploy time. |
| `/api/analyze/target-chain` | target-chain (Tab 1) | POST | **New.** Takes `{ careerTargetId, courses: [{label, syllabus}…] }`, 2–16 courses, no focal. Returns per-course KUDs + per-course coverage + scaffolding. ~2N+1 AI calls. |

Both routes share guards (rate limit + cost cap), telemetry accumulation, and persistence (with an `analysisKind` discriminator).

### Shared helpers — `lib/ai/analyze/`

Extracted from the existing `app/api/analyze/route.ts` and reused by both routes:

| Helper | Responsibility |
|---|---|
| `target-context.ts` | `buildTargetContext(target)` — formats the career target + sub-competencies into a prompt prefix. Moved from existing route. |
| `kud-draft.ts` | `draftKUD({ targetContext, syllabusText })` — one course's KUD outcomes. Wraps `draft-outcomes` prompt + Zod validation. |
| `coverage-score.ts` | `scoreCoverage({ targetContext, courseLabel, kud })` — one course's coverage scores against the target's sub-competencies. Wraps `score-coverage` prompt. |
| `scaffolding-eval.ts` | `evaluateScaffolding({ targetContext, courses })` — chain-wide scaffolding judgment. Each course carries `{ label, level, coverage }`. Wraps `evaluate-scaffolding` prompt. |
| `prereq-suggest.ts` | `suggestPrereqs({ targetContext, courseKud })` — what the focal course expects students to know. **Tab 2 only.** |
| `gap-analyze.ts` | `analyzeGaps({ targetContext, prereqs, priorCoverage })` — does the prior coursework satisfy the focal course's expectations? **Tab 2 only.** |
| `guards.ts` | `applyAnalyzeGuards(req): Promise<NextResponse \| null>` — runs `checkIpRateLimit` + `checkDailyCap`. Returns a short-circuit `NextResponse` on block, `null` on proceed. |
| `persist.ts` | `persistAnalyzeRun({ ipHash, …, analysisKind })` — wraps `insertRun` + `recordSpend` with try/catch so a DB failure doesn't kill the response. |
| `accum.ts` | `TelemetryAccumulator` class — call-site code stops manually summing four counters in every route. |

Each helper has a focused unit test with a mocked provider.

### Tab 1 (Career-target alignment) pipeline

```
POST /api/analyze/target-chain
  1. Zod-validate { careerTargetId, courses: 2..16 items, each with label + syllabus 50..20000 chars }
  2. applyAnalyzeGuards(req) → short-circuit on block
  3. Load career target via getTargetById; 400 if unknown
  4. Sort courses by parseLevelFromLabel ascending, then by label
  5. Round 1 (parallel): N draftKUD calls
  6. Round 2 (parallel): N scoreCoverage calls
  7. Round 3: 1 evaluateScaffolding call (input: all courses with levels + coverages)
  8. persistAnalyzeRun({ analysisKind: 'target_chain', ... })
  9. Return { careerTargetId, courses: [{ label, kud, coverage }, …], scaffolding, meta, runId }
```

**Total AI calls:** 2N+1. At N=8: 17 calls (vs. Tab 2's 21). At N=16: 33 calls.

### Tab 2 (Prereqs feeding a course) pipeline

`/api/analyze` unchanged externally. Internals refactored to use the shared helpers. Logic identical to today:

```
1. Validate, apply guards, load target
2. Round 1 (parallel): N+1 draftKUD calls (priors + course)
3. Round 2 (parallel): N+1 scoreCoverage calls + 1 suggestPrereqs call
4. Round 3 (parallel): 1 analyzeGaps + 1 evaluateScaffolding
5. persistAnalyzeRun({ analysisKind: 'course_prereqs', ... })
6. Return same response shape as today
```

**Total AI calls:** 2N+5 (unchanged). *(The existing route's comment says 2N+4; recounting the actual code shows 2N+5 — N+1 KUDs + N+1 coverages + 1 prereq + 1 gap + 1 scaffolding. The off-by-one comment can be corrected as a minor cleanup during implementation.)*

### Data model

One additive change to `lib/db/schema.ts`:

```ts
export const prototypeRuns = pgTable('prototype_runs', {
  // … existing columns unchanged …
  analysisKind: text('analysis_kind').notNull().default('course_prereqs'),
});
```

Migration `0008_<auto>.sql` (Drizzle-generated):

```sql
ALTER TABLE prototype_runs
  ADD COLUMN analysis_kind text NOT NULL DEFAULT 'course_prereqs';
```

Existing rows backfill to `'course_prereqs'` — correct, since every legacy run is a combined analysis. The new column is the discriminator that lets the UI and any future admin views interpret `result jsonb` correctly.

The existing `prototype_flags.flagType` column already accepts arbitrary text. Adding `'target_chain_coverage'` and `'target_chain_scaffolding'` as new flag types requires no schema change.

## User experience

### Page structure

`/preview/[slug]/page.tsx` adds a tab switcher above the existing form:

- **Tab pill bar** — two buttons: *"Career-target alignment"* | *"Prereqs feeding a course"*. Active tab has a filled background; inactive is outline only. The bar sits between the admin banner and the page header.
- **URL state**: `?tab=target` or `?tab=prereqs` (default `prereqs`). Bookmarkable; the M-trial pilot's existing usage pattern continues to work without anyone needing to relearn anything.
- **Tab switching** — does not preserve form state across tabs. The inputs are fundamentally different (Tab 1 has a course set; Tab 2 has a focal course + priors). Faculty re-pick their courses on each side; this is the right behavior given the mental-model difference.

### Shared component: `TargetKUDPreview`

New `components/TargetKUDPreview.tsx`. Renders below the career-target picker on both tabs.

- **Collapsed by default**, with header: *"Current Know / Understand / Do descriptors for [Target Name]"* + chevron.
- **When expanded**: a compact 3-column read-only display of every sub-competency's Know/Understand/Do bullets for that target. Tight typography; full content is dense, so this isn't trying to be pretty — it's trying to be scannable.
- **Top-right corner**: *"Edit this target →"* link → `/preview/[slug]/targets/[targetId]`.
- **Auto-collapses** when the target picker changes (so it doesn't show stale content from the previous selection).

This is the answer to *"a way to make changes in the career targets within the prototype"* — context surfaced inline, full editing in the dedicated editor, no risk of accidental edits during analysis.

### Tab 1 — Career-target alignment

**Form: `components/TargetChainForm.tsx`**

- **Career target picker** — reuses existing target dropdown.
- **`TargetKUDPreview`** — see above.
- **Course checkbox list**:
  - All courses from the `courses` table (28 courses today, will grow).
  - Grouped by level (Level 1, Level 2, Level 3, Level 4), sorted by code within each level.
  - Each row: checkbox + course code (e.g. *GC 3460*) + course title.
  - None pre-selected.
  - Header text: *"3 of 16 max selected"*. Counter updates live.
  - *Clear all* link.
- **Analyze button** — disabled until ≥2 courses are selected (a 1-course chain doesn't tell you anything about progression). Disabled when the count exceeds 16 (hard cap).

**Results: `components/TargetChainResults.tsx`**

Rendered below the form when an analysis completes.

- **KUD cards per course** — 2-column grid. Sorted by level. All cards are visually identical; no "focal vs. prior" distinction. Reuses existing `KUDCard` component.
- **Coverage heat map** — courses (rows) × sub-competencies (cols). Reuses `CoverageHeatMap` after a refactor:
  - Add an optional `mode: 'chain' | 'focal-plus-priors'` prop. Default `'focal-plus-priors'` preserves Tab 2 behavior.
  - In `'chain'` mode: no focal-course row separator, no "course being analyzed" label, all rows render identically.
- **Scaffolding view** — same component used today, but reads "across this chain" instead of "with course X as focal."
- **No prereq gap section** — intentional; that's a Tab 2 concept.
- **Footer** — same telemetry as Tab 2 (AI provider, duration, cost, cache hit, N courses).

### Tab 2 — Prereqs feeding a course

**Form: existing `PrototypeForm`** — unchanged except for one addition:

- **`TargetKUDPreview`** slot below the target dropdown. Same component as Tab 1.

**Results: existing `PrototypeClient` rendering** — unchanged.

No regressions for current pilot faculty. The button label may shift slightly to *"Analyze prereqs"* for clarity, but the behavior and response shape are identical to today.

### Flagging on Tab 1

The Tab 1 result components support flag-with-note on each judgment, same pattern as Tab 2:

- Coverage cell flag → flag type `target_chain_coverage`.
- Scaffolding judgment flag → flag type `target_chain_scaffolding`.

Stored in the existing `prototype_flags` table via the existing `/api/flag` endpoint. The endpoint accepts `flagType` as free text — no schema change.

## Operations

### Cost & rate limiting

- **IP rate limit** — `checkIpRateLimit` unchanged. 10 analyses/hour/IP applies across both routes; Tab 1 and Tab 2 each consume one slot per run.
- **Daily cost cap** — `checkDailyCap` unchanged. Worst-case Tab 1 run at N=16 is ~$0.80; daily cap defaults to $5 so the cap will refuse runs before they spiral. Tab 1 is cheaper per-call than Tab 2 (no prereq/gap calls), so the daily cap absorbs more Tab 1 runs than Tab 2 runs.
- **`maxDuration`** — both routes set `export const maxDuration = 120` (same as today).

### Backward compatibility

- `/api/analyze` request and response schemas are unchanged. Any code that called it before this change still works.
- The new `analysisKind` column defaults to `'course_prereqs'`, so existing rows back-fill correctly without manual intervention.
- The existing `CoverageHeatMap` component default mode (`'focal-plus-priors'`) means Tab 2's render path is byte-identical to today.

### Testing

- **Unit tests per shared helper** under `tests/ai/analyze/` — mock provider, assert prompt construction, telemetry accumulation, schema validation.
- **Route regression test** for `/api/analyze` — confirms the refactor preserves response shape against the existing fixtures (or a new one if no fixtures exist today).
- **Route test** for `/api/analyze/target-chain` — happy path; 400 on <2 or >16 courses; 400 on unknown `careerTargetId`; 429 on rate limit; 503 on daily cap.
- **Component tests** for `TargetKUDPreview` (renders K/U/D, "Edit" link URL correct, auto-collapse on target change), `TargetChainForm` (checkbox state, counter, cap enforcement, Analyze-disabled threshold), `CoverageHeatMap` in `'chain'` mode (no focal row).

### Migration ordering

This depends on no other migration landing between now and implementation. Plan 1 and Plan 3 of the Industry Partner Input Tool already shipped through migration `0007`. The next free slot is `0008`. If another migration lands first, the auto-generated filename will adjust accordingly — the SQL itself doesn't care about ordering.

## Future integration with assignment intake

A separate spec (next brainstorm) will design a **faculty assignment-intake** feature: faculty upload course materials (rubrics, worksheets, tests, project overviews) → AI produces richer KUD/skills/competency outputs → those enriched outputs replace or supplement syllabus-derived KUDs.

The integration point with this spec is small but real:

- When enriched data exists for a course, the `draftKUD` helper will optionally pull from the enriched record instead of regenerating from the raw syllabus. The shared helper architecture makes that toggle trivial — one branch inside `kud-draft.ts`, no changes to either route.
- The Tab 1 checkbox list could optionally indicate which courses have intake materials (a small badge) — but that's an intake-spec concern, not this spec's.

This spec stays focused on the analysis-mode split. Intake plugs in later without restructuring.
