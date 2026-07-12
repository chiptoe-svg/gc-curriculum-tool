# Granite Docling clean-scan lane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For image-based PDFs, try Granite-Docling (local, via the docling-serve VLM pipeline) first and fall back to the current OpenAI OCR path on degenerate output — flag-gated, default off, image-PDF lane only.

**Architecture:** A module-level `transcribeWithGranite` (in `material-extractor.ts`) POSTs to docling-serve `/v1/convert/file` with `pipeline=vlm` + `vlm_pipeline_model=granite_docling`. A pure `repetitionRatio` helper detects the small-model repetition trap. `extractText`'s existing image-based branch calls Granite first (when `GRANITE_DOCLING_ENABLED`), accepts on clean output, and otherwise falls through to the unchanged `transcribeDocument` path.

**Tech Stack:** TypeScript strict, Vitest. No new deps, no schema change.

**Spec:** [`2026-07-12-granite-docling-clean-scan-lane-design.md`](../specs/2026-07-12-granite-docling-clean-scan-lane-design.md).

---

## Reused interfaces

- `extract-text.ts` (`lib/courses/extract-text.ts`): `ExtractTextResult { method?: 'text'|'vision'; status: 'ok'|'low_text'|'failed'; text?; pageCount?; visionCostUsdCents? }`; constants `MIN_CHARS_PER_PAGE=100`, `MIN_MEANINGFUL_CHARS=10`, `VISION_PAGE_CAP=40`; the image-based branch (`if (mimeType==='application/pdf') { … if (isImageBased) { provider.transcribeDocument(...) } }`) at ~line 100-124. Imports `getProvider` from `@/lib/ai/provider`, `getExtractorFor` from `@/lib/courses/material-extractor`.
- `material-extractor.ts`: `DoclingExtractor.extractWhole` builds a `FormData` POST to `${baseUrl}/v1/convert/file` with `files` + `to_formats=md`; parses `DoclingResponse` (`data.document.md_content ?? data.document.text_content`), page count from `^---$` count. Base URL default: `process.env.DOCLING_URL?.trim() || 'http://localhost:5001'`. `DoclingResponse` type is defined in this file.

---

## Task 1: `repetitionRatio` pure helper

**Files:** Create `lib/courses/repetition-ratio.ts`; Test `tests/lib/courses/repetition-ratio.test.ts`.

- [ ] **Step 1: Write the failing test** `tests/lib/courses/repetition-ratio.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { repetitionRatio } from '@/lib/courses/repetition-ratio';

describe('repetitionRatio', () => {
  it('is ~0 for clean varied prose', () => {
    const md = '# Title\n\nFirst paragraph about products.\n\nSecond distinct paragraph.\n\n- bullet one\n- bullet two';
    expect(repetitionRatio(md)).toBeLessThan(0.1);
  });
  it('is high for the repetition trap (repeated lines + junk tokens)', () => {
    const md = ['·','·','·','·','the left lane,','the left lane,','the left lane,','the left lane,','the left lane,'].join('\n');
    expect(repetitionRatio(md)).toBeGreaterThan(0.7);
  });
  it('counts a line identical to its predecessor as a repeat', () => {
    const md = 'Name\nresults\nresults\nresults\nresults';
    expect(repetitionRatio(md)).toBeGreaterThan(0.5);
  });
  it('returns 0 for empty / whitespace-only input', () => {
    expect(repetitionRatio('')).toBe(0);
    expect(repetitionRatio('   \n\n  ')).toBe(0);
  });
  it('a mostly-clean doc with a couple repeats stays under 0.3', () => {
    const lines = ['# Heading','para a','para b','para c','para d','para e','para f','x','x'];
    expect(repetitionRatio(lines.join('\n'))).toBeLessThan(0.3);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm vitest run tests/lib/courses/repetition-ratio.test.ts`

