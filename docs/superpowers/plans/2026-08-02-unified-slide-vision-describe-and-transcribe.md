# Unified Slide Vision + Extracted-Text Contamination Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop model self-talk (Flavour A: docling picture-description reasoning preambles) and failure narration (Flavour B: qwen verbatim-transcribe narrating empty slides) from being persisted as `extracted_text`, by adding a persistence-boundary scrub and replacing the split slide workflows with one adaptive describe-and-transcribe pass.

**Architecture:** Two independent lines of defense. (1) `sanitizeExtractedText` runs at the single persistence funnel (`finalizeExtraction`) and scrubs both flavours from *any* source path — the only fix for Flavour A (docling gemma ignores its "no preamble" prompt) and a backstop for B. (2) The slide-vision path is reframed to one adaptive prompt (`SlideNote.text` verbatim + `keyVisual` imagery), so `transcribeDocument`'s verbatim-only prompt — which *produces* Flavour B — is removed from the image-PDF path, and `extracted_text` is derived from that single pass instead of a second redundant one.

**Tech Stack:** TypeScript strict, Next.js 15, Drizzle/Postgres 17 (`127.0.0.1:5433`), Vitest. Vision via OpenAI chat-completions protocol at `LOCAL_BASE_URL` / DGX offload. Docling for PDF extraction.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-02-unified-slide-vision-describe-and-transcribe-design.md` (rev. 2026-08-02, both flavours). Every task implements a piece of it.
- **Two flavours, two paths:** Flavour A = docling `do_picture_description` VLM reasoning (`method=text`, still live, `DOCLING_VLM_ENABLED=true`); Flavour B = `transcribeDocument` verbatim path (`method=vision`). Fix A *only* via the scrub; fix B at the source (prompt) *and* via the scrub.
- **Span-scrub, not whole-drop:** Flavour A contaminates ~58% of sections *inside files that also carry real content* — scrubbing must strip the preamble span and keep the surrounding markdown.
- **`enable_thinking:false` stays** on both slide backends (already set, `slide-vision.ts:108`).
- **Test runner:** `pnpm vitest run <path>` (no watch). Full suite: `pnpm vitest run`.
- **Never edit an existing spec/plan** — append-only history. This plan supersedes nothing; it implements the rev-2026-08-02 spec.
- **STATE.md:** the deployment/remediation task touches "What's live" + a deferred-debt entry — update STATE.md in that commit (per the update protocol).

---

### Task 1: `sanitizeExtractedText` + wire into `finalizeExtraction` (both flavours, ships independently)

This alone stops both flavours from being persisted going forward. Ship first.

**Files:**
- Create: `lib/capture/sanitize-extracted-text.ts`
- Create: `tests/lib/capture/sanitize-extracted-text.test.ts`
- Modify: `lib/capture/finalize-extraction.ts:78-84` (scrub `input.extractedText` before the `updateExtractionResult` write)
- Modify: `tests/lib/capture/finalize-extraction.test.ts` (add a scrub-integration case)
- Modify: `app/api/vision-proxy/route.ts:~43` (pin `enable_thinking:false` on the local-fallback body — closes the live Flavour-A leak vector)

**Model note (verified 2026-08-02):** the vision workhorse on every path is **qwen3.6-35b-a3b** (DGX offload, `VISION_OFFLOAD_MIN_ITEMS=1` = always offload); gemma is local-fallback-only. Flavour A is qwen reasoning leakage. The DGX caption body already pins `enable_thinking:false`; the local-fallback body does not — Step 0 below fixes that.

**Interfaces:**
- Produces: `export function sanitizeExtractedText(text: string): string` — returns the input with contamination spans removed; returns `''` if nothing survives; returns the input byte-identical when clean.
- Consumes: nothing from other tasks.

- [ ] **Step 0: Pin thinking-off on the proxy local-fallback body** — `app/api/vision-proxy/route.ts:~43`

The DGX body already sets `dgxBody['chat_template_kwargs'] = { enable_thinking: false }`. Add the same to `localBody` so a DGX-outage fallback can't leak a qwen reasoning preamble into picture-description captions:

```ts
  const localBody: Record<string, unknown> = { ...body, model: localModel };
  localBody['chat_template_kwargs'] = { enable_thinking: false }; // parity with DGX; closes Flavour-A fallback leak
  if (budget) localBody['vision_soft_tokens_per_image'] = budget;
