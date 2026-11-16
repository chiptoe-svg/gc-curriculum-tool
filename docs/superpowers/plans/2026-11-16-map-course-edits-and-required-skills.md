# Course Edits and Required-Skill Threads on the Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a curriculum map, faculty can add and edit objectives, required skills, developed skills and prerequisites/corequisites per course (drafts, this map only); each course shows a segmented bar of how many required skills earlier courses meet; faculty match decisions are stored as shared evidence and exportable as labeled pairs; a Markdown export lists every change.

**Architecture:** A cached AI judge (campus `qwen3.8-27b-fp8`, yes/no P from logprobs) rates required-skill × developed-skill pairs; the library ships each required skill's top embedding candidates with cached judgments and latest faculty decisions; a pure `threads.ts` decides each required skill's status from the plan's placements and edits; map edits live in `PlanState.courseEdits`; decisions live in a shared table.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle + Postgres 17, zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-map-course-edits-and-required-skills-design.md`

## Global Constraints

- Captures are never changed by a map edit or a decision.
- Threads never change competency levels, roll-ups, targets or objectives; status never reads competencies.
- Map edits count toward "met" only as **Met\*** (yellow), shown in italics with an asterisk, and are listed under "To confirm through capture".
- Bar colors: Met `green`, Met\* `yellow`, Partly met `orange`, Not met `red`; all green only at 100%.
- Levels are whole numbers; never round up.
- Judge: model `qwen3.8-27b-fp8`, `max_tokens: 1`, `temperature: 0`, `logprobs: true`, `top_logprobs: 20`, `chat_template_kwargs: { enable_thinking: false }`; P(yes) = Σyes / (Σyes + Σno) over top tokens, trimmed and lowercased; `PROMPT_VERSION = 'm1'`.
- Provisional cut-offs (spike 2026-11-16, before owner labels): `FULLY_CUTOFF = 0.6`, `PARTLY_CUTOFF = 0.9`, exported constants marked provisional.
- Candidates: developed skills of courses in an earlier term, or the same term when the pair is a corequisite on the map; top 5 by embedding similarity among those.
- Text hashes: `textHash(normalizeStatement(s))` (`lib/catalog/bundles`, `lib/catalog/project-trail`).
- Who: `personalName(grant)` or the plan's author name, else `'Department login'`; US spelling; no localhost in user copy.
- Live DB: migration 0069 is applied only by the owner-approved script, after a backup.

## Review Focus

1. A course placed in the **same term** as its supplier (no corequisite) must not be met by it — tested in Task 4.
2. A **rejected** decision must win over a high judge score, on every map — tested in Task 4.
3. A required skill whose supplier course is **removed from the map** must drop to Not met — tested in Task 4.
4. An edited required skill (new wording) must not reuse the old wording's judgments or decisions — tested in Task 3 (hash of the new text) and Task 4.
5. A saved plan from before this feature (no `courseEdits`) must load unchanged — tested in Task 3.

---

### Task 1: Tables for judgments and decisions (migration 0069)

**Files:**
- Create: `drizzle/0069_skill_match.sql`
- Modify: `lib/db/schema.ts` (append two tables)
- Create: `lib/db/match-queries.ts`
- Create: `scripts/migrations/2026-11-16-skill-match-live-apply.sh` (pattern: `2026-11-15-skill-links-live-apply.sh`: backup, apply, verify table count +2)
- Test: `lib/db/__tests__/match-queries.test.ts` (against `gc_curriculum_builder_scratch`, skipped when `DATABASE_URL` is not that DB)

**Interfaces:**
- Produces tables:
  - `skill_match_judgments(required_hash text, supplied_hash text, model text, prompt_version text, p_fully real, p_partly real, created_at timestamptz default now(), PK(required_hash, supplied_hash, model, prompt_version))`
  - `skill_match_decisions(id uuid PK default gen_random_uuid(), required_hash text not null, supplied_hash text not null, required_text text not null, supplied_text text not null, required_course text not null, required_course_title text, supplied_course text not null, supplied_course_title text, required_snapshot_id uuid null, supplied_snapshot_id uuid null, label text not null check in ('fully','partly','not'), draft boolean not null default false, plan_id uuid null, source text not null check in ('map','labeling_sheet'), reason text, decided_by text not null, decided_at timestamptz not null default now(), judge_model text, prompt_version text, judge_p_fully real, judge_p_partly real)`, index on `(required_hash, supplied_hash, decided_at desc)`. Rows are only ever inserted.
