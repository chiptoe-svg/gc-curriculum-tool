# Course Categories + Career-Mapping Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4-way `category` display enum, a `builds_to_career` analysis flag, and an optional `catalog_url` to courses; regroup the public landing page by category; gate the career-coverage matrix on `builds_to_career`; and add editing affordances.

**Architecture:** Three new columns on the existing `courses` table. A canonical TypeScript seed map (`lib/db/course-category-seed.ts`) is the single source of truth for the 46-course classification; the migration backfills from it and a test guards the migration SQL against drift. Pure helpers (`groupByCategory`, `isHttpUrl`) carry the testable logic so the React/SQL surfaces stay thin. The career-coverage queries gain a `builds_to_career = true` filter at their two choke points.

**Tech Stack:** Next.js 15 (App Router, server + client components), Drizzle ORM on Postgres 17, Vitest (fully-mocked DB — no live Postgres in unit tests), lucide-react, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-11-course-categories-and-career-mapping-flag-design.md`

---

## Background the implementer must know

- **No live DB in unit tests.** Existing DB tests mock `@/lib/db/client` and `@/lib/db/schema` (see `lib/db/__tests__/program-coverage-queries.test.ts`). Do NOT write tests that need a real Postgres. Test pure functions directly; test query functions by spying on the mocked `db`; assert raw-SQL filters by serializing the captured `sql` object with `PgDialect`.
- **Serializing a raw `sql` object in a test:**
  ```ts
  import { PgDialect } from 'drizzle-orm/pg-core';
  const text = new PgDialect().sqlToQuery(capturedSqlObject).sql; // string
  ```
- **Migration hashing.** `drizzle/meta/_journal.json` stores NO hash (only idx/version/when/tag/breakpoints). The SHA is computed from the `.sql` file content at `db:migrate` time. Therefore: generate the migration, THEN append the backfill `UPDATE`s to the same `.sql` file BEFORE running `db:migrate`. The stored hash will match the final content — no drift.
- **Apply path is watermark-based.** `db:migrate` only runs journal entries whose `when` exceeds the max applied `created_at` (currently 0031). Generating a new migration appends a later `when`, so it (plus the inert pre-existing 0032) applies; nothing else re-runs. Do not touch the journal otherwise.
- **psql for verification:** `DB=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | tr -d '"'); /Applications/Postgres.app/Contents/Versions/17/bin/psql "$DB" -c "…"`
- **Run a single test file:** `pnpm vitest run <path>` (or `pnpm test <path>`). Full suite: `pnpm test`.

---

## File Structure

- **Create** `lib/db/course-category-seed.ts` — canonical classification: `CourseCategory` type, `CATEGORY_ORDER`, `CATEGORY_LABELS`, `COURSE_CLASSIFICATION_SEED` (46 entries), and derived code-list helpers used to write/verify the migration.
- **Create** `lib/db/__tests__/course-category-seed.test.ts` — invariant tests on the seed map.
- **Modify** `lib/db/schema.ts` — add `courseCategory` pgEnum + `category`, `buildsToCareer`, `catalogUrl` columns.
- **Create** `drizzle/0033_*.sql` (generated, then hand-appended backfill) + journal/snapshot updates from `db:generate`.
- **Create** `lib/db/__tests__/course-category-migration.test.ts` — asserts the generated migration SQL matches the seed map (anti-drift).
- **Create** `lib/courses/group-by-category.ts` — pure `groupByCategory` for the landing page.
- **Create** `lib/courses/__tests__/group-by-category.test.ts`.
- **Modify** `lib/db/capture-status-queries.ts` — surface `category`, `buildsToCareer`, `catalogUrl` on `CourseStatusRow`.
- **Create** `lib/db/__tests__/capture-status-queries.test.ts` — assert new fields pass through.
- **Modify** `app/page.tsx` — regroup by category; career-path icon; Add-course funnel link.
- **Modify** `lib/db/program-coverage-queries.ts` — `builds_to_career = true` filter in `getMatrixData` + `listStalePairs`.
- **Modify** `lib/db/__tests__/program-coverage-queries.test.ts` — assert the filter is present in emitted SQL.
- **Create** `lib/http/is-http-url.ts` — pure URL validator. **Create** its test.
- **Modify** `lib/db/courses-queries.ts` — `catalogUrl` on `NewCourseInput`/`createCourse`/`bulkCreateCourses`; add `updateCourseClassification`.
- **Modify** `lib/db/__tests__/courses-queries.test.ts` — cover `catalogUrl` + `updateCourseClassification`.
- **Modify** `app/api/admin/courses/roster/route.ts` — accept + validate `catalogUrl` in `mode:'one'`.
- **Create** `app/api/admin/courses/[code]/route.ts` — `PATCH` classification endpoint. **Create** its test.
- **Modify** `app/courses/CourseRosterControls.tsx` — catalog-URL input on the add form.
- **Create** `app/courses/CourseClassControls.tsx` — per-course category/flag/catalog editor.
- **Modify** `app/courses/CoursesIndex.tsx` — render the per-course editor.
- **Update** `docs/STATE.md`.

---

### Task 1: Canonical classification seed map

**Files:**
- Create: `lib/db/course-category-seed.ts`
- Test: `lib/db/__tests__/course-category-seed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/db/__tests__/course-category-seed.test.ts
import { describe, it, expect } from 'vitest';
import {
  COURSE_CLASSIFICATION_SEED,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  codesForCategory,
  codesBuildingToCareer,
} from '@/lib/db/course-category-seed';

