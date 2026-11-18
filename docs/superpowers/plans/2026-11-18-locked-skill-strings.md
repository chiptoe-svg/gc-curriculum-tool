# Locked Skill Strings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faculty lock named skill strings on cluster maps; strings are a department-wide record that joins, branches
and merges through shared skill points, is read in its own panel, shows read-only on `/build`, and warns when a course
change would break it.

**Architecture:** Migration 0071 adds a shared graph (skill points + links) and named strings as ordered paths through
it, with an append-only event log. All readings come from one pure module (`lib/builder/strings/`), computed against
each course's latest capture; reword detection reuses the campus embedding shortlist and pair judge, cached per
(point, snapshot). Clusters are the only editing surface; `/build`, `/strings`, `/courses/[code]` and `/capture/[code]`
read.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle on Postgres 17, Vitest, campus Qwen embeddings and
pair judge (`lib/ai/embeddings`, `lib/ai/match-judge`).

**Spec:** `docs/superpowers/specs/2026-11-18-locked-skill-strings-design.md` (owner-approved 2026-11-18). Read it first;
its "Resolved after the builder check" and owner-marked sections are binding.

## Global Constraints

- Hash scheme for every skill point: `textHash(normalizeStatement(s))` (`lib/catalog/bundles`, `lib/catalog/project-trail`).
- Points anchor to **captured** courses only; "current" = `course.versions[0]` of `loadLibrary()`. Never map edits, never what-ifs.
- Nothing repairs a point without a faculty confirm. Reads never write to strings, points, links or path rows.
- Warnings never block a save, a capture, or an edit.
- Matcher unavailable → point status `unchecked`, shown as "Couldn't check", never "broken".
- String ends get no warning styling. Copy: "Ends at GC xxxx (Act n)"; merged: "Merges into *X* at GC xxxx".
- Reinforcement = a `develops` stop after the first whose K, U or D is within one level of the string's running peak on that dimension.
- `readString` takes `options.fade: number | null`; this version always passes `null`.
- Any faculty who may write plans/clusters may lock, extend, join, branch, merge, unmerge, remove, confirm, note and unlock (the `plan-write` rule in `lib/auth/authorize.ts`). Unlock, unmerge and remove-point require a non-empty reason.
- `/strings` pages and `/api/strings*` are faculty-only (not in `PUBLIC_PREFIXES`); nothing on public wiki pages.
- Live migration only with the owner's explicit go-ahead and a fresh backup (same pattern as `scripts/migrations/2026-11-17-clusters-live-apply.sh`).
- Free campus models only; no paid AI. US spelling; UI says "string", never "thread". No instructor names in fixtures or shared files.
- Named cables, chords, automatic suggestions, fade switched on: out of scope.

## Review Focus

1. A recapture rewords two skills in one course and both resemble the same old point: each point gets its own candidate; confirming a reword onto a hash another point of the same course and role already holds is refused (409), not merged silently. → Task 4 test `refuses a reword onto an existing point`.
2. Two faculty edit the same string at once: the second save gets 409 with the current version, and the client reloads instead of overwriting. → Task 4 test `stale version is refused`, Task 6 test.
3. Merge rules: into itself, into an unlocked string, into a string that (directly or through a chain) merges into it, or from a last point not on the target path — all refused. → Task 4 tests.
4. A course in a string disappears from the catalog/library or loses all captures: its points read `broken` with "course not found" / "no capture", the panel still renders. → Task 3 test.
5. Unlocked strings: still readable at `/strings/[id]`, never drawn on maps, never counted when listing orphans, never trigger warnings. → Tasks 5, 8, 9 tests.

---

## File Structure

