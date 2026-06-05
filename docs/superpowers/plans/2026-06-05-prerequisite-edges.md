# Persisted Skill-Tagged Prerequisite Edges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Q2 (do a course's prerequisites support what it expects?) computable program-wide by persisting **direct, skill-tagged** course→course prerequisite edges, seeding them from the existing free-text `courses.prerequisites`, letting faculty confirm/edit them, and computing per-sub-competency gaps deterministically against each direct prereq's measured attainment.

**Architecture:** New `prerequisite_edges` table (migration 0030) holds direct edges `(focalCourse → prereqCourse, subCompetency, expected k/u/d)`. An LLM seeder proposes edges from prose + incoming-expectations; faculty confirm. `computePrereqGaps(courseCode)` differences the focal course's incoming need against each direct prereq's measured `snapshotTargetCoverage` attainment using **ordinal-MAX** aggregation (no sum, no double-count); transitivity is derived by traversal, never authored. The `/courses` list gains a data-state badge + bulk preload + add-a-class so the roster exists for edges to resolve. Reuses `incomingExpectationSchema`, `snapshotTargetCoverage`, `analyzeCourseGaps`, `PrerequisiteGapPanel`.

**Tech stack:** Existing — Next.js 15 App Router, Drizzle + local Postgres 17, Vitest, Vercel AI SDK structured output, the slug-gated admin pattern, the strict-mode JSON-schema + walker-test discipline.

**Design:** [`docs/superpowers/specs/2026-06-05-prerequisite-edges-design.md`](../specs/2026-06-05-prerequisite-edges-design.md). Read it first — the no-double-count invariants and the `measured`/`intended`/`no_data` `basis` model are load-bearing.

---

## Scope notes for the executor

- **`intended` band is OUT of this plan** — it's the separate rough-pass increment. But the gap engine + types must already carry `basis: 'measured' | 'intended' | 'none'` so the rough pass plugs in with no engine change. Pre-rough-pass, `delivered` only ever resolves to `measured` or `none`; the `intended` branch is present but yields nothing yet.
- **Program-wide rollup / graph viz is OUT** — keep `computePrereqGaps(courseCode)` a clean per-course function the future program view can `map` over.
- **Don't start on `main`** — create branch `feat/prerequisite-edges` first.

---

## File structure

**Schema / DB:**
- Modify `lib/db/schema.ts` — add `prerequisiteEdges` table.
- Create `drizzle/0030_<auto>.sql` (generated).
- Create `lib/db/prerequisite-edge-queries.ts` — edge CRUD + cycle check + distinct pairs.
- Create `lib/db/course-roster-queries.ts` — data-state, bulk create, single create. (Or extend the existing course-queries module if one exists — verify.)

**AI:**
- Create `lib/ai/analyze/prereq-edge-seed.ts` — `SeededEdges` Zod + strict JSON schema + `seedPrereqEdges(focalCourse)`.
- Create `lib/ai/prompts/prereq-edge-seed.md`.
- Modify `lib/ai/function-settings.ts` (+`prereq-edge-seed`, default tier) and `lib/ai/prompts/load.ts` (PromptName union).

**Engine:**
- Create `lib/program/prereq-gaps.ts` — `computePrereqGaps(courseCode)` (deterministic, `basis`, MAX).

**API (slug-gated admin):**
- Create `app/api/admin/courses/roster/route.ts` — POST bulk-preload, POST add-one (or two routes).
- Create `app/api/admin/courses/[code]/prereq-edges/route.ts` — GET (list for focal), POST (seed), PATCH (confirm/edit), DELETE.

**UI:**
- Modify the `/courses` list page + add a roster client component (data-state badge, bulk-preload modal, add-class form).
- Create the per-course prerequisite-edges confirm/edit admin view + gap view (reusing `PrerequisiteGapPanel`).

**Docs / HTML:**
- Modify `docs/STATE.md`, `docs/superpowers/README.md`, `docs/background.html`, `docs/using-coursecapture-and-explore.html` (+ audit other background HTML).

---

## Task 1: Migration 0030 — `prerequisite_edges` table

**Files:** Modify `lib/db/schema.ts`; Create `drizzle/0030_*.sql`.

