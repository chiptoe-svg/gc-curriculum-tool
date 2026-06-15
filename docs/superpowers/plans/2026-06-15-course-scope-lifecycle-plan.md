# Course Scope & Lifecycle Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two orthogonal classifiers to every course — `scope` (`gc | external`) and `status` (`offered | proposed | sandbox | retired`) — and route every program rollup through one `isProgramVisible` predicate so non-GC / proposed / external-sandbox courses never leak into the GC program record or the public surface.

**Architecture:** Two additive enum columns on `courses` (default `gc`/`offered`, so existing data is unchanged). One pure predicate module is the single source of inclusion truth; each rollup either filters its course/snapshot set through it (TS) or appends an equivalent SQL fragment (raw-SQL queries). The faculty roster gains segregated "External / sandbox" and "Proposed" sections. **Out of scope (separate plans):** external-tester scoped magic-link access, IMSCC import, OKF bundle export.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle ORM + Postgres 17, drizzle-kit migrations (`pnpm db:generate` → `./drizzle`, `pnpm db:migrate`), Vitest.

**Spec:** [`2026-06-15-course-scope-lifecycle-design.md`](../specs/2026-06-15-course-scope-lifecycle-design.md)

---

### Task 1: Schema — `scope` + `status` enums and columns

**Files:**
- Modify: `lib/db/schema.ts:82` (add enums beside `courseCategory`) and `lib/db/schema.ts:99-100` (add columns to `courses`)
- Generated: `drizzle/00NN_*.sql` (drizzle-kit output)

- [ ] **Step 1: Add the two enums** next to `courseCategory` (after line 82).

```ts
export const courseScope = pgEnum('course_scope', ['gc', 'external']);
export const courseStatus = pgEnum('course_status', ['offered', 'proposed', 'sandbox', 'retired']);
```

- [ ] **Step 2: Add the two columns** to the `courses` table, immediately after the `buildsToCareer` line (`lib/db/schema.ts:100`).

```ts
  // Scope & lifecycle (migration 00NN, 2026-06-15). `scope` = owning curriculum
  // ('gc' today; 'external' = sandbox/another-uni). `status` = lifecycle. The
  // pair drives isProgramVisible — see lib/courses/program-visibility.ts.
  scope: courseScope('scope').notNull().default('gc'),
  status: courseStatus('status').notNull().default('offered'),
```

- [ ] **Step 3: Generate the migration.**

Run: `pnpm db:generate`
Expected: a new `drizzle/00NN_*.sql` that `CREATE TYPE course_scope`, `CREATE TYPE course_status`, and `ALTER TABLE courses ADD COLUMN ... DEFAULT '...' NOT NULL` for both. Because of the defaults, every existing row is backfilled to `gc`/`offered` automatically.

- [ ] **Step 4: Apply the migration.**

Run: `pnpm db:migrate`
Expected: applies cleanly. Verify the backfill: `pnpm exec tsx -e "import('@/lib/db/client').then(async ({db})=>{const {courses}=await import('@/lib/db/schema');const r=await db.select().from(courses).limit(1);console.log(r[0]?.scope, r[0]?.status);process.exit(0)})"` prints `gc offered`.

- [ ] **Step 5: Type-check.**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(schema): add course scope + status enums/columns (default gc/offered)"
```

---

### Task 2: The `isProgramVisible` inclusion predicate (the leakage guard)

**Files:**
- Create: `lib/courses/program-visibility.ts`
- Test: `tests/lib/courses/program-visibility.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { isProgramVisible, isSandbox, isProposed } from '@/lib/courses/program-visibility';

const C = (scope: string, status: string) => ({ scope, status }) as { scope: 'gc' | 'external'; status: 'offered' | 'proposed' | 'sandbox' | 'retired' };

