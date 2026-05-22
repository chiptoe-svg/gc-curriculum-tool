# Course Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 5-stage Course Builder workflow inside `/preview/[slug]/courses/[code]` — schema additions, KUD authoring API, tabbed UI, and approval gate in CourseSelector.

**Architecture:** Extend the existing per-course page into a 4-tab layout (Info / Materials / Profile / KUDs). Three new tables (`builder_status` column on `courses`, `course_kuds`, `course_kud_runs`) back a new KUD authoring pipeline. Five new API endpoints plus an updated courses list endpoint drive the UI. CourseSelector gains a visual approval gate.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM (Neon Postgres), Zod, Vitest, Tailwind CSS, OpenAI SDK (via existing `lib/ai/provider.ts`)

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `lib/db/schema.ts` | Modify | Add `builderStatus` to `courses`; add `courseKudRuns` and `courseKuds` tables |
| `lib/domain/types.ts` | Modify | Add `CourseKudResult` type |
| `lib/ai/schemas.ts` | Modify | Add `courseKudResultSchema` + `courseKudResultJsonSchema` |
| `lib/ai/prompts/extract-course-kud.md` | Create | Structured-input KUD generation prompt |
| `lib/ai/analyze/kud-generate.ts` | Create | `generateCourseKud()` AI function |
| `lib/db/course-kud-queries.ts` | Create | All DB operations for KUD tables |
| `lib/db/__tests__/course-kud-queries.test.ts` | Create | Unit tests for kud queries |
| `lib/db/courses-queries.ts` | Modify | Add `updateBuilderStatus`, `listApprovedCourses`; update `listCoursesWithStatus` |
| `lib/db/__tests__/courses-queries.test.ts` | Modify | Tests for new query functions |
| `app/api/courses/route.ts` | Modify | Add `?approved=true` filter |
| `app/api/courses/__tests__/route.test.ts` | Modify | Test the new filter param |
| `app/api/courses/[code]/builder/route.ts` | Create | `GET` — full builder state hydration |
| `app/api/courses/[code]/profile/route.ts` | Modify | Add `PUT` handler — update structured fields + builder_status |
| `app/api/courses/[code]/kuds/route.ts` | Create | `PUT` — save KUD draft |
| `app/api/courses/[code]/kuds/generate/route.ts` | Create | `POST` — trigger KUD generation run |
| `app/api/courses/[code]/kuds/accept/route.ts` | Create | `POST` — accept KUDs, set approved |
| `tests/api/course-builder.test.ts` | Create | API tests for builder, profile PUT, kuds endpoints |
| `components/CourseSelector.tsx` | Modify | Gray out unapproved courses; pass `builderStatus` in list |
| `app/preview/[slug]/courses/[code]/CourseBuilderClient.tsx` | Create | 4-tab shell (client component) |
| `app/preview/[slug]/courses/[code]/CourseInfoTab.tsx` | Create | Stage 1 — read-only catalog info display |
| `app/preview/[slug]/courses/[code]/BuilderProfileTab.tsx` | Create | Stage 3 — editable learningObjectives / majorProjects / skillsRequired |
| `app/preview/[slug]/courses/[code]/KudReviewTab.tsx` | Create | Stage 4 — generate / review / accept KUDs |
| `app/preview/[slug]/courses/[code]/page.tsx` | Modify | Replace linear layout with `CourseBuilderClient` |
| `app/preview/[slug]/courses/page.tsx` | Modify | StatusBadge → show `builderStatus` |

---

## Task 1: Schema additions + migration

**Files:**
- Modify: `lib/db/schema.ts`
- Run: `pnpm db:generate` then `pnpm db:migrate`

- [ ] **Step 1: Add `builderStatus` column to the `courses` table in `lib/db/schema.ts`**

In the `courses` pgTable definition (line 80), add after `lastSyncedAt`:

```typescript
builderStatus: text('builder_status').notNull().default('draft'),
```

The full updated `courses` table tail:
```typescript
  skillsRequired: jsonb('skills_required').$type<string[]>().notNull().default([]),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow().notNull(),
  builderStatus: text('builder_status').notNull().default('draft'),
});
```

- [ ] **Step 2: Add `courseKudRuns` table to `lib/db/schema.ts`** — insert after the `courseProfileRuns` definition (after line 230):

