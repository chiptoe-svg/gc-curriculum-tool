# Ingest local-only mode + completion gate Implementation Plan (Spec B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "use local/free models" toggle to the CourseCapture Triage step that runs a whole ingest run on-prem (image-PDF transcription → omlx; text OpenAI fallback suppressed), plus a hard completion gate so the user can't reach the interview until ingestion finishes.

**Architecture:** A nullable `course_materials.ingest_provider` column (`null`=hybrid, `'local'`=local-only) carries the per-run mode restart-safely. The worker reads it and (a) injects a local vision provider into `extractText` for image-PDF transcription and (b) passes `noOpenAIFallback` to the digest/contextualize text calls. The Triage UI sends the mode, then polls material status until every queued material is terminal before enabling "Continue to interview".

**Tech Stack:** Next.js 15 / React, TypeScript strict, Drizzle + Postgres 17, Vitest. Spec: `docs/superpowers/specs/2026-06-23-ingest-provider-estimates-completion-design.md`.

**Spec A dependency:** The middle-tier slide-note model (`describeSlide`) is Spec A's concern; this plan does **not** touch it. The local image-PDF transcription model is `Qwen3.6-35B-A3B` (already settled), via the new `LOCAL_VISION_MODEL` env.

---

### Task 1: `ingest_provider` schema column + migration

**Files:**
- Modify: `lib/db/schema.ts:304` (end of `courseMaterials`, after `rawCleared`)
- Create: `drizzle/0045_*.sql` (generated)

- [ ] **Step 1: Add the column to the Drizzle schema**

In `lib/db/schema.ts`, inside `courseMaterials`, immediately after the `rawCleared` field (line 304) and before the closing `});`:

```ts
  // Per-run ingest mode, set when the Triage "Ingest & continue" enqueues a row.
  // null = hybrid (default: OpenAI image-PDF transcription, campus text w/ OpenAI
  // fallback). 'local' = local-only run (omlx transcription, campus text w/ the
  // OpenAI fallback suppressed). Persisted so a worker restart keeps the mode.
  // Migration 0045.
  ingestProvider: text('ingest_provider'),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `drizzle/0045_<name>.sql` containing exactly:
```sql
ALTER TABLE "course_materials" ADD COLUMN "ingest_provider" text;
```
and an appended entry in `drizzle/meta/_journal.json` (idx 45) + `drizzle/meta/0045_snapshot.json`.

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies cleanly; `\d course_materials` shows the `ingest_provider` column.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts drizzle/0045_*.sql drizzle/meta/_journal.json drizzle/meta/0045_snapshot.json
git commit -m "feat(db): add course_materials.ingest_provider (migration 0045)"
```

---

### Task 2: Query layer — map the field + stamp it on enqueue

**Files:**
- Modify: `lib/db/course-materials-queries.ts:42` (`mapMaterialRow`), `:258` (`updateIndexingStatus`)
- Test: `lib/db/course-materials-queries.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `lib/db/course-materials-queries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { __mapMaterialRowForTest } from './course-materials-queries';