- `drizzle/0071_skill_strings.sql`, `lib/db/schema.ts` (tables), `scripts/migrations/2026-11-18-strings-live-apply.sh`
- `lib/builder/strings/types.ts` — shared types (StringGraph, StringRow, PointRow, Stop, PointStatus, StringReading).
- `lib/builder/strings/order.ts` — stop ordering.
- `lib/builder/strings/read.ts` — `readString` (all panel readings), `stringEnd`, `joinsAt`.
- `lib/builder/strings/resolve.ts` — pure point resolution against the library.
- `lib/builder/strings/touch.ts` — which strings an edit would break; orphans per course.
- `lib/strings/reword.ts` — server: shortlist + judge + cache for changed points.
- `lib/db/string-queries.ts` — reads and all writes, each in one transaction with its event.
- `app/api/strings/route.ts`, `app/api/strings/[id]/route.ts`, `app/api/strings/resolve/route.ts`, `app/api/strings/orphan-notes/route.ts`
- `components/strings/StringPanel.tsx`, `components/strings/strings.css`
- `app/strings/page.tsx`, `app/strings/[id]/page.tsx`
- Cluster: `app/build/clusters/LockString.tsx`, edits to `ClusterRequiredList.tsx`, `ClusterCanvas.tsx`, `[id]/ClusterBuilder.tsx`
- `/build`: edits to `app/build/[id]/Map.tsx`, `Builder.tsx`, `page.tsx`, `CourseEditors.tsx`
- Course and capture: `components/strings/CourseStrings.tsx`, edits to `app/courses/[code]/page.tsx`, `app/capture/[code]/page.tsx`

---

### Task 1: Migration 0071 and schema

**Files:**
- Create: `drizzle/0071_skill_strings.sql`, `scripts/migrations/2026-11-18-strings-live-apply.sh`
- Modify: `lib/db/schema.ts` (after `skillSetJudgments`)
- Test: `lib/db/__tests__/strings-schema.test.ts`

**Interfaces:**
- Produces (Drizzle tables, exported from schema.ts): `stringPoints`, `stringLinks`, `curriculumStrings`, `curriculumStringPath`, `skillOrphanNotes`, `curriculumStringEvents`, `stringPointResolutions`.

Tables (snake_case SQL; camelCase Drizzle):
- `string_points`: id uuid pk; course_code text; role text CHECK IN ('develops','requires'); statement text; statement_hash text; snapshot_id uuid null; k,u,d smallint null; term smallint null CHECK (term BETWEEN 1 AND 9); created_by text; created_at timestamptz. UNIQUE (course_code, role, statement_hash).
- `string_links`: id uuid pk; from_point uuid → string_points ON DELETE RESTRICT; to_point uuid → string_points ON DELETE RESTRICT; why text; created_by; created_at. UNIQUE (from_point, to_point); CHECK (from_point <> to_point).
- `curriculum_strings`: id uuid pk; name text; description text; status text CHECK IN ('active','unlocked') default 'active'; end_note text null; end_by text null; end_at timestamptz null; merged_into uuid null → curriculum_strings ON DELETE RESTRICT; merged_by, merged_at null; merge_reason text null; created_by/at, updated_by/at; version integer default 1 CHECK ≥ 1; CHECK (merged_into IS NULL OR merged_into <> id). Partial unique index on lower(name) WHERE status = 'active'.
- `curriculum_string_path`: string_id uuid → curriculum_strings ON DELETE CASCADE; position integer; point_id uuid → string_points ON DELETE RESTRICT; PK (string_id, position).
- `skill_orphan_notes`: course_code, role (same CHECK), statement_hash, statement, reason, by, at; PK (course_code, role, statement_hash).
- `curriculum_string_events`: id uuid pk; string_id uuid null; point_id uuid null; kind text CHECK IN ('locked','extended','joined','branched','merged','unmerged','point_removed','reword_confirmed','renamed','end_note','unlocked','relocked','orphan_note'); by text; at timestamptz; reason text null; before jsonb null; after jsonb null. Index (string_id, at desc).
- `string_point_resolutions`: point_id uuid → string_points ON DELETE CASCADE; snapshot_id uuid; status text CHECK IN ('changed','broken'); candidate_statement text null; candidate_hash text null; p_partly real null; model text; prompt_version text; created_at; PK (point_id, snapshot_id, model, prompt_version).

