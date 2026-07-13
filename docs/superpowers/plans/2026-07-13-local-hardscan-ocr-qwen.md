# Local hard-scan OCR (Qwen-35B on the Spark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag-gated (`LOCAL_HARDSCAN_OCR`) swap of the image-PDF hard-scan OCR fallback from OpenAI to Qwen3.6-35B on the DGX Spark, with `forceOffload` (all pages to the Spark, bypassing the size tier) and an OpenAI fallback-on-failure so ingestion never breaks.

**Architecture:** The whole Qwen-on-Spark transcription path already exists in `LocalProvider.transcribeDocument` (render → canonicalize → per-page DGX offload via `VISION_OFFLOAD_*` → `enable_thinking:false` + `repetition_penalty:1.3` → stitch). This plan (1) adds a `forceOffload` option so every page of a hard scan runs on the Spark rather than the size-tiered small→omlx / big→DGX split, and (2) at the `extract-text.ts` `isImageBased` seam, routes the default (non-"use local") hard-scan lane to that local provider when the flag is on, falling back to OpenAI on any failure/empty. Born-digital Docling extraction, the Granite clean-scan lane, and slide description are untouched.

**Tech Stack:** TypeScript (strict), Vitest, existing `lib/ai` provider abstraction. No new deps, no schema/migration.

---

## File Structure

- `lib/ai/provider.ts` — add `forceOffload?: boolean` to `TranscribeDocumentArgs` (the shared provider interface). Responsibility: the transcription request contract.
- `lib/ai/vision-offload.ts` — extend `shouldOffload()` with an optional `force` param. Responsibility: the pure offload-vs-local decision.
- `lib/ai/local.ts` — `transcribeDocument` passes `args.forceOffload` into `shouldOffload`. Responsibility: the local/DGX transcription implementation.
- `lib/courses/extract-text.ts` — flag-gated routing at the `isImageBased` lane-3 + OpenAI fallback-on-failure. Responsibility: the extraction lane tree.
- `tests/lib/ai/vision-offload.test.ts` (new) — unit tests for the `force` decision.
- `tests/lib/courses/extract-text-hardscan.test.ts` (new) — routing tests (flag on/off, fallback, use-local mode, born-digital untouched).
- `.env.example`, `docs/superpowers/running-locally.md`, `docs/STATE.md` — document the flag + `VISION_OFFLOAD_*` (Spark) + campus-FP8 backup; record the mix-issue debt.

---

### Task 1: `forceOffload` on the request contract + the offload decision

**Files:**
- Modify: `lib/ai/provider.ts:9-14` (`TranscribeDocumentArgs`)
- Modify: `lib/ai/vision-offload.ts:41-43` (`shouldOffload`)
- Test: `tests/lib/ai/vision-offload.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/vision-offload.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { shouldOffload, type VisionOffload } from '@/lib/ai/vision-offload';

const off: VisionOffload = { baseURL: 'http://spark/v1', model: 'qwen3.6-35b-a3b', apiKey: 'k', concurrency: 12, minItems: 4 };

describe('shouldOffload', () => {
  it('honors the size tier by default (below minItems stays local)', () => {
    expect(shouldOffload(off, 1)).toBe(false);
    expect(shouldOffload(off, 4)).toBe(true);
  });
  it('force=true offloads even a single page (bypasses the size tier)', () => {
    expect(shouldOffload(off, 1, true)).toBe(true);
  });
  it('force=true still returns false when there is no offload config', () => {
    expect(shouldOffload(null, 1, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/vision-offload.test.ts`
Expected: FAIL — the `force=true` single-page case returns `false` (param not yet supported).

- [ ] **Step 3: Add `forceOffload` to the request contract**

In `lib/ai/provider.ts`, extend `TranscribeDocumentArgs` (currently lines 9-14):

```typescript
export interface TranscribeDocumentArgs {
  fileBytes: Buffer;
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  /** Max pages to transcribe. Default: 40. */
  maxPages?: number;
  /** Force every page to the DGX offload endpoint, bypassing the small-doc size
   *  tier. Used by the hard-scan OCR lane so all pages run on the benched Spark
   *  variant. Ignored by providers without an offload path (OpenAI/Anthropic/campus). */
  forceOffload?: boolean;
}
```