- [ ] **Step 1: Add the table to `lib/db/schema.ts`** (confirm `unique`, `index`, `integer`, `boolean` are imported):

```typescript
/**
 * Direct, skill-tagged course→course prerequisite edges. One row per
 * (focalCourse, prereqCourse, subCompetency) the focal course relies on.
 * Edges are DIRECT only; transitivity is derived by traversal, never authored.
 * Migration 0030. Design: docs/superpowers/specs/2026-06-05-prerequisite-edges-design.md
 */
export const prerequisiteEdges = pgTable('prerequisite_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  focalCourseCode: text('focal_course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  prereqCourseCode: text('prereq_course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  subCompetencyId: text('sub_competency_id').notNull().references(() => subCompetencies.id, { onDelete: 'cascade' }),
  expectedK: integer('expected_k'),       // depth the focal course relies on incoming; nullable per dim
  expectedU: integer('expected_u'),
  expectedD: integer('expected_d'),
  source: text('source').notNull(),                                  // 'llm_seed' | 'faculty'
  confidence: text('confidence').notNull(),                          // 'high' | 'medium' | 'low'
  confirmed: boolean('confirmed').notNull().default(false),
  rationale: text('rationale').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniq: unique('uq_prerequisite_edges_focal_prereq_subcomp').on(t.focalCourseCode, t.prereqCourseCode, t.subCompetencyId),
  focalIdx: index('idx_prerequisite_edges_focal').on(t.focalCourseCode),
  prereqIdx: index('idx_prerequisite_edges_prereq').on(t.prereqCourseCode),
}));
```

- [ ] **Step 2: Generate** — `pnpm db:generate`; inspect `drizzle/0030_*.sql` (must be a pure `CREATE TABLE` + indexes + FKs + unique; no DROP of any existing table). If it proposes anything destructive, STOP and report.

- [ ] **Step 3: Apply** — `set -a; source .env.local; set +a; pnpm db:migrate 2>&1 | tail -5` → "migrations applied successfully!"

- [ ] **Step 4: Verify** — `psql ... -c "\d prerequisite_edges"` shows the columns, the unique constraint, both indexes, and the three FKs.

- [ ] **Step 5: Commit** — `git add lib/db/schema.ts drizzle/0030_*.sql` → `feat(schema): 0030 — prerequisite_edges (direct skill-tagged edges)`.

---

## Task 2: Edge queries — `lib/db/prerequisite-edge-queries.ts`

**Files:** Create `lib/db/prerequisite-edge-queries.ts`; Create `tests/db/prerequisite-edge-queries.test.ts`.

- [ ] **Step 1: Write the failing test** (`tests/db/prerequisite-edge-queries.test.ts`) — these run against the local test DB (follow the pattern of an existing `tests/db/*.test.ts`; if DB tests are mocked in this repo, match that style). Cover: `upsertSeededEdges` is idempotent on the unique key; `listEdgesForFocal` returns rows grouped-friendly; `confirmEdge` flips `confirmed=true, source='faculty', confidence='high'`; `wouldCreateCycle('A','B')` returns true when B→…→A already exists; a write where `focal === prereq` throws.

- [ ] **Step 2: Implement** `lib/db/prerequisite-edge-queries.ts`:

