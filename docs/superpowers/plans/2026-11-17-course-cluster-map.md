# Course Cluster Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A skills-only map for a cluster of related courses: free canvas, prerequisite arrows, required-skill threads
from everything upstream, course and cluster objectives judged on developed skills, proposed bases labeled, and edited
courses saved as skills-only what-ifs.

**Architecture:** New pure modules under `lib/builder/cluster/` (state schema, upstream graph, statuses), a set judge
ported from the 2026-11-16 composite experiment into `lib/ai/set-judge.ts`, one additive-plus migration (0070), new
API routes under `/api/build/clusters`, and a new page `/build/clusters/[id]`. The shared `/build` pieces (add-course
panel, syllabus import, editors, required-skills list, judging hook) are imported, not copied; their prop types widen
from `PlanState` to a `MapCore` subset so both pages fit. `/build`'s behavior does not change.

**Tech Stack:** Next.js 15 App Router, React, TypeScript strict, Drizzle on Postgres 17, zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-course-cluster-map-design.md` (owner-approved 2026-11-17). Read it before
any task.

## Global Constraints

- Free campus models only: judge `MODEL_IN_USE` / `CUTOFFS` from `lib/ai/match-judge.ts`, embeddings via `embedBatch`
  (qwen3-embedding-4b). No call to the paid provider anywhere in this plan.
- No competencies, KUD levels, acts, terms, branches, fade or targets in any cluster status. A cluster status ignores a
  required skill's `need` levels.
- `/build` behavior is unchanged. Any edit to a shared `/build` file is a type widening or an extraction with the same
  behavior; `pnpm vitest run lib/builder app/build app/api/build` must stay green after every task.
- Proposed wording, exact: `Met: proposed (<course code> drafted from syllabus)`, `Met: proposed (edited skill in
  <course code>)`, `Met: proposed (new course <course code>)`; same pattern for every status word
  (`Partly met: proposed (...)`, `Met by a set: proposed (...)`, ...). When several sources apply, list them joined by
  `; ` (Claude's call for the spec's open point).
- Status words (exact): `Met`, `Met by a set`, `Parts met, combining not shown`, `Partly met`, `Not met`,
  `Matching…`. A set status names members: `Met by GC 2070 + GC 4400 (used together)`.
- Empty pools read `Not met` with reason text exactly `no upstream courses` (required skill) or `this course has no
  developed skills yet` (course objective) or `no course on this cluster has developed skills yet` (cluster objective).
- Set-test cut-offs are provisional: `SET_CUTOFFS = { any: 0.3, together: 0.6, combining: 0.5 }` in
  `lib/ai/set-judge.ts`, with a comment saying they are refit on the owner's 22 set labels.
- Live DB: migration 0070 is applied to `gc_curriculum` only after the owner's explicit go-ahead and a backup
  (`scripts/migrations/` pattern). Build and test against the scratch DB.
- Deploy chain: `scratchpad/deploy.sh <FULL sha>` then `scratchpad/verify-live.sh`; push `git push origin dev` and
  `git push origin dev:main` only when the owner says go.
- US spelling; plain-language faculty copy; no instructor names in fixtures.
- Update `docs/STATE.md` in the commit that adds routes, schema or the migration.

## Review Focus

1. **An arrow that would close a loop** (A→B, B→C, then C→A drawn): refused with `That arrow would make a loop
   (GC xxxx is already upstream of GC yyyy).`; state unchanged. Test in Task 1.
2. **The campus model is down while a cluster opens**: statuses read `Matching…` then an error with "Try again", never
   `Not met`. Test in Task 3 (`pending` when a needed judgment is absent) and Task 7 (hook error path).
3. **A course is removed from the cluster while it is a member of a set or the target of an override**: the set
   status recomputes without it; an override on a removed course's objective is dropped from view, not applied to
   another course. Test in Task 3.
4. **A skills-only what-if opened from `/explore/<code>`**: the list shows it marked "Skills only (from a cluster)" and
   its page does not crash on null `estimate` / `profile`. Test in Task 6.
5. **Objective text edited after an override**: the override shows `Override out of date (the objective changed)` and
   is not applied. Test in Task 3.

---

### Task 1: Cluster state, upstream graph, shared map core

**Files:**
- Create: `lib/builder/cluster/state.ts`, `lib/builder/cluster/graph.ts`
- Modify: `lib/builder/types.ts` (add `MapCore`)
- Test: `lib/builder/cluster/__tests__/state.test.ts`, `lib/builder/cluster/__tests__/graph.test.ts`

**Interfaces:**
- Produces:
  - `type MapCore = Pick<PlanState, 'proposed' | 'courseEdits' | 'versions' | 'links' | 'unlinked'>` (types.ts).
  - `interface ClusterCard { ref: string; x: number; y: number }`
  - `interface ClusterObjective { id: string; text: string }`
  - `interface ClusterOverride { targetKey: string; textHash: string; label: 'met' | 'partly' | 'not'; by: string; at: string; reason: string | null }`
    where `targetKey` is `req:<courseRef>|<requiredRef>`, `obj:<courseRef>|<hash(normalized text)>`, or `cobj:<objective id>`.
  - `interface ClusterState extends MapCore { cards: ClusterCard[]; objectives: ClusterObjective[]; overrides: ClusterOverride[] }`
  - `clusterStateSchema` (zod) and `parseClusterState(input: unknown): ClusterState | null`; limits: cards ≤ 40,
    objectives ≤ 20 (text ≤ 500), overrides ≤ 300; reuse the `planStateSchema` pieces for the MapCore fields by
    exporting them from `plan-schema.ts` (no change to their limits).
  - `emptyClusterState(): ClusterState`
  - `clusterEdges(lib: Library, state: ClusterState): Array<{ from: string; to: string; source: 'catalog' | 'cluster' }>` —
    catalog prerequisites (both ends on `cards`, matched as `planEdges` does by ref or code) minus `unlinked`, plus
    `links`. Coreqs count as arrows.
  - `upstreamOf(edges, ref): Set<string>` — every ref reachable backward, excluding `ref`; terminates on cycles.
  - `wouldCycle(edges, from, to): string | null` — the message above, or null.

- [ ] **Step 1: Write failing tests** — `graph.test.ts`: `upstream follows the whole chain` (A→B→C: upstream(C) = {A,B});
  `upstream ignores position` (cards in any x/y order); `removed catalog arrow cuts the chain`; `drawn arrow adds a
  supplier`; `refuses an arrow that closes a loop` (exact message); `tolerates a saved cycle` (upstream(A) on A→B→A is
  {B}). `state.test.ts`: `round-trips an empty state`; `rejects 41 cards`; `rejects an objective over 500 chars`.
- [ ] **Step 2: Run** `pnpm vitest run lib/builder/cluster` — expect FAIL (modules missing).
- [ ] **Step 3: Implement** the interfaces above. `clusterEdges` reuses the catalog-edge reading inside `planEdges`
  (extract a helper from `compute.ts` if needed, same output for `/build`).
- [ ] **Step 4: Run** `pnpm vitest run lib/builder` — PASS, including existing builder tests.
- [ ] **Step 5: Commit** `feat(cluster): cluster state schema and upstream graph`.

### Task 2: Migration 0070 and cluster storage

**Files:**
- Create: `drizzle/0070_course_clusters.sql`, `lib/db/cluster-queries.ts`, `scripts/migrations/2026-11-17-clusters-live-apply.sh`
- Modify: `lib/db/schema.ts`, `lib/db/what-if-queries.ts` (type only), `lib/db/match-queries.ts` (source type)
- Test: `lib/db/__tests__/cluster-queries.test.ts` (scratch DB, same pattern as existing DB tests)

**Interfaces:**
- Migration (guarded like 0069: `RAISE EXCEPTION '0070: already applied'`, `lock_timeout 5s`, one transaction):
  - `curriculum_clusters` — same columns, defaults and checks as `curriculum_plans`, `state jsonb` holds `ClusterState`.
  - `course_what_ifs.skills jsonb NULL` — `{ objectives: string[]; developed: Array<{ statement: string; k: number|null; u: number|null; d: number|null }>; required: Array<{ statement: string; need: { k; u; d } }>; fromCluster: string | null }`.
  - `skill_match_decisions`: drop and re-add `skill_match_decisions_source_check` as `source IN ('map', 'labeling_sheet', 'cluster')`.
  - `plan_syllabus_drafts`: `plan_id` becomes nullable; add `cluster_id uuid REFERENCES curriculum_clusters(id) ON DELETE CASCADE`; check `(plan_id IS NULL) <> (cluster_id IS NULL)`.
  - `skill_set_judgments` — PK `(target_hash, pool_hash, model, prompt_version)`; columns `p_any real, picked text[] NOT NULL, kept text[] NOT NULL, p_together real, p_combining real, created_at timestamptz default now()`. `pool_hash` = textHash of the sorted candidate hashes joined by `,`; `picked` / `kept` hold candidate hashes.
- `cluster-queries.ts`: `createCluster`, `getCluster`, `listClusters`, `saveCluster(id, version, {name, state, updatedBy})`,
  `deleteCluster` — same signatures and optimistic-version semantics as `curriculum-plan-queries.ts`.
- Live-apply script: copy of `2026-11-16-skill-match-live-apply.sh` adjusted for 0070 (backup first, `--apply` flag,
  verify the four changes).

- [ ] **Step 1: Write failing tests**: `creates, lists and saves a cluster`; `save with a stale version returns null`;
  `a syllabus draft row needs exactly one of plan or cluster` (insert with both → error).
- [ ] **Step 2: Run** against the scratch DB — FAIL.
- [ ] **Step 3: Write the migration, schema and queries**; apply to `gc_curriculum_builder_scratch` only.
- [ ] **Step 4: Run** tests — PASS; run the migration twice on scratch and confirm the second run raises `already applied`.
- [ ] **Step 5: Commit** with `docs/STATE.md` (new table, migration pending live) — `feat(cluster): migration 0070 and cluster storage`.

### Task 3: Cluster statuses (pure)

**Files:**
- Create: `lib/builder/cluster/status.ts`
- Test: `lib/builder/cluster/__tests__/status.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ClusterState`, `clusterEdges`, `upstreamOf`), `effectiveCourse` (edits.ts), `CUTOFFS`/`MODEL_IN_USE`,
  `SET_CUTOFFS` (Task 4 constant; import from `lib/ai/set-judge.ts`, create that file with the constant here if Task 4
  has not landed).
- Produces:
  - `type ClusterStatus = 'met' | 'met_set' | 'parts_met' | 'partly' | 'not' | 'pending'`
  - `interface SetVerdict { pAny: number | null; kept: string[]; pTogether: number | null; pCombining: number | null }` (kept = supplied refs)
  - `type SetVerdicts = Record<string, SetVerdict>` keyed by `targetKey` (Task 1 format)
  - `interface StatusResult { targetKey: string; text: string; status: ClusterStatus; suppliers: Array<{ course: string; statement: string; ref: string }>; proposed: string[]; reason: string | null; override: ClusterOverride | null; staleOverride: boolean; candidates: Candidate[] }`
    — `proposed` holds the source phrases (`GC 4xxx drafted from syllabus`, `edited skill in GC 2070`, `new course GC 4xxx`).
  - `clusterStatuses(lib: Library, state: ClusterState, judgments: DraftJudgments, sets: SetVerdicts, decisions: Record<string, MatchDecision>): { required: Record<string, StatusResult[]>; objectives: Record<string, StatusResult[]>; cluster: StatusResult[] }`
  - `statusLabel(r: StatusResult, codeOf: (ref: string) => string): string` — the exact wording in Global Constraints.
- Rule, per target (required skill: pool = developed skills of `upstreamOf`; course objective: pool = the course's own
  developed skills; cluster objective: pool = all developed skills on `cards`):
  1. Empty pool → `not` with the reason text.
  2. A pair decision (required skills only) or a pair with `pFully >= cut.fully` → `met`, supplier = best one.
  3. Else a set verdict with `kept.length >= 2`, `pAny >= any`, `pTogether >= together`: `pCombining >= combining` →
     `met_set`, else `parts_met`; suppliers = kept members.
  4. Else best pair with `pPartly >= cut.partly` → `partly`; else `not`.
  5. Any pool pair lacking a judgment, or a set verdict needed but absent → `pending` (never `not`).
  6. `proposed` collects: supplier skill `draft` (edit origin `syllabus` on a proposed course → `drafted from syllabus`,
     a proposed course with source `new` and no syllabus → `new course`, otherwise `edited skill in`), and the target
     itself if it is a draft.
  7. Override with matching `targetKey` and `textHash` replaces the status (`met`/`partly`/`not`); mismatched hash →
     `staleOverride: true`, not applied; overrides whose course is no longer on `cards` are ignored.
- Judgment keys: required skills reuse `${requiredRef}|${suppliedRef}`; objectives use `${hash(objective text)}|${suppliedRef}`.

- [ ] **Step 1: Write failing tests** (fixtures: tiny Library with three courses): `met from two steps upstream`;
  `not met: no upstream courses`; `objective met by its own course's skill`; `cluster objective met by a set used
  together` (`met_set`, label `Met by GC 2070 + GC 4400 (used together)`); `parts met, combining not shown`;
  `single full supplier wins over a set`; `pending when a pair is unjudged`; `proposed label names a syllabus-drafted
  supplier`; `proposed label lists two sources joined by "; "`; `stale override is shown and not applied`;
  `override on a removed course is ignored`; `need levels do not change a status`.
- [ ] **Step 2: Run** `pnpm vitest run lib/builder/cluster/__tests__/status.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(cluster): skills-only statuses for threads and objectives`.

### Task 4: Set judge and judging API

**Files:**
- Create: `lib/ai/set-judge.ts`, `lib/db/set-judgment-queries.ts`
- Modify: `app/api/build/match/route.ts`
- Test: `lib/ai/__tests__/set-judge.test.ts`, `app/api/build/match/__tests__/` (extend)

**Interfaces:**
- `SET_CUTOFFS`, `SET_PROMPT_VERSION = 's1'`.
- `judgeSet(target: { text: string; course: string; context: string }, pool: Array<{ ref: string; course: string; text: string; context: string }>, opts?: { fetchImpl?: typeof fetch }): Promise<SetVerdict & { picked: string[] }>`
  — the v3 procedure from the scratchpad experiment (`composite.ts`): the group "any" question (one token, logprobs);
  the smallest-set generation (`max_tokens 24`, numbers only); keep picks whose pair `pPartly >= CUTOFFS[MODEL_IN_USE].partly`;
  then together and combining questions about the kept set only. Prompts copied verbatim from `composite.ts` lines 77–91
  (paste them into the file; the scratchpad copy is not durable). `context` = course code + title + first 350 chars of
  the catalog (or proposed) description.
- `readSetJudgment` / `writeSetJudgment` keyed as in Task 2.
- Match route: new action `judge-set` `{ clusterId, target: { key, text, course, title }, pool: [{ ref, text, course, title }] }`
  → `{ verdict: SetVerdict }`, pool ≤ 8 (take the top 8 by embedding when more are sent), cached. `decide` and `judge`
  accept `clusterId` in place of `planId`: proposed titles and the proposed-course check read the cluster's state;
  decisions from a cluster store `plan_id = clusterId`, `source = 'cluster'`.

- [ ] **Step 1: Write failing tests** with a stub `fetchImpl`: `asks the together question only about kept members`;
  `returns no set when the generated answer is 0`; `drops a pick the pair judge scores below partly`; route:
  `judge-set returns the cached verdict without calling the model`; `decide with clusterId stores source cluster`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run lib/ai app/api/build` — PASS.
