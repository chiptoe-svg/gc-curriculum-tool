# Course target bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Course pages show, for each career target, a bar with the share of the course's skill-tree skills that feed it. The wiki markdown carries the same numbers.

**Architecture:** A pure function computes the shares from the skill tree (`loadTree`) and target membership (`career_target_membership`). A thin database loader wraps it. The wiki course page calls the loader on each request (live). The wiki writer and the backfill script stamp the same numbers into the front matter: `contributes_to_targets` plus a new `target_skill_shares`. This replaces today's rule, which takes a course's targets from the target pages' contributing courses.

**Tech Stack:** Next.js 15 App Router (server component), TypeScript strict, Drizzle, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-22-course-target-bars-design.md`

## Global Constraints

- No AI calls, no schema change, no migration. The database is only read.
- **What a skill is:** one distinct `(courseCode, skillRef)` with at least one counted placement.
- **When a skill feeds a target:** it has a counted placement whose node, followed up through `parentId`, reaches a master node (`competencyId` set) whose competency is in that target's `career_target_membership`.
- **What counts as a placement:** the tree's own rule, `counts()` in `lib/skill-tree/read.ts`. That is a confirmed placement, or a proposed one whose source is not `embedding`. This is plan ruling R1, below.
- **Leaves:** a leaf's node is first resolved through `resolveNode` (which follows `merged_into`). A leaf drops out when the resolved node, or any of its ancestors, is retired, or when the walk never reaches a master.
- `pct = Math.round(100 * skills / totalSkills)`. Bars show every target, 0% included, sorted by pct descending, then targetId ascending.
- **Paired courses** are lecture/lab codes (`course_codes.paired_code`, `loadPairedSlugMap()` in `lib/ai/wiki/paired-links.ts`). A paired code's leaves fold into its parent course's page. GC 4900ap and GC 4900or are separate pages and do NOT fold. This corrects the spec's example; it is plan ruling R2.
- **Heading:** `Builds toward these career targets`, unchanged.
- **Explainer line:** `Share of this course's {N} skills that feed each target`, with ` · {c} of {p} placements confirmed by faculty` appended while c < p.
- **Front matter:**
  - `contributes_to_targets: [a, b]`: targets with pct > 0, in bar order.
  - `target_skill_shares: {a: 100, b: 38}`: every target, in bar order.
  - The OKF `tags` line is re-derived whenever it exists, as today.
- **A course with no counted skills:**
  - The page keeps today's link list: front-matter targets plus reverse links from the target pages.
  - The front matter gets `contributes_to_targets: []` and `target_skill_shares: {}`.
  - This is plan ruling R3.
- US spelling, plain language. Bar styling uses the existing wiki tokens (`--wiki-rule`, `--g-*` in `app/wiki/wiki.css`).

**Plan rulings (owner may overturn):**
- **R1:** count placements with the tree's `counts()` rule, not every non-rejected placement as the spec says. The department tree page and its readings already exclude bare text-similarity matches, and the bars should agree with that page. Live effect: GC 3800 has 5 counted skills rather than 14, and GC 4400 9 rather than 21. If the owner wants every non-rejected placement, the predicate is one line.
- **R2:** paired = lecture/lab codes only, as above.
- **R3:** zero skills → empty fields and the page's old list.

## Review Focus

1. **A skill placed under two competencies of the same target** counts once for that target, not twice. Test: `counts a skill once per target`.
2. **A leaf on a merged node** counts under the survivor's master. A leaf whose survivor is retired drops out. Test: `merged and retired nodes`.
3. **The loader failing** (database down, or the tree tables missing). The page still renders, with the old list. The wiki writer leaves the model's fields as written and logs a warning, the same as `loadCourseTargetMap` today. Tests: `page falls back when shares are null`, plus an update.ts test with a loader that throws.
4. **Rounding:** 1 of 3 shows as 33, not 33.333. All counted skills give exactly 100. Test: `rounds to whole percents`.
5. **A course whose skills sit only on paired codes** (the lab code). Its parent page still gets bars. Test: `folds paired codes`.

---

### Task 1: Share computation and loader