- Produces in `match-queries.ts`:
  - `readJudgments(pairs: Array<{ requiredHash: string; suppliedHash: string }>): Promise<Map<string, { pFully: number; pPartly: number }>>` keyed `${requiredHash}|${suppliedHash}` for `MODEL`/`PROMPT_VERSION`
  - `writeJudgments(rows: Array<{ requiredHash; suppliedHash; pFully; pPartly }>): Promise<void>` (upsert)
  - `insertDecision(d: NewDecision): Promise<void>`
  - `latestDecisions(opts?: { planId?: string }): Promise<Map<string, Decision>>` — latest per pair; draft decisions only for that plan
  - `exportDecisions(opts: { latestOnly: boolean }): Promise<Decision[]>`

- [ ] **Step 1:** Write the migration (BEGIN; `lock_timeout 5s`; abort if `skill_match_decisions` exists; create both; COMMIT) and the Drizzle definitions.
- [ ] **Step 2:** Apply to `gc_curriculum_builder_scratch` with `psql` and check `\d skill_match_decisions`.
- [ ] **Step 3:** Test `latestDecisions returns the newest decision per pair and keeps history`: insert `fully` then `not` for one pair; expect latest `not`; `exportDecisions({ latestOnly: false })` has 2 rows.
- [ ] **Step 4:** Test `a draft decision is visible only on its plan`.
- [ ] **Step 5:** Run `pnpm vitest run lib/db/__tests__/match-queries.test.ts` → PASS. Commit.

### Task 2: The judge

**Files:**
- Create: `lib/ai/match-judge.ts`
- Create: `scripts/catalog/judge-required-skills.ts` (`--expect-db <name> [--apply] [--limit N]`)
- Test: `lib/ai/__tests__/match-judge.test.ts`

**Interfaces:**
- Produces: `MODEL`, `PROMPT_VERSION`, `FULLY_CUTOFF`, `PARTLY_CUTOFF`; `pYes(topLogprobs: Array<{ token: string; logprob: number }>): number | null`; `judgePrompt(q: 'fully' | 'partly', p: PairText): string` where `PairText = { requiredText; requiredCourse; requiredTitle; suppliedText; suppliedCourse; suppliedTitle }`; `judgePairs(pairs: PairText[], opts?: { fetchImpl?: typeof fetch; concurrency?: number }): Promise<Array<{ pFully: number | null; pPartly: number | null }>>` (reads `CAMPUS_LLM_BASE_URL`/`CAMPUS_LLM_API_KEY`, 4 retries with backoff).
- Prompt text (exact):
  - context: `Earlier course: {suppliedCourse} {suppliedTitle}. It develops: "{suppliedText}"\nLater course: {requiredCourse} {requiredTitle}. Students must arrive able to: "{requiredText}"\n\n`
  - fully: `Does the earlier course develop the activity that the later course requires on arrival? Judge the activity only, not the level or the wording of conditions. Answer Yes or No.`
  - partly: `Does the earlier course develop at least part of the activity that the later course requires on arrival (a component of it, or a closely related narrower activity)? Answer Yes or No.`
- The batch script: for every live capture's incoming expectations, embed (existing `embedMissing` cache) and take the top 8 developed skills from **other** courses by cosine; judge the pairs not yet cached; `--apply` writes judgments. Prints counts; free.

- [ ] **Step 1:** Tests: `pYes` on `[["No",-0.672],["Yes",-0.797]]` → ≈0.469; on no yes/no tokens → `null`; `judgePairs` with a stub `fetchImpl` returns both Ps and sends the exact body fields from Global Constraints.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Run the batch script on scratch: `pnpm tsx scripts/catalog/judge-required-skills.ts --expect-db gc_curriculum_builder_scratch --apply`; expect ~64 required skills × 8 pairs judged. Commit.

### Task 3: Plan edits and the library

**Files:**
- Modify: `lib/builder/types.ts`, `lib/builder/plan-schema.ts`, `lib/builder/library.ts`, `lib/builder/compute.ts` (edge kind only)
- Create: `lib/builder/edits.ts`, `lib/builder/bloom.ts`
- Test: `lib/builder/__tests__/edits.test.ts`

**Interfaces:**
- Produces types (types.ts):
  - `RequiredSkill { ref: string; statement: string; need: Depth }` (ref = text hash); `LibraryVersion.required: RequiredSkill[]`
  - `Candidate { requiredRef: string; suppliedRef: string; suppliedCourse: string; suppliedStatement: string; similarity: number; pFully: number | null; pPartly: number | null }`; `Library.candidates: Record<string /*requiredRef*/, Candidate[]>` (top 8)
  - `MatchDecision { requiredRef; suppliedRef; label: 'fully' | 'partly' | 'not'; by: string; at: string; draft: boolean }`; `Library.decisions: Record<string /* `${requiredRef}|${suppliedRef}` */, MatchDecision>`
  - `EditBase { id: string; by: string; at: string }`; `CourseEdits { objectives: ObjectiveEdit[]; required: SkillEdit[]; developed: SkillEdit[] }` where `ObjectiveEdit = EditBase & { action: 'add' | 'edit' | 'remove'; target: string | null /* original text */; text: string | null; bloom: BloomProcess | null }`, `SkillEdit = EditBase & { action: 'add' | 'edit' | 'remove'; target: string | null /* original ref */; statement: string | null; levels: Depth | null }`; `PlanState.courseEdits?: Record<string /*course ref*/, CourseEdits>`
  - `Link.kind?: 'prereq' | 'coreq'` (absent = prereq); plan-added coreq becomes `PlanEdge.kind = 'concurrent_ok'`, `source: 'plan'`