- [ ] **Step 5: Probe**: one real `judge-set` call on scratch for the printing/packaging requirement from the
  experiment; expect `pTogether ≈ 0.73`, `pCombining ≈ 0.25` (±0.1). Record the numbers in the commit message.
- [ ] **Step 6: Commit** `feat(cluster): set judge (provisional cut-offs) and cluster judging API`.

### Task 5: Cluster API routes

**Files:**
- Create: `app/api/build/clusters/route.ts`, `app/api/build/clusters/[id]/route.ts`,
  `app/api/build/clusters/[id]/syllabus/route.ts`, `app/api/build/clusters/[id]/changes.md/route.ts`,
  `app/api/build/clusters/[id]/versions/route.ts`, `lib/builder/syllabus-import-handler.ts`
- Modify: `app/api/build/plans/[id]/syllabus/route.ts` (delegate to the handler), `lib/builder/changes-md.ts`
- Test: `app/api/build/clusters/__tests__/*.test.ts`, existing syllabus and changes-md tests stay green

**Interfaces:**
- Plans and clusters routes mirror each other (auth via `authorizeRequest`, owner grant/kind, version conflicts → 409).
- `syllabus-import-handler.ts`: `handleSyllabusImport(req, { load: (id) => Promise<{ state: MapCore } | null>, saveDraft: (row) => Promise<void> })`
  — the body of today's plan route, unchanged in behavior; the plan route passes plan loaders, the cluster route
  cluster loaders (draft row with `cluster_id`).