```typescript
export const courseKudRuns = pgTable('course_kud_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  result: jsonb('result').$type<{
    thresholdConcept: string;
    know: string[];
    understand: string[];
    do: string[];
    confidenceNotes: string;
  }>().notNull(),
  profileSnapshot: jsonb('profile_snapshot').$type<{
    learningObjectives: string[];
    majorProjects: string[];
    skillsRequired: string[];
  }>().notNull(),
  model: text('model').notNull(),
  costUsdCents: integer('cost_usd_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 3: Add `courseKuds` table** — insert after `courseKudRuns`:

```typescript
export const courseKuds = pgTable('course_kuds', {
  courseCode: text('course_code').primaryKey().references(() => courses.code, { onDelete: 'cascade' }),
  thresholdConcept: text('threshold_concept').notNull(),
  know: jsonb('know').$type<string[]>().notNull().default([]),
  understand: jsonb('understand').$type<string[]>().notNull().default([]),
  do: jsonb('do').$type<string[]>().notNull().default([]),
  manuallyEdited: boolean('manually_edited').notNull().default(false),
  sourceRunId: uuid('source_run_id').references(() => courseKudRuns.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedByIpHash: text('approved_by_ip_hash'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 4: Generate the migration**

```bash
pnpm db:generate
```

Expected: a new file appears in `drizzle/` named `0012_*.sql` containing `ALTER TABLE courses ADD COLUMN builder_status`, `CREATE TABLE course_kud_runs`, `CREATE TABLE course_kuds`.

- [ ] **Step 5: Apply the migration**

```bash
pnpm db:migrate
```

Expected: `migrations applied successfully` with no errors.

- [ ] **Step 6: Verify the tests still pass**

```bash
pnpm test
```

Expected: all existing tests pass (schema change is backwards-compatible — new column has a default).

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(schema): add builder_status to courses, add course_kuds and course_kud_runs tables"
```

---

## Task 2: CourseKudResult type + AI schemas

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/ai/schemas.ts`

- [ ] **Step 1: Write a failing test** for the new Zod schema — create `lib/db/__tests__/course-kud-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { courseKudResultSchema } from '@/lib/ai/schemas';

const valid = {
  thresholdConcept: 'Color is a physical interaction, not a file property.',
  know: ['CMYK model', 'Halftone mechanics', 'Substrate compatibility'],
  understand: ['Why dot gain propagates', 'How ink adhesion works', 'Why process choice affects cost'],
  do: ['Select and justify a Pantone standard', 'Conduct ink-substrate testing', 'Interpret results against tolerance'],
  confidenceNotes: 'Do bullets grounded in Brand Color Report and Ink Lab. Know/Understand inferred from lecture outcomes.',
};

describe('courseKudResultSchema', () => {
  it('accepts a valid result', () => {
    expect(() => courseKudResultSchema.parse(valid)).not.toThrow();
  });

  it('rejects missing thresholdConcept', () => {
    const { thresholdConcept: _, ...rest } = valid;
    expect(() => courseKudResultSchema.parse(rest)).toThrow();
  });

  it('rejects fewer than 3 know bullets', () => {
    expect(() => courseKudResultSchema.parse({ ...valid, know: ['one', 'two'] })).toThrow();
  });

  it('rejects more than 5 do bullets', () => {
    expect(() => courseKudResultSchema.parse({ ...valid, do: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test lib/db/__tests__/course-kud-schema.test.ts
```

Expected: FAIL — `courseKudResultSchema is not exported from @/lib/ai/schemas`

- [ ] **Step 3: Add `CourseKudResult` to `lib/domain/types.ts`** — append after the `KUDOutcomes` interface (after line 52):

```typescript
export interface CourseKudResult {
  thresholdConcept: string;
  know: string[];
  understand: string[];
  do: string[];
  confidenceNotes: string;
}
```

- [ ] **Step 4: Add `courseKudResultSchema` and `courseKudResultJsonSchema` to `lib/ai/schemas.ts`** — append at the end of the file:

```typescript
// ── Course Builder KUD result schema ────────────────────────────────────────

export const courseKudResultSchema = z.object({
  thresholdConcept: z.string().min(1),
  know: z.array(z.string().min(1)).min(3).max(5),
  understand: z.array(z.string().min(1)).min(3).max(5),
  do: z.array(z.string().min(1)).min(3).max(5),
  confidenceNotes: z.string().min(1),
});

export const courseKudResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['thresholdConcept', 'know', 'understand', 'do', 'confidenceNotes'],
  properties: {
    thresholdConcept: { type: 'string', minLength: 1 },
    know: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string', minLength: 1 } },
    understand: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string', minLength: 1 } },
    do: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string', minLength: 1 } },
    confidenceNotes: { type: 'string', minLength: 1 },
  },
} as const;
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm test lib/db/__tests__/course-kud-schema.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/domain/types.ts lib/ai/schemas.ts lib/db/__tests__/course-kud-schema.test.ts
git commit -m "feat(types): add CourseKudResult type and courseKudResult Zod/JSON schemas"
```

---

## Task 3: KUD generation prompt + AI function

**Files:**
- Create: `lib/ai/prompts/extract-course-kud.md`
- Create: `lib/ai/analyze/kud-generate.ts`

- [ ] **Step 1: Create `lib/ai/prompts/extract-course-kud.md`**

```markdown
---
name: extract-course-kud
manning_skills:
  - Backwards Design (D7)
  - KUD Chart Authoring (D7)
  - Threshold Concept Translation (D7)
includes:
  - shared/kud-rubric.md
---

# Task

You are drafting course-level KUD outcomes from a structured course profile. The instructor has provided their course's learning objectives, major projects, and required incoming skills. Work from these — especially the major projects, which are the highest-stakes evidence of what students actually *do*.

# Input format

The user message contains:
- **Course title and description** — catalog baseline
- **Learning objectives** — what the course claims students will achieve
- **Major projects** — the highest-stakes assignments (ordered by weight; first is most important)
- **Required incoming skills** — what students need to arrive knowing

# Process

1. Read the major projects first. The Do bullets must be grounded in what the projects actually require students to perform.
2. Identify the threshold concept: the one idea that, once grasped, reorganizes how students see this domain. This is not a topic — it is a conceptual shift.
3. Draft 3–5 Know bullets: facts, frameworks, and terminology students should be able to recall.
4. Draft 3–5 Understand bullets: explanations students should be able to give about why and how.
5. Draft 3–5 Do bullets: transferable performances students could execute in a new context.
6. Write brief confidence notes: flag any bullet that is inferred rather than directly evidenced by the projects. If a Do bullet is aspirational but the projects only reach Understand level, say so.

# Constraints

- Each bullet is a single sentence in student-can-do form (write the capability, not "Students will Know X").
- Do bullets must describe transferable performances — what students could do outside this specific course, not just inside it.
- Do NOT reference any career path or industry target. Outcomes are derived from this course's content alone.
- The threshold concept is one sentence: a conceptual claim, not a topic list.

# Output

Return JSON matching the supplied schema.
```

- [ ] **Step 2: Create `lib/ai/analyze/kud-generate.ts`**

```typescript
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { courseKudResultSchema, courseKudResultJsonSchema } from '@/lib/ai/schemas';
import type { CourseKudResult } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface GenerateCourseKudArgs {
  title: string;
  description: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

function formatInput(args: GenerateCourseKudArgs): string {
  const lines: string[] = [
    `**Course:** ${args.title}`,
    `**Description:** ${args.description || '(none)'}`,
    '',
    '**Learning objectives:**',
    ...args.learningObjectives.map((o, i) => `${i + 1}. ${o}`),
    '',
    '**Major projects (highest-stakes first):**',
    ...args.majorProjects.map((p, i) => `${i + 1}. ${p}`),
    '',
    '**Required incoming skills:**',
    ...args.skillsRequired.map((s, i) => `${i + 1}. ${s}`),
  ];
  if (args.learningObjectives.length === 0) lines.splice(3, 2, '**Learning objectives:** (none)');
  if (args.majorProjects.length === 0) lines.splice(-4, 4, '**Major projects:** (none — KUD draft will rely on catalog description only)');
  if (args.skillsRequired.length === 0) lines.push('(none)');
  return lines.join('\n');
}

export async function generateCourseKud(args: GenerateCourseKudArgs): Promise<{
  data: CourseKudResult;
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('extract-course-kud');
  const provider = getProvider();
  const result = await provider.complete({
    systemPrompt,
    userMessage: formatInput(args),
    schemaName: 'course_kud_result',
    jsonSchema: courseKudResultJsonSchema,
    validate: (raw) => courseKudResultSchema.parse(raw),
  });
  return {
    data: result.data,
    telemetry: {
      costUsdCents: result.costUsdCents,
      cachedTokens: result.cachedTokens,
      uncachedPromptTokens: result.uncachedPromptTokens,
      completionTokens: result.completionTokens,
    },
  };
}
```

- [ ] **Step 3: Run the full test suite to confirm nothing is broken**

```bash
pnpm test
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/extract-course-kud.md lib/ai/analyze/kud-generate.ts
git commit -m "feat(ai): add extract-course-kud prompt and generateCourseKud function"
```

---

## Task 4: Course KUD DB queries

**Files:**
- Create: `lib/db/course-kud-queries.ts`
- Create: `lib/db/__tests__/course-kud-queries.test.ts`

- [ ] **Step 1: Write failing tests** in `lib/db/__tests__/course-kud-queries.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbInsertReturning = vi.fn();
const dbUpdateWhere = vi.fn();
const dbSelectFromWhere = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: dbInsertReturning, onConflictDoUpdate: () => Promise.resolve() }) }),
    update: () => ({ set: () => ({ where: dbUpdateWhere }) }),
    select: () => ({ from: () => ({ where: dbSelectFromWhere }) }),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  courseKuds: {},
  courseKudRuns: {},
}));

import {
  getCourseKud,
  insertKudRun,
  upsertCourseKud,
  acceptCourseKud,
  listKudRunsForCourse,
} from '@/lib/db/course-kud-queries';
import type { CourseKudResult } from '@/lib/domain/types';

beforeEach(() => vi.clearAllMocks());

const fakeResult: CourseKudResult = {
  thresholdConcept: 'Color is a physical interaction.',
  know: ['CMYK model', 'Halftone mechanics', 'Substrate compatibility'],
  understand: ['Why dot gain propagates', 'How adhesion works', 'Why process choice matters'],
  do: ['Select Pantone standard', 'Conduct testing', 'Interpret results'],
  confidenceNotes: 'Do bullets grounded in labs.',
};

describe('getCourseKud', () => {
  it('returns null when no record exists', async () => {
    dbSelectFromWhere.mockResolvedValue([]);
    expect(await getCourseKud('GC 3460')).toBeNull();
  });

  it('returns the kud row when it exists', async () => {
    const row = { courseCode: 'GC 3460', thresholdConcept: 'Color is physical.', know: [], understand: [], do: [], manuallyEdited: false, sourceRunId: null, approvedAt: null, approvedByIpHash: null, updatedAt: new Date() };
    dbSelectFromWhere.mockResolvedValue([row]);
    const result = await getCourseKud('GC 3460');
    expect(result?.courseCode).toBe('GC 3460');
  });
});

describe('insertKudRun', () => {
  it('inserts a run row and returns the id', async () => {
    dbInsertReturning.mockResolvedValue([{ id: 'run-uuid-1' }]);
    const id = await insertKudRun({
      courseCode: 'GC 3460',
      result: fakeResult,
      profileSnapshot: { learningObjectives: [], majorProjects: [], skillsRequired: [] },
      model: 'claude-sonnet-4-6',
      costUsdCents: 12,
    });
    expect(id).toBe('run-uuid-1');
  });

  it('throws when no row returned', async () => {
    dbInsertReturning.mockResolvedValue([]);
    await expect(insertKudRun({
      courseCode: 'GC 3460',
      result: fakeResult,
      profileSnapshot: { learningObjectives: [], majorProjects: [], skillsRequired: [] },
      model: 'claude-sonnet-4-6',
      costUsdCents: 12,
    })).rejects.toThrow('insertKudRun: no row returned');
  });
});

describe('upsertCourseKud', () => {
  it('calls update (upsert via onConflictDoUpdate)', async () => {
    dbInsertReturning.mockResolvedValue([]);
    await upsertCourseKud({
      courseCode: 'GC 3460',
      thresholdConcept: fakeResult.thresholdConcept,
      know: fakeResult.know,
      understand: fakeResult.understand,
      do: fakeResult.do,
      sourceRunId: 'run-uuid-1',
    });
    expect(dbInsertReturning).toHaveBeenCalledTimes(1);
  });
});

describe('acceptCourseKud', () => {
  it('updates the row with approvedAt and ipHash', async () => {
    dbUpdateWhere.mockResolvedValue(undefined);
    await acceptCourseKud('GC 3460', new Date(), 'abc123hash');
    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
  });
});

describe('listKudRunsForCourse', () => {
  it('returns empty array when no runs exist', async () => {
    dbSelectFromWhere.mockReturnValue({ orderBy: () => Promise.resolve([]) });
    expect(await listKudRunsForCourse('GC 3460')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test lib/db/__tests__/course-kud-queries.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/db/course-kud-queries.ts`**

```typescript
import { eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseKuds, courseKudRuns } from '@/lib/db/schema';
import type { CourseKudResult } from '@/lib/domain/types';

export async function getCourseKud(courseCode: string) {
  const rows = await db.select().from(courseKuds).where(eq(courseKuds.courseCode, courseCode));
  return rows[0] ?? null;
}

export interface InsertKudRunInput {
  courseCode: string;
  result: CourseKudResult;
  profileSnapshot: { learningObjectives: string[]; majorProjects: string[]; skillsRequired: string[] };
  model: string;
  costUsdCents: number;
}

export async function insertKudRun(input: InsertKudRunInput): Promise<string> {
  const [row] = await db
    .insert(courseKudRuns)
    .values(input)
    .returning({ id: courseKudRuns.id });
  if (!row) throw new Error('insertKudRun: no row returned');
  return row.id;
}

export interface UpsertCourseKudInput {
  courseCode: string;
  thresholdConcept: string;
  know: string[];
  understand: string[];
  do: string[];
  sourceRunId: string;
}

export async function upsertCourseKud(input: UpsertCourseKudInput): Promise<void> {
  await db
    .insert(courseKuds)
    .values({
      courseCode: input.courseCode,
      thresholdConcept: input.thresholdConcept,
      know: input.know,
      understand: input.understand,
      do: input.do,
      sourceRunId: input.sourceRunId,
      manuallyEdited: false,
      updatedAt: new Date(),
    })
    .returning();
}

export async function saveKudDraft(input: {
  courseCode: string;
  thresholdConcept: string;
  know: string[];
  understand: string[];
  do: string[];
  manuallyEdited: boolean;
}): Promise<void> {
  await db
    .update(courseKuds)
    .set({
      thresholdConcept: input.thresholdConcept,
      know: input.know,
      understand: input.understand,
      do: input.do,
      manuallyEdited: input.manuallyEdited,
      updatedAt: new Date(),
    })
    .where(eq(courseKuds.courseCode, input.courseCode));
}

export async function acceptCourseKud(
  courseCode: string,
  approvedAt: Date,
  approvedByIpHash: string,
): Promise<void> {
  await db
    .update(courseKuds)
    .set({ approvedAt, approvedByIpHash, updatedAt: new Date() })
    .where(eq(courseKuds.courseCode, courseCode));
}

export async function resetKudApproval(courseCode: string): Promise<void> {
  await db
    .update(courseKuds)
    .set({ approvedAt: null, approvedByIpHash: null, updatedAt: new Date() })
    .where(eq(courseKuds.courseCode, courseCode));
}

export async function listKudRunsForCourse(courseCode: string) {
  const rows = await db
    .select()
    .from(courseKudRuns)
    .where(eq(courseKudRuns.courseCode, courseCode))
    .orderBy(desc(courseKudRuns.createdAt));
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test lib/db/__tests__/course-kud-queries.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/course-kud-queries.ts lib/db/__tests__/course-kud-queries.test.ts
git commit -m "feat(db): add course-kud-queries — getCourseKud, insertKudRun, upsertCourseKud, acceptCourseKud"
```

---

## Task 5: Update courses-queries (builder_status support)

**Files:**
- Modify: `lib/db/courses-queries.ts`
- Modify: `lib/db/__tests__/courses-queries.test.ts`

- [ ] **Step 1: Add failing tests** — append to `lib/db/__tests__/courses-queries.test.ts`:

```typescript
import { updateBuilderStatus, listApprovedCourses } from '@/lib/db/courses-queries';

describe('updateBuilderStatus', () => {
  it('exports the function', () => {
    expect(typeof updateBuilderStatus).toBe('function');
  });
});

describe('listApprovedCourses', () => {
  it('exports the function', () => {
    expect(typeof listApprovedCourses).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test lib/db/__tests__/courses-queries.test.ts
```

Expected: FAIL — `updateBuilderStatus` and `listApprovedCourses` not exported.

- [ ] **Step 3: Add to `lib/db/courses-queries.ts`**

Update `CourseListItem` to include `builderStatus`:
```typescript
export interface CourseListItem {
  code: string;
  title: string;
  level: number;
  track: string;
  builderStatus: string;
}
```

Update `listCourses()` to select the new field:
```typescript
export async function listCourses(): Promise<CourseListItem[]> {
  const rows = await db
    .select({
      code: courses.code,
      title: courses.title,
      level: courses.level,
      track: courses.track,
      builderStatus: courses.builderStatus,
    })
    .from(courses)
    .orderBy(asc(courses.code));
  return rows;
}
```

Add after `getSyncState()`:
```typescript
export async function updateBuilderStatus(
  courseCode: string,
  status: 'draft' | 'materials_uploaded' | 'profile_complete' | 'kuds_generated' | 'approved',
): Promise<void> {
  await db.update(courses).set({ builderStatus: status }).where(eq(courses.code, courseCode));
}

export async function listApprovedCourses(): Promise<CourseListItem[]> {
  const rows = await db
    .select({
      code: courses.code,
      title: courses.title,
      level: courses.level,
      track: courses.track,
      builderStatus: courses.builderStatus,
    })
    .from(courses)
    .where(eq(courses.builderStatus, 'approved'))
    .orderBy(asc(courses.code));
  return rows;
}
```

Update `listCoursesWithStatus()` to include `builderStatus` in the select and return:
```typescript
export interface CourseWithStatus {
  code: string;
  title: string;
  level: number;
  track: string;
  builderStatus: string;
  profileExists: boolean;
  manuallyEdited: boolean;
  materialCount: number;
}

export async function listCoursesWithStatus(): Promise<CourseWithStatus[]> {
  const rows = await db
    .select({
      code: courses.code,
      title: courses.title,
      level: courses.level,
      track: courses.track,
      builderStatus: courses.builderStatus,
      manuallyEdited: courseProfiles.manuallyEdited,
      materialCount: count(courseMaterials.id),
    })
    .from(courses)
    .leftJoin(courseProfiles, eq(courses.code, courseProfiles.courseCode))
    .leftJoin(courseMaterials, eq(courses.code, courseMaterials.courseCode))
    .groupBy(courses.code, courses.title, courses.level, courses.track, courses.builderStatus, courseProfiles.manuallyEdited)
    .orderBy(sql`${courses.level} asc, ${courses.code} asc`);

  return rows.map((r) => ({
    code: r.code,
    title: r.title,
    level: r.level,
    track: r.track,
    builderStatus: r.builderStatus,
    profileExists: r.manuallyEdited !== null,
    manuallyEdited: r.manuallyEdited ?? false,
    materialCount: Number(r.materialCount),
  }));
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test lib/db/__tests__/courses-queries.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/courses-queries.ts lib/db/__tests__/courses-queries.test.ts
git commit -m "feat(db): add updateBuilderStatus and listApprovedCourses; add builderStatus to CourseListItem"
```

---

## Task 6: API endpoints — GET /builder and PUT /profile

**Files:**
- Create: `app/api/courses/[code]/builder/route.ts`
- Modify: `app/api/courses/[code]/profile/route.ts`
- Create: `tests/api/course-builder.test.ts`

- [ ] **Step 1: Write failing tests** — create `tests/api/course-builder.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCourseByCode, updateBuilderStatus } = vi.hoisted(() => ({
  getCourseByCode: vi.fn(),
  updateBuilderStatus: vi.fn(),
}));
const { listMaterialsByCourse } = vi.hoisted(() => ({ listMaterialsByCourse: vi.fn() }));
const { getCourseKud, listKudRunsForCourse, resetKudApproval } = vi.hoisted(() => ({
  getCourseKud: vi.fn(),
  listKudRunsForCourse: vi.fn(),
  resetKudApproval: vi.fn(),
}));

vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode, updateBuilderStatus }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse }));
vi.mock('@/lib/db/course-kud-queries', () => ({ getCourseKud, listKudRunsForCourse, resetKudApproval }));
vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));

import { GET } from '@/app/api/courses/[code]/builder/route';
import { PUT } from '@/app/api/courses/[code]/profile/route';

const ctx = { params: Promise.resolve({ code: 'GC%203460' }) };

const fakeCourse = {
  code: 'GC 3460',
  title: 'Ink and Substrates',
  level: 3,
  track: 'Print',
  description: 'Advanced print science.',
  prerequisites: 'GC 2070',
  syllabusUrl: null,
  learningObjectives: ['Understand ink formulation'],
  majorProjects: ['Brand Color Report'],
  skillsRequired: ['Color theory'],
  lastSyncedAt: new Date(),
  builderStatus: 'profile_complete',
};

beforeEach(() => {
  vi.clearAllMocks();
  listMaterialsByCourse.mockResolvedValue([]);
  getCourseKud.mockResolvedValue(null);
  listKudRunsForCourse.mockReturnValue({ orderBy: () => Promise.resolve([]) });
  updateBuilderStatus.mockResolvedValue(undefined);
  resetKudApproval.mockResolvedValue(undefined);
});

describe('GET /api/courses/[code]/builder', () => {
  it('401s on invalid slug', async () => {
    const req = new Request('http://test/api/courses/GC%203460/builder?slug=bad');
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
  });

  it('404s when course not found', async () => {
    getCourseByCode.mockResolvedValue(null);
    const req = new Request('http://test/api/courses/GC%203460/builder?slug=valid-slug');
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns full builder state with 200', async () => {
    getCourseByCode.mockResolvedValue(fakeCourse);
    const req = new Request('http://test/api/courses/GC%203460/builder?slug=valid-slug');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.course.code).toBe('GC 3460');
    expect(body.course.builderStatus).toBe('profile_complete');
    expect(body.kud.current).toBeNull();
    expect(body.materials).toEqual([]);
  });
});

describe('PUT /api/courses/[code]/profile', () => {
  function makeReq(body: unknown) {
    return new Request('http://test/api/courses/GC%203460/profile?slug=valid-slug', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('401s on invalid slug', async () => {
    const req = new Request('http://test/api/courses/GC%203460/profile?slug=bad', {
      method: 'PUT',
      body: JSON.stringify({}),
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(401);
  });

  it('400s on invalid body', async () => {
    getCourseByCode.mockResolvedValue(fakeCourse);
    const res = await PUT(makeReq({ invalid: true }), ctx);
    expect(res.status).toBe(400);
  });

  it('advances status to profile_complete when all fields have content', async () => {
    getCourseByCode.mockResolvedValue(fakeCourse);
    const res = await PUT(makeReq({
      learningObjectives: ['obj1'],
      majorProjects: ['proj1'],
      skillsRequired: ['skill1'],
    }), ctx);
    expect(res.status).toBe(200);
    expect(updateBuilderStatus).toHaveBeenCalledWith('GC 3460', 'profile_complete');
  });

  it('resets approval and clears approved_at when course was approved', async () => {
    getCourseByCode.mockResolvedValue({ ...fakeCourse, builderStatus: 'approved' });
    const res = await PUT(makeReq({
      learningObjectives: ['obj1'],
      majorProjects: ['proj1'],
      skillsRequired: ['skill1'],
    }), ctx);
    expect(res.status).toBe(200);
    expect(resetKudApproval).toHaveBeenCalledWith('GC 3460');
    expect(updateBuilderStatus).toHaveBeenCalledWith('GC 3460', 'profile_complete');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test tests/api/course-builder.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create `app/api/courses/[code]/builder/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCourseKud, listKudRunsForCourse } from '@/lib/db/course-kud-queries';

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const [rawMaterials, currentKud, kudRuns] = await Promise.all([
    listMaterialsByCourse(courseCode),
    getCourseKud(courseCode),
    listKudRunsForCourse(courseCode),
  ]);

  return NextResponse.json({
    course: {
      code: course.code,
      title: course.title,
      level: course.level,
      track: course.track,
      description: course.description,
      prerequisites: course.prerequisites,
      learningObjectives: course.learningObjectives,
      majorProjects: course.majorProjects,
      skillsRequired: course.skillsRequired,
      builderStatus: course.builderStatus,
    },
    materials: rawMaterials.map((m) => ({
      id: m.id,
      fileName: m.fileName,
      extractionStatus: m.extractionStatus,
      extractionMethod: m.extractionMethod,
      pageCount: m.pageCount,
    })),
    kud: {
      current: currentKud
        ? {
            thresholdConcept: currentKud.thresholdConcept,
            know: currentKud.know as string[],
            understand: currentKud.understand as string[],
            do: currentKud.do as string[],
            manuallyEdited: currentKud.manuallyEdited,
            sourceRunId: currentKud.sourceRunId,
            approvedAt: currentKud.approvedAt?.toISOString() ?? null,
          }
        : null,
      runs: kudRuns.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        model: r.model,
        costUsdCents: r.costUsdCents,
      })),
    },
  });
}
```

- [ ] **Step 4: Add `PUT` handler to `app/api/courses/[code]/profile/route.ts`**

Add these imports at the top if not already present:
```typescript
import { getCourseByCode, updateBuilderStatus } from '@/lib/db/courses-queries';
import { resetKudApproval } from '@/lib/db/course-kud-queries';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
```

Add this `PUT` export to the existing route file:

```typescript
const builderProfileSchema = z.object({
  learningObjectives: z.array(z.string()),
  majorProjects: z.array(z.string()),
  skillsRequired: z.array(z.string()),
});

