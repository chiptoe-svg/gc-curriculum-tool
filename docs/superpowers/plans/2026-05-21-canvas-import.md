# Canvas LMS Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Import from Canvas" panel to the Course Builder Materials tab. Faculty paste their Clemson Canvas course URL and a personal API token; the system fetches the syllabus and assignments, converts HTML to text, and stores the results as `course_materials` records that feed into the existing AI analysis pipeline.

**Architecture:** Three layers — (1) `lib/canvas/` for pure data-fetching + HTML-stripping logic, (2) `POST /api/courses/[code]/canvas-import` for the server-side orchestration (slug-gated, token never stored), (3) `CanvasImportZone` client component dropped into `MaterialsZone`. The Canvas token is used only in the server route and never written to the DB. Fetched content is stored directly as `course_materials` rows with `extractionStatus: 'ok'` and `extractedText` populated at insert time — no blob storage, `blobUrl` carries the Canvas course URL as a reference link.

**Tech Stack:** Next.js route handler, Canvas REST API (Clemson `clemson.instructure.com/api/v1`), native HTML stripping (no extra deps), Drizzle ORM, existing `course-materials-queries.ts`

---

### File map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/canvas/parseCanvasUrl.ts` | Create | Extract numeric course ID from any Canvas course URL |
| `lib/canvas/fetchCanvasCourse.ts` | Create | Fetch course syllabus + assignments via Canvas API |
| `lib/canvas/htmlToText.ts` | Create | Strip HTML tags → readable plain text |
| `tests/lib/canvas/parseCanvasUrl.test.ts` | Create | Unit tests for URL parsing |
| `tests/lib/canvas/htmlToText.test.ts` | Create | Unit tests for HTML stripping |
| `app/api/courses/[code]/canvas-import/route.ts` | Create | POST endpoint: orchestrate fetch + insert |
| `app/api/courses/[code]/canvas-import/__tests__/route.test.ts` | Create | Integration test for route |
| `components/CanvasImportZone.tsx` | Create | Client form: URL + token fields + status |
| `app/preview/[slug]/courses/[code]/MaterialsZone.tsx` | Modify | Add CanvasImportZone below UploadZone |

---

### Task 1: Canvas URL parser

**Files:**
- Create: `lib/canvas/parseCanvasUrl.ts`
- Create: `tests/lib/canvas/parseCanvasUrl.test.ts`

Canvas course URLs follow the pattern `https://<host>/courses/<id>` where `<id>` is a positive integer. The host may vary (e.g. `clemson.instructure.com`, `canvas.instructure.com`). The function should return the numeric string course ID or `null` if the URL doesn't match.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/canvas/parseCanvasUrl.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseCanvasUrl } from '@/lib/canvas/parseCanvasUrl';

describe('parseCanvasUrl', () => {
  it('extracts course ID from standard URL', () => {
    expect(parseCanvasUrl('https://clemson.instructure.com/courses/12345')).toBe('12345');
  });

  it('extracts course ID when URL has trailing path', () => {
    expect(parseCanvasUrl('https://clemson.instructure.com/courses/12345/assignments')).toBe('12345');
  });

  it('returns null for non-Canvas URL', () => {
    expect(parseCanvasUrl('https://example.com/courses/12345')).toBe('12345');
    // any URL with /courses/<digits> is acceptable
  });

  it('returns null for URL without numeric course ID', () => {
    expect(parseCanvasUrl('https://clemson.instructure.com/courses/abc')).toBeNull();
  });

  it('returns null for non-URL strings', () => {
    expect(parseCanvasUrl('12345')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCanvasUrl('')).toBeNull();
  });
});
```

Run: `pnpm vitest run tests/lib/canvas/parseCanvasUrl.test.ts`  
Expected: FAIL — module not found

- [ ] **Step 2: Implement parseCanvasUrl**

Create `lib/canvas/parseCanvasUrl.ts`:

```typescript
export function parseCanvasUrl(url: string): string | null {
  const m = url.match(/\/courses\/(\d+)/);
  return m?.[1] ?? null;
}
```

- [ ] **Step 3: Run tests and verify they pass**

Run: `pnpm vitest run tests/lib/canvas/parseCanvasUrl.test.ts`  
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add lib/canvas/parseCanvasUrl.ts tests/lib/canvas/parseCanvasUrl.test.ts
git commit -m "feat(canvas): add Canvas URL parser"
```

