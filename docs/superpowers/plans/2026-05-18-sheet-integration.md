# Sheet Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the paste-syllabus textareas with a Combobox sourced from a `courses` table that mirrors the shared Google Sheet. Admin Resync button snapshots the sheet to Postgres. Faculty can edit the structured fields before analysis; edited fields show an "Edited" badge with a "Reset" link.

**Architecture:** Snapshot-based. Sheet ID lives in env. `POST /api/admin/resync-courses` reads the `Index` tab for course codes, fetches each `GC XXXX` tab via `gviz/tq?out=csv&sheet=GC%20XXXX`, parses label/value rows, upserts into a new `courses` table. The form fetches `/api/courses` for the dropdown and `/api/courses/[code]` on selection. On submit, the client formats the (possibly-edited) structured fields into the labeled-markdown shape the existing `/api/analyze` already accepts — the analyze endpoint and prompts do not change.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle ORM + Neon Postgres, Vitest, @base-ui/react primitives, Tailwind v4, OpenAI gpt-5.4.

---

### Task 1: Add `courses` table and Drizzle migration

**Files:**
- Modify: `lib/db/schema.ts`
- Generate: `drizzle/0004_<name>.sql` via `npm run db:generate`
- Test: `lib/db/__tests__/schema.test.ts` (create)

- [ ] **Step 1: Append the `courses` table definition to `lib/db/schema.ts`**

After the existing tables, add:

```typescript
export const courses = pgTable('courses', {
  code: text('code').primaryKey(),                                // 'GC 3460', 'GC 4900ap'
  title: text('title').notNull(),
  level: integer('level').notNull(),                              // 1-4
  track: text('track').notNull(),
  description: text('description').notNull().default(''),
  prerequisites: text('prerequisites').notNull().default(''),
  syllabusUrl: text('syllabus_url'),                              // nullable
  learningObjectives: jsonb('learning_objectives').$type<string[]>().notNull().default([]),
  majorProjects: jsonb('major_projects').$type<string[]>().notNull().default([]),
  skillsRequired: jsonb('skills_required').$type<string[]>().notNull().default([]),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sheetSyncState = pgTable('sheet_sync_state', {
  // Singleton row keyed by 'courses' — tracks the most recent successful resync.
  // Lets the admin UI render "Last synced: 3h ago" without scanning courses.
  key: text('key').primaryKey(),                                  // always 'courses' for now
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull(),
  lastSyncedCount: integer('last_synced_count').notNull(),
  lastErrors: jsonb('last_errors').$type<string[]>().notNull().default([]),
});
```

- [ ] **Step 2: Generate migration**

Run: `npm run db:generate`

Expected: a new `drizzle/0004_*.sql` file is created with `CREATE TABLE courses (...)` and `CREATE TABLE sheet_sync_state (...)`.

- [ ] **Step 3: Write schema smoke test**

Create `lib/db/__tests__/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { courses, sheetSyncState } from '@/lib/db/schema';

describe('courses schema', () => {
  it('has the expected columns', () => {
    const cols = Object.keys(courses);
    for (const c of ['code', 'title', 'level', 'track', 'description', 'prerequisites',
                     'syllabusUrl', 'learningObjectives', 'majorProjects',
                     'skillsRequired', 'lastSyncedAt']) {
      expect(cols).toContain(c);
    }
  });

  it('sheet_sync_state has the expected columns', () => {
    const cols = Object.keys(sheetSyncState);
    for (const c of ['key', 'lastSyncedAt', 'lastSyncedCount', 'lastErrors']) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 4: Run tests + migrate**

Run: `npm test -- lib/db/__tests__/schema.test.ts`
Expected: PASS.

Run: `npm run db:migrate`
Expected: migration applies cleanly.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/0004_*.sql lib/db/__tests__/schema.test.ts
git commit -m "feat: add courses + sheet_sync_state tables for sheet integration"
```

---

### Task 2: Sheet CSV parser

**Files:**
- Create: `lib/sheets/parseCourseTab.ts`
- Create: `lib/sheets/__tests__/parseCourseTab.test.ts`

The course tab format (verified against the live sheet):
- Row 1: `Course Code`, `<code>` OR a merged `Course Code Title`, `<code> <title>` (depending on how Apps Script wrote it)
- Subsequent rows are `<label>`, `<value>` pairs.
- Section headers (`Learning Objectives`, `Major Projects`, `Skills/Competencies Required`) appear with empty column B, followed by rows with empty column A and the bullet content in column B.

- [ ] **Step 1: Write parser tests first**

Create `lib/sheets/__tests__/parseCourseTab.test.ts` with sample CSV strings covering:

```typescript
import { describe, it, expect } from 'vitest';
import { parseCourseTab } from '@/lib/sheets/parseCourseTab';

const TWO_ROW_HEADER = `"Course Code","GC 3460"
"Title","Ink and Substrates"
"Level","3"
"Track","Core"
"Syllabus URL","https://example.com/gc-3460"
"Prerequisites","GC 2070"
"Description","Substrates and inks for graphic arts."
"Learning Objectives",""
"","Identify substrate categories."
"","Specify inks for a given substrate."
"Major Projects",""
"","Final project: substrate-ink compatibility matrix."
"Skills/Competencies Required",""
"","Comfort with chemistry fundamentals."
"","Basic measurement and lab safety."
`;

describe('parseCourseTab', () => {
  it('parses a standard two-row-header tab', () => {
    const r = parseCourseTab(TWO_ROW_HEADER);
    expect(r.code).toBe('GC 3460');
    expect(r.title).toBe('Ink and Substrates');
    expect(r.level).toBe(3);
    expect(r.track).toBe('Core');
    expect(r.syllabusUrl).toBe('https://example.com/gc-3460');
    expect(r.prerequisites).toBe('GC 2070');
    expect(r.description).toContain('Substrates');
    expect(r.learningObjectives).toEqual([
      'Identify substrate categories.',
      'Specify inks for a given substrate.',
    ]);
    expect(r.majorProjects).toEqual([
      'Final project: substrate-ink compatibility matrix.',
    ]);
    expect(r.skillsRequired).toEqual([
      'Comfort with chemistry fundamentals.',
      'Basic measurement and lab safety.',
    ]);
  });

  it('handles gviz-collapsed first row "Course Code Title"', () => {
    const collapsed = `"Course Code Title","GC 4900ap Special Topics: Analog Photography"
"Level","4"
"Track","Special Topics"
"Syllabus URL",""
"Prerequisites",""
"Description","x"
"Learning Objectives",""
"","obj 1"
"Major Projects",""
"Skills/Competencies Required",""
`;
    const r = parseCourseTab(collapsed);
    expect(r.code).toBe('GC 4900ap');
    expect(r.title).toBe('Special Topics: Analog Photography');
    expect(r.majorProjects).toEqual([]);
    expect(r.syllabusUrl).toBeNull();
  });

  it('treats unrecognized rows as no-ops, not errors', () => {
    const r = parseCourseTab(`"Course Code","GC 1010"
"Title","Orientation"
"Level","1"
"Track","Core"
"Description","x"
"Some Future Field","ignore me"
`);
    expect(r.code).toBe('GC 1010');
    expect(r.learningObjectives).toEqual([]);
  });

  it('throws if code or title is missing', () => {
    expect(() => parseCourseTab(`"Level","1"\n"Title","x"\n`)).toThrow(/code/i);
    expect(() => parseCourseTab(`"Course Code","GC 1010"\n"Level","1"\n`)).toThrow(/title/i);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- lib/sheets/__tests__/parseCourseTab.test.ts`
Expected: 4 failing (parser doesn't exist).

- [ ] **Step 3: Implement parser**

Create `lib/sheets/parseCourseTab.ts`:

```typescript
export interface ParsedCourse {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  prerequisites: string;
  syllabusUrl: string | null;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

const SECTION_HEADERS: Record<string, keyof Pick<ParsedCourse, 'learningObjectives' | 'majorProjects' | 'skillsRequired'>> = {
  'learning objectives': 'learningObjectives',
  'major projects': 'majorProjects',
  'skills/competencies required': 'skillsRequired',
  'skills required': 'skillsRequired',
};

const SCALAR_FIELDS: Record<string, 'title' | 'level' | 'track' | 'description' | 'prerequisites' | 'syllabusUrl'> = {
  'title': 'title',
  'level': 'level',
  'track': 'track',
  'description': 'description',
  'prerequisites': 'prerequisites',
  'syllabus url': 'syllabusUrl',
};

// Parses one CSV line into [colA, colB]. Handles quoted values with embedded quotes ("").
function parseCsvLine(line: string): [string, string] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  cells.push(cur);
  return [cells[0] ?? '', cells[1] ?? ''];
}

function splitCollapsedCodeTitle(value: string): { code: string; title: string } {
  // "GC 4900ap Special Topics: Analog Photography" → code: "GC 4900ap", title: rest
  const m = value.match(/^(GC\s+\d{4}[a-z]{0,2})\s+(.*)$/i);
  if (!m) return { code: value.trim(), title: '' };
  return { code: m[1]!.trim(), title: m[2]!.trim() };
}

export function parseCourseTab(csv: string): ParsedCourse {
  const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
  const out: ParsedCourse = {
    code: '', title: '', level: 0, track: '',
    description: '', prerequisites: '', syllabusUrl: null,
    learningObjectives: [], majorProjects: [], skillsRequired: [],
  };

  let currentSection: keyof Pick<ParsedCourse, 'learningObjectives' | 'majorProjects' | 'skillsRequired'> | null = null;

  for (const line of lines) {
    const [rawLabel, rawValue] = parseCsvLine(line);
    const label = rawLabel.trim();
    const value = rawValue.trim();
    const labelLower = label.toLowerCase();

    // Section continuation: empty label, value present.
    if (label === '' && value !== '' && currentSection) {
      out[currentSection].push(value);
      continue;
    }

    // Section header: known section name with empty value.
    if (labelLower in SECTION_HEADERS && value === '') {
      currentSection = SECTION_HEADERS[labelLower]!;
      continue;
    }

    // Scalar fields exit any active section.
    currentSection = null;

    if (labelLower === 'course code') {
      out.code = value;
      continue;
    }
    if (labelLower === 'course code title') {
      // Apps-Script-collapsed first row: split the combined value.
      const split = splitCollapsedCodeTitle(value);
      out.code = split.code;
      if (!out.title) out.title = split.title;
      continue;
    }
    if (labelLower in SCALAR_FIELDS) {
      const field = SCALAR_FIELDS[labelLower]!;
      if (field === 'level') {
        const n = parseInt(value, 10);
        if (!Number.isNaN(n)) out.level = n;
      } else if (field === 'syllabusUrl') {
        out.syllabusUrl = value || null;
      } else {
        out[field] = value;
      }
      continue;
    }
    // Unknown labels: ignore (forward-compatible with new sheet fields).
  }

  if (!out.code) throw new Error('parseCourseTab: missing course code');
  if (!out.title) throw new Error('parseCourseTab: missing course title');
  return out;
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm test -- lib/sheets/__tests__/parseCourseTab.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sheets/parseCourseTab.ts lib/sheets/__tests__/parseCourseTab.test.ts
git commit -m "feat: CSV parser for Google Sheet course tabs"
```

---

### Task 3: Sheet fetcher

**Files:**
- Create: `lib/sheets/fetchSheet.ts`
- Create: `lib/sheets/__tests__/fetchSheet.test.ts`

- [ ] **Step 1: Write tests using a mocked `fetch`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchIndexCourseCodes, fetchCourseTabCsv, gvizUrl } from '@/lib/sheets/fetchSheet';