- Produces (bloom.ts): `BLOOM = ['Remember','Understand','Apply','Analyze','Evaluate','Create'] as const`, `type BloomProcess`, `proposeBloom(text: string): BloomProcess | null` (leading-verb table; a proposal only).
- Produces (edits.ts): `effectiveCourse(lc: LibraryCourse | ProposedCourse, version: LibraryVersion | null, edits: CourseEdits | undefined): { objectives: Array<{ text: string; bloom: BloomProcess | null; draft: boolean }>; required: Array<RequiredSkill & { draft: boolean }>; developed: Array<Skill & { draft: boolean }> }` — an edited item gets the hash of its new text as its ref and `draft: true`; a removed one disappears; `changeCount(edits, links, unlinked, ref): number`.
- Library loads `incoming_expectations` into `required`, candidates from `skill_match_judgments` + embeddings cache, decisions via `latestDecisions()`; all inside the existing try/catch so a DB without 0069 still loads (empty candidates/decisions).

- [ ] **Step 1:** Tests: `a plan without courseEdits parses and loads unchanged`; `an edited required skill gets a new ref and draft: true`; `remove drops a captured developed skill`; `a coreq link becomes a concurrent_ok plan edge`; `proposeBloom('Design a package')` → `'Create'`, `proposeBloom('Students will be great')` → `null`.
- [ ] **Step 2:** FAIL → implement → PASS (`pnpm vitest run lib/builder`). `pnpm tsc --noEmit -p .` clean. Commit.

### Task 4: Required-skill status (pure)

**Files:**
- Create: `lib/builder/threads.ts`
- Test: `lib/builder/__tests__/threads.test.ts`

**Interfaces:**
- Consumes: Task 3 types; `computePlan`'s `PlacedCourse` (`term`, `act`, `ref`) and plan edges.
- Produces: `type ReqStatus = 'met' | 'met_draft' | 'partly' | 'not'`; `interface ReqResult { required: RequiredSkill & { draft: boolean }; status: ReqStatus; supplier: { course: string; statement: string; draft: boolean; source: 'decision' | 'judge'; label: 'fully' | 'partly' } | null; short: Array<'k' | 'u' | 'd'>; mayFade: boolean; candidates: Candidate[] }`; `requiredByCourse(lib: Library, plan: PlanState, courses: PlacedCourse[], drafts: DraftJudgments): Record<string, { results: ReqResult[]; counts: Record<ReqStatus, number> }>` where `DraftJudgments = Record<string, { pFully: number | null; pPartly: number | null }>` (judgments fetched for draft texts, keyed like decisions).
- Rule (first match): Met — a non-draft supplier with label fully (decision, else judge `pFully ≥ FULLY_CUTOFF`) whose captured levels ≥ every named need; Met\* — same but the required skill, the supplier, or the coreq that makes it eligible is a draft; Partly — any non-rejected candidate with fully but short levels, or partly (decision, or `pPartly ≥ PARTLY_CUTOFF`); Not — otherwise. Decisions override the judge; `not` excludes the pair. `mayFade` when supplier act ≤ requirer act − 2.

- [ ] **Step 1:** Tests (one each): `met from an earlier term`; `same term without coreq is not eligible`; `same term with a plan coreq is Met*`; `rejected decision beats pFully 0.99`; `accepted decision beats pFully 0.1`; `short on D gives partly with short ['d']`; `a draft developed skill gives Met*`; `supplier removed from the map gives not`; `counts sum to the number of required skills`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit.

### Task 5: Decisions and draft judging API

**Files:**
- Create: `app/api/build/match/route.ts` (POST)
- Create: `app/api/build/match-decisions/route.ts` (GET, `?format=jsonl|csv&latest=1`)
- Modify: `lib/auth/authorize.ts` (`PLAN_WRITE` adds `match`), `tests/auth/authorize.test.ts`
- Test: `app/api/build/match/__tests__/route.test.ts`