- `renderChangesMarkdown(input)` gains optional `placed?: PlacedCourse[]`; when given it replaces `placeCourses(lib, plan)`.
  The cluster route builds `placed` from `cards` (term 0) and passes `state` as the plan (MapCore fields only are read
  on that path; widen the input type accordingly). Thread lines come from Task 3 statuses rendered with `statusLabel`.
- `versions` POST `{ courseRef }` → creates a `course_what_ifs` row: `course_code` = the course, `base_snapshot_id` =
  the version the cluster uses, `skills` from `effectiveCourse` (objectives text, developed, required), `fromCluster`
  = cluster id, `title` = `<code> as edited on <cluster name>`, `estimate`/`profile` null, `page_created_at` null;
  author and grant from the request. Refuses a proposed (non-catalog) course with 400 `Only a tracked course can be saved as a version.`

- [ ] **Step 1: Write failing tests**: `creates and lists clusters`; `PUT with a stale version is 409`; `syllabus
  import on a cluster stores a cluster draft`; `plan syllabus import unchanged` (existing tests); `changes.md for a
  cluster lists edits and statuses`; `save as version writes skills and no estimate`; `save as version refuses a new course`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run app/api/build lib/builder` — PASS.
- [ ] **Step 5: Commit** with `docs/STATE.md` routes — `feat(cluster): cluster routes, shared syllabus import, save as version`.

### Task 6: Skills-only what-ifs in the library and on /explore

**Files:**
- Modify: `lib/builder/library.ts`, `lib/builder/types.ts`, `lib/builder/compute.ts` (`clusterVersionOf` beside `versionOf`), `/explore` what-if list and page readers (find with `grep -rn "listWhatIfsForCourse\|getWhatIf" app`)
- Test: `lib/builder/__tests__/library-skills-whatif.test.ts`, the explore what-if tests

**Interfaces:**
- `LibraryWhatIf` gains `skills: WhatIfSkills | null`. `loadLibrary` also loads rows with `skills IS NOT NULL` (no
  page needed); rows without `profile` get `depths: []`.
- `/build` keeps today's behavior: its version picker lists only what-ifs with a page (filter where it reads
  `whatIfs`), so skills-only rows never show there.
- `clusterVersionOf(course: LibraryCourse, state: MapCore): LibraryVersion | null` — for a chosen skills-only what-if,
  the base version with `skills` / `required` replaced by the what-if's (refs = hash of normalized statement) and
  `objectives` carried on the course reading; otherwise `versionOf`.
- `/explore`: the what-if list labels skills-only rows `Skills only (from a cluster)`; opening one shows its skills and
  objectives and no estimate sections.

- [ ] **Step 1: Write failing tests**: `loads a skills-only what-if`; `build picker omits skills-only what-ifs`;
  `clusterVersionOf swaps in the what-if skills`; `explore list labels a skills-only what-if`; `explore page renders
  with null estimate and profile`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm vitest run` — PASS.