describe('mapMaterialRow', () => {
  it('maps ingest_provider (incl. null)', () => {
    const base = {
      id: 'a', course_code: 'GC 1010', file_name: 'f', blob_url: 'u', mime_type: 'application/pdf',
      size_bytes: 1, page_count: null, extraction_method: null, extraction_status: 'pending',
      extracted_text: null, analysis_finding: null, analysis_model: null, analysis_cost_usd_cents: null,
      uploaded_at: new Date(), ip_hash: 'h', digest: null, digest_model: null, digest_generated_at: null,
      use_digest: false, ferpa_risk: 'low', auto_set_aside: false, set_aside_reason: null,
      indexing_status: 'queued', tier: null, indexed_at: null, ignored: false, ignored_items: null,
      source_code: null, raw_cleared: false, retired_at: null,
    };
    expect(__mapMaterialRowForTest({ ...base, ingest_provider: 'local' }).ingestProvider).toBe('local');
    expect(__mapMaterialRowForTest({ ...base, ingest_provider: null }).ingestProvider).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/db/course-materials-queries.test.ts`
Expected: FAIL — `__mapMaterialRowForTest` not exported / `ingestProvider` undefined.

- [ ] **Step 3: Implement**

In `lib/db/course-materials-queries.ts`, add to the `mapMaterialRow` return object (after `retiredAt:` on line 42):

```ts
    retiredAt: row['retired_at'] as Date | null,
    ingestProvider: row['ingest_provider'] as string | null,
```

At the bottom of the file, export a test seam:

```ts
/** Test seam — exercise the raw-row mapper directly. */
export const __mapMaterialRowForTest = mapMaterialRow;
```

Extend `updateIndexingStatus` (line 258) to optionally write the column:

```ts
export async function updateIndexingStatus(args: {
  id: string;
  status: 'pending' | 'queued' | 'indexing' | 'ready' | 'failed' | 'skipped';
  indexedAt?: Date;
  /** When present, also write ingest_provider (null clears it). Omit to leave it untouched. */
  ingestProvider?: string | null;
}): Promise<void> {
  await db.update(courseMaterials)
    .set({
      indexingStatus: args.status,
      ...(args.indexedAt ? { indexedAt: args.indexedAt } : {}),
      ...(args.ingestProvider !== undefined ? { ingestProvider: args.ingestProvider } : {}),
    })
    .where(eq(courseMaterials.id, args.id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/db/course-materials-queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/course-materials-queries.ts lib/db/course-materials-queries.test.ts
git commit -m "feat(db): map ingestProvider + optional write in updateIndexingStatus"
```

---

### Task 3: `buildLocalProvider` + `LOCAL_VISION_MODEL`

**Files:**
- Modify: `lib/ai/provider.ts:196` (after `buildProvider`)
- Test: `lib/ai/provider.test.ts` (create/append)

A local provider is needed for image-PDF transcription even when `AI_PROVIDER=openai`, so it can't go through `buildProvider` (which is locked to the global provider).

- [ ] **Step 1: Write the failing test**

Append `lib/ai/provider.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildLocalProvider } from './provider';

describe('buildLocalProvider', () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = 'openai'; // prod-like: global is OpenAI
    process.env.LOCAL_BASE_URL = 'http://localhost:8000/v1';
    process.env.LOCAL_API_KEY = 'godfrey';
    delete process.env.LOCAL_VISION_MODEL;
  });

  it('returns a LocalProvider regardless of AI_PROVIDER', () => {
    const p = buildLocalProvider();
    expect(p.name).toBe('local');
    expect(p.model).toBe('Qwen3.6-35B-A3B-UD-MLX-4bit'); // LOCAL_VISION_MODEL default
  });

  it('honors LOCAL_VISION_MODEL and an explicit override', () => {
    process.env.LOCAL_VISION_MODEL = 'some-vlm';
    expect(buildLocalProvider().model).toBe('some-vlm');
    expect(buildLocalProvider('override-vlm').model).toBe('override-vlm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/ai/provider.test.ts`
Expected: FAIL — `buildLocalProvider` not exported.

- [ ] **Step 3: Implement**

In `lib/ai/provider.ts`, after `buildProvider` (line ~196) and before the final `export type` line, add:

```ts
/**
 * Build a LocalProvider (omlx) for vision transcription, independent of the
 * global AI_PROVIDER. Used by the ingest worker's local-only mode to route
 * image-PDF transcription to omlx while the rest of the app stays on OpenAI.
 * Model resolution: explicit arg → LOCAL_VISION_MODEL → Qwen3.6-35B-A3B default.
 */
export function buildLocalProvider(model?: string): AIProvider {
  const baseURL = process.env.LOCAL_BASE_URL?.trim() || 'http://localhost:8000/v1';
  const apiKey = process.env.LOCAL_API_KEY?.trim();
  if (!apiKey) throw new Error('LOCAL_API_KEY not set');
  const resolved = model ?? process.env.LOCAL_VISION_MODEL?.trim() ?? 'Qwen3.6-35B-A3B-UD-MLX-4bit';
  return new LocalProvider(resolved, baseURL, apiKey);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/ai/provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/provider.ts lib/ai/provider.test.ts
git commit -m "feat(ai): buildLocalProvider for AI_PROVIDER-independent local vision"
```

---

### Task 4: Implement `LocalProvider.transcribeDocument`

**Files:**
- Modify: `lib/ai/local.ts:76` (replace the throwing stub)
- Test: `lib/ai/local-transcribe.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/ai/local-transcribe.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the renderer: two fake page PNGs.
vi.mock('@/lib/capture/render-pages', () => ({
  MAX_SLIDES: 60,
  renderToImages: vi.fn(async () => [Buffer.from('png1'), Buffer.from('png2')]),
}));

import { LocalProvider } from './local';

function fakeClient(contents: string[]) {
  const create = vi.fn(async () => ({
    choices: [{ message: { content: contents.shift() ?? '' } }],
  }));
  return { create, chat: { completions: { create } } };
}

describe('LocalProvider.transcribeDocument', () => {
  let p: LocalProvider;
  beforeEach(() => {
    p = new LocalProvider('Qwen3.6-35B-A3B-UD-MLX-4bit', 'http://localhost:8000/v1', 'godfrey');
  });

  it('concatenates page texts in order, sends enable_thinking:false, cost 0', async () => {
    const client = fakeClient(['PAGE ONE', 'PAGE TWO']);
    (p as unknown as { client: typeof client }).client = client;

    const res = await p.transcribeDocument({ fileBytes: Buffer.from('pdf'), mimeType: 'application/pdf' });

    expect(res.text).toBe('PAGE ONE\n\nPAGE TWO');
    expect(res.costUsdCents).toBe(0);
    expect(res.truncated).toBe(false);
    // chat_template_kwargs.enable_thinking === false on every call
    for (const call of client.create.mock.calls) {
      expect((call[0] as { chat_template_kwargs?: { enable_thinking?: boolean } }).chat_template_kwargs?.enable_thinking).toBe(false);
    }
  });

  it('truncates at maxPages and flags truncated', async () => {
    const client = fakeClient(['ONLY ONE']);
    (p as unknown as { client: typeof client }).client = client;
    const res = await p.transcribeDocument({ fileBytes: Buffer.from('pdf'), mimeType: 'application/pdf', maxPages: 1 });
    expect(res.text).toBe('ONLY ONE');
    expect(res.truncated).toBe(true); // 2 rendered, capped to 1
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/ai/local-transcribe.test.ts`
Expected: FAIL — stub throws "Local provider does not support document vision transcription."

- [ ] **Step 3: Implement**

In `lib/ai/local.ts`, add an import at the top (after the existing imports):

```ts
import { renderToImages } from '@/lib/capture/render-pages';
```

Replace the `transcribeDocument` stub (lines 74–81) with:

```ts
  // Render the document to page PNGs and transcribe each via the omlx vision
  // model (OpenAI-compatible chat with an image_url part + enable_thinking:false).
  // Pages run at low concurrency (memory-bound) and are concatenated in order.
  // Cost is always 0 for the local provider.
  async transcribeDocument(args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult> {
    const PROMPT =
      'Please transcribe every piece of text visible in this document image. ' +
      'Return plain text only, preserving the reading order. Do not add commentary.';
    const maxPages = args.maxPages ?? 40;

    const rendered = await renderToImages(args.fileBytes, args.mimeType, 'document');
    if (rendered.length === 0) {
      throw new Error('LocalProvider.transcribeDocument: renderToImages produced no pages');
    }
    const truncated = rendered.length > maxPages;
    const pages = truncated ? rendered.slice(0, maxPages) : rendered;

    const CONCURRENCY = 2;
    const texts: string[] = new Array(pages.length).fill('');
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < pages.length) {
        const i = next++;
        const dataUri = `data:image/png;base64,${pages[i]!.toString('base64')}`;
        const resp = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: PROMPT },
                { type: 'image_url', image_url: { url: dataUri } },
              ],
            },
          ],
          temperature: 0,
          max_tokens: 4096,
          // omlx-specific: pass through to the chat template so Qwen3.6 skips
          // its reasoning trace (keeps `content` to the raw transcription).
          chat_template_kwargs: { enable_thinking: false },
        } as Parameters<typeof this.client.chat.completions.create>[0]);
        texts[i] = ((resp as { choices?: Array<{ message?: { content?: string } }> })
          .choices?.[0]?.message?.content ?? '').trim();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker));

    return { text: texts.join('\n\n').trim(), costUsdCents: 0, truncated };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/ai/local-transcribe.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/local.ts lib/ai/local-transcribe.test.ts
git commit -m "feat(ai): implement LocalProvider.transcribeDocument (omlx vision)"
```

---

### Task 5: `extractText` — injectable vision provider

**Files:**
- Modify: `lib/courses/extract-text.ts:50` (signature) and `:99` (the `getProvider()` call)
- Test: `lib/courses/extract-text-vision-provider.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/courses/extract-text-vision-provider.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

// Force the image-based-PDF branch: extractor returns near-empty text for a PDF.
vi.mock('@/lib/courses/material-extractor', () => ({
  SUPPORTED_MIME_TYPES: ['application/pdf'],
  getExtractorFor: () => ({ extract: async () => ({ text: '', pageCount: 3 }) }),
}));
vi.mock('@/lib/courses/legacy-converter', () => ({
  isLegacyOfficeMime: () => false,
  convertLegacyToModern: async () => { throw new Error('unused'); },
}));
// getProvider must NOT be used when a visionProvider is injected.
const getProvider = vi.fn(() => { throw new Error('getProvider should not be called'); });
vi.mock('@/lib/ai/provider', () => ({ getProvider }));

import { extractText } from './extract-text';

describe('extractText with injected vision provider', () => {
  it('routes image-PDF transcription to the injected provider', async () => {
    const transcribeDocument = vi.fn(async () => ({ text: 'LOCAL TRANSCRIPT', costUsdCents: 0, truncated: false }));
    const res = await extractText(
      { fileBytes: Buffer.from('pdf'), mimeType: 'application/pdf', fileName: 'scan.pdf' },
      { visionProvider: { transcribeDocument } as never },
    );
    expect(transcribeDocument).toHaveBeenCalledOnce();
    expect(getProvider).not.toHaveBeenCalled();
    expect(res).toMatchObject({ method: 'vision', status: 'ok', text: 'LOCAL TRANSCRIPT' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/courses/extract-text-vision-provider.test.ts`
Expected: FAIL — `extractText` ignores the 2nd arg, calls `getProvider`, throws.

- [ ] **Step 3: Implement**

In `lib/courses/extract-text.ts`, add an options param. Change the signature (line 50) and the provider acquisition (line 99):

```ts
export interface ExtractTextOptions {
  /** When set, image-PDF vision transcription uses this provider instead of the
   *  global getProvider(). Used by the ingest worker's local-only mode. */
  visionProvider?: import('@/lib/ai/provider').AIProvider;
}

export async function extractText(args: ExtractTextArgs, opts?: ExtractTextOptions): Promise<ExtractTextResult> {
```

At the vision call (was line 99):

```ts
        const provider = opts?.visionProvider ?? getProvider();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/courses/extract-text-vision-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/courses/extract-text.ts lib/courses/extract-text-vision-provider.test.ts
git commit -m "feat(extract): inject vision provider for local-mode image-PDF transcription"
```

---

### Task 6: `chunkLlmComplete` — suppress OpenAI fallback

**Files:**
- Modify: `lib/ai/analyze/chunk-llm-provider.ts:29`, `lib/ai/analyze/material-digest.ts:19`, `lib/ai/analyze/chunk-contextualize.ts:21`
- Test: `lib/ai/analyze/chunk-llm-provider.test.ts` (create/append)

- [ ] **Step 1: Write the failing test**

Create/append `lib/ai/analyze/chunk-llm-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const campusComplete = vi.fn();
const openaiComplete = vi.fn(async () => ({ data: { ok: true }, costUsdCents: 0, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 1, completionTokens: 1 }));

vi.mock('@/lib/ai/campus', () => ({
  CampusProvider: class { model = 'gptoss-120b'; complete = campusComplete; constructor() {} },
}));
vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: async () => ({ model: 'gpt-5.4-mini', complete: openaiComplete }),
}));

import { chunkLlmComplete } from './chunk-llm-provider';

const args = { systemPrompt: 's', userMessage: 'u', schemaName: 'x', jsonSchema: {}, validate: (r: unknown) => r } as never;

describe('chunkLlmComplete noOpenAIFallback', () => {
  beforeEach(() => {
    process.env.CAMPUS_LLM_BASE_URL = 'http://campus/v1';
    process.env.CAMPUS_LLM_API_KEY = 'k';
    delete process.env.CHUNK_LLM_SKIP_CAMPUS;
    campusComplete.mockReset(); openaiComplete.mockClear();
    campusComplete.mockRejectedValue(new Error('campus down'));
  });

  it('falls back to OpenAI by default', async () => {
    await chunkLlmComplete('material-digest', args);
    expect(openaiComplete).toHaveBeenCalledOnce();
  });

  it('rethrows and never calls OpenAI when noOpenAIFallback is set', async () => {
    await expect(chunkLlmComplete('material-digest', args, { noOpenAIFallback: true })).rejects.toThrow('campus down');
    expect(openaiComplete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/ai/analyze/chunk-llm-provider.test.ts`
Expected: FAIL — `chunkLlmComplete` takes no 3rd arg; the noOpenAIFallback case still falls back.

- [ ] **Step 3: Implement**

In `lib/ai/analyze/chunk-llm-provider.ts`, change the signature and the campus catch block:

```ts
export async function chunkLlmComplete<T>(
  funcId: AIFunctionId,
  args: CompleteArgs<T>,
  opts?: { noOpenAIFallback?: boolean },
): Promise<{ data: T; model: string } & CompletionTelemetry> {
  const campus = campusOss();
  if (campus) {
    try {
      const r = await campus.complete<T>(args);
      return { ...r, model: campus.model };
    } catch (e) {
      if (opts?.noOpenAIFallback) throw e; // local-only mode: surface as a failed material, no paid fallback
      console.warn(`[chunk-llm] campus ${campus.model} failed → OpenAI fallback:`, e instanceof Error ? e.message : e);
    }
  } else if (opts?.noOpenAIFallback) {
    // Local-only mode with campus unconfigured/disabled has no free path — fail loudly.
    throw new Error('chunkLlmComplete: local-only mode but campus provider is unavailable');
  }
  const provider = await getProviderForFunction(funcId);
  const r = await provider.complete<T>(args);
  return { ...r, model: provider.model };
}
```

Thread the option through `generateMaterialDigest` (`lib/ai/analyze/material-digest.ts`):

```ts
export async function generateMaterialDigest(
  input: DigestInput,
  opts?: { noOpenAIFallback?: boolean },
): Promise<DigestResult> {
```
and pass it at the `chunkLlmComplete` call (line ~41):
```ts
  const { data, model } = await chunkLlmComplete<{ digest: string }>('material-digest', {
    systemPrompt, userMessage, schemaName: 'material_digest', jsonSchema,
    validate: (raw) => { /* unchanged */
      const r = raw as { digest?: unknown };
      if (typeof r.digest !== 'string' || r.digest.trim().length === 0) {
        throw new Error('material-digest: empty or non-string digest in response');
      }
      return { digest: r.digest };
    },
  }, opts);
```

Same for `contextualizeChunk` (`lib/ai/analyze/chunk-contextualize.ts`):
```ts
export async function contextualizeChunk(
  input: ContextualizeInput,
  opts?: { noOpenAIFallback?: boolean },
): Promise<ContextualizeResult> {
```
and append `, opts` as the 3rd arg of its `chunkLlmComplete<{ blurb: string }>(...)` call.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/ai/analyze/chunk-llm-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/analyze/chunk-llm-provider.ts lib/ai/analyze/material-digest.ts lib/ai/analyze/chunk-contextualize.ts lib/ai/analyze/chunk-llm-provider.test.ts
git commit -m "feat(ai): chunkLlmComplete noOpenAIFallback option (local-only mode)"
```

---

### Task 7: `finalizeExtraction` — thread `noOpenAIFallback`

**Files:**
- Modify: `lib/capture/finalize-extraction.ts:24` (input type), `:171`, `:324`, `:388` (the digest/contextualize calls)

No new test file — covered indirectly by Task 8's worker test and Task 6's unit test. This is pure threading.

- [ ] **Step 1: Add the field to the input type**

In `FinalizeExtractionInput` (line ~42, after `mimeType?: string;`):

```ts
  /** Local-only run: suppress the OpenAI fallback in digest/contextualize. */
  noOpenAIFallback?: boolean;
```

- [ ] **Step 2: Pass it at the three v2 call sites**

Line ~171 (main digest):
```ts
    const { digest, model } = await generateMaterialDigest({ fileName, extractedText }, { noOpenAIFallback: input.noOpenAIFallback });
```
Line ~324 (middle/prose per-section digest):
```ts
      (s) => generateMaterialDigest({ fileName: `${fileName} — ${s.title}`, extractedText: s.text }, { noOpenAIFallback: input.noOpenAIFallback }),
```
Line ~388 (contextualize):
```ts
      details.map(d => contextualizeChunk({
        materialDigest: digestText,
        sectionTitle: d.sectionTitle,
        chunkText: d.text,
      }, { noOpenAIFallback: input.noOpenAIFallback })),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/capture/finalize-extraction.ts
git commit -m "feat(capture): thread noOpenAIFallback through finalizeExtraction v2 path"
```

---

### Task 8: Worker — read mode, inject local vision + fallback suppression

**Files:**
- Modify: `lib/capture/ingest-queue.ts:54` (`enqueue`), `:111`–`:165` (`processMaterial`)
- Test: `lib/capture/ingest-queue-mode.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/capture/ingest-queue-mode.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateIndexingStatus = vi.fn(async () => {});
vi.mock('@/lib/db/course-materials-queries', () => ({
  updateIndexingStatus,
  claimNextQueued: async () => null,
  resetStuckIndexing: async () => 0,
}));

import { enqueue } from './ingest-queue';

describe('enqueue stamps ingest_provider', () => {
  beforeEach(() => updateIndexingStatus.mockClear());

  it("passes ingestProvider:'local' when given", async () => {
    await enqueue('m1', { ingestProvider: 'local' });
    expect(updateIndexingStatus).toHaveBeenCalledWith({ id: 'm1', status: 'queued', ingestProvider: 'local' });
  });

  it('passes ingestProvider:null for hybrid', async () => {
    await enqueue('m2', { ingestProvider: null });
    expect(updateIndexingStatus).toHaveBeenCalledWith({ id: 'm2', status: 'queued', ingestProvider: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/capture/ingest-queue-mode.test.ts`
Expected: FAIL — `enqueue` takes no 2nd arg; `ingestProvider` not forwarded.

- [ ] **Step 3: Implement**

In `lib/capture/ingest-queue.ts`, add the import:
```ts
import { buildLocalProvider } from '@/lib/ai/provider';
```

Change `enqueue` (line 54):
```ts
/** Mark a material queued and ensure the worker is draining. Idempotent.
 *  `opts.ingestProvider` stamps the per-run mode ('local' | null). */
export async function enqueue(materialId: string, opts?: { ingestProvider?: string | null }): Promise<void> {
  await updateIndexingStatus({
    id: materialId,
    status: 'queued',
    ...(opts && 'ingestProvider' in opts ? { ingestProvider: opts.ingestProvider } : {}),
  });
  wake = true;
  ensureWorker();
}
```

In `processMaterial`, compute the mode once at the top (after `try {`), then use it at the `extractText` and `finalizeExtraction` calls:
```ts
  try {
    const isLocal = row.ingestProvider === 'local';
    // ...existing extractedText / extractionStatus / pageCount / fileBytes setup...
```
At the `extractText` call (line ~130):
```ts
      const ex = await extractText(
        { fileBytes: bytes, mimeType: row.mimeType as ExtractedMimeType, fileName: row.fileName },
        isLocal ? { visionProvider: buildLocalProvider() } : undefined,
      );
```
At the `finalizeExtraction` call (line ~151), add the field alongside the others:
```ts
      noOpenAIFallback: isLocal,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/capture/ingest-queue-mode.test.ts`
Expected: PASS. Also run the existing `pnpm vitest run lib/capture/ingest-queue.test.ts` (if present) — expected still green.

- [ ] **Step 5: Commit**

```bash
git add lib/capture/ingest-queue.ts lib/capture/ingest-queue-mode.test.ts
git commit -m "feat(capture): worker honors ingest_provider (local vision + no-fallback)"
```

---

### Task 9: `v2-backfill` route — accept `mode`, stamp on enqueue

**Files:**
- Modify: `app/api/admin/v2-backfill/route.ts:25` (body parse), `:61` (enqueue call)
- Test: `app/api/admin/v2-backfill/route.test.ts` (create/append)

- [ ] **Step 1: Write the failing test**

Create/append `app/api/admin/v2-backfill/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const enqueue = vi.fn(async () => {});
vi.mock('@/lib/capture/ingest-queue', () => ({ enqueue }));
vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: () => true }));
vi.mock('@/lib/capture/ingest-selection', () => ({ ingestAction: () => 'queue' }));
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ code: 'GC 1010' }] }) }) }),
  },
}));
// Second db.select (materials list) — make the chainable mock return one material.
// (Adjust the mock shape to your db harness; the key assertions are the enqueue args + status.)

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://x/api/admin/v2-backfill', { method: 'POST', body: JSON.stringify(body) });
}

