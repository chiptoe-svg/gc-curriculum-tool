# Sheet Sync Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the retired `/api/admin/resync-courses` route so the existing CourseSyncCard can pull fresh course data from the shared Google Sheet into the `courses` table.

**Architecture:** All infrastructure (fetchSheet, parseCourseTab, upsertCourses, recordSyncResult, CourseSyncCard, admin page) already exists. Only the route body needs to be restored — it was retired after Build 0 and replaced with a 410. Re-wire it: read GOOGLE_SHEET_ID from env, fetch the Index tab for course codes, fetch+parse each course tab, upsert, record sync state, return JSON. Update the existing test to expect 200 instead of 410.

**Tech Stack:** Next.js route handler, existing `lib/sheets/fetchSheet.ts`, `lib/sheets/parseCourseTab.ts`, `lib/db/courses-queries.ts`

---

### Task 1: Restore the route and update its test

**Files:**
- Modify: `app/api/admin/resync-courses/route.ts`
- Modify: `app/api/admin/resync-courses/__tests__/route.test.ts`

The route must:
1. Read `slug` from JSON body, gate with `isValidSlug`
2. Read `GOOGLE_SHEET_ID` from `process.env` — return 500 if missing
3. Fetch `fetchIndexCourseCodes(sheetId)` to get list of course codes
4. For each code, `fetchCourseTabCsv(sheetId, code)` → `parseCourseTab(csv)` (collect errors, don't abort on single failure)
5. `upsertCourses(parsed)`
6. `recordSyncResult(count, errors)`
7. Return `{ synced: count, errors, lastSyncedAt: new Date().toISOString() }`

- [ ] **Step 1: Update the test to describe what it should do (and verify it currently fails)**

Replace `app/api/admin/resync-courses/__tests__/route.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external calls — no real network or DB in tests.
vi.mock('@/lib/sheets/fetchSheet', () => ({
  fetchIndexCourseCodes: vi.fn(),
  fetchCourseTabCsv: vi.fn(),
}));
vi.mock('@/lib/sheets/parseCourseTab', () => ({
  parseCourseTab: vi.fn(),
}));
vi.mock('@/lib/db/courses-queries', () => ({
  upsertCourses: vi.fn(),
  recordSyncResult: vi.fn(),
}));
vi.mock('@/lib/slug', () => ({
  isValidSlug: (s: string) => s === 'valid-slug',
}));

import { POST } from '@/app/api/admin/resync-courses/route';
import { fetchIndexCourseCodes, fetchCourseTabCsv } from '@/lib/sheets/fetchSheet';
import { parseCourseTab } from '@/lib/sheets/parseCourseTab';
import { upsertCourses, recordSyncResult } from '@/lib/db/courses-queries';

const mockFetchCodes = fetchIndexCourseCodes as ReturnType<typeof vi.fn>;
const mockFetchCsv = fetchCourseTabCsv as ReturnType<typeof vi.fn>;
const mockParse = parseCourseTab as ReturnType<typeof vi.fn>;
const mockUpsert = upsertCourses as ReturnType<typeof vi.fn>;
const mockRecord = recordSyncResult as ReturnType<typeof vi.fn>;

const FAKE_PARSED = {
  code: 'GC 3460', title: 'Ink and Substrates', level: 3, track: 'Core',
  description: '', prerequisites: '', syllabusUrl: null,
  learningObjectives: [], majorProjects: [], skillsRequired: [],
};

function makeReq(body: unknown) {
  return new Request('http://x/api/admin/resync-courses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.GOOGLE_SHEET_ID = 'test-sheet-id';
});

describe('POST /api/admin/resync-courses', () => {
  it('returns 401 for invalid slug', async () => {
    const res = await POST(makeReq({ slug: 'bad' }));
    expect(res.status).toBe(401);
  });

  it('syncs courses and returns count', async () => {
    mockFetchCodes.mockResolvedValue(['GC 3460']);
    mockFetchCsv.mockResolvedValue('csv-content');
    mockParse.mockReturnValue(FAKE_PARSED);
    mockUpsert.mockResolvedValue(1);
    mockRecord.mockResolvedValue(undefined);

    const res = await POST(makeReq({ slug: 'valid-slug' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.synced).toBe(1);
    expect(json.errors).toEqual([]);
    expect(typeof json.lastSyncedAt).toBe('string');
    expect(mockUpsert).toHaveBeenCalledWith([FAKE_PARSED]);
    expect(mockRecord).toHaveBeenCalledWith(1, []);
  });

  it('collects errors per course without aborting the whole sync', async () => {
    mockFetchCodes.mockResolvedValue(['GC 3460', 'GC 9999']);
    mockFetchCsv.mockResolvedValueOnce('good-csv').mockRejectedValueOnce(new Error('404 Not Found'));
    mockParse.mockReturnValue(FAKE_PARSED);
    mockUpsert.mockResolvedValue(1);
    mockRecord.mockResolvedValue(undefined);

    const res = await POST(makeReq({ slug: 'valid-slug' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.synced).toBe(1);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]).toContain('GC 9999');
  });

  it('returns 500 if GOOGLE_SHEET_ID is missing', async () => {
    delete process.env.GOOGLE_SHEET_ID;
    const res = await POST(makeReq({ slug: 'valid-slug' }));
    expect(res.status).toBe(500);
  });
});
```

Run: `pnpm vitest run app/api/admin/resync-courses`  
Expected: 3 tests FAIL (401 passes because current route doesn't check slug), 1 or 2 PASS coincidentally

- [ ] **Step 2: Write the restored route**

Replace `app/api/admin/resync-courses/route.ts` with:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { fetchIndexCourseCodes, fetchCourseTabCsv } from '@/lib/sheets/fetchSheet';
import { parseCourseTab } from '@/lib/sheets/parseCourseTab';
import { upsertCourses, recordSyncResult } from '@/lib/db/courses-queries';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    return NextResponse.json({ error: 'GOOGLE_SHEET_ID not configured' }, { status: 500 });
  }

  const codes = await fetchIndexCourseCodes(sheetId);
  const parsed = [];
  const errors: string[] = [];

  for (const code of codes) {
    try {
      const csv = await fetchCourseTabCsv(sheetId, code);
      parsed.push(parseCourseTab(csv));
    } catch (e) {
      errors.push(`${code}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const count = await upsertCourses(parsed);
  await recordSyncResult(count, errors);

  return NextResponse.json({ synced: count, errors, lastSyncedAt: new Date().toISOString() });
}
```

- [ ] **Step 3: Run the tests and verify all pass**

Run: `pnpm vitest run app/api/admin/resync-courses`  
Expected: 4 tests PASS

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `pnpm vitest run`  
Expected: all existing tests pass

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/resync-courses/route.ts app/api/admin/resync-courses/__tests__/route.test.ts
git commit -m "feat(sync): restore Google Sheet → DB resync route"
```
