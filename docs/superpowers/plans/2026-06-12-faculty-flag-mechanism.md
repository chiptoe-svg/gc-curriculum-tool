# Faculty Flag Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faculty can flag any AI reading (program-matrix cell or review-panel competency) with a note; flags persist across re-scores/re-captures, stay open until explicitly resolved with a named note, and surface on the flagged item plus a roll-up panel on `/program`.

**Architecture:** One polymorphic `faculty_flags` table keyed by stable identifiers — `(course_code, career_target_id, sub_competency_id)` for cell flags, `(course_code, competency_statement)` for profile flags — never by snapshot/cell rows (those are overwritten on re-score). Pure match/drift logic in `lib/program/flags.ts`; thin Drizzle queries; three slug-gated routes; UI reuses the orphaned `FlagDialog`. The disputed reading is frozen as `flagged_context` jsonb so "was D=4 → now D=2" drift is computable at read time.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle + Postgres 17 (local :5433), Zod, Vitest + @testing-library/react (jsdom), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-12-faculty-flag-mechanism-design.md`

**File map:**
- Create: `lib/program/flags.ts` (pure logic) + `tests/lib/program/flags.test.ts`
- Create: `lib/db/flag-queries.ts` + `tests/lib/db/flag-queries.test.ts`
- Create: `app/api/flags/route.ts` (POST create, GET list), `app/api/flags/[id]/route.ts` (PATCH resolve) + `tests/app/api/flags.test.ts`
- Create: `app/program/FlagsPanel.tsx` + `tests/app/program/FlagsPanel.test.tsx`
- Modify: `lib/db/schema.ts` (table + enums), `components/FlagDialog.tsx` (roster select), `app/program/ProgramCoverageClient.tsx` (markers, drawer button, panel mount), `app/program/page.tsx` (load flags), `app/capture/[code]/ProfileReviewPanel.tsx` (CompetencyCard flag action)
- Delete: `components/ReasoningExpand.tsx`, `components/PrerequisiteGapPanel.tsx`, `components/CoverageHeatMap.tsx`, `components/TargetChainResults.tsx`, `insertPrototypeFlag`/`listFlags` in `lib/db/queries.ts`
- Docs: `docs/executive-brief.html`, `docs/superpowers/vision/gc-curriculum-tool-vision.md` (+ `.html`), `docs/STATE.md`

Conventions you must follow: tests run with `pnpm vitest run <path>`; full suite `pnpm test`; typecheck `pnpm tsc --noEmit`. DB tests in this repo hit the real local Postgres — flag-queries tests must clean up after themselves (delete created rows in `afterEach`). Commit after every task.

---

### Task 1: Schema + migration 0034

**Files:**
- Modify: `lib/db/schema.ts` (append after `careerTargetDemand`, end of file)
- Generate: `drizzle/0034_*.sql` via drizzle-kit

- [ ] **Step 1: Add the table to `lib/db/schema.ts`**

Append at the end of the file (after the `careerTargetDemand` table). `pgEnum`, `pgTable`, `uuid`, `text`, `jsonb`, `timestamp`, `index` are already imported at the top of the file:

```typescript
export const flagTargetKind = pgEnum('flag_target_kind', ['coverage_cell', 'profile_competency']);
export const flagStatus = pgEnum('flag_status', ['open', 'resolved']);

/**
 * Faculty dispute flags on AI readings. Keyed by STABLE identifiers — never
 * by snapshot/cell rows (cells are upsert-overwritten on re-score and deleted
 * on descriptor change; re-captures mint new snapshot ids):
 *   coverage_cell       → (courseCode, careerTargetId, subCompetencyId)
 *   profile_competency  → (courseCode, competencyStatement)
 * `flaggedContext` freezes the reading AS DISPUTED so read-time drift
 * ("was D=4 → now D=2") stays computable after re-scores. Flags never
 * auto-clear; resolution is explicit (name + note + date) and kept forever.
 * Migration 0034. Design: docs/superpowers/specs/2026-06-12-faculty-flag-mechanism-design.md
 */
export const facultyFlags = pgTable('faculty_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetKind: flagTargetKind('target_kind').notNull(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  careerTargetId: text('career_target_id').references(() => careerTargets.id, { onDelete: 'cascade' }),   // cell flags only
  subCompetencyId: text('sub_competency_id').references(() => subCompetencies.id, { onDelete: 'cascade' }), // cell flags only
  competencyStatement: text('competency_statement'),                                                        // profile flags only
  note: text('note').notNull(),
  flaggedBy: text('flagged_by').notNull(),
  flaggedContext: jsonb('flagged_context').$type<FlaggedContext | null>(),
  status: flagStatus('status').notNull().default('open'),
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  cellIdx: index('idx_faculty_flags_cell').on(t.courseCode, t.careerTargetId, t.subCompetencyId),
  statusIdx: index('idx_faculty_flags_status').on(t.status),
}));

/** The reading as it stood when flagged (drift baseline). */
export interface FlaggedContext {
  k: number | null;
  u: number | null;
  d: number | null;
  matchedCompetency?: string | null;
  rationale?: string | null;
  statement?: string | null;
  source?: string | null;
}
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0034_<adjective_noun>.sql` containing `CREATE TYPE "flag_target_kind"`, `CREATE TYPE "flag_status"`, `CREATE TABLE "faculty_flags"` with the two indexes. Inspect it — it must be purely additive (no ALTERs of existing tables).

- [ ] **Step 3: Apply to the local DB**

Run: `DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | sed 's/\s*#.*$//')" pnpm db:migrate`
(The drizzle config has no dotenv loader — the URL must be passed inline. The `sed` strips any inline `#` comment.)
Expected: `0034` applied. Verify: `psql "postgresql://admin@127.0.0.1:5433/gc_curriculum" -c "\d faculty_flags"` shows the table.

- [ ] **Step 4: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(flags): faculty_flags table + migration 0034"
```

---

### Task 2: Pure logic — `lib/program/flags.ts`

**Files:**
- Create: `lib/program/flags.ts`
- Test: `tests/lib/program/flags.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/program/flags.test.ts
import { describe, it, expect } from 'vitest';
import {
  openFlagsForCell,
  openFlagsForStatement,
  flagDrift,
  type FlagLike,
} from '@/lib/program/flags';

function f(o: Partial<FlagLike>): FlagLike {
  return {
    id: o.id ?? 'f1',
    targetKind: o.targetKind ?? 'coverage_cell',
    courseCode: o.courseCode ?? 'GC 1010',
    careerTargetId: o.careerTargetId ?? 'brand-strategist',
    subCompetencyId: o.subCompetencyId ?? 'color-management',
    competencyStatement: o.competencyStatement ?? null,
    status: o.status ?? 'open',
    flaggedContext: o.flaggedContext ?? null,
    ...o,
  };
}

