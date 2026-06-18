# Tiered Ingestion — Increment 1: Phase-1 List Mode + Manifest

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Canvas import *discovery-only* behind a flag — it lists candidate materials (a manifest) without the expensive Docling extraction / chunk / contextualize / embed work, so faculty can prune before any cost is spent. This is increment 1 of the [tiered-ingestion-triage spec](../specs/2026-06-18-tiered-ingestion-triage-design.md).

**Architecture:** A new `COURSECAPTURE_TRIAGE` flag selects between today's path (extract + enqueue inline, unchanged) and the new list-mode. In list-mode the import still fetches the course and **downloads** Canvas file attachments (it has the token only during the request) and stores their bytes, but inserts every row as `indexing_status='pending'` with **no extraction and no enqueue** — text-backed for HTML-derived items (cheap `htmlToText`), blob-backed for files. The route returns a **manifest** with a cheap size signal per row (bytes; PDF page count; PPTX slide count) and a `decksPresent` flag for the lecture-slides nudge. Extraction/indexing is deferred to Phase 2 (later increments).

**Tech Stack:** Next.js 15 route handlers, Drizzle/Postgres, Vitest. Existing deps: `unpdf` (PDF page count), `yauzl` (PPTX slide count), local storage (`putLocal`).

---

## File Structure

- Create: `lib/capture/size-probe.ts` — cheap, no-extraction size signals (PDF page count via `unpdf`, PPTX slide count via `yauzl`).
- Create: `lib/capture/triage-flag.ts` — `isTriageEnabled()` reading `COURSECAPTURE_TRIAGE`.
- Modify: `app/api/courses/[code]/canvas-import/route.ts` — branch into `runImport` (today, unchanged) vs `runListImport` (new) on the flag.
- Create: `app/api/courses/[code]/canvas-import/list-import.ts` — the list-mode implementation (keeps the route file readable).
- Test: `tests/lib/capture/size-probe.test.ts`, `tests/lib/capture/triage-flag.test.ts`, `tests/api/canvas-list-import.test.ts`.

No schema migration — list-mode reuses `indexing_status='pending'` (already "inserted, not enqueued") and the existing `ignored` flag. The `tier` column arrives in Increment 3.

---

### Task 1: Triage feature flag

**Files:**
- Create: `lib/capture/triage-flag.ts`
- Test: `tests/lib/capture/triage-flag.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { isTriageEnabled } from '@/lib/capture/triage-flag';

const orig = process.env.COURSECAPTURE_TRIAGE;
afterEach(() => {
  if (orig === undefined) delete process.env.COURSECAPTURE_TRIAGE;
  else process.env.COURSECAPTURE_TRIAGE = orig;
});

describe('isTriageEnabled', () => {
  it('is false by default (flag absent)', () => {
    delete process.env.COURSECAPTURE_TRIAGE;
    expect(isTriageEnabled()).toBe(false);
  });
  it('is true only for "1"', () => {
    process.env.COURSECAPTURE_TRIAGE = '1';
    expect(isTriageEnabled()).toBe(true);
    process.env.COURSECAPTURE_TRIAGE = 'true';
    expect(isTriageEnabled()).toBe(false); // strict: only '1' enables
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — `pnpm exec vitest run tests/lib/capture/triage-flag.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// lib/capture/triage-flag.ts
/** Gate for the two-phase tiered-ingestion flow. Off by default; '1' enables.
 *  Matches the strict-'1' convention of COURSECAPTURE_V2_INGESTION. */
export function isTriageEnabled(): boolean {
  return process.env.COURSECAPTURE_TRIAGE === '1';
}
```

- [ ] **Step 4: Run it, confirm PASS.**

- [ ] **Step 5: Commit** — `git add lib/capture/triage-flag.ts tests/lib/capture/triage-flag.test.ts && git commit -m "feat(triage): COURSECAPTURE_TRIAGE flag"`

---

### Task 2: Cheap size-probe utility

**Files:**
- Create: `lib/capture/size-probe.ts`
- Test: `tests/lib/capture/size-probe.test.ts`

The probe takes file bytes + mime and returns `{ sizeBytes, pageCount?, slideCount? }` **without** extracting text or OCR. PDFs → `unpdf` document page count; PPTX → count `ppt/slides/slideN.xml` entries in the zip via `yauzl`. Anything else → just `sizeBytes`.

- [ ] **Step 1: Write the failing test** (uses tiny real fixtures generated in-test)

```typescript
import { describe, it, expect } from 'vitest';
import { probeSize } from '@/lib/capture/size-probe';