describe('program-visibility predicates', () => {
  it('isProgramVisible only for gc + offered', () => {
    expect(isProgramVisible(C('gc', 'offered'))).toBe(true);
    expect(isProgramVisible(C('gc', 'proposed'))).toBe(false);
    expect(isProgramVisible(C('gc', 'retired'))).toBe(false);
    expect(isProgramVisible(C('external', 'sandbox'))).toBe(false);
    expect(isProgramVisible(C('external', 'offered'))).toBe(false);
  });
  it('isSandbox only for external + sandbox', () => {
    expect(isSandbox(C('external', 'sandbox'))).toBe(true);
    expect(isSandbox(C('gc', 'offered'))).toBe(false);
  });
  it('isProposed only for status proposed (any scope)', () => {
    expect(isProposed(C('gc', 'proposed'))).toBe(true);
    expect(isProposed(C('gc', 'offered'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — fails** (module missing).

Run: `pnpm exec vitest run tests/lib/courses/program-visibility.test.ts`
Expected: FAIL ("Cannot find module '@/lib/courses/program-visibility'").

- [ ] **Step 3: Implement the module.**

```ts
import { sql } from 'drizzle-orm';

/** The minimal shape every predicate needs — a course's two classifiers. */
export interface CourseVisibilityFields {
  scope: 'gc' | 'external';
  status: 'offered' | 'proposed' | 'sandbox' | 'retired';
}

/**
 * THE inclusion rule. A course counts in the GC program record + public surface
 * iff it is a GC course that is currently offered. Every program rollup must
 * route its course/snapshot set through this (TS) or PROGRAM_VISIBLE_SQL (raw).
 */
export function isProgramVisible(c: CourseVisibilityFields): boolean {
  return c.scope === 'gc' && c.status === 'offered';
}

/** External test/sandbox course (isolated everywhere; reachable only via its scoped link). */
export function isSandbox(c: CourseVisibilityFields): boolean {
  return c.scope === 'external' && c.status === 'sandbox';
}

/** Proposed / "test the waters" course (excluded from delivered rollups; what-if eligible). */
export function isProposed(c: CourseVisibilityFields): boolean {
  return c.status === 'proposed';
}

/**
 * SQL equivalent of isProgramVisible for raw queries. Assumes the courses table
 * is aliased `c` in the query (as in program-coverage-queries.ts). Keep this in
 * lockstep with isProgramVisible — they are the same rule in two forms.
 */
export const PROGRAM_VISIBLE_SQL = sql`c.scope = 'gc' AND c.status = 'offered'`;
```

- [ ] **Step 4: Run it — passes.**

Run: `pnpm exec vitest run tests/lib/courses/program-visibility.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/courses/program-visibility.ts tests/lib/courses/program-visibility.test.ts
git commit -m "feat(courses): isProgramVisible predicate + SQL fragment (single inclusion source)"
```

---

### Task 3: Public course list — expose scope/status, filter the public surface

**Files:**
- Modify: `lib/db/capture-status-queries.ts` (`CourseStatusRow` + the `.map` return, lines 8-21 and 85-97)
- Modify: `app/page.tsx` (filter rows before grouping)
- Test: `tests/app/public-list-visibility.test.ts`

`listCoursesWithStatus` must **return** `scope`/`status` on every row (so the faculty roster in Task 8 can section by them) — it does NOT filter internally. The public `/` page filters.

- [ ] **Step 1: Write the failing test** (the public surface excludes non-visible rows).

```ts
import { describe, it, expect } from 'vitest';
import { isProgramVisible } from '@/lib/courses/program-visibility';

// The public list rule is `rows.filter(isProgramVisible)`. This pins the contract
// that a sandbox/proposed row is dropped while a gc/offered row is kept.
describe('public course list visibility', () => {
  const rows = [
    { code: 'GC 1010', scope: 'gc', status: 'offered' },
    { code: 'GC 9999', scope: 'gc', status: 'proposed' },
    { code: 'XU 1010', scope: 'external', status: 'sandbox' },
  ] as Array<{ code: string; scope: 'gc'|'external'; status: 'offered'|'proposed'|'sandbox'|'retired' }>;
  it('keeps only gc/offered', () => {
    expect(rows.filter(isProgramVisible).map(r => r.code)).toEqual(['GC 1010']);
  });
});
```

- [ ] **Step 2: Run it — passes already** (predicate exists). This test guards the rule the page applies in Step 4; run to confirm green.

Run: `pnpm exec vitest run tests/app/public-list-visibility.test.ts`
Expected: PASS.

- [ ] **Step 3: Add `scope`/`status` to `CourseStatusRow`** (after `buildsToCareer`, `lib/db/capture-status-queries.ts:13`):

```ts
  scope: 'gc' | 'external';
  status: 'offered' | 'proposed' | 'sandbox' | 'retired';
```

and to the returned object (after `buildsToCareer: c.buildsToCareer,`, line 90):

```ts
    scope: c.scope,
    status: c.status,
```

- [ ] **Step 4: Filter the public page.** In `app/page.tsx`, where rows feed `groupByCategory`, filter first. Find the line that calls `groupByCategory(...)` on the `listCoursesWithStatus` result and wrap its input:

```ts
import { isProgramVisible } from '@/lib/courses/program-visibility';
// ...
const visibleRows = rows.filter(isProgramVisible);
const groups = groupByCategory(visibleRows);
```

(Replace the existing `groupByCategory(rows)` call; `rows` is whatever the page named the `listCoursesWithStatus()` result.)

- [ ] **Step 5: Type-check + run the test.**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run tests/app/public-list-visibility.test.ts`
Expected: clean + PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/db/capture-status-queries.ts app/page.tsx tests/app/public-list-visibility.test.ts
git commit -m "feat(roster): expose scope/status on status rows; public list shows only isProgramVisible"
```

---

### Task 4: Program coverage matrix isolation (raw SQL)

**Files:**
- Modify: `lib/db/program-coverage-queries.ts` (two `WHERE s.retired_at IS NULL AND c.builds_to_career = true` clauses, ~lines 116 and 238)
- Test: `tests/lib/db/program-coverage-scope.test.ts` (extend the existing `program-coverage-queries.test.ts` pattern)

- [ ] **Step 1: Append the predicate to both WHERE clauses.** In each of the two raw-SQL blocks, change:

```sql
WHERE s.retired_at IS NULL AND c.builds_to_career = true
```
to
```sql
WHERE s.retired_at IS NULL AND c.builds_to_career = true AND c.scope = 'gc' AND c.status = 'offered'
```

(Inline the literal SQL here rather than interpolating `PROGRAM_VISIBLE_SQL`, because these are already hand-written `sql\`\`` template strings keyed to the `c` alias; keep them self-evident. Add a comment: `-- scope/status: see lib/courses/program-visibility.ts`.)

- [ ] **Step 2: Write the leakage test** (model on the existing `tests/lib/db/program-coverage-queries.test.ts` setup — seed via the same helpers it uses).

```ts
// Seed two captured courses + snapshots: one gc/offered, one external/sandbox,
// both builds_to_career=true. Assert listStalePairs()/matrix excludes the sandbox.
// (Use the existing test's seeding helpers + test-db harness verbatim.)
it('excludes external/sandbox courses from the coverage matrix', async () => {
  // ...seed gcOffered (scope gc,status offered) + extSandbox (scope external,status sandbox)
  const pairs = await listStalePairs();
  const codes = pairs.map(p => p.courseCode);
  expect(codes).toContain('GC 1010');
  expect(codes).not.toContain('XU 1010');
});
```

- [ ] **Step 3: Run the test — passes** with the filter in place.

Run: `pnpm exec vitest run tests/lib/db/program-coverage-scope.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/db/program-coverage-queries.ts tests/lib/db/program-coverage-scope.test.ts
git commit -m "feat(program): exclude non-gc/non-offered courses from the coverage matrix"
```

---

### Task 5: Wiki compile isolation

**Files:**
- Modify: `lib/ai/wiki/update.ts` (the snapshot-selection query/queries that drive regeneration — the `courseCaptureSnapshots` reads filtered by `isNull(retiredAt)`)
- Test: `tests/lib/ai/wiki/wiki-scope.test.ts`

- [ ] **Step 1: Locate every snapshot-selection read** in `update.ts` (grep `courseCaptureSnapshots` in that file; there are several, each filtering `isNull(courseCaptureSnapshots.retiredAt)`).

- [ ] **Step 2: Join to `courses` and filter.** For each selection that pulls snapshots-to-compile, join the course and require visibility. With Drizzle:

```ts
import { eq, and, isNull } from 'drizzle-orm';
import { courses } from '@/lib/db/schema';
// ...
.from(courseCaptureSnapshots)
.innerJoin(courses, eq(courses.code, courseCaptureSnapshots.courseCode))
.where(and(
  isNull(courseCaptureSnapshots.retiredAt),
  eq(courses.scope, 'gc'),
  eq(courses.status, 'offered'),
))
```

(Apply the same `eq(courses.scope,'gc'), eq(courses.status,'offered')` guard to each snapshot-to-compile read. Reads that fetch a single snapshot by id for a known-GC course do not need it.)

- [ ] **Step 3: Write the test** — a sandbox course's snapshot is not included in the set the compiler iterates.

```ts
it('wiki compile excludes external/sandbox snapshots', async () => {
  // seed gc/offered + external/sandbox snapshots; call the selection fn used by update.ts
  // assert the sandbox course_code is absent from the to-compile set.
});
```

- [ ] **Step 4: Run + commit.**

Run: `pnpm exec vitest run tests/lib/ai/wiki/wiki-scope.test.ts` → PASS
```bash
git add lib/ai/wiki/update.ts tests/lib/ai/wiki/wiki-scope.test.ts
git commit -m "feat(wiki): exclude non-visible courses from wiki regeneration"
```

---

### Task 6: Scaffolding + prerequisite-gap isolation

**Files:**
- Modify: `lib/db/scaffolding-queries.ts` (the course/snapshot set it reads)
- Modify: the prereq-gap edge/course reads (`lib/program/prereq-gaps.ts` and any `prerequisite_edges`/course query feeding it)
- Test: `tests/lib/db/scaffolding-scope.test.ts`, `tests/lib/program/prereq-scope.test.ts`

- [ ] **Step 1: Scaffolding** — find the query selecting the course set / snapshots (it already filters `isNull(courseCaptureSnapshots.retiredAt)` per the schema grep). Add the same course join + `scope='gc' AND status='offered'` guard as Task 5 Step 2.

- [ ] **Step 2: Prereq-gap** — the focal and prerequisite course sets must both be visible. In the query that loads candidate courses/edges, join `courses` and require `isProgramVisible` on both endpoints (a sandbox course neither appears as a focal course nor as a prereq in GC analysis).

- [ ] **Step 3: Tests** — for each, seed a gc/offered + an external/sandbox course and assert the sandbox is excluded from the scaffolding cell set / prereq graph.

```ts
it('scaffolding excludes external/sandbox courses', async () => { /* seed + assert exclusion */ });
it('prereq-gap graph excludes external/sandbox courses (focal and prereq)', async () => { /* seed + assert */ });
```

- [ ] **Step 4: Run + commit.**

Run: `pnpm exec vitest run tests/lib/db/scaffolding-scope.test.ts tests/lib/program/prereq-scope.test.ts` → PASS
```bash
git add lib/db/scaffolding-queries.ts lib/program/prereq-gaps.ts tests/lib/db/scaffolding-scope.test.ts tests/lib/program/prereq-scope.test.ts
git commit -m "feat(program): exclude non-visible courses from scaffolding + prereq-gap"
```

---

### Task 7: `/view` and `/ask`+MCP isolation

**Files:**
- Modify: `app/view/[code]/page.tsx` (gate non-visible courses)
- Modify: `lib/ai/wiki/graph-tools.ts` (`coverage_for_target` / `prereq_chain` reads)
- Test: `tests/app/view-scope.test.ts`, `tests/lib/ai/wiki/graph-tools-scope.test.ts`

- [ ] **Step 1: `/view/[code]`** — after loading the course, if `!isProgramVisible(course)`, return Next's `notFound()` (a 404 for the public). The external-tester's scoped-session access to its own sandbox `/view` is added in the *external-access plan*; until then, sandbox `/view` is simply not public.

```ts
import { notFound } from 'next/navigation';
import { isProgramVisible } from '@/lib/courses/program-visibility';
// after the course row is fetched:
if (!course || !isProgramVisible(course)) notFound();
```

- [ ] **Step 2: graph-tools** — the `coverage_for_target` / `prereq_chain` reads (`getMatrixData()` / `listEdgePairs()`) inherit Task 4/6 filtering if they call those queries; if they read courses/snapshots directly, add the same `scope='gc' AND status='offered'` guard.

- [ ] **Step 3: Tests** — `/view` of a sandbox course is `notFound`; graph-tools omit sandbox courses.

```ts
it('/view of an external/sandbox course is notFound (not public)', async () => { /* assert notFound path */ });
it('graph-tools coverage/prereq omit external/sandbox courses', async () => { /* seed + assert */ });
```

- [ ] **Step 4: Run + commit.**

Run: `pnpm exec vitest run tests/app/view-scope.test.ts tests/lib/ai/wiki/graph-tools-scope.test.ts` → PASS
```bash
git add app/view/[code]/page.tsx lib/ai/wiki/graph-tools.ts tests/app/view-scope.test.ts tests/lib/ai/wiki/graph-tools-scope.test.ts
git commit -m "feat(view,ask): gate non-visible courses from /view + graph tools"
```

---

### Task 8: Faculty roster — segregated External / Proposed sections

**Files:**
- Modify: the faculty roster surface (`app/courses/CourseRosterControls.tsx` and/or `app/courses/page.tsx`) — wherever `listCoursesWithStatus` is rendered for faculty
- Create: `lib/courses/group-by-scope-status.ts` (pure grouping helper)
- Test: `tests/lib/courses/group-by-scope-status.test.ts`

- [ ] **Step 1: Write the failing test** for the grouping helper.

```ts
import { describe, it, expect } from 'vitest';
import { partitionRosterRows } from '@/lib/courses/group-by-scope-status';

const R = (code: string, scope: string, status: string) => ({ code, scope, status }) as any;

describe('partitionRosterRows', () => {
  it('splits rows into gc-visible, proposed, and external/sandbox buckets', () => {
    const out = partitionRosterRows([
      R('GC 1010', 'gc', 'offered'),
      R('GC 9999', 'gc', 'proposed'),
      R('XU 1010', 'external', 'sandbox'),
      R('GC 0001', 'gc', 'retired'),
    ]);
    expect(out.gc.map(r => r.code)).toEqual(['GC 1010']);
    expect(out.proposed.map(r => r.code)).toEqual(['GC 9999']);
    expect(out.external.map(r => r.code)).toEqual(['XU 1010']);
    // retired falls out of all three buckets (not shown by default)
  });
});
```

- [ ] **Step 2: Run — fails** (module missing).

- [ ] **Step 3: Implement the helper.**

```ts
import { isProgramVisible, isSandbox, isProposed, type CourseVisibilityFields } from '@/lib/courses/program-visibility';

export interface RosterPartition<T> { gc: T[]; proposed: T[]; external: T[]; }

/** Partition roster rows into the GC-visible set + the two segregated sections. */
export function partitionRosterRows<T extends CourseVisibilityFields>(rows: T[]): RosterPartition<T> {
  return {
    gc: rows.filter(isProgramVisible),
    proposed: rows.filter(r => isProposed(r) && r.scope === 'gc'),
    external: rows.filter(isSandbox),
  };
}
```

- [ ] **Step 4: Run — passes.**

- [ ] **Step 5: Render the sections.** In the faculty roster component, partition the rows and render the GC roster as today, then — only when non-empty — an **"External / sandbox"** section and a **"Proposed"** section below it, each row carrying a small status badge (reuse the roster `StatusPill` styling vocabulary already in `app/page.tsx`).

- [ ] **Step 6: Type-check + commit.**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run tests/lib/courses/group-by-scope-status.test.ts` → clean + PASS
```bash
git add lib/courses/group-by-scope-status.ts app/courses/ tests/lib/courses/group-by-scope-status.test.ts
git commit -m "feat(roster): segregated External/sandbox + Proposed sections in the faculty roster"
```

---

### Task 9: Full-suite regression + leakage sweep

**Files:** none (verification)

- [ ] **Step 1: Run the whole suite.**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: green. If any pre-existing test seeds courses and asserts they appear in a rollup, confirm those seeds default to `gc/offered` (they will, via the column defaults) so they remain included.

- [ ] **Step 2: Grep for un-audited course/snapshot reads.** Confirm no rollup was missed:

Run: `grep -rln "from(courseCaptureSnapshots)\|from(courses)\|FROM courses\|courseCaptureSnapshots} s" lib app | grep -v test`
Expected: every hit is either (a) covered by Tasks 3–7, (b) a single-id fetch for a known course, or (c) a write path. Note any newly-discovered rollup read and add a guard + test before finishing.

- [ ] **Step 3: Commit any stragglers, then finish the branch** (use superpowers:finishing-a-development-branch).

---

## Self-review

**Spec coverage:** §1/§2 schema → Task 1. §3 predicate + the 7-row rollup audit → Tasks 2 (predicate) + 3 (public list) + 4 (matrix) + 5 (wiki) + 6 (scaffolding, prereq) + 7 (/view, /ask+MCP). §5 roster surfacing → Task 8. §6 testing → per-task tests + Task 9 sweep. §4 external-tester access is **explicitly out of scope** (its own plan) — noted in the header. ✓

**Placeholder scan:** Task 5/6/7 test bodies are sketched against "the existing test harness/seed helpers" rather than fully spelled out, because the DB-test seeding helpers are harness-specific (the implementer must mirror `tests/lib/db/program-coverage-queries.test.ts`). This is a known soft spot: the *assertions* are exact (sandbox excluded, gc/offered included); the *seeding* reuses the established pattern. Flagged here rather than inventing a harness that may not match.

**Type consistency:** `scope: 'gc' | 'external'` and `status: 'offered' | 'proposed' | 'sandbox' | 'retired'` are identical across schema (Task 1), `CourseStatusRow` (Task 3), `CourseVisibilityFields` (Task 2), and the grouping helper (Task 8). `isProgramVisible` / `isSandbox` / `isProposed` signatures are stable from Task 2 onward.
