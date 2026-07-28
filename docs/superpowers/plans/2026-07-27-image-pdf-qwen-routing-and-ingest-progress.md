# Image-PDF → qwen routing + ingest ETA/progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route image-heavy PDFs (design slide decks) to the *existing* qwen per-page vision path — skipping the standard Docling pipeline that hard-crashes the Spark GB10 GPU on uncapped renders — and surface an upfront ETA + material-level progress bar so the (slower) qwen ingest is legible.

**Architecture:** The qwen per-page extractor already exists (`LocalProvider.transcribeDocument`: render → `canonicalize` → per-page qwen offload via `twoPhaseOffload` + the `withVisionSlot` weighted gate + local omlx fallback), and `extractText` already invokes it as its *vision fallback* (`extract-text.ts:110-174`). The only bug: that fallback is reachable **only after** `extractor.extract()` (Docling) runs first — and Docling crashes on huge image renders before the fallback is ever reached. Fix = a cheap CPU probe (`pdfinfo` geometry first, `pdftotext` density second) that detects image-heavy PDFs **before** Docling, and routes them straight into the existing vision cascade (forcing the qwen leg). No new extractor. Defense-in-depth caps the standard pipeline's render so a *misroute* degrades to weak OCR instead of crashing. Progress = a poll-able status endpoint over existing `extraction_status`/`indexing_status` + a `pdfinfo`-based ETA.

**Tech Stack:** TypeScript/Next.js, Vitest, poppler (`pdfinfo`/`pdftotext`, on PATH), the existing `LocalProvider.transcribeDocument` / `buildLocalProvider` vision stack, qwen3.6-35b via `VISION_OFFLOAD_*`.

## Global Constraints
- **Reuse, don't reinvent:** the image-heavy route calls the EXISTING vision cascade in `extract-text.ts`; do NOT write a new qwen HTTP client or per-page loop — `transcribeDocument` already owns concurrency, streaming, the weighted `withVisionSlot` gate, and local fallback.
- **Provider for the image route = qwen (Spark), not OpenAI.** The spec locks `VISION_OFFLOAD_MODEL = qwen3.6-35b-a3b`. The existing default vision leg uses `getProvider()` (currently OpenAI); the image-heavy route must force the local-offload leg (`buildLocalProvider()` + `forceOffload: true`), falling back to `getProvider()` only on failure — exactly today's `hardscanLocal` cascade, made unconditional for this route.
- **Detection order:** geometry FIRST (deck-shaped page via `pdfinfo`), density SECOND (`charsPerPage < 100`). Route on OR. Any probe error → route to qwen ("confusion → qwen").
- **No crash reachable:** image-heavy PDFs must never invoke `extractor.extract()`; the standard pipeline's render must also be capped so a *misroute* can't hard-crash.
- Reuse existing constants: `MIN_CHARS_PER_PAGE = 100`, `VISION_PAGE_CAP = 40`, `MIN_MEANINGFUL_CHARS = 10` (all in `extract-text.ts`).
- ETA anchor: **1.25 s/page**; offload concurrency ceiling **6** (shared prod qwen; backfills off-peak).

---

### Task 1: PDF classifier (geometry-first image-heavy detection)

**Files:**
- Create: `lib/courses/pdf-classify.ts`
- Test: `tests/lib/courses/pdf-classify.test.ts`

**Interfaces:**
- Produces: `isDeckGeometry(widthPt: number, heightPt: number): boolean`
- Produces: `pdfPageInfo(bytes: Buffer): Promise<{ pageCount: number; widthPt: number; heightPt: number }>` — first page media box + page count via `pdfinfo`.
- Produces: `isImageHeavyPdf(bytes: Buffer): Promise<boolean>` — `true` when deck-shaped OR text-sparse OR probe error.

- [ ] **Step 1: Write failing tests** (pure `isDeckGeometry` — no subprocess needed)

```typescript
// tests/lib/courses/pdf-classify.test.ts
import { describe, it, expect } from 'vitest';
import { isDeckGeometry } from '@/lib/courses/pdf-classify';

describe('isDeckGeometry', () => {
  it('flags a 16:9 slide page (960x540pt)', () => { expect(isDeckGeometry(960, 540)).toBe(true); });
  it('flags a 1920x1080pt page', () => { expect(isDeckGeometry(1920, 1080)).toBe(true); });
  it('does NOT flag letter portrait (612x792pt)', () => { expect(isDeckGeometry(612, 792)).toBe(false); });
  it('does NOT flag A4 portrait (595x842pt)', () => { expect(isDeckGeometry(595, 842)).toBe(false); });
  it('flags an oversized page (long edge > 1500pt) regardless of aspect', () => { expect(isDeckGeometry(1700, 1300)).toBe(true); });
  it('returns false for zero/garbage dims', () => { expect(isDeckGeometry(0, 0)).toBe(false); });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node_modules/.bin/vitest run tests/lib/courses/pdf-classify.test.ts`