- [ ] **Step 3: Implement `lib/courses/repetition-ratio.ts`:**
```typescript
/**
 * Fraction of non-empty lines that are DEGENERATE repeats — the signature of
 * the small-VLM repetition trap (a line identical to its immediate predecessor,
 * or a line that is only a junk token). Range 0..1. Pure. Clean docs ≈ 0.0;
 * the handwritten-scan repetition trap ≈ 0.9.
 */
const JUNK_LINE = /^[·.\-*•]+$/; // a line that is only bullet/dot/dash junk

export function repetitionRatio(markdown: string): number {
  const lines = markdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return 0;
  let degenerate = 0;
  let prev: string | null = null;
  for (const line of lines) {
    if (JUNK_LINE.test(line) || (prev !== null && line === prev)) degenerate++;
    prev = line;
  }
  return degenerate / lines.length;
}
```

- [ ] **Step 4: Run, verify PASS**; `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add lib/courses/repetition-ratio.ts tests/lib/courses/repetition-ratio.test.ts && git commit -m "feat(ingest): repetitionRatio — detect the small-VLM repetition trap"`

---

## Task 2: `transcribeWithGranite` — the docling-serve VLM call

**Files:** Modify `lib/courses/material-extractor.ts` (add a module-level exported function); Test `tests/lib/courses/transcribe-with-granite.test.ts`.

- [ ] **Step 1: Write the failing test** `tests/lib/courses/transcribe-with-granite.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribeWithGranite } from '@/lib/courses/material-extractor';

afterEach(() => vi.restoreAllMocks());

function mockFetchOnce(json: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok, status: ok ? 200 : 500,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response);
}

describe('transcribeWithGranite', () => {
  it('POSTs to docling-serve with the VLM pipeline + granite model and parses md', async () => {
    const spy = mockFetchOnce({ status: 'success', document: { md_content: '## Heading\n\ntext one\n\ntext two' } });
    const out = await transcribeWithGranite({ fileBytes: Buffer.from('x'), mimeType: 'application/pdf', fileName: 'a.pdf' });
    expect(out.text).toContain('## Heading');
    // inspect the FormData sent
    const form = spy.mock.calls[0][1]!.body as FormData;
    expect(form.get('pipeline')).toBe('vlm');
    expect(form.get('vlm_pipeline_model')).toBe('granite_docling');
    expect(form.get('to_formats')).toBe('md');
    expect(String(spy.mock.calls[0][0])).toContain('/v1/convert/file');
  });
  it('throws on a non-ok docling-serve response (so the caller can fall back)', async () => {
    mockFetchOnce({ detail: 'boom' }, false);
    await expect(transcribeWithGranite({ fileBytes: Buffer.from('x'), mimeType: 'application/pdf', fileName: 'a.pdf' }))
      .rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.** In `lib/courses/material-extractor.ts`, add a module-level exported function (near `DoclingExtractor`, reusing its `DoclingResponse` type + base-URL default). It mirrors `extractWhole`'s POST but selects the Granite VLM pipeline:
```typescript
/**
 * Transcribe an image-based document via docling-serve's Granite-Docling VLM
 * pipeline (pipeline=vlm + vlm_pipeline_model=granite_docling). Structured,
 * local, free. Throws on any docling-serve error so the caller (extractText)
 * can fall back to the OpenAI vision path. Base URL = DOCLING_URL (:5001).
 */