```typescript
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { prerequisiteEdges } from '@/lib/db/schema';

export interface PrereqEdgeRow {
  id: string;
  focalCourseCode: string;
  prereqCourseCode: string;
  subCompetencyId: string;
  expectedK: number | null;
  expectedU: number | null;
  expectedD: number | null;
  source: 'llm_seed' | 'faculty';
  confidence: 'high' | 'medium' | 'low';
  confirmed: boolean;
  rationale: string;
}

export interface SeedEdgeInput {
  focalCourseCode: string;
  prereqCourseCode: string;
  subCompetencyId: string;
  expectedK: number | null;
  expectedU: number | null;
  expectedD: number | null;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

/** Idempotent insert of seeded edges. On the unique key, refresh the seed
 *  fields but NEVER downgrade a faculty-confirmed row (confirmed rows are skipped). */
export async function upsertSeededEdges(edges: SeedEdgeInput[]): Promise<{ inserted: number; skippedConfirmed: number }> {
  if (edges.length === 0) return { inserted: 0, skippedConfirmed: 0 };
  for (const e of edges) {
    if (e.focalCourseCode === e.prereqCourseCode) {
      throw new Error(`prerequisite edge cannot be self-referential: ${e.focalCourseCode}`);
    }
  }
  let inserted = 0; let skippedConfirmed = 0;
  for (const e of edges) {
    const res = await db.insert(prerequisiteEdges).values({
      focalCourseCode: e.focalCourseCode,
      prereqCourseCode: e.prereqCourseCode,
      subCompetencyId: e.subCompetencyId,
      expectedK: e.expectedK, expectedU: e.expectedU, expectedD: e.expectedD,
      source: 'llm_seed', confidence: e.confidence, confirmed: false, rationale: e.rationale,
    }).onConflictDoUpdate({
      target: [prerequisiteEdges.focalCourseCode, prerequisiteEdges.prereqCourseCode, prerequisiteEdges.subCompetencyId],
      // Only refresh rows that are NOT faculty-confirmed (don't clobber human edits).
      set: { expectedK: e.expectedK, expectedU: e.expectedU, expectedD: e.expectedD, confidence: e.confidence, rationale: e.rationale, updatedAt: sql`now()` },
      setWhere: eq(prerequisiteEdges.confirmed, false),
    }).returning({ id: prerequisiteEdges.id });
    if (res.length > 0) inserted += 1; else skippedConfirmed += 1;
  }
  return { inserted, skippedConfirmed };
}

export async function listEdgesForFocal(focalCourseCode: string): Promise<PrereqEdgeRow[]> {
  const rows = await db.select().from(prerequisiteEdges)
    .where(eq(prerequisiteEdges.focalCourseCode, focalCourseCode));
  return rows as PrereqEdgeRow[];
}

/** All distinct (focal → prereq) structural pairs — for traversal / program views. */
export async function listEdgePairs(): Promise<Array<{ focal: string; prereq: string }>> {
  const rows = await db.selectDistinct({ focal: prerequisiteEdges.focalCourseCode, prereq: prerequisiteEdges.prereqCourseCode })
    .from(prerequisiteEdges);
  return rows.map(r => ({ focal: r.focal, prereq: r.prereq }));
}

export interface UpdateEdgeInput {
  id: string;
  expectedK?: number | null;
  expectedU?: number | null;
  expectedD?: number | null;
  confirmed?: boolean;
}

export async function updateEdge(input: UpdateEdgeInput): Promise<void> {
  await db.update(prerequisiteEdges).set({
    ...(input.expectedK !== undefined && { expectedK: input.expectedK }),
    ...(input.expectedU !== undefined && { expectedU: input.expectedU }),
    ...(input.expectedD !== undefined && { expectedD: input.expectedD }),
    ...(input.confirmed !== undefined && { confirmed: input.confirmed, source: 'faculty', confidence: 'high' }),
    updatedAt: sql`now()`,
  }).where(eq(prerequisiteEdges.id, input.id));
}

export async function deleteEdge(id: string): Promise<void> {
  await db.delete(prerequisiteEdges).where(eq(prerequisiteEdges.id, id));
}

export async function addFacultyEdge(input: SeedEdgeInput): Promise<{ id: string }> {
  if (input.focalCourseCode === input.prereqCourseCode) throw new Error('self-referential prerequisite edge');
  if (await wouldCreateCycle(input.focalCourseCode, input.prereqCourseCode)) {
    throw new Error(`adding ${input.prereqCourseCode} as a prereq of ${input.focalCourseCode} would create a cycle`);
  }
  const [row] = await db.insert(prerequisiteEdges).values({
    ...input, source: 'faculty', confirmed: true, confidence: 'high',
  }).onConflictDoUpdate({
    target: [prerequisiteEdges.focalCourseCode, prerequisiteEdges.prereqCourseCode, prerequisiteEdges.subCompetencyId],
    set: { expectedK: input.expectedK, expectedU: input.expectedU, expectedD: input.expectedD, confirmed: true, source: 'faculty', confidence: 'high', rationale: input.rationale, updatedAt: sql`now()` },
  }).returning({ id: prerequisiteEdges.id });
  return row!;
}

/** True if making `prereq` a prerequisite of `focal` would create a cycle —
 *  i.e. `focal` is already reachable from `prereq` by walking prereq→…. DAG BFS with a visited set. */
export async function wouldCreateCycle(focal: string, prereq: string): Promise<boolean> {
  if (focal === prereq) return true;
  const pairs = await listEdgePairs();
  const adj = new Map<string, string[]>();
  for (const { focal: f, prereq: p } of pairs) {
    if (!adj.has(f)) adj.set(f, []);
    adj.get(f)!.push(p);
  }
  // Walk prereq's own prerequisites transitively; if we reach `focal`, a cycle would form.
  const seen = new Set<string>();
  const stack = [prereq];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === focal) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}
```