- [ ] **Step 1: Write the failing test** — `strings-schema.test.ts` reads `drizzle/0071_skill_strings.sql` and asserts: it begins with `BEGIN;` and ends with `COMMIT;`; contains `RAISE EXCEPTION '0071: already applied'` guarded on `string_points`, and `'0071: precondition — 0070 not applied'` guarded on `curriculum_clusters`; contains no `DROP TABLE`, `DELETE`, `UPDATE`, `TRUNCATE`, `DROP COLUMN`; creates exactly the 7 tables above; and `getTableConfig` on each Drizzle table lists the unique/PK columns above.
- [ ] **Step 2: Run** `pnpm vitest run lib/db/__tests__/strings-schema.test.ts` → FAIL (file missing).
- [ ] **Step 3: Write the SQL** in the 0070 style (header comment naming the spec, `SET LOCAL lock_timeout = '5s'`, guard DO block) **and the Drizzle tables**. Write the apply script by copying the 0070 script's structure: preflight read-only by default; `--apply` requires 0070 present and 0071 absent, refuses destructive statements, backs up to `dump-pre-0071-<ts>.sql.gz` with the same size/gzip checks, applies, verifies 7 more base tables and the partial unique index.
- [ ] **Step 4: Run** the test → PASS; `pnpm tsc --noEmit` clean. Apply to the **local dev** database only (`pnpm drizzle-kit` is not used; `psql -f` against the dev URL read via `read-env.mjs`), then re-run the apply guard to see `already applied`.
- [ ] **Step 5: Commit** `feat(strings): migration 0071 — skill points, links, strings, path, events, notes, resolution cache`.

### Task 2: Pure readings — order and readString

**Files:**
- Create: `lib/builder/strings/types.ts`, `lib/builder/strings/order.ts`, `lib/builder/strings/read.ts`
- Test: `lib/builder/strings/__tests__/read.test.ts`, `order.test.ts`

**Interfaces:**
- Produces:
  - `type Role = 'develops' | 'requires'`
  - `interface PointRow { id: string; courseCode: string; role: Role; statement: string; statementHash: string; snapshotId: string | null; k: number | null; u: number | null; d: number | null; term: number | null }`
  - `interface StringRow { id: string; name: string; description: string; status: 'active' | 'unlocked'; endNote: string | null; mergedInto: string | null; version: number; path: string[] /* point ids in order */ }`
  - `interface LinkRow { id: string; from: string; to: string; why: string; createdBy: string; createdAt: string }`
  - `interface StringGraph { strings: StringRow[]; points: Record<string, PointRow>; links: LinkRow[] }`
  - `type PointStatus = { kind: 'intact'; now: Depth } | { kind: 'changed'; now: Depth | null; candidate: { statement: string; hash: string } } | { kind: 'broken'; why: 'skill gone' | 'course not found' | 'no capture' } | { kind: 'unchecked' }`
  - `interface StopReading { pointId: string; courseCode: string; act: Act; role: Role; depth: Depth | null /* attained now for develops, need for requires */; status: PointStatus; why: string | null /* link into this stop */; slip: Array<'k'|'u'|'d'>; gap: Array<'k'|'u'|'d'>; reinforces: boolean; mergedIn: string[] /* string ids */; sharedWith: Array<{ stringId: string; relation: 'joins' | 'branches' }> }`
  - `interface StringReading { stops: StopReading[]; reinforcement: number; end: { kind: 'ends'; courseCode: string; act: Act; note: string | null } | { kind: 'merges'; into: string; courseCode: string } }`
  - `orderPoints(points: PointRow[], levelOf: (code: string) => number): PointRow[]` — by `defaultAct({code, level})`, then the numeric part of the code, then `develops` before `requires`; stable.
  - `readString(g: StringGraph, stringId: string, status: Record<string, PointStatus>, levelOf: (code: string) => number, options: { fade: number | null }): StringReading`