describe('fetchSheet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('gvizUrl encodes the tab name correctly', () => {
    expect(gvizUrl('SHEET_ID', 'GC 4900ap')).toBe(
      'https://docs.google.com/spreadsheets/d/SHEET_ID/gviz/tq?tqx=out:csv&sheet=GC%204900ap'
    );
  });

  it('fetchIndexCourseCodes pulls codes from column A', async () => {
    const csv = `"Code","Title"\n"GC 1010","Orientation"\n"GC 4900ap","Analog Photography"\n`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(csv, { status: 200 })));
    const codes = await fetchIndexCourseCodes('SHEET_ID');
    expect(codes).toEqual(['GC 1010', 'GC 4900ap']);
  });

  it('fetchIndexCourseCodes ignores non-course rows (header, blanks, summary tabs)', async () => {
    const csv = `"Code","Title"\n"GC 1010","x"\n"","empty"\n"Summary","ignore"\n"GC 4900ap","y"\n`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(csv, { status: 200 })));
    const codes = await fetchIndexCourseCodes('SHEET_ID');
    expect(codes).toEqual(['GC 1010', 'GC 4900ap']);
  });

  it('fetchCourseTabCsv returns raw CSV text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('raw csv', { status: 200 })));
    const text = await fetchCourseTabCsv('SHEET_ID', 'GC 3460');
    expect(text).toBe('raw csv');
  });

  it('fetchCourseTabCsv throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(fetchCourseTabCsv('SHEET_ID', 'GC 0000')).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- lib/sheets/__tests__/fetchSheet.test.ts`
Expected: 5 failing.

- [ ] **Step 3: Implement fetcher**

```typescript
// lib/sheets/fetchSheet.ts
export function gvizUrl(sheetId: string, tabName: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
}

const COURSE_CODE_RE = /^GC\s+\d{4}[a-z]{0,2}$/i;

export async function fetchIndexCourseCodes(sheetId: string, indexTabName = 'Index'): Promise<string[]> {
  const url = gvizUrl(sheetId, indexTabName);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchIndexCourseCodes: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const codes: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const first = line.match(/^"([^"]*)"/)?.[1]?.trim();
    if (first && COURSE_CODE_RE.test(first)) codes.push(first);
  }
  return codes;
}

export async function fetchCourseTabCsv(sheetId: string, courseCode: string): Promise<string> {
  const url = gvizUrl(sheetId, courseCode);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchCourseTabCsv ${courseCode}: ${res.status} ${res.statusText}`);
  return res.text();
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm test -- lib/sheets/__tests__/fetchSheet.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sheets/fetchSheet.ts lib/sheets/__tests__/fetchSheet.test.ts
git commit -m "feat: Google Sheets gviz CSV fetcher"
```

---

### Task 4: Courses DB queries

**Files:**
- Create: `lib/db/courses-queries.ts`
- Create: `lib/db/__tests__/courses-queries.test.ts` (mock the db client)

- [ ] **Step 1: Implement queries**

```typescript
// lib/db/courses-queries.ts
import { db } from './client';
import { courses, sheetSyncState } from './schema';
import type { ParsedCourse } from '@/lib/sheets/parseCourseTab';
import { eq, asc, sql } from 'drizzle-orm';

export interface CourseListItem {
  code: string;
  title: string;
  level: number;
  track: string;
}

export async function listCourses(): Promise<CourseListItem[]> {
  const rows = await db
    .select({ code: courses.code, title: courses.title, level: courses.level, track: courses.track })
    .from(courses)
    .orderBy(asc(courses.code));
  return rows;
}

export async function getCourseByCode(code: string) {
  const rows = await db.select().from(courses).where(eq(courses.code, code)).limit(1);
  return rows[0] ?? null;
}

export async function upsertCourses(parsed: ParsedCourse[]): Promise<number> {
  if (parsed.length === 0) return 0;
  const rows = parsed.map(p => ({
    code: p.code,
    title: p.title,
    level: p.level,
    track: p.track,
    description: p.description,
    prerequisites: p.prerequisites,
    syllabusUrl: p.syllabusUrl,
    learningObjectives: p.learningObjectives,
    majorProjects: p.majorProjects,
    skillsRequired: p.skillsRequired,
    lastSyncedAt: new Date(),
  }));
  // Upsert by code primary key.
  await db.insert(courses).values(rows).onConflictDoUpdate({
    target: courses.code,
    set: {
      title: sql`excluded.title`,
      level: sql`excluded.level`,
      track: sql`excluded.track`,
      description: sql`excluded.description`,
      prerequisites: sql`excluded.prerequisites`,
      syllabusUrl: sql`excluded.syllabus_url`,
      learningObjectives: sql`excluded.learning_objectives`,
      majorProjects: sql`excluded.major_projects`,
      skillsRequired: sql`excluded.skills_required`,
      lastSyncedAt: sql`excluded.last_synced_at`,
    },
  });
  return rows.length;
}