export async function transcribeWithGranite(
  { fileBytes, mimeType, fileName }: { fileBytes: Buffer; mimeType: string; fileName: string },
): Promise<{ text: string; pageCount: number }> {
  const baseUrl = (process.env.DOCLING_URL?.trim() || 'http://localhost:5001').replace(/\/$/, '');
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(fileBytes)], { type: mimeType }), fileName);
  form.append('to_formats', 'md');
  form.append('pipeline', 'vlm');
  form.append('vlm_pipeline_model', 'granite_docling');

  const res = await fetch(`${baseUrl}/v1/convert/file`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`granite docling-serve ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as DoclingResponse;
  if (data.status && data.status !== 'success') {
    throw new Error(`granite conversion failed: ${data.errors?.[0]?.error_message ?? 'unknown'}`);
  }
  const doc = data.document ?? {};
  const text = (doc.md_content ?? doc.text_content ?? '').trim();
  const pageCount = text ? Math.max(1, (text.match(/^---$/gm) ?? []).length + 1) : 0;
  return { text, pageCount };
}
```
(If `DoclingResponse` is declared below `DoclingExtractor`, place the function after its declaration, or hoist the type — keep it in the same file.)

- [ ] **Step 4: Run, verify PASS**; `pnpm tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add lib/courses/material-extractor.ts tests/lib/courses/transcribe-with-granite.test.ts && git commit -m "feat(ingest): transcribeWithGranite — docling-serve Granite VLM pipeline call"`

---

## Task 3: Route the image-based branch through Granite (flag-gated, with fallback)

**Files:** Modify `lib/courses/extract-text.ts`; Test `tests/lib/courses/extract-text-granite.test.ts`.

- [ ] **Step 1: Write the failing test** `tests/lib/courses/extract-text-granite.test.ts`. Mock the Granite call + the vision provider; drive `extractText` with an image-based PDF (low text). Assert the four routes. Mock the extractor so the first pass returns near-zero text (image-based):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the extractor factory so the first pass yields image-based (low) text.
vi.mock('@/lib/courses/material-extractor', async (orig) => {
  const actual = await orig<typeof import('@/lib/courses/material-extractor')>();
  return {
    ...actual,
    getExtractorFor: () => ({ name: 'docling', supports: () => true, extract: async () => ({ text: '', pageCount: 1 }) }),
    transcribeWithGranite: vi.fn(),
  };
});

import { extractText } from '@/lib/courses/extract-text';
import { transcribeWithGranite } from '@/lib/courses/material-extractor';

const fakeVision = { transcribeDocument: vi.fn(async () => ({ text: 'OPENAI FALLBACK TEXT that is long enough', costUsdCents: 5 })) };
const args = { fileBytes: Buffer.from('%PDF'), mimeType: 'application/pdf' as const, fileName: 's.pdf' };

beforeEach(() => { process.env.GRANITE_DOCLING_ENABLED = '1'; vi.clearAllMocks(); });
afterEach(() => { delete process.env.GRANITE_DOCLING_ENABLED; });

it('clean Granite output → method granite, cost 0, OpenAI not called', async () => {
  (transcribeWithGranite as any).mockResolvedValue({ text: '## R\n\npara a\n\npara b\n\npara c', pageCount: 1 });
  const r = await extractText(args, { visionProvider: fakeVision as any });
  expect(r.method).toBe('granite'); expect(r.visionCostUsdCents).toBe(0);
  expect(fakeVision.transcribeDocument).not.toHaveBeenCalled();
});
it('junk (repetitive) Granite output → falls back to OpenAI (method vision)', async () => {
  (transcribeWithGranite as any).mockResolvedValue({ text: ['·','·','·','·','·','·'].join('\n'), pageCount: 1 });
  const r = await extractText(args, { visionProvider: fakeVision as any });
  expect(r.method).toBe('vision'); expect(fakeVision.transcribeDocument).toHaveBeenCalledOnce();
});
it('Granite throws → falls back to OpenAI', async () => {
  (transcribeWithGranite as any).mockRejectedValue(new Error('docling-serve down'));
  const r = await extractText(args, { visionProvider: fakeVision as any });
  expect(r.method).toBe('vision'); expect(fakeVision.transcribeDocument).toHaveBeenCalledOnce();
});
it('flag OFF → Granite never called, straight to OpenAI', async () => {
  delete process.env.GRANITE_DOCLING_ENABLED;
  const r = await extractText(args, { visionProvider: fakeVision as any });
  expect(r.method).toBe('vision'); expect(transcribeWithGranite).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.** In `extract-text.ts`:
  - Add `'granite'` to the method union: `method?: 'text' | 'vision' | 'granite';`
  - Import `transcribeWithGranite` (and keep `getExtractorFor`) from `@/lib/courses/material-extractor`; import `repetitionRatio` from `@/lib/courses/repetition-ratio`.
  - Add a constant near the others: `const GRANITE_REPETITION_THRESHOLD = 0.3;`
  - Inside `if (isImageBased) {` — BEFORE the existing `transcribeDocument` block — insert the Granite-first attempt:
```typescript
      if (process.env.GRANITE_DOCLING_ENABLED && process.env.GRANITE_DOCLING_ENABLED !== 'false') {
        try {
          const g = await transcribeWithGranite({ fileBytes, mimeType, fileName });
          const gText = g.text.trim();
          if (gText.length >= MIN_MEANINGFUL_CHARS && repetitionRatio(gText) < GRANITE_REPETITION_THRESHOLD) {
            return { method: 'granite', status: 'ok', text: gText, pageCount: g.pageCount || pageCount, visionCostUsdCents: 0 };
          }
          // else: declined (empty / short / repetitive) → fall through to OpenAI below
        } catch {
          // Granite error → fall through to OpenAI below (Granite can only decline, never fail)
        }
      }
```
  - Leave the existing `provider.transcribeDocument(...)` block exactly as-is directly after it.

- [ ] **Step 4: Run, verify PASS** `pnpm vitest run tests/lib/courses/`; `pnpm tsc --noEmit` clean; existing extract-text tests still green.
- [ ] **Step 5: Commit** — `git add lib/courses/extract-text.ts tests/lib/courses/extract-text-granite.test.ts && git commit -m "feat(ingest): route image-PDFs through Granite first, fall back to OpenAI on junk (flag-gated)"`

---

## Task 4: STATE.md + full suite

**Files:** Modify `docs/STATE.md`.

- [ ] **Step 1: Full suite + typecheck** — `pnpm vitest run` (all green), `pnpm tsc --noEmit` (clean).

- [ ] **Step 2: Update STATE.md** — under env vars / ingest: new **`GRANITE_DOCLING_ENABLED`** flag (default off) — when on, image-based PDFs try Granite-Docling via docling-serve's VLM pipeline first (`pipeline=vlm`+`vlm_pipeline_model=granite_docling`), accept on clean output (`repetitionRatio < 0.3` + meaningful length), else fall back to the OpenAI `transcribeDocument` path; new `method: 'granite'` on extraction results (cost 0). **Landed dark (flag off);** flip on in deploy `.env.local` only after the validation pass on real materials. Reference the spec/plan + the eval note. Update the Deferred/debt Granite entry: integration BUILT (flag-gated), validation-gate + engine-tuning (mlx) still pending.

- [ ] **Step 3: Commit** — `git add docs/STATE.md && git commit -m "docs(state): Granite clean-scan lane built (flag-gated, image-PDFs); validation gate pending"`

---

## Notes for the implementer

- **The lane is dark by default.** Flag off ⇒ `extract-text.ts` behaves byte-for-byte as today (the Granite block is skipped). This is the safety property — merging can't change ingestion until the operator flips `GRANITE_DOCLING_ENABLED`.
- **Granite can only decline, never fail.** Every non-clean outcome (error, empty, short, repetitive) falls through to the unchanged OpenAI path. Do not add a `status:'failed'` return inside the Granite block.
- **No deploy in this plan.** Code lands on `main` dark; the flag flip + validation pass is a separate step (the rollout gate in the spec).
- **`transcribeWithGranite` is module-level, not a `DoclingExtractor` method** — `extractText` holds a generic `MaterialExtractor`, and the Granite call is independent of which extractor ran the first pass (it re-hits docling-serve by URL).
- Component-test discipline: mock `fetch` / the provider; assert on the FormData fields + the returned `method`.