- [ ] **Step 1: Write failing tests** (fixtures use codes GC 1040 / GC 2400 / GC 3400 / GC 4400 / GC 4800 and level = first digit):
  - `orderPoints`: GC 1040 (Act 1), then GC 3400 and GC 4400 (both Act 2 per `defaultAct`; 3400 first by number), then GC 4800 (Act 3); within one course, develops before requires.
  - slip: develops stops D3 then D2 → second stop `slip: ['d']`.
  - reinforcement: develops K2U2D2 → K1U1D1 (not within one of peak 2? 1 is within one → counts) → K0U0D0 (not) gives `reinforcement === 1`, and a requires stop never counts.
  - gap: develops D2 then requires need D3 → `gap: ['d']`; need D2 → `gap: []`.
  - end: last stop GC 2400 → `{ kind: 'ends', courseCode: 'GC 2400', act: 1, note }`; with `mergedInto` set → `{ kind: 'merges', into, courseCode }`.
  - mergedIn: string B with `mergedInto: A`, B's last point = A's 3rd point → A's stop 3 `mergedIn: [B.id]`.
  - sharedWith: string C shares A's first two points then diverges → A stop 2 `{ stringId: C, relation: 'branches' }`; string D shares only A's stop 3 coming from elsewhere → `'joins'`. Unlocked strings are ignored for mergedIn/sharedWith.
  - `options.fade` non-null throws `Error('fade not implemented')` (keeps the hook honest until built).
  - status `changed` with `now` uses `now` for depth; `broken`/`unchecked` → `depth: null` and the stop is skipped for slip/gap/reinforcement comparisons.
- [ ] **Step 2: Run** `pnpm vitest run lib/builder/strings` → FAIL.
- [ ] **Step 3: Implement** in the three files. Act from `defaultAct` in `lib/builder/compute.ts`; `Depth` from `lib/builder/types.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(strings): pure string readings — order, depth, slip, gap, reinforcement, ends, joins, merges`.

### Task 3: Point resolution (pure) and reword check (server)

**Files:**
- Create: `lib/builder/strings/resolve.ts`, `lib/strings/reword.ts`
- Test: `lib/builder/strings/__tests__/resolve.test.ts`, `lib/strings/__tests__/reword.test.ts`

**Interfaces:**
- Consumes: `PointRow`, `PointStatus` (Task 2); `Library`, `LibraryCourse` (`lib/builder/types.ts`); `judgePairs`, `CUTOFFS`, `MODEL_IN_USE`, `PROMPT_VERSION` (`lib/ai/match-judge`); `embedBatch`, `cosineSimilarity` (`lib/ai/embeddings`).
- Produces:
  - `resolveExact(point: PointRow, lib: Library): PointStatus | { kind: 'needs-check'; snapshotId: string; pool: Array<{ statement: string; hash: string }> }` — intact on same hash in the role's list of `versions[0]` (`skills` for develops, `required` for requires; `now` from that skill's k/u/d or `need`); `broken: course not found` / `no capture`; empty pool → `broken: skill gone`; otherwise needs-check with the role's skills **not already held by another point of the same course and role**.
  - `checkRewords(items: Array<{ point: PointRow; snapshotId: string; pool: Array<{ statement: string; hash: string }> }>): Promise<Record<string, PointStatus>>` in `lib/strings/reword.ts` — reads `string_point_resolutions` for (point, snapshot, MODEL_IN_USE, PROMPT_VERSION); for misses, embeds, shortlists top 8 by cosine, judges pairs (point statement = required side), picks the highest `pPartly` ≥ `CUTOFFS[MODEL_IN_USE].partly`; writes the cache row (`changed` with candidate, or `broken`); any campus error → `unchecked` for those points, nothing cached.
  - `resolveAll(lib: Library, points: PointRow[]): Promise<Record<string, PointStatus>>` — `resolveExact` then `checkRewords` for the rest.