---

### Task 2: HTML-to-text converter

**Files:**
- Create: `lib/canvas/htmlToText.ts`
- Create: `tests/lib/canvas/htmlToText.test.ts`

Canvas returns syllabus_body and assignment descriptions as raw HTML. The converter must produce readable plain text without adding external dependencies. Strategy: remove `<style>` and `<script>` blocks entirely, decode common HTML entities (`&amp;`, `&lt;`, `&gt;`, `&nbsp;`, `&#NNN;`), replace block-level tags with newlines, strip remaining tags, collapse whitespace.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/canvas/htmlToText.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { htmlToText } from '@/lib/canvas/htmlToText';

describe('htmlToText', () => {
  it('strips basic tags', () => {
    expect(htmlToText('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  it('converts block tags to newlines', () => {
    const result = htmlToText('<p>First</p><p>Second</p>');
    expect(result).toContain('First');
    expect(result).toContain('Second');
    expect(result.indexOf('First')).toBeLessThan(result.indexOf('Second'));
  });

  it('decodes HTML entities', () => {
    expect(htmlToText('&lt;tag&gt; &amp; &nbsp;text')).toContain('<tag> &');
  });

  it('removes script and style blocks entirely', () => {
    const result = htmlToText('<style>body{color:red}</style><p>Content</p><script>alert(1)</script>');
    expect(result).toBe('Content');
    expect(result).not.toContain('color');
    expect(result).not.toContain('alert');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(htmlToText('plain text')).toBe('plain text');
  });
});
```

Run: `pnpm vitest run tests/lib/canvas/htmlToText.test.ts`  
Expected: FAIL — module not found

- [ ] **Step 2: Implement htmlToText**

Create `lib/canvas/htmlToText.ts`:

```typescript
export function htmlToText(html: string): string {
  if (!html) return '';
  // Remove script and style blocks entirely (including their content).
  let text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  // Block-level tags → newline.
  text = text.replace(/<\/?(p|div|br|li|h[1-6]|tr|td|th|blockquote|pre|ul|ol)[^>]*>/gi, '\n');
  // Strip remaining tags.
  text = text.replace(/<[^>]+>/g, '');
  // Decode common entities.
  text = text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#?(\w+);/gi, (_, e) => {
      if (/^\d+$/.test(e)) return String.fromCharCode(parseInt(e, 10));
      return '';
    })
    .replace(/&nbsp;/gi, ' ');
  // Collapse runs of whitespace/newlines to single newlines, trim edges.
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
```

- [ ] **Step 3: Run tests and verify they pass**

Run: `pnpm vitest run tests/lib/canvas/htmlToText.test.ts`  
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add lib/canvas/htmlToText.ts tests/lib/canvas/htmlToText.test.ts
git commit -m "feat(canvas): add HTML-to-text converter"
```

---

### Task 3: Canvas API fetcher

**Files:**
- Create: `lib/canvas/fetchCanvasCourse.ts`

This is a pure fetch wrapper — no tests for it since it makes live HTTP calls. It fetches three resources from the Canvas REST API:
1. `GET /api/v1/courses/:id?include[]=syllabus_body` → syllabus HTML
2. `GET /api/v1/courses/:id/assignments?per_page=50` → array of assignment objects
3. `GET /api/v1/courses/:id/modules?include[]=items&per_page=50` → array of module objects

Returns a structured object the route can serialize directly into material rows.

- [ ] **Step 1: Create the fetcher**

Create `lib/canvas/fetchCanvasCourse.ts`:

```typescript
export interface CanvasCourse {
  id: string;
  name: string;
  syllabusHtml: string;
}

export interface CanvasAssignment {
  id: string;
  name: string;
  descriptionHtml: string;
  pointsPossible: number | null;
}

export interface CanvasModule {
  id: string;
  name: string;
  items: Array<{ title: string; type: string }>;
}

export interface CanvasCourseData {
  course: CanvasCourse;
  assignments: CanvasAssignment[];
  modules: CanvasModule[];
}

async function canvasFetch(baseUrl: string, path: string, token: string): Promise<unknown> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Canvas API ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchCanvasCourse(canvasBaseUrl: string, courseId: string, token: string): Promise<CanvasCourseData> {
  const [courseRaw, assignmentsRaw, modulesRaw] = await Promise.all([
    canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}?include[]=syllabus_body`, token),
    canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/assignments?per_page=50`, token),
    canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/modules?include[]=items&per_page=50`, token),
  ]);

  const c = courseRaw as Record<string, unknown>;
  const course: CanvasCourse = {
    id: String(c['id'] ?? courseId),
    name: String(c['name'] ?? ''),
    syllabusHtml: String(c['syllabus_body'] ?? ''),
  };

  const assignments: CanvasAssignment[] = ((Array.isArray(assignmentsRaw) ? assignmentsRaw : []) as Record<string, unknown>[]).map((a) => ({
    id: String(a['id'] ?? ''),
    name: String(a['name'] ?? ''),
    descriptionHtml: String(a['description'] ?? ''),
    pointsPossible: typeof a['points_possible'] === 'number' ? a['points_possible'] : null,
  }));

  const modules: CanvasModule[] = ((Array.isArray(modulesRaw) ? modulesRaw : []) as Record<string, unknown>[]).map((m) => ({
    id: String(m['id'] ?? ''),
    name: String(m['name'] ?? ''),
    items: ((Array.isArray(m['items']) ? m['items'] : []) as Record<string, unknown>[]).map((i) => ({
      title: String(i['title'] ?? ''),
      type: String(i['type'] ?? ''),
    })),
  }));

  return { course, assignments, modules };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/canvas/fetchCanvasCourse.ts