Expected: FAIL — `isDeckGeometry` not exported.

- [ ] **Step 3: Implement**

```typescript
// lib/courses/pdf-classify.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileP = promisify(execFile);
const MIN_CHARS_PER_PAGE = 100; // mirror extract-text.ts

/** Deck-shaped: 16:9-ish landscape OR an oversized page. Sizes in points (1pt = 1/72"). */
export function isDeckGeometry(widthPt: number, heightPt: number): boolean {
  if (!(widthPt > 0) || !(heightPt > 0)) return false;
  const longEdge = Math.max(widthPt, heightPt);
  const aspect = longEdge / Math.min(widthPt, heightPt);
  const landscapeWide = widthPt >= heightPt && aspect >= 1.6; // 16:10=1.6, 16:9=1.78
  const oversized = longEdge > 1500;                           // ≫ letter(792)/A4(842)
  return landscapeWide || oversized;
}

export async function pdfPageInfo(bytes: Buffer): Promise<{ pageCount: number; widthPt: number; heightPt: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'pdfinfo-'));
  const file = join(dir, 'in.pdf');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP('pdfinfo', [file], { timeout: 20_000 });
    const pageCount = Number(/Pages:\s+(\d+)/.exec(stdout)?.[1] ?? 0);
    const sz = /Page size:\s+([\d.]+)\s+x\s+([\d.]+)/.exec(stdout);
    return { pageCount, widthPt: Number(sz?.[1] ?? 0), heightPt: Number(sz?.[2] ?? 0) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function charsPerPage(bytes: Buffer, pageCount: number): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'pdftotext-'));
  const file = join(dir, 'in.pdf');
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileP('pdftotext', [file, '-'], { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
    return pageCount > 0 ? stdout.length / pageCount : stdout.length;
  } catch {
    return 0; // pdftotext failure ⇒ treat as sparse ⇒ image-heavy
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Geometry first, density second. Any probe error → true (confusion → qwen). */
export async function isImageHeavyPdf(bytes: Buffer): Promise<boolean> {
  try {
    const { pageCount, widthPt, heightPt } = await pdfPageInfo(bytes);
    if (isDeckGeometry(widthPt, heightPt)) return true;
    return (await charsPerPage(bytes, pageCount)) < MIN_CHARS_PER_PAGE;
  } catch {
    return true;
  }
}
```

- [ ] **Step 4: Run to verify pass** — `node_modules/.bin/vitest run tests/lib/courses/pdf-classify.test.ts` → PASS (6).

- [ ] **Step 5: Commit**

```bash
git add lib/courses/pdf-classify.ts tests/lib/courses/pdf-classify.test.ts
git commit -m "feat(extract): geometry-first image-heavy PDF classifier (issue #4)"
```

---

### Task 2: Extract the vision cascade into a reusable helper (behavior-preserving refactor + qwen-force option)

**Files:**
- Modify: `lib/courses/extract-text.ts` (lift the `if (isImageBased) { … }` body, lines ~110-174, into a private `runVisionFallback` helper; add a `forceLocalOffload` option)
- Test: `tests/lib/courses/extract-text-vision-provider.test.ts` (existing — must stay green)

**Interfaces:**
- Produces (module-private, used by Task 3): `runVisionFallback(args: ExtractTextArgs, opts: ExtractTextOptions | undefined, pageCount: number | undefined, forceLocalOffload: boolean): Promise<ExtractTextResult>` — the existing granite → local-qwen → OpenAI cascade, unchanged, except the local-qwen leg fires when `(LOCAL_HARDSCAN_OCR set) OR forceLocalOffload`.

- [ ] **Step 1: Establish the green baseline** — the refactor is behavior-preserving for the existing (`forceLocalOffload=false`) path, so the existing suite is the guard.