- [ ] **Step 3: Run tests** → green. **Step 4: Commit** `feat(db): prerequisite-edge-queries (CRUD + idempotent seed upsert + cycle guard)`.

---

## Task 3: Course-roster queries — data-state, bulk create, single create

**Files:** Create `lib/db/course-roster-queries.ts` (or extend the existing course-queries module — VERIFY whether one exists, e.g. `lib/db/course-queries.ts`, and prefer extending it); Create the matching test.

- [ ] **Step 1: Failing test** — `getCourseDataStates()` returns one entry per course with `state: 'measured' | 'no-data'` (`measured` iff ≥1 `courseCaptureSnapshots` row for the code); `bulkCreateCourses` is idempotent (existing codes skipped + reported); `createCourse` inserts one.

- [ ] **Step 2: Implement** (verify the real `courses` columns from schema — `code` PK, `title`, `level`, `track`, `description`, `prerequisites`, etc.; provide sensible defaults for required cols on bulk-create):

```typescript
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots } from '@/lib/db/schema';

export type CourseDataState = 'measured' | 'intended' | 'no-data';

export interface CourseRosterRow {
  code: string;
  title: string;
  level: number;
  prerequisites: string;
  dataState: CourseDataState;   // 'intended' reserved for the rough-pass increment; not produced here yet
}

/** One row per course with its capture data-state. 'measured' iff a snapshot exists. */
export async function getCourseDataStates(): Promise<CourseRosterRow[]> {
  const rows = await db.execute(sql`
    SELECT c.code, c.title, c.level, c.prerequisites,
      CASE WHEN EXISTS (SELECT 1 FROM course_capture_snapshots s WHERE s.course_code = c.code)
           THEN 'measured' ELSE 'no-data' END AS data_state
    FROM courses c
    ORDER BY c.level, c.code
  `);
  return rows.rows.map((r: any) => ({
    code: r.code, title: r.title, level: r.level, prerequisites: r.prerequisites, dataState: r.data_state as CourseDataState,
  }));
}

export interface NewCourseInput { code: string; title: string; level?: number; track?: string; prerequisites?: string; }

/** Idempotent: inserts only codes that don't already exist; returns created + skipped codes. */
export async function bulkCreateCourses(items: NewCourseInput[]): Promise<{ created: string[]; skipped: string[] }> {
  const codes = items.map(i => i.code.trim()).filter(Boolean);
  if (codes.length === 0) return { created: [], skipped: [] };
  const existing = await db.select({ code: courses.code }).from(courses).where(inArray(courses.code, codes));
  const have = new Set(existing.map(e => e.code));
  const toCreate = items.filter(i => !have.has(i.code.trim()));
  for (const i of toCreate) {
    await db.insert(courses).values({
      code: i.code.trim(), title: i.title?.trim() || i.code.trim(),
      level: i.level ?? 0, track: i.track ?? 'unspecified', prerequisites: i.prerequisites ?? '',
    }).onConflictDoNothing();
  }
  return { created: toCreate.map(i => i.code.trim()), skipped: codes.filter(c => have.has(c)) };
}

export async function createCourse(input: NewCourseInput): Promise<void> {
  await db.insert(courses).values({
    code: input.code.trim(), title: input.title.trim(),
    level: input.level ?? 0, track: input.track ?? 'unspecified', prerequisites: input.prerequisites ?? '',
  }).onConflictDoNothing();
}

export async function courseExists(code: string): Promise<boolean> {
  const [row] = await db.select({ code: courses.code }).from(courses).where(eq(courses.code, code)).limit(1);
  return !!row;
}
```