- [ ] **Step 1: Failing tests.** resolve.test.ts: intact (develops, depth from skill), intact (requires, depth = need), course not found, no capture, skill gone, needs-check pool excludes a hash another point of that course/role holds. reword.test.ts (mock embeddings/judge/db as `app/api/build/match/__tests__/route.test.ts` does): cache hit makes no campus call; best candidate above the partly cutoff → changed; all below → broken and cached; `judgePairs` throws → unchecked, nothing written.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(strings): resolve points against current captures; reword check with campus judge and cache`.

### Task 4: Queries and write rules

**Files:**
- Create: `lib/db/string-queries.ts`, `lib/builder/strings/rules.ts`
- Test: `lib/builder/strings/__tests__/rules.test.ts`, `lib/db/__tests__/string-queries.test.ts` (against the dev DB, like other `*-queries` tests; skip if no DB)

**Interfaces:**
- Produces (`rules.ts`, pure, each returns `null` or an error string shown to the user):
  - `checkPath(g: StringGraph, path: string[]): string | null` — ≥ 2 points, no repeated point, consecutive pairs have a link.
  - `checkMerge(g: StringGraph, from: string, into: string): string | null` — refuse self ("A string can't merge into itself."), into unlocked ("That string is unlocked."), cycle through `mergedInto` chain ("That string already merges into this one."), last point not on target path ("The other string doesn't pass through this string's last skill.").
  - `checkBranch(g, stringId, atPosition): string | null` — refuse at the last position ("Extend the string instead.").
- Produces (`string-queries.ts`), every write in one `db.transaction` that also inserts its `curriculum_string_events` row, bumps `version`, sets `updated_by/at`, and returns `{ ok: true; graph: StringGraph } | { ok: false; status: 400 | 404 | 409; error: string; current?: StringRow }`:
  - `loadGraph(opts?: { courseCodes?: string[]; includeUnlocked?: boolean }): Promise<StringGraph>` (with courseCodes: strings with any point in those courses, plus all their points).
  - `upsertPoint(tx, p: Omit<PointRow,'id'|'term'> & { by: string }): Promise<string>` (on conflict of the unique key returns the existing id).
  - `upsertLink(tx, from, to, why, by): Promise<string>` (existing link keeps its why; a new why on an existing link is ignored and the response says so).
  - `lockString({ name, description, points: Array<point input>, whys: string[] /* length points-1 */, by })`
  - `extendString({ id, version, at: 'start' | 'end', point, why, by })`
  - `branchString({ fromId, version, atPosition, name, description, point, why, by })` — new string = from's path[0..atPosition] + new point.
  - `mergeString({ id, version, into, reason, by })`, `unmergeString({ id, version, reason, by })`
  - `removePoint({ id, version, position, reason, by })` — removing an end point shortens; a middle point leaves the path with a gap: the path is split — refuse with "Removing a middle skill would cut the string in two. Unlock it or branch instead." (keeps `checkPath` true).
  - `confirmReword({ pointId, candidate: { statement, hash }, snapshotId, by })` — 409 "Another string point already holds that skill." if (course, role, candidate hash) exists; else updates the point's statement/hash/snapshot/k/u/d and writes one event (`string_id` null, `point_id` set).
  - `setEndNote`, `rename`, `unlockString({ reason })`, `relockString` (refused when another active string has the same name), `setOrphanNote({ courseCode, role, statementHash, statement, reason, by })`.
  - `listOrphanNotes(courseCodes: string[])`.

- [ ] **Step 1: Failing tests.** rules.test.ts: each refusal message above, and the accepting case. string-queries.test.ts: lock writes 1 string, N points, N-1 links, 1 `locked` event; locking a second string through an existing point reuses the point (point count unchanged) — the join; `stale version is refused` (409 with `current`); `refuses a reword onto an existing point`; merge chain cycle refused; unlock without reason → 400; name clash with an active string → 409, with an unlocked one → allowed.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(strings): string queries with write rules, optimistic version and event log`.

### Task 5: API routes and auth