git commit -m "feat(canvas): add Canvas API fetcher"
```

---

### Task 4: Canvas import API route

**Files:**
- Create: `app/api/courses/[code]/canvas-import/route.ts`
- Create: `app/api/courses/[code]/canvas-import/__tests__/route.test.ts`

The route accepts `POST { slug, canvasUrl, canvasToken }`. It:
1. Slug-gates the request
2. Verifies the course exists
3. Parses the Canvas course ID from the URL
4. Derives the Canvas base URL (scheme + host from the provided URL)
5. Calls `fetchCanvasCourse` to get syllabus + assignments + modules
6. Converts each to plain text via `htmlToText`
7. Inserts up to 3 `course_materials` rows (syllabus, assignments combined, modules combined) with `blobUrl = canvasUrl`, `extractionStatus = 'ok'`, `extractedText` set

**Token is never stored.** It's used during the request only.

The `course_materials` schema requires `blobUrl NOT NULL` — use the Canvas course URL as the reference. The `ipHash` field is required — compute it from the request IP using the existing `hashIp` utility.

Material rows produced (only insert if the text is non-empty):
- `fileName: "Canvas: Syllabus"`, `mimeType: "text/html"`, `sizeBytes: syllabusText.length`
- `fileName: "Canvas: Assignments"`, `mimeType: "text/html"`, `sizeBytes: assignmentsText.length`
- `fileName: "Canvas: Module List"`, `mimeType: "text/html"`, `sizeBytes: modulesText.length`

The `insertMaterial` function currently sets `extractionStatus: 'pending'`. After inserting, immediately call `updateExtractionResult` with `extractionStatus: 'ok'`, `extractionMethod: 'text'`, `extractedText: <text>`.

- [ ] **Step 1: Write the failing tests**

Create `app/api/courses/[code]/canvas-import/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'test-hash' }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn() }));
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial: vi.fn(),
  updateExtractionResult: vi.fn(),
}));
vi.mock('@/lib/canvas/fetchCanvasCourse', () => ({
  fetchCanvasCourse: vi.fn(),
}));
vi.mock('@/lib/canvas/htmlToText', () => ({
  htmlToText: (s: string) => s.replace(/<[^>]+>/g, '').trim(),
}));

import { POST } from '@/app/api/courses/[code]/canvas-import/route';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { insertMaterial, updateExtractionResult } from '@/lib/db/course-materials-queries';
import { fetchCanvasCourse } from '@/lib/canvas/fetchCanvasCourse';

const mockGetCourse = getCourseByCode as ReturnType<typeof vi.fn>;
const mockInsert = insertMaterial as ReturnType<typeof vi.fn>;
const mockUpdate = updateExtractionResult as ReturnType<typeof vi.fn>;
const mockFetch = fetchCanvasCourse as ReturnType<typeof vi.fn>;

const FAKE_COURSE = { code: 'GC 3460', title: 'Ink and Substrates', level: 3, track: 'Core', description: '', prerequisites: '', syllabusUrl: null, learningObjectives: [], majorProjects: [], skillsRequired: [], builderStatus: 'draft', lastSyncedAt: new Date() };