describe('openFlagsForCell', () => {
  it('matches open cell flags on the stable triple and ignores resolved ones', () => {
    const flags = [
      f({ id: 'a' }),
      f({ id: 'b', status: 'resolved' }),
      f({ id: 'c', subCompetencyId: 'other-sub' }),
      f({ id: 'd', targetKind: 'profile_competency', careerTargetId: null, subCompetencyId: null, competencyStatement: 'x' }),
    ];
    const hits = openFlagsForCell(flags, 'GC 1010', 'brand-strategist', 'color-management');
    expect(hits.map(h => h.id)).toEqual(['a']);
  });
});

describe('openFlagsForStatement', () => {
  it('matches open profile flags on exact (courseCode, statement)', () => {
    const flags = [
      f({ id: 'p1', targetKind: 'profile_competency', careerTargetId: null, subCompetencyId: null, competencyStatement: 'Mixes spot-color inks' }),
      f({ id: 'p2', targetKind: 'profile_competency', careerTargetId: null, subCompetencyId: null, competencyStatement: 'Mixes spot-color inks', courseCode: 'GC 3800' }),
      f({ id: 'p3', targetKind: 'profile_competency', careerTargetId: null, subCompetencyId: null, competencyStatement: 'Different statement' }),
    ];
    const hits = openFlagsForStatement(flags, 'GC 1010', 'Mixes spot-color inks');
    expect(hits.map(h => h.id)).toEqual(['p1']);
  });
});