**Interfaces:**
- `POST /api/build/match` body `{ action: 'decide', planId, required: PairSide, supplied: PairSide, label, reason? }` → inserts a decision (texts for captured sides are read from the capture by snapshot + ref, never trusted from the body; draft sides take the body text and set `draft: true`); `{ action: 'judge', pairs: PairText[] }` (max 40) → `{ results: Array<{ pFully; pPartly }> }`, cached through `writeJudgments`. `PairSide = { course: string; snapshotId: string | null; ref: string; text: string }`.
- `GET /api/build/match-decisions` → JSON Lines (default) or CSV with the spec's fields; `latest=1` filters to the decision that counts.
- Script `scripts/catalog/export-match-decisions.ts --out <file> [--csv] [--latest]`, and `scripts/catalog/load-labeling-sheet.ts --labels "<1F 2P …>" --pairs <match-spike.json> --expect-db <name> [--apply]` (source `labeling_sheet`, by the owner's name passed with `--by`).

- [ ] **Step 1:** Tests: `decide reads the captured text, not the body`; `judge refuses more than 40 pairs`; authorize: `POST /api/build/match` is plan-write; `/api/build/match/x` is admin.
- [ ] **Step 2:** FAIL → implement → PASS. Commit.

### Task 6: Map UI

**Files:**
- Modify: `app/build/[id]/Map.tsx` (card bar + change mark), `app/build/[id]/CourseDrawer.tsx` (editors, required list, changes), `app/build/[id]/Builder.tsx` (state wiring, draft judging), builder CSS
- Create: `app/build/[id]/RequiredSkillsList.tsx`, `app/build/[id]/CourseEditors.tsx`

**Interfaces:**
- Consumes: `requiredByCourse` (Task 4), `effectiveCourse`/`changeCount` (Task 3), `POST /api/build/match` (Task 5).
- Card: a 6px bar under the code, segments in Met/Met\*/Partly/Not order with widths ∝ counts, `title` "6 of 9 required skills met"; a `✎ n` mark when `changeCount > 0`. Clicking the bar opens the course drawer at the Required skills section.
- Required list: each item shows status chip, needs, supplier (course + skill, italic + `*` if draft), "confirmed by X, date" for decisions; controls Accept (fully) / Partly / Reject / Pick another (from `candidates` among eligible courses).
- Editors: Objectives (text + Bloom select prefilled by `proposeBloom`), Required skills (statement + K/U/D), Developed skills (statement + K/U/D goal), Prerequisites/corequisites (pick course, kind; set aside a catalog one). Each edit stamped `{ id, by, at }`. Sections "Changes on this map" and "To confirm through capture".
- Draft judging: when a draft skill is saved, Builder posts `judge` for the needed pairs (≤ 40) and keeps results in `DraftJudgments`.

- [ ] **Step 1:** Run the dev server on scratch (`scratchpad/devserver.sh`, port 3037 registered then removed) and drive with Playwright: add a draft required skill, accept a supplier, see the bar change; reject one, see it turn red; reload and see edits persisted.
- [ ] **Step 2:** `pnpm vitest run` and `pnpm tsc --noEmit -p .` clean. Commit.

### Task 7: Markdown export

**Files:**
- Create: `lib/builder/changes-md.ts`, `app/api/build/plans/[id]/changes.md/route.ts` (GET; download `<plan-name>-changes-<YYYY-MM-DD>.md`), export button in `Builder.tsx` top bar
- Test: `lib/builder/__tests__/changes-md.test.ts`

**Interfaces:**
- `renderChangesMarkdown(input: { planName: string; catalogYear: string | null; exportedBy: string; date: string; lib: Library; plan: PlanState; required: ReturnType<typeof requiredByCourse>; decisions: MatchDecision[] }): string`
- Layout: `# <plan> — changes (<date>)`; summary list (courses changed; counts per kind; required skills met / met\* / partly / not); `## <code> <title>` per changed course with `### Objectives`, `### Required skills`, `### Developed skills`, `### Prerequisites and corequisites`, `### Match decisions` — each change as `- Added | Changed | Removed: <before> → <after> (<by>, <date>)`; `## To confirm through capture` listing every draft.

- [ ] **Step 1:** Tests: `an unchanged plan says "No changes"`; `an edited objective shows before → after with its Bloom process`; `a coreq added appears under Prerequisites and corequisites`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit.

### Task 8: Docs and live

**Files:** `docs/STATE.md` (routes, migration 0069, judge, cut-offs provisional; Deferred: cut-offs wait on owner labels), `docs/ROADMAP.md`.

- [ ] **Step 1:** Full `pnpm vitest run`, `pnpm tsc --noEmit -p .`, `pnpm lint`.
- [ ] **Step 2:** Merge to `dev`. **Owner go-ahead required:** run the live-apply script (backup first), then the judge batch on `gc_curriculum`, then `deploy.sh <sha>` and `verify-live.sh`.
- [ ] **Step 3:** When the owner's labels arrive: load them (`load-labeling-sheet.ts`), refit `FULLY_CUTOFF`/`PARTLY_CUTOFF` (Youden's J on the labels), update constants and STATE.