**Files:**
- Create: `app/api/strings/route.ts` (GET list, POST lock), `app/api/strings/[id]/route.ts` (GET one; PATCH `{ action, version, ... }` with action ∈ extend | branch | merge | unmerge | remove-point | rename | end-note | unlock | relock), `app/api/strings/resolve/route.ts` (POST `{ courseCodes }` → `{ graph, status }` for active strings through those courses; `{ stringId }` → that string, unlocked included), `app/api/strings/points/[id]/route.ts` (POST confirm reword), `app/api/strings/orphan-notes/route.ts` (POST).
- Modify: `lib/auth/authorize.ts` (`PLAN_WRITE` regex gains `|strings(?:\/[0-9a-f-]{36})?|strings\/(?:resolve|orphan-notes)|strings\/points\/[0-9a-f-]{36}`; update its comment), `lib/auth/__tests__/authorize.test.ts`
- Test: `app/api/strings/__tests__/strings.test.ts`

**Interfaces:**
- Consumes: Task 3 `resolveAll`, Task 4 queries. Author name via `personalName(auth.grant)` or body `authorName`, as `app/api/build/clusters/route.ts`.
- Produces: JSON contracts above; errors `{ error }` with the Task 4 status codes.

- [ ] **Step 1: Failing tests:** authorize — POST `/api/strings` is `plan-write` (capture grant with scope → ok; no capture → `needs-capture`); GET `/strings` is gated (not public: `isPublicPath('/strings') === false` in `lib/auth/basic-auth.ts`). Routes (mock queries): POST without name → 400; PATCH unknown action → 400; PATCH with stale version → 409 body has `current`; resolve with `{ courseCodes }` excludes unlocked strings, with `{ stringId }` of an unlocked string returns it.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Commit** `feat(strings): API routes; string writes follow the plan-write rule`.

### Task 6: String panel and /strings pages

**Files:**
- Create: `components/strings/StringPanel.tsx`, `components/strings/strings.css`, `app/strings/page.tsx`, `app/strings/[id]/page.tsx`
- Test: `components/strings/__tests__/StringPanel.test.tsx`, `app/strings/__tests__/index.test.tsx`

**Interfaces:**
- Consumes: `readString` (Task 2), `/api/strings/resolve`, `/api/strings/[id]` PATCH, `/api/strings/points/[id]`.
- Produces: `StringPanel(props: { graph: StringGraph; status: Record<string, PointStatus>; stringId: string; levelOf: (code: string) => number; editable: boolean; onChanged: (g: StringGraph) => void; editHref?: string })`. `editable=false` hides every write control and shows "Edit in a cluster" when `editHref` is given.

Panel content (spec "The string panel"): name, description, status; stops grouped by Act with course, role ("develops" / "needs"), wording, K/U/D now (and "at lock" when changed), status line ("Reworded? *new* — Confirm / Not the same", "Skill gone", "Couldn't check: try again"), the link's why, evidence from `LibraryVersion` (projects and outcomes the version carries for that course; show only what exists); slip and gap marks; "Reinforced N times"; end line exactly "Ends at GC xxxx (Act n)" plus note, or "Merges into *X* at GC xxxx"; "*A* merged in here"; "joined by *X*" / "*Y* branches off here" links; history list. "Not the same" marks the point broken for this view only (no write).