describe('v2-backfill mode param', () => {
  beforeEach(() => enqueue.mockClear());

  it('rejects an invalid mode with 400', async () => {
    const res = await POST(req({ courseCode: 'GC 1010', slug: 's', mode: 'bogus' }));
    expect(res.status).toBe(400);
  });
});
```

> Note: the materials-list `db.select()` mock shape depends on the existing test harness; if `app/api/admin/v2-backfill/route.test.ts` already exists, extend it and reuse its db mock. The load-bearing new assertions are: invalid `mode` → 400, and (where the harness allows enqueuing) `enqueue` called with `{ ingestProvider: 'local' }` for `mode:'local'` and `{ ingestProvider: null }` otherwise.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/api/admin/v2-backfill/route.test.ts`
Expected: FAIL — no `mode` validation; invalid mode does not 400.

- [ ] **Step 3: Implement**

In `app/api/admin/v2-backfill/route.ts`, extend the body parse (line 25) and validate:

```ts
  const body = await req.json().catch(() => ({})) as { courseCode?: unknown; slug?: unknown; mode?: unknown };
```
After the `courseCode` guard (line ~32), add:
```ts
  const mode = body.mode === undefined ? 'hybrid' : body.mode;
  if (mode !== 'hybrid' && mode !== 'local') {
    return NextResponse.json({ error: "mode must be 'hybrid' or 'local'" }, { status: 400 });
  }
  const ingestProvider = mode === 'local' ? 'local' : null;
```
Change the enqueue call (line 61):
```ts
      await enqueue(m.id, { ingestProvider });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run app/api/admin/v2-backfill/route.test.ts`