Run: `node_modules/.bin/vitest run tests/lib/courses/extract-text-vision-provider.test.ts`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Refactor** — cut the entire body of `if (isImageBased) { … }` (the granite + hardscanLocal + openai cascade) into a new private function above `extractText`, parameterizing the hardscan condition. **Move every provider call, threshold, and try/catch verbatim** — only the two edits below change:

```typescript
// lib/courses/extract-text.ts — new private helper
async function runVisionFallback(
  args: ExtractTextArgs,
  opts: ExtractTextOptions | undefined,
  pageCount: number | undefined,
  forceLocalOffload: boolean,
): Promise<ExtractTextResult> {
  const { fileBytes, mimeType, fileName } = args;
  // … granite block moved verbatim …

  // EDIT 1 — make the local-qwen leg fire for the image route too:
  const hardscanLocal =
    !opts?.visionProvider &&
    (forceLocalOffload ||
      (!!process.env.LOCAL_HARDSCAN_OCR && process.env.LOCAL_HARDSCAN_OCR !== 'false'));
  // … buildLocalProvider().transcribeDocument({ fileBytes, mimeType, maxPages: VISION_PAGE_CAP, forceOffload: true }) moved verbatim …
  // … final getProvider() OpenAI fallback moved verbatim …
}
```

Then replace the old inline block inside `extractText`'s `if (isImageBased)` with:
```typescript
    if (isImageBased) {
      return runVisionFallback(args, opts, pageCount, false); // existing behavior (OpenAI default unless LOCAL_HARDSCAN_OCR)
    }
```

*(EDIT 2 is only the `hardscanLocal` condition above; no logic change for the `forceLocalOffload=false` path.)*

- [ ] **Step 3: Run to verify the existing suite still passes** (behavior-preserving)

Run: `node_modules/.bin/vitest run tests/lib/courses/extract-text-vision-provider.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 4: `tsc` check** — `node_modules/.bin/tsc --noEmit` clean (new helper typechecks, no unused vars).

- [ ] **Step 5: Commit**

```bash
git add lib/courses/extract-text.ts
git commit -m "refactor(extract): lift vision cascade into reusable runVisionFallback helper"
```

---

### Task 3: Route image-heavy PDFs to the vision cascade before Docling

**Files:**
- Modify: `lib/courses/extract-text.ts` (add the upfront route at the top of the PDF handling, before `getExtractorFor`)
- Test: `tests/lib/courses/extract-text-image-routing.test.ts`

**Interfaces:**
- Consumes: `isImageHeavyPdf`, `pdfPageInfo` (Task 1); `runVisionFallback` (Task 2).

- [ ] **Step 1: Write failing test** (mock the classifier + the local provider; assert Docling is never constructed)

```typescript
// tests/lib/courses/extract-text-image-routing.test.ts
import { describe, it, expect, vi } from 'vitest';
const getExtractorFor = vi.fn(() => { throw new Error('Docling must NOT be called for image decks'); });
vi.mock('@/lib/courses/material-extractor', () => ({
  getExtractorFor, transcribeWithGranite: vi.fn(),
  SUPPORTED_MIME_TYPES: ['application/pdf'],
}));
vi.mock('@/lib/courses/pdf-classify', () => ({
  isImageHeavyPdf: vi.fn(async () => true),
  pdfPageInfo: vi.fn(async () => ({ pageCount: 12, widthPt: 960, heightPt: 540 })),
}));
const transcribeDocument = vi.fn(async () => ({ text: 'Slide one text\n\nSlide two text', costUsdCents: 0 }));
vi.mock('@/lib/ai/provider', () => ({
  getProvider: vi.fn(),
  buildLocalProvider: vi.fn(() => ({ transcribeDocument })),
}));
import { extractText } from '@/lib/courses/extract-text';