- [ ] **Step 5: Commit** `feat(cluster): skills-only what-ifs in the library and explore`.

### Task 7: Share the /build pieces

**Files:**
- Create: `app/build/shared/useThreadJudging.ts`
- Modify: `app/build/[id]/Builder.tsx`, `LibraryPanel.tsx`, `SyllabusImport.tsx`, `CourseEditors.tsx`, `RequiredSkillsList.tsx`
- Test: `app/build/shared/__tests__/useThreadJudging.test.ts`

**Interfaces:**
- Shared component props typed on `MapCore` and a generic `Update<S extends MapCore> = (fn: (s: S) => S) => void`
  instead of `PlanState` / `Update`. `SyllabusImport` takes `endpoint: string` (the import URL) instead of building it
  from `planId`.
- `type JudgeJob = { key: string; sig: string; courseRef: string; side: 'required' | 'supplied'; ref: string; text: string }` (exported).
- `useThreadJudging(args: { jobs: JudgeJob[]; othersFor: (job: JudgeJob) => Array<{ ref: string; text: string; course: string; title: string }>; owner: { planId: string } | { clusterId: string } }): { drafts: DraftJudgments; judging: Record<string, string>; unasked: Set<string>; retryJudge: (key: string) => void }`
  — the queue/pump/retry code moved verbatim out of `Builder.tsx` (lines ~228–375). `Builder.tsx` keeps building its
  `judgeJobs` and passes an `othersFor` that uses today's term-based `supplies`, so `/build` behaves exactly as before.
  Clusters pass their own jobs (required skills, course objectives, cluster objectives) and upstream-based `othersFor`.