```

Commit this one line on its own (it's an independent source fix):

```bash
git add app/api/vision-proxy/route.ts
git commit -m "fix(vision-proxy): pin enable_thinking:false on local-fallback caption body

DGX caption path already suppresses thinking; the local fallback did not, so a
DGX outage could leak a qwen reasoning preamble into docling picture-description
(Flavour A). Parity closes the live vector.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E9oD91Fvd77dU1FUEQsoV3"
```

- [ ] **Step 1: Write the failing test** — `tests/lib/capture/sanitize-extracted-text.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { sanitizeExtractedText } from '@/lib/capture/sanitize-extracted-text';

describe('sanitizeExtractedText', () => {
  it('strips a Flavour-A reasoning preamble but keeps surrounding markdown', () => {
    const input = [
      '--- page 3 ---',
      'The user wants a description of the provided image. 1. Identify the main subject: a bar chart.',
      '',
      '--- page 4 ---',
      '# Typography basics',
      'Kerning is the space between individual letters.',
    ].join('\n');
    const out = sanitizeExtractedText(input);
    expect(out).toContain('# Typography basics');
    expect(out).toContain('Kerning is the space between individual letters.');
    expect(out).not.toMatch(/user wants a description/i);
    expect(out).not.toMatch(/identify the main subject/i);
  });

  it('drops a Flavour-B failure-narration sentence, keeps real text', () => {
    const input =
      'Vectors scale without loss of quality. The provided image is completely blank and contains no visible content to transcribe. Bezier curves define paths.';
    const out = sanitizeExtractedText(input);
    expect(out).toContain('Vectors scale without loss of quality.');
    expect(out).toContain('Bezier curves define paths.');
    expect(out).not.toMatch(/completely blank/i);
    expect(out).not.toMatch(/no visible content to transcribe/i);
  });

  it('drops degenerate character-cycle repetition runs', () => {
    const input = 'Real content here. bbbmtttllwwcccccpptsjjyyyyyyymmmbbbmtttllwwcccccpptsjj more real content.';
    const out = sanitizeExtractedText(input);
    expect(out).toContain('Real content here.');
    expect(out).toContain('more real content.');
    expect(out).not.toMatch(/bbbmtttllww/);
  });

  it('returns empty string when the whole field is contamination', () => {
    const input =
      'The provided image is a graphical representation and does not contain any textual content that can be transcribed.';
    expect(sanitizeExtractedText(input).trim()).toBe('');
  });

  it('returns clean real text byte-identical', () => {
    const input = '# Syllabus\nWeek 1: Introduction to Graphic Communications.\nWeek 2: Color theory.';
    expect(sanitizeExtractedText(input)).toBe(input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/capture/sanitize-extracted-text.test.ts`
Expected: FAIL — "Cannot find module '@/lib/capture/sanitize-extracted-text'".

- [ ] **Step 3: Write minimal implementation** — `lib/capture/sanitize-extracted-text.ts`

```ts
/**
 * Persistence-boundary scrub for `extracted_text`, applied in finalizeExtraction
 * so it covers EVERY source path (docling-text and vision).
 *
 * Removes two measured contamination flavours (see the 2026-08-02 design + the
 * rag-core contamination report) while preserving real content:
 *  - Flavour A: docling picture-description VLM reasoning preambles ("The user
 *    wants a description… 1. Identify the main subject…"), span-scrubbed from
 *    within otherwise-good markdown up to the next structural marker.
 *  - Flavour B: qwen failure narration ("the image is completely blank…", "does
 *    not contain any textual content…") and decoder-pathology repetition runs.
 *
 * Span-scrub, not whole-field drop: contaminated files also carry real content.
 * Returns '' only when nothing survives.
 */

// Flavour A: a reasoning-preamble sentence and everything up to the next docling
// structural marker (--- page N ---, <!-- image -->, a blank line, or end-of-text).
const REASONING_PREAMBLE =
  /(?:the user (?:wants|is asking for) a description|the user is asking|i (?:need|should|will) (?:to )?describe|let me describe|here is a description of|1\.\s+identify the main subject)[\s\S]*?(?=\n\s*---\s*page|\n\s*<!--\s*image|\n\s*\n|$)/gi;

// Flavour B: failure-narration sentences (bounded by sentence end or newline).
const FAILURE_NARRATION =
  /[^.\n]*?(?:the (?:provided )?image is (?:completely )?blank|no (?:visible )?content to transcribe|does not contain any (?:textual )?content)[^.\n]*(?:\.|(?=\n)|$)/gi;

// Decoder pathology: a short (2–6 char) cycle repeated many times without spaces.
const REPETITION_RUN = /(?:[a-z]{2,6}?)\1{4,}/gi;
// Fallback for non-exact cycles: a long run of lowercase letters with no spaces
// and low distinct-character variety is decoder garbage, not a real word.
const LONG_NOSPACE_RUN = /\b[a-z]{40,}\b/gi;

export function sanitizeExtractedText(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(REASONING_PREAMBLE, '');
  out = out.replace(FAILURE_NARRATION, '');
  out = out.replace(REPETITION_RUN, '');
  out = out.replace(LONG_NOSPACE_RUN, (m) =>
    // keep it only if it has ≥12 distinct characters (real long token vs. cycle garbage)
    new Set(m).size >= 12 ? m : '',
  );
  // collapse the blank lines / stray spaces the removals leave behind
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/capture/sanitize-extracted-text.test.ts`
Expected: PASS (all 5).

If the repetition case fails because `bbbmttt…` isn't an exact cycle, confirm `LONG_NOSPACE_RUN` catches it (the run is 40+ lowercase chars with <12 distinct). Adjust the distinct-char threshold only if a real-content test then breaks.

- [ ] **Step 5: Wire the scrub into `finalizeExtraction`** — `lib/capture/finalize-extraction.ts`

At the top of `finalizeExtraction` (currently line 78), before the `updateExtractionResult` call, sanitize the incoming text and use the cleaned value everywhere `input.extractedText` is read below. Minimal, surgical change:

```ts
export async function finalizeExtraction(input: FinalizeExtractionInput): Promise<void> {
  const cleanedText =
    input.extractedText !== undefined ? sanitizeExtractedText(input.extractedText) : undefined;
  const scrubbed: FinalizeExtractionInput = { ...input, extractedText: cleanedText };

  await updateExtractionResult({
    id: scrubbed.id,
    extractionStatus: scrubbed.extractionStatus,
    ...(scrubbed.extractionMethod !== undefined && { extractionMethod: scrubbed.extractionMethod }),
    ...(scrubbed.extractedText !== undefined && { extractedText: scrubbed.extractedText }),
    ...(scrubbed.pageCount !== undefined && { pageCount: scrubbed.pageCount }),
  });

  if (scrubbed.extractionStatus !== 'ok' || !scrubbed.extractedText) return;
  // ... rest of the function reads `scrubbed` instead of `input` from here down.
```

Then replace the remaining `input.` reads *below this line* (the digest/FERPA/chunk block, currently `input.extractedText`, `input.extractionStatus`, `input.courseCode`, etc.) with `scrubbed.`. Add the import at the top of the file:

```ts
import { sanitizeExtractedText } from '@/lib/capture/sanitize-extracted-text';
```

> Note for the implementer: read the whole function first (`sed -n '78,180p' lib/capture/finalize-extraction.ts`) and re-point every `input.` read that occurs *after* the `cleanedText` line to `scrubbed.`. Reads of fields the scrub doesn't touch (id, courseCode, fileName) are equivalent either way, but re-pointing them keeps one source of truth. `runV2Pipeline(input)` / `runV2Pipeline(scrubbed)` — pass `scrubbed` so v2 sees cleaned text too.

- [ ] **Step 6: Add the finalize integration test** — `tests/lib/capture/finalize-extraction.test.ts`

Add a case asserting that a contaminated `extractedText` passed to `finalizeExtraction` results in `updateExtractionResult` being called with the scrubbed text (follow the file's existing mock pattern for `updateExtractionResult`). Minimal shape:

```ts
it('scrubs contamination before persisting extracted_text', async () => {
  // arrange: mock updateExtractionResult (per existing pattern in this file)
  await finalizeExtraction({
    id: 'm1', courseCode: 'GC 3620', fileName: 'x.pdf',
    extractionStatus: 'ok', extractionMethod: 'vision',
    extractedText: 'Real content. The provided image is completely blank and contains no visible content to transcribe.',
  } as FinalizeExtractionInput);
  const call = updateExtractionResultMock.mock.calls[0][0];
  expect(call.extractedText).toContain('Real content.');
  expect(call.extractedText).not.toMatch(/completely blank/i);
});
```

- [ ] **Step 7: Run finalize tests + full capture suite**

Run: `pnpm vitest run tests/lib/capture/finalize-extraction.test.ts tests/lib/capture/sanitize-extracted-text.test.ts`
Expected: PASS. Then `pnpm vitest run tests/lib/capture` — expected all green.

- [ ] **Step 8: Commit**

```bash
git add lib/capture/sanitize-extracted-text.ts tests/lib/capture/sanitize-extracted-text.test.ts \
        lib/capture/finalize-extraction.ts tests/lib/capture/finalize-extraction.test.ts
git commit -m "fix(capture): scrub VLM reasoning + failure-narration from extracted_text at persistence boundary

Covers both contamination flavours (docling picture-description preambles;
qwen failure narration + decoder repetition) for every source path. Span-scrub
preserves real content in partially-contaminated files.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E9oD91Fvd77dU1FUEQsoV3"
```

---

### Task 2: `SlideNote.text` + adaptive describe-and-transcribe prompt (Flavour-B source fix)

**Files:**
- Modify: `lib/capture/slide-vision.ts:17-66` (SlideNote interface, SAFE_DEFAULT, INSTRUCTION, coerce)
- Modify: `lib/capture/slide-vision.ts` (add `notesToExtractedText` export)
- Modify: `tests/lib/capture/slide-vision.test.ts`

**Interfaces:**
- Produces: `SlideNote.text: string` (verbatim visible text, `''` if none); `export function notesToExtractedText(notes: SlideNote[]): string`.
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing tests** — add to `tests/lib/capture/slide-vision.test.ts`

```ts
import { notesToExtractedText, type SlideNote } from '@/lib/capture/slide-vision';

describe('notesToExtractedText', () => {
  it('concatenates verbatim text per page and appends a one-line imagery note', () => {
    const notes: SlideNote[] = [
      { topic: 'Vectors', teaches: 'scaling', keyVisual: 'a bar chart of file sizes', text: 'Vectors scale without loss.', contentLevel: 'substantive' },
      { topic: 'Title', teaches: '', keyVisual: '', text: '', contentLevel: 'low' },
    ];
    const out = notesToExtractedText(notes);
    expect(out).toContain('Vectors scale without loss.');
    expect(out).toMatch(/bar chart of file sizes/);
    expect(out).not.toMatch(/blank|no content|nothing to transcribe/i); // never narrates absence
  });

  it('emits nothing for a genuinely empty slide (no narration)', () => {
    const notes: SlideNote[] = [
      { topic: '', teaches: '', keyVisual: '', text: '', contentLevel: 'low' },
    ];
    expect(notesToExtractedText(notes).trim()).toBe('');
  });
});
```

Also update any existing `coerce`/`describeSlides` test fixtures in this file that build a `SlideNote` literal to include `text: ''` (TypeScript strict will otherwise fail to compile the test).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lib/capture/slide-vision.test.ts`
Expected: FAIL — `notesToExtractedText` not exported / `text` missing on `SlideNote`.

- [ ] **Step 3: Add `text` to the interface + SAFE_DEFAULT + coerce** — `lib/capture/slide-vision.ts`

```ts
export interface SlideNote {
  topic: string;
  teaches: string;
  keyVisual: string;
  /** Verbatim visible text on the slide, '' if none. Feeds extracted_text (the
   *  KUD-audit / digest source). Kept separate from keyVisual (imagery). */
  text: string;
  contentLevel: 'substantive' | 'low' | 'unknown';
}

const SAFE_DEFAULT: SlideNote = {
  topic: '',
  teaches: '',
  keyVisual: '',
  text: '',
  contentLevel: 'unknown',
};
```

In `coerce`, add the `text` field (verbatim, defaults to `''`):

```ts
  return {
    topic: typeof r['topic'] === 'string' ? r['topic'] : '',
    teaches: typeof r['teaches'] === 'string' ? r['teaches'] : '',
    keyVisual: typeof r['keyVisual'] === 'string' ? r['keyVisual'] : '',
    text: typeof r['text'] === 'string' ? r['text'] : '',
    contentLevel: r['contentLevel'] === 'substantive' ? 'substantive' : 'low',
  };
```

- [ ] **Step 4: Reframe INSTRUCTION to adaptive describe-and-transcribe** — `lib/capture/slide-vision.ts:40-55`

```ts
const INSTRUCTION =
  'You are a curriculum-analysis assistant analyzing one slide/page image. ' +
  'Return STRICT JSON (no markdown fences, no extra keys) with exactly these fields:\n' +
  '{"text": "<verbatim transcription of ALL visible text, preserving line order; empty string if there is no text>", ' +
  '"keyVisual": "<one brief phrase describing the dominant imagery/diagram; empty string if there is no notable imagery>", ' +
  '"topic": "<short topic label>", ' +
  '"teaches": "<what the slide teaches or intends students to learn>", ' +
  '"contentLevel": "substantive" | "low"}\n' +
  'A slide may have text, imagery, or both — transcribe what is there and describe what is there. ' +
  'Do NOT summarize or paraphrase the text: reproduce it verbatim. ' +
  'If the page is genuinely empty, return empty strings for "text" and "keyVisual" — ' +
  'NEVER write a sentence explaining that the slide is blank or has nothing to transcribe. ' +
  'Use contentLevel:"low" ONLY for pure title slides, section dividers, agenda/outline slides, ' +
  'thank-you/questions slides, and recurring template/transition slides. Everything else is ' +
  '"substantive" — INCLUDING slides that teach through VISUAL EXAMPLES (design showcases, ' +
  'logo/typography comparisons, before/after, worked examples, portfolio or reference ' +
  'screenshots). In a design course the examples ARE the instruction, so do NOT mark a slide ' +
  '"low" merely because it is image-heavy with little text. When a slide shows examples, infer ' +
  'and state in "teaches" the principle the examples demonstrate. Return only the JSON object.';
```

- [ ] **Step 5: Add `notesToExtractedText`** — `lib/capture/slide-vision.ts` (near the SlideNote type / exports)

```ts
/**
 * Derive an extracted_text string from a deck's slide notes: verbatim text per
 * page, with a one-line imagery note appended when the page carries notable
 * imagery but the imagery is what teaches (keyVisual present). Empty pages emit
 * nothing — the failure-narration failure mode is structurally impossible here.
 */
export function notesToExtractedText(notes: SlideNote[]): string {
  const pages: string[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const parts: string[] = [];
    if (n.text.trim()) parts.push(n.text.trim());
    if (n.keyVisual.trim()) parts.push(`[visual: ${n.keyVisual.trim()}]`);
    if (parts.length) pages.push(`--- page ${i + 1} ---\n${parts.join('\n')}`);
  }
  return pages.join('\n\n');
}
```

- [ ] **Step 6: Run slide-vision tests**

Run: `pnpm vitest run tests/lib/capture/slide-vision.test.ts`
Expected: PASS. Existing SAFE_DEFAULT/`unknown` reliability tests still hold (Task did not touch that logic).

- [ ] **Step 7: Commit**

```bash
git add lib/capture/slide-vision.ts tests/lib/capture/slide-vision.test.ts
git commit -m "feat(capture): adaptive slide vision — SlideNote.text (verbatim) + describe-or-both prompt

One prompt transcribes visible text AND describes imagery; a genuinely empty
page emits empty fields, never a narration. notesToExtractedText derives
extracted_text from a single pass. Removes Flavour-B contamination at the source.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E9oD91Fvd77dU1FUEQsoV3"
```

---

### Task 3: Rewire `extract-text.ts` (drop transcribeDocument on the slide path) + thread notes to `finalizeExtraction`

**Files:**
- Modify: `lib/courses/extract-text.ts:72-145` (`runVisionFallback` — image path calls `describeSlides` once, derives text, returns `slideNotes`)
- Modify: `lib/courses/extract-text.ts:38-45` (`ExtractTextResult` — add `slideNotes?`)
- Modify: `lib/capture/finalize-extraction.ts:24-45` (`FinalizeExtractionInput` — add `slideNotes?`)
- Modify: `lib/capture/finalize-extraction.ts:238-258` (middle-tier — reuse threaded notes instead of re-`describeSlides`)
- Modify: `lib/capture/ingest-queue.ts:150-182` (`processMaterial` — thread `ex.slideNotes` into `finalizeExtraction`)
- Modify: `tests/lib/capture/finalize-extraction-tier.test.ts` (reuse-notes case)

**Interfaces:**
- Consumes: `describeSlides(pngs) → SlideNote[]` and `notesToExtractedText(notes) → string` (Task 2); `sanitizeExtractedText` (Task 1, already wired in finalize).
- Produces: `ExtractTextResult.slideNotes?: SlideNote[]`; `FinalizeExtractionInput.slideNotes?: SlideNote[]`.

- [ ] **Step 1: Write the failing test** — `tests/lib/capture/finalize-extraction-tier.test.ts`

Add a case asserting the middle tier does NOT call `describeSlides` when `slideNotes` are supplied (mock `describeSlides`, assert `.not.toHaveBeenCalled()`), and that chunks are still produced from the threaded notes. Follow the file's existing tier-test mock setup.

```ts
it('reuses threaded slideNotes and does not re-describe', async () => {
  const notes = [
    { topic: 'Vectors', teaches: 'scaling', keyVisual: 'chart', text: 'Vectors scale.', contentLevel: 'substantive' as const },
  ];
  await finalizeExtraction({
    id: 'm2', courseCode: 'GC 3620', fileName: 'wk4.pdf',
    extractionStatus: 'ok', extractionMethod: 'vision',
    extractedText: 'Vectors scale.', slideNotes: notes,
    fileBytes: Buffer.from('%PDF-1.4'), mimeType: 'application/pdf',
  } as FinalizeExtractionInput);
  expect(describeSlidesMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/lib/capture/finalize-extraction-tier.test.ts`
Expected: FAIL — `slideNotes` not on `FinalizeExtractionInput` / `describeSlides` still called.

- [ ] **Step 3: Add `slideNotes` to `ExtractTextResult`** — `lib/courses/extract-text.ts:38-45`

```ts
import type { SlideNote } from '@/lib/capture/slide-vision';

export interface ExtractTextResult {
  method?: 'text' | 'vision' | 'granite';
  status: 'ok' | 'low_text' | 'failed';
  text?: string;
  pageCount?: number;
  visionCostUsdCents?: number;
  slideNotes?: SlideNote[];
}
```

- [ ] **Step 4: Rewrite the image-PDF branch of `runVisionFallback`** — `lib/courses/extract-text.ts:105-145`

Replace the `provider.transcribeDocument(...)` slide call with a single adaptive `describeSlides` pass, derive `extracted_text` via `notesToExtractedText`, and return the notes. Keep the render/cap logic and the granite branch (105-88) as-is. Sketch (adapt to the exact surrounding structure the implementer reads first):

```ts
import { describeSlides, notesToExtractedText } from '@/lib/capture/slide-vision';
import { renderToImages } from '@/lib/capture/render-to-images'; // confirm the actual render helper used here

// inside runVisionFallback, the image-based (deck/scan) branch:
const images = await renderToImages(fileBytes, mimeType, /* fileName */); // capped to VISION_PAGE_CAP
if (images.length === 0) return { method: 'vision', status: 'failed', pageCount };

const notes = await describeSlides(images);
const text = notesToExtractedText(notes);
return {
  method: 'vision',
  status: text.length < MIN_MEANINGFUL_CHARS ? 'low_text' : 'ok',
  text,
  pageCount: images.length,
  slideNotes: notes,
  visionCostUsdCents: 0,
};
```

> Implementer: `sed -n '72,146p' lib/courses/extract-text.ts` first. Confirm the exact render helper + page-cap constant this function already uses (it renders elsewhere too). Do NOT remove `transcribeDocument`'s definition or the granite branch — only the slide-path *call* to `transcribeDocument` is removed. `MIN_MEANINGFUL_CHARS` is the existing threshold used in this file.

- [ ] **Step 5: Thread `slideNotes` through `FinalizeExtractionInput`** — `lib/capture/finalize-extraction.ts:24-45`

```ts
export interface FinalizeExtractionInput {
  // ...existing fields...
  slideNotes?: SlideNote[];
}
```
Add `import type { SlideNote } from '@/lib/capture/slide-vision';` if not already present.

- [ ] **Step 6: Reuse threaded notes in the middle tier** — `lib/capture/finalize-extraction.ts:240-247`

```ts
const images = input.fileBytes
  ? await renderToImages(input.fileBytes, input.mimeType ?? '', fileName)
  : [];

if (images.length > 0 || (input.slideNotes && input.slideNotes.length > 0)) {
  // Reuse notes from the single extract-time pass when threaded; only re-describe
  // if they weren't provided (non-vision caller). Removes the double vision pass.
  const allNotes = input.slideNotes?.length ? input.slideNotes : await describeSlides(images);
  // ...rest of the block (unknownCount guard, chunk build) unchanged, using allNotes...
```

> Implementer: keep the `unknownCount / allNotes.length >= 0.5` reliability guard and the chunk-building that follows exactly as-is — only the *source* of `allNotes` changes. If `input.slideNotes` is present, `images` may be empty; ensure nothing downstream in this block requires `images` when notes were threaded (the guard + chunk build use `allNotes`, not `images`).

- [ ] **Step 7: Thread `ex.slideNotes` in `processMaterial`** — `lib/capture/ingest-queue.ts:170-182`

In the `finalizeExtraction({ ... })` call, add:

```ts
    ...(ex.slideNotes !== undefined && { slideNotes: ex.slideNotes }),
```
alongside the existing `...(extractionMethod !== undefined && { extractionMethod })` spreads. (`ex` is the `ExtractTextResult` already in scope at line ~160.)

- [ ] **Step 8: Run tier tests + full capture suite**

Run: `pnpm vitest run tests/lib/capture/finalize-extraction-tier.test.ts`
Expected: PASS (describeSlides not called when notes threaded).
Then: `pnpm vitest run tests/lib/capture && pnpm vitest run tests/lib/courses`
Expected: all green. Fix any `SlideNote` literals in other tests that now need `text: ''`.

- [ ] **Step 9: Typecheck**

Run: `pnpm tsc --noEmit` (or the repo's `pnpm typecheck` script)
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add lib/courses/extract-text.ts lib/capture/finalize-extraction.ts lib/capture/ingest-queue.ts \
        tests/lib/capture/finalize-extraction-tier.test.ts
git commit -m "refactor(capture): single adaptive vision pass — drop transcribeDocument on slide path, thread notes to finalize

extract-text derives extracted_text from one describeSlides pass and threads the
notes to finalizeExtraction, which reuses them instead of re-rendering +
re-describing (removes the double vision pass). transcribeDocument stays defined
for the hardscan lane; the image-PDF path no longer calls it.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E9oD91Fvd77dU1FUEQsoV3"
```

---

### Task 4: Verify end-to-end, deploy, scope corpus-wide, remediate, emit re-upload list

**Files:**
- Create: `scripts/contamination-scope.ts` (corpus-wide query, both flavours, all tiers)
- Create: `scripts/remediate-flavour-a-inplace.ts` (in-place scrub of recoverable `method=text` rows)
- Modify: `docs/STATE.md` ("What's live" + Deferred/debt: faculty re-upload list for permanent-loss GC 1010 materials)

**Interfaces:**
- Consumes: `sanitizeExtractedText` (Task 1).

- [ ] **Step 1: Stage a known-contaminated deck through the new path**

Re-extract one GC 3620 Flavour-B deck (`Wk2-DesignThinking.pdf`) and one GC 1010 Flavour-A material (a raw-present one, if any) through the current pipeline. Inspect the written `extracted_text`. Expected: real content present, no `"user wants a description"`, no `"completely blank"`, no repetition runs.

Verify with a tsx script using the drizzle db client (psql is not on PATH — use the established `scripts/*.ts` + `import { db }` pattern from earlier this session).

- [ ] **Step 2: Corpus-wide contamination scope** — `scripts/contamination-scope.ts`

Run the report's query (both flavours) over **all** `course_materials`, not just middle tier. Emit a table: `course_code, file_name, method, raw_cleared, bytes, flavour(A/B), pct_contaminated`. This sizes the true blast radius. Save output to `docs/superpowers/pilot/` or a committed report file.

- [ ] **Step 3: Deploy**

Deploy the app (Tasks 1–3) to the local Mac deployment per `docs/superpowers/running-locally.md`. Confirm the service is up on the Funnel URL (headless — do not reference localhost).

- [ ] **Step 4: Remediate Flavour-B recoverable (re-extract)**

Re-extract the GC 3620 decks (`_Wk4-Vectors`, `Wk2-DesignThinking`, `Wk8-DigitalDesign`) + any Flavour-B rows surfaced in Step 2 whose raw file is present. Re-score. Verify clean via the Step-2 query (0 rows).

- [ ] **Step 5: Remediate Flavour-A recoverable (in-place scrub)** — `scripts/remediate-flavour-a-inplace.ts`

For `method=text` rows flagged Flavour A in Step 2 where the scrub leaves substantive content: run `sanitizeExtractedText` over the stored `extracted_text`, write back the cleaned value, re-digest/re-index. Do NOT scrub-and-store rows that become majority-empty — route those to Step 6. Log before/after byte counts per row.

- [ ] **Step 6: Emit the faculty re-upload list (permanent loss)**

For `raw_cleared` rows whose text is majority contamination (GC 1010's 94%/92%/72%… set — scrub leaves too little), produce a faculty re-upload worklist (course, file, % contaminated, why unrecoverable). Save as a committed report. This is the only recovery path for those.

- [ ] **Step 7: Update STATE.md**

- "What's live": note the unified adaptive slide-vision path + persistence-boundary scrub are deployed.
- **Deferred / debt:** the faculty re-upload list — GC 1010's `raw_cleared` majority-contaminated materials cannot be recovered without re-upload (no diff would ever surface this; it must be written here per the update protocol).

- [ ] **Step 8: Commit remediation + STATE**

```bash
git add scripts/contamination-scope.ts scripts/remediate-flavour-a-inplace.ts docs/STATE.md docs/superpowers/pilot/*contamination*
git commit -m "chore(capture): corpus-wide contamination scope + Flavour-A in-place scrub + re-upload list; deploy unified slide vision

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E9oD91Fvd77dU1FUEQsoV3"
```

---

## Self-Review

**Spec coverage:**
- §1a Flavour A → Task 1 (scrub, span-scrubbing) + Task 4 Steps 2/5/6 (scope + in-place + re-upload). ✓
- §1a Flavour B → Task 2 (adaptive prompt source fix) + Task 1 (scrub backstop) + Task 4 Step 4 (re-extract). ✓
- §3.1 `SlideNote.text` → Task 2. ✓
- §3.2 adaptive prompt → Task 2. ✓
- §3.3 extract-text drops transcribeDocument, derives extracted_text → Task 3. ✓
- §3.4 thread notes to finalize, reuse (single pass) → Task 3. ✓
- §3.5 `sanitizeExtractedText` persistence-boundary scrub → Task 1. ✓
- §3.6 `raw_cleared` ordering → **partially deferred.** The scrub (Task 1) + the finalize non-ok guard already prevent junk-then-purge going forward; the explicit "never purge until text validates" reorder in the purge job is not in this plan. **Flagged as a gap** — see below.
- §6 remediation → Task 4. ✓
- §7 phasing (scrub first, then prompt, then rewire, then verify/remediate) → Task order matches. ✓

**Gap found:** §3.6 (`raw_cleared` ordering — never purge raw until `extracted_text` passes the gate) has no dedicated task. It's lower-urgency now that Task 1 prevents contaminated text from being stored (the thing that made purge dangerous), but the ordering guarantee itself isn't implemented. **Decision needed from operator:** fold a small Task into this plan, or record it in STATE.md Deferred/debt. I lean toward Deferred/debt since the scrub removes the acute risk — but the spec lists it, so it's the operator's call.

**Placeholder scan:** No TBD/TODO left. The one "adapt to the exact surrounding structure" note in Task 3 Step 4 is a read-first instruction with a concrete sketch + exact line range, not a placeholder — the render helper name is the single detail to confirm at edit time (flagged explicitly).

**Type consistency:** `SlideNote` gains `text: string` in Task 2; every later `SlideNote` literal (Tasks 3 tests) includes `text`. `ExtractTextResult.slideNotes?` (Task 3 Step 3) and `FinalizeExtractionInput.slideNotes?` (Task 3 Step 5) are the same `SlideNote[]` type. `sanitizeExtractedText(text: string): string` used identically in Task 1 wiring and Task 4 in-place script. `notesToExtractedText(notes: SlideNote[]): string` defined Task 2, consumed Task 3.

**One open item for the operator:** the render-helper name in Task 3 Step 4 (`renderToImages` is used in `finalize-extraction.ts:240`; confirm `extract-text.ts`'s image branch uses the same helper or its own — the implementer reads lines 72-146 first). This is a confirm-at-edit detail, not a design gap.