- [ ] **Step 3: tests green. Step 4: Commit** `feat(db): course-roster queries (data-state, bulk + single create)`.

---

## Task 4: `prereq-edge-seed` AI function

**Files:** Create `lib/ai/prompts/prereq-edge-seed.md`, `lib/ai/analyze/prereq-edge-seed.ts`, `tests/ai/prereq-edge-seed-schema.test.ts`; Modify `lib/ai/function-settings.ts`, `lib/ai/prompts/load.ts`.

- [ ] **Step 1: Register the function** — in `function-settings.ts` add `'prereq-edge-seed': 'default'` (with a rationale comment; structured extraction over prose + the sub-competency catalog). Add to `AI_FUNCTION_IDS` + labels/descriptions if those records exist (count 19→20). Add `'prereq-edge-seed'` to the `PromptName` union in `prompts/load.ts`.

- [ ] **Step 2: Prompt** (`lib/ai/prompts/prereq-edge-seed.md`, frontmatter `name: prereq-edge-seed`, `includes: shared/depth-scale.md`): instruct — given a focal course's free-text `prerequisites`, its incoming-expectation statements, and the catalog sub-competencies (each with id + name + K/U/D descriptors), emit proposed **direct** skill-tagged edges: for each prerequisite course code mentioned in the prose, propose which `sub_competency_id`s the focal course relies on it for + the `expected_k/u/d` (the depth needed *incoming*, grounded in the incoming-expectation statements), a `confidence`, and a one-line `rationale` quoting the evidence. Hard rules: only emit prereq course codes literally present in the prose; never invent codes; depths anchored to the depth scale; if no incoming-expectation evidence for a tag, set the relied dims it can justify and lower `confidence`; emit `[]` if the prose lists no course codes.

- [ ] **Step 3: Schema + runner** (`lib/ai/analyze/prereq-edge-seed.ts`) — `SeededEdges` Zod: `{ edges: Array<{ prereq_course_code: string; sub_competency_id: string; expected_k: int|null; expected_u: int|null; expected_d: int|null; confidence: 'high'|'medium'|'low'; rationale: string }> }`. Matching **strict-mode** `seededEdgesJsonSchema` (every property in `required`; nullable ints as `['integer','null']`; `additionalProperties:false`). `seedPrereqEdges(input: { focalCourseCode, prerequisitesText, incomingExpectations, subCompetencies })` calls `provider.complete` (the verified contract: `{systemPrompt,userMessage,schemaName,jsonSchema,validate}` → `{data,...}`), returns `{ edges, model, costUsdCents, durationMs }`. The route (Task 6) validates each `prereq_course_code` against `courses.code` and maps to `SeedEdgeInput` (dropping unmatched → reported as "unknown course").

- [ ] **Step 4: Strict-mode walker test** (`tests/ai/prereq-edge-seed-schema.test.ts`) — reuse the shared `assertStrictMode` walker (extracted in the PC v1 FixF; import or re-extract) on `seededEdgesJsonSchema`; plus a Zod accept/reject case.

- [ ] **Step 5: Typecheck + commit** `feat(ai): prereq-edge-seed function (prompt + runner + strict schema + walker test)`.

---

## Task 5: `computePrereqGaps` engine + no-double-count invariant tests (THE HEART)

**Files:** Create `lib/program/prereq-gaps.ts`; Create `tests/program/prereq-gaps.test.ts`.

This task is pure + deterministic and must be fully TDD'd. The three invariant tests are mandatory.

