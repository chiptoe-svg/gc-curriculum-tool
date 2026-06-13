# Structured Course Identity + Lecture/Lab Bundling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store course identity as structured `prefix` / integer `course_number` / `number_suffix` alongside the unchanged `code` PK, and let a primary course bundle a paired lecture/lab code (its own Canvas page, shared capture).

**Architecture:** Additive only — `courses.code` stays the PK and the target of all 17 FKs. New parsed columns + a `course_codes` child table (paired codes are NOT `courses` rows) + a `course_materials.source_code` provenance tag. The capture pipeline, Weaviate tenant model, snapshots, and the `/program` matrix are **deliberately frozen** — paired-page materials land in the primary's single tenant, so the audit agent sees lecture+lab together with zero pipeline change.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle + Postgres 17 (local :5433), Zod, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-13-structured-course-identity-and-bundling-design.md`

**Conventions:** tests `pnpm vitest run <path>`; full suite `pnpm test`; typecheck `pnpm tsc --noEmit` (vitest does NOT typecheck — run tsc explicitly). Migrations: `pnpm db:generate` then apply with `DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | sed 's/[[:space:]]*#.*$//')" pnpm db:migrate`. Local Postgres IS production — migrations must be additive; inspect generated SQL before applying. Do NOT `git add` `*.jpeg` or `.playwright-mcp`. `bigint` is already imported in schema.ts.

**File map:**
- Create `lib/courses/parse-course-code.ts` (+ test) — the pure parser.
- Modify `lib/db/schema.ts` — 3 identity columns on `courses`, new `course_codes` table + `course_code_role` enum, `source_code` on `course_materials`.
- Generate `drizzle/0037_*.sql` — additive columns/table + backfill of the identity columns.
- Create `lib/db/course-codes-queries.ts` (+ test) — paired-code CRUD/read.
- Modify `lib/db/courses-queries.ts` — `createCourse`/`NewCourseInput` set structured fields + optional paired code; `formatCourseLabel` helper.
- Modify `app/api/admin/courses/roster/route.ts` — `mode:'one'` accepts `prefix`/`number`/`pairedNumber`/`pairedRole`.
- Modify `app/courses/new/NewCourseForm.tsx` — prefix/number fields + paired-course disclosure.
- Modify `app/api/courses/[code]/canvas-import/route.ts` + `lib/db/course-materials-queries.ts` — optional `sourceCode` stamped on inserted materials.
- Modify `app/capture/[code]/boxes/CanvasBox.tsx` + `app/capture/[code]/page.tsx` + `CaptureClient`/`CaptureMaterialsStep` — pass `pairedCodes`, bundle-aware rendering.
- Modify `docs/STATE.md`.

---

### Task 1: Pure course-code parser

**Files:**
- Create: `lib/courses/parse-course-code.ts`
- Test: `tests/lib/courses/parse-course-code.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/courses/parse-course-code.test.ts
import { describe, it, expect } from 'vitest';
import { parseCourseCode, composeCourseCode } from '@/lib/courses/parse-course-code';

describe('parseCourseCode', () => {
  it('splits prefix / integer number / suffix', () => {
    expect(parseCourseCode('GC 3460')).toEqual({ prefix: 'GC', number: 3460, suffix: '' });
    expect(parseCourseCode('GC 4900ap')).toEqual({ prefix: 'GC', number: 4900, suffix: 'ap' });
    expect(parseCourseCode('GC 4990ta')).toEqual({ prefix: 'GC', number: 4990, suffix: 'ta' });
    expect(parseCourseCode('ACCT 2010')).toEqual({ prefix: 'ACCT', number: 2010, suffix: '' });
    expect(parseCourseCode('PKSC 1020')).toEqual({ prefix: 'PKSC', number: 1020, suffix: '' });
  });
  it('uppercases prefix, lowercases suffix, tolerates spacing', () => {
    expect(parseCourseCode('  gc3460  ')).toEqual({ prefix: 'GC', number: 3460, suffix: '' });
    expect(parseCourseCode('GC 4900AP')).toEqual({ prefix: 'GC', number: 4900, suffix: 'ap' });
  });
  it('returns null number for an unparseable code (no digit group)', () => {
    expect(parseCourseCode('NOTACODE')).toEqual({ prefix: '', number: null, suffix: '' });
    expect(parseCourseCode('')).toEqual({ prefix: '', number: null, suffix: '' });
  });
});

describe('composeCourseCode', () => {
  it('recomposes losslessly', () => {
    expect(composeCourseCode({ prefix: 'GC', number: 4900, suffix: 'ap' })).toBe('GC 4900ap');
    expect(composeCourseCode({ prefix: 'GC', number: 3460, suffix: '' })).toBe('GC 3460');
  });
  it('returns empty string when number is null', () => {
    expect(composeCourseCode({ prefix: '', number: null, suffix: '' })).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lib/courses/parse-course-code.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/courses/parse-course-code.ts
/**
 * Decompose a course code into structured identity. The `code` string
 * ("GC 4900ap") stays the canonical PK; these parts drive display, sort,
 * and the add-flow. Spec: docs/superpowers/specs/2026-06-13-structured-course-identity-and-bundling-design.md
 */
export interface ParsedCode {
  prefix: string;
  number: number | null; // integer; null only when no digit group is present
  suffix: string;
}

const CODE_RE = /^\s*([A-Za-z]+)\s*(\d+)\s*([A-Za-z]*)\s*$/;

export function parseCourseCode(code: string): ParsedCode {
  const m = CODE_RE.exec(code ?? '');
  if (!m) return { prefix: '', number: null, suffix: '' };
  return {
    prefix: m[1]!.toUpperCase(),
    number: parseInt(m[2]!, 10),
    suffix: (m[3] ?? '').toLowerCase(),
  };
}

/** Inverse of parseCourseCode: "GC" + 4900 + "ap" → "GC 4900ap". Empty when number is null. */
export function composeCourseCode(p: ParsedCode): string {
  if (p.number === null) return '';
  return `${p.prefix} ${p.number}${p.suffix}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/lib/courses/parse-course-code.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/courses/parse-course-code.ts tests/lib/courses/parse-course-code.test.ts