- [ ] **Step 4: Implement the `force` param in `shouldOffload`**

In `lib/ai/vision-offload.ts`, replace `shouldOffload` (lines 40-43):

```typescript
/** Should a batch of `count` items go to the DGX? (config present AND (forced OR big enough)) */
export function shouldOffload(off: VisionOffload | null, count: number, force = false): boolean {
  return !!off && (force || count >= off.minItems);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/vision-offload.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/provider.ts lib/ai/vision-offload.ts tests/lib/ai/vision-offload.test.ts
git commit -m "feat(ocr): add forceOffload to transcribe contract + shouldOffload"
```

---

### Task 2: `LocalProvider.transcribeDocument` honors `forceOffload`

**Files:**
- Modify: `lib/ai/local.ts:122` (the `offloadClient` decision)
- Test: `lib/ai/__tests__/local-transcribe.test.ts` (existing — must stay green)

- [ ] **Step 1: Make the offload decision honor `args.forceOffload`**

In `lib/ai/local.ts`, the current `offloadClient` decision (line ~122) reads:

```typescript
    const offloadClient = shouldOffload(offload, pages.length) && offload
      ? new OpenAI({ baseURL: offload.baseURL, apiKey: offload.apiKey, timeout: 120_000, maxRetries: 0 })
      : null;
```

Replace the `shouldOffload(offload, pages.length)` call with the forced form:

```typescript
    const offloadClient = shouldOffload(offload, pages.length, args.forceOffload) && offload
      ? new OpenAI({ baseURL: offload.baseURL, apiKey: offload.apiKey, timeout: 120_000, maxRetries: 0 })
      : null;
```

- [ ] **Step 2: Run the existing local-transcribe tests to verify no regression**

Run: `pnpm vitest run lib/ai/__tests__/local-transcribe.test.ts`
Expected: PASS (2 tests). These run with no `VISION_OFFLOAD_*` env → `offload` is null → `shouldOffload` is `false` regardless of `forceOffload` → the local path is unchanged. (The `force` logic itself is unit-tested in Task 1.)

- [ ] **Step 3: Commit**

```bash
git add lib/ai/local.ts
git commit -m "feat(ocr): LocalProvider.transcribeDocument honors forceOffload"
```

---

### Task 3: Flag-gated hard-scan routing + OpenAI fallback at the seam