- [ ] **Step 1: Types + the failing invariant tests first** (`tests/program/prereq-gaps.test.ts`). Use the pure inner function `computeGapsFromInputs(...)` (below) so the tests need no DB. Required cases:
  1. **diamond:** focal F relies on sub-comp X; edges F→B and F→C (and separately B→A, C→A — irrelevant to the direct gap). B delivers X@D2 (measured), C delivers X@D3 (measured), F needs X@D3 → `delivered = MAX(2,3)=3`, gap 0, status `met`. Adding a redundant direct edge F→A where A delivers X@D1 must NOT change the result (still MAX=3).
  2. **duplicate skill-tag:** two edges F→B and F→C both tag X; F needs X@{d:3}; B@d2, C@d3 → MAX=3, met. Assert the result is identical whether C's edge is present once or (illegally-but-defensively) duplicated in the input array.
  3. **redundant direct+transitive:** F→B (B delivers X@d3) plus a redundant F→A direct edge (A delivers X@d3) → gap result byte-identical to F→B alone.
  Plus: `no_data` (a relied prereq has no attainment for X → status `no_data`, `basis:'none'`, gap not asserted); `basis:'measured'` when measured exists; `gap` when needed>delivered on a dim.

- [ ] **Step 2: Implement** `lib/program/prereq-gaps.ts`:

```typescript
export type GapBasis = 'measured' | 'intended' | 'none';
export type GapStatus = 'met' | 'gap' | 'no_data';

export interface DeliveredAttainment {     // per (prereqCourse, subCompetency)
  prereqCourseCode: string;
  subCompetencyId: string;
  k: number | null; u: number | null; d: number | null;
  basis: 'measured' | 'intended';          // where it came from
}

export interface RelyEdge {                  // a confirmed edge the focal course relies on
  prereqCourseCode: string;
  subCompetencyId: string;
  expectedK: number | null; expectedU: number | null; expectedD: number | null;
}

export interface SubCompetencyGap {
  subCompetencyId: string;
  needed: { k: number | null; u: number | null; d: number | null };
  delivered: { k: number | null; u: number | null; d: number | null };
  gap: { k: number; u: number; d: number };   // max(0, needed-delivered) per dim; 0 when needed null
  status: GapStatus;
  basis: GapBasis;
  contributingPrereqs: string[];               // which prereq courses were considered (deduped)
}

const maxN = (a: number | null, b: number | null): number | null =>
  a == null ? b : b == null ? a : Math.max(a, b);
const gapDim = (need: number | null, got: number | null): number =>
  need == null ? 0 : Math.max(0, need - (got ?? 0));

/** Pure core: edges the focal course relies on + the available delivered attainment.
 *  Ordinal MAX aggregation — no sum, redundant edges/dupe tags collapse. measured beats intended. */
export function computeGapsFromInputs(edges: RelyEdge[], delivered: DeliveredAttainment[]): SubCompetencyGap[] {
  const bySub = new Map<string, RelyEdge[]>();
  for (const e of edges) {
    if (!bySub.has(e.subCompetencyId)) bySub.set(e.subCompetencyId, []);
    bySub.get(e.subCompetencyId)!.push(e);
  }
  const out: SubCompetencyGap[] = [];
  for (const [subId, subEdges] of bySub) {
    // needed = MAX of expected across edges for this sub-comp (consistent if multiple prereqs tag it)
    const needed = {
      k: subEdges.reduce<number | null>((m, e) => maxN(m, e.expectedK), null),
      u: subEdges.reduce<number | null>((m, e) => maxN(m, e.expectedU), null),
      d: subEdges.reduce<number | null>((m, e) => maxN(m, e.expectedD), null),
    };
    const reliedPrereqs = Array.from(new Set(subEdges.map(e => e.prereqCourseCode)));
    // delivered = MAX across the relied prereqs' attainment of this sub-comp; measured wins over intended.
    const relevant = delivered.filter(d => d.subCompetencyId === subId && reliedPrereqs.includes(d.prereqCourseCode));
    const hasMeasured = relevant.some(d => d.basis === 'measured');
    const pool = hasMeasured ? relevant.filter(d => d.basis === 'measured') : relevant;
    let basis: GapBasis;
    let delivD = { k: null as number | null, u: null as number | null, d: null as number | null };
    if (pool.length === 0) { basis = 'none'; }
    else {
      basis = hasMeasured ? 'measured' : 'intended';
      delivD = {
        k: pool.reduce<number | null>((m, d) => maxN(m, d.k), null),
        u: pool.reduce<number | null>((m, d) => maxN(m, d.u), null),
        d: pool.reduce<number | null>((m, d) => maxN(m, d.d), null),
      };
    }
    const gap = { k: gapDim(needed.k, delivD.k), u: gapDim(needed.u, delivD.u), d: gapDim(needed.d, delivD.d) };
    const status: GapStatus = basis === 'none' ? 'no_data' : (gap.k + gap.u + gap.d > 0 ? 'gap' : 'met');
    out.push({ subCompetencyId: subId, needed, delivered: delivD, gap, status, basis, contributingPrereqs: reliedPrereqs });
  }
  return out;
}
```