Expected: PASS (the 400 case at minimum; enqueue-args cases if the harness enqueues).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/v2-backfill/route.ts app/api/admin/v2-backfill/route.test.ts
git commit -m "feat(api): v2-backfill accepts mode and stamps ingest_provider"
```

---

### Task 10: TriageStep — "use local" checkbox + send mode

**Files:**
- Modify: `app/capture/[code]/TriageStep.tsx:285` (state), `:332` (handleIngest body), `:436` (footer UI)
- Test: `app/capture/[code]/TriageStep.test.tsx` (create/append)

- [ ] **Step 1: Write the failing test**

Create/append `app/capture/[code]/TriageStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TriageStep } from './TriageStep';

vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: async () => null }));

const mat = (over = {}) => ({ id: 'm1', fileName: 'f.pdf', mimeType: 'application/pdf', tier: 'high', indexingStatus: 'pending', ignored: false, pageCount: 2, ...over });

describe('TriageStep use-local checkbox', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("sends mode:'local' when the box is checked", async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [], queued: 0 }), { status: 200 }),
    );
    render(<TriageStep courseCode="GC 1010" slug="s" materials={[mat()] as never} onIngested={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByLabelText(/use local/i));
    fireEvent.click(screen.getByRole('button', { name: /ingest/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const call = fetchSpy.mock.calls.find(c => String(c[0]).includes('v2-backfill'))!;
    expect(JSON.parse((call[1] as RequestInit).body as string).mode).toBe('local');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/capture/[code]/TriageStep.test.tsx`
Expected: FAIL — no "use local" checkbox; body has no `mode`.

- [ ] **Step 3: Implement**

Add state (after line 286):
```ts
  const [useLocal, setUseLocal] = useState(false);
```
In `handleIngest`, include the mode in the POST body (line ~339):
```ts
        body: JSON.stringify({ courseCode, slug, mode: useLocal ? 'local' : 'hybrid' }),
```
In the footer (replace the estimate+button block, lines 436–451) add the checkbox + caveat above the button:
```tsx
      <div className="mt-6 flex flex-col items-end gap-1.5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={useLocal}
            onChange={(e) => setUseLocal(e.target.checked)}
            disabled={ingesting}
          />
          <span aria-label="use local/free models">Use local/free models — no API cost, nothing leaves campus</span>
        </label>
        {useLocal && (
          <p className="text-[10px] text-amber-700/80">May run longer for scanned/image PDFs.</p>
        )}
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Estimated:</span> {total.label} · 2 at a time
          </p>
          <p className="text-[10px] text-muted-foreground/70">rough estimate</p>
        </div>
        {/* button block from Task 11 replaces the simple button here */}
        <button
          type="button"
          onClick={() => void handleIngest()}
          disabled={ingesting}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {ingesting ? 'Ingesting…' : 'Ingest & continue →'}
        </button>
      </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run app/capture/[code]/TriageStep.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/capture/[code]/TriageStep.tsx" "app/capture/[code]/TriageStep.test.tsx"
git commit -m "feat(capture): use-local checkbox sends ingest mode"
```

---

### Task 11: TriageStep — completion hard-gate

**Files:**
- Modify: `app/capture/[code]/TriageStep.tsx` (replace `handleIngest` completion behavior + footer button with a gated lifecycle)
- Test: `app/capture/[code]/TriageStep.test.tsx` (append)

Lifecycle: `phase: 'idle' | 'ingesting' | 'done'`. On Ingest → POST with mode → capture the queued ids from the response → `phase='ingesting'` → poll `fetchCourseMaterials` every 3 s, counting how many queued ids are terminal (`ready|failed|skipped`) → when all terminal → `phase='done'` with counts → "Continue to interview →" (enabled) calls `onIngested()`. If zero queued, go straight to `done`.

- [ ] **Step 1: Write the failing test**

Append to `app/capture/[code]/TriageStep.test.tsx`:

```tsx
import { act } from '@testing-library/react';

describe('TriageStep completion gate', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('gates Continue until all queued materials are terminal', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [{ id: 'm1', status: 'queued' }], queued: 1 }), { status: 200 }),
    );
    // Test-controlled status (mutable) — robust to the mount-sync useEffect, which
    // also calls fetchCourseMaterials. A call counter would be thrown off by it.
    let status = 'indexing';
    const fetchMaterials = await import('@/lib/capture/fetch-course-materials');
    vi.spyOn(fetchMaterials, 'fetchCourseMaterials').mockImplementation(
      async () => [{ id: 'm1', indexingStatus: status, ignored: false }] as never,
    );

    const onIngested = vi.fn();
    render(<TriageStep courseCode="GC 1010" slug="s" materials={[{ id: 'm1', fileName: 'f.pdf', mimeType: 'application/pdf', tier: 'high', indexingStatus: 'pending', ignored: false, pageCount: 2 }] as never} onIngested={onIngested} onBack={() => {}} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /ingest/i })); });
    // While indexing: no Continue button.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); // poll sees 'indexing'
    expect(screen.queryByRole('button', { name: /continue to interview/i })).toBeNull();
    status = 'ready';
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); // poll sees 'ready'
    const cont = await screen.findByRole('button', { name: /continue to interview/i });
    fireEvent.click(cont);
    expect(onIngested).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run app/capture/[code]/TriageStep.test.tsx`
Expected: FAIL — `handleIngest` calls `onIngested()` immediately; no "Continue to interview" gate.

- [ ] **Step 3: Implement**

Replace the `ingesting`/`ingestError` state (lines 285–286) with the lifecycle state:

```ts
  const [phase, setPhase] = useState<'idle' | 'ingesting' | 'done'>('idle');
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ total: number; terminal: number; ready: number; failed: number; skipped: number }>(
    { total: 0, terminal: 0, ready: 0, failed: 0, skipped: 0 },
  );