describe('extractText — image-heavy PDF routing', () => {
  it('routes image-heavy PDFs to qwen (buildLocalProvider+forceOffload) and never calls Docling', async () => {
    const r = await extractText({ fileBytes: Buffer.from('pdf'), mimeType: 'application/pdf', fileName: 'deck.pdf' });
    expect(r.status).toBe('ok');
    expect(r.method).toBe('vision');
    expect(r.text).toContain('Slide one text');
    expect(r.pageCount).toBe(12);                   // from pdfPageInfo
    expect(getExtractorFor).not.toHaveBeenCalled(); // Docling never constructed
    expect(transcribeDocument).toHaveBeenCalledWith(expect.objectContaining({ forceOffload: true }));
  });
});
```

- [ ] **Step 2: Run to verify fail** — Expected: FAIL (Docling still called / route absent).

- [ ] **Step 3: Implement** — add the import + the route. At the top of `extractText`, after the legacy-office block and before `let extractor;`:

```typescript
  // Image-heavy PDFs (design slide decks) crash the standard Docling GPU pipeline on
  // the Spark GB10 (issue #4): the whole-deck raster hits a CUDA op before any
  // model-side resize. Detect them cheaply (geometry-first) and route straight to the
  // qwen per-page vision cascade — Docling is never invoked. Any probe doubt → qwen.
  if (mimeType === 'application/pdf' && (await isImageHeavyPdf(fileBytes))) {
    const info = await pdfPageInfo(fileBytes).catch(() => ({ pageCount: undefined as number | undefined }));
    return runVisionFallback(args, opts, (info as { pageCount?: number }).pageCount, /* forceLocalOffload */ true);
  }
```

Add import at top:
```typescript
import { isImageHeavyPdf, pdfPageInfo } from '@/lib/courses/pdf-classify';
```

- [ ] **Step 4: Run to verify pass** (+ regression: text-PDF path unchanged)

Run: `node_modules/.bin/vitest run tests/lib/courses/extract-text-image-routing.test.ts tests/lib/courses/extract-text-vision-provider.test.ts`
Expected: PASS; text-heavy PDFs still take the Docling text path (that suite unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/courses/extract-text.ts tests/lib/courses/extract-text-image-routing.test.ts
git commit -m "feat(extract): route image-heavy PDFs to qwen, skip crashing Docling (issue #4)"
```

---

### Task 4: Cap the standard Docling pipeline's render (defense-in-depth)

**Files:**
- Modify: `lib/courses/material-extractor.ts` (`buildForm`)
- Test: `tests/lib/courses/docling-images-scale.test.ts`

**Interfaces:** none new — request-shape change only.

> **Investigate first (Phase-1 discipline):** before writing the field, read `buildForm` and confirm the docling-serve request contract (is the render controlled by an `images_scale` form field, `image_export_scale`, or JSON `pipeline_options`?). Use the ACTUAL field the server honors — do not invent one. The test asserts whatever the real mechanism is.

- [ ] **Step 1: Read `buildForm` + the docling-serve options contract**, identify the real render-scale field, note it in the test.

- [ ] **Step 2: Write failing test** — assert `buildForm` (or its docling-serve payload) carries a bounded render scale (≤ 2.0), so a *misrouted* deck degrades instead of crashing. Mirror the existing docling request-shape test.

- [ ] **Step 3: Implement** — set the confirmed render-scale field to a bounded value (≈ 2.0) in `buildForm`, with a comment tying it to issue #4 (misroute → weak OCR, not CUDA crash).

- [ ] **Step 4: Run to verify pass** + full `material-extractor` suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/courses/material-extractor.ts tests/lib/courses/docling-images-scale.test.ts
git commit -m "fix(extract): cap standard Docling render so misroutes degrade not crash (issue #4)"
```

---

### Task 5: Ingest ETA estimator

**Files:**
- Create: `lib/capture/ingest-eta.ts`
- Test: `tests/lib/capture/ingest-eta.test.ts`

**Interfaces:**
- Produces: `estimateIngestSeconds(items: Array<{ pageCount: number; imageHeavy: boolean }>): number`.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/capture/ingest-eta.test.ts
import { describe, it, expect } from 'vitest';
import { estimateIngestSeconds } from '@/lib/capture/ingest-eta';

describe('estimateIngestSeconds', () => {
  it('uses 1.25s/page ÷ 6 concurrency for image-heavy pages + per-material overhead', () => {
    const s = estimateIngestSeconds([{ pageCount: 12, imageHeavy: true }]); // 12*1.25/6=2.5 + ~15
    expect(s).toBeGreaterThan(15);
    expect(s).toBeLessThan(30);
  });
  it('text materials skip the qwen term', () => {
    expect(estimateIngestSeconds([{ pageCount: 20, imageHeavy: true }]))
      .toBeGreaterThan(estimateIngestSeconds([{ pageCount: 20, imageHeavy: false }]));
  });
  it('handles empty list', () => { expect(estimateIngestSeconds([])).toBe(0); });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```typescript