git commit -m "feat(courses): pure course-code parser (prefix/int-number/suffix)"
```

---

### Task 2: Schema — identity columns, course_codes table, source_code

**Files:**
- Modify: `lib/db/schema.ts`
- Generate: `drizzle/0037_*.sql`

- [ ] **Step 1: Add the three identity columns to `courses`**

In `lib/db/schema.ts`, inside the `courses` pgTable, after the `catalogUrl` line, add:

```typescript
  // Structured identity (migration 0037). `code` stays the canonical PK;
  // these are the parsed parts — see lib/courses/parse-course-code.ts.
  prefix: text('prefix').notNull().default(''),
  courseNumber: integer('course_number'),                 // nullable; null only for an unparseable code
  numberSuffix: text('number_suffix').notNull().default(''),
```

- [ ] **Step 2: Add the role enum + `course_codes` table**

Near the other `pgEnum` declarations (top of file) add:

```typescript
export const courseCodeRole = pgEnum('course_code_role', ['lecture', 'lab', 'other']);
```

After the `courses` table definition add:

```typescript
/**
 * Paired (secondary) course codes bundled under a primary course — e.g. a lab
 * (GC 3461) bundled under its lecture (GC 3460). The paired code is NOT a
 * `courses` row; it has no independent capture/snapshot/tenant. A primary
 * course with >=1 row here is a "bundle". Migration 0037.
 * Spec: docs/superpowers/specs/2026-06-13-structured-course-identity-and-bundling-design.md
 */
export const courseCodes = pgTable('course_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }), // the PRIMARY course
  pairedCode: text('paired_code').notNull(),
  role: courseCodeRole('role').notNull(),
  canvasCourseName: text('canvas_course_name'),                 // nullable — provenance of this page's Canvas import
  canvasImportedAt: timestamp('canvas_imported_at', { withTimezone: true }), // nullable
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pairedUniq: unique('uq_course_codes_paired').on(t.pairedCode),
  primaryIdx: index('idx_course_codes_course').on(t.courseCode),
}));
```

- [ ] **Step 3: Add `source_code` to `course_materials`**

In the `courseMaterials` pgTable, after the `ignoredItems` line, add:

```typescript
  // The code this material was imported under (a bundle's primary or a paired
  // code). null ⇒ the primary course. Provenance only — courseCode stays the
  // primary so the tenant/retrieval/FK model is unchanged. Migration 0037.
  sourceCode: text('source_code'),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: `drizzle/0037_<name>.sql` with: 3 `ALTER TABLE "courses" ADD COLUMN`, `CREATE TYPE "course_code_role"`, `CREATE TABLE "course_codes"` (+ unique + index + FK), `ALTER TABLE "course_materials" ADD COLUMN "source_code"`. Inspect — must be purely additive (no drops). If anything destructive appears, STOP and report.

- [ ] **Step 5: Append the identity backfill to the migration**