export async function PUT(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const parsed = builderProfileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    await db.update(courses).set({
      learningObjectives: parsed.data.learningObjectives,
      majorProjects: parsed.data.majorProjects,
      skillsRequired: parsed.data.skillsRequired,
    }).where(eq(courses.code, courseCode));

    const wasApprovedOrGenerated = course.builderStatus === 'approved' || course.builderStatus === 'kuds_generated';
    if (wasApprovedOrGenerated) {
      await resetKudApproval(courseCode);
    }

    const hasContent =
      parsed.data.learningObjectives.length > 0 &&
      parsed.data.majorProjects.length > 0 &&
      parsed.data.skillsRequired.length > 0;

    if (hasContent) {
      await updateBuilderStatus(courseCode, 'profile_complete');
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`PUT /api/courses/${courseCode}/profile failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm test tests/api/course-builder.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full suite**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/api/courses/[code]/builder/ app/api/courses/[code]/profile/route.ts tests/api/course-builder.test.ts
git commit -m "feat(api): add GET /courses/[code]/builder and PUT /courses/[code]/profile builder endpoints"
```

---

## Task 7: KUD generate, save, and accept endpoints

**Files:**
- Create: `app/api/courses/[code]/kuds/generate/route.ts`
- Create: `app/api/courses/[code]/kuds/route.ts`
- Create: `app/api/courses/[code]/kuds/accept/route.ts`
- Create: `tests/api/course-kuds.test.ts`

- [ ] **Step 1: Write failing tests** — create `tests/api/course-kuds.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCourseByCode, updateBuilderStatus } = vi.hoisted(() => ({
  getCourseByCode: vi.fn(),
  updateBuilderStatus: vi.fn(),
}));
const { generateCourseKud } = vi.hoisted(() => ({ generateCourseKud: vi.fn() }));
const { insertKudRun, upsertCourseKud, saveKudDraft, acceptCourseKud, getCourseKud } = vi.hoisted(() => ({
  insertKudRun: vi.fn(),
  upsertCourseKud: vi.fn(),
  saveKudDraft: vi.fn(),
  acceptCourseKud: vi.fn(),
  getCourseKud: vi.fn(),
}));
const { checkIpRateLimit } = vi.hoisted(() => ({ checkIpRateLimit: vi.fn() }));
const { hashIp } = vi.hoisted(() => ({ hashIp: vi.fn().mockReturnValue('hashed-ip') }));

vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode, updateBuilderStatus }));
vi.mock('@/lib/ai/analyze/kud-generate', () => ({ generateCourseKud }));
vi.mock('@/lib/db/course-kud-queries', () => ({ insertKudRun, upsertCourseKud, saveKudDraft, acceptCourseKud, getCourseKud }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit }));
vi.mock('@/lib/ip-hash', () => ({ hashIp }));
vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));

import { POST as generatePost } from '@/app/api/courses/[code]/kuds/generate/route';
import { PUT as kudsPut } from '@/app/api/courses/[code]/kuds/route';
import { POST as acceptPost } from '@/app/api/courses/[code]/kuds/accept/route';

const ctx = { params: Promise.resolve({ code: 'GC%203460' }) };

const fakeCourse = {
  code: 'GC 3460', title: 'Ink and Substrates', level: 3, track: 'Print',
  description: 'Advanced print.', prerequisites: '', syllabusUrl: null,
  learningObjectives: ['obj1'], majorProjects: ['proj1'], skillsRequired: ['skill1'],
  lastSyncedAt: new Date(), builderStatus: 'profile_complete',
};

const fakeKudResult = {
  thresholdConcept: 'Color is physical.',
  know: ['CMYK model', 'Halftone mechanics', 'Substrate types'],
  understand: ['Why dot gain matters', 'How adhesion works', 'Why process choice matters'],
  do: ['Select Pantone standard', 'Conduct ink testing', 'Interpret results'],
  confidenceNotes: 'Strong Do evidence.',
};

beforeEach(() => {
  vi.clearAllMocks();
  updateBuilderStatus.mockResolvedValue(undefined);
  insertKudRun.mockResolvedValue('run-uuid-1');
  upsertCourseKud.mockResolvedValue(undefined);
  saveKudDraft.mockResolvedValue(undefined);
  acceptCourseKud.mockResolvedValue(undefined);
  checkIpRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
});

describe('POST /api/courses/[code]/kuds/generate', () => {
  it('401s on invalid slug', async () => {
    const req = new Request('http://test/api/courses/GC%203460/kuds/generate?slug=bad', { method: 'POST' });
    const res = await generatePost(req, ctx);
    expect(res.status).toBe(401);
  });

  it('404s when course not found', async () => {
    getCourseByCode.mockResolvedValue(null);
    const req = new Request('http://test/api/courses/GC%203460/kuds/generate?slug=valid-slug', { method: 'POST' });
    const res = await generatePost(req, ctx);
    expect(res.status).toBe(404);
  });

  it('429s when rate limited', async () => {
    getCourseByCode.mockResolvedValue(fakeCourse);
    checkIpRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const req = new Request('http://test/api/courses/GC%203460/kuds/generate?slug=valid-slug', { method: 'POST' });
    const res = await generatePost(req, ctx);
    expect(res.status).toBe(429);
  });

  it('generates KUDs and returns draft', async () => {
    getCourseByCode.mockResolvedValue(fakeCourse);
    generateCourseKud.mockResolvedValue({ data: fakeKudResult, telemetry: { costUsdCents: 12, cachedTokens: 0, uncachedPromptTokens: 100, completionTokens: 50 } });
    const req = new Request('http://test/api/courses/GC%203460/kuds/generate?slug=valid-slug', { method: 'POST' });
    const res = await generatePost(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runId).toBe('run-uuid-1');
    expect(body.draft.thresholdConcept).toBe('Color is physical.');
    expect(updateBuilderStatus).toHaveBeenCalledWith('GC 3460', 'kuds_generated');
  });
});

describe('PUT /api/courses/[code]/kuds', () => {
  function makeReq(body: unknown) {
    return new Request('http://test/api/courses/GC%203460/kuds?slug=valid-slug', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('401s on invalid slug', async () => {
    const req = new Request('http://test/api/courses/GC%203460/kuds?slug=bad', { method: 'PUT', body: '{}' });
    const res = await kudsPut(req, ctx);
    expect(res.status).toBe(401);
  });

  it('saves the draft and returns 200', async () => {
    getCourseKud.mockResolvedValue({ thresholdConcept: 'original', know: ['orig1', 'orig2', 'orig3'], understand: ['orig1', 'orig2', 'orig3'], do: ['orig1', 'orig2', 'orig3'] });
    const res = await kudsPut(makeReq({
      thresholdConcept: 'Color is physical.',
      know: ['CMYK model', 'Halftone mechanics', 'Substrate types'],
      understand: ['Why dot gain matters', 'How adhesion works', 'Why process choice matters'],
      do: ['Select Pantone standard', 'Conduct ink testing', 'Interpret results'],
    }), ctx);
    expect(res.status).toBe(200);
    expect(saveKudDraft).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/courses/[code]/kuds/accept', () => {
  it('401s on invalid slug', async () => {
    const req = new Request('http://test/api/courses/GC%203460/kuds/accept?slug=bad', { method: 'POST' });
    const res = await acceptPost(req, ctx);
    expect(res.status).toBe(401);
  });

  it('404s when no KUD record exists', async () => {
    getCourseKud.mockResolvedValue(null);
    const req = new Request('http://test/api/courses/GC%203460/kuds/accept?slug=valid-slug', { method: 'POST' });
    const res = await acceptPost(req, ctx);
    expect(res.status).toBe(404);
  });

  it('accepts KUDs and returns 200', async () => {
    getCourseKud.mockResolvedValue({ courseCode: 'GC 3460', thresholdConcept: 'Color is physical.', know: [], understand: [], do: [] });
    const req = new Request('http://test/api/courses/GC%203460/kuds/accept?slug=valid-slug', { method: 'POST' });
    const res = await acceptPost(req, ctx);
    expect(res.status).toBe(200);
    expect(acceptCourseKud).toHaveBeenCalledWith('GC 3460', expect.any(Date), 'hashed-ip');
    expect(updateBuilderStatus).toHaveBeenCalledWith('GC 3460', 'approved');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test tests/api/course-kuds.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create `app/api/courses/[code]/kuds/generate/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode, updateBuilderStatus } from '@/lib/db/courses-queries';
import { insertKudRun, upsertCourseKud } from '@/lib/db/course-kud-queries';
import { generateCourseKud } from '@/lib/ai/analyze/kud-generate';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    const { data, telemetry } = await generateCourseKud({
      title: course.title,
      description: course.description,
      learningObjectives: course.learningObjectives as string[],
      majorProjects: course.majorProjects as string[],
      skillsRequired: course.skillsRequired as string[],
    });

    const profileSnapshot = {
      learningObjectives: course.learningObjectives as string[],
      majorProjects: course.majorProjects as string[],
      skillsRequired: course.skillsRequired as string[],
    };

    const runId = await insertKudRun({
      courseCode,
      result: data,
      profileSnapshot,
      model: 'claude-sonnet-4-6',
      costUsdCents: telemetry.costUsdCents,
    });

    await upsertCourseKud({
      courseCode,
      thresholdConcept: data.thresholdConcept,
      know: data.know,
      understand: data.understand,
      do: data.do,
      sourceRunId: runId,
    });

    await updateBuilderStatus(courseCode, 'kuds_generated');

    return NextResponse.json({ runId, draft: data });
  } catch (err) {
    console.error(`POST /api/courses/${courseCode}/kuds/generate failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Create `app/api/courses/[code]/kuds/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidSlug } from '@/lib/slug';
import { getCourseKud, saveKudDraft } from '@/lib/db/course-kud-queries';

const kudDraftSchema = z.object({
  thresholdConcept: z.string().min(1),
  know: z.array(z.string().min(1)).min(1).max(7),
  understand: z.array(z.string().min(1)).min(1).max(7),
  do: z.array(z.string().min(1)).min(1).max(7),
});

interface RouteContext { params: Promise<{ code: string }> }

export async function PUT(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const parsed = kudDraftSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const existing = await getCourseKud(courseCode);

  const manuallyEdited = existing
    ? JSON.stringify(existing.know) !== JSON.stringify(parsed.data.know) ||
      JSON.stringify(existing.understand) !== JSON.stringify(parsed.data.understand) ||
      JSON.stringify(existing.do) !== JSON.stringify(parsed.data.do)
    : false;

  try {
    await saveKudDraft({
      courseCode,
      thresholdConcept: parsed.data.thresholdConcept,
      know: parsed.data.know,
      understand: parsed.data.understand,
      do: parsed.data.do,
      manuallyEdited,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`PUT /api/courses/${courseCode}/kuds failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Create `app/api/courses/[code]/kuds/accept/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseKud, acceptCourseKud } from '@/lib/db/course-kud-queries';
import { updateBuilderStatus } from '@/lib/db/courses-queries';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const existing = await getCourseKud(courseCode);
  if (!existing) return NextResponse.json({ error: 'no KUD record — generate KUDs first' }, { status: 404 });

  const ipHash = hashIp(req);
  const now = new Date();

  try {
    await acceptCourseKud(courseCode, now, ipHash);
    await updateBuilderStatus(courseCode, 'approved');
    return NextResponse.json({ ok: true, approvedAt: now.toISOString() });
  } catch (err) {
    console.error(`POST /api/courses/${courseCode}/kuds/accept failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run tests**

```bash
pnpm test tests/api/course-kuds.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run full suite**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add app/api/courses/[code]/kuds/
git commit -m "feat(api): add KUD generate, save-draft, and accept endpoints"
```

---

## Task 8: Approval gate — courses list + CourseSelector

**Files:**
- Modify: `app/api/courses/route.ts`
- Modify: `app/api/courses/__tests__/route.test.ts`
- Modify: `components/CourseSelector.tsx`

- [ ] **Step 1: Write failing tests** — update `app/api/courses/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/courses-queries', () => ({
  listCourses: vi.fn().mockResolvedValue([
    { code: 'GC 1010', title: 'Intro', level: 1, track: 'Core', builderStatus: 'draft' },
    { code: 'GC 3460', title: 'Ink', level: 3, track: 'Print', builderStatus: 'approved' },
  ]),
  listApprovedCourses: vi.fn().mockResolvedValue([
    { code: 'GC 3460', title: 'Ink', level: 3, track: 'Print', builderStatus: 'approved' },
  ]),
}));
vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));

import { GET } from '@/app/api/courses/route';

describe('GET /api/courses', () => {
  it('401s on invalid slug', async () => {
    const req = new Request('http://test/api/courses?slug=bad');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns all courses when no approved param', async () => {
    const req = new Request('http://test/api/courses?slug=valid-slug');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
  });

  it('returns only approved courses when ?approved=true', async () => {
    const req = new Request('http://test/api/courses?slug=valid-slug&approved=true');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].code).toBe('GC 3460');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test app/api/courses/__tests__/route.test.ts
```

Expected: FAIL — `listApprovedCourses` not imported or `approved` param not handled.

- [ ] **Step 3: Update `app/api/courses/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { listCourses, listApprovedCourses } from '@/lib/db/courses-queries';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  const onlyApproved = url.searchParams.get('approved') === 'true';
  const list = onlyApproved ? await listApprovedCourses() : await listCourses();
  return NextResponse.json(list);
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test app/api/courses/__tests__/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update `components/CourseSelector.tsx`** — show all courses but disable unapproved ones when `requireApproved` prop is set:

```typescript
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface CourseListItem {
  code: string;
  title: string;
  level: number;
  track: string;
  builderStatus?: string;
}

interface Props {
  slug: string;
  selectedCode: string;
  onSelect: (code: string) => void;
  label: string;
  excludeCode?: string;
  inputId: string;
  requireApproved?: boolean; // when true, grays out unapproved courses
}

export function CourseSelector({ slug, selectedCode, onSelect, label, excludeCode, inputId, requireApproved }: Props) {
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/courses?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then((data: CourseListItem[]) => setCourses(data))
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }, [slug]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = excludeCode ? courses.filter(c => c.code !== excludeCode) : courses;
    if (!q) return pool;
    return pool.filter(c =>
      c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)
    );
  }, [courses, query, excludeCode]);

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        placeholder={loading ? 'Loading courses…' : 'Search courses (e.g. 3460, brand, photography)'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={loading}
      />
      <div className="rounded-lg border max-h-48 overflow-y-auto">
        {filtered.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground p-3">No courses match.</p>
        )}
        {filtered.map(c => {
          const isApproved = !requireApproved || c.builderStatus === 'approved';
          const statusLabel = c.builderStatus && c.builderStatus !== 'approved' ? c.builderStatus.replace('_', ' ') : null;
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => isApproved ? onSelect(c.code) : undefined}
              disabled={!isApproved}
              title={!isApproved ? `KUD profile not yet approved (${statusLabel ?? 'draft'})` : undefined}
              className={`block w-full text-left px-3 py-2 text-sm ${
                !isApproved
                  ? 'opacity-40 cursor-not-allowed text-muted-foreground'
                  : c.code === selectedCode
                  ? 'bg-muted font-medium hover:bg-muted'
                  : 'hover:bg-muted'
              }`}
            >
              <span className="font-mono text-xs text-muted-foreground mr-2">{c.code}</span>
              {c.title}
              {!isApproved && statusLabel && (
                <span className="ml-2 text-xs opacity-60">({statusLabel})</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run full test suite**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/api/courses/ components/CourseSelector.tsx
git commit -m "feat(api): add ?approved=true filter to courses list; update CourseSelector with approval gate"
```

---

## Task 9: CourseBuilderClient tab shell + CourseInfoTab

**Files:**
- Create: `app/preview/[slug]/courses/[code]/CourseBuilderClient.tsx`
- Create: `app/preview/[slug]/courses/[code]/CourseInfoTab.tsx`

- [ ] **Step 1: Create `app/preview/[slug]/courses/[code]/CourseInfoTab.tsx`**

```typescript
interface CourseInfo {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  prerequisites: string;
  builderStatus: string;
}

interface Props {
  course: CourseInfo;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  materials_uploaded: 'Materials uploaded',
  profile_complete: 'Profile complete',
  kuds_generated: 'KUDs generated',
  approved: 'Approved',
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  materials_uploaded: 'bg-amber-100 text-amber-700',
  profile_complete: 'bg-amber-100 text-amber-700',
  kuds_generated: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
};

export function CourseInfoTab({ course }: Props) {
  const statusLabel = STATUS_LABEL[course.builderStatus] ?? course.builderStatus;
  const statusClass = STATUS_CLASS[course.builderStatus] ?? 'bg-muted text-muted-foreground';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Code</dt>
          <dd className="mt-1 text-sm font-mono">{course.code}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Level</dt>
          <dd className="mt-1 text-sm">{course.level}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Track</dt>
          <dd className="mt-1 text-sm">{course.track}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prerequisites (catalog)</dt>
          <dd className="mt-1 text-sm">{course.prerequisites || 'None listed'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</dt>
          <dd className="mt-1 text-sm leading-relaxed">{course.description || 'No catalog description.'}</dd>
        </div>
      </dl>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/preview/[slug]/courses/[code]/CourseBuilderClient.tsx`**

```typescript
'use client';

import { useState } from 'react';
import { CourseInfoTab } from './CourseInfoTab';
import { MaterialsZone } from './MaterialsZone';
import { BuilderProfileTab } from './BuilderProfileTab';
import { KudReviewTab } from './KudReviewTab';
import { CourseAnalyzeZone } from '@/components/CourseAnalyzeZone';
import { CourseProfileEditor } from '@/components/CourseProfileEditor';
import { ProfileRunHistory } from '@/components/ProfileRunHistory';

type Tab = 'info' | 'materials' | 'profile' | 'kuds';

export interface BuilderCourse {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  prerequisites: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
  builderStatus: string;
}

export interface BuilderMaterial {
  id: string;
  fileName: string;
  extractionStatus: 'pending' | 'ok' | 'low_text' | 'failed';
  extractionMethod?: string;
  pageCount?: number;
}

export interface BuilderKud {
  thresholdConcept: string;
  know: string[];
  understand: string[];
  do: string[];
  manuallyEdited: boolean;
  sourceRunId: string | null;
  approvedAt: string | null;
}

export interface BuilderKudRun {
  id: string;
  createdAt: string;
  model: string;
  costUsdCents: number;
}

interface Props {
  slug: string;
  course: BuilderCourse;
  materials: BuilderMaterial[];
  currentKud: BuilderKud | null;
  kudRuns: BuilderKudRun[];
  aiProfile: {
    summary: string;
    learningObjectives: string[];
    skills: string[];
    competencies: Array<{ name: string; description: string; level: string; evidence: Array<{ fileName: string; quote: string }> }>;
    catalogDivergence: { reinforced: string[]; additions: string[]; gaps: string[] } | null;
  } | null;
  profileRuns: Array<{ id: string; courseCode: string; materialCount: number; model: string; costUsdCents: number; createdAt: string }>;
  okMaterialCount: number;
  lastProfileRun: { id: string; createdAt: string; materialCount: number; costUsdCents: number } | null;
  aiProfileManuallyEdited: boolean;
  currentProfileRunId: string | null;
}

const TAB_LABELS: { key: Tab; label: string }[] = [
  { key: 'info', label: 'Info' },
  { key: 'materials', label: 'Materials' },
  { key: 'profile', label: 'Profile' },
  { key: 'kuds', label: 'KUDs' },
];

export function CourseBuilderClient(props: Props) {
  const { slug, course, materials, currentKud, kudRuns, aiProfile, profileRuns, okMaterialCount, lastProfileRun, aiProfileManuallyEdited, currentProfileRunId } = props;
  const [activeTab, setActiveTab] = useState<Tab>('info');
  const [builderStatus, setBuilderStatus] = useState(course.builderStatus);
  const [kudDraft, setKudDraft] = useState<BuilderKud | null>(currentKud);

  return (
    <div className="space-y-6">
      {/* Tab nav */}
      <div className="flex border-b">
        {TAB_LABELS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {key === 'kuds' && builderStatus === 'approved' && (
              <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">✓</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'info' && (
        <CourseInfoTab course={{ ...course, builderStatus }} />
      )}

      {activeTab === 'materials' && (
        <div className="space-y-6">
          <MaterialsZone courseCode={course.code} slug={slug} initialMaterials={materials} />
          <CourseAnalyzeZone
            slug={slug}
            courseCode={course.code}
            okCount={okMaterialCount}
            lastRun={lastProfileRun}
            manuallyEdited={aiProfileManuallyEdited}
            onAnalyzed={() => {}}
          />
          {aiProfile && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold">AI-synthesized profile</h3>
              <CourseProfileEditor
                courseCode={course.code}
                slug={slug}
                profile={aiProfile}
              />
            </div>
          )}
          <ProfileRunHistory
            runs={profileRuns}
            slug={slug}
            courseCode={course.code}
            currentRunId={currentProfileRunId}
          />
        </div>
      )}

      {activeTab === 'profile' && (
        <BuilderProfileTab
          courseCode={course.code}
          slug={slug}
          initialObjectives={course.learningObjectives}
          initialProjects={course.majorProjects}
          initialSkills={course.skillsRequired}
          builderStatus={builderStatus}
          onSaved={(newStatus) => setBuilderStatus(newStatus)}
        />
      )}

      {activeTab === 'kuds' && (
        <KudReviewTab
          courseCode={course.code}
          slug={slug}
          builderStatus={builderStatus}
          currentKud={kudDraft}
          profileSummary={{
            learningObjectives: course.learningObjectives,
            majorProjects: course.majorProjects,
            skillsRequired: course.skillsRequired,
          }}
          onStatusChange={(newStatus, newKud) => {
            setBuilderStatus(newStatus);
            if (newKud) setKudDraft(newKud);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all pass (these are UI components with no tests; type errors would surface at build time).

- [ ] **Step 4: Commit**

```bash
git add app/preview/[slug]/courses/[code]/CourseBuilderClient.tsx app/preview/[slug]/courses/[code]/CourseInfoTab.tsx
git commit -m "feat(ui): add CourseBuilderClient tab shell and CourseInfoTab"
```

---

## Task 10: BuilderProfileTab

**Files:**
- Create: `app/preview/[slug]/courses/[code]/BuilderProfileTab.tsx`

- [ ] **Step 1: Create `app/preview/[slug]/courses/[code]/BuilderProfileTab.tsx`**

```typescript
'use client';

import { useState } from 'react';

interface Props {
  courseCode: string;
  slug: string;
  initialObjectives: string[];
  initialProjects: string[];
  initialSkills: string[];
  builderStatus: string;
  onSaved: (newStatus: string) => void;
}

function EditableList({
  label,
  description,
  items,
  onChange,
}: {
  label: string;
  description: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  function update(i: number, value: string) {
    const next = [...items];
    next[i] = value;
    onChange(next);
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...items, '']);
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="text"
              value={item}
              onChange={(e) => update(i, e.target.value)}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-muted-foreground hover:text-destructive text-sm px-2"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
      >
        + Add item
      </button>
    </div>
  );
}

export function BuilderProfileTab({
  courseCode,
  slug,
  initialObjectives,
  initialProjects,
  initialSkills,
  builderStatus,
  onSaved,
}: Props) {
  const [objectives, setObjectives] = useState<string[]>(initialObjectives);
  const [projects, setProjects] = useState<string[]>(initialProjects);
  const [skills, setSkills] = useState<string[]>(initialSkills);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const wasApproved = builderStatus === 'approved' || builderStatus === 'kuds_generated';

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/profile?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            learningObjectives: objectives.filter(Boolean),
            majorProjects: projects.filter(Boolean),
            skillsRequired: skills.filter(Boolean),
          }),
        },
      );
      if (!res.ok) throw new Error('Save failed');
      setSaved(true);
      const allHaveContent =
        objectives.some(Boolean) && projects.some(Boolean) && skills.some(Boolean);
      onSaved(allHaveContent ? 'profile_complete' : builderStatus);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {wasApproved && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Saving profile changes will reset your KUD approval — you will need to regenerate and re-accept KUDs.
        </div>
      )}

      <EditableList
        label="Learning objectives"
        description="What students will achieve — pre-populated from catalog, edit to match reality."
        items={objectives}
        onChange={setObjectives}
      />

      <EditableList
        label="Major projects"
        description="Highest-stakes assignments. First item carries the most weight in KUD generation."
        items={projects}
        onChange={setProjects}
      />

      <EditableList
        label="Required incoming skills"
        description="What students need to arrive knowing — the course's own prereq statement."
        items={skills}
        onChange={setSkills}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      <p className="text-xs text-muted-foreground">
        After saving, go to the KUDs tab to generate outcomes from this profile.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/preview/[slug]/courses/[code]/BuilderProfileTab.tsx