// lib/capture/ingest-eta.ts
const SEC_PER_PAGE = 1.25;        // Spark-measured qwen anchor
const CONCURRENCY = 6;            // shared-prod ceiling
const PER_MATERIAL_OVERHEAD = 15; // digest + chunk-contextualize + embed, rough

export function estimateIngestSeconds(items: Array<{ pageCount: number; imageHeavy: boolean }>): number {
  return items.reduce((acc, m) => {
    const qwen = m.imageHeavy ? (Math.max(m.pageCount, 1) * SEC_PER_PAGE) / CONCURRENCY : 0;
    return acc + qwen + PER_MATERIAL_OVERHEAD;
  }, 0);
}
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add lib/capture/ingest-eta.ts tests/lib/capture/ingest-eta.test.ts
git commit -m "feat(capture): pdfinfo-based ingest ETA estimator (1.25s/page anchor)"
```

---

### Task 6: Ingest-status endpoint

**Files:**
- Create: `app/api/capture/[code]/ingest-status/route.ts`
- Test: `tests/app/api/capture/ingest-status.test.ts`

**Interfaces:**
- Consumes: `listMaterialsByCourse(courseCode): Promise<CourseMaterialRow[]>` (rows carry `extractionStatus`, `indexingStatus`, `ignored`, `pageCount`, `mimeType`), `estimateIngestSeconds` (Task 5).
- Produces: `GET …/ingest-status?slug=…` → `{ total: number; done: number; failed: number; etaSeconds: number }`.

> **Investigate first:** confirm the auth helper + signature the sibling capture routes use (`app/api/capture/[code]/scores/route.ts`) — reuse the SAME guard, don't invent one. Confirm `CourseMaterialRow` field names + `indexingStatus` values against `lib/db/course-materials-queries.ts`.

- [ ] **Step 1: Write failing test** (mock the query + auth to match the real guard).

```typescript
// tests/app/api/capture/ingest-status.test.ts
import { describe, it, expect, vi } from 'vitest';
// (Executor: mock whatever guard the sibling scores route uses, returning authorized.)
vi.mock('@/lib/db/course-materials-queries', () => ({
  listMaterialsByCourse: vi.fn(async () => [
    { indexingStatus: 'ready',    extractionStatus: 'ok',     ignored: false, pageCount: 10, mimeType: 'application/pdf' },
    { indexingStatus: 'indexing', extractionStatus: 'ok',     ignored: false, pageCount: 12, mimeType: 'application/pdf' },
    { indexingStatus: 'failed',   extractionStatus: 'failed', ignored: false, pageCount: 8,  mimeType: 'application/pdf' },
    { indexingStatus: 'ready',    extractionStatus: 'ok',     ignored: true,  pageCount: 3,  mimeType: 'application/pdf' },
  ]),
}));
import { GET } from '@/app/api/capture/[code]/ingest-status/route';