describe('probeSize', () => {
  it('returns sizeBytes for an unknown type with no count', async () => {
    const buf = Buffer.from('hello');
    const r = await probeSize(buf, 'text/plain');
    expect(r.sizeBytes).toBe(5);
    expect(r.pageCount).toBeUndefined();
    expect(r.slideCount).toBeUndefined();
  });

  it('counts PPTX slides from the zip without extraction', async () => {
    // Build a minimal zip with two slide XML entries using yazl (already a dep).
    const yazl = await import('yazl');
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('<p/>'), 'ppt/slides/slide1.xml');
    zip.addBuffer(Buffer.from('<p/>'), 'ppt/slides/slide2.xml');
    zip.addBuffer(Buffer.from('x'), 'ppt/presentation.xml');
    zip.end();
    const chunks: Buffer[] = [];
    const buf: Buffer = await new Promise((res) => {
      zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
      zip.outputStream.on('end', () => res(Buffer.concat(chunks)));
    });
    const r = await probeSize(buf, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(r.slideCount).toBe(2);
  });

  it('never throws on a malformed file — falls back to sizeBytes only', async () => {
    const r = await probeSize(Buffer.from('not a real pdf'), 'application/pdf');
    expect(r.sizeBytes).toBe(14);
    expect(r.pageCount).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement**

```typescript
// lib/capture/size-probe.ts
import yauzl from 'yauzl';

export interface SizeProbe {
  sizeBytes: number;
  pageCount?: number;   // PDFs
  slideCount?: number;  // PPTX
}

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const SLIDE_RE = /^ppt\/slides\/slide\d+\.xml$/;

/** Cheap size signals with NO text extraction / OCR. Best-effort: any probe
 *  failure degrades to sizeBytes-only — this must never throw. */
export async function probeSize(bytes: Buffer, mimeType: string): Promise<SizeProbe> {
  const sizeBytes = bytes.length;
  try {
    if (mimeType === 'application/pdf') {
      const { getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      return { sizeBytes, pageCount: pdf.numPages };
    }
    if (mimeType === PPTX) {
      return { sizeBytes, slideCount: await countPptxSlides(bytes) };
    }
  } catch {
    /* fall through to sizeBytes-only */
  }
  return { sizeBytes };
}

function countPptxSlides(bytes: Buffer): Promise<number> {
  return new Promise((resolve) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return resolve(0);
      let count = 0;
      zip.on('entry', (e) => { if (SLIDE_RE.test(e.fileName)) count++; zip.readEntry(); });
      zip.on('end', () => resolve(count));
      zip.on('error', () => resolve(count));
      zip.readEntry();
    });
  });
}
```

> If `getDocumentProxy` isn't the exact `unpdf` export in this version, the implementer confirms the page-count call against the installed `unpdf` (the extract path already imports from it) — the contract (numeric page count, never throw) is fixed.

- [ ] **Step 4: Run it, confirm PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat(triage): cheap size-probe (pdf pages, pptx slides, no extraction)"`

---

### Task 3: List-mode Canvas import (flag-gated)

**Files:**
- Create: `app/api/courses/[code]/canvas-import/list-import.ts`
- Modify: `app/api/courses/[code]/canvas-import/route.ts:44-59` (branch in `POST`)
- Test: `tests/api/canvas-list-import.test.ts`

List-mode reuses the existing fetch + assemble + file-reference scan, but: (a) for files it **downloads + stores** (`putLocal`) but does **not** call `extractText`; (b) every row is inserted/updated with `indexing_status='pending'` and **no `enqueue`**; (c) the response is a **manifest** (`rows[]` with `{id, fileName, kind, mimeType, sizeBytes, pageCount?, slideCount?}` + `decksPresent`).

- [ ] **Step 1: Write the failing test** (mock Canvas fetch, storage, queue; assert no enqueue, status pending, manifest shape)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/canvas/fetchCanvasCourse', () => ({
  fetchCanvasCourse: vi.fn(async () => ({
    course: { id: '1', name: 'GC X', syllabusHtml: '<p>Syllabus</p>' },
    assignments: [{ id: 'a1', name: 'Project', descriptionHtml: '<p>do</p>', pointsPossible: 100, rubric: [], rubricTitle: null, published: true }],
    modules: [], pages: [], discussions: [], quizzes: [],
  })),
  fetchCanvasFileMeta: vi.fn(),
}));
const enqueue = vi.fn();
vi.mock('@/lib/capture/ingest-queue', () => ({ enqueue }));

import { runListImport } from '@/app/api/courses/[code]/canvas-import/list-import';
import { isValidSlug } from '@/lib/slug';

beforeEach(() => { enqueue.mockReset(); process.env.PROTOTYPE_SLUG = 'testslug'; });

it('lists materials as pending, never enqueues, returns a manifest', async () => {
  const req = new Request('http://x', { method: 'POST', body: JSON.stringify({
    slug: 'testslug', canvasUrl: 'https://clemson.instructure.com/courses/1', canvasToken: 't',
  })});
  const res = await runListImport(req, Promise.resolve({ code: 'GC X' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.manifest.rows.length).toBeGreaterThan(0);
  expect(json.manifest.rows.every((r: { indexingStatus: string }) => r.indexingStatus === 'pending')).toBe(true);
  expect(enqueue).not.toHaveBeenCalled();
  expect(json.manifest).toHaveProperty('decksPresent');
});
```

(Seed a `GC X` course row in the test DB setup, mirroring `tests/api/analyze-materials.test.ts` fixtures.)

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement `runListImport`** — adapt `runImport`: keep auth/parse/fetch/skip-unpublished/assemble; replace step 4's `extractText` with download+`putLocal` (no extract) + `probeSize`; replace the upsert loop's `updateExtractionResult(text)`+`enqueue` with inserting text-backed (HTML) or blob-backed (files) rows at `indexing_status='pending'`, no enqueue; build the manifest. Per-row `kind`: 'syllabus'|'assignments'|'pages'|'discussions'|'quizzes'|'modules'|'file'. `decksPresent` = any file row whose mime is PDF/PPTX with `slideCount`/`pageCount` over a small threshold, OR any `.pptx`/`.key` filename.

```typescript
// list-import.ts (shape — full body adapts runImport)
export async function runListImport(req: Request, params: Promise<{ code: string }>): Promise<Response> {
  // ... identical auth/parse/getCourse/fetchCanvasCourse/skipUnpublished/assembleCanvasMaterials ...
  // For each Canvas file id (<= MAX_FILES_PER_IMPORT):
  //   meta = await fetchCanvasFileMeta(...); if !meta -> record failed; continue
  //   const dl = await fetch(meta.url); const buf = Buffer.from(await dl.arrayBuffer());
  //   const probe = await probeSize(buf, resolvedMime);
  //   const stored = await putLocal({ courseCode: code, fileName: meta.displayName, bytes: buf, mimeType: resolvedMime });
  //   manifestFiles.push({ fileName: `Canvas File: ${meta.displayName}`, mimeType: resolvedMime, blobUrl: stored.url, sizeBytes: buf.length, pageCount: probe.pageCount, slideCount: probe.slideCount, kind: 'file' });
  // For HTML-derived (toInsert): manifestHtml rows carry text, mimeType, sizeBytes=text.length, kind.
  // Upsert each: insertMaterial / update existing -> updateExtractionResult({extractionStatus:'pending'}) for HTML text OR store blobUrl for files; set indexingStatus stays 'pending' (default). DO NOT call enqueue.
  // decksPresent = manifestFiles.some(f => f.slideCount || (f.mimeType==='application/pdf' && (f.pageCount ?? 0) >= 3 && /slide|lecture|deck/i.test(f.fileName)));
  // return manifest { rows: [...], decksPresent }.
}
```

> Note: HTML-derived rows store their text now (cheap) but stay `pending` (not `ready`); their chunk/embed work is deferred to Phase 2. File rows store bytes only (no `extractedText`), `pending`.

- [ ] **Step 4: Branch the route** in `route.ts` `POST`:

```typescript
import { isTriageEnabled } from '@/lib/capture/triage-flag';
import { runListImport } from './list-import';
// inside POST try-block:
return await (isTriageEnabled() ? runListImport(req, params) : runImport(req, params));
```

- [ ] **Step 5: Run the test, confirm PASS; run the existing canvas-import test to confirm the default (flag-off) path is unchanged.**

Run: `pnpm exec vitest run tests/api/canvas-list-import.test.ts tests/api/canvas-import.test.ts` (whichever exists for the legacy path).

- [ ] **Step 6: Commit** — `git commit -m "feat(triage): list-mode canvas import (manifest, no extraction/enqueue) behind COURSECAPTURE_TRIAGE"`

---

### Task 4: Typecheck + full suite + STATE.md

- [ ] **Step 1:** `pnpm exec tsc --noEmit` → clean.
- [ ] **Step 2:** `pnpm exec vitest run tests/lib/capture tests/api` → green.
- [ ] **Step 3:** Update `docs/STATE.md`: add `COURSECAPTURE_TRIAGE` to env vars; note Increment 1 of tiered-ingestion landed (list-mode import behind the flag; default path unchanged); move the spec pointer from "awaiting plan" to "in flight (increment 1 done)".
- [ ] **Step 4: Commit** — `git commit -m "docs(state): tiered-ingestion increment 1 (list-mode) + COURSECAPTURE_TRIAGE env"`

---

## Self-Review notes (for the controller)

- **Spec coverage:** this increment covers the spec's *Phase 1 — Discover & list* (no extraction) and the cheap size-signal; it deliberately does **not** include the triage UI (Increment 2), tier-aware worker (Increment 3), or estimate model (Increment 4). The lecture-slides *nudge data* (`decksPresent`) is produced here; the nudge *UI* is Increment 2.
- **Working software:** flag-off = today's behavior, untouched (existing tests prove it). Flag-on = import lists; verifiable via the manifest response even before the triage UI exists.
- **Type consistency:** manifest row shape `{id, fileName, kind, mimeType, sizeBytes, pageCount?, slideCount?, indexingStatus}` must match what Increment 2's triage page consumes — fix that contract here.
- **No placeholders:** the one soft spot is the exact `unpdf` page-count export; contract is pinned (numeric, never-throw), implementer confirms the call.
