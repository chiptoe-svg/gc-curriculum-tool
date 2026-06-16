# Background Material Ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the slow material-indexing stage off the HTTP request path into a concurrency-bounded in-process worker that drains a Postgres-backed queue (the `course_materials` row), so uploads/imports return immediately and a burst never saturates the box.

**Architecture:** The material row is the job (new `indexing_status='queued'`). Each ingest route stores/fetches + inserts the row as `queued` + `enqueue(id)` + returns fast. An in-process worker singleton claims `queued` rows atomically (`FOR UPDATE SKIP LOCKED`), runs extract-if-needed → `finalizeExtraction`, marks `ready|failed`, capped at `MAX_CONCURRENCY=2`. Boot-recovery re-queues rows left `indexing` after a restart. Upload-first: prove on the `materials` POST (Phase A), then convert the other six paths (Phase B).

**Tech Stack:** TypeScript strict, Next.js 15 App Router, Drizzle + Postgres 17, Vitest. No migration (free-text status column). No new external dependencies.

**Spec:** `docs/superpowers/specs/2026-06-16-background-ingest-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `lib/db/course-materials-queries.ts` | Add `'queued'` to the `updateIndexingStatus` status union; add `claimNextQueued()` (atomic claim) + `resetStuckIndexing()` (boot recovery) |
| `lib/db/schema.ts` | Comment-only: add `queued` to the `indexing_status` value list |
| `lib/capture/ingest-queue.ts` | **New.** `enqueue`, `ensureWorker`, the worker loop + concurrency cap, `recoverStuck`, `processMaterial` |
| `app/api/courses/[code]/materials/route.ts` | Phase A: POST enqueues + returns `queued` (drop synchronous extract/finalize) |
| `app/capture/[code]/MaterialsPanel.tsx` + status chip component | Render `queued`; keep polling; "Index now" re-queues; upload shows a background message |
| `app/api/courses/[code]/{canvas-import,scan-linked-docs,imscc-import,canvas-reextract,materials/compress}/route.ts`, `app/api/admin/v2-backfill/route.ts` | Phase B: enqueue instead of awaiting `finalizeExtraction` |

---

## Task 1: DB layer — `queued` status, atomic claim, boot recovery

**Files:**
- Modify: `lib/db/course-materials-queries.ts:210` (`updateIndexingStatus` union) + add two functions
- Modify: `lib/db/schema.ts:273` (comment)
- Test: `tests/lib/db/ingest-queue-queries.test.ts` (new, real-DB)

- [ ] **Step 1: Add `'queued'` to the status union + schema comment**

In `lib/db/course-materials-queries.ts`, change the `updateIndexingStatus` signature:

```ts
export async function updateIndexingStatus(args: {
  id: string;
  status: 'pending' | 'queued' | 'indexing' | 'ready' | 'failed' | 'skipped';
  indexedAt?: Date;
}): Promise<void> {
```

In `lib/db/schema.ts`, update the comment on the `indexingStatus` column (around line 273):

```ts
  // Indexing pipeline status: 'pending' | 'queued' | 'indexing' | 'ready' | 'failed' | 'skipped'.
  // 'queued' = enqueued for the background ingest worker; 'pending' = inserted but not yet enqueued.
  indexingStatus: text('indexing_status').notNull().default('pending'),
```

- [ ] **Step 2: Write the failing real-DB test for claim + recovery**

Create `tests/lib/db/ingest-queue-queries.test.ts`:

```ts
// Real-DB test: requires DATABASE_URL. Skips (not fails) when unset.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { courses, courseMaterials } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { insertMaterial, updateIndexingStatus } from '@/lib/db/course-materials-queries';
import { claimNextQueued, resetStuckIndexing } from '@/lib/db/course-materials-queries';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const CODE = 'ZZ 9200';

async function seed(status: 'queued' | 'indexing'): Promise<string> {
  const row = await insertMaterial({
    courseCode: CODE, fileName: 'f.pdf', blobUrl: '/api/storage/materials/zz-9200/f.pdf',
    mimeType: 'application/pdf', sizeBytes: 10, ipHash: 'h',
  });
  await updateIndexingStatus({ id: row.id, status });
  return row.id;
}

describe.skipIf(!HAS_DB)('ingest queue queries', () => {
  beforeAll(async () => {
    await db.insert(courses).values({ code: CODE, title: 'Queue test', level: 9000, track: 'test' } as never).onConflictDoNothing();
  });
  afterAll(async () => {
    await db.delete(courseMaterials).where(eq(courseMaterials.courseCode, CODE));
    await db.delete(courses).where(eq(courses.code, CODE));
  });
  beforeEach(async () => {
    await db.delete(courseMaterials).where(eq(courseMaterials.courseCode, CODE));
  });

  it('claimNextQueued returns one queued row and flips it to indexing', async () => {
    const id = await seed('queued');
    const claimed = await claimNextQueued();
    expect(claimed?.id).toBe(id);
    expect(claimed?.indexingStatus).toBe('indexing');
    // A second claim finds nothing left queued.
    expect(await claimNextQueued()).toBeNull();
  });

  it('two concurrent claims never return the same row', async () => {
    await seed('queued');
    await seed('queued');
    const [a, b] = await Promise.all([claimNextQueued(), claimNextQueued()]);
    expect(a?.id).toBeTruthy();
    expect(b?.id).toBeTruthy();
    expect(a!.id).not.toBe(b!.id);
  });

  it('resetStuckIndexing re-queues rows left indexing', async () => {
    const id = await seed('indexing');
    const n = await resetStuckIndexing();
    expect(n).toBeGreaterThanOrEqual(1);
    const claimed = await claimNextQueued();
    expect(claimed?.id).toBe(id);
  });
});
```

- [ ] **Step 3: Run to confirm it fails**

Run: `DATABASE_URL=$DATABASE_URL pnpm vitest run tests/lib/db/ingest-queue-queries.test.ts`
Expected: FAIL — `claimNextQueued`/`resetStuckIndexing` not exported. (If `DATABASE_URL` is unset the suite skips — set it to the local dev DB to actually exercise this task.)

- [ ] **Step 4: Implement `claimNextQueued` + `resetStuckIndexing`**

Add to `lib/db/course-materials-queries.ts` (use the raw SQL escape hatch; Drizzle's `db.execute(sql\`…\`)` returns `{ rows }`). Import `sql` from `drizzle-orm` if not already imported, and reuse the existing row-mapping helper if the file has one (otherwise map the snake_case columns explicitly as below):

```ts
import { sql } from 'drizzle-orm';

/**
 * Atomically claim the oldest queued material for the background ingest
 * worker, flipping it to 'indexing' in the same statement so two workers (or
 * two loop ticks) never grab the same row. FOR UPDATE SKIP LOCKED makes
 * concurrent claims pick distinct rows. Returns null when nothing is queued.
 */
export async function claimNextQueued(): Promise<CourseMaterialRow | null> {
  const res = await db.execute(sql`
    UPDATE course_materials SET indexing_status = 'indexing'
    WHERE id = (
      SELECT id FROM course_materials
      WHERE indexing_status = 'queued'
      ORDER BY uploaded_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `);
  const row = (res.rows as Record<string, unknown>[])[0];
  return row ? mapMaterialRow(row) : null;
}

/**
 * Boot recovery: a row left 'indexing' can only be a crash/restart remnant
 * (a live worker always moves it to ready/failed). Re-queue them so the
 * worker resumes. Returns the count re-queued.
 */
export async function resetStuckIndexing(): Promise<number> {
  const res = await db.execute(sql`
    UPDATE course_materials SET indexing_status = 'queued'
    WHERE indexing_status = 'indexing';
  `);
  return res.rowCount ?? 0;
}
```

If the file has no `mapMaterialRow` helper, reuse the same column mapping `getMaterialById` uses (read `lib/db/course-materials-queries.ts:56` and factor its row→`CourseMaterialRow` mapping into a `mapMaterialRow(row)` function, then call it from both `getMaterialById` and `claimNextQueued`).

- [ ] **Step 5: Run to confirm pass**

Run: `DATABASE_URL=$DATABASE_URL pnpm vitest run tests/lib/db/ingest-queue-queries.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/db/course-materials-queries.ts lib/db/schema.ts tests/lib/db/ingest-queue-queries.test.ts
git commit -m "feat(ingest): queued status + atomic claimNextQueued + resetStuckIndexing"
```

---

## Task 2: `processMaterial` — per-job orchestration

**Files:**
- Create: `lib/capture/ingest-queue.ts` (this task adds only `processMaterial`)
- Test: `tests/lib/capture/ingest-queue-process.test.ts` (new)

- [ ] **Step 1: Write the failing test (both branches)**

Create `tests/lib/capture/ingest-queue-process.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const readLocal = vi.fn();
const keyFromLocalUrl = vi.fn((u: string) => u.replace('/api/storage/materials/', ''));
const extractText = vi.fn();
const finalizeExtraction = vi.fn();
const updateIndexingStatus = vi.fn();
const createVectorStore = vi.fn(() => ({ tag: 'vs' }));

vi.mock('@/lib/storage/local-storage', () => ({ readLocal, keyFromLocalUrl }));
vi.mock('@/lib/courses/extract-text', () => ({ extractText }));
vi.mock('@/lib/capture/finalize-extraction', () => ({ finalizeExtraction }));
vi.mock('@/lib/capture/vector-store', () => ({ createVectorStore, tenantForCourse: (c: string) => c }));
vi.mock('@/lib/db/course-materials-queries', () => ({ updateIndexingStatus }));

import { processMaterial } from '@/lib/capture/ingest-queue';

const baseRow = {
  id: 'm1', courseCode: 'GC 2400', fileName: 'f.pdf',
  blobUrl: '/api/storage/materials/gc-2400/f.pdf', mimeType: 'application/pdf',
  extractedText: null, extractionStatus: 'pending',
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  readLocal.mockResolvedValue(Buffer.from('%PDF-1.7'));
  extractText.mockResolvedValue({ status: 'ok', method: 'text', text: 'body', pageCount: 3 });
  finalizeExtraction.mockResolvedValue(undefined);
});

describe('processMaterial', () => {
  it('file-backed row: reads blob, extracts, then finalizes with the extracted text', async () => {
    await processMaterial(baseRow);
    expect(readLocal).toHaveBeenCalledWith('gc-2400/f.pdf');
    expect(extractText).toHaveBeenCalledOnce();
    expect(finalizeExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', extractedText: 'body', extractionStatus: 'ok' }),
    );
  });

  it('text-backed row: skips extraction and finalizes directly', async () => {
    await processMaterial({ ...baseRow, extractedText: 'already here', extractionStatus: 'ok' } as never);
    expect(extractText).not.toHaveBeenCalled();
    expect(finalizeExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', extractedText: 'already here' }),
    );
  });

  it('marks failed when the blob is missing', async () => {
    readLocal.mockResolvedValue(null);
    await processMaterial(baseRow);
    expect(extractText).not.toHaveBeenCalled();
    expect(finalizeExtraction).not.toHaveBeenCalled();
    expect(updateIndexingStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', status: 'failed' }));
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm vitest run tests/lib/capture/ingest-queue-process.test.ts`
Expected: FAIL — module `@/lib/capture/ingest-queue` not found.

- [ ] **Step 3: Implement `processMaterial`**

Create `lib/capture/ingest-queue.ts`:

```ts
import { readLocal, keyFromLocalUrl } from '@/lib/storage/local-storage';
import { extractText, type ExtractedMimeType } from '@/lib/courses/extract-text';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createVectorStore } from '@/lib/capture/vector-store';
import { updateIndexingStatus } from '@/lib/db/course-materials-queries';
import type { CourseMaterialRow } from '@/lib/db/course-materials-queries';

/**
 * Run one queued material to completion. File-backed rows (a stored blob, no
 * extracted text yet) are extracted from disk first; text-backed rows (Canvas
 * / Drive imports that already carried their text) skip straight to
 * finalizeExtraction. Marks 'failed' on any unrecoverable error so a single
 * bad material never wedges the queue.
 */
export async function processMaterial(row: CourseMaterialRow): Promise<void> {
  try {
    let extractedText = row.extractedText ?? undefined;
    let extractionStatus = row.extractionStatus as 'pending' | 'ok' | 'low_text' | 'failed';
    let extractionMethod: string | undefined;
    let pageCount: number | undefined;

    if (!extractedText) {
      const key = keyFromLocalUrl(row.blobUrl);
      const bytes = key ? await readLocal(key) : null;
      if (!bytes) {
        console.error(`[ingest] ${row.courseCode} "${row.fileName}": blob missing (${row.blobUrl})`);
        await updateIndexingStatus({ id: row.id, status: 'failed' });
        return;
      }
      const ex = await extractText({ fileBytes: bytes, mimeType: row.mimeType as ExtractedMimeType, fileName: row.fileName });
      extractedText = ex.text;
      extractionStatus = ex.status;
      extractionMethod = ex.method;
      pageCount = ex.pageCount;
    }

    await finalizeExtraction({
      id: row.id,
      courseCode: row.courseCode,
      fileName: row.fileName,
      extractionStatus,
      ...(extractionMethod !== undefined && { extractionMethod: extractionMethod as never }),
      ...(extractedText !== undefined && { extractedText }),
      ...(pageCount !== undefined && { pageCount }),
      vectorStore: createVectorStore(),
    });
    // finalizeExtraction sets ready/failed/skipped itself; nothing more to do.
  } catch (err) {
    console.error(`[ingest] ${row.courseCode} "${row.fileName}": processMaterial failed`, err);
    await updateIndexingStatus({ id: row.id, status: 'failed' });
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm vitest run tests/lib/capture/ingest-queue-process.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/capture/ingest-queue.ts tests/lib/capture/ingest-queue-process.test.ts
git commit -m "feat(ingest): processMaterial — extract-if-needed then finalize, fail-safe"
```

---

## Task 3: Worker loop + enqueue + boot recovery + concurrency cap

**Files:**
- Modify: `lib/capture/ingest-queue.ts` (add `enqueue`, `ensureWorker`, loop, `recoverStuck`)
- Test: `tests/lib/capture/ingest-queue-worker.test.ts` (new)

- [ ] **Step 1: Write the failing worker test**

Create `tests/lib/capture/ingest-queue-worker.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimNextQueued = vi.fn();
const resetStuckIndexing = vi.fn();
const updateIndexingStatus = vi.fn();
const processMaterial = vi.fn();

vi.mock('@/lib/db/course-materials-queries', () => ({ claimNextQueued, resetStuckIndexing, updateIndexingStatus }));
// processMaterial lives in the same module; spy on it via the module mock partial.
vi.mock('@/lib/capture/ingest-queue', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/capture/ingest-queue')>();
  return { ...mod, processMaterial: (...a: unknown[]) => processMaterial(...a) };
});

import { enqueue, __resetWorkerForTest } from '@/lib/capture/ingest-queue';

const row = (id: string) => ({ id, courseCode: 'GC 2400', fileName: `${id}.pdf`, blobUrl: `/x/${id}`, extractedText: 't', extractionStatus: 'ok' });

beforeEach(() => {
  vi.clearAllMocks();
  __resetWorkerForTest();
  resetStuckIndexing.mockResolvedValue(0);
  processMaterial.mockResolvedValue(undefined);
});

describe('ingest worker', () => {
  it('runs boot recovery once before draining', async () => {
    claimNextQueued.mockResolvedValue(null);
    await enqueue('m1');
    await vi.waitFor(() => expect(resetStuckIndexing).toHaveBeenCalledTimes(1));
  });

  it('drains all queued rows then idles', async () => {
    claimNextQueued
      .mockResolvedValueOnce(row('a'))
      .mockResolvedValueOnce(row('b'))
      .mockResolvedValue(null);
    await enqueue('a');
    await vi.waitFor(() => expect(processMaterial).toHaveBeenCalledTimes(2));
  });

  it('never exceeds MAX_CONCURRENCY in flight', async () => {
    let inFlight = 0; let maxSeen = 0;
    processMaterial.mockImplementation(async () => {
      inFlight++; maxSeen = Math.max(maxSeen, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
    });
    const rows = ['a', 'b', 'c', 'd', 'e'].map(row);
    let i = 0;
    claimNextQueued.mockImplementation(async () => rows[i++] ?? null);
    await enqueue('a');
    await vi.waitFor(() => expect(processMaterial).toHaveBeenCalledTimes(5));
    expect(maxSeen).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm vitest run tests/lib/capture/ingest-queue-worker.test.ts`
Expected: FAIL — `enqueue`/`__resetWorkerForTest` not exported.

- [ ] **Step 3: Implement the worker**

Add to `lib/capture/ingest-queue.ts` (above or below `processMaterial`):

```ts
import { claimNextQueued, resetStuckIndexing } from '@/lib/db/course-materials-queries';

const MAX_CONCURRENCY = 2;

let workerRunning = false;
let recovered = false;
let inFlight = 0;

/** Test seam — reset module state between tests. */
export function __resetWorkerForTest(): void {
  workerRunning = false;
  recovered = false;
  inFlight = 0;
}

/** Mark a material queued and make sure the worker is draining. Idempotent. */
export async function enqueue(materialId: string): Promise<void> {
  await updateIndexingStatus({ id: materialId, status: 'queued' });
  ensureWorker();
}

/** Start the drain loop if it isn't already running. */
export function ensureWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  void drainLoop();
}

async function drainLoop(): Promise<void> {
  try {
    if (!recovered) {
      recovered = true;
      const n = await resetStuckIndexing();
      if (n > 0) console.log(`[ingest] boot recovery re-queued ${n} stuck material(s)`);
    }
    // Keep claiming while there is capacity and work remains.
    while (true) {
      if (inFlight >= MAX_CONCURRENCY) {
        await new Promise(r => setTimeout(r, 25));
        continue;
      }
      const row = await claimNextQueued();
      if (!row) {
        if (inFlight > 0) { await new Promise(r => setTimeout(r, 25)); continue; }
        break; // queue empty and nothing in flight → idle
      }
      inFlight++;
      void processMaterial(row).finally(() => { inFlight--; });
    }
  } finally {
    workerRunning = false;
  }
}
```

(Move the existing `updateIndexingStatus` import into the shared import block; ensure `claimNextQueued`/`resetStuckIndexing` are imported from `@/lib/db/course-materials-queries`.)

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm vitest run tests/lib/capture/ingest-queue-worker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/capture/ingest-queue.ts tests/lib/capture/ingest-queue-worker.test.ts
git commit -m "feat(ingest): in-process worker — enqueue, drain loop, concurrency cap, boot recovery"
```

---

## Task 4: Phase A — `materials` POST enqueues and returns fast

**Files:**
- Modify: `app/api/courses/[code]/materials/route.ts:155-195` (POST tail)
- Test: `tests/api/course-materials.test.ts` (update POST expectations)

- [ ] **Step 1: Update the route's POST to enqueue instead of extracting inline**

In `app/api/courses/[code]/materials/route.ts`, replace the block from `const fileBytes = Buffer.from(await file.arrayBuffer());` through the final `return NextResponse.json({...})` with:

```ts
  // Store on local disk; we do NOT extract/index on the request path — that
  // happens in the background ingest worker so the upload returns immediately
  // and a burst doesn't saturate the box (see lib/capture/ingest-queue.ts).
  const fileBytes = Buffer.from(await file.arrayBuffer());
  const storageKey = `${courseSlug(code)}/${Date.now()}-${safeFilename(file.name)}`;
  let stored;
  try {
    stored = await putLocal({ key: storageKey, bytes: fileBytes });
  } catch (err) {
    console.error('local storage write failed', err);
    return NextResponse.json({ error: 'failed to store uploaded file on disk' }, { status: 503 });
  }

  const material = await insertMaterial({
    courseCode: code,
    fileName: file.name,
    blobUrl: stored.url,
    mimeType: file.type,
    sizeBytes: file.size,
    ipHash,
  });

  await enqueue(material.id);

  return NextResponse.json({
    id: material.id,
    fileName: material.fileName,
    blobUrl: material.blobUrl,
    indexingStatus: 'queued',
  });
```

Add the import at the top: `import { enqueue } from '@/lib/capture/ingest-queue';`. Remove the now-unused imports if they become unused (`extractText`, `finalizeExtraction`, `createVectorStore`, `checkDailyCap`, `recordSpend`, `tenantForCourse`) — verify with `pnpm exec tsc --noEmit` and delete only those no longer referenced. (The DELETE handler still uses `createVectorStore`/`tenantForCourse`, so keep those.)

- [ ] **Step 2: Update the existing POST tests**

In `tests/api/course-materials.test.ts`, the happy-path test now asserts the queued contract. Replace the test body of `'stores locally, inserts row, runs extraction, returns 200 with status'` with:

```ts
  it('stores locally, inserts row, enqueues, returns 200 with queued status', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    // (enqueue is mocked at module level — see the vi.mock addition below)
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('mat-1');
    expect(json.indexingStatus).toBe('queued');
    expect(putLocal).toHaveBeenCalledOnce();
    expect(insertMaterial).toHaveBeenCalledOnce();
    expect(extractText).not.toHaveBeenCalled(); // extraction moved to the worker
  });
```

Add an `enqueue` mock to the file's mock block (near the other `vi.mock`s):

```ts
vi.mock('@/lib/capture/ingest-queue', () => ({ enqueue: vi.fn().mockResolvedValue(undefined) }));
```

Delete the now-obsolete tests `'records vision spend when extraction uses vision'` and `'returns extractionStatus=failed without throwing when extraction fails'` (extraction no longer runs on the request path — those behaviors are covered by `processMaterial`/`finalizeExtraction` tests). Keep the 401/404/429/400 tests and the two Basic-Auth tests unchanged.

- [ ] **Step 3: Run the route tests**

Run: `pnpm vitest run tests/api/course-materials.test.ts`
Expected: PASS. If `extractText` mock now reports "never called" mismatches in deleted tests, ensure those tests were removed.

- [ ] **Step 4: Typecheck (catch unused imports)**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -i materials/route`
Expected: no output. Remove any flagged unused imports.

- [ ] **Step 5: Commit**

```bash
git add "app/api/courses/[code]/materials/route.ts" tests/api/course-materials.test.ts
git commit -m "feat(ingest): materials POST enqueues + returns queued (Phase A)"
```

---

## Task 5: UI — surface `queued`, keep polling, re-queue on "Index now"

**Files:**
- Modify: `app/capture/[code]/MaterialsPanel.tsx` (status rendering, poll condition, "Index now" handler, upload success message)
- Test: existing component tests if present; otherwise manual verification steps below

- [ ] **Step 1: Render `queued` and include it in the "still working" set**

In `app/capture/[code]/MaterialsPanel.tsx`, find where `indexingStatus` is mapped to a label/chip (search for `'indexing'` / `'ready'` / `'failed'`). Add a `queued` case rendering "Queued — indexing in background" with the same visual family as `indexing` (amber/spinner). Wherever the panel decides whether to keep polling (a predicate like `materials.some(m => m.indexingStatus === 'indexing')`), include `'queued'`:

```ts
const stillWorking = (m: { indexingStatus: string }) =>
  m.indexingStatus === 'queued' || m.indexingStatus === 'indexing';
// ...keep polling while materials.some(stillWorking)
```

- [ ] **Step 2: "Index now" re-queues; upload shows a background message**

Point the "Index now" action at the enqueue path (it should POST to whatever admin/material re-index endpoint exists; if it currently triggers a synchronous re-index, change it to call the route that now enqueues). On a successful upload POST, show a transient inline message: `"Uploaded — indexing in the background. You can keep working; the status updates here when it's ready."` instead of waiting on extraction.

- [ ] **Step 3: Manual verification**

Run the dev server, upload a PDF on `/capture/<code>`, and confirm: the row appears immediately as "Queued — indexing in background", the panel keeps polling, and it flips to "Ready" when the worker finishes (watch `[ingest]` logs). Confirm the upload control is usable again right away (not blocked).

- [ ] **Step 4: Commit**

```bash
git add "app/capture/[code]/MaterialsPanel.tsx"
git commit -m "feat(ingest): surface queued status + background-upload message in MaterialsPanel"
```

---

## Task 6: Phase B — convert the other six ingest paths

**Files (modify each route's `finalizeExtraction` call site to enqueue):**
- `app/api/courses/[code]/canvas-import/route.ts`
- `app/api/courses/[code]/scan-linked-docs/route.ts`
- `app/api/courses/[code]/imscc-import/route.ts`
- `app/api/courses/[code]/canvas-reextract/route.ts`
- `app/api/courses/[code]/materials/compress/route.ts`
- `app/api/admin/v2-backfill/route.ts`

**Conversion recipe (apply to each):** each route currently does, per material, `await finalizeExtraction({ id, courseCode, fileName, extractionStatus, extractedText, ... , vectorStore })`. These routes already have the extracted text in hand (they fetched/parsed it) and the row inserted. Replace the `await finalizeExtraction(...)` call with `await enqueue(materialId)` and let the worker finalize from the row's persisted `extractedText`. Ensure the route **persists `extractedText` + `extractionStatus='ok'` on the row before enqueueing** (most already insert the row with text via `insertMaterial`; if a route inserts the row WITHOUT text and relied on passing text straight to `finalizeExtraction`, add an `updateExtractionResult({ id, extractionStatus:'ok', extractedText })` before `enqueue`). Import `enqueue` from `@/lib/capture/ingest-queue`. Update each route's summary response wording from "indexed" to "queued for indexing".

- [ ] **Step 1: canvas-import** — replace the per-file `await finalizeExtraction(...)` with persist-text-then-`enqueue(id)`; change the response summary counts to "queued". Run `pnpm vitest run` for any canvas-import test and update assertions that expected synchronous `ready`.

- [ ] **Step 2: scan-linked-docs** — same; the Drive-PDF rows already insert with `extractedText` (`fetched.text`). Replace `finalizeExtraction` with `enqueue(row.id)`.

- [ ] **Step 3: imscc-import** — same; persist text then `enqueue`.

- [ ] **Step 4: canvas-reextract** — same.

- [ ] **Step 5: materials/compress** — same.

- [ ] **Step 6: admin/v2-backfill** — this route batch-runs finalize over many materials; convert it to `enqueue` each material id (it becomes "queue a backfill" — returns immediately, worker drains). This is the route that previously ran 104s synchronously.

- [ ] **Step 7: Typecheck + full suite**

Run: `pnpm exec tsc --noEmit -p tsconfig.json` then `pnpm vitest run`
Expected: clean typecheck; all tests pass (update any route test that asserted synchronous indexing completion to assert `queued`).

- [ ] **Step 8: Commit**

```bash
git add "app/api/courses/[code]/canvas-import/route.ts" "app/api/courses/[code]/scan-linked-docs/route.ts" "app/api/courses/[code]/imscc-import/route.ts" "app/api/courses/[code]/canvas-reextract/route.ts" "app/api/courses/[code]/materials/compress/route.ts" "app/api/admin/v2-backfill/route.ts"
git commit -m "feat(ingest): convert canvas-import/scan/imscc/reextract/compress/v2-backfill to enqueue (Phase B)"
```

---

## Task 7: STATE.md + docs

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Update STATE.md**

Add to the Active arc / Recently shipped: background material ingest (queued status, in-process worker, all ingest paths enqueue, upload-first). Note the new `queued` value on `indexing_status`, the new module `lib/capture/ingest-queue.ts`, and the changed route response contracts (uploads/imports now return `indexingStatus: 'queued'`). Add to **Deferred / debt**: the in-process worker dies on web-server restart (boot-recovery re-queues; a dedicated launchd worker + the dev→prod-mode switch are the robust follow-ups), and `MAX_CONCURRENCY=2` is an untuned starting point.

- [ ] **Step 2: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): background ingest shipped — queued worker, all paths enqueue"
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `queued` status added (no migration) | Task 1 |
| Atomic claim (`FOR UPDATE SKIP LOCKED`) | Task 1 (`claimNextQueued`) |
| Boot recovery re-queues stuck `indexing` | Task 1 (`resetStuckIndexing`) + Task 3 (runs once) |
| Worker reconstructs inputs: file-backed vs text-backed | Task 2 (`processMaterial`) |
| In-process worker, lazy-start, idle when drained | Task 3 |
| `MAX_CONCURRENCY=2` bounded concurrency | Task 3 |
| Fail-safe (one bad material doesn't wedge the queue) | Task 2 + Task 3 |
| Phase A: `materials` POST enqueues + returns `queued` | Task 4 |
| Status surfacing + polling + re-queue + upload message | Task 5 |
| Phase B: all six other paths enqueue | Task 6 |
| Dev-mode caveat / debt recorded | Task 7 |

**Placeholder scan:** No TBD/TODO; all code shown. The one judgement call ("factor out `mapMaterialRow` if absent") references reading a specific existing function (`getMaterialById`, line 56) and tells the engineer exactly what to reuse.

**Type consistency:** `enqueue(materialId: string)`, `claimNextQueued(): Promise<CourseMaterialRow | null>`, `resetStuckIndexing(): Promise<number>`, `processMaterial(row: CourseMaterialRow)`, `__resetWorkerForTest()` are used consistently across Tasks 1–6. `indexingStatus` value `'queued'` matches the schema-comment and the `updateIndexingStatus` union. The route returns `indexingStatus: 'queued'` matching what the UI (Task 5) reads.