```

Replace `handleIngest` (lines 332–352) with:

```ts
  async function handleIngest(): Promise<void> {
    setPhase('ingesting');
    setIngestError(null);
    try {
      const res = await fetch('/api/admin/v2-backfill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseCode, slug, mode: useLocal ? 'local' : 'hybrid' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setIngestError(body.error ?? `Failed (${res.status})`);
        setPhase('idle');
        return;
      }
      const data = await res.json().catch(() => ({})) as { results?: Array<{ id: string; status: string }> };
      const queuedIds = (data.results ?? []).filter(r => r.status === 'queued').map(r => r.id);
      if (queuedIds.length === 0) {
        setProgress({ total: 0, terminal: 0, ready: 0, failed: 0, skipped: 0 });
        setPhase('done');
        return;
      }
      void pollUntilDone(queuedIds);
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : 'Ingest failed');
      setPhase('idle');
    }
  }

  async function pollUntilDone(ids: string[]): Promise<void> {
    const TERMINAL = new Set(['ready', 'failed', 'skipped']);
    const tick = async (): Promise<void> => {
      const fresh = await fetchCourseMaterials(courseCode, slug);
      const byId = new Map((fresh ?? []).map(m => [m.id, m.indexingStatus]));
      let ready = 0, failed = 0, skipped = 0, terminal = 0;
      for (const id of ids) {
        const s = byId.get(id);
        if (s === 'ready') { ready++; terminal++; }
        else if (s === 'failed') { failed++; terminal++; }
        else if (s === 'skipped') { skipped++; terminal++; }
      }
      setProgress({ total: ids.length, terminal, ready, failed, skipped });
      if (terminal >= ids.length) { setPhase('done'); return; }
      setTimeout(() => { void tick(); }, 3000);
    };
    await tick();
  }