**Files:**
- Modify: `lib/courses/extract-text.ts:16` (import) and `:120-138` (lane-3 routing)
- Test: `tests/lib/courses/extract-text-hardscan.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/courses/extract-text-hardscan.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Default: extractor yields image-based (near-empty) text for a PDF → lane 3.
vi.mock('@/lib/courses/material-extractor', async (orig) => {
  const actual = await orig<typeof import('@/lib/courses/material-extractor')>();
  return {
    ...actual,
    getExtractorFor: () => ({ name: 'docling', supports: () => true, extract: async () => ({ text: '', pageCount: 2 }) }),
    transcribeWithGranite: vi.fn(),
  };
});

// Both provider factories are spies so we can assert which lane fired.
const { getProvider, buildLocalProvider } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  buildLocalProvider: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider, buildLocalProvider }));

import { extractText } from '@/lib/courses/extract-text';

const args = { fileBytes: Buffer.from('%PDF'), mimeType: 'application/pdf' as const, fileName: 'scan.pdf' };
const openaiProvider = { transcribeDocument: vi.fn(async () => ({ text: 'OPENAI TRANSCRIPT long enough', costUsdCents: 5, truncated: false })) };

beforeEach(() => {
  vi.clearAllMocks();
  getProvider.mockReturnValue(openaiProvider);
});
afterEach(() => { delete process.env.LOCAL_HARDSCAN_OCR; });

it('flag ON + local returns text → local used with forceOffload, OpenAI not called', async () => {
  process.env.LOCAL_HARDSCAN_OCR = '1';
  const local = { transcribeDocument: vi.fn(async () => ({ text: 'QWEN SPARK TRANSCRIPT', costUsdCents: 0, truncated: false })) };
  buildLocalProvider.mockReturnValue(local);
  const r = await extractText(args);
  expect(r).toMatchObject({ method: 'vision', status: 'ok', text: 'QWEN SPARK TRANSCRIPT', visionCostUsdCents: 0 });
  expect(local.transcribeDocument).toHaveBeenCalledOnce();
  expect(local.transcribeDocument.mock.calls[0][0]).toMatchObject({ forceOffload: true });
  expect(openaiProvider.transcribeDocument).not.toHaveBeenCalled();
});

it('flag ON + local throws → OpenAI fallback fires', async () => {
  process.env.LOCAL_HARDSCAN_OCR = '1';
  buildLocalProvider.mockReturnValue({ transcribeDocument: vi.fn(async () => { throw new Error('spark down'); }) });
  const r = await extractText(args);
  expect(r).toMatchObject({ method: 'vision', status: 'ok', text: 'OPENAI TRANSCRIPT long enough' });
  expect(openaiProvider.transcribeDocument).toHaveBeenCalledOnce();
});

it('flag ON + local returns empty → OpenAI fallback fires', async () => {
  process.env.LOCAL_HARDSCAN_OCR = '1';
  buildLocalProvider.mockReturnValue({ transcribeDocument: vi.fn(async () => ({ text: '  ', costUsdCents: 0, truncated: false })) });
  const r = await extractText(args);
  expect(r.method).toBe('vision');
  expect(openaiProvider.transcribeDocument).toHaveBeenCalledOnce();
});

it('flag OFF → buildLocalProvider never called, straight to OpenAI', async () => {
  const r = await extractText(args);
  expect(buildLocalProvider).not.toHaveBeenCalled();
  expect(openaiProvider.transcribeDocument).toHaveBeenCalledOnce();
  expect(r).toMatchObject({ method: 'vision', text: 'OPENAI TRANSCRIPT long enough' });
});

it('use-local mode (visionProvider injected) + flag ON → injected provider used, buildLocalProvider skipped', async () => {
  process.env.LOCAL_HARDSCAN_OCR = '1';
  const injected = { transcribeDocument: vi.fn(async () => ({ text: 'INJECTED LOCAL', costUsdCents: 0, truncated: false })) };
  const r = await extractText(args, { visionProvider: injected as never });
  expect(injected.transcribeDocument).toHaveBeenCalledOnce();
  expect(buildLocalProvider).not.toHaveBeenCalled();
  expect(r).toMatchObject({ method: 'vision', text: 'INJECTED LOCAL' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/courses/extract-text-hardscan.test.ts`
Expected: FAIL — flag path not implemented (`buildLocalProvider` never called; `forceOffload` not passed).

- [ ] **Step 3: Add the `buildLocalProvider` import**

In `lib/courses/extract-text.ts`, the current import (line 16) is:

```typescript
import { getProvider } from '@/lib/ai/provider';
```

Replace with:

```typescript
import { getProvider, buildLocalProvider } from '@/lib/ai/provider';
```

- [ ] **Step 4: Implement the flag-gated lane-3 routing**

In `lib/courses/extract-text.ts`, replace the lane-3 block (the `try { const provider = opts?.visionProvider ?? getProvider(); … } catch { return { method: 'vision', status: 'failed', pageCount }; }` at lines ~120-138) with:

```typescript
      // Lane 3 — flat OCR fallback for hard/handwritten scans. Default: getProvider()
      // (OpenAI). When LOCAL_HARDSCAN_OCR is on AND we are not already in "use local"
      // mode (which injects opts.visionProvider), transcribe on Qwen-35B via the Spark
      // (buildLocalProvider + forceOffload = every page on the benched variant), and
      // fall through to OpenAI on any failure/empty so ingestion never breaks.
      const hardscanLocal =
        !opts?.visionProvider &&
        !!process.env.LOCAL_HARDSCAN_OCR &&
        process.env.LOCAL_HARDSCAN_OCR !== 'false';
      if (hardscanLocal) {
        try {
          const local = buildLocalProvider();
          const t = await local.transcribeDocument({
            fileBytes,
            mimeType,
            maxPages: VISION_PAGE_CAP,
            forceOffload: true,
          });
          const localText = t.text.trim();
          if (localText.length >= MIN_MEANINGFUL_CHARS) {
            return {
              method: 'vision',
              status: 'ok',
              text: localText,
              pageCount,
              visionCostUsdCents: t.costUsdCents,
            };
          }
          // empty/short → fall through to the OpenAI fallback below
        } catch {
          // local/Spark error → fall through to the OpenAI fallback below
        }
      }
      try {
        const provider = opts?.visionProvider ?? getProvider();
        const transcribed = await provider.transcribeDocument({
          fileBytes,
          mimeType,
          maxPages: VISION_PAGE_CAP,
        });
        const vText = transcribed.text.trim();
        const status = vText.length < MIN_MEANINGFUL_CHARS ? 'low_text' : 'ok';
        return {
          method: 'vision',
          status,
          text: vText,
          pageCount,
          visionCostUsdCents: transcribed.costUsdCents,
        };
      } catch {
        return { method: 'vision', status: 'failed', pageCount };
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/courses/extract-text-hardscan.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the neighboring extract-text suites to confirm no regression**

Run: `pnpm vitest run tests/courses/extract-text.test.ts tests/lib/courses/extract-text-granite.test.ts lib/courses/__tests__/extract-text-vision-provider.test.ts`
Expected: PASS — the flag defaults off, so those suites hit today's behavior byte-for-byte.

- [ ] **Step 7: Commit**

```bash
git add lib/courses/extract-text.ts tests/lib/courses/extract-text-hardscan.test.ts
git commit -m "feat(ocr): flag-gated Qwen-Spark hard-scan lane with OpenAI fallback"
```

---

### Task 4: Document the flag + endpoints + record the mix-issue debt

**Files:**
- Modify: `.env.example`
- Modify: `docs/superpowers/running-locally.md`
- Modify: `docs/STATE.md`

- [ ] **Step 1: Document env vars in `.env.example`**

Add to `.env.example` (near the other `AI_*` / vision entries):

```bash
# --- Hard-scan OCR (image-based PDFs) ---------------------------------------
# When on, image-based PDF OCR (extract-text.ts isImageBased lane) transcribes on
# Qwen3.6-35B via the DGX Spark instead of OpenAI, falling back to OpenAI on failure.
# Default off = image-PDF OCR → OpenAI (today's behavior).
LOCAL_HARDSCAN_OCR=

# DGX offload endpoint for all vision transcription (OCR + slides). Point at the
# Spark for the hard-scan lane. Backup: qwen3.6-35b-a3b-fp8 @ https://llm.rcd.clemson.edu/v1
# (vision-capable, honors enable_thinking:false, ~3x slower — swap these three vars).
VISION_OFFLOAD_BASE_URL=http://gcspark.clemson.edu:8080/v1
VISION_OFFLOAD_MODEL=qwen3.6-35b-a3b
VISION_OFFLOAD_API_KEY=
```

- [ ] **Step 2: Document the lane + rollout in `running-locally.md`**

Add a short subsection to `docs/superpowers/running-locally.md` under the AI/vision setup:

```markdown
### Hard-scan OCR lane (local Qwen, optional)

Image-based PDFs (scanned/handwritten, `charsPerPage < 100`) OCR through the
`extract-text.ts` vision lane. Default → OpenAI. To route hard scans to
Qwen3.6-35B on the DGX Spark (local, free, FERPA-friendlier; ~1.6x slower/page):

1. Set `VISION_OFFLOAD_BASE_URL=http://gcspark.clemson.edu:8080/v1`,
   `VISION_OFFLOAD_MODEL=qwen3.6-35b-a3b`, `VISION_OFFLOAD_API_KEY=…`.
2. Set `LOCAL_HARDSCAN_OCR=1`.