Edit the generated `drizzle/0037_*.sql`, append (the regex mirrors the parser: prefix, integer number, lowercased suffix):

```sql
--> statement-breakpoint
UPDATE "courses" SET
  "prefix" = upper((regexp_match(code, '^\s*([A-Za-z]+)\s*([0-9]+)\s*([A-Za-z]*)\s*$'))[1]),
  "course_number" = ((regexp_match(code, '^\s*([A-Za-z]+)\s*([0-9]+)\s*([A-Za-z]*)\s*$'))[2])::int,
  "number_suffix" = lower(coalesce((regexp_match(code, '^\s*([A-Za-z]+)\s*([0-9]+)\s*([A-Za-z]*)\s*$'))[3], ''))
WHERE code ~ '^\s*[A-Za-z]+\s*[0-9]+\s*[A-Za-z]*\s*$';
```

- [ ] **Step 6: Apply + verify**

Run: `DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | sed 's/[[:space:]]*#.*$//')" pnpm db:migrate`
Verify:
```bash
PSQL=$(ls /Applications/Postgres.app/Contents/Versions/*/bin/psql | tail -1)
"$PSQL" "postgresql://admin@127.0.0.1:5433/gc_curriculum" -c "\d course_codes"
"$PSQL" "postgresql://admin@127.0.0.1:5433/gc_curriculum" -t -A -F' | ' -c "SELECT code, prefix, course_number, number_suffix FROM courses WHERE code IN ('GC 3460','GC 4900ap','ACCT 2010') ORDER BY code"
```
Expected: `course_codes` table exists; `GC 3460 | GC | 3460 |`, `GC 4900ap | GC | 4900 | ap`, `ACCT 2010 | ACCT | 2010 |`.

- [ ] **Step 7: tsc**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(schema): structured identity columns + course_codes table + materials.source_code (migration 0037)"
```

---

### Task 3: Backfill anti-drift test

**Files:**
- Test: `tests/db/course-identity-backfill.test.ts`

- [ ] **Step 1: Write the test**

Pins the migration's backfill to the parser for the live roster (mirrors the existing `course-category-migration.test.ts` pattern — read it first for the exact DB-read style; reuse its connection approach). Skips when DATABASE_URL is unset.

```typescript
// tests/db/course-identity-backfill.test.ts
// Real-DB test: requires DATABASE_URL (see .env.local). Skips (not fails) when unset.
import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';
import { parseCourseCode } from '@/lib/courses/parse-course-code';

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)('course identity backfill matches the parser', () => {
  it('every course row\'s parsed parts equal parseCourseCode(code)', async () => {
    const rows = await db.select().from(courses);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const p = parseCourseCode(r.code);
      if (p.number === null) continue; // unparseable codes keep null — not backfilled
      expect({ prefix: r.prefix, number: r.courseNumber, suffix: r.numberSuffix })
        .toEqual({ prefix: p.prefix, number: p.number, suffix: p.suffix });
    }
  });
});
```

- [ ] **Step 2: Run with DB**

Run: `DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | sed 's/[[:space:]]*#.*$//')" pnpm vitest run tests/db/course-identity-backfill.test.ts`
Expected: PASS. Without DATABASE_URL it must skip, not fail (verify: `pnpm vitest run tests/db/course-identity-backfill.test.ts` → skipped).

- [ ] **Step 3: Commit**

```bash
git add tests/db/course-identity-backfill.test.ts
git commit -m "test(courses): anti-drift — identity backfill matches parser on live roster"
```

---

### Task 4: course_codes queries

**Files:**
- Create: `lib/db/course-codes-queries.ts`
- Test: `tests/lib/db/course-codes-queries.test.ts`

- [ ] **Step 1: Write the failing test** (real-DB, skipIf, self-cleaning — mirror `tests/lib/db/flag-queries.test.ts`)

```typescript
// tests/lib/db/course-codes-queries.test.ts
// Real-DB test: requires DATABASE_URL. Skips (not fails) when unset.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import { courses, courseCodes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { addPairedCode, listPairedCodes } from '@/lib/db/course-codes-queries';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const PRIMARY = 'ZZ 9100';

describe.skipIf(!HAS_DB)('course-codes queries', () => {
  beforeAll(async () => {
    await db.insert(courses).values({ code: PRIMARY, title: 'Pair test', level: 9000, track: 'test' } as never).onConflictDoNothing();
  });
  afterAll(async () => {
    await db.delete(courseCodes).where(eq(courseCodes.courseCode, PRIMARY));
    await db.delete(courses).where(eq(courses.code, PRIMARY));
  });
  it('adds a paired code and lists it by primary', async () => {
    await addPairedCode({ courseCode: PRIMARY, pairedCode: 'ZZ 9101', role: 'lab' });
    const paired = await listPairedCodes(PRIMARY);
    expect(paired.map(p => p.pairedCode)).toEqual(['ZZ 9101']);
    expect(paired[0]!.role).toBe('lab');
  });
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm vitest run tests/lib/db/course-codes-queries.test.ts` with DATABASE_URL — module not found)