- [ ] **Step 3: The DB-backed wrapper** `computePrereqGaps(focalCourseCode)`:
  - `listEdgesForFocal(focalCourseCode)` → keep only `confirmed` edges → map to `RelyEdge[]`.
  - For each distinct relied `(prereqCourseCode, subCompetencyId)`: resolve the prereq course's **latest** `courseCaptureSnapshots` row, then its `snapshotTargetCoverage` row for `(subComp's target, subComp)` → `DeliveredAttainment` with `basis:'measured'` (kDepth/uDepth/dDepth). No row → contributes nothing (→ `no_data`). (The `intended` source is wired in by the rough-pass increment; leave a clearly-commented seam.)
  - Return `computeGapsFromInputs(edges, delivered)` + the focal course code. **Does not traverse the chain** (direct edges only). Add a comment pointing at the deferred traversal for program-wide diagnostics.

- [ ] **Step 4: Run tests** → all green, especially the three invariant tests. **Step 5: Commit** `feat(program): computePrereqGaps — deterministic ordinal-MAX gap engine + no-double-count tests`.

---

## Task 6: API routes (slug-gated admin)

**Files:** Create `app/api/admin/courses/roster/route.ts`; Create `app/api/admin/courses/[code]/prereq-edges/route.ts`. Match the existing admin slug-auth pattern (`isValidSlug(?slug)`; read an existing admin route for the exact shape).

- [ ] **roster route** — `POST ?slug=` with `{ mode: 'bulk', text: string }` (parse lines `CODE` or `CODE — Title` → `bulkCreateCourses`, return `{created, skipped}`) OR `{ mode: 'one', code, title, level?, track? }` → `createCourse`. 400 on bad input.
- [ ] **prereq-edges route** — `GET ?slug=` → `{ edges: listEdgesForFocal(code), unknownPrereqs: [...] }` where `unknownPrereqs` are prereq codes appearing on edges (or parsed from the prose) that aren't in `courses`. `POST ?slug=&mode=seed` → load focal course's `prerequisites` + incoming-expectations + sub-competencies, call `seedPrereqEdges`, validate `prereq_course_code`s against `courses.code` (collect unmatched → `unknownPrereqs`), `upsertSeededEdges` the matched ones, return `{ inserted, skippedConfirmed, unknownPrereqs }`. Cost-gate with `checkDailyCap` + `recordSpend` (it's an AI call). `PATCH ?slug=` `{ id, expected_k?, expected_u?, expected_d?, confirmed? }` → `updateEdge`. `DELETE ?slug=&id=` → `deleteEdge`. An add-faculty-edge action (`POST mode=add`) → `addFacultyEdge` (cycle-guarded → 409 on cycle).
- [ ] **Typecheck + commit** `feat(api): admin course-roster + prereq-edge routes (seed/confirm/edit/delete)`.

---

## Task 7: `/courses` roster surface

**Files:** Modify the `/courses` list page + add a client component. VERIFY the current `/courses` page path + structure first (likely `app/courses/page.tsx`).

- [ ] Render `getCourseDataStates()` → a **data-state badge** per course (`measured` = solid, `no-data` = muted/outline; leave an `intended` style stub for the rough-pass increment).
- [ ] A **"Preload courses"** control (textarea → POST roster `mode:'bulk'`) showing `created`/`skipped` counts on success.
- [ ] An **"Add a course"** mini-form (POST roster `mode:'one'`).
- [ ] Each course links to its **prerequisite-edges view** (Task 8). Match existing Tailwind/shadcn conventions; keep it server-rendered + small client islands like the rest of the app.
- [ ] **Commit** `feat(courses): roster surface — data-state badges + bulk preload + add-a-class`.

---

## Task 8: Per-course prereq-edge confirm/edit + gap view

**Files:** Create the admin view under the course detail (verify the existing course-detail route; add a "Prerequisites" section/tab) + a client component; reuse `PrerequisiteGapPanel`.

- [ ] **Seed + confirm/edit:** a "Seed from syllabus prerequisites" button (POST `mode:seed`) → renders edges grouped by prereq course with editable `expected_k/u/d`, a confirm toggle, add-skill-tag, delete. Unmatched prereq codes render as **"unknown course `<code>` — add it"** linking to the roster add-flow. A cycle-creating add surfaces the 409 message inline.
- [ ] **Gap view:** call `computePrereqGaps(code)` (server) → feed the existing `PrerequisiteGapPanel` (adapt the prop shape; reuse its rendering). A `basis:'intended'` row is visibly tagged "syllabus-promise, not verified"; `no_data` rows show "prereq not yet captured". Optionally wire the existing `analyzeCourseGaps` for a narrative block (reuse, don't rebuild).
- [ ] **Commit** `feat(courses): per-course prerequisite-edge confirm/edit + deterministic gap view`.

---

## Task 9: Docs + background HTML

**Files:** Modify `docs/STATE.md`, `docs/superpowers/README.md`, `docs/background.html`, `docs/using-coursecapture-and-explore.html` (+ audit other background HTML).

- [ ] **STATE.md** — add `prerequisite_edges` to the schema table + migration 0030; add `prereq-edge-seed` to the AI-function tier table (count 19→20); add the `/courses` roster surface + the per-course prereq routes to the surfaces list; flip the spec row "spec'd → **shipped**"; bump Last-verified SHA + date.
- [ ] **README.md** — add the plan row (Done).
- [ ] **background.html** (methodology companion) — add a section on the **prerequisite-gap method**: direct skill-tagged edges, ordinal-MAX (no double-count), and the **intended-vs-attained** distinction with `intended` as the evidence-ladder `claimed` band (why a syllabus promise is not a verified attainment). Hand-edit the HTML (no md→html generator).
- [ ] **using-coursecapture-and-explore.html** (faculty walkthrough) — add the roster bulk-preload/add-class flow, the data-state badges, and the per-course prerequisite-gap view + confirm/edit step.
- [ ] **Audit** `grep -l 'prerequisite\|/courses\|coverage' docs/*.html` and update any other page that describes the course list / prerequisites / coverage method for consistency.
- [ ] **Commit** `docs: prerequisite-edges shipped — STATE/README + background.html method + walkthrough`.

---

## Final review

After all tasks: full `tsc` (0) + full `pnpm vitest run` green, then a final whole-branch review (the same adversarial pattern used for PC v1 is appropriate given the no-double-count invariants), then `superpowers:finishing-a-development-branch`.

---

## Self-review checklist (author)

- ✅ **Spec coverage:** edges table (T1), seed (T4), confirm/edit (T8), deterministic MAX gap engine + 3 invariant tests (T5), roster surface w/ data-state + bulk-preload + add-class + unknown-course (T3/T6/T7), docs + background HTML (T9), `basis` carries the `intended` seam for the rough-pass increment without engine change.
- ✅ **No placeholders:** load-bearing code (schema, queries, engine, seed schema) is complete; UI/API tasks carry precise specs + the verified `provider.complete` contract, matching this repo's plan style (implementers verify integration points).
- ✅ **Type consistency:** `prerequisiteEdges`, `PrereqEdgeRow`, `SeedEdgeInput`, `computePrereqGaps`/`computeGapsFromInputs`, `SubCompetencyGap`, `GapBasis`/`GapStatus`, `getCourseDataStates`, `bulkCreateCourses`, `wouldCreateCycle` — spelled identically across tasks.
- ✅ **Invariants:** unique constraint (T1), idempotent seed upsert (T2), ordinal-MAX + dedupe + the three regression tests (T5), cycle guard (T2 + T8 409), `no_data`/`basis` honesty (T5).