OpenAI remains the automatic fallback if the Spark errors/empties (ingestion never
breaks). Backup endpoint: `qwen3.6-35b-a3b-fp8` @ `https://llm.rcd.clemson.edu/v1`
(swap the three `VISION_OFFLOAD_*` vars). Born-digital PDFs (Docling text
extraction) and the Granite clean-scan lane are unaffected.
```

- [ ] **Step 3: Update `docs/STATE.md` — env var, what's-live, and the mix-issue debt**

In `docs/STATE.md`:
- Add `LOCAL_HARDSCAN_OCR` + the `VISION_OFFLOAD_*` Spark values to the **env vars** list (the `AI:` line near `GRANITE_DOCLING_ENABLED`).
- Add a **Deferred / debt** entry (append, don't edit existing):

```markdown
- **Hard-scan OCR mix-issue (per-document routing granularity) — DEFERRED.** The `extract-text.ts` `isImageBased` gate is a document-level average (`charsPerPage = text.length / pageCount`); both OCR lanes act on the whole file. So a heterogeneous PDF is mis-routed: a mostly-text doc with a few scanned pages averages above 100 → `isImageBased=false` → the scanned pages are **silently dropped** from extraction; a doc mixing clean + handwritten pages gets one blended `repetitionRatio` so one page type decides the whole doc's lane. Orthogonal to the OpenAI→Qwen swap (which changes the OCR backend, not the routing granularity). Real fix = per-page routing (classify each page's density → route independently → stitch); pure YAGNI against a 0/134-usage path. Spec: `2026-07-13-local-hardscan-ocr-qwen-design.md`.
```

- Add a **What's live / recently shipped**-style line noting the flag-gated lane (dark, default off), mirroring how the Granite lane entry is phrased:

```markdown
- **Local hard-scan OCR lane (Qwen-35B on the Spark) — BUILT flag-gated, DARK 2026-07-13.** `LOCAL_HARDSCAN_OCR` (default off). When on, image-based-PDF OCR (`extract-text.ts` isImageBased lane) → Qwen3.6-35B via the Spark (`VISION_OFFLOAD_*`, `forceOffload` = all pages on the benched variant), OpenAI fallback-on-failure. Off = byte-for-byte today (→ OpenAI). Spec `2026-07-13-local-hardscan-ocr-qwen-design.md` · plan `2026-07-13-local-hardscan-ocr-qwen.md`. Rollout gate (not code): live smoke on real image-PDFs (incl. Spark-down → OpenAI fallback) before flipping the flag + `VISION_OFFLOAD_*` in deploy `.env.local`. Backup endpoint: campus `qwen3.6-35b-a3b-fp8` (env-swap). Related follow-on (NOT built): Granite clean-scan lane still blocked on docling-serve engine (CPU pins the VLM; needs a dedicated MLX/Spark-vLLM Granite instance).
```

- [ ] **Step 4: Run the full suite + typecheck**

Run: `pnpm vitest run && pnpm tsc --noEmit`
Expected: PASS — full suite green, no type errors.

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/superpowers/running-locally.md docs/STATE.md
git commit -m "docs(ocr): document LOCAL_HARDSCAN_OCR + VISION_OFFLOAD + mix-issue debt"
```

---

## Notes for the implementer

- **No schema/migration.** The result stays `method:'vision'`; the local-vs-OpenAI backend distinction lives in logs, not a persisted enum. Do not add a new `extraction_method` value.
- **Don't touch** the Granite block (lane 2), born-digital text extraction, `describeSlide`/slide description, or the `visionOffloadConfig()` env contract beyond what Task 4 documents.
- **The `forceOffload` inner safety net stays:** if a page errors on the Spark, `twoPhaseOffload` still falls that page back to the on-Mac omlx `local` runner — that's intended (still local), and separate from the seam-level OpenAI fallback in Task 3.
- **Fallback semantics:** the OpenAI fallback uses `getProvider()` (the configured default), which is OpenAI in production (`AI_PROVIDER=openai`). If `AI_PROVIDER` were `local`, `getProvider()` would itself be local — acceptable, since the intent is "the configured reliable default as last resort."
```