- [ ] **Step 3: Implement**

```typescript
// lib/db/course-codes-queries.ts
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseCodes } from '@/lib/db/schema';

export type CourseCodeRow = typeof courseCodes.$inferSelect;
export type PairedRole = 'lecture' | 'lab' | 'other';

export interface AddPairedCodeInput {
  courseCode: string;          // the PRIMARY course
  pairedCode: string;
  role: PairedRole;
}

export async function addPairedCode(input: AddPairedCodeInput): Promise<CourseCodeRow> {
  const [row] = await db.insert(courseCodes).values(input).returning();
  if (!row) throw new Error('addPairedCode: no row returned');
  return row;
}

export async function listPairedCodes(courseCode: string): Promise<CourseCodeRow[]> {
  return db.select().from(courseCodes).where(eq(courseCodes.courseCode, courseCode)).orderBy(asc(courseCodes.createdAt));
}

/** All paired codes for a set of primaries (batched read for list views). */
export async function listPairedCodesForCourses(courseCodesList: string[]): Promise<CourseCodeRow[]> {
  if (courseCodesList.length === 0) return [];
  const { inArray } = await import('drizzle-orm');
  return db.select().from(courseCodes).where(inArray(courseCodes.courseCode, courseCodesList));
}
```

- [ ] **Step 4: Run → PASS** + `pnpm tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db/course-codes-queries.ts tests/lib/db/course-codes-queries.test.ts
git commit -m "feat(courses): course_codes queries (add/list paired codes)"
```

---

### Task 5: createCourse sets structured fields + formatCourseLabel

**Files:**
- Modify: `lib/db/courses-queries.ts`
- Test: `tests/lib/courses/format-course-label.test.ts`

- [ ] **Step 1: Write the failing test for the label helper**

```typescript
// tests/lib/courses/format-course-label.test.ts
import { describe, it, expect } from 'vitest';
import { formatCourseLabel } from '@/lib/db/courses-queries';

describe('formatCourseLabel', () => {
  it('returns the bare code when there are no paired codes', () => {
    expect(formatCourseLabel('GC 3460', [])).toBe('GC 3460');
  });
  it('collapses a shared-prefix pair to prefix + slash numbers', () => {
    expect(formatCourseLabel('GC 3460', [{ pairedCode: 'GC 3461', role: 'lab' }]))
      .toBe('GC 3460/3461');
  });
  it('joins differing prefixes with +', () => {
    expect(formatCourseLabel('GC 3460', [{ pairedCode: 'XX 1234', role: 'lab' }]))
      .toBe('GC 3460 + XX 1234');
  });
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm vitest run tests/lib/courses/format-course-label.test.ts` — not exported).

- [ ] **Step 3: Implement in `lib/db/courses-queries.ts`**

Add the import at the top: `import { parseCourseCode, composeCourseCode } from '@/lib/courses/parse-course-code';`

Add the exported helper (pure — near the other exports):

```typescript
/**
 * Display label for a (possibly bundled) course. No paired codes → the bare
 * code. Paired codes sharing the prefix collapse to "GC 3460/3461"; differing
 * prefixes join with " + ". Spec 2026-06-13.
 */
export function formatCourseLabel(
  code: string,
  pairedCodes: ReadonlyArray<{ pairedCode: string }>,
): string {
  if (pairedCodes.length === 0) return code;
  const base = parseCourseCode(code);
  const parts = pairedCodes.map(p => {
    const pc = parseCourseCode(p.pairedCode);
    return pc.prefix === base.prefix && pc.number !== null
      ? `${pc.number}${pc.suffix}`        // same prefix → just the number
      : p.pairedCode;                      // differing prefix → full code
  });
  const sameAll = pairedCodes.every(p => parseCourseCode(p.pairedCode).prefix === base.prefix);
  return sameAll ? `${code}/${parts.join('/')}` : `${code} + ${parts.join(' + ')}`;
}
```

Extend `NewCourseInput` (add optional structured + paired fields):