**Files:**
- Create: `lib/skill-tree/course-target-shares.ts` (pure)
- Create: `lib/db/course-target-shares-queries.ts` (loader)
- Test: `tests/lib/skill-tree/course-target-shares.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TargetShare { targetId: string; skills: number; pct: number }
  export interface CourseTargetShares { totalSkills: number; confirmedPlacements: number; totalPlacements: number; targets: TargetShare[] }
  export interface Membership { targetId: string; competencyId: string }
  // course-target-shares.ts
  export function courseTargetShares(tree: Tree, membership: Membership[], courseCodes: string[]): CourseTargetShares
  // course-target-shares-queries.ts
  export async function loadCourseTargetShares(courseCode: string): Promise<CourseTargetShares | null>  // folds paired codes in; null on any read failure (logged)
  export async function loadAllCourseTargetShares(pairedSlugs: Map<string, string>): Promise<Map<string, CourseTargetShares> | null>  // course page slug -> shares, for every course that has leaves
  ```
- `targets` lists every target id present in `membership`, even when no course skill reaches it.
- `totalPlacements` counts the counted placements that survive the walk. `confirmedPlacements` is the subset with status `confirmed`.

- [ ] **Step 1: Write the failing tests** using hand-built `Tree` fixtures:
  - `computes the share of skills per target`. A course with 4 skills: 4 feed T1, 1 feeds T2, none feed T3. Expect `totalSkills 4` and targets `[{T1,4,100},{T2,1,25},{T3,0,0}]` in that order.
  - `counts a skill once per target`. One skill on two masters, both in T1. Expect T1 skills = 1.
  - `walks up through parent skills`. A leaf on a parent node under a master counts for that master's targets.
  - `merged and retired nodes`. A leaf on a node merged into X counts under X's master. A leaf on a retired node, or under a retired parent, is dropped from every count.
  - `uses the tree's counting rule`. A rejected leaf and an embedding-proposed leaf are excluded. Proposed `scoring`, `ai` and confirmed leaves are included.
  - `counts confirmed placements`. 3 counted placements with 1 confirmed gives `confirmedPlacements 1`, `totalPlacements 3`.
  - `rounds to whole percents`. 1 of 3 gives 33.
  - `folds paired codes`. With `courseCodes ['GC 1010','GC 1011']`, skills from both codes are counted. A skillRef shared by both codes counts as two skills, because the skill key is (code, ref).
  - `no skills`. Gives `totalSkills 0`, every target at 0, and placements 0/0.
- [ ] **Step 2:** Run `pnpm vitest run tests/lib/skill-tree/course-target-shares.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `courseTargetShares`.** Use `counts` and `resolveNode` from `lib/skill-tree/read.ts`. Walk up with a cycle guard.
- [ ] **Step 4: Implement the two loaders.**
  - Use `loadTree()` (`lib/db/skill-tree-queries.ts`) and a select of `careerTargetMembership`.
  - Course codes come from `courses` with their paired codes, via `courseCodes`. Group the leaves by page slug, with `pairedSlugs.get(slug) ?? slug`. The slug rule is the same as `courseCodeToSlug`.
  - Wrap in try/catch: on failure, return null and `console.warn('[course-target-shares] …')`.
  - Don't test the loader against a database. Its fold logic is exercised through the pure function.
- [ ] **Step 5:** Run the test again. Expected: PASS. Then run `pnpm tsc --noEmit`. Expected: clean.
- [ ] **Step 6: Commit** `feat(skill-tree): share of a course's skills per career target`.

### Task 2: Front matter from the shares (writer and backfill)

**Files:**
- Modify: `lib/ai/wiki/course-targets.ts`
  - Replace `courseTargetMap`, `contributingCoursesOf`, `backfillCourseTargets`.
  - Keep `stampCourseTargets` only if the new function uses it.
- Modify: `lib/ai/wiki/update.ts:466-482`, which removes `loadCourseTargetMap`, and `:1136-1183`.
- Modify: `scripts/wiki/stamp-course-targets.ts`
- Modify: `tests/lib/ai/wiki/course-targets.test.ts`, `lib/ai/wiki/__tests__/update.test.ts` (header pin)

**Interfaces:**
- Consumes: `CourseTargetShares`, `loadAllCourseTargetShares` (Task 1).
- Produces:
  ```ts
  export function stampCourseTargetShares(content: string, shares: CourseTargetShares): string
  export function backfillCourseTargetShares(pages: Array<{ path: string; content: string }>, sharesBySlug: Map<string, CourseTargetShares>): Array<{ path: string; content: string }>
  ```

- [ ] **Step 1: Write the failing tests** in `course-targets.test.ts`:
  - `stamps targets in bar order and the shares map`. Shares `T2 100, T1 38, T3 0` give `contributes_to_targets: [T2, T1]` and `target_skill_shares: {T2: 100, T1: 38, T3: 0}`.
  - `replaces existing fields`, including a multi-line YAML `contributes_to_targets` list and an existing `target_skill_shares` line.
  - `zero skills gives empty fields`.
  - `leaves pages without front matter unchanged`.
  - `backfill re-derives tags and returns only changed course pages`. Keep the existing tags test's shape, and skip `courses/index.md`.
  - Delete the tests for the removed functions.
  - Update the pin in `update.test.ts` to the new two lines, as written with empty shares or with the mocked loader's values.