- `useSetJudging(args: { requests: Array<{ key: string; target: {...}; pool: [...] }>; clusterId: string }): { sets: SetVerdicts; judging: Record<string, string>; retry: (key: string) => void }`
  in the same folder: one `judge-set` call per request, sequential, errors as in `useThreadJudging`.

- [ ] **Step 1: Write a failing test**: `judges a draft developed skill against later courses only` (stub fetch;
  asserts the request body's `others`); `an error sets the retry message, not a status`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Move the code.** **Step 4: Run** `pnpm vitest run` and `pnpm tsc --noEmit` — PASS.
- [ ] **Step 5: Manual check on scratch** (`/build/<plan>`): open a plan with a draft skill; it judges and shows the
  same statuses as before the move (compare with a screenshot taken before Step 3).
- [ ] **Step 6: Commit** `refactor(build): share the add-course, import, editors and judging hook with clusters`.

### Task 8: Cluster page and canvas

**Files:**
- Create: `app/build/clusters/[id]/page.tsx`, `ClusterBuilder.tsx`, `ClusterCanvas.tsx`, `app/build/clusters/cluster.css`, `app/build/NewCluster.tsx`
- Modify: `app/build/page.tsx` (a "Clusters" section listing clusters with New / Delete)
- Test: `app/build/clusters/__tests__/ClusterCanvas.test.tsx`

**Interfaces:**
- Page loads cluster + `loadLibrary()` + decisions (as `app/build/[id]/page.tsx` does), renders `ClusterBuilder`.
- `ClusterBuilder` holds `ClusterState`, autosaves via `PUT /api/build/clusters/[id]` (same debounce/version handling as
  `Builder.tsx`), mounts `LibraryPanel` (add captured / what-if / catalog / new / syllabus), and computes
  `clusterStatuses`, calling `useThreadJudging` with `supplies = (sup, req) => upstreamOf(edges, req.ref).has(sup.ref)`
  plus objective and set jobs (`judge` with anchor side `required` for objectives; `judge-set` when Task 3 returns
  `pending` for a missing set verdict and no full single supplier).
- `ClusterCanvas`: cards (`CARD_W`/`CARD_H` from `layout.ts`) dragged freely (`x`,`y` stored); arrows drawn by dragging
  from a card's edge handle to another card; clicking an arrow offers "Remove arrow" (catalog arrows go to `unlinked`);
  a refused arrow shows the `wouldCycle` message. Each card shows `n met · n partly · n not` for its required skills
  and a "proposed" tag when the course is proposed or edited. New cards land right of the rightmost card.
- Cluster objectives strip at the top: list with status labels; add / edit / remove objective.

- [ ] **Step 1: Write failing tests**: `drawing an arrow adds a link`; `removing a catalog arrow adds it to unlinked`;
  `a loop arrow shows the refusal and does not change state`; `card shows counts from statuses`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(cluster): cluster page, canvas and cluster objectives`.

### Task 9: Cluster course panel

**Files:**
- Create: `app/build/clusters/[id]/ClusterCourseDrawer.tsx`
- Test: `app/build/clusters/__tests__/ClusterCourseDrawer.test.tsx`

**Interfaces:**
- Sections, in order: header (code, title, credits, version picker: captured / what-ifs incl. skills-only, links to wiki
  and capture); description; **Objectives** (each with its status label from Task 3 and an override control:
  Met / Partly / Not + optional reason → `ClusterState.overrides`); **Required skills** (`RequiredSkillsList`, statuses
  via Task 3 labels; pair overrides go through `decide` with `clusterId`); **Developed skills**
  (`DevelopedSkillsEditor`); **Prerequisites on this cluster** (upstream list, clickable); **How it is graded**
  (`ObjectiveGuidePanel embedded`, from `getObjectiveGuide(code)` passed down by the page; hidden when none);
  **Changes** (`ChangesList`); actions: "Save as a new version" (Task 5 `versions`, disabled for proposed courses with
  the reason as a tooltip), "Download changes" (`changes.md`), "Remove from cluster".
- No competency section, no levels in statuses.

- [ ] **Step 1: Write failing tests**: `shows objective statuses with proposed wording`; `override sets a cluster
  override`; `save as new version posts the course ref`; `no competency section renders`; `guide hidden when absent`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(cluster): course panel without competencies`.

### Task 10: Ship

- [ ] **Step 1:** `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build` — all clean.
- [ ] **Step 2:** Whole-branch review (most capable model); adversarial review of migration 0070 and the shared-code
  move (destruction-capable: the migration alters two existing tables).
- [ ] **Step 3:** Update `docs/STATE.md` (What's live: clusters, migration 0070, routes; Deferred: set cut-offs
  provisional until the 22 labels are scored) and `docs/ROADMAP.md`.
- [ ] **Step 4:** **Stop and ask the owner** for the live migration go-ahead. After yes: run the live-apply script
  (backup, `--apply`, verify), merge to dev, `deploy.sh <full sha>`, `verify-live.sh`, then check
  https://gcworkflow.clemson.edu:8443/build: create a cluster with three print courses, confirm statuses appear.
- [ ] **Step 5:** Commit docs; push on the owner's word.