const CANVAS_DATA = {
  course: { id: '12345', name: 'Ink and Substrates', syllabusHtml: '<p>Course syllabus content here.</p>' },
  assignments: [
    { id: '1', name: 'Substrate Analysis', descriptionHtml: '<p>Analyze substrates.</p>', pointsPossible: 100 },
  ],
  modules: [
    { id: '1', name: 'Week 1', items: [{ title: 'Intro', type: 'Page' }] },
  ],
};

function makeReq(body: unknown, code = 'GC 3460') {
  return [
    new Request('http://x/api/courses/GC%203460/canvas-import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ code }) },
  ] as const;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockInsert.mockResolvedValue({ id: 'mat-1' });
  mockUpdate.mockResolvedValue(undefined);
});

describe('POST /api/courses/[code]/canvas-import', () => {
  it('returns 401 for invalid slug', async () => {
    const [req, ctx] = makeReq({ slug: 'bad', canvasUrl: 'https://clemson.instructure.com/courses/12345', canvasToken: 'tok' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing canvasUrl', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    const [req, ctx] = makeReq({ slug: 'valid-slug', canvasUrl: '', canvasToken: 'tok' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for unparseable Canvas URL', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    const [req, ctx] = makeReq({ slug: 'valid-slug', canvasUrl: 'https://clemson.instructure.com/not-a-course', canvasToken: 'tok' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown course code', async () => {
    mockGetCourse.mockResolvedValue(null);
    const [req, ctx] = makeReq({ slug: 'valid-slug', canvasUrl: 'https://clemson.instructure.com/courses/12345', canvasToken: 'tok' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it('inserts materials and returns imported list', async () => {
    mockGetCourse.mockResolvedValue(FAKE_COURSE);
    mockFetch.mockResolvedValue(CANVAS_DATA);
    mockInsert.mockResolvedValueOnce({ id: 'mat-1' }).mockResolvedValueOnce({ id: 'mat-2' }).mockResolvedValueOnce({ id: 'mat-3' });

    const [req, ctx] = makeReq({ slug: 'valid-slug', canvasUrl: 'https://clemson.instructure.com/courses/12345', canvasToken: 'tok' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBeGreaterThanOrEqual(1);
    // Syllabus was non-empty, so it should be inserted
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'Canvas: Syllabus' }));
    // Each insert should be followed by updateExtractionResult
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ extractionStatus: 'ok' }));
  });
});
```

Run: `pnpm vitest run app/api/courses/\\[code\\]/canvas-import`  
Expected: FAIL — module not found

- [ ] **Step 2: Implement the route**

Create `app/api/courses/[code]/canvas-import/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { hashIp } from '@/lib/ip-hash';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { insertMaterial, updateExtractionResult } from '@/lib/db/course-materials-queries';
import { parseCanvasUrl } from '@/lib/canvas/parseCanvasUrl';
import { fetchCanvasCourse } from '@/lib/canvas/fetchCanvasCourse';
import { htmlToText } from '@/lib/canvas/htmlToText';

export const maxDuration = 60;

interface Ctx { params: Promise<{ code: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const canvasUrl = typeof body.canvasUrl === 'string' ? body.canvasUrl.trim() : '';
  const canvasToken = typeof body.canvasToken === 'string' ? body.canvasToken.trim() : '';
  if (!canvasUrl) return NextResponse.json({ error: 'canvasUrl is required' }, { status: 400 });
  if (!canvasToken) return NextResponse.json({ error: 'canvasToken is required' }, { status: 400 });

  const courseId = parseCanvasUrl(canvasUrl);
  if (!courseId) return NextResponse.json({ error: 'Could not parse a Canvas course ID from the URL. Expected format: https://clemson.instructure.com/courses/12345' }, { status: 400 });

  const course = await getCourseByCode(code);
  if (!course) return NextResponse.json({ error: `Course not found: ${code}` }, { status: 404 });

  // Derive base URL (scheme + host) from the provided Canvas URL.
  let canvasBaseUrl: string;
  try {
    const parsed = new URL(canvasUrl);
    canvasBaseUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {
    return NextResponse.json({ error: 'Invalid Canvas URL' }, { status: 400 });
  }

  let data: Awaited<ReturnType<typeof fetchCanvasCourse>>;
  try {
    data = await fetchCanvasCourse(canvasBaseUrl, courseId, canvasToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('401')) return NextResponse.json({ error: 'Canvas API token is invalid or expired. Generate a new token in Canvas → Profile → Settings → Approved Integrations.' }, { status: 422 });
    if (msg.includes('404')) return NextResponse.json({ error: 'Canvas course not found. Check the URL and make sure you have access to that course.' }, { status: 422 });
    return NextResponse.json({ error: `Canvas import failed: ${msg}` }, { status: 502 });
  }

  const ipHash = hashIp(req);

  // Build material rows: only insert if the text is non-empty.
  const toInsert: Array<{ fileName: string; text: string }> = [];

  const syllabusText = htmlToText(data.course.syllabusHtml);
  if (syllabusText) toInsert.push({ fileName: 'Canvas: Syllabus', text: syllabusText });

  if (data.assignments.length > 0) {
    const parts = data.assignments.map(a => {
      const desc = htmlToText(a.descriptionHtml);
      return `## ${a.name}${a.pointsPossible != null ? ` (${a.pointsPossible} pts)` : ''}\n${desc}`;
    });
    const assignmentsText = parts.join('\n\n');
    if (assignmentsText.trim()) toInsert.push({ fileName: 'Canvas: Assignments', text: assignmentsText });
  }

  if (data.modules.length > 0) {
    const parts = data.modules.map(m => {
      const items = m.items.map(i => `  - ${i.title} (${i.type})`).join('\n');
      return `## ${m.name}\n${items}`;
    });
    const modulesText = parts.join('\n\n');
    if (modulesText.trim()) toInsert.push({ fileName: 'Canvas: Module List', text: modulesText });
  }

  const imported: Array<{ id: string; fileName: string }> = [];
  for (const { fileName, text } of toInsert) {
    const mat = await insertMaterial({
      courseCode: code,
      fileName,
      blobUrl: canvasUrl,
      mimeType: 'text/html',
      sizeBytes: text.length,
      ipHash,
    });
    await updateExtractionResult({
      id: mat.id,
      extractionStatus: 'ok',
      extractionMethod: 'text',
      extractedText: text,
    });
    imported.push({ id: mat.id, fileName });
  }

  return NextResponse.json({ imported: imported.length, materials: imported });
}
```

- [ ] **Step 3: Run the tests and verify all pass**

Run: `pnpm vitest run app/api/courses/\\[code\\]/canvas-import`  
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add app/api/courses/[code]/canvas-import/route.ts "app/api/courses/[code]/canvas-import/__tests__/route.test.ts"
git commit -m "feat(canvas): add Canvas import API route"
```

---

### Task 5: CanvasImportZone client component

**Files:**
- Create: `components/CanvasImportZone.tsx`
- Modify: `app/preview/[slug]/courses/[code]/MaterialsZone.tsx`

The `CanvasImportZone` component shows:
- A disclosure section: "Import from Canvas" heading with a caret toggle (collapsed by default)
- When expanded: two inputs (Canvas course URL + API token — password type), an "Import" button, status area
- On success: shows "Imported N items" and calls `onImported(materials)` to add them to the parent list
- On error: shows the error message in red
- A short "where to find your Canvas token" hint: "Generate a token in Canvas → Profile → Settings → Approved Integrations."

The component calls `POST /api/courses/:code/canvas-import` with `{ slug, canvasUrl, canvasToken }`.

The response is `{ imported: number, materials: Array<{ id: string; fileName: string }> }`. For each material, call `onImported` with an `UploadedMaterial` shape: `{ id, fileName, blobUrl: canvasUrl, extractionStatus: 'ok', extractionMethod: 'text' }`.

- [ ] **Step 1: Create CanvasImportZone**

Create `components/CanvasImportZone.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { UploadedMaterial } from '@/app/preview/[slug]/courses/[code]/UploadZone';

interface Props {
  courseCode: string;
  slug: string;
  onImported: (material: UploadedMaterial) => void;
}

export function CanvasImportZone({ courseCode, slug, onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState('');
  const [canvasToken, setCanvasToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleImport() {
    setStatus('importing');
    setMessage('');
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseCode)}/canvas-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, canvasUrl: canvasUrl.trim(), canvasToken: canvasToken.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus('error');
        setMessage((json as { error?: string }).error ?? `Import failed (${res.status})`);
        return;
      }
      const data = json as { imported: number; materials: Array<{ id: string; fileName: string }> };
      for (const m of data.materials) {
        onImported({
          id: m.id,
          fileName: m.fileName,
          blobUrl: canvasUrl.trim(),
          extractionStatus: 'ok',
          extractionMethod: 'text',
        });
      }
      setStatus('done');
      setMessage(`Imported ${data.imported} item${data.imported !== 1 ? 's' : ''} from Canvas.`);
      setCanvasToken('');
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Import failed');
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10 px-4 py-3 space-y-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <span>Import from Canvas</span>
        <span className="text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="canvas-url">Canvas course URL</label>
            <input
              id="canvas-url"
              type="url"
              value={canvasUrl}
              onChange={e => setCanvasUrl(e.target.value)}
              placeholder="https://clemson.instructure.com/courses/12345"
              className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="canvas-token">
              API token{' '}
              <span className="text-muted-foreground/70 font-normal">
                — Canvas → Profile → Settings → Approved Integrations → New Access Token
              </span>
            </label>
            <input
              id="canvas-token"
              type="password"
              value={canvasToken}
              onChange={e => setCanvasToken(e.target.value)}
              placeholder="Your Canvas access token"
              className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <button
            type="button"
            onClick={handleImport}
            disabled={!canvasUrl || !canvasToken || status === 'importing'}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'importing' ? 'Importing…' : 'Import from Canvas'}
          </button>
          {status === 'done' && (
            <p className="text-sm text-green-700">{message}</p>
          )}
          {status === 'error' && (
            <p className="text-sm text-destructive">{message}</p>
          )}
          <p className="text-xs text-muted-foreground leading-relaxed">
            The token is used only during this request and is never stored. It fetches your course syllabus, assignments, and module list, then stores the extracted text for AI analysis.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire CanvasImportZone into MaterialsZone**

In `app/preview/[slug]/courses/[code]/MaterialsZone.tsx`, import and add `CanvasImportZone` below the `UploadZone`:

```tsx
'use client';

import { useState } from 'react';
import { UploadZone, type UploadedMaterial } from './UploadZone';
import { MaterialsList } from './MaterialsList';
import { CanvasImportZone } from '@/components/CanvasImportZone';

interface Props {
  courseCode: string;
  slug: string;
  initialMaterials: UploadedMaterial[];
}

export function MaterialsZone({ courseCode, slug, initialMaterials }: Props) {
  const [materials, setMaterials] = useState<UploadedMaterial[]>(initialMaterials);
  const [deleting, setDeleting] = useState<string | null>(null);

  function handleUploaded(material: UploadedMaterial) {
    setMaterials((prev) => [...prev, material]);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/materials/${id}?slug=${encodeURIComponent(slug)}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        setMaterials((prev) => prev.filter((m) => m.id !== id));
      }
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <UploadZone courseCode={courseCode} slug={slug} onUploaded={handleUploaded} />
      <CanvasImportZone courseCode={courseCode} slug={slug} onImported={handleUploaded} />
      <MaterialsList
        courseCode={courseCode}
        slug={slug}
        materials={materials}
        onDelete={handleDelete}
        deleting={deleting}
      />
    </>
  );
}
```

- [ ] **Step 3: Build check — verify TypeScript compiles**

Run: `pnpm tsc --noEmit`  
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/CanvasImportZone.tsx "app/preview/[slug]/courses/[code]/MaterialsZone.tsx"
git commit -m "feat(canvas): add Canvas import UI to Course Builder materials tab"
```

---

### Task 6: Full test run and verification

- [ ] **Step 1: Run the full test suite**

Run: `pnpm vitest run`  
Expected: all tests pass

- [ ] **Step 2: Build**

Run: `pnpm build`  
Expected: clean build with no type errors

- [ ] **Step 3: Smoke test in dev**

Run: `pnpm dev`

Navigate to `/preview/<your-slug>/courses/<any-course>`, click the Materials tab, and expand "Import from Canvas". Confirm:
- Inputs render correctly
- Submit with a blank URL → button stays disabled (inputs required)
- Submit with a bad URL → expect 400 error message
- Submit with a valid Canvas URL + token → materials appear in the list with "Extracted" badge

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix(canvas): address smoke test issues"
```