- [ ] **Step 2: Add a failing test in `update.test.ts`**, `leaves the model's target fields when shares are unavailable`. Mock `loadAllCourseTargetShares` to return null. The course page keeps whatever `contributes_to_targets` the model wrote.
- [ ] **Step 3:** Run `pnpm vitest run tests/lib/ai/wiki/course-targets.test.ts lib/ai/wiki/__tests__/update.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement.**
  - In `generateStampedPages`, load `loadAllCourseTargetShares(pairedSlugs)` only when a course page is generated, as today.
  - For `courses/<slug>` pages other than index, stamp `sharesBySlug.get(slug) ?? EMPTY` (the zero-skill value) before `stampOkfFrontmatter`.
  - The script keeps `--out <dir>` and `--in-place`. It now calls `loadAllCourseTargetShares(await loadPairedSlugMap())`, and exits 1 with a message if that returns null.
  - Update the script's header comment: it now reads the database, read-only, with no AI.
- [ ] **Step 5:** Run the two test files. Expected: PASS. Then `pnpm tsc --noEmit`. Expected: clean.
- [ ] **Step 6: Commit** `feat(wiki): course pages' target fields from the skill tree shares`.

### Task 3: Bars on the course page

**Files:**
- Modify: `app/wiki/CoursePageLayout.tsx` (new prop, bars render)
- Modify: `app/wiki/[type]/[slug]/page.tsx:~108-112, ~187` (load the shares, pass names and links)
- Modify: `app/wiki/wiki.css` (bar styles), `app/globals.css:540-542` only if the base grid needs it
- Test: `app/wiki/__tests__/CoursePageLayout.test.tsx`
- Modify: `docs/STATE.md`
  - Update the "Live wiki course pages under-listed career targets" entry: replace its "Open" sentence with this feature, and record rulings R1–R3.

**Interfaces:**
- Consumes: `loadCourseTargetShares` (Task 1).
- Produces: a `CoursePageLayout` prop, `targetShares: { totalSkills: number; confirmedPlacements: number; totalPlacements: number; targets: Array<{ href: string; label: string; pct: number }> } | null`.

- [ ] **Step 1: Write the failing tests:**
  - `renders a bar per target with its percent`. Each target name is a link to its href. The percent text (`38%`) is visible. Each bar has `role="img"` and an `aria-label` like `Production operations: 38% of skills`.
  - `shows the explainer and the confirmation count`. Text `Share of this course's 13 skills that feed each target · 0 of 13 placements confirmed by faculty`.
  - `drops the confirmation clause when all are confirmed`.
  - `page falls back when shares are null`. With `targetShares` null, or `totalSkills` 0, the old `<ul>` of `buildsToward` links renders.
- [ ] **Step 2:** Run `pnpm vitest run app/wiki/__tests__/CoursePageLayout.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement the layout.**
  - The bar is a track `<span>` holding a fill whose width is `${pct}%`. The percent sits at the right.
  - The layout must fit a 320px-wide screen without scrolling sideways.
  - Set the `program` flag at line 66 to true when there are shares.
- [ ] **Step 4: Wire the page.**
  - In `page.tsx`, for course pages, call `loadCourseTargetShares(codeFromSlug(pageSlug))`. Don't add a separate `.catch`: the loader already returns null on failure.
  - Map each target to `{ href: /wiki/targets/<id>${q}, label: titleOf.get(id) ?? id, pct }`.
- [ ] **Step 5:** Run the test file, then `pnpm vitest run app/wiki tests/lib/skill-tree tests/lib/ai/wiki lib/ai/wiki`, then `pnpm tsc --noEmit`. Expected: all PASS and clean.
- [ ] **Step 6: Commit** `feat(wiki): course pages show a skill-share bar per career target`, with STATE.md staged in the same commit.

### After the plan (owner-gated, not tasks)

- **Deploy:** check the interview is idle, then run `deploy.sh <sha>`. Check the course pages on the campus URL.
- **Backfill:** `stamp-course-targets.ts --out <dir>` first, and diff the result. Then `--in-place` on the wiki, commit and push the wiki with the owner's yes, and re-run `snapshot-public.mjs --apply`.