```typescript
export interface NewCourseInput {
  code: string;
  title: string;
  level?: number;
  track?: string;
  prerequisites?: string;
  catalogUrl?: string | null;
  pairedCode?: string;                       // optional bundled lab/lecture
  pairedRole?: 'lecture' | 'lab' | 'other';
}
```

Update `createCourse` to set structured fields from the parsed code and create the paired-code row when given. Replace the existing `createCourse` body with:

```typescript
export async function createCourse(input: NewCourseInput): Promise<void> {
  const code = input.code.trim();
  const parsed = parseCourseCode(code);
  await db
    .insert(courses)
    .values({
      code,
      title: (input.title ?? code).trim(),
      level: input.level ?? 0,
      track: input.track ?? 'unspecified',
      prerequisites: input.prerequisites ?? '',
      catalogUrl: input.catalogUrl?.trim() || null,
      prefix: parsed.prefix,
      courseNumber: parsed.number,
      numberSuffix: parsed.suffix,
    })
    .onConflictDoNothing();

  if (input.pairedCode && input.pairedRole) {
    const paired = composeCourseCode(parseCourseCode(input.pairedCode.trim()));
    if (paired) {
      const { courseCodes } = await import('@/lib/db/schema');
      await db.insert(courseCodes)
        .values({ courseCode: code, pairedCode: paired, role: input.pairedRole })
        .onConflictDoNothing();
    }
  }
}
```

Also set structured fields in `bulkCreateCourses` and `upsertCourses` `.values(...)` maps — add `prefix`/`courseNumber`/`numberSuffix` from `parseCourseCode(i.code)` (bulk) and `parseCourseCode(p.code)` (upsert) to each row object, so sheet-synced + bulk-added courses populate identity too. (Read both functions; add the three fields to their value objects.)

- [ ] **Step 4: Run → PASS** + `pnpm tsc --noEmit` clean + `pnpm test` green.

- [ ] **Step 5: Commit**

```bash
git add lib/db/courses-queries.ts tests/lib/courses/format-course-label.test.ts
git commit -m "feat(courses): createCourse/bulk/upsert set structured identity; formatCourseLabel + paired-code create"
```

---

### Task 6: roster route accepts paired course

**Files:**
- Modify: `app/api/admin/courses/roster/route.ts`
- Test: `tests/app/api/roster-add.test.ts`

- [ ] **Step 1: Write the failing test** (mock `@/lib/db/courses-queries` + `@/lib/auth/admin-auth`)

```typescript
// tests/app/api/roster-add.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (_r: unknown, o: { slug?: string }) => o.slug === 'good' }));
vi.mock('@/lib/http/is-http-url', () => ({ isHttpUrl: (u: string) => u.startsWith('http') }));
const createCourse = vi.fn(async () => {});
vi.mock('@/lib/db/courses-queries', () => ({ createCourse: (...a: unknown[]) => createCourse(...a), bulkCreateCourses: vi.fn(), }));
import { POST } from '@/app/api/admin/courses/roster/route';
beforeEach(() => vi.clearAllMocks());

it('one-add with a paired course passes pairedCode/pairedRole through', async () => {
  const res = await POST(new Request('http://x/api/admin/courses/roster?slug=good', {
    method: 'POST',
    body: JSON.stringify({ mode: 'one', code: 'GC 3460', title: 'Lecture', pairedCode: 'GC 3461', pairedRole: 'lab' }),
  }));
  expect(res.status).toBe(200);
  expect(createCourse).toHaveBeenCalledWith(expect.objectContaining({ code: 'GC 3460', pairedCode: 'GC 3461', pairedRole: 'lab' }));
});

it('rejects an invalid pairedRole', async () => {
  const res = await POST(new Request('http://x/api/admin/courses/roster?slug=good', {
    method: 'POST',
    body: JSON.stringify({ mode: 'one', code: 'GC 3460', title: 'L', pairedCode: 'GC 3461', pairedRole: 'bogus' }),
  }));
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement** — in the `mode === 'one'` branch, after the catalogUrl validation and before `createCourse(...)`, read + validate the paired fields and pass them:

```typescript
    const pairedCode = typeof body.pairedCode === 'string' ? body.pairedCode.trim() : '';
    const pairedRole = typeof body.pairedRole === 'string' ? body.pairedRole : '';
    if (pairedCode && !['lecture', 'lab', 'other'].includes(pairedRole)) {
      return NextResponse.json({ error: 'pairedRole must be lecture | lab | other when pairedCode is set' }, { status: 400 });
    }
    await createCourse({
      code, title, level, track, catalogUrl: catalogUrlRaw || null,
      ...(pairedCode ? { pairedCode, pairedRole: pairedRole as 'lecture' | 'lab' | 'other' } : {}),
    });
    return NextResponse.json({ ok: true });