describe('COURSE_CLASSIFICATION_SEED', () => {
  it('classifies exactly 46 courses', () => {
    expect(Object.keys(COURSE_CLASSIFICATION_SEED)).toHaveLength(46);
  });

  it('partitions into 16 / 14 / 16 / 0 by category', () => {
    expect(codesForCategory('gc_core')).toHaveLength(16);
    expect(codesForCategory('specialty')).toHaveLength(14);
    expect(codesForCategory('major_req')).toHaveLength(16);
    expect(codesForCategory('other')).toHaveLength(0);
  });

  it('flags exactly 27 courses as building to career', () => {
    expect(codesBuildingToCareer()).toHaveLength(27);
  });

  it('flags every GC Core course true and every Specialty course false', () => {
    for (const c of codesForCategory('gc_core')) {
      expect(COURSE_CLASSIFICATION_SEED[c].buildsToCareer).toBe(true);
    }
    for (const c of codesForCategory('specialty')) {
      expect(COURSE_CLASSIFICATION_SEED[c].buildsToCareer).toBe(false);
    }
  });

  it('excludes the 5 unselected choose-one Major Req sides', () => {
    for (const c of ['STAT 2220', 'STAT 3090', 'STAT 3300', 'ECON 2000', 'PCID 3140']) {
      expect(COURSE_CLASSIFICATION_SEED[c]).toMatchObject({ category: 'major_req', buildsToCareer: false });
    }
  });

  it('includes the 11 named Major Req courses', () => {
    for (const c of ['ACCT 2010', 'ACCT 2020', 'MGT 2010', 'MKT 3010', 'PKSC 1020', 'STAT 2300', 'ENGL 1030', 'ENSP 2000', 'PSYC 2010', 'ECON 2110', 'PCID 3040']) {
      expect(COURSE_CLASSIFICATION_SEED[c]).toMatchObject({ category: 'major_req', buildsToCareer: true });
    }
  });

  it('orders categories with labels', () => {
    expect(CATEGORY_ORDER).toEqual(['gc_core', 'specialty', 'major_req', 'other']);
    expect(CATEGORY_LABELS.gc_core).toBe('GC Core');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/db/__tests__/course-category-seed.test.ts`
Expected: FAIL — cannot resolve `@/lib/db/course-category-seed`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/db/course-category-seed.ts
export type CourseCategory = 'gc_core' | 'specialty' | 'major_req' | 'other';

/** Display order on the public landing page. */
export const CATEGORY_ORDER: CourseCategory[] = ['gc_core', 'specialty', 'major_req', 'other'];

export const CATEGORY_LABELS: Record<CourseCategory, string> = {
  gc_core: 'GC Core',
  specialty: 'Specialty Area / GC Tech',
  major_req: 'Major Requirements + GenEds',
  other: 'Other courses',
};

export interface CourseClassification {
  category: CourseCategory;
  buildsToCareer: boolean;
}

/**
 * Single source of truth for the initial classification of the 46 catalog
 * courses. The 0033 migration backfills `category` + `builds_to_career` from
 * this map; `course-category-migration.test.ts` guards the SQL against drift.
 * Newly-added courses are NOT here — they default to category='other',
 * builds_to_career=false at the DB level.
 */
export const COURSE_CLASSIFICATION_SEED: Record<string, CourseClassification> = {
  // ── GC Core (16) — all build to career ──────────────────────────────────
  'GC 1010': { category: 'gc_core', buildsToCareer: true },
  'GC 1020': { category: 'gc_core', buildsToCareer: true },
  'GC 1040': { category: 'gc_core', buildsToCareer: true },
  'GC 1050': { category: 'gc_core', buildsToCareer: true },
  'GC 2070': { category: 'gc_core', buildsToCareer: true },
  'GC 2400': { category: 'gc_core', buildsToCareer: true },
  'GC 3400': { category: 'gc_core', buildsToCareer: true },
  'GC 3460': { category: 'gc_core', buildsToCareer: true },
  'GC 3500': { category: 'gc_core', buildsToCareer: true },
  'GC 3800': { category: 'gc_core', buildsToCareer: true },
  'GC 4060': { category: 'gc_core', buildsToCareer: true },
  'GC 4400': { category: 'gc_core', buildsToCareer: true },
  'GC 4440': { category: 'gc_core', buildsToCareer: true },
  'GC 4480': { category: 'gc_core', buildsToCareer: true },
  'GC 4500': { category: 'gc_core', buildsToCareer: true },
  'GC 4800': { category: 'gc_core', buildsToCareer: true },
  // ── Specialty Area / GC Tech (14) — all excluded ────────────────────────
  'GC 3620': { category: 'specialty', buildsToCareer: false },
  'GC 3700': { category: 'specialty', buildsToCareer: false },
  'GC 3710': { category: 'specialty', buildsToCareer: false },
  'GC 3720': { category: 'specialty', buildsToCareer: false },
  'GC 3730': { category: 'specialty', buildsToCareer: false },
  'GC 3740': { category: 'specialty', buildsToCareer: false },
  'GC 3760': { category: 'specialty', buildsToCareer: false },
  'GC 3780': { category: 'specialty', buildsToCareer: false },
  'GC 3790': { category: 'specialty', buildsToCareer: false },
  'GC 4070': { category: 'specialty', buildsToCareer: false },
  'GC 4900ap': { category: 'specialty', buildsToCareer: false },
  'GC 4900bl': { category: 'specialty', buildsToCareer: false },
  'GC 4900or': { category: 'specialty', buildsToCareer: false },
  'GC 4990ta': { category: 'specialty', buildsToCareer: false },
  // ── Major Requirements + GenEds (16) — 11 included / 5 excluded ──────────
  'ACCT 2010': { category: 'major_req', buildsToCareer: true },
  'ACCT 2020': { category: 'major_req', buildsToCareer: true },
  'MGT 2010': { category: 'major_req', buildsToCareer: true },
  'MKT 3010': { category: 'major_req', buildsToCareer: true },
  'PKSC 1020': { category: 'major_req', buildsToCareer: true },
  'STAT 2300': { category: 'major_req', buildsToCareer: true },
  'ENGL 1030': { category: 'major_req', buildsToCareer: true },
  'ENSP 2000': { category: 'major_req', buildsToCareer: true },
  'PSYC 2010': { category: 'major_req', buildsToCareer: true },
  'ECON 2110': { category: 'major_req', buildsToCareer: true },
  'PCID 3040': { category: 'major_req', buildsToCareer: true },
  'STAT 2220': { category: 'major_req', buildsToCareer: false },
  'STAT 3090': { category: 'major_req', buildsToCareer: false },
  'STAT 3300': { category: 'major_req', buildsToCareer: false },
  'ECON 2000': { category: 'major_req', buildsToCareer: false },
  'PCID 3140': { category: 'major_req', buildsToCareer: false },
};

export function codesForCategory(category: CourseCategory): string[] {
  return Object.entries(COURSE_CLASSIFICATION_SEED)
    .filter(([, v]) => v.category === category)
    .map(([code]) => code);
}

export function codesBuildingToCareer(): string[] {
  return Object.entries(COURSE_CLASSIFICATION_SEED)
    .filter(([, v]) => v.buildsToCareer)
    .map(([code]) => code);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/db/__tests__/course-category-seed.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/course-category-seed.ts lib/db/__tests__/course-category-seed.test.ts
git commit -m "feat(courses): canonical category + builds-to-career seed map"
```

---

### Task 2: Schema columns + enum + generate migration

**Files:**
- Modify: `lib/db/schema.ts:1` (import) and `lib/db/schema.ts:81-95` (courses table)
- Generated: `drizzle/0033_*.sql`, `drizzle/meta/*`

- [ ] **Step 1: Add `pgEnum` to the schema import**

In `lib/db/schema.ts:1`, add `pgEnum` to the `drizzle-orm/pg-core` import:

```ts
import { pgTable, pgEnum, uuid, text, jsonb, timestamp, integer, real, boolean, primaryKey, index, unique, foreignKey } from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: Declare the enum and add the columns**

Immediately ABOVE the `courses` table declaration (`lib/db/schema.ts:81`), add:

```ts
export const courseCategory = pgEnum('course_category', ['gc_core', 'specialty', 'major_req', 'other']);
```

Inside the `courses` table, after `auditMode` (`lib/db/schema.ts:94`), add three columns:

```ts
  category: courseCategory('category').notNull().default('other'),
  buildsToCareer: boolean('builds_to_career').notNull().default(false),
  catalogUrl: text('catalog_url'),                                // nullable — Clemson catalog link
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `drizzle/0033_<name>.sql` is created containing ONLY:
- `CREATE TYPE "public"."course_category" AS ENUM('gc_core', 'specialty', 'major_req', 'other');`
- `ALTER TABLE "courses" ADD COLUMN "category" "course_category" DEFAULT 'other' NOT NULL;`
- `ALTER TABLE "courses" ADD COLUMN "builds_to_career" boolean DEFAULT false NOT NULL;`
- `ALTER TABLE "courses" ADD COLUMN "catalog_url" text;`

- [ ] **Step 4: Verify the generated SQL is clean**

Run: `cat drizzle/0033_*.sql`
Expected: the four statements above and nothing referencing other tables. If anything else appears (e.g. DROP/ALTER on unrelated tables), STOP and report snapshot drift — do not proceed.

- [ ] **Step 5: Commit (schema + generated migration, before backfill)**

```bash
git add lib/db/schema.ts drizzle/0033_*.sql drizzle/meta/
git commit -m "feat(db): add course category, builds_to_career, catalog_url columns"
```

---

### Task 3: Backfill in the migration + anti-drift test + apply

**Files:**
- Modify: `drizzle/0033_*.sql` (append backfill)
- Create: `lib/db/__tests__/course-category-migration.test.ts`

- [ ] **Step 1: Append the backfill UPDATEs to the migration**

Append to `drizzle/0033_*.sql` (after the generated `ADD COLUMN` statements). Drizzle separates statements with `--> statement-breakpoint`; use it between each:

```sql
--> statement-breakpoint
UPDATE "courses" SET "category" = 'gc_core' WHERE "code" IN ('GC 1010','GC 1020','GC 1040','GC 1050','GC 2070','GC 2400','GC 3400','GC 3460','GC 3500','GC 3800','GC 4060','GC 4400','GC 4440','GC 4480','GC 4500','GC 4800');
--> statement-breakpoint
UPDATE "courses" SET "category" = 'specialty' WHERE "code" IN ('GC 3620','GC 3700','GC 3710','GC 3720','GC 3730','GC 3740','GC 3760','GC 3780','GC 3790','GC 4070','GC 4900ap','GC 4900bl','GC 4900or','GC 4990ta');
--> statement-breakpoint
UPDATE "courses" SET "category" = 'major_req' WHERE "code" IN ('ACCT 2010','ACCT 2020','MGT 2010','MKT 3010','PKSC 1020','STAT 2300','ENGL 1030','ENSP 2000','PSYC 2010','ECON 2110','PCID 3040','STAT 2220','STAT 3090','STAT 3300','ECON 2000','PCID 3140');
--> statement-breakpoint
UPDATE "courses" SET "builds_to_career" = true WHERE "code" IN ('GC 1010','GC 1020','GC 1040','GC 1050','GC 2070','GC 2400','GC 3400','GC 3460','GC 3500','GC 3800','GC 4060','GC 4400','GC 4440','GC 4480','GC 4500','GC 4800','ACCT 2010','ACCT 2020','MGT 2010','MKT 3010','PKSC 1020','STAT 2300','ENGL 1030','ENSP 2000','PSYC 2010','ECON 2110','PCID 3040');
```

(No `other` UPDATE needed — the column default is `'other'`, and no existing course is in that bucket.)

- [ ] **Step 2: Write the failing anti-drift test**

```ts
// lib/db/__tests__/course-category-migration.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  COURSE_CLASSIFICATION_SEED,
  codesForCategory,
  codesBuildingToCareer,
  type CourseCategory,
} from '@/lib/db/course-category-seed';

const drizzleDir = join(process.cwd(), 'drizzle');
const migrationFile = readdirSync(drizzleDir).find((f) => f.startsWith('0033_') && f.endsWith('.sql'));
const sql = migrationFile ? readFileSync(join(drizzleDir, migrationFile), 'utf8') : '';

/** Pull the IN-list codes from the first UPDATE that sets the given category. */
function codesInCategoryUpdate(category: CourseCategory): string[] {
  const re = new RegExp(`SET "category" = '${category}' WHERE "code" IN \\(([^)]*)\\)`);
  const m = sql.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function codesInBuildsUpdate(): string[] {
  const m = sql.match(/SET "builds_to_career" = true WHERE "code" IN \(([^)]*)\)/);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('0033 migration backfill matches the seed map', () => {
  it('found the migration file', () => {
    expect(migrationFile, 'drizzle/0033_*.sql must exist').toBeTruthy();
  });

  it.each(['gc_core', 'specialty', 'major_req'] as CourseCategory[])(
    'category UPDATE for %s matches the seed exactly',
    (category) => {
      expect(codesInCategoryUpdate(category).sort()).toEqual(codesForCategory(category).sort());
    },
  );

  it('builds_to_career UPDATE matches the seed exactly', () => {
    expect(codesInBuildsUpdate().sort()).toEqual(codesBuildingToCareer().sort());
  });

  it('every seeded code appears in a category UPDATE', () => {
    const all = [
      ...codesInCategoryUpdate('gc_core'),
      ...codesInCategoryUpdate('specialty'),
      ...codesInCategoryUpdate('major_req'),
    ];
    expect(all.sort()).toEqual(Object.keys(COURSE_CLASSIFICATION_SEED).sort());
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `pnpm vitest run lib/db/__tests__/course-category-migration.test.ts`
Expected: PASS. If a category list mismatches, fix the IN-lists in the `.sql` to match the seed.

- [ ] **Step 4: Apply the migration to the dev DB**

Run: `pnpm db:migrate`
Expected: applies 0032 (inert empty `career_target_demand`) and 0033. No errors.

- [ ] **Step 5: Verify the backfill landed**

Run:
```bash
DB=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | tr -d '"'); /Applications/Postgres.app/Contents/Versions/17/bin/psql "$DB" -c "SELECT category, count(*), count(*) FILTER (WHERE builds_to_career) AS builds FROM courses GROUP BY category ORDER BY category;"
```
Expected rows: `gc_core | 16 | 16`, `major_req | 16 | 11`, `specialty | 14 | 0`. Total builds = 27.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0033_*.sql lib/db/__tests__/course-category-migration.test.ts
git commit -m "feat(db): backfill course categories + builds_to_career (27 mapped)"
```

---

### Task 4: Surface new fields on `CourseStatusRow`

**Files:**
- Modify: `lib/db/capture-status-queries.ts:1-17` (import + type) and `:81-90` (return)
- Create: `lib/db/__tests__/capture-status-queries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/db/__tests__/capture-status-queries.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const courseRows = [
  { code: 'GC 1010', title: 'Intro', level: 1, category: 'gc_core', buildsToCareer: true, catalogUrl: 'https://catalog.clemson.edu/gc1010' },
  { code: 'STAT 2220', title: 'Stats', level: 2, category: 'major_req', buildsToCareer: false, catalogUrl: null },
];

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: () => [] }) }),
        orderBy: () => ({ limit: () => [] }),
      }),
    }),
  },
}));

// Re-mock select to fan out the 4 parallel queries: courses, profiles, snapshots, messages.
vi.mock('@/lib/db/schema', () => ({
  courses: {}, courseCaptureProfiles: {}, courseCaptureSnapshots: { retiredAt: 'retired_at', createdAt: 'created_at' }, captureMessages: { courseCode: 'course_code', createdAt: 'created_at' },
}));

beforeEach(() => vi.clearAllMocks());

describe('listCoursesWithStatus carries category + buildsToCareer + catalogUrl', () => {
  it('maps the new fields straight through', async () => {
    const { db } = await import('@/lib/db/client');
    // Sequence the 4 Promise.all selects: [courses, profiles, snapshots, messages].
    let call = 0;
    (db.select as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => {
      call += 1;
      if (call === 1) return { from: () => courseRows };                       // courses
      if (call === 2) return { from: () => [] };                               // profiles
      if (call === 3) return { from: () => ({ where: () => ({ orderBy: () => [] }) }) }; // snapshots
      return { from: () => ({ orderBy: () => ({ limit: () => [] }) }) };        // messages
    });

    const { listCoursesWithStatus } = await import('@/lib/db/capture-status-queries');
    const rows = await listCoursesWithStatus();
    const gc = rows.find((r) => r.code === 'GC 1010')!;
    expect(gc.category).toBe('gc_core');
    expect(gc.buildsToCareer).toBe(true);
    expect(gc.catalogUrl).toBe('https://catalog.clemson.edu/gc1010');
    const stat = rows.find((r) => r.code === 'STAT 2220')!;
    expect(stat.buildsToCareer).toBe(false);
    expect(stat.catalogUrl).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/db/__tests__/capture-status-queries.test.ts`
Expected: FAIL — `category`/`buildsToCareer`/`catalogUrl` are `undefined` on the returned rows.

- [ ] **Step 3: Implement — extend the type and the return**

In `lib/db/capture-status-queries.ts`, add the import at the top (after line 3):

```ts
import type { CourseCategory } from '@/lib/db/course-category-seed';
```

Add three fields to the `CourseStatusRow` interface (after `level` at line 10):

```ts
  category: CourseCategory;
  buildsToCareer: boolean;
  catalogUrl: string | null;
```

In the returned object (the `courseRows.map` at lines 81-90), add after `level: c.level ?? null,`:

```ts
    category: c.category,
    buildsToCareer: c.buildsToCareer,
    catalogUrl: c.catalogUrl ?? null,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/db/__tests__/capture-status-queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/capture-status-queries.ts lib/db/__tests__/capture-status-queries.test.ts
git commit -m "feat(courses): surface category/builds_to_career/catalog_url on status rows"
```

---

### Task 5: Landing page — group by category, career-path icon, add-course link

**Files:**
- Create: `lib/courses/group-by-category.ts`
- Create: `lib/courses/__tests__/group-by-category.test.ts`
- Modify: `app/page.tsx` (whole file)

- [ ] **Step 1: Write the failing test for the grouping helper**

```ts
// lib/courses/__tests__/group-by-category.test.ts
import { describe, it, expect } from 'vitest';
import { groupByCategory } from '@/lib/courses/group-by-category';

const rows = [
  { code: 'STAT 2300', category: 'major_req' as const },
  { code: 'GC 1020', category: 'gc_core' as const },
  { code: 'GC 1010', category: 'gc_core' as const },
  { code: 'GC 3700', category: 'specialty' as const },
];

describe('groupByCategory', () => {
  it('returns categories in fixed display order, omitting empty ones', () => {
    const groups = groupByCategory(rows);
    expect(groups.map((g) => g.category)).toEqual(['gc_core', 'specialty', 'major_req']);
  });

  it('sorts rows within a category by code', () => {
    const core = groupByCategory(rows).find((g) => g.category === 'gc_core')!;
    expect(core.rows.map((r) => r.code)).toEqual(['GC 1010', 'GC 1020']);
  });

  it('omits "other" when empty and includes it when populated', () => {
    expect(groupByCategory(rows).some((g) => g.category === 'other')).toBe(false);
    const withOther = groupByCategory([...rows, { code: 'NEW 1000', category: 'other' as const }]);
    expect(withOther[withOther.length - 1].category).toBe('other');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/courses/__tests__/group-by-category.test.ts`
Expected: FAIL — cannot resolve `@/lib/courses/group-by-category`.

- [ ] **Step 3: Implement the helper**

```ts
// lib/courses/group-by-category.ts
import { CATEGORY_ORDER, type CourseCategory } from '@/lib/db/course-category-seed';

/**
 * Group rows by `category` in the fixed CATEGORY_ORDER, sorting each group's
 * rows by `code`. Empty categories are omitted (so "Other courses" is hidden
 * until a course lands there).
 */
export function groupByCategory<T extends { category: CourseCategory; code: string }>(
  rows: T[],
): Array<{ category: CourseCategory; rows: T[] }> {
  const byCat = new Map<CourseCategory, T[]>();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(r);
  }
  return CATEGORY_ORDER.filter((c) => (byCat.get(c)?.length ?? 0) > 0).map((category) => ({
    category,
    rows: byCat.get(category)!.slice().sort((a, b) => a.code.localeCompare(b.code)),
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/courses/__tests__/group-by-category.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewrite `app/page.tsx` to group by category**

Replace the entire contents of `app/page.tsx` with:

```tsx
import Link from 'next/link';
import { Target } from 'lucide-react';
import { listCoursesWithStatus, type CaptureStatus, type CourseStatusRow } from '@/lib/db/capture-status-queries';
import { groupByCategory } from '@/lib/courses/group-by-category';
import { CATEGORY_LABELS } from '@/lib/db/course-category-seed';

export const dynamic = 'force-dynamic';

/**
 * Public HTTP landing page. No slug, no Basic Auth.
 *
 * Courses are grouped by `category` (GC Core → Specialty → Major Req → Other).
 * Courses that build toward the career mapping carry a Target icon.
 *
 * Two link types per course:
 *   - View → /view/[code] (HTTP, read-only, public)
 *   - Edit → https://<funnel>/capture/[code]?slug=<PROTOTYPE_SLUG> (Basic Auth)
 *
 * "+ Add a course" links to the authenticated roster page on the funnel —
 * the public surface never hosts a write path.
 */
export default async function HomePage() {
  const slug = process.env.PROTOTYPE_SLUG ?? '';
  const funnelOrigin = process.env.TAILSCALE_FUNNEL_ORIGIN ?? '';

  const rows = await listCoursesWithStatus();
  const groups = groupByCategory(rows);

  const facultyHubHref = funnelOrigin && slug
    ? `${funnelOrigin}/courses?slug=${encodeURIComponent(slug)}`
    : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Clemson · Graphic Communications
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">
              Curriculum
            </h1>
          </div>
          {facultyHubHref && (
            <a
              href={facultyHubHref}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
              title="Faculty hub (requires login)"
            >
              Faculty hub →
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <p className="max-w-3xl text-sm text-muted-foreground">
            What every course in the Graphic Communications curriculum builds.
            Anyone can read profiles; faculty edit via the HTTPS hub. The{' '}
            <Target className="inline h-3.5 w-3.5 -translate-y-px text-muted-foreground" aria-hidden /> marks
            courses that build toward our career outcomes.
          </p>
          {facultyHubHref && (
            <a
              href={facultyHubHref}
              className="shrink-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
              title="Add a course (requires login)"
            >
              + Add a course
            </a>
          )}
        </div>

        <div className="space-y-10">
          {groups.map(({ category, rows: catRows }) => (
            <section key={category}>
              <h2 className="mb-3 font-mono-plex text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {CATEGORY_LABELS[category]}
              </h2>
              <ul className="divide-y border-y">
                {catRows.map((row) => {
                  const editHref = funnelOrigin && slug
                    ? `${funnelOrigin}/capture/${encodeURIComponent(row.code)}?slug=${encodeURIComponent(slug)}`
                    : null;
                  return (
                    <li
                      key={row.code}
                      className="grid grid-cols-[7rem_minmax(0,1fr)_auto_8rem_auto] items-baseline gap-x-4 py-3"
                    >
                      <Link
                        href={`/view/${encodeURIComponent(row.code)}`}
                        className="font-mono-plex text-sm text-foreground hover:text-muted-foreground"
                      >
                        {row.code}
                      </Link>
                      <Link
                        href={`/view/${encodeURIComponent(row.code)}`}
                        className="flex items-baseline gap-1.5 font-display text-base text-foreground hover:text-muted-foreground"
                      >
                        <span>{row.title ?? '—'}</span>
                        {row.buildsToCareer && (
                          <Target
                            className="h-3.5 w-3.5 shrink-0 translate-y-px text-emerald-600/70 dark:text-emerald-400/70"
                            aria-label="Builds toward career outcomes"
                          >
                            <title>Builds toward career outcomes</title>
                          </Target>
                        )}
                      </Link>
                      <StatusPill status={row.status} />
                      <span className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {row.lastCapturedAt
                          ? `${formatDate(row.lastCapturedAt)}${row.lastCapturedBy ? ` · ${row.lastCapturedBy}` : ''}`
                          : ''}
                      </span>
                      <span className="flex items-baseline gap-3 justify-end">
                        <Link
                          href={`/view/${encodeURIComponent(row.code)}`}
                          className="text-sm text-muted-foreground hover:text-foreground"
                        >
                          View →
                        </Link>
                        {editHref && (
                          <a
                            href={editHref}
                            className="text-sm text-muted-foreground hover:text-foreground"
                            title="Faculty edit (requires login)"
                          >
                            Edit ↗
                          </a>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

const STATUS_CONFIG: Record<CaptureStatus, { label: string; className: string }> = {
  captured:     { label: 'Captured',    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  reviewed:     { label: 'Reviewed',    className: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300' },
  'ai-drafted': { label: 'AI drafted',  className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  'in-audit':   { label: 'In audit',    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  'not-started':{ label: 'Not started', className: 'bg-stone-100 text-stone-600 dark:bg-stone-800/40 dark:text-stone-400' },
};

function StatusPill({ status }: { status: CaptureStatus }) {
  const { label, className } = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-body-sans text-[10px] uppercase tracking-[0.18em] font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
```

Note: `CourseStatusRow` is still imported for type use elsewhere; if the linter flags it as unused after the rewrite, drop it from the import. The `levelLabel` helper is intentionally removed (no longer grouping by level).

- [ ] **Step 6: Typecheck + lint the page**

Run: `pnpm tsc --noEmit` (or the project's typecheck script — check `package.json`)
Expected: no new errors in `app/page.tsx`.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx lib/courses/group-by-category.ts lib/courses/__tests__/group-by-category.test.ts
git commit -m "feat(landing): group courses by category + career-path icon + add-course link"
```

---

### Task 6: Gate career-coverage on `builds_to_career`

**Files:**
- Modify: `lib/db/program-coverage-queries.ts` (`listStalePairs` ~line 105, `getMatrixData` ~line 211)
- Modify: `lib/db/__tests__/program-coverage-queries.test.ts`

- [ ] **Step 1: Write the failing test (filter present in emitted SQL)**

Append to `lib/db/__tests__/program-coverage-queries.test.ts`. This captures the raw `sql` objects passed to `db.execute` and serializes them with `PgDialect`:

```ts
import { PgDialect } from 'drizzle-orm/pg-core';

describe('career-coverage queries gate on builds_to_career', () => {
  it('getMatrixData filters its snapshot query on builds_to_career', async () => {
    const executed: unknown[] = [];
    const mod = await import('@/lib/db/client');
    (mod.db.execute as unknown as ReturnType<typeof vi.fn>) = vi.fn((q: unknown) => {
      executed.push(q);
      return Promise.resolve({ rows: [] });
    });
    // select() chains used elsewhere in getMatrixData return [].
    (mod.db.select as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => ({ from: () => [] }));

    const { getMatrixData } = await import('@/lib/db/program-coverage-queries');
    await getMatrixData();

    const dialect = new PgDialect();
    const texts = executed.map((q) => dialect.sqlToQuery(q as never).sql);
    expect(texts.some((t) => t.includes('builds_to_career'))).toBe(true);
  });

  it('listStalePairs filters its latest-snapshot query on builds_to_career', async () => {
    const executed: unknown[] = [];
    const mod = await import('@/lib/db/client');
    (mod.db.execute as unknown as ReturnType<typeof vi.fn>) = vi.fn((q: unknown) => {
      executed.push(q);
      return Promise.resolve({ rows: [] });
    });
    (mod.db.select as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => ({ from: () => [] }));

    const { listStalePairs } = await import('@/lib/db/program-coverage-queries');
    await listStalePairs();

    const dialect = new PgDialect();
    const texts = executed.map((q) => dialect.sqlToQuery(q as never).sql);
    expect(texts.some((t) => t.includes('builds_to_career'))).toBe(true);
  });
});
```

Note: the existing mock at the top of the file defines `db.execute` / `db.select`; reassigning them per-test as above is fine. If the existing `vi.mock('@/lib/db/schema', …)` lacks `courses`, add `courses: {}` to it so the import resolves.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/db/__tests__/program-coverage-queries.test.ts`
Expected: FAIL — emitted SQL does not yet contain `builds_to_career`.

- [ ] **Step 3: Add the filter to `getMatrixData`**

In `lib/db/program-coverage-queries.ts`, the `latestSnapshotsRaw` query (around line 211) currently reads:

```sql
    FROM ${courseCaptureSnapshots} s
    JOIN courses c ON c.code = s.course_code
    WHERE s.retired_at IS NULL
```

Change the WHERE to also require the flag:

```sql
    FROM ${courseCaptureSnapshots} s
    JOIN courses c ON c.code = s.course_code
    WHERE s.retired_at IS NULL AND c.builds_to_career = true
```

- [ ] **Step 4: Add the filter to `listStalePairs`**

In the same file, the `latestSnapshots` query (around line 105) currently reads:

```sql
    SELECT DISTINCT ON (course_code)
      id, course_code, created_at
    FROM ${courseCaptureSnapshots}
    WHERE retired_at IS NULL
    ORDER BY course_code, created_at DESC
```

Add the join + filter (qualify columns to avoid ambiguity):

```sql
    SELECT DISTINCT ON (s.course_code)
      s.id, s.course_code, s.created_at
    FROM ${courseCaptureSnapshots} s
    JOIN courses c ON c.code = s.course_code
    WHERE s.retired_at IS NULL AND c.builds_to_career = true
    ORDER BY s.course_code, s.created_at DESC
```

The destructured rows still expose `course_code` / `id` — the alias keeps the result shape identical (`as Array<{ id: string; course_code: string }>`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run lib/db/__tests__/program-coverage-queries.test.ts`
Expected: PASS (including the pre-existing `invalidateCoverageForSubCompetency` tests).

- [ ] **Step 6: Commit**

```bash
git add lib/db/program-coverage-queries.ts lib/db/__tests__/program-coverage-queries.test.ts
git commit -m "feat(program): gate coverage matrix + scoring on builds_to_career"
```

---

### Task 7: Catalog URL on the add-course path

**Files:**
- Create: `lib/http/is-http-url.ts`
- Create: `lib/http/__tests__/is-http-url.test.ts`
- Modify: `lib/db/courses-queries.ts:303-378` (`NewCourseInput`, `bulkCreateCourses`, `createCourse`)
- Modify: `app/api/admin/courses/roster/route.ts:74-84` (`mode:'one'`)
- Modify: `app/courses/CourseRosterControls.tsx` (add form field + submit)

- [ ] **Step 1: Write the failing URL-validator test**

```ts
// lib/http/__tests__/is-http-url.test.ts
import { describe, it, expect } from 'vitest';
import { isHttpUrl } from '@/lib/http/is-http-url';

describe('isHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpUrl('https://catalog.clemson.edu/x')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
  });
  it('rejects non-http schemes and garbage', () => {
    expect(isHttpUrl('ftp://x')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/http/__tests__/is-http-url.test.ts`
Expected: FAIL — cannot resolve `@/lib/http/is-http-url`.

- [ ] **Step 3: Implement the validator**

```ts
// lib/http/is-http-url.ts
/** True iff `s` parses as an absolute http(s) URL. */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/http/__tests__/is-http-url.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `catalogUrl` to `NewCourseInput` and the two insert functions**

In `lib/db/courses-queries.ts`, extend `NewCourseInput` (line 303):

```ts
export interface NewCourseInput {
  code: string;
  title: string;
  level?: number;
  track?: string;
  prerequisites?: string;
  catalogUrl?: string | null;
}
```

In `bulkCreateCourses`, in the `.values(...)` map (around line 346), add:

```ts
        catalogUrl: i.catalogUrl?.trim() || null,
```

In `createCourse`, in `.values({...})` (around line 370), add:

```ts
      catalogUrl: input.catalogUrl?.trim() || null,
```

- [ ] **Step 6: Write the failing roster-route test for catalogUrl**

Add to `lib/db/__tests__/courses-queries.test.ts` (or create a route test). Test the validation indirectly by asserting `createCourse` receives the trimmed URL — and that the route rejects a bad URL. Add to `lib/db/__tests__/courses-queries.test.ts`:

```ts
import { describe as describe2, it as it2, expect as expect2, vi as vi2, beforeEach as beforeEach2 } from 'vitest';
// NOTE: if the file already imports these, reuse them instead of aliasing.

// (Within the existing mocked-db describe block) — assert catalogUrl flows into the insert values.
```

Because the existing `courses-queries.test.ts` already mocks `db`, follow its established pattern: capture the `.values()` argument and assert `catalogUrl` is present. If that file's mock does not capture `values`, add a spy. Keep this test minimal — one assertion that `createCourse({code,title,catalogUrl})` calls insert with `catalogUrl` set.

- [ ] **Step 7: Validate `catalogUrl` in the roster route (`mode:'one'`)**

In `app/api/admin/courses/roster/route.ts`, import the validator at the top:

```ts
import { isHttpUrl } from '@/lib/http/is-http-url';
```

In the `mode === 'one'` branch (lines 74-83), after reading `level`/`track`, add catalog parsing + validation and pass it through:

```ts
    const level = typeof body.level === 'number' ? body.level : undefined;
    const track = typeof body.track === 'string' ? body.track : undefined;
    const catalogUrlRaw = typeof body.catalogUrl === 'string' ? body.catalogUrl.trim() : '';
    if (catalogUrlRaw && !isHttpUrl(catalogUrlRaw)) {
      return NextResponse.json({ error: 'catalogUrl must be an http(s) URL' }, { status: 400 });
    }
    await createCourse({ code, title, level, track, catalogUrl: catalogUrlRaw || null });
    return NextResponse.json({ ok: true });
```

- [ ] **Step 8: Add the catalog-URL input to the add form**

In `app/courses/CourseRosterControls.tsx`:

Add state (after line 28):

```tsx
  const [addCatalogUrl, setAddCatalogUrl] = useState('');
```

In `submitOne` (after the `track` line ~54), include it in the body:

```tsx
      if (addCatalogUrl.trim()) body.catalogUrl = addCatalogUrl.trim();
```

In the success reset block (after `setAddTrack('')` ~67) and in the close-button reset (line 158), also reset `setAddCatalogUrl('')`.

Add the input inside the add-form `<div className="space-y-2">` (after the level/track row, before the closing `</div>` at line 195):

```tsx
            <input
              type="url"
              value={addCatalogUrl}
              onChange={(e) => { setAddCatalogUrl(e.target.value); setAddResult(null); }}
              placeholder="Clemson catalog URL (optional)"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-body-sans text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
            />
```

- [ ] **Step 9: Run tests + typecheck**

Run: `pnpm vitest run lib/http lib/db/__tests__/courses-queries.test.ts` then `pnpm tsc --noEmit`
Expected: PASS, no new type errors.

- [ ] **Step 10: Commit**

```bash
git add lib/http app/api/admin/courses/roster/route.ts lib/db/courses-queries.ts lib/db/__tests__/courses-queries.test.ts app/courses/CourseRosterControls.tsx
git commit -m "feat(courses): optional Clemson catalog URL on add-course"
```

---

### Task 8: `PATCH /api/admin/courses/[code]` + update query

**Files:**
- Modify: `lib/db/courses-queries.ts` (add `updateCourseClassification`)
- Create: `app/api/admin/courses/[code]/route.ts`
- Create: `app/api/admin/courses/__tests__/patch-course.test.ts`

- [ ] **Step 1: Write the failing update-query test**

Add to `lib/db/__tests__/courses-queries.test.ts`, following the file's existing mocked-`db` pattern. Assert `updateCourseClassification('GC 1010', { buildsToCareer: true })` issues an update and returns `true` when a row is returned, `false` otherwise. (Mirror how other update/insert functions are tested in that file; capture the `.set()` payload if the mock supports it.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run lib/db/__tests__/courses-queries.test.ts`
Expected: FAIL — `updateCourseClassification` is not exported.

- [ ] **Step 3: Implement `updateCourseClassification`**

Add to `lib/db/courses-queries.ts` (near `createCourse`). Ensure `eq` and `courses` are already imported in this file (they are — used by `courseExists`). Add the type import at top if needed:

```ts
import type { CourseCategory } from '@/lib/db/course-category-seed';
```

```ts
export interface CourseClassificationPatch {
  category?: CourseCategory;
  buildsToCareer?: boolean;
  catalogUrl?: string | null;
}

/**
 * Update a course's classification fields. Each field is independently
 * optional; only provided keys are written. Returns true if the course exists.
 */
export async function updateCourseClassification(
  code: string,
  patch: CourseClassificationPatch,
): Promise<boolean> {
  const set: Record<string, unknown> = {};
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.buildsToCareer !== undefined) set.buildsToCareer = patch.buildsToCareer;
  if (patch.catalogUrl !== undefined) set.catalogUrl = patch.catalogUrl;
  if (Object.keys(set).length === 0) return courseExists(code);

  const updated = await db
    .update(courses)
    .set(set)
    .where(eq(courses.code, code))
    .returning({ code: courses.code });
  return updated.length > 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run lib/db/__tests__/courses-queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

```ts
// app/api/admin/courses/__tests__/patch-course.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: vi.fn() }));
vi.mock('@/lib/db/courses-queries', () => ({ updateCourseClassification: vi.fn() }));

import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { updateCourseClassification } from '@/lib/db/courses-queries';
import { PATCH } from '@/app/api/admin/courses/[code]/route';

const ctx = (code: string) => ({ params: Promise.resolve({ code }) });

function req(body: unknown) {
  return new Request('http://x/api/admin/courses/GC%201010?slug=s', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('PATCH /api/admin/courses/[code]', () => {
  it('401 when auth fails', async () => {
    (checkAdminAuth as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const res = await PATCH(req({ buildsToCareer: true }), ctx('GC 1010'));
    expect(res.status).toBe(401);
  });

  it('400 on invalid category', async () => {
    (checkAdminAuth as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const res = await PATCH(req({ category: 'bogus' }), ctx('GC 1010'));
    expect(res.status).toBe(400);
  });

  it('400 on non-http catalogUrl', async () => {
    (checkAdminAuth as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const res = await PATCH(req({ catalogUrl: 'javascript:1' }), ctx('GC 1010'));
    expect(res.status).toBe(400);
  });

  it('404 when the course does not exist', async () => {
    (checkAdminAuth as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (updateCourseClassification as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await PATCH(req({ buildsToCareer: true }), ctx('NOPE 9999'));
    expect(res.status).toBe(404);
  });

  it('200 + ok on a valid update', async () => {
    (checkAdminAuth as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (updateCourseClassification as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const res = await PATCH(req({ category: 'gc_core', buildsToCareer: true, catalogUrl: null }), ctx('GC 1010'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateCourseClassification).toHaveBeenCalledWith('GC 1010', { category: 'gc_core', buildsToCareer: true, catalogUrl: null });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm vitest run app/api/admin/courses/__tests__/patch-course.test.ts`
Expected: FAIL — route module does not exist.

- [ ] **Step 7: Implement the route**

```ts
// app/api/admin/courses/[code]/route.ts
import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { updateCourseClassification, type CourseClassificationPatch } from '@/lib/db/courses-queries';
import { isHttpUrl } from '@/lib/http/is-http-url';

const CATEGORIES = ['gc_core', 'specialty', 'major_req', 'other'] as const;

// PATCH /api/admin/courses/[code]?slug=<slug>
// Body (each key optional): { category?, buildsToCareer?, catalogUrl? }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!checkAdminAuth(req, { slug })) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const { code } = await params;
  const decodedCode = decodeURIComponent(code);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: CourseClassificationPatch = {};

  if ('category' in body) {
    if (typeof body.category !== 'string' || !(CATEGORIES as readonly string[]).includes(body.category)) {
      return NextResponse.json({ error: 'category must be one of ' + CATEGORIES.join(', ') }, { status: 400 });
    }
    patch.category = body.category as CourseClassificationPatch['category'];
  }
  if ('buildsToCareer' in body) {
    if (typeof body.buildsToCareer !== 'boolean') {
      return NextResponse.json({ error: 'buildsToCareer must be a boolean' }, { status: 400 });
    }
    patch.buildsToCareer = body.buildsToCareer;
  }
  if ('catalogUrl' in body) {
    if (body.catalogUrl === null) {
      patch.catalogUrl = null;
    } else if (typeof body.catalogUrl === 'string' && isHttpUrl(body.catalogUrl.trim())) {
      patch.catalogUrl = body.catalogUrl.trim();
    } else {
      return NextResponse.json({ error: 'catalogUrl must be an http(s) URL or null' }, { status: 400 });
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no updatable fields provided' }, { status: 400 });
  }

  const found = await updateCourseClassification(decodedCode, patch);
  if (!found) return NextResponse.json({ error: 'course not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm vitest run app/api/admin/courses/__tests__/patch-course.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add lib/db/courses-queries.ts lib/db/__tests__/courses-queries.test.ts app/api/admin/courses/[code]/route.ts app/api/admin/courses/__tests__/patch-course.test.ts
git commit -m "feat(courses): PATCH endpoint to edit category/builds_to_career/catalog_url"
```

---

### Task 9: Per-course classification editor on `/courses`

**Files:**
- Create: `app/courses/CourseClassControls.tsx`
- Modify: `app/courses/CoursesIndex.tsx` (`CourseRow`, ~lines 135-211)

- [ ] **Step 1: Implement the editor component**

```tsx
// app/courses/CourseClassControls.tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CATEGORY_ORDER, CATEGORY_LABELS, type CourseCategory } from '@/lib/db/course-category-seed';

interface Props {
  code: string;
  slug: string;
  category: CourseCategory;
  buildsToCareer: boolean;
  catalogUrl: string | null;
}

export function CourseClassControls({ code, slug, category, buildsToCareer, catalogUrl }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<CourseCategory>(category);
  const [builds, setBuilds] = useState(buildsToCareer);
  const [url, setUrl] = useState(catalogUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/courses/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: cat, buildsToCareer: builds, catalogUrl: url.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError((json as { error?: string }).error ?? 'Update failed');
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
        title="Edit category / career mapping / catalog URL"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="absolute right-2 top-10 z-10 w-72 rounded-lg border border-border bg-card p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{code}</span>
        <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <label className="mb-2 block">
        <span className="mb-1 block font-body-sans text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">Category</span>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value as CourseCategory)}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-[12px]"
        >
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </label>
      <label className="mb-2 flex items-center gap-2">
        <input type="checkbox" checked={builds} onChange={(e) => setBuilds(e.target.checked)} />
        <span className="font-body-sans text-[12px]">Builds toward career outcomes</span>
      </label>
      <label className="mb-2 block">
        <span className="mb-1 block font-body-sans text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">Catalog URL</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://catalog.clemson.edu/…"
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-[12px]"
        />
      </label>
      {error && <p className="mb-2 font-body-sans text-[11px] text-destructive">{error}</p>}
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-md bg-foreground px-3 py-1 font-body-sans text-[11px] uppercase tracking-[0.14em] text-background disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the editor into `CourseRow`**

In `app/courses/CoursesIndex.tsx`, import the component near the top (after line 6):

```tsx
import { CourseClassControls } from './CourseClassControls';
```

The `CourseRow` outer wrapper `<div>` (line 153) needs `relative` so the popover anchors to it. Change its className to start with `group relative `:

```tsx
    <div
      className="group relative flex items-center gap-4 rounded-md transition-colors hover:bg-muted/40 animate-in fade-in slide-in-from-bottom-1"
```

Add the editor just before the closing `</div>` of `CourseRow` (after the "💬 Ask" Link, before line 209's `</div>`):

```tsx
      <CourseClassControls
        code={row.code}
        slug={slug}
        category={row.category}
        buildsToCareer={row.buildsToCareer}
        catalogUrl={row.catalogUrl}
      />
```

`row` is a `CourseStatusRow`, which now (Task 4) carries `category`, `buildsToCareer`, and `catalogUrl` — no prop-threading changes needed.

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors. (`CourseClassControls` consumes the fields added to `CourseStatusRow` in Task 4.)

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run the dev server if not running, open `/courses?slug=<PROTOTYPE_SLUG>`, click **Edit** on a row, change the flag, Save, and confirm the row refreshes. (No automated test — this is thin UI over the Task-8 endpoint, which is covered.)

- [ ] **Step 5: Commit**

```bash
git add app/courses/CourseClassControls.tsx app/courses/CoursesIndex.tsx
git commit -m "feat(courses): per-course category/flag/catalog editor on roster"
```

---

### Task 10: Full suite + STATE.md reconciliation

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all green. If any pre-existing test selects from `courses` and breaks on the new columns (unlikely — selects are explicit or full-object), fix the fixture to include `category`/`buildsToCareer`/`catalogUrl`.

- [ ] **Step 2: Typecheck the whole project**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Update STATE.md**

Edit `docs/STATE.md`:
- **Schema:** note the `courses` table gained `category` (enum `course_category`), `builds_to_career`, `catalog_url`; migration `0033`.
- **Routes:** add `PATCH /api/admin/courses/[code]`.
- **What's live:** the `/program` coverage matrix is now scoped to `builds_to_career = true` courses (27: 16 GC Core + 11 high-enrollment Major Req); landing page (`/`) regrouped by category with a career-path icon; add-course form gained an optional catalog URL.
- **Deferred / debt:** (a) track modeling — alternate tracks / swapping courses into the career-building set; (b) per-student elective-contribution view; (c) coverage cells for `builds_to_career=false` courses are **retained but hidden**, not deleted; (d) the migration journal carries cosmetic hash drift on 0003/0022/0023 (below the apply watermark — intentionally not repaired).

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): course categories + builds_to_career flag + catalog URL shipped"
```

---

## Self-Review

**1. Spec coverage:**
- `category` enum + column → Tasks 1, 2. ✅
- `builds_to_career` column → Task 2; backfill (27) → Task 3; matrix/scoring gate → Task 6. ✅
- `catalog_url` column → Task 2; add-course → Task 7; editor → Tasks 8-9. ✅
- 46-course backfill 16/14/16/0, 27 true → Tasks 1 + 3 (seed + migration + anti-drift test + psql verify). ✅
- Landing reorg by category + fixed order + empty-Other hidden + career icon + add-course funnel link → Task 5. ✅
- Add-course routes through funnel, defaults to other/false → Task 5 (link) + DB defaults (Task 2). ✅
- Career-path icon on included courses → Task 5. ✅
- PATCH editing (category/flag/catalog, independently settable) → Tasks 8-9. ✅
- Retained-but-hidden cells; journal-drift note → Task 10 STATE.md. ✅

**2. Placeholder scan:** No "TBD/handle appropriately/etc." Task 6/7 reference the *existing* mock pattern in named test files with concrete assertions; Task 7 Step 6 and Task 8 Step 1 defer to the established `courses-queries.test.ts` mock shape rather than reprinting it — acceptable since the assertion is named and singular. Everything else has full code.

**3. Type consistency:**
- `CourseCategory` defined in Task 1, imported by Tasks 2 (enum values match), 4, 8, 9. Values `gc_core|specialty|major_req|other` consistent everywhere (enum, seed, CATEGORIES array in route, select options). ✅
- `buildsToCareer` (camelCase TS) ↔ `builds_to_career` (snake SQL column) consistent. ✅
- `CourseStatusRow` gains `category`/`buildsToCareer`/`catalogUrl` (Task 4); consumed by Task 5 (landing) and Task 9 (editor). ✅
- `updateCourseClassification(code, patch)` signature defined Task 8 Step 3, called identically in route (Step 7) and asserted in test (Step 5). ✅
- `CourseClassificationPatch` exported from courses-queries, imported by the route. ✅