export async function recordSyncResult(count: number, errors: string[]): Promise<void> {
  await db.insert(sheetSyncState).values({
    key: 'courses',
    lastSyncedAt: new Date(),
    lastSyncedCount: count,
    lastErrors: errors,
  }).onConflictDoUpdate({
    target: sheetSyncState.key,
    set: {
      lastSyncedAt: sql`excluded.last_synced_at`,
      lastSyncedCount: sql`excluded.last_synced_count`,
      lastErrors: sql`excluded.last_errors`,
    },
  });
}

export async function getSyncState() {
  const rows = await db.select().from(sheetSyncState).where(eq(sheetSyncState.key, 'courses')).limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 2: Smoke test (does not require live DB — only that the module imports and the SQL builds)**

Create `lib/db/__tests__/courses-queries.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }), orderBy: () => [] }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
  },
}));

import { listCourses, getCourseByCode, upsertCourses, recordSyncResult, getSyncState } from '@/lib/db/courses-queries';

describe('courses-queries module', () => {
  it('exports the expected functions', () => {
    expect(typeof listCourses).toBe('function');
    expect(typeof getCourseByCode).toBe('function');
    expect(typeof upsertCourses).toBe('function');
    expect(typeof recordSyncResult).toBe('function');
    expect(typeof getSyncState).toBe('function');
  });

  it('upsertCourses with empty array returns 0 without calling db', async () => {
    expect(await upsertCourses([])).toBe(0);
  });
});
```

Run: `npm test -- lib/db/__tests__/courses-queries.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/db/courses-queries.ts lib/db/__tests__/courses-queries.test.ts
git commit -m "feat: courses queries (list, get, upsert, sync state)"
```

---

### Task 5: Admin resync endpoint

**Files:**
- Create: `app/api/admin/resync-courses/route.ts`
- Create: `app/api/admin/resync-courses/__tests__/route.test.ts`

- [ ] **Step 1: Implement the endpoint**

```typescript
// app/api/admin/resync-courses/route.ts
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { fetchIndexCourseCodes, fetchCourseTabCsv } from '@/lib/sheets/fetchSheet';
import { parseCourseTab } from '@/lib/sheets/parseCourseTab';
import { upsertCourses, recordSyncResult } from '@/lib/db/courses-queries';
import type { ParsedCourse } from '@/lib/sheets/parseCourseTab';

export const maxDuration = 120; // 28 tabs × ~500ms each + parsing

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!sheetId) {
    return NextResponse.json({ error: 'GOOGLE_SHEET_ID not set' }, { status: 500 });
  }

  const errors: string[] = [];
  let codes: string[] = [];
  try {
    codes = await fetchIndexCourseCodes(sheetId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `index fetch failed: ${msg}` }, { status: 502 });
  }

  // Fetch + parse all course tabs in parallel.
  const results = await Promise.allSettled(
    codes.map(async (code): Promise<ParsedCourse> => {
      const csv = await fetchCourseTabCsv(sheetId, code);
      return parseCourseTab(csv);
    })
  );

  const parsed: ParsedCourse[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') parsed.push(r.value);
    else errors.push(`${codes[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  });

  const synced = await upsertCourses(parsed);
  await recordSyncResult(synced, errors);

  return NextResponse.json({
    synced,
    skipped: errors.length,
    errors,
    lastSyncedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Write integration test (mocks fetch + db)**

```typescript
// app/api/admin/resync-courses/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug-12345678' }));

const upsertMock = vi.fn(async (rows: unknown[]) => (rows as unknown[]).length);
const recordMock = vi.fn(async () => undefined);
vi.mock('@/lib/db/courses-queries', () => ({
  upsertCourses: (rows: unknown[]) => upsertMock(rows),
  recordSyncResult: (count: number, errors: string[]) => recordMock(count, errors),
}));

import { POST } from '@/app/api/admin/resync-courses/route';

function mockSheetFetches(indexCsv: string, tabResponses: Record<string, string>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('sheet=Index')) return new Response(indexCsv, { status: 200 });
    for (const [code, csv] of Object.entries(tabResponses)) {
      if (url.includes(`sheet=${encodeURIComponent(code)}`)) return new Response(csv, { status: 200 });
    }
    return new Response('', { status: 404 });
  }));
}

describe('POST /api/admin/resync-courses', () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'TEST_SHEET';
    process.env.PROTOTYPE_SLUG = 'valid-slug-12345678';
    upsertMock.mockClear();
    recordMock.mockClear();
  });

  it('rejects invalid slug', async () => {
    const req = new Request('http://x/api/admin/resync-courses', {
      method: 'POST',
      body: JSON.stringify({ slug: 'wrong' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 500 when GOOGLE_SHEET_ID is missing', async () => {
    delete process.env.GOOGLE_SHEET_ID;
    const req = new Request('http://x/api/admin/resync-courses', {
      method: 'POST',
      body: JSON.stringify({ slug: 'valid-slug-12345678' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('syncs the courses found in the index tab', async () => {
    mockSheetFetches(
      `"Code","Title"\n"GC 1010","Orientation"\n"GC 3460","Ink & Substrates"\n`,
      {
        'GC 1010': `"Course Code","GC 1010"\n"Title","Orientation"\n"Level","1"\n"Track","Core"\n"Description","x"\n`,
        'GC 3460': `"Course Code","GC 3460"\n"Title","Ink & Substrates"\n"Level","3"\n"Track","Core"\n"Description","x"\n`,
      }
    );
    const req = new Request('http://x/api/admin/resync-courses', {
      method: 'POST',
      body: JSON.stringify({ slug: 'valid-slug-12345678' }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.synced).toBe(2);
    expect(json.skipped).toBe(0);
    expect(upsertMock).toHaveBeenCalled();
    expect(recordMock).toHaveBeenCalledWith(2, []);
  });

  it('reports tab fetch errors without failing the whole sync', async () => {
    mockSheetFetches(
      `"Code","Title"\n"GC 1010","x"\n"GC 9999","missing"\n`,
      {
        'GC 1010': `"Course Code","GC 1010"\n"Title","x"\n"Level","1"\n"Track","Core"\n"Description","x"\n`,
        // GC 9999 deliberately missing → 404
      }
    );
    const req = new Request('http://x/api/admin/resync-courses', {
      method: 'POST',
      body: JSON.stringify({ slug: 'valid-slug-12345678' }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.synced).toBe(1);
    expect(json.skipped).toBe(1);
    expect(json.errors[0]).toContain('GC 9999');
  });
});
```

Run: `npm test -- app/api/admin/resync-courses/__tests__/route.test.ts`
Expected: 4 PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/resync-courses/
git commit -m "feat: POST /api/admin/resync-courses snapshots Google Sheet to courses table"
```

---

### Task 6: Public courses endpoints

**Files:**
- Create: `app/api/courses/route.ts` (list)
- Create: `app/api/courses/[code]/route.ts` (detail)
- Create: `app/api/courses/__tests__/route.test.ts`

- [ ] **Step 1: Implement list endpoint**

```typescript
// app/api/courses/route.ts
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { listCourses } from '@/lib/db/courses-queries';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  const list = await listCourses();
  return NextResponse.json(list);
}
```

- [ ] **Step 2: Implement detail endpoint**

```typescript
// app/api/courses/[code]/route.ts
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  const { code } = await ctx.params;
  const decoded = decodeURIComponent(code);
  const course = await getCourseByCode(decoded);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(course);
}
```

- [ ] **Step 3: Tests**

```typescript
// app/api/courses/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug-12345678' }));

const listMock = vi.fn();
const getMock = vi.fn();
vi.mock('@/lib/db/courses-queries', () => ({
  listCourses: () => listMock(),
  getCourseByCode: (c: string) => getMock(c),
}));

import { GET as listGET } from '@/app/api/courses/route';
import { GET as detailGET } from '@/app/api/courses/[code]/route';

describe('GET /api/courses', () => {
  beforeEach(() => { listMock.mockReset(); getMock.mockReset(); });

  it('lists courses for valid slug', async () => {
    listMock.mockResolvedValue([{ code: 'GC 1010', title: 'x', level: 1, track: 'Core' }]);
    const res = await listGET(new Request('http://x/api/courses?slug=valid-slug-12345678'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ code: 'GC 1010', title: 'x', level: 1, track: 'Core' }]);
  });

  it('returns 401 for missing slug', async () => {
    const res = await listGET(new Request('http://x/api/courses'));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/courses/[code]', () => {
  beforeEach(() => { listMock.mockReset(); getMock.mockReset(); });

  it('returns the course detail when found', async () => {
    getMock.mockResolvedValue({ code: 'GC 3460', title: 'Ink & Substrates' });
    const res = await detailGET(
      new Request('http://x/api/courses/GC%203460?slug=valid-slug-12345678'),
      { params: Promise.resolve({ code: 'GC%203460' }) }
    );
    expect(res.status).toBe(200);
    expect(getMock).toHaveBeenCalledWith('GC 3460');
  });

  it('returns 404 when not found', async () => {
    getMock.mockResolvedValue(null);
    const res = await detailGET(
      new Request('http://x/api/courses/GC%209999?slug=valid-slug-12345678'),
      { params: Promise.resolve({ code: 'GC%209999' }) }
    );
    expect(res.status).toBe(404);
  });
});
```

Run: `npm test -- app/api/courses`
Expected: 4 PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/courses/
git commit -m "feat: GET /api/courses list + detail endpoints"
```

---

### Task 7: Format structured course → labeled syllabus markdown

**Files:**
- Create: `lib/courses/formatCourseSyllabus.ts`
- Create: `lib/courses/__tests__/formatCourseSyllabus.test.ts`

The existing `/api/analyze` endpoint expects `syllabusText` as a free-text blob. We'll build that blob client-side from the editable structured fields so we don't need to change the AI prompts or analyze endpoint.

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect } from 'vitest';
import { formatCourseSyllabus } from '@/lib/courses/formatCourseSyllabus';

describe('formatCourseSyllabus', () => {
  it('produces labeled markdown from structured fields', () => {
    const out = formatCourseSyllabus({
      code: 'GC 3460',
      title: 'Ink and Substrates',
      track: 'Core',
      level: 3,
      description: 'Substrates and inks.',
      prerequisites: 'GC 2070',
      learningObjectives: ['Identify substrates.', 'Specify inks.'],
      majorProjects: ['Compatibility matrix.'],
      skillsRequired: ['Chemistry basics.'],
    });
    expect(out).toContain('# GC 3460 — Ink and Substrates');
    expect(out).toContain('**Level:** 3');
    expect(out).toContain('**Track:** Core');
    expect(out).toContain('**Prerequisites:** GC 2070');
    expect(out).toContain('## Description\nSubstrates and inks.');
    expect(out).toContain('## Learning Objectives\n- Identify substrates.\n- Specify inks.');
    expect(out).toContain('## Major Projects\n- Compatibility matrix.');
    expect(out).toContain('## Skills / Competencies Required\n- Chemistry basics.');
  });

  it('omits empty sections', () => {
    const out = formatCourseSyllabus({
      code: 'GC 1010', title: 'Orientation', track: 'Core', level: 1,
      description: 'x', prerequisites: '', learningObjectives: [],
      majorProjects: [], skillsRequired: [],
    });
    expect(out).not.toContain('## Learning Objectives');
    expect(out).not.toContain('## Major Projects');
    expect(out).not.toContain('## Skills');
    expect(out).not.toContain('Prerequisites');
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// lib/courses/formatCourseSyllabus.ts
export interface CourseFields {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  prerequisites: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

export function formatCourseSyllabus(c: CourseFields): string {
  const parts: string[] = [];
  parts.push(`# ${c.code} — ${c.title}`);
  parts.push(`**Level:** ${c.level}`);
  parts.push(`**Track:** ${c.track}`);
  if (c.prerequisites.trim()) parts.push(`**Prerequisites:** ${c.prerequisites.trim()}`);
  if (c.description.trim()) parts.push(`\n## Description\n${c.description.trim()}`);
  if (c.learningObjectives.length > 0) {
    parts.push(`\n## Learning Objectives\n${c.learningObjectives.map(s => `- ${s}`).join('\n')}`);
  }
  if (c.majorProjects.length > 0) {
    parts.push(`\n## Major Projects\n${c.majorProjects.map(s => `- ${s}`).join('\n')}`);
  }
  if (c.skillsRequired.length > 0) {
    parts.push(`\n## Skills / Competencies Required\n${c.skillsRequired.map(s => `- ${s}`).join('\n')}`);
  }
  return parts.join('\n');
}
```

Run: `npm test -- lib/courses/__tests__/formatCourseSyllabus.test.ts`
Expected: 2 PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/courses/
git commit -m "feat: format structured course fields into labeled syllabus markdown"
```

---

### Task 8: CourseSelector + CourseDetails components

**Files:**
- Create: `components/CourseSelector.tsx`
- Create: `components/CourseDetails.tsx`
- Create: `components/__tests__/CourseDetails.test.tsx`

- [ ] **Step 1: Implement CourseSelector** (a Select with an internal search filter — keeps to existing shadcn primitives, no new dep)

```tsx
// components/CourseSelector.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface CourseListItem {
  code: string;
  title: string;
  level: number;
  track: string;
}

interface Props {
  slug: string;
  selectedCode: string;
  onSelect: (code: string) => void;
  label: string;
  excludeCode?: string;       // hide the course being analyzed from prior-coursework lists
  inputId: string;            // for label association
}

export function CourseSelector({ slug, selectedCode, onSelect, label, excludeCode, inputId }: Props) {
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
        {filtered.map(c => (
          <button
            key={c.code}
            type="button"
            onClick={() => onSelect(c.code)}
            className={`block w-full text-left px-3 py-2 hover:bg-muted text-sm ${
              c.code === selectedCode ? 'bg-muted font-medium' : ''
            }`}
          >
            <span className="font-mono text-xs text-muted-foreground mr-2">{c.code}</span>
            {c.title}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement CourseDetails with edit-state tracking**

```tsx
// components/CourseDetails.tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface CourseDetailFields {
  description: string;
  prerequisites: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

interface Props {
  original: CourseDetailFields;     // last fetched from the sheet
  current: CourseDetailFields;      // current editable state
  onChange: (next: CourseDetailFields) => void;
  onReset: () => void;
}

function lines(arr: string[]): string { return arr.join('\n'); }
function toArr(s: string): string[] { return s.split('\n').map(x => x.trim()).filter(Boolean); }

function fieldEdited<T>(a: T, b: T): boolean { return JSON.stringify(a) !== JSON.stringify(b); }

export function CourseDetails({ original, current, onChange, onReset }: Props) {
  const anyEdited =
    current.description !== original.description ||
    current.prerequisites !== original.prerequisites ||
    fieldEdited(current.learningObjectives, original.learningObjectives) ||
    fieldEdited(current.majorProjects, original.majorProjects) ||
    fieldEdited(current.skillsRequired, original.skillsRequired);

  function EditedBadge({ shown }: { shown: boolean }) {
    return shown ? <Badge variant="secondary" className="ml-2">Edited</Badge> : null;
  }

  return (
    <div className="space-y-4">
      {anyEdited && (
        <div className="flex justify-end">
          <button type="button" onClick={onReset} className="text-xs underline text-muted-foreground hover:text-foreground">
            Reset all fields to sheet version
          </button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor="course-description">Description</Label>
          <EditedBadge shown={current.description !== original.description} />
        </div>
        <Textarea
          id="course-description" rows={4}
          value={current.description}
          onChange={(e) => onChange({ ...current, description: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor="course-prereqs">Prerequisites</Label>
          <EditedBadge shown={current.prerequisites !== original.prerequisites} />
        </div>
        <Textarea
          id="course-prereqs" rows={2}
          value={current.prerequisites}
          onChange={(e) => onChange({ ...current, prerequisites: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor="course-objectives">Learning Objectives <span className="text-xs text-muted-foreground">(one per line)</span></Label>
          <EditedBadge shown={fieldEdited(current.learningObjectives, original.learningObjectives)} />
        </div>
        <Textarea
          id="course-objectives" rows={6}
          value={lines(current.learningObjectives)}
          onChange={(e) => onChange({ ...current, learningObjectives: toArr(e.target.value) })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor="course-projects">Major Projects <span className="text-xs text-muted-foreground">(one per line)</span></Label>
          <EditedBadge shown={fieldEdited(current.majorProjects, original.majorProjects)} />
        </div>
        <Textarea
          id="course-projects" rows={5}
          value={lines(current.majorProjects)}
          onChange={(e) => onChange({ ...current, majorProjects: toArr(e.target.value) })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center">
          <Label htmlFor="course-skills">Skills / Competencies Required <span className="text-xs text-muted-foreground">(one per line)</span></Label>
          <EditedBadge shown={fieldEdited(current.skillsRequired, original.skillsRequired)} />
        </div>
        <Textarea
          id="course-skills" rows={5}
          value={lines(current.skillsRequired)}
          onChange={(e) => onChange({ ...current, skillsRequired: toArr(e.target.value) })}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Component test for the "Edited" indicator + reset**

```tsx
// components/__tests__/CourseDetails.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CourseDetails, type CourseDetailFields } from '@/components/CourseDetails';
import { useState } from 'react';

const ORIGINAL: CourseDetailFields = {
  description: 'orig desc',
  prerequisites: 'GC 0000',
  learningObjectives: ['a', 'b'],
  majorProjects: ['p1'],
  skillsRequired: ['s1'],
};

function Harness() {
  const [current, setCurrent] = useState<CourseDetailFields>(ORIGINAL);
  return (
    <CourseDetails
      original={ORIGINAL}
      current={current}
      onChange={setCurrent}
      onReset={() => setCurrent(ORIGINAL)}
    />
  );
}

describe('CourseDetails', () => {
  it('shows no Edited badges when current matches original', () => {
    render(<Harness />);
    expect(screen.queryByText('Edited')).toBeNull();
  });

  it('shows Edited badge when description is changed and resets via the link', () => {
    render(<Harness />);
    const ta = screen.getByLabelText(/Description/i);
    fireEvent.change(ta, { target: { value: 'changed' } });
    expect(screen.getAllByText('Edited').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/Reset all fields/i));
    expect(screen.queryByText('Edited')).toBeNull();
  });
});
```

Run: `npm test -- components/__tests__/CourseDetails.test.tsx`
Expected: 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add components/CourseSelector.tsx components/CourseDetails.tsx components/__tests__/CourseDetails.test.tsx
git commit -m "feat: CourseSelector + CourseDetails editable structured-fields components"
```

---

### Task 9: Rewire PrototypeForm to use sheet-backed courses

**Files:**
- Modify: `components/PrototypeForm.tsx` (replace Course + Prior Coursework input cards)
- Modify: `app/preview/[slug]/PrototypeClient.tsx` (pass slug to PrototypeForm)
- Delete: `components/SampleSyllabusButton.tsx` and `lib/domain/sample-syllabi.ts`

The component now holds a `CourseState` per course (selectedCode + editable fields + original sheet fields). On submit, format each course via `formatCourseSyllabus` into the `syllabusText` shape the analyze endpoint already accepts.

- [ ] **Step 1: Rewrite `components/PrototypeForm.tsx`** with the new sheet-backed flow (full file replacement)

Key behaviors:
- Accepts a new `slug: string` prop (passed from `PrototypeClient`).
- Each course slot holds `{ selectedCode: string; original: CourseDetailFields; current: CourseDetailFields; title: string }`.
- Selecting a code calls `GET /api/courses/<code>` and populates both `original` and `current`.
- "Edited" indicator and reset live inside `CourseDetails`.
- On submit, `formatCourseSyllabus({ ...current, code, title, level, track })` produces `syllabusText`; the form sends `{ courseLabel: code, syllabusText }` to the existing `onAnalyze` callback so the analyze endpoint contract doesn't change.
- The Course slot can't be the same code as any Prior Coursework slot (CourseSelector accepts `excludeCode`).

(See the file for full contents; the implementer is responsible for completing the merge.)

- [ ] **Step 2: Update `app/preview/[slug]/PrototypeClient.tsx`** to pass `slug` to `<PrototypeForm slug={slug} onAnalyze={...} isAnalyzing={...} />`.

- [ ] **Step 3: Delete the now-unused paste-in helpers**

```bash
rm components/SampleSyllabusButton.tsx
rm lib/domain/sample-syllabi.ts
```

Search for and remove any imports referencing those files.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS (no regressions in existing tests).

- [ ] **Step 5: Run dev server and smoke-test in browser**

Run: `npm run dev`
Open: `http://localhost:3000/preview/<your-PROTOTYPE_SLUG>`
Verify:
- Course Selector shows the 28 courses, search filters them.
- Picking a course populates the editable fields.
- Editing a field shows the "Edited" badge; "Reset all fields" clears it.
- Picking a Prior Coursework course hides it from any further Prior Coursework slot for the same form (and from the Course slot).
- Submitting runs the analysis end to end.

- [ ] **Step 6: Commit**

```bash
git add components/PrototypeForm.tsx app/preview/
git rm components/SampleSyllabusButton.tsx lib/domain/sample-syllabi.ts 2>/dev/null || true
git commit -m "feat(form): replace paste-in syllabi with sheet-backed editable Course + Prior Coursework"
```

---

### Task 10: Admin "Resync from Sheet" UI

**Files:**
- Modify: `app/preview/[slug]/targets/page.tsx` (add a "Course Sync" card at the top, server-fetches `getSyncState`)
- Create: `components/CourseSyncCard.tsx` (client component with the button + status display)

- [ ] **Step 1: Create the client-side card**

```tsx
// components/CourseSyncCard.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SyncState {
  lastSyncedAt: string | null;
  lastSyncedCount: number;
  lastErrors: string[];
}

interface Props {
  slug: string;
  initialState: SyncState;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function CourseSyncCard({ slug, initialState }: Props) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resync() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/resync-courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) throw new Error(`Resync failed: ${res.status}`);
      const json = await res.json();
      setState({
        lastSyncedAt: json.lastSyncedAt,
        lastSyncedCount: json.synced,
        lastErrors: json.errors ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Course Sync</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Pulls the latest course data from the shared Google Sheet into the tool.
          {state.lastSyncedAt
            ? <> Last synced: <span className="font-medium">{relativeTime(state.lastSyncedAt)}</span> ({state.lastSyncedCount} courses).</>
            : <> Never synced.</>}
        </p>
        <Button onClick={resync} disabled={busy}>
          {busy ? 'Syncing…' : 'Resync from Sheet'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {state.lastErrors.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {state.lastErrors.length} tab{state.lastErrors.length === 1 ? '' : 's'} failed on the last sync
            </summary>
            <ul className="list-disc pl-5 mt-2 text-muted-foreground">
              {state.lastErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Wire into the targets page**

In `app/preview/[slug]/targets/page.tsx`, import `getSyncState`, fetch it server-side, and render `<CourseSyncCard slug={slug} initialState={...} />` at the top of the page (above the targets list).

```typescript
// at top of page.tsx
import { getSyncState } from '@/lib/db/courses-queries';
import { CourseSyncCard } from '@/components/CourseSyncCard';

// inside the component, after isValidSlug check:
const syncState = await getSyncState();
const initialState = {
  lastSyncedAt: syncState?.lastSyncedAt?.toISOString() ?? null,
  lastSyncedCount: syncState?.lastSyncedCount ?? 0,
  lastErrors: syncState?.lastErrors ?? [],
};

// in the JSX, above the targets list:
<CourseSyncCard slug={slug} initialState={initialState} />
```

- [ ] **Step 3: Smoke-test in the browser**

Run: `npm run dev`
Open: `http://localhost:3000/preview/<slug>/targets`
Click "Resync from Sheet". Verify the badge updates and that 28 courses sync (assuming `GOOGLE_SHEET_ID` is set in `.env.local`).

- [ ] **Step 4: Commit**

```bash
git add components/CourseSyncCard.tsx app/preview/[slug]/targets/page.tsx
git commit -m "feat(admin): Course Sync card with Resync button + last-synced badge"
```

---

### Task 11: Env, docs, deploy

**Files:**
- Modify: `.env.example`
- Modify: `next.config.ts` (no change expected, just verify outputFileTracingIncludes still covers prompts)
- Modify: `README.md` if it has a setup section

- [ ] **Step 1: Add `GOOGLE_SHEET_ID` to `.env.example`**

```
GOOGLE_SHEET_ID=12aPhgrIlhDYjKD0-Gt97glf1d9fKtwKmL4FwM8iTz7Q
```

- [ ] **Step 2: Set `GOOGLE_SHEET_ID` in Vercel project env**

Add via `vercel env add GOOGLE_SHEET_ID` (or the dashboard). Production environment only — preview env optional.

- [ ] **Step 3: Locally set it and run a full end-to-end pass**

```bash
echo "GOOGLE_SHEET_ID=12aPhgrIlhDYjKD0-Gt97glf1d9fKtwKmL4FwM8iTz7Q" >> .env.local
npm run dev
```

Open the targets page, hit Resync, confirm 28 courses sync. Open the form, pick a Course and Prior Coursework, run an analysis. Confirm the result renders.

- [ ] **Step 4: Deploy and run a production smoke test**

```bash
git push origin main
```

After Vercel deploys: open the production preview URL, hit Resync once (initial DB seed), then run an analysis with sheet-backed courses.

- [ ] **Step 5: Commit any .env.example update**

```bash
git add .env.example
git commit -m "docs: document GOOGLE_SHEET_ID env var for sheet integration"
```

---

## Notes for implementers

- The existing rate-limit + daily-cap logic in `/api/analyze` is unchanged; sheet integration only changes the *input* shape on the client side.
- The Apps Script writes "Course Code" + "Title" as two separate rows in the sheet, but the gviz CSV export sometimes collapses them as `"Course Code Title","<code> <title>"`. The parser handles both cases via `splitCollapsedCodeTitle`.
- The shared sheet is "anyone with link can view." Resync is unauthenticated to Google but slug-gated on our side, so only people with the prototype URL can trigger it. Acceptable for the M-trial scope.
- Do not change `/api/analyze` or any AI prompt file in this increment. Doing so re-opens the analysis-quality conversation we already closed.