describe('GET ingest-status', () => {
  it('returns total/done/failed (excluding ignored) + an ETA', async () => {
    const req = new Request('http://x/api/capture/GC%203620/ingest-status?slug=s');
    const res = await GET(req, { params: Promise.resolve({ code: 'GC 3620' }) });
    const j = await res.json();
    expect(j.total).toBe(3);   // ignored excluded
    expect(j.done).toBe(1);    // ready & not ignored
    expect(j.failed).toBe(1);
    expect(j.etaSeconds).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** (align the auth guard + param shape with the sibling scores route)

```typescript
// app/api/capture/[code]/ingest-status/route.ts
import { NextResponse } from 'next/server';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { estimateIngestSeconds } from '@/lib/capture/ingest-eta';
// import { <the SAME guard the scores route uses> } from '@/lib/…';

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const courseCode = decodeURIComponent((await params).code);
  // if (!(await <guard>(req, courseCode, slug))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const materials = (await listMaterialsByCourse(courseCode)).filter((m) => !m.ignored);
  const total = materials.length;
  const done = materials.filter((m) => m.indexingStatus === 'ready').length;
  const failed = materials.filter((m) => m.indexingStatus === 'failed' || m.extractionStatus === 'failed').length;
  const pending = materials.filter((m) => m.indexingStatus !== 'ready' && m.indexingStatus !== 'failed');
  const etaSeconds = Math.round(estimateIngestSeconds(pending.map((m) => ({
    pageCount: m.pageCount ?? 1,
    imageHeavy: m.mimeType === 'application/pdf',
  }))));
  return NextResponse.json({ total, done, failed, etaSeconds });
}
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add app/api/capture/[code]/ingest-status/route.ts tests/app/api/capture/ingest-status.test.ts
git commit -m "feat(capture): ingest-status endpoint (X/Y done, failed, ETA)"
```

---

### Task 7: Capture-UI progress bar + ETA

**Files:**
- Create: `app/capture/[code]/IngestProgress.tsx` (pure presentational)
- Modify: `app/capture/[code]/CaptureClient.tsx` (poll `ingest-status` while any material is in-flight; render the bar near the materials-health banner)
- Test: `app/capture/[code]/__tests__/IngestProgress.test.tsx`

**Interfaces:**
- Consumes: `GET …/ingest-status` → `{ total, done, failed, etaSeconds }` (Task 6).

- [ ] **Step 1: Write failing test**

```tsx
// app/capture/[code]/__tests__/IngestProgress.test.tsx
import { render, screen } from '@testing-library/react';
import { IngestProgress } from '../IngestProgress';

it('shows progress + a human ETA while in-flight', () => {
  render(<IngestProgress status={{ total: 3, done: 1, failed: 0, etaSeconds: 90 }} />);
  expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
  expect(screen.getByText(/~2 min|~1 min/)).toBeInTheDocument();
});
it('renders nothing when complete', () => {
  const { container } = render(<IngestProgress status={{ total: 3, done: 3, failed: 0, etaSeconds: 0 }} />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** the presentational component, then wire the poll into `CaptureClient` (poll every 3s while `done + failed < total`; stop when complete; render `<IngestProgress>` above the materials-health banner).

```tsx
// app/capture/[code]/IngestProgress.tsx
export function IngestProgress({ status }: { status: { total: number; done: number; failed: number; etaSeconds: number } }) {
  const { total, done, failed, etaSeconds } = status;
  if (total === 0 || done + failed >= total) return null;
  const pct = Math.round((done / total) * 100);
  const eta = etaSeconds >= 90 ? `~${Math.round(etaSeconds / 60)} min` : `${Math.max(etaSeconds, 1)} s`;
  return (
    <div className="rounded-md border bg-muted/20 px-4 py-3 text-sm" role="status" aria-live="polite">
      <p>Indexing materials — <strong>{done} of {total}</strong> done{failed ? `, ${failed} failed` : ''} · est. {eta} left</p>
      <div className="mt-2 h-2 w-full rounded bg-stone-200">
        <div className="h-2 rounded bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
```

*(Executor: for the `CaptureClient` poll, follow the existing client-fetch pattern in that file — reuse its `slug` + course `code` and a `useEffect` + `setInterval` idiom; clear the interval on unmount and on completion.)*

- [ ] **Step 4: Run to verify pass** + full capture/courses suites + `node_modules/.bin/tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add app/capture/[code]/IngestProgress.tsx app/capture/[code]/CaptureClient.tsx app/capture/[code]/__tests__/IngestProgress.test.tsx
git commit -m "feat(capture): ingest progress bar + ETA (poll ingest-status)"
```

---

## Verification (post-build, no external gate)
- `node_modules/.bin/tsc --noEmit` clean; full capture + courses suites green.
- **End-to-end (qwen already prod-served — no wiring wait):** re-run a staged GC 3620 deck through `extractText` via `scripts/_one-off/test-reextract-gc3620.ts` (leave `TEST_LOCAL` unset so it hits the Spark qwen offload) → expect `method:'vision'`, real per-slide text, **no CUDA error**. Confirms geometry routing + the forced qwen leg end-to-end.
- **Deploy:** `git -C ../curriculum_developer-deploy merge --ff-only dev` → `pnpm build` → `launchctl kickstart -k gui/$(id -u)/com.gc.curriculum-tool` → health-check root 200 / `/courses` 401.
- **Backfill (off-peak):** re-extract the failed materials for GC 3620 (14) + GC 2400 (5) + GC 1040 (2) → re-score → the "under-evidenced" banners clear. Ping the Spark side for a load sanity-check during the backfill.

## Notes on decisions captured here
- **No new qwen client / per-page loop** — the entire path already exists in `LocalProvider.transcribeDocument`; this plan only changes *when* it's reached and *which provider leg* fires. (Simplest-solution-first; an earlier draft that added `image-pdf-qwen.ts` was reinventing it.)
- **Task 4's exact render-scale field is uncertain** until `buildForm` + the docling-serve contract are read — the task front-loads that investigation rather than guessing a field name.