```

Replace the footer button (the `<button … Ingest & continue →>` from Task 10) with a phase-driven block:

```tsx
        {phase === 'idle' && (
          <button
            type="button"
            onClick={() => void handleIngest()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Ingest &amp; continue →
          </button>
        )}
        {phase === 'ingesting' && (
          <div className="w-full max-w-xs text-right">
            <p className="text-sm text-muted-foreground">
              Ingesting {progress.terminal} of {progress.total}…
            </p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress.total ? Math.round((progress.terminal / progress.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
        {phase === 'done' && (
          <div className="flex flex-col items-end gap-1.5">
            <p className="text-sm text-emerald-700">
              ✓ Ingestion complete ({progress.ready} ready{progress.skipped ? `, ${progress.skipped} skipped` : ''}{progress.failed ? `, ${progress.failed} failed` : ''})
            </p>
            <button
              type="button"
              onClick={() => onIngested()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Continue to interview →
            </button>
          </div>
        )}
```

Update the checkbox `disabled={ingesting}` → `disabled={phase !== 'idle'}` (the `ingesting` boolean no longer exists).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run app/capture/[code]/TriageStep.test.tsx`
Expected: PASS (both checkbox and gate tests).

- [ ] **Step 5: Commit**

```bash
git add "app/capture/[code]/TriageStep.tsx" "app/capture/[code]/TriageStep.test.tsx"
git commit -m "feat(capture): completion hard-gate before interview (poll until terminal)"
```

---

### Task 12: Full-suite green + STATE.md + env docs

**Files:**
- Modify: `docs/STATE.md`, `docs/superpowers/running-locally.md` (env), `.env.example` if present

- [ ] **Step 1: Run the full suite + typecheck**

Run: `pnpm vitest run && pnpm exec tsc --noEmit`
Expected: all green, no type errors. Fix any regressions before proceeding.

- [ ] **Step 2: Update STATE.md** (per the spec §8 — the trigger surfaces all changed):
  - Schema: migration `0045` + `course_materials.ingest_provider` (`null`=hybrid, `'local'`=local-only).
  - AI functions/providers: local `transcribeDocument` implemented; `buildLocalProvider`; `chunkLlmComplete` `noOpenAIFallback`; `v2-backfill` `mode`. Note middle-tier slide vision was **already** local (surfaced, not changed).
  - Env vars: `LOCAL_VISION_MODEL` (default `Qwen3.6-35B-A3B-UD-MLX-4bit`).
  - What's live: Triage use-local checkbox + completion gate.
  - Deferred/debt: estimate deliberately not mode-aware (image-PDF cost undetectable pre-ingest); slide-note model/schema is Spec A's call.

- [ ] **Step 3: Document the env var** in `docs/superpowers/running-locally.md` (and `.env.example` if it exists): `LOCAL_VISION_MODEL`.

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md docs/superpowers/running-locally.md .env.example 2>/dev/null
git commit -m "docs(state): ingest local-only mode + completion gate (Spec B) landed"
```

---

## Self-review notes (for the implementer)

- **Type consistency:** `ingestProvider` is `string | null` end-to-end (`CourseMaterialRow`, `updateIndexingStatus`, `enqueue` opts, `processMaterial` reads `=== 'local'`). The HTTP boundary uses `mode: 'hybrid' | 'local'`; only the DB column stores the narrower `'local' | null`.
- **No silent OpenAI in local mode:** vision is dispatched to `buildLocalProvider()` (never `getProvider()`), and `noOpenAIFallback` rethrows on campus failure — both verified by Task 4/5/6/8 tests. A failure becomes a `failed` material, which the gate treats as terminal (Task 11).
- **Restart safety:** `claimNextQueued`/`resetStuckIndexing` use raw SQL that doesn't touch `ingest_provider`, so the mode persists across a worker restart (Task 1 column + Task 8 read).
- **Estimate untouched:** per spec §3.A, no `mode` param on the estimate — the gate shows real progress instead.