```

- [ ] **Step 4: Run → PASS** + tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/courses/roster/route.ts" tests/app/api/roster-add.test.ts
git commit -m "feat(courses): roster one-add accepts paired course (code + role)"
```

---

### Task 7: NewCourseForm — prefix/number + paired-course disclosure

**Files:**
- Modify: `app/courses/new/NewCourseForm.tsx`
- Test: `tests/app/courses/new-course-form.test.tsx` (extend existing)

- [ ] **Step 1: Add failing tests** (extend the existing file; follow its render/mock style — it mocks `next/navigation`)

```tsx
it('composes code from prefix + number and posts paired course when given', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetchMock);
  render(<NewCourseForm slug="s" />);
  fireEvent.change(screen.getByLabelText(/prefix/i), { target: { value: 'GC' } });
  fireEvent.change(screen.getByLabelText(/course number/i), { target: { value: '3460' } });
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Junior Seminar' } });
  fireEvent.click(screen.getByRole('button', { name: /add a paired course/i }));
  fireEvent.change(screen.getByLabelText(/paired number/i), { target: { value: '3461' } });
  fireEvent.change(screen.getByLabelText(/paired role/i), { target: { value: 'lab' } });
  fireEvent.click(screen.getByRole('button', { name: /add (course|& start)/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
  expect(body).toMatchObject({ mode: 'one', code: 'GC 3460', title: 'Junior Seminar', pairedCode: 'GC 3461', pairedRole: 'lab' });
});
```
(Adjust the existing "renders 3 fields" / "navigates on success" tests for the new prefix+number fields replacing the single code field — the post body now sends `code` composed from prefix+number; redirect target is `/capture/<composed code>`.)

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement** — replace the single `code` field with `prefix` + `courseNumber` state; compose `const code = \`${prefix.trim()} ${number.trim()}\`` (the route + createCourse re-parse, so a suffix typed into the number box like `4900ap` is handled). Add a collapsible "+ Add a paired course (e.g. lab)" revealing a `pairedNumber` input + `pairedRole` select (lecture/lab/other); when filled, compose `pairedCode = \`${prefix.trim()} ${pairedNumber.trim()}\`` (paired shares the primary's prefix) and include `pairedCode`/`pairedRole` in the POST body. Redirect to `/capture/${encodeURIComponent(code)}?slug=…`. Keep the inline-error + isHttpUrl-free pattern as-is. Labels must include accessible text matching the test queries ("Prefix", "Course number", "Title", "Paired number", "Paired role", "+ Add a paired course").

- [ ] **Step 4: Run → PASS** + tsc clean.

- [ ] **Step 5: Commit**

```bash
git add app/courses/new/NewCourseForm.tsx tests/app/courses/new-course-form.test.tsx
git commit -m "feat(courses): add-flow captures prefix/number + optional paired course"
```

---

### Task 8: Canvas import stamps source_code

**Files:**
- Modify: `lib/db/course-materials-queries.ts` (InsertMaterialInput already spreads — confirm `sourceCode` flows), `app/api/courses/[code]/canvas-import/route.ts`
- Test: `tests/app/api/canvas-import-source.test.ts`

- [ ] **Step 1: Confirm `InsertMaterialInput` carries `sourceCode`**

`insertMaterial` does `.values({ ...input, extractionStatus: 'pending' })`. Read `InsertMaterialInput` in `lib/db/course-materials-queries.ts`; add `sourceCode?: string | null;` to it if absent (the schema column exists from Task 2, so Drizzle accepts it via the spread).

- [ ] **Step 2: Write the failing test** (mock the Canvas fetch + insertMaterial; assert sourceCode threads). The route is large — the focused assertion: when the request body carries `sourceCode`, every `insertMaterial` call includes it.

```typescript
// tests/app/api/canvas-import-source.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const insertMaterial = vi.fn(async (i: Record<string, unknown>) => ({ id: 'm', ...i }));
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial: (...a: unknown[]) => insertMaterial(...a),
  findMaterialByFileName: vi.fn(async () => null),
  updateMaterialMetadata: vi.fn(),
}));
// ...mock auth, fetchCanvasCourse to return one assignment so a single insert happens,
//    getCourseByCode, updateCourseCanvasImport per the route's imports...
beforeEach(() => vi.clearAllMocks());
// asserts: POST with {sourceCode:'GC 3461'} → insertMaterial called with sourceCode:'GC 3461';
// POST without sourceCode → insertMaterial called with sourceCode undefined/null (primary).
```
(Build the mocks by reading the route's import list; keep the test minimal — one inserted material is enough to assert the field threads.)

- [ ] **Step 3: Implement** — in the canvas-import route: read `const sourceCode = typeof body.sourceCode === 'string' && body.sourceCode.trim() ? body.sourceCode.trim() : null;` and include `sourceCode` in every `insertMaterial({...})` call (the `toInsert` loop). When `sourceCode` is non-null and differs from the primary `code`, also write provenance to the matching `course_codes` row (`canvas_course_name`/`canvas_imported_at`) — add a `setPairedCanvasProvenance(pairedCode, name, at)` to `course-codes-queries.ts`; when null, keep the existing `updateCourseCanvasImport` on the primary.

- [ ] **Step 4: Run → PASS** + tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "app/api/courses/[code]/canvas-import/route.ts" lib/db/course-materials-queries.ts lib/db/course-codes-queries.ts tests/app/api/canvas-import-source.test.ts
git commit -m "feat(canvas): import stamps source_code + per-paired-code provenance"
```

---

### Task 9: Bundle-aware CanvasBox + plumb pairedCodes

**Files:**
- Modify: `app/capture/[code]/page.tsx` (load paired codes, pass through), `CaptureClient.tsx` + `CaptureMaterialsStep.tsx` (prop pass-through), `app/capture/[code]/boxes/CanvasBox.tsx`
- Test: `app/capture/[code]/__tests__/CanvasBox.test.tsx` (extend)

- [ ] **Step 1: Load paired codes server-side**

In `app/capture/[code]/page.tsx`, add `import { listPairedCodes } from '@/lib/db/course-codes-queries';`, fetch `const pairedCodes = await listPairedCodes(code);` (alongside the existing loads), map to a serializable `{ pairedCode, role, canvasCourseName, canvasImportedAt: iso|null }[]`, and pass `pairedCodes` through `CaptureClient` → `CaptureMaterialsStep` → `CanvasBox`. Add `pairedCodes` to the relevant prop interfaces (`CourseCatalogView` is the natural carrier — add `pairedCodes` there, or thread a sibling prop; choose whichever keeps the boxes' prop list smallest and document it).

- [ ] **Step 2: Write the failing CanvasBox test**

```tsx
it('renders per-page import slots + groups items by source when paired codes exist', () => {
  const paired = [{ pairedCode: 'GC 3461', role: 'lab', canvasCourseName: null, canvasImportedAt: null }];
  render(<CanvasBox course={{ ...course, pairedCodes: paired } as never} materials={[
    mat({ id: 'a', fileName: 'Canvas: Assignments', extractedText: '## X (10 pts)', sourceCode: null }),
    mat({ id: 'b', fileName: 'Canvas: Assignments', extractedText: '## Y (5 pts)', sourceCode: 'GC 3461' }),
  ]} slug="s" onMaterialsChange={noop} />);
  fireEvent.click(screen.getByRole('button', { name: /canvas/i }));
  // two import slots: the primary and the lab
  expect(screen.getByText(/lab/i)).toBeTruthy();
  expect(screen.getByText(/import/i)).toBeTruthy();
  // a single course-level "Scan linked docs" (footer), not duplicated
  expect(screen.getAllByRole('button', { name: /scan linked docs/i })).toHaveLength(1);
});

it('renders today’s single-import layout when there are no paired codes', () => {
  render(<CanvasBox course={{ ...course, pairedCodes: [] } as never} materials={[mat({ fileName: 'Canvas: Assignments', extractedText: '## X' })]} slug="s" onMaterialsChange={noop} />);
  fireEvent.click(screen.getByRole('button', { name: /canvas/i }));
  expect(screen.queryByText(/lab/i)).toBeNull();
});
```
(`mat()` factory gains `sourceCode`. The test `course` fixture gains `pairedCodes`.)

- [ ] **Step 3: Run → FAIL**.

- [ ] **Step 4: Implement CanvasBox bundle-awareness**

When `course.pairedCodes.length > 0`:
- Header renders an **import slot per code** (primary `course.code` + each paired): label `"{Role} · {code} · imported {M/D/YY}"` or `"… · not yet imported · Import"`; each Import opens the existing token field and POSTs canvas-import with `sourceCode = <that code>` (primary slot omits sourceCode / sends the primary). Provenance per slot from `course.canvasImportedAt` (primary) or the paired row's `canvasImportedAt`.
- Unrolled item list **grouped by `m.sourceCode`** (null = primary) under `"Lecture ({code})"` / `"Lab ({pairedCode})"` subheaders, using each paired code's `role`.
- Course-level **Reimport-all** + **Scan linked docs** render **once** in the footer (unchanged behavior).
When `pairedCodes.length === 0`: render exactly as today (no slots, no grouping, single import).
Keep all existing per-item behaviors (ignore, Index now, rubric ✓, points, include-anyway) intact within the grouped lists.

- [ ] **Step 5: Run → PASS**; `pnpm tsc --noEmit` clean; `pnpm test` green; `pnpm vitest run "app/capture/[code]/__tests__/"` green.

- [ ] **Step 6: Commit**

```bash
git add "app/capture/[code]/page.tsx" "app/capture/[code]/CaptureClient.tsx" "app/capture/[code]/CaptureMaterialsStep.tsx" "app/capture/[code]/boxes/CanvasBox.tsx" "app/capture/[code]/__tests__/CanvasBox.test.tsx"
git commit -m "feat(capture): bundle-aware Canvas box — per-page import slots, source-grouped items, single footer actions"
```

---

### Task 10: Display label across surfaces + STATE.md

**Files:**
- Modify: `app/page.tsx`, `app/courses/*` list, `app/capture/[code]/page.tsx` header, `lib/db/program-coverage-queries.ts` (label), `docs/STATE.md`

- [ ] **Step 1: Surface the bundled label (no test — display wiring; verified by tsc + a render spot-check)**

Where each surface shows a course code, swap to `formatCourseLabel(code, pairedCodes)`:
- `/` landing (`app/page.tsx`) + `/courses` list: the list loaders already return rows; add a batched `listPairedCodesForCourses(codes)` lookup and pass each row its paired codes. (If this balloons the loader, ship the label on the capture header + matrix first and leave the catalog lists showing bare codes — note the deferral in STATE.md Deferred/debt rather than over-reaching.)
- Capture header (`app/capture/[code]/page.tsx`): label from the `pairedCodes` already loaded in Task 9.
- Matrix (`lib/db/program-coverage-queries.ts` → `MatrixCourse`): add `pairedCodes` to the row (batched lookup) and render `formatCourseLabel` in the row header — ONE row per primary, label only; no structural change.

- [ ] **Step 2: tsc + full suite**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: clean, green.

- [ ] **Step 3: Update STATE.md**

- Schema section: prepend migration `0037` to the lineage (identity columns + `course_codes` + `course_materials.source_code`; applied date; backfill note).
- Tables list: add `courseCodes` (paired lecture/lab codes; not a courses row) + note `course_materials.source_code`.
- "What's live"/Active arc: one line — structured identity + lecture/lab bundling shipped (refined Option 3; capture pipeline + matrix frozen; spec link).
- Deferred/debt: record anything deferred from Step 1 (e.g. catalog-list labels if not done), and the standing Option-1 migration seam (promote a paired_code to its own courses row).

- [ ] **Step 4: Commit**

```bash
git add app/ lib/db/program-coverage-queries.ts docs/STATE.md
git commit -m "feat(courses): bundled display label across landing/capture/matrix; STATE.md (migration 0037)"
```

---

## Plan self-review (done at write time)

- **Spec coverage:** identity columns + parser (T1, T2), backfill + anti-drift (T2/T3), `course_codes` table + queries (T2, T4), `source_code` (T2, T8), add-flow paired course (T5–T7), bundle-aware Canvas box (T8, T9), display label (T5, T10), capture/matrix frozen (asserted by absence — no task touches synthesis/snapshot/tenant/scoring). ✓ all spec sections mapped.
- **Frozen-surface guard:** no task modifies `lib/ai/analyze/capture-scores.ts`, `audit-tools.ts`, `program-score-coverage`, snapshot creation, or `getMatrixData`'s `DISTINCT ON` — only its row *label*. The reviewer for each task should reject any such drift.
- **Type consistency:** `ParsedCode.number: number|null` consistent across parser, backfill (null skipped), `courses.courseNumber` (nullable int), `formatCourseLabel` (uses parsed parts); `pairedCode`/`pairedRole` consistent across `NewCourseInput`, roster route, form, queries; `sourceCode` consistent across schema, `InsertMaterialInput`, canvas-import, CanvasBox grouping.
- **Migration safety:** 0037 is additive (ADD COLUMN with defaults, CREATE TABLE/TYPE) + a guarded UPDATE backfill; inspected before apply.