git commit -m "feat(ui): add BuilderProfileTab — editable learning objectives, projects, required skills"
```

---

## Task 11: KudReviewTab

**Files:**
- Create: `app/preview/[slug]/courses/[code]/KudReviewTab.tsx`

- [ ] **Step 1: Create `app/preview/[slug]/courses/[code]/KudReviewTab.tsx`**

```typescript
'use client';

import { useState } from 'react';
import type { BuilderKud } from './CourseBuilderClient';

interface Props {
  courseCode: string;
  slug: string;
  builderStatus: string;
  currentKud: BuilderKud | null;
  profileSummary: {
    learningObjectives: string[];
    majorProjects: string[];
    skillsRequired: string[];
  };
  onStatusChange: (newStatus: string, newKud: BuilderKud | null) => void;
}

function BulletList({
  label,
  bullets,
  editable,
  onChange,
}: {
  label: string;
  bullets: string[];
  editable: boolean;
  onChange?: (bullets: string[]) => void;
}) {
  function update(i: number, val: string) {
    if (!onChange) return;
    const next = [...bullets];
    next[i] = val;
    onChange(next);
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      {bullets.map((b, i) =>
        editable ? (
          <textarea
            key={i}
            value={b}
            rows={2}
            onChange={(e) => update(i, e.target.value)}
            className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <p key={i} className="text-sm text-muted-foreground leading-snug">– {b}</p>
        )
      )}
    </div>
  );
}