`/strings`: table of active strings (toggle "Show unlocked") with name, courses, stops, reinforcement, "Ends at"; sort by name / end course / end Act; filter by end Act and by course. `/strings/[id]`: the panel, read-only (`editable=false`, `editHref` = Task 7's cluster link).

- [ ] **Step 1: Failing tests:** panel renders "Ends at GC 2400 (Act 1)" with no element carrying a warning class; renders "Merges into Color management at GC 4800"; changed point shows Confirm and calls the points route; a 409 on any PATCH shows "Someone else changed this string. Reloaded." and calls `onChanged` with the server's graph; `editable=false` renders no buttons except "Edit in a cluster". Index: sorting by end Act orders Act 1 before Act 3; unlocked strings hidden until the toggle.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(strings): string panel and /strings index`.

### Task 7: Cluster editing

**Files:**
- Create: `app/build/clusters/LockString.tsx`
- Modify: `app/build/clusters/ClusterRequiredList.tsx`, `app/build/clusters/ClusterCanvas.tsx`, `app/build/clusters/[id]/ClusterBuilder.tsx`, `app/build/clusters/cluster.css`, `app/api/build/clusters/route.ts` (POST accepts optional `courses: string[]` → initial cards via `nextCardSpot`)
- Test: `app/build/clusters/__tests__/LockString.test.tsx`, `ClusterCanvas.test.tsx`, `app/api/build/clusters/__tests__/clusters.test.ts`

**Interfaces:**
- Consumes: `StatusResult.suppliers` (`lib/builder/cluster/status.ts`), Tasks 4–6.
- Produces: `LockString(props: { required: { courseCode: string; statement: string; need: Depth }; suppliers: Array<{ courseCode: string; statement: string; k,u,d }>; strings: StringGraph; onLocked: (g: StringGraph) => void })` with two modes: "Lock as string" (name, description, a why per link, tick suppliers, default all) and "Add to string…" (pick an active string through any ticked supplier or ending at one; extend or join). `clusterStringHref(codes: string[]): string` → `/build/clusters/new?courses=…` handled by NewCluster (creates and redirects).

Rules: the Lock button shows on a required skill only when its status has suppliers and the required course and every ticked supplier course are captured catalog courses with the skill present in `versions[0]` (not a what-if, not a proposed course, not a draft edit). Otherwise show "Strings can only run through captured courses." The panel (Task 6) opens in the cluster drawer with `editable=true`, adding Extend / Branch from here / Merge into / Remove / Unlock / Rename / End note controls; Merge into is offered only when `checkMerge` passes for some string.

Canvas overlay: for each active string with ≥ 2 points on cluster cards, draw a course-to-course curve per consecutive pair in a per-string color (`--str-0..5`), name in `<title>`; a merge draws the merging string's last segment into the target's curve; click opens the panel. Cards show a small count "n strings".

- [ ] **Step 1: Failing tests:** LockString — suppliers default all ticked; unticking leaves one; submitting posts points ordered by `orderPoints`; a what-if supplier disables the button with the copy above. Canvas — two strings sharing a card draw two curves with distinct colors; an unlocked string draws nothing. Clusters POST with `courses` creates those cards.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(strings): lock, extend, join, branch and merge strings on the cluster map`.

### Task 8: Strings on /build (read-only)

**Files:**
- Modify: `app/build/[id]/page.tsx` (load `loadGraph({ courseCodes: plan's catalog courses })`), `app/build/[id]/Builder.tsx` (fetch statuses from `/api/strings/resolve` after load), `app/build/[id]/Map.tsx` (overlay), `app/build/build.css`
- Test: `app/build/[id]/__tests__/MapStrings.test.tsx`

**Interfaces:**
- Consumes: Tasks 2, 5, 6, 7 (`clusterStringHref`).
- Produces: `mapStringSegments(g: StringGraph, onMap: Set<string>): Array<{ stringId: string; from: string; to: string; kind: 'segment' | 'merge' } | { stringId: string; from: string; leaves: string /* next course code, off map */ }>` in `lib/builder/strings/touch.ts`.

Drawn on the front SVG layer, distinct from the course arrows: locked strings as colored curves with name on hover; a card where ≥ 2 strings share a point gets a small shared-point dot; a string leaving the plan ends in a stub labeled "continues to GC xxxx, not in this plan"; changed/broken points show as a hollow/broken mark on the card edge. Click opens `StringPanel` read-only with `editHref = clusterStringHref(string's course codes)`. No edit controls anywhere on `/build`.

- [ ] **Step 1: Failing tests:** `mapStringSegments` — a string through GC 1040 → GC 2400 → GC 4800 with only the first two on the map yields one segment and one `leaves: 'GC 4800'`; unlocked string yields nothing; a merge yields `kind: 'merge'`. Map renders the stub label text exactly.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(strings): show locked strings read-only on /build`.

### Task 9: Break warnings and orphans

**Files:**
- Modify: `lib/builder/strings/touch.ts`; `app/build/clusters/ClusterRequiredList.tsx` and the developed-skill editor in the cluster course drawer; `app/build/[id]/CourseEditors.tsx`
- Test: `lib/builder/strings/__tests__/touch.test.ts`, `app/build/[id]/__tests__/CourseEditors.test.tsx`

**Interfaces:**
- Produces:
  - `stringsAt(g: StringGraph, courseCode: string, role: Role, statementHash: string): StringRow[]` (active only).
  - `breakWarning(g: StringGraph, courseCode: string, role: Role, statementHash: string): string | null` — exact copy: `This skill is on ${names}. ${laterCodes} build on it.` where names = string names joined with " and " (three or more: "a, b and c"), laterCodes = distinct course codes after this point on those strings in order, joined the same way; when nothing comes after: `This skill is on ${names}.`
  - `orphansOf(lib: Library, g: StringGraph, notes: OrphanNote[], courseCode: string): { developed: Array<{ statement; hash; note: string | null }>; unsupplied: Array<{ statement; hash; note: string | null }> }` — developed = skills of `versions[0]` on no active string's point; unsupplied = required skills that are not a `requires` point with an earlier `develops` point on some active string.

Editors: on save of an edit that changes a captured skill's wording, or on remove, show `breakWarning` inline above the Save/Remove button before confirming; the action still proceeds with one more click ("Save anyway" / "Remove anyway"). Map preview: a point whose skill a map edit removes or rewords renders with the would-break mark (Task 8's broken mark, dashed) — no write.

- [ ] **Step 1: Failing tests:** `breakWarning` copy for one, two and three strings and for an end point; unlocked strings give null; `orphansOf` excludes skills on active strings, includes skills only on an unlocked string, attaches notes by hash. CourseEditors: removing a skill on a string shows the warning and "Remove anyway", and the second click calls `onRemove`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(strings): break warnings in course editors; orphan lists`.

### Task 10: Course and capture pages; docs

**Files:**
- Create: `components/strings/CourseStrings.tsx`
- Modify: `app/courses/[code]/page.tsx`, `app/capture/[code]/page.tsx`, `docs/STATE.md`, `docs/ROADMAP.md` (strings-and-chords row: "Strings: built"; add "Named cables → with chords"), `docs/superpowers/README.md`
- Test: `components/strings/__tests__/CourseStrings.test.tsx`

**Interfaces:**
- Consumes: Tasks 3, 6, 9.
- Produces: `CourseStrings(props: { courseCode: string; mode: 'course' | 'capture' })` — client component; fetches `/api/strings/resolve` for the course; lists "Strings through this course" with each string's name, the stop's status, link to `/strings/[id]`; then "Skills on no string" (orphans with notes, each with "Add a note"); in `capture` mode, only when at least one point in this course is changed or broken, a banner: "This capture changed *n* strings" with the list and Confirm links.

- [ ] **Step 1: Failing tests:** banner absent when all points are intact; present with the count when one is changed; "Couldn't check" when resolve returns `unchecked`; orphan note form posts to `/api/strings/orphan-notes`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5:** Update STATE.md (routes `/strings`, `/strings/[id]`, `/api/strings*`; migration 0071 not applied; Deferred: named cables, chords, fade switched on, automatic suggestions, string term placement from plans) and the doc index. Run the full suite `pnpm vitest run` and `pnpm tsc --noEmit` → all green.
- [ ] **Step 6: Commit** `feat(strings): strings and orphans on course and capture pages; docs`.

Deploy is not part of this plan: after merge, the owner decides; then backup + `scripts/migrations/2026-11-18-strings-live-apply.sh --apply`, deploy chain, verify-live.