describe('flagDrift', () => {
  it('reports per-dimension was/now deltas', () => {
    const drift = flagDrift({ k: 3, u: 2, d: 4 }, { k: 3, u: 2, d: 2 });
    expect(drift).toEqual([{ dim: 'd', was: 4, now: 2 }]);
  });
  it('reports null→value and value→null transitions', () => {
    const drift = flagDrift({ k: null, u: 1, d: 3 }, { k: 2, u: 1, d: 3 });
    expect(drift).toEqual([{ dim: 'k', was: null, now: 2 }]);
  });
  it('returns null when nothing changed', () => {
    expect(flagDrift({ k: 1, u: 1, d: 1 }, { k: 1, u: 1, d: 1 })).toBeNull();
  });
  it('returns null when context or current cell is missing', () => {
    expect(flagDrift(null, { k: 1, u: 1, d: 1 })).toBeNull();
    expect(flagDrift({ k: 1, u: 1, d: 1 }, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/lib/program/flags.test.ts`
Expected: FAIL — module `@/lib/program/flags` not found.

- [ ] **Step 3: Implement**

```typescript
// lib/program/flags.ts
/**
 * Pure flag matching + drift logic (no DB). The UIs use these to render
 * ⚑ markers; the GET /api/flags route uses flagDrift to annotate each open
 * cell flag with how the live score moved since it was flagged.
 * Design: docs/superpowers/specs/2026-06-12-faculty-flag-mechanism-design.md
 */

export interface FlagLike {
  id: string;
  targetKind: 'coverage_cell' | 'profile_competency';
  courseCode: string;
  careerTargetId: string | null;
  subCompetencyId: string | null;
  competencyStatement: string | null;
  status: 'open' | 'resolved';
  flaggedContext: { k: number | null; u: number | null; d: number | null } | null;
}

export interface DriftEntry {
  dim: 'k' | 'u' | 'd';
  was: number | null;
  now: number | null;
}

/** Open flags matching one matrix cell's stable identity. */
export function openFlagsForCell<T extends FlagLike>(
  flags: T[],
  courseCode: string,
  careerTargetId: string,
  subCompetencyId: string,
): T[] {
  return flags.filter(f =>
    f.status === 'open'
    && f.targetKind === 'coverage_cell'
    && f.courseCode === courseCode
    && f.careerTargetId === careerTargetId
    && f.subCompetencyId === subCompetencyId,
  );
}

/** Open flags matching one profile competency by exact statement. */
export function openFlagsForStatement<T extends FlagLike>(
  flags: T[],
  courseCode: string,
  statement: string,
): T[] {
  return flags.filter(f =>
    f.status === 'open'
    && f.targetKind === 'profile_competency'
    && f.courseCode === courseCode
    && f.competencyStatement === statement,
  );
}

/**
 * Per-dimension deltas between the reading as flagged and the live reading.
 * Null when either side is missing (annotate "(no longer in matrix)" /
 * "(context not recorded)" upstream) or when nothing moved.
 */
export function flagDrift(
  flagged: { k: number | null; u: number | null; d: number | null } | null,
  current: { k: number | null; u: number | null; d: number | null } | null,
): DriftEntry[] | null {
  if (!flagged || !current) return null;
  const out: DriftEntry[] = [];
  for (const dim of ['k', 'u', 'd'] as const) {
    if (flagged[dim] !== current[dim]) out.push({ dim, was: flagged[dim], now: current[dim] });
  }
  return out.length === 0 ? null : out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/lib/program/flags.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/program/flags.ts tests/lib/program/flags.test.ts
git commit -m "feat(flags): pure match + drift logic"
```

---

### Task 3: Queries — `lib/db/flag-queries.ts`

**Files:**
- Create: `lib/db/flag-queries.ts`
- Test: `tests/lib/db/flag-queries.test.ts`

- [ ] **Step 1: Write the failing tests**

These hit the real local Postgres (repo convention). They create their own course row and clean everything up.

```typescript
// tests/lib/db/flag-queries.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import { courses, facultyFlags } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createFlag, listFlags, resolveFlag } from '@/lib/db/flag-queries';

const TEST_CODE = 'ZZ 9999'; // never a real course

beforeAll(async () => {
  await db.insert(courses).values({ code: TEST_CODE, title: 'Flag test course', level: 9000 }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(facultyFlags).where(eq(facultyFlags.courseCode, TEST_CODE));
  await db.delete(courses).where(eq(courses.code, TEST_CODE));
});

describe('flag-queries round trip', () => {
  it('creates, lists, and resolves a profile flag', async () => {
    const created = await createFlag({
      targetKind: 'profile_competency',
      courseCode: TEST_CODE,
      careerTargetId: null,
      subCompetencyId: null,
      competencyStatement: 'Test statement',
      note: 'AI overstated this',
      flaggedBy: 'Erica Walker',
      flaggedContext: { k: 3, u: 2, d: 4 },
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('open');

    const open = await listFlags({ status: 'open' });
    expect(open.some(fl => fl.id === created.id)).toBe(true);

    const resolved = await resolveFlag(created.id, { resolvedBy: 'Chip Tonkin', resolutionNote: 're-scored, agree now' });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy).toBe('Chip Tonkin');
    expect(resolved.resolvedAt).toBeTruthy();

    const openAfter = await listFlags({ status: 'open' });
    expect(openAfter.some(fl => fl.id === created.id)).toBe(false);
    const all = await listFlags({});
    expect(all.some(fl => fl.id === created.id)).toBe(true);
  });

  it('rejects double-resolve', async () => {
    const created = await createFlag({
      targetKind: 'coverage_cell',
      courseCode: TEST_CODE,
      careerTargetId: null, // FK requires a real target; null is allowed at the DB level for this test
      subCompetencyId: null,
      competencyStatement: null,
      note: 'depth too high',
      flaggedBy: 'Erica Walker',
      flaggedContext: null,
    });
    await resolveFlag(created.id, { resolvedBy: 'Chip Tonkin', resolutionNote: 'done' });
    await expect(
      resolveFlag(created.id, { resolvedBy: 'Chip Tonkin', resolutionNote: 'again' }),
    ).rejects.toThrow(/already resolved/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/lib/db/flag-queries.test.ts`
Expected: FAIL — module `@/lib/db/flag-queries` not found.

- [ ] **Step 3: Implement**

```typescript
// lib/db/flag-queries.ts
/**
 * CRUD for faculty_flags (migration 0034). Thin; matching/drift logic lives
 * in lib/program/flags.ts. resolveFlag is the only mutation of an existing
 * row and refuses to touch an already-resolved flag (the dispute trail is
 * append-then-close, never rewrite).
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { facultyFlags, type FlaggedContext } from '@/lib/db/schema';

export type FacultyFlagRow = typeof facultyFlags.$inferSelect;

export interface CreateFlagInput {
  targetKind: 'coverage_cell' | 'profile_competency';
  courseCode: string;
  careerTargetId: string | null;
  subCompetencyId: string | null;
  competencyStatement: string | null;
  note: string;
  flaggedBy: string;
  flaggedContext: FlaggedContext | null;
}

export async function createFlag(input: CreateFlagInput): Promise<FacultyFlagRow> {
  const [row] = await db.insert(facultyFlags).values(input).returning();
  if (!row) throw new Error('flag insert returned no row');
  return row;
}

export async function listFlags(opts: { status?: 'open' | 'resolved' }): Promise<FacultyFlagRow[]> {
  const base = db.select().from(facultyFlags);
  const rows = opts.status
    ? await base.where(eq(facultyFlags.status, opts.status)).orderBy(desc(facultyFlags.createdAt))
    : await base.orderBy(desc(facultyFlags.createdAt));
  return rows;
}

export async function resolveFlag(
  id: string,
  opts: { resolvedBy: string; resolutionNote: string },
): Promise<FacultyFlagRow> {
  const [existing] = await db.select().from(facultyFlags).where(eq(facultyFlags.id, id)).limit(1);
  if (!existing) throw new Error(`flag not found: ${id}`);
  if (existing.status === 'resolved') throw new Error(`flag already resolved: ${id}`);
  const [row] = await db
    .update(facultyFlags)
    .set({ status: 'resolved', resolvedBy: opts.resolvedBy, resolutionNote: opts.resolutionNote, resolvedAt: new Date() })
    .where(eq(facultyFlags.id, id))
    .returning();
  if (!row) throw new Error('flag resolve returned no row');
  return row;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/lib/db/flag-queries.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/flag-queries.ts tests/lib/db/flag-queries.test.ts
git commit -m "feat(flags): flag-queries CRUD with explicit-resolve discipline"
```

---

### Task 4: API routes — create / list / resolve

**Files:**
- Create: `app/api/flags/route.ts`
- Create: `app/api/flags/[id]/route.ts`
- Test: `tests/app/api/flags.test.ts`

Route conventions (copy `app/api/feedback/route.ts`): slug from `?slug=` query, `isValidSlug` → 401, `NextResponse.json`.

- [ ] **Step 1: Write the failing tests**

Mock the query layer — the DB round-trip is already covered by Task 3.

```typescript
// tests/app/api/flags.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'good' }));
vi.mock('@/lib/db/flag-queries', () => ({
  createFlag: vi.fn(async (input: Record<string, unknown>) => ({ id: 'new-id', status: 'open', ...input })),
  listFlags: vi.fn(async () => [
    {
      id: 'f1', targetKind: 'coverage_cell', courseCode: 'GC 1010',
      careerTargetId: 't1', subCompetencyId: 's1', competencyStatement: null,
      note: 'n', flaggedBy: 'Erica Walker', flaggedContext: { k: 1, u: 1, d: 4 },
      status: 'open', resolvedBy: null, resolvedAt: null, resolutionNote: null, createdAt: new Date(),
    },
  ]),
  resolveFlag: vi.fn(async (id: string) => {
    if (id === 'gone') throw new Error('flag already resolved: gone');
    return { id, status: 'resolved' };
  }),
}));
vi.mock('@/lib/db/program-coverage-queries', () => ({
  getMatrixData: vi.fn(async () => ({
    courses: [{ courseCode: 'GC 1010', courseTitle: 'T', level: 1000, snapshotId: 'snap1', snapshotCaption: null, snapshotCreatedAt: new Date() }],
    targets: [], subCompetencies: [],
    cells: [{ snapshotId: 'snap1', careerTargetId: 't1', subCompetencyId: 's1', kDepth: 1, uDepth: 1, dDepth: 2, matchedCompetency: null, evidenceExcerpt: null, confidence: 'high', rationale: '' }],
  })),
}));

import { POST, GET } from '@/app/api/flags/route';
import { PATCH } from '@/app/api/flags/[id]/route';

beforeEach(() => { vi.clearAllMocks(); });

const goodCreate = {
  targetKind: 'coverage_cell', courseCode: 'GC 1010', careerTargetId: 't1',
  subCompetencyId: 's1', competencyStatement: null,
  note: 'depth looks too high', flaggedBy: 'Erica Walker',
  flaggedContext: { k: 1, u: 1, d: 4 },
};

describe('POST /api/flags', () => {
  it('401s on bad slug', async () => {
    const res = await POST(new Request('http://x/api/flags?slug=bad', { method: 'POST', body: JSON.stringify(goodCreate) }));
    expect(res.status).toBe(401);
  });
  it('creates a valid cell flag', async () => {
    const res = await POST(new Request('http://x/api/flags?slug=good', { method: 'POST', body: JSON.stringify(goodCreate) }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.flag.id).toBe('new-id');
  });
  it('400s on kind/field inconsistency (cell flag with a statement)', async () => {
    const res = await POST(new Request('http://x/api/flags?slug=good', {
      method: 'POST',
      body: JSON.stringify({ ...goodCreate, competencyStatement: 'should not be here' }),
    }));
    expect(res.status).toBe(400);
  });
  it('400s on empty note', async () => {
    const res = await POST(new Request('http://x/api/flags?slug=good', { method: 'POST', body: JSON.stringify({ ...goodCreate, note: '  ' }) }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/flags', () => {
  it('annotates open cell flags with drift and stillInMatrix', async () => {
    const res = await GET(new Request('http://x/api/flags?slug=good&status=open'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.flags).toHaveLength(1);
    expect(json.flags[0].stillInMatrix).toBe(true);
    expect(json.flags[0].drift).toEqual([{ dim: 'd', was: 4, now: 2 }]);
  });
});

describe('PATCH /api/flags/[id]', () => {
  it('resolves with name + note', async () => {
    const res = await PATCH(
      new Request('http://x/api/flags/f1?slug=good', { method: 'PATCH', body: JSON.stringify({ resolvedBy: 'Chip Tonkin', resolutionNote: 'agreed after re-score' }) }),
      { params: Promise.resolve({ id: 'f1' }) },
    );
    expect(res.status).toBe(200);
  });
  it('400s on missing resolution note', async () => {
    const res = await PATCH(
      new Request('http://x/api/flags/f1?slug=good', { method: 'PATCH', body: JSON.stringify({ resolvedBy: 'Chip Tonkin', resolutionNote: '' }) }),
      { params: Promise.resolve({ id: 'f1' }) },
    );
    expect(res.status).toBe(400);
  });
  it('409s on already-resolved', async () => {
    const res = await PATCH(
      new Request('http://x/api/flags/gone?slug=good', { method: 'PATCH', body: JSON.stringify({ resolvedBy: 'Chip Tonkin', resolutionNote: 'x' }) }),
      { params: Promise.resolve({ id: 'gone' }) },
    );
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/app/api/flags.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement `app/api/flags/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidSlug } from '@/lib/slug';
import { createFlag, listFlags } from '@/lib/db/flag-queries';
import { getMatrixData } from '@/lib/db/program-coverage-queries';
import { flagDrift } from '@/lib/program/flags';

const createSchema = z.object({
  targetKind: z.enum(['coverage_cell', 'profile_competency']),
  courseCode: z.string().min(1),
  careerTargetId: z.string().nullable(),
  subCompetencyId: z.string().nullable(),
  competencyStatement: z.string().nullable(),
  note: z.string().transform(s => s.trim()).pipe(z.string().min(1, 'note required')),
  flaggedBy: z.string().min(1),
  flaggedContext: z.object({
    k: z.number().nullable(), u: z.number().nullable(), d: z.number().nullable(),
    matchedCompetency: z.string().nullable().optional(),
    rationale: z.string().nullable().optional(),
    statement: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
  }).nullable(),
}).superRefine((v, ctx) => {
  if (v.targetKind === 'coverage_cell') {
    if (!v.careerTargetId || !v.subCompetencyId || v.competencyStatement !== null) {
      ctx.addIssue({ code: 'custom', message: 'coverage_cell flags need careerTargetId + subCompetencyId and a null competencyStatement' });
    }
  } else {
    if (!v.competencyStatement || v.careerTargetId !== null || v.subCompetencyId !== null) {
      ctx.addIssue({ code: 'custom', message: 'profile_competency flags need competencyStatement and null careerTargetId/subCompetencyId' });
    }
  }
});

export async function POST(req: Request): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'invalid flag' }, { status: 400 });
  }
  const flag = await createFlag(parsed.data);
  return NextResponse.json({ flag });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const statusParam = url.searchParams.get('status');
  const status = statusParam === 'open' || statusParam === 'resolved' ? statusParam : undefined;
  const flags = await listFlags({ status });

  // Annotate cell flags with read-time drift vs the LIVE matrix (newest
  // snapshot per career-building course) and whether the cell still exists.
  const matrix = await getMatrixData();
  const snapByCourse = new Map(matrix.courses.map(c => [c.courseCode, c.snapshotId]));
  const cellByKey = new Map(matrix.cells.map(c => [`${c.snapshotId}:${c.careerTargetId}:${c.subCompetencyId}`, c]));

  const annotated = flags.map(f => {
    if (f.targetKind !== 'coverage_cell') return { ...f, drift: null, stillInMatrix: null };
    const snapId = snapByCourse.get(f.courseCode);
    const cell = snapId ? cellByKey.get(`${snapId}:${f.careerTargetId}:${f.subCompetencyId}`) ?? null : null;
    return {
      ...f,
      stillInMatrix: cell !== null,
      drift: cell && f.flaggedContext
        ? flagDrift(f.flaggedContext, { k: cell.kDepth, u: cell.uDepth, d: cell.dDepth })
        : null,
    };
  });

  return NextResponse.json({ flags: annotated });
}
```

- [ ] **Step 4: Implement `app/api/flags/[id]/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { resolveFlag } from '@/lib/db/flag-queries';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const resolvedBy = typeof body.resolvedBy === 'string' ? body.resolvedBy.trim() : '';
  const resolutionNote = typeof body.resolutionNote === 'string' ? body.resolutionNote.trim() : '';
  if (!resolvedBy || !resolutionNote) {
    return NextResponse.json({ error: 'resolvedBy and resolutionNote are required' }, { status: 400 });
  }

  try {
    const flag = await resolveFlag(id, { resolvedBy, resolutionNote });
    return NextResponse.json({ flag });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'resolve failed';
    if (/already resolved/i.test(msg)) return NextResponse.json({ error: msg }, { status: 409 });
    if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run tests/app/api/flags.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add app/api/flags tests/app/api/flags.test.ts
git commit -m "feat(flags): create/list/resolve routes with drift annotation"
```

---

### Task 5: FlagDialog — roster identity + fresh copy

**Files:**
- Modify: `components/FlagDialog.tsx` (full rewrite below — it's 51 lines today)
- Test: `tests/components/FlagDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/FlagDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FlagDialog } from '@/components/FlagDialog';

beforeEach(() => { localStorage.clear(); });

describe('FlagDialog', () => {
  it('submits note + selected roster name and persists the name', async () => {
    const onSubmit = vi.fn(async () => {});
    render(<FlagDialog open onOpenChange={() => {}} onSubmit={onSubmit} context="GC 1010 × Color Management" />);
    fireEvent.change(screen.getByLabelText(/flagging as/i), { target: { value: 'Erica Walker' } });
    fireEvent.change(screen.getByPlaceholderText(/specifically wrong/i), { target: { value: 'Depth overstated' } });
    fireEvent.click(screen.getByRole('button', { name: /submit flag/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Depth overstated', 'Erica Walker'));
    expect(localStorage.getItem('gc-flagger-name')).toBe('Erica Walker');
  });

  it('disables submit until both a name and a note are present', () => {
    render(<FlagDialog open onOpenChange={() => {}} onSubmit={vi.fn(async () => {})} context="ctx" />);
    expect((screen.getByRole('button', { name: /submit flag/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('pre-selects the remembered name from localStorage', () => {
    localStorage.setItem('gc-flagger-name', 'Chip Tonkin');
    render(<FlagDialog open onOpenChange={() => {}} onSubmit={vi.fn(async () => {})} context="ctx" />);
    expect((screen.getByLabelText(/flagging as/i) as HTMLSelectElement).value).toBe('Chip Tonkin');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/components/FlagDialog.test.tsx`
Expected: FAIL — `onSubmit` called with one arg / no "flagging as" select found.

- [ ] **Step 3: Rewrite `components/FlagDialog.tsx`**

Breaking change to the `onSubmit` signature is safe: the only current importer is `ReasoningExpand.tsx`, which Task 8 deletes. (If Task 8 hasn't run yet in your ordering, tsc may flag `ReasoningExpand` — fix by deleting it there, not by keeping compat.)

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { FACULTY_ROSTER, DEPARTMENT_CANONICAL } from '@/lib/faculty';

const FLAGGER_KEY = 'gc-flagger-name';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** note + the roster name the flag is filed under */
  onSubmit: (note: string, flaggedBy: string) => Promise<void>;
  context: string;
}

export function FlagDialog({ open, onOpenChange, onSubmit, context }: Props) {
  const [note, setNote] = useState('');
  const [name, setName] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(FLAGGER_KEY) ?? '';
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (note.trim().length === 0 || name.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(note.trim(), name);
      localStorage.setItem(FLAGGER_KEY, name);
      setNote('');
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to file flag');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Flag this AI reading</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{context}</p>
        <label className="block text-xs text-muted-foreground">
          Flagging as
          <select
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="" disabled>Select your name…</option>
            {FACULTY_ROSTER.filter(n => n !== DEPARTMENT_CANONICAL).map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <Textarea
          placeholder="What is specifically wrong with this reading? Flags stay open until someone resolves them with a note."
          rows={5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && <p className="text-xs text-amber-700">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || note.trim().length === 0 || name.length === 0}>
            {submitting ? 'Saving…' : 'Submit flag'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/components/FlagDialog.test.tsx`
Expected: PASS (3 tests). `pnpm tsc --noEmit` may flag `ReasoningExpand.tsx` (old 1-arg call) — if so, delete `components/ReasoningExpand.tsx` now (it's slated for deletion in Task 8 anyway) and note it in the commit.

- [ ] **Step 5: Commit**

```bash
git add components/FlagDialog.tsx tests/components/FlagDialog.test.tsx
git commit -m "feat(flags): FlagDialog roster identity + persisted flagger name"
```

---

### Task 6: Matrix integration — markers, drawer button, FlagsPanel

**Files:**
- Create: `app/program/FlagsPanel.tsx`
- Test: `tests/app/program/FlagsPanel.test.tsx`
- Modify: `app/program/ProgramCoverageClient.tsx`
- Modify: `app/program/page.tsx`

- [ ] **Step 1: Write the failing FlagsPanel test**

```tsx
// tests/app/program/FlagsPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FlagsPanel, type AnnotatedFlag } from '@/app/program/FlagsPanel';

function flag(o: Partial<AnnotatedFlag>): AnnotatedFlag {
  return {
    id: o.id ?? 'f1', targetKind: 'coverage_cell', courseCode: 'GC 1010',
    careerTargetId: 't1', subCompetencyId: 'color-management', competencyStatement: null,
    note: 'overstated', flaggedBy: 'Erica Walker',
    flaggedContext: { k: 1, u: 1, d: 4 }, status: 'open',
    resolvedBy: null, resolvedAt: null, resolutionNote: null,
    createdAt: new Date().toISOString(),
    drift: o.drift ?? null, stillInMatrix: o.stillInMatrix ?? true,
    ...o,
  } as AnnotatedFlag;
}

describe('FlagsPanel', () => {
  it('renders drift line when the score moved since flagging', () => {
    render(<FlagsPanel flags={[flag({ drift: [{ dim: 'd', was: 4, now: 2 }] })]} slug="s" onChanged={() => {}} />);
    expect(screen.getByText(/was D=4 → now D=2/i)).toBeTruthy();
  });

  it('annotates flags whose cell left the matrix', () => {
    render(<FlagsPanel flags={[flag({ stillInMatrix: false })]} slug="s" onChanged={() => {}} />);
    expect(screen.getByText(/no longer in matrix/i)).toBeTruthy();
  });

  it('resolve PATCHes with name + note and calls onChanged', async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<FlagsPanel flags={[flag({})]} slug="s" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
    fireEvent.change(screen.getByLabelText(/resolving as/i), { target: { value: 'Chip Tonkin' } });
    fireEvent.change(screen.getByPlaceholderText(/resolution note/i), { target: { value: 'agree after re-score' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm resolve/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/flags/f1');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/app/program/FlagsPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/program/FlagsPanel.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { FACULTY_ROSTER, DEPARTMENT_CANONICAL } from '@/lib/faculty';
import type { DriftEntry } from '@/lib/program/flags';

export interface AnnotatedFlag {
  id: string;
  targetKind: 'coverage_cell' | 'profile_competency';
  courseCode: string;
  careerTargetId: string | null;
  subCompetencyId: string | null;
  competencyStatement: string | null;
  note: string;
  flaggedBy: string;
  flaggedContext: { k: number | null; u: number | null; d: number | null } | null;
  status: 'open' | 'resolved';
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  drift: DriftEntry[] | null;
  stillInMatrix: boolean | null;
}

function driftLabel(d: DriftEntry): string {
  const dim = d.dim.toUpperCase();
  return `was ${dim}=${d.was ?? '—'} → now ${dim}=${d.now ?? '—'}`;
}

export function FlagsPanel({ flags, slug, onChanged }: {
  flags: AnnotatedFlag[];
  slug: string;
  onChanged: () => void;
}) {
  const [resolving, setResolving] = useState<string | null>(null);   // flag id with open resolve form
  const [name, setName] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('gc-flagger-name') ?? '';
  });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmResolve(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/flags/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolvedBy: name, resolutionNote: note.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? `resolve failed (${res.status})`);
        return;
      }
      localStorage.setItem('gc-flagger-name', name);
      setResolving(null);
      setNote('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (flags.length === 0) {
    return <p className="px-4 py-6 text-center text-xs text-muted-foreground">No flags. Faculty can flag any matrix cell or profile competency they dispute.</p>;
  }

  return (
    <ul className="divide-y">
      {flags.map(f => (
        <li key={f.id} className="space-y-1.5 px-4 py-3 text-xs">
          <div className="flex items-baseline gap-2">
            <span aria-hidden>⚑</span>
            <span className="font-mono text-[11px]">{f.courseCode}</span>
            <span className="text-muted-foreground">
              {f.targetKind === 'coverage_cell'
                ? `${f.careerTargetId} · ${f.subCompetencyId}`
                : `"${f.competencyStatement}"`}
            </span>
            {f.status === 'resolved' && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">resolved</span>}
            {f.stillInMatrix === false && (
              <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">no longer in matrix</span>
            )}
          </div>
          <p>{f.note}</p>
          <p className="text-[11px] text-muted-foreground">
            {f.flaggedBy} · {new Date(f.createdAt).toLocaleDateString()}
            {f.flaggedContext && ` · flagged at K${f.flaggedContext.k ?? '—'}/U${f.flaggedContext.u ?? '—'}/D${f.flaggedContext.d ?? '—'}`}
          </p>
          {f.drift && (
            <p className="text-[11px] font-medium text-amber-800">
              Score changed since flagged: {f.drift.map(driftLabel).join(', ')}
            </p>
          )}
          {f.status === 'resolved' ? (
            <p className="text-[11px] text-muted-foreground">↳ {f.resolutionNote} — {f.resolvedBy}, {f.resolvedAt ? new Date(f.resolvedAt).toLocaleDateString() : ''}</p>
          ) : resolving === f.id ? (
            <div className="space-y-1.5 rounded border bg-muted/30 p-2">
              <label className="block text-[11px] text-muted-foreground">
                Resolving as
                <select value={name} onChange={e => setName(e.target.value)} className="mt-0.5 block w-full rounded border border-input bg-background px-2 py-1 text-xs">
                  <option value="" disabled>Select your name…</option>
                  {FACULTY_ROSTER.filter(n => n !== DEPARTMENT_CANONICAL).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <textarea
                placeholder="resolution note (required)"
                rows={2}
                value={note}
                onChange={e => setNote(e.target.value)}
                className="block w-full rounded border border-input bg-background px-2 py-1 text-xs"
              />
              {error && <p className="text-[11px] text-amber-700">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => void confirmResolve(f.id)} disabled={busy || !name || note.trim().length === 0}
                  className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50">
                  {busy ? 'Saving…' : 'Confirm resolve'}
                </button>
                <button type="button" onClick={() => setResolving(null)} className="text-[11px] text-muted-foreground hover:text-foreground">cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => { setResolving(f.id); setError(null); }} className="text-[11px] underline-offset-2 hover:underline">
              Resolve…
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/app/program/FlagsPanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into `app/program/ProgramCoverageClient.tsx`**

Five edits (current line anchors from the 2026-06-12 read):

(a) Add imports at the top (after the existing type import block, line 9):

```tsx
import { FlagDialog } from '@/components/FlagDialog';
import { FlagsPanel, type AnnotatedFlag } from './FlagsPanel';
import { openFlagsForCell } from '@/lib/program/flags';
```

(b) Add props + state. Change the `Props` interface and component signature to accept the server-loaded flags, and add UI state inside `ProgramCoverageClient` (next to the existing `selected` state, ~line 113):

```tsx
interface Props {
  slug: string;
  initialData: MatrixData;
  initialFlags: AnnotatedFlag[];
}

export function ProgramCoverageClient({ slug, initialData, initialFlags }: Props) {
  // …existing state…
  const [flags, setFlags] = useState<AnnotatedFlag[]>(initialFlags);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);

  const refetchFlags = useCallback(async () => {
    const res = await fetch(`/api/flags?slug=${encodeURIComponent(slug)}`);
    if (res.ok) setFlags(((await res.json()) as { flags: AnnotatedFlag[] }).flags);
  }, [slug]);
  const openFlags = useMemo(() => flags.filter(f => f.status === 'open'), [flags]);
```

(c) Header affordance — in the "Status & refresh" section (after the refresh `<button>`, ~line 282), add:

```tsx
        <button
          type="button"
          onClick={() => setFlagsOpen(o => !o)}
          className="ml-3 rounded-md border border-input bg-background px-3 py-1.5 text-xs hover:bg-muted"
        >
          ⚑ {openFlags.length} open {openFlags.length === 1 ? 'flag' : 'flags'}
        </button>
```

And directly below that section, mount the panel:

```tsx
      {flagsOpen && (
        <section className="rounded-md border bg-card">
          <header className="border-b px-4 py-2 text-xs font-semibold">Dispute flags</header>
          <FlagsPanel flags={flags} slug={slug} onChanged={() => void refetchFlags()} />
        </section>
      )}
```

(d) Cell marker — inside the `<td>` render (~line 402), the cell currently renders the `K/U/D` mono div. Compute matches just above the `return` of the cell map callback and add the marker:

```tsx
                      const cellFlags = openFlagsForCell(openFlags, course.courseCode, activeTargetId, s.id);
```

…and inside the `<td>` content, after the K/U/D div (keep the existing `cell ? … : …` structure):

```tsx
                          {cellFlags.length > 0 && (
                            <div className="text-[9px]" title={`${cellFlags.length} open flag${cellFlags.length === 1 ? '' : 's'}`} aria-label="open flags">⚑{cellFlags.length > 1 ? cellFlags.length : ''}</div>
                          )}
```

(e) Drawer flag button — in `CellDetailDrawer`, the footer row with "View snapshot →" / "Re-score this pair" (~line 570) gains a flag button. `CellDetailDrawer` needs two new props, `onFlag: () => void` and `openFlagCount: number`, threaded from the parent:

```tsx
              <button
                type="button"
                onClick={onFlag}
                className="rounded-md border border-input bg-background px-2.5 py-1 text-xs hover:bg-muted"
              >
                ⚑ Flag this reading{openFlagCount > 0 ? ` (${openFlagCount} open)` : ''}
              </button>
```

At the `<CellDetailDrawer …/>` call site (~line 478) pass:

```tsx
          onFlag={() => setFlagDialogOpen(true)}
          openFlagCount={openFlagsForCell(openFlags, selected.course.courseCode, activeTargetId, selected.subCompetency.id).length}
```

And mount the dialog next to the drawer (only when a cell is selected):

```tsx
      {selected && (
        <FlagDialog
          open={flagDialogOpen}
          onOpenChange={setFlagDialogOpen}
          context={`${selected.course.courseCode} × ${selected.subCompetency.name} — flag this coverage reading`}
          onSubmit={async (note, flaggedBy) => {
            const res = await fetch(`/api/flags?slug=${encodeURIComponent(slug)}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                targetKind: 'coverage_cell',
                courseCode: selected.course.courseCode,
                careerTargetId: activeTargetId,
                subCompetencyId: selected.subCompetency.id,
                competencyStatement: null,
                note,
                flaggedBy,
                flaggedContext: selected.cell
                  ? { k: selected.cell.kDepth, u: selected.cell.uDepth, d: selected.cell.dDepth, matchedCompetency: selected.cell.matchedCompetency, rationale: selected.cell.rationale }
                  : null,
              }),
            });
            if (!res.ok) {
              const json = await res.json().catch(() => ({}));
              throw new Error((json as { error?: string }).error ?? `flag failed (${res.status})`);
            }
            await refetchFlags();
          }}
        />
      )}
```

- [ ] **Step 6: Load flags in `app/program/page.tsx`**

After `const data = await getMatrixData();` (line 25), add the flag load and pass it through (server component → fetch the query layer directly, not the API):

```tsx
import { listFlags } from '@/lib/db/flag-queries';
```

```tsx
  const data = await getMatrixData();
  const flagRows = await listFlags({});
  // Server-side: no drift annotation needed for first paint (the client
  // refetches via /api/flags after any mutation, which annotates).
  const initialFlags = flagRows.map(f => ({
    ...f,
    createdAt: f.createdAt.toISOString(),
    resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
    drift: null,
    stillInMatrix: null,
  }));
```

…and `<ProgramCoverageClient slug={slug} initialData={data} initialFlags={initialFlags} />`.

- [ ] **Step 7: Typecheck + run the program tests**

Run: `pnpm tsc --noEmit && pnpm vitest run tests/app/program/`
Expected: clean + PASS.

- [ ] **Step 8: Commit**

```bash
git add app/program tests/app/program
git commit -m "feat(flags): matrix cell markers, drawer flag action, /program flags panel"
```

---

### Task 7: Review-panel flag action

**Files:**
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx`
- Test: `tests/app/capture/profile-review-flags.test.tsx`

`ProfileReviewPanel` already receives `courseCode` and `slug` (props at line 789). `CompetencyCard` (line 344) renders the badge row (`SourceBadge` + `EvidenceBandChip`, ~line 384) — the flag affordance goes there.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/app/capture/profile-review-flags.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CompetencyFlagButton } from '@/app/capture/[code]/ProfileReviewPanel';

describe('CompetencyFlagButton', () => {
  it('opens the dialog and POSTs a profile_competency flag with frozen context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('gc-flagger-name', 'Erica Walker');
    render(
      <CompetencyFlagButton
        courseCode="GC 1010"
        slug="s"
        competency={{ statement: 'Mixes spot-color inks', type: 'technical', k_depth: 3, u_depth: 2, d_depth: 4, evidence_k: 'x', evidence_u: 'y', evidence_d: 'z', rationale: 'r', source: 'materials' } as never}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /flag/i }));
    fireEvent.change(screen.getByPlaceholderText(/specifically wrong/i), { target: { value: 'U is too generous' } });
    fireEvent.click(screen.getByRole('button', { name: /submit flag/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.targetKind).toBe('profile_competency');
    expect(body.competencyStatement).toBe('Mixes spot-color inks');
    expect(body.careerTargetId).toBeNull();
    expect(body.flaggedContext).toMatchObject({ k: 3, u: 2, d: 4, statement: 'Mixes spot-color inks' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/app/capture/profile-review-flags.test.tsx`
Expected: FAIL — `CompetencyFlagButton` is not exported.

- [ ] **Step 3: Implement in `ProfileReviewPanel.tsx`**

Add the import at the top (with the other component imports):

```tsx
import { FlagDialog } from '@/components/FlagDialog';
```

Add this exported component near `SourceBadge` (it is deliberately self-contained — own dialog state, own POST — so `CompetencyCard` only needs two extra props threaded):

```tsx
/**
 * ⚑ dispute affordance on one competency. Files a profile_competency flag
 * keyed (courseCode, statement) with the current depths frozen as context.
 * Flags persist across re-captures (exact-statement match resurfaces them;
 * the /program flags panel lists them regardless).
 */
export function CompetencyFlagButton({
  courseCode,
  slug,
  competency,
}: {
  courseCode: string;
  slug: string;
  competency: CaptureCompetency;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Dispute this AI reading — flags persist until explicitly resolved"
        className="inline-flex items-center rounded border border-input bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        ⚑ flag
      </button>
      <FlagDialog
        open={open}
        onOpenChange={setOpen}
        context={`${courseCode} — "${competency.statement}"`}
        onSubmit={async (note, flaggedBy) => {
          const res = await fetch(`/api/flags?slug=${encodeURIComponent(slug)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              targetKind: 'profile_competency',
              courseCode,
              careerTargetId: null,
              subCompetencyId: null,
              competencyStatement: competency.statement,
              note,
              flaggedBy,
              flaggedContext: {
                k: competency.k_depth,
                u: competency.u_depth,
                d: competency.d_depth,
                statement: competency.statement,
                source: competency.source ?? null,
              },
            }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error((json as { error?: string }).error ?? `flag failed (${res.status})`);
          }
        }}
      />
    </>
  );
}
```

Thread it into `CompetencyCard`: add `courseCode: string; slug: string;` to its props (line 344's destructure + type), and render the button in the badge row right after `<EvidenceBandChip …/>` (~line 385):

```tsx
            <CompetencyFlagButton courseCode={courseCode} slug={slug} competency={competency} />
```

At every `CompetencyCard` call site inside `ProfileReviewPanel` (search the file for `<CompetencyCard`), pass `courseCode={courseCode} slug={slug}` — both values are already in scope from the panel's own props.

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `pnpm vitest run tests/app/capture/profile-review-flags.test.tsx && pnpm tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "app/capture/[code]/ProfileReviewPanel.tsx" tests/app/capture/profile-review-flags.test.tsx
git commit -m "feat(flags): per-competency dispute flag in the review panel"
```

---

### Task 8: Dead-chain sweep (A3)

**Files:**
- Delete: `components/ReasoningExpand.tsx` (if not already deleted in Task 5), `components/PrerequisiteGapPanel.tsx`, `components/CoverageHeatMap.tsx`, `components/TargetChainResults.tsx`
- Modify: `lib/db/queries.ts` (remove `insertPrototypeFlag` + `listFlags` + the now-unused `prototypeFlags` import; keep everything else)

Verified orphaned 2026-06-12: `TargetChainResults` (the chain's last importer) is itself imported nowhere; `/api/flag` was deleted 2026-06-03; nothing calls `insertPrototypeFlag`/`listFlags`. The `prototype_flags` TABLE stays (dropping it is a separate migration decision, recorded out of scope).

- [ ] **Step 1: Confirm orphaning is still true**

Run: `grep -rln "TargetChainResults\|ReasoningExpand\|PrerequisiteGapPanel\|CoverageHeatMap" --include="*.tsx" --include="*.ts" app/ components/ lib/ | grep -v "^components/"`
Expected: no output (no importers outside the chain itself). If anything shows up, STOP and report — do not delete.

- [ ] **Step 2: Delete the four components**

Run: `git rm components/ReasoningExpand.tsx components/PrerequisiteGapPanel.tsx components/CoverageHeatMap.tsx components/TargetChainResults.tsx`
(If Task 5 already removed `ReasoningExpand.tsx`, omit it.)

- [ ] **Step 3: Remove the dead query helpers**

In `lib/db/queries.ts`: delete the `insertPrototypeFlag` function (~line 44-49), the `listFlags` function (~line 51-53), and remove `prototypeFlags` from the schema import on line 2 (keep `prototypeRuns`). If a `FlagInput`/related type exists only for these, remove it too.

- [ ] **Step 4: Typecheck + full suite**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: clean; suite green (any test that imported the deleted components would have been deleted with its component in the 2026-06-03 sweep — if one remains, delete it and say so in the commit).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(flags): sweep dead M-trial flag chain (A3) — FlagDialog is the survivor"
```

---

### Task 9: Docs honesty pass + STATE.md + ship

**Files:**
- Modify: `docs/executive-brief.html`, `docs/superpowers/vision/gc-curriculum-tool-vision.md`, `docs/superpowers/vision/gc-curriculum-tool-vision.html`, `docs/STATE.md`

- [ ] **Step 1: Rewrite the executive brief trust bullet**

In `docs/executive-brief.html`, the "Trust and governance" section's first `<li>` currently reads:

> `<li><strong>Every AI reading is disputable.</strong> A "Flag" button with a note field is attached to every judgment. Flags persist; they are not silently overwritten on the next re-score. Patterns of flagged disagreement update the prompts the system uses, so the tool sharpens over time.</li>`

Replace with (note: the prompts-update sentence is REMOVED, not softened — that loop is unbuilt):

```html
  <li><strong>Every AI reading is disputable.</strong> Every depth score is editable before a snapshot is confirmed, and a ⚑ Flag button on each program-matrix cell and each profile competency files a named dispute note. Flags persist across re-scores — if a flagged score changes, the change is shown alongside the flag, never applied silently — and stay open until someone resolves them with a recorded name, note, and date. An on-demand adversarial stress-test gives every draft profile a second, skeptical AI reading before faculty confirm it.</li>
```

Also re-check the "Why this matters" paragraph (~line 197) which says judgments are "<strong>disputable</strong> (every AI reading can be flagged with a faculty note that persists across re-scores)" — that sentence becomes TRUE after this build; leave it.

- [ ] **Step 2: Fix the vision doc's flag claims**

In `docs/superpowers/vision/gc-curriculum-tool-vision.md`, search for `flag` (case-insensitive). Wherever it claims prompt-updating from flag patterns, remove that clause; wherever it describes the flag/dispute trail, align the wording with the mechanism actually built (persists until explicitly resolved; drift shown, never silent). Mirror each edit in the `.html` sibling (search for the same sentence — the HTML is a styled export of the md). Do not rewrite unrelated prose.

- [ ] **Step 3: Update STATE.md (same commit — routes + schema + surface changed)**

- "What's live" cross-cutting table: add a **Faculty dispute flags** row (2026-06-12): `faculty_flags` table (migration 0034), ⚑ on `/program` matrix cells + cell drawer + review-panel competencies, "⚑ N open" panel with explicit resolve, drift display; routes `POST/GET /api/flags`, `PATCH /api/flags/[id]`.
- Schema section: prepend migration `0034` (faculty_flags + 2 enums) to the migration lineage paragraph.
- Next-up: check off A1/A3 in the vision-alignment-review pointer line (e.g. "A1+A3 shipped 2026-06-12").
- Deferred/debt: add one line — "`prototype_flags` table retained after the dead-chain sweep (dropping it is a standalone migration decision); profile-competency flags resurface on EXACT statement match only (fuzzy matching deliberately out of scope — unmatched flags still appear in the /program roll-up)."

- [ ] **Step 4: Full verification**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: clean, full suite green.

- [ ] **Step 5: Commit**

```bash
git add docs/executive-brief.html docs/superpowers/vision/ docs/STATE.md
git commit -m "docs(flags): brief + vision now describe the real dispute mechanism (A1); STATE.md updated"
```

- [ ] **Step 6: Deploy (operator-confirmed)**

```bash
git -C ~/projects/curriculum_developer-deploy merge --ff-only dev   # if working on dev; otherwise merge the feature branch to main per repo convention
git push origin dev main
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/      # expect 200
```

Then a live click-test: open `/program?slug=…`, flag a cell, see the marker + panel; resolve it; flag a competency in a capture review panel.

---

## Plan self-review (done at write time)

- **Spec coverage:** schema/keying (T1), pure logic + drift (T2), queries + explicit-resolve (T3), 3 routes + read-time annotation (T4), FlagDialog + roster identity (T5), matrix markers/drawer/panel (T6), review-panel action (T7), dead-chain sweep (T8), brief/vision reword + "patterns" sentence removal + STATE.md (T9). The spec's error-handling table maps to: inline dialog/panel errors (T5/T6), no-longer-in-matrix annotation (T4/T6), 409 concurrent resolve (T3/T4).
- **Type consistency:** `FlagLike`/`DriftEntry` (T2) ↔ `AnnotatedFlag` (T6) ↔ route payloads (T4) all use `{k,u,d}` nullable numbers; `onSubmit(note, flaggedBy)` signature consistent across T5/T6/T7; `FlaggedContext` defined once in schema.ts (T1) and imported by T3.
- **Known judgment call:** `FlaggedContext` interface lives in `lib/db/schema.ts` next to the jsonb `$type` it types — matches how the codebase types other jsonb columns.