export function KudReviewTab({ courseCode, slug, builderStatus, currentKud, profileSummary, onStatusChange }: Props) {
  const [draft, setDraft] = useState<BuilderKud | null>(currentKud);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const canAccept = builderStatus === 'kuds_generated' && draft !== null && !dirty;
  const isApproved = builderStatus === 'approved';

  function updateBullets(key: 'know' | 'understand' | 'do', bullets: string[]) {
    if (!draft) return;
    setDraft({ ...draft, [key]: bullets });
    setDirty(true);
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/kuds/generate?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Generation failed');
      }
      const { draft: newDraft } = await res.json() as { runId: string; draft: { thresholdConcept: string; know: string[]; understand: string[]; do: string[]; confidenceNotes: string } };
      const newKud: BuilderKud = {
        thresholdConcept: newDraft.thresholdConcept,
        know: newDraft.know,
        understand: newDraft.understand,
        do: newDraft.do,
        manuallyEdited: false,
        sourceRunId: null,
        approvedAt: null,
      };
      setDraft(newKud);
      setDirty(false);
      onStatusChange('kuds_generated', newKud);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveDraft() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/kuds?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            thresholdConcept: draft.thresholdConcept,
            know: draft.know,
            understand: draft.understand,
            do: draft.do,
          }),
        },
      );
      if (!res.ok) throw new Error('Save failed');
      setDirty(false);
    } catch {
      setError('Failed to save draft. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/kuds/accept?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error('Accept failed');
      const { approvedAt } = await res.json() as { approvedAt: string };
      const accepted = draft ? { ...draft, approvedAt } : null;
      setDraft(accepted);
      onStatusChange('approved', accepted);
    } catch {
      setError('Failed to accept. Try again.');
    } finally {
      setAccepting(false);
    }
  }

  const profileIsEmpty =
    profileSummary.learningObjectives.length === 0 && profileSummary.majorProjects.length === 0;

  return (
    <div className="space-y-6">
      {/* Status / guidance */}
      {isApproved && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          KUDs accepted{draft?.approvedAt ? ` on ${new Date(draft.approvedAt).toLocaleDateString()}` : ''}. This course is now selectable in the analysis tools. To revise, generate new KUDs and accept again.
        </div>
      )}
      {builderStatus === 'profile_complete' && !draft && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Profile saved. Generate KUDs to continue.
        </div>
      )}
      {dirty && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You have unsaved edits. Save the draft before accepting, or regenerate to reset to AI output.
        </div>
      )}
      {profileIsEmpty && (
        <div className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
          No profile content yet — go to the Profile tab to add learning objectives and projects first. KUD draft will be weaker without them.
        </div>
      )}

      {/* Generate button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {generating ? 'Generating…' : draft ? '↻ Regenerate KUDs' : 'Generate KUDs'}
        </button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      {/* 3-panel layout */}
      {draft && (
        <>
          <div className="rounded-lg border overflow-hidden">
            <div className="bg-foreground text-background px-4 py-3 text-xs font-mono uppercase tracking-wider">
              KUD Review — {courseCode}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x">
              {/* Left: profile evidence (read-only) */}
              <div className="p-4 space-y-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Profile evidence</p>
                {profileSummary.majorProjects.length > 0 && (
                  <BulletList label="Major projects" bullets={profileSummary.majorProjects} editable={false} />
                )}
                {profileSummary.skillsRequired.length > 0 && (
                  <BulletList label="Required skills" bullets={profileSummary.skillsRequired} editable={false} />
                )}
                {profileSummary.majorProjects.length === 0 && profileSummary.skillsRequired.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No profile content — add projects and skills in the Profile tab.</p>
                )}
              </div>

              {/* Center: editable KUD bullets */}
              <div className="p-4 space-y-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI-drafted KUD outcomes</p>
                <BulletList label="Know" bullets={draft.know} editable onChange={(b) => updateBullets('know', b)} />
                <BulletList label="Understand" bullets={draft.understand} editable onChange={(b) => updateBullets('understand', b)} />
                <BulletList label="Do" bullets={draft.do} editable onChange={(b) => updateBullets('do', b)} />
              </div>

              {/* Right: threshold concept + confidence */}
              <div className="p-4 space-y-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Threshold concept</p>
                <p className="text-sm italic leading-relaxed">&ldquo;{draft.thresholdConcept}&rdquo;</p>
              </div>
            </div>

            {/* Action row */}
            <div className="bg-muted/50 px-4 py-3 flex items-center gap-3 flex-wrap">
              {dirty && (
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-background/80 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save draft'}
                </button>
              )}
              <button
                type="button"
                onClick={handleAccept}
                disabled={!canAccept || accepting}
                title={
                  dirty ? 'Save draft first before accepting' :
                  builderStatus !== 'kuds_generated' ? 'Generate KUDs before accepting' :
                  undefined
                }
                className="ml-auto inline-flex items-center rounded-md bg-green-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {accepting ? 'Accepting…' : isApproved ? '✓ Accepted' : 'Accept these KUDs →'}
              </button>
            </div>
          </div>

          {draft.manuallyEdited && (
            <p className="text-xs text-muted-foreground">
              These KUDs contain manual edits. Consider updating the project descriptions in the Profile tab so future regenerations are more accurate.
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/preview/[slug]/courses/[code]/KudReviewTab.tsx
git commit -m "feat(ui): add KudReviewTab — 3-panel KUD iteration loop with generate/edit/accept"
```

---

## Task 12: Wire page.tsx + update courses index

**Files:**
- Modify: `app/preview/[slug]/courses/[code]/page.tsx`
- Modify: `app/preview/[slug]/courses/page.tsx`

- [ ] **Step 1: Rewrite `app/preview/[slug]/courses/[code]/page.tsx`**

```typescript
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getLatestRunForCourse, getCourseProfile, listRunsForCourse } from '@/lib/db/course-profile-queries';
import { getCourseKud, listKudRunsForCourse } from '@/lib/db/course-kud-queries';
import { CourseBuilderClient } from './CourseBuilderClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string; code: string }>;
}

export default async function CourseDetailPage({ params }: Props) {
  const { slug, code } = await params;
  if (!isValidSlug(slug)) notFound();

  const course = await getCourseByCode(code);
  if (!course) notFound();

  const [rawMaterials, latestProfileRun, currentProfile, allProfileRuns, currentKud, kudRuns] = await Promise.all([
    listMaterialsByCourse(code),
    getLatestRunForCourse(code),
    getCourseProfile(code),
    listRunsForCourse(code),
    getCourseKud(code),
    listKudRunsForCourse(code),
  ]);

  const materials = rawMaterials.map((m) => ({
    id: m.id,
    fileName: m.fileName,
    blobUrl: m.blobUrl,
    extractionStatus: m.extractionStatus as 'pending' | 'ok' | 'low_text' | 'failed',
    extractionMethod: m.extractionMethod ?? undefined,
    pageCount: m.pageCount ?? undefined,
  }));

  const okCount = rawMaterials.filter((m) => m.extractionStatus === 'ok').length;

  const lastProfileRunMeta = latestProfileRun
    ? { id: latestProfileRun.id, createdAt: latestProfileRun.createdAt.toISOString(), materialCount: latestProfileRun.materialCount, costUsdCents: latestProfileRun.costUsdCents }
    : null;

  const aiProfile = currentProfile
    ? {
        summary: currentProfile.summary,
        learningObjectives: currentProfile.learningObjectives as string[],
        skills: currentProfile.skills as string[],
        competencies: currentProfile.competencies as Array<{ name: string; description: string; level: string; evidence: Array<{ fileName: string; quote: string }> }>,
        catalogDivergence: currentProfile.catalogDivergence as { reinforced: string[]; additions: string[]; gaps: string[] } | null,
      }
    : null;

  const kudRecord = currentKud
    ? {
        thresholdConcept: currentKud.thresholdConcept,
        know: currentKud.know as string[],
        understand: currentKud.understand as string[],
        do: currentKud.do as string[],
        manuallyEdited: currentKud.manuallyEdited,
        sourceRunId: currentKud.sourceRunId,
        approvedAt: currentKud.approvedAt?.toISOString() ?? null,
      }
    : null;

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-12 space-y-8">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href={`/preview/${slug}`} className="underline underline-offset-2 hover:text-foreground">
          &larr; Back to prototype
        </Link>
      </div>

      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{course.code}</p>
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <p className="text-sm text-muted-foreground">Level {course.level} · {course.track}</p>
      </header>

      <CourseBuilderClient
        slug={slug}
        course={{
          code: course.code,
          title: course.title,
          level: course.level,
          track: course.track,
          description: course.description,
          prerequisites: course.prerequisites,
          learningObjectives: course.learningObjectives as string[],
          majorProjects: course.majorProjects as string[],
          skillsRequired: course.skillsRequired as string[],
          builderStatus: course.builderStatus,
        }}
        materials={materials}
        currentKud={kudRecord}
        kudRuns={kudRuns.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), model: r.model, costUsdCents: r.costUsdCents }))}
        aiProfile={aiProfile}
        profileRuns={allProfileRuns.map((r) => ({ id: r.id, courseCode: r.courseCode, materialCount: r.materialCount, model: r.model, costUsdCents: r.costUsdCents, createdAt: r.createdAt.toISOString() }))}
        okMaterialCount={okCount}
        lastProfileRun={lastProfileRunMeta}
        aiProfileManuallyEdited={currentProfile?.manuallyEdited ?? false}
        currentProfileRunId={currentProfile?.sourceRunId ?? null}
      />
    </main>
  );
}
```

- [ ] **Step 2: Update `app/preview/[slug]/courses/page.tsx`** — update `StatusBadge` to reflect `builderStatus`:

Replace the `StatusBadge` function with:

```typescript
function StatusBadge({ builderStatus, materialCount }: {
  builderStatus: string;
  materialCount: number;
}) {
  if (builderStatus === 'approved') {
    return <Badge variant="default" className="bg-green-600">Approved</Badge>;
  }
  if (builderStatus === 'kuds_generated') {
    return <Badge variant="secondary">KUDs generated</Badge>;
  }
  if (builderStatus === 'profile_complete') {
    return <Badge variant="secondary">Profile complete</Badge>;
  }
  if (builderStatus === 'materials_uploaded' || materialCount > 0) {
    return <Badge variant="outline">{materialCount} file{materialCount !== 1 ? 's' : ''}</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground">Draft</Badge>;
}
```

Update the `courses.map()` call to pass `builderStatus` instead of the old profile props:

```typescript
{courses.map((c) => (
  <div key={c.code} className="rounded-lg border bg-card p-4 flex items-center justify-between gap-4">
    <div className="min-w-0 space-y-0.5">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{c.code}</span>
        <span className="text-xs text-muted-foreground">{c.track} · Level {c.level}</span>
      </div>
      <p className="text-sm text-muted-foreground truncate">{c.title}</p>
    </div>
    <div className="flex items-center gap-3 shrink-0">
      <StatusBadge builderStatus={c.builderStatus} materialCount={c.materialCount} />
      <Link
        href={`/preview/${slug}/courses/${encodeURIComponent(c.code)}`}
        className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        Open
      </Link>
    </div>
  </div>
))}
```

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 4: Build check**

```bash
pnpm build
```

Expected: clean build with no type errors. If type errors appear, fix them before committing.

- [ ] **Step 5: Commit**

```bash
git add app/preview/[slug]/courses/[code]/page.tsx app/preview/[slug]/courses/page.tsx
git commit -m "feat(ui): wire CourseBuilderClient into per-course page; update courses index status badges"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by task |
|---|---|
| `builder_status` column on `courses` | Task 1 |
| `course_kuds` table | Task 1 |
| `course_kud_runs` table | Task 1 |
| KUD result type + Zod schema | Task 2 |
| `extract-course-kud.md` prompt | Task 3 |
| `generateCourseKud()` AI function | Task 3 |
| `GET /api/courses/[code]/builder` | Task 6 |
| `PUT /api/courses/[code]/profile` (builder) | Task 6 |
| `POST /api/courses/[code]/kuds/generate` | Task 7 |
| `PUT /api/courses/[code]/kuds` (save draft) | Task 7 |
| `POST /api/courses/[code]/kuds/accept` | Task 7 |
| `GET /api/courses?approved=true` | Task 8 |
| CourseSelector approval gate | Task 8 |
| 5-tab builder page (Info/Materials/Profile/KUDs) | Tasks 9–12 |
| Stale KUD detection (dirty flag + status gate) | Task 11 |
| Reset approval when profile edited | Task 6 (PUT /profile) |
| Courses index shows builder_status | Task 12 |

**Gaps (not in this plan — intentional):**
- Prereq analysis redesign to use accepted KUDs from `course_kuds` (separate plan)
- 1–10 numeric coverage scoring (spec says "not a Course Builder blocker")
- `materials_uploaded` status transition from the analyze-materials route (cosmetic)
- Left panel of KUD tab editable inline (user goes to Profile tab instead)
- Stage 1 Course Info fields editable with "Edited from catalog" indicator

**Placeholder scan:** No TBD / "add appropriate" / "similar to Task N" patterns found.

**Type consistency check:**
- `BuilderKud` defined in `CourseBuilderClient.tsx` and used in `KudReviewTab.tsx` — consistent
- `CourseKudResult` defined in `lib/domain/types.ts`, imported in `kud-generate.ts` and `course-kud-queries.ts` — consistent
- `CourseListItem.builderStatus` added in Task 5, used in Task 8 `CourseSelector` — consistent
- `upsertCourseKud` uses `onConflictDoUpdate` in tests but the implementation uses plain `insert().values().returning()` — **fix**: `upsertCourseKud` needs conflict handling. Update the implementation in Task 4 to use `onConflictDoUpdate`:

```typescript
export async function upsertCourseKud(input: UpsertCourseKudInput): Promise<void> {
  await db
    .insert(courseKuds)
    .values({
      courseCode: input.courseCode,
      thresholdConcept: input.thresholdConcept,
      know: input.know,
      understand: input.understand,
      do: input.do,
      sourceRunId: input.sourceRunId,
      manuallyEdited: false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: courseKuds.courseCode,
      set: {
        thresholdConcept: sql`excluded.threshold_concept`,
        know: sql`excluded.know`,
        understand: sql`excluded.understand`,
        do: sql`excluded.do`,
        sourceRunId: sql`excluded.source_run_id`,
        manuallyEdited: false,
        approvedAt: null,
        approvedByIpHash: null,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}
```

Add `sql` to the import in `course-kud-queries.ts`: `import { eq, desc, sql } from 'drizzle-orm';`

This is the correct upsert — it resets `approvedAt` to null when new KUDs are generated, which is the right behavior (re-generating KUDs requires re-acceptance).
