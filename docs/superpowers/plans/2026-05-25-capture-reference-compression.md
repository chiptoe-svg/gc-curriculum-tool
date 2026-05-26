# Reference Material Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the CourseCapture audit-chat input bundle back under the OpenAI input-token cap by automatically summarizing long reference-style materials (textbook PDFs, YouTube transcripts, Drive PDFs, etc.) at extraction time, and substituting the structured summary for the raw extracted text in the audit prompt — while keeping the auditor's bird's-eye view of every material so absence-detection and readiness scoring still work.

**Architecture:** Add per-material summary columns to `course_materials`. A shared `finalizeExtraction` helper wraps every extraction completion: it persists the extracted text, then — if the material is compression-eligible (long enough + a reference-leaning source kind) — synchronously calls a cheap summarizer model and writes the summary back to the row. The audit-chat context builder substitutes the summary for the raw text whenever `useSummary = true`. Faculty get a per-row toggle to fall back to full text for a specific material, plus a one-time backfill button for materials that predate this feature.

**Tech Stack:** Next.js 15 App Router · TypeScript · Drizzle ORM on Postgres (Neon) · OpenAI Node SDK (`openai`) · Vitest · Tailwind/shadcn UI components.

---

## Context for the engineer

What this is responding to:

- **The bug** — Real courses dump 300k+ tokens of Docling-extracted materials into one audit-chat call. The single user message containing the full bundle exceeds `gpt-5.4-mini`'s 272k input cap, so "Start session" fails with `context_length_exceeded`. See `lib/ai/analyze/capture-chat.ts:18-20` — the comment "If a model rejects on size, we'll see it surface and trim then" anticipates this work.
- **Pre-plan stopgaps already on `main`** — Per-material token counts in `MaterialsPanel.tsx` and capture-chat default tier bumped from `light` (gpt-5.4-mini) → `default` (gpt-5.4) for more input headroom. These help but don't solve the underlying scale problem.
- **Why compression instead of true RAG** — The auditor's job is to *survey* the corpus and notice gaps, contradictions, and unevidenced claims. Top-k retrieval breaks that: it can't detect absences and would lie to the readiness score. A bounded, always-in-context structured summary preserves the survey property; we only sacrifice verbatim quote-fishing for the long-tail reference materials where that's least useful.
- **Why automatic at extraction time** — Manual compression means faculty need to know about and click a button when the cap bites; surprising failure mode for someone who just wants to start an audit. Doing it inline at extraction means new materials just work. The summarizer call is cheap (light tier) and serial with extraction, which is already a slow path. Best-effort: a summarizer failure is logged but does not fail the extraction.

## Scope

**In scope:**
- Schema, summarizer, classification rule.
- Shared `finalizeExtraction` helper, wired into all four extraction call sites.
- Audit-chat substitution.
- Per-row UI toggle for overriding the substitution.
- One-time backfill endpoint + button for materials uploaded before this feature shipped.

**Out of scope (see Future Directions at end):**
- True RAG (chunking, embeddings, vector store, top-k retrieval).
- Agentic retrieval loop (giving the auditor a `fetch_material_section` tool).
- Background job queue for summarization — done inline at extraction; backfill button is the escape hatch.
- Re-summarization on extracted-text change — backfill button is the manual escape hatch.

## File structure

**Create:**
- `drizzle/0021_<auto-name>.sql` — schema migration (drizzle-kit generates the name)
- `lib/ai/prompts/material-summary.md` — system prompt for the summarizer
- `lib/ai/analyze/material-summary.ts` — `summarizeMaterial()` LLM call
- `lib/capture/material-compression.ts` — `isCompressionCandidate()` rule + `effectiveAuditText()` helper
- `lib/capture/finalize-extraction.ts` — `finalizeExtraction()` shared helper used by every extraction call site
- `app/api/courses/[code]/materials/compress/route.ts` — POST backfill endpoint
- `tests/lib/material-compression.test.ts` — pure-logic tests
- `tests/lib/ai/material-summary.test.ts` — summarizer tests with mocked OpenAI client
- `tests/lib/capture/finalize-extraction.test.ts` — helper tests with mocked summarizer + DB

**Modify:**
- `lib/db/schema.ts` — add 4 columns to `courseMaterials`
- `lib/db/course-materials-queries.ts` — add `updateMaterialSummary()` and `setMaterialUseSummary()`
- `lib/ai/function-settings.ts` — register `material-summary` function id (light tier)
- `lib/ai/analyze/capture-chat.ts` — `formatMaterials()` uses `effectiveAuditText()`; type extended
- `app/api/capture/[code]/chat/route.ts` — pass summary fields into `CaptureChatContext.materials[]`
- `app/api/capture/[code]/context/route.ts` — surface summary fields to the client
- `app/api/courses/[code]/materials/[id]/route.ts` — extend PATCH to accept `useSummary`
- `app/api/courses/[code]/materials/route.ts` — replace `updateExtractionResult` with `finalizeExtraction`
- `app/api/courses/[code]/canvas-import/route.ts` — same (2 call sites)
- `app/api/courses/[code]/scan-linked-docs/route.ts` — same (6 call sites; only the ones that set `extractionStatus: 'ok'` need it, but pass through all for uniformity)
- `app/api/courses/[code]/canvas-reextract/route.ts` — same
- `app/capture/[code]/MaterialsPanel.tsx` — "summarized" badge, per-row toggle, summary token count, "Compress existing materials" backfill button

## Compression rule (locked in)

Authoritative source of truth lives in `lib/capture/material-compression.ts`. The rule the rest of the plan assumes:

```
A material is a compression candidate iff:
  - extractedText is non-null AND
  - estimated tokens (ceil(chars/4)) >= 15_000 AND
  - source kind is one of: 'canvas_file', 'drive_pdf', 'youtube', 'uploaded'

Source kinds are derived from fileName prefix:
  - 'Canvas File:' prefix → 'canvas_file'
  - 'Drive PDF:'   prefix → 'drive_pdf'
  - 'YouTube:'     prefix → 'youtube'
  - 'Canvas:'      prefix → 'canvas_dense'   (NEVER summarized)
  - 'Google Doc:' / 'Google Slides:' / 'Google Sheet:' prefix → 'google_workspace' (NEVER summarized)
  - everything else (no recognized prefix)   → 'uploaded'
```

Rationale: `Canvas: Syllabus / Assignments / Modules / Pages / Discussions / Quizzes` and Google Workspace links are the dense, assignment-grade content the auditor needs verbatim. Canvas File attachments (textbook chapters), Drive PDFs (readings), YouTube transcripts, and plain PDF/DOCX uploads are where the long-tail reference bulk lives.

## Summary shape (locked in)

The summarizer produces markdown, ~1500–2500 tokens regardless of source length:

```
Material kind: <textbook chapter / lecture transcript / reading PDF / lab handout / ...>
Topic and scope: <1–2 sentences>

Sections:
- <heading 1>
- <heading 2>
...

Key terms and concepts:
- <term>: <gloss>
...

Likely competencies this material supports:
- <bullet>
...

Audit-relevant gaps the summary cannot answer on its own:
- <bullet> (e.g., "exact assessment weighting", "specific worked example")
```

The last section matters: it tells the auditor which questions still require asking the instructor (or, eventually, calling a `fetch_material_section` tool).

---

## Tasks

### Task 1: Add summary columns to schema

**Files:**
- Modify: `lib/db/schema.ts:169-194` (the `courseMaterials` table definition)
- Create: `drizzle/0021_<auto-name>.sql` (via drizzle-kit)

- [ ] **Step 1: Add columns to the Drizzle table definition**

In `lib/db/schema.ts`, inside `courseMaterials`, add four new columns immediately before the `ignored` column:

```ts
  summary: text('summary'),
  summaryModel: text('summary_model'),
  summaryGeneratedAt: timestamp('summary_generated_at', { withTimezone: true }),
  // When true and `summary` is non-null, AI-facing context loaders use the
  // summary in place of extractedText. Default false; `updateMaterialSummary`
  // flips it to true the first time a summary is written, so newly-extracted
  // long materials auto-substitute. Faculty toggle per-row from the UI.
  useSummary: boolean('use_summary').notNull().default(false),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm drizzle-kit generate`
Expected: a new file `drizzle/0021_<random-name>.sql` is created containing four `ALTER TABLE course_materials ADD COLUMN ...` statements. Drizzle-kit picks the name; do not rename.

- [ ] **Step 3: Apply the migration**

Run: `pnpm drizzle-kit migrate`
Expected: migration applies cleanly; re-running generate produces no diff.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts drizzle/0021_*.sql drizzle/meta/
git commit -m "feat(capture): add summary columns to course_materials"
```

---

### Task 2: Material-compression helpers (pure logic, TDD)

**Files:**
- Create: `lib/capture/material-compression.ts`
- Create: `tests/lib/material-compression.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/material-compression.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  classifySource,
  isCompressionCandidate,
  effectiveAuditText,
  type CompressionMaterial,
} from '@/lib/capture/material-compression';

const LONG = 'x'.repeat(60_001); // > 15k tokens (60_000 chars / 4)
const SHORT = 'x'.repeat(1_000);

function mat(overrides: Partial<CompressionMaterial>): CompressionMaterial {
  return {
    fileName: 'Drive PDF: foo.pdf',
    extractedText: LONG,
    summary: null,
    useSummary: false,
    ...overrides,
  };
}

describe('classifySource', () => {
  it('recognizes Canvas dense kinds', () => {
    expect(classifySource('Canvas: Syllabus')).toBe('canvas_dense');
    expect(classifySource('Canvas: Assignments')).toBe('canvas_dense');
  });
  it('recognizes Canvas File attachments separately', () => {
    expect(classifySource('Canvas File: chapter-3.pdf')).toBe('canvas_file');
  });
  it('recognizes Google Workspace kinds', () => {
    expect(classifySource('Google Doc: rubric')).toBe('google_workspace');
    expect(classifySource('Google Slides: deck')).toBe('google_workspace');
    expect(classifySource('Google Sheet: schedule')).toBe('google_workspace');
  });
  it('recognizes Drive PDF and YouTube', () => {
    expect(classifySource('Drive PDF: chapter.pdf')).toBe('drive_pdf');
    expect(classifySource('YouTube: lecture')).toBe('youtube');
  });
  it('falls back to uploaded for everything else', () => {
    expect(classifySource('whatever.pdf')).toBe('uploaded');
  });
});

describe('isCompressionCandidate', () => {
  it('returns true for long Drive PDFs', () => {
    expect(isCompressionCandidate(mat({}))).toBe(true);
  });
  it('returns true for long YouTube transcripts', () => {
    expect(isCompressionCandidate(mat({ fileName: 'YouTube: foo' }))).toBe(true);
  });
  it('returns true for long Canvas File attachments', () => {
    expect(isCompressionCandidate(mat({ fileName: 'Canvas File: foo.pdf' }))).toBe(true);
  });
  it('returns true for long plain uploads', () => {
    expect(isCompressionCandidate(mat({ fileName: 'random.pdf' }))).toBe(true);
  });
  it('returns false for short materials regardless of kind', () => {
    expect(isCompressionCandidate(mat({ extractedText: SHORT }))).toBe(false);
  });
  it('returns false for Canvas dense materials even if long', () => {
    expect(isCompressionCandidate(mat({ fileName: 'Canvas: Pages' }))).toBe(false);
  });
  it('returns false for Google Workspace materials even if long', () => {
    expect(isCompressionCandidate(mat({ fileName: 'Google Doc: huge' }))).toBe(false);
  });
  it('returns false when extractedText is null', () => {
    expect(isCompressionCandidate(mat({ extractedText: null }))).toBe(false);
  });
});

describe('effectiveAuditText', () => {
  it('uses summary when useSummary=true and summary is non-null', () => {
    const m = mat({ summary: 'SUMMARY', useSummary: true });
    expect(effectiveAuditText(m)).toBe('SUMMARY');
  });
  it('uses extractedText when useSummary=false', () => {
    const m = mat({ summary: 'SUMMARY', useSummary: false });
    expect(effectiveAuditText(m)).toBe(LONG);
  });
  it('uses extractedText when useSummary=true but summary is null', () => {
    const m = mat({ summary: null, useSummary: true });
    expect(effectiveAuditText(m)).toBe(LONG);
  });
  it('returns null when both are null', () => {
    expect(effectiveAuditText(mat({ extractedText: null, summary: null, useSummary: true }))).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/lib/material-compression.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `lib/capture/material-compression.ts`:

```ts
/**
 * Rules for deciding which materials get replaced by a structured summary
 * in the audit chat prompt. Pure logic — no DB or network. Used by:
 *   - `finalizeExtraction` to decide whether to summarize a freshly
 *     extracted material;
 *   - the backfill endpoint to find pre-existing eligible materials;
 *   - the capture chat route to substitute summary for extracted text.
 */

export type SourceKind =
  | 'canvas_dense'       // Canvas: <Syllabus|Assignments|Modules|Pages|Discussions|Quizzes>
  | 'google_workspace'   // Google Doc | Slides | Sheet
  | 'canvas_file'        // Canvas File: ...
  | 'drive_pdf'          // Drive PDF: ...
  | 'youtube'            // YouTube: ...
  | 'uploaded';          // anything else

export interface CompressionMaterial {
  fileName: string;
  extractedText: string | null;
  summary: string | null;
  useSummary: boolean;
}

// 15k tokens ≈ 60k chars under the ~4 chars/token rule of thumb.
export const COMPRESSION_TOKEN_THRESHOLD = 15_000;
export const COMPRESSION_CHAR_THRESHOLD = COMPRESSION_TOKEN_THRESHOLD * 4;

export function classifySource(fileName: string): SourceKind {
  if (fileName.startsWith('Canvas File:')) return 'canvas_file';
  if (fileName.startsWith('Canvas:')) return 'canvas_dense';
  if (fileName.startsWith('Google Doc:')) return 'google_workspace';
  if (fileName.startsWith('Google Slides:')) return 'google_workspace';
  if (fileName.startsWith('Google Sheet:')) return 'google_workspace';
  if (fileName.startsWith('Drive PDF:')) return 'drive_pdf';
  if (fileName.startsWith('YouTube:')) return 'youtube';
  return 'uploaded';
}

const COMPRESSIBLE_KINDS: ReadonlySet<SourceKind> = new Set([
  'canvas_file', 'drive_pdf', 'youtube', 'uploaded',
]);

export function isCompressionCandidate(m: CompressionMaterial): boolean {
  if (!m.extractedText) return false;
  if (m.extractedText.length < COMPRESSION_CHAR_THRESHOLD) return false;
  return COMPRESSIBLE_KINDS.has(classifySource(m.fileName));
}

export function effectiveAuditText(m: CompressionMaterial): string | null {
  if (m.useSummary && m.summary) return m.summary;
  return m.extractedText;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/lib/material-compression.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/capture/material-compression.ts tests/lib/material-compression.test.ts
git commit -m "feat(capture): add material-compression classifier and effectiveAuditText helper"
```

---

### Task 3: Summarizer prompt + function

**Files:**
- Create: `lib/ai/prompts/material-summary.md`
- Create: `lib/ai/analyze/material-summary.ts`
- Create: `tests/lib/ai/material-summary.test.ts`
- Modify: `lib/ai/function-settings.ts`

- [ ] **Step 1: Register the new function id**

In `lib/ai/function-settings.ts`:

- In the `AI_FUNCTION_IDS` array, add `'material-summary'` as the last entry.
- In `DEFAULT_TIERS`, add `'material-summary': 'light'`.
- In `FUNCTION_LABELS`, add `'material-summary': 'Material summary (for audit compression)'`.
- In `FUNCTION_DESCRIPTIONS`, add `'material-summary': 'Per-material structured summary, generated at extraction time for long reference materials and substituted for the full extracted text in the audit chat prompt.'`.
- Update the `Rationale per function` doc-comment block to include:

  ```
   *   - material-summary: light. One short summarization pass per long
   *     reference material at extraction time; cached on the row.
  ```

- [ ] **Step 2: Write the prompt**

Create `lib/ai/prompts/material-summary.md`:

```
You produce structured summaries of long reference materials (textbook
chapters, lecture transcripts, reading PDFs, lab handouts) for use inside
a course-audit conversation. The summary REPLACES the full text in the
auditor's context, so it must preserve every audit-relevant signal that
can fit in a few hundred lines.

Format your reply as plain markdown with EXACTLY these headings, in order:

Material kind: <short noun phrase, e.g., "textbook chapter", "lecture transcript", "reading PDF", "lab handout">
Topic and scope: <1–2 sentences identifying what the material covers>

Sections:
- <every top-level heading or major section, one per line>

Key terms and concepts:
- <term>: <one-line gloss>
- ...

Likely competencies this material supports:
- <verb-leading bullet, e.g., "Apply linear-system superposition to mixed AC/DC circuits">
- ...

Audit-relevant gaps the summary cannot answer on its own:
- <bullet identifying questions the auditor would need to ask the
   instructor or fetch from the full text — e.g., "exact assessment
   weighting", "specific worked example details", "code listings">
- ...

Hard rules:
- Keep the entire summary under 2500 words.
- Use the original material's terminology verbatim where it appears.
- Do NOT invent learning objectives the material doesn't actually support.
- Do NOT include reassurances, meta-commentary, or anything outside the
  six headings above.
```

- [ ] **Step 3: Write the failing summarizer test**

Create `tests/lib/ai/material-summary.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: createMock } },
  })),
}));
vi.mock('@/lib/ai/function-settings', () => ({
  resolveModelForFunction: vi.fn().mockResolvedValue('gpt-5.4-mini'),
}));
vi.mock('@/lib/ai/prompts/load', () => ({
  loadPrompt: vi.fn().mockResolvedValue('SYSTEM PROMPT BODY'),
}));

import { summarizeMaterial } from '@/lib/ai/analyze/material-summary';

describe('summarizeMaterial', () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('returns the model reply and the resolved model name', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'Material kind: textbook chapter\n...' } }],
    });
    const result = await summarizeMaterial({
      fileName: 'Drive PDF: chapter-3.pdf',
      extractedText: 'long text here',
    });
    expect(result.summary).toContain('Material kind: textbook chapter');
    expect(result.model).toBe('gpt-5.4-mini');
    expect(createMock).toHaveBeenCalledOnce();
    const args = createMock.mock.calls[0]![0];
    expect(args.model).toBe('gpt-5.4-mini');
    expect(args.messages[0].role).toBe('system');
    expect(args.messages[0].content).toBe('SYSTEM PROMPT BODY');
    expect(args.messages[1].role).toBe('user');
    expect(args.messages[1].content).toContain('Drive PDF: chapter-3.pdf');
    expect(args.messages[1].content).toContain('long text here');
  });

  it('throws when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(
      summarizeMaterial({ fileName: 'foo', extractedText: 'bar' }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('throws when the model returns empty content', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: '' } }] });
    await expect(
      summarizeMaterial({ fileName: 'foo', extractedText: 'bar' }),
    ).rejects.toThrow(/No content/);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/material-summary.test.ts`
Expected: FAIL — `summarizeMaterial` not found.

- [ ] **Step 5: Implement the summarizer**

Create `lib/ai/analyze/material-summary.ts`:

```ts
import OpenAI from 'openai';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { resolveModelForFunction } from '@/lib/ai/function-settings';

export interface SummarizeInput {
  fileName: string;
  extractedText: string;
}

export interface SummarizeResult {
  summary: string;
  model: string;
}

export async function summarizeMaterial(input: SummarizeInput): Promise<SummarizeResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const client = new OpenAI({ apiKey });

  const model = await resolveModelForFunction('material-summary');
  const systemPrompt = await loadPrompt('material-summary');

  const userMessage = [
    `File name: ${input.fileName}`,
    '',
    'Material content begins:',
    '---',
    input.extractedText,
    '---',
    'End of material content.',
  ].join('\n');

  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  const summary = response.choices[0]?.message?.content;
  if (!summary) throw new Error('No content in summarizer response');
  return { summary, model };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/material-summary.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add lib/ai/analyze/material-summary.ts lib/ai/prompts/material-summary.md \
        lib/ai/function-settings.ts tests/lib/ai/material-summary.test.ts
git commit -m "feat(capture): add material-summary function and prompt"
```

---

### Task 4: DB writers for summary + useSummary

**Files:**
- Modify: `lib/db/course-materials-queries.ts`

- [ ] **Step 1: Add the writer functions**

Append to `lib/db/course-materials-queries.ts`:

```ts
export interface UpdateMaterialSummaryInput {
  id: string;
  summary: string;
  summaryModel: string;
}
// Writes a fresh summary and turns useSummary ON. Callers that want to
// keep useSummary off (e.g., a re-summary done while faculty have it
// explicitly disabled) should follow up with setMaterialUseSummary.
export async function updateMaterialSummary(input: UpdateMaterialSummaryInput): Promise<void> {
  await db
    .update(courseMaterials)
    .set({
      summary: input.summary,
      summaryModel: input.summaryModel,
      summaryGeneratedAt: new Date(),
      useSummary: true,
    })
    .where(eq(courseMaterials.id, input.id));
}

export async function setMaterialUseSummary(id: string, useSummary: boolean): Promise<boolean> {
  const rows = await db
    .update(courseMaterials)
    .set({ useSummary })
    .where(eq(courseMaterials.id, id))
    .returning({ id: courseMaterials.id });
  return rows.length > 0;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add lib/db/course-materials-queries.ts
git commit -m "feat(capture): add updateMaterialSummary and setMaterialUseSummary"
```

---

### Task 5: `finalizeExtraction` shared helper (TDD)

The single place that decides "extraction is done — should we also summarize?". Every existing extraction call site will switch to this helper in Task 6.

**Files:**
- Create: `lib/capture/finalize-extraction.ts`
- Create: `tests/lib/capture/finalize-extraction.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/capture/finalize-extraction.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateExtractionResult = vi.fn();
const updateMaterialSummary = vi.fn();
const summarizeMaterial = vi.fn();

vi.mock('@/lib/db/course-materials-queries', () => ({
  updateExtractionResult: (...args: unknown[]) => updateExtractionResult(...args),
  updateMaterialSummary: (...args: unknown[]) => updateMaterialSummary(...args),
}));
vi.mock('@/lib/ai/analyze/material-summary', () => ({
  summarizeMaterial: (...args: unknown[]) => summarizeMaterial(...args),
}));

import { finalizeExtraction } from '@/lib/capture/finalize-extraction';

const LONG = 'x'.repeat(60_001); // > 15k tokens

describe('finalizeExtraction', () => {
  beforeEach(() => {
    updateExtractionResult.mockReset().mockResolvedValue(undefined);
    updateMaterialSummary.mockReset().mockResolvedValue(undefined);
    summarizeMaterial.mockReset();
  });

  it('writes extraction result and skips summarization when not a candidate (short)', async () => {
    await finalizeExtraction({
      id: 'm1',
      fileName: 'Drive PDF: short.pdf',
      extractionStatus: 'ok',
      extractedText: 'short',
    });
    expect(updateExtractionResult).toHaveBeenCalledOnce();
    expect(summarizeMaterial).not.toHaveBeenCalled();
    expect(updateMaterialSummary).not.toHaveBeenCalled();
  });

  it('writes extraction result and skips summarization when not a candidate (dense kind)', async () => {
    await finalizeExtraction({
      id: 'm1',
      fileName: 'Canvas: Pages',
      extractionStatus: 'ok',
      extractedText: LONG,
    });
    expect(summarizeMaterial).not.toHaveBeenCalled();
  });

  it('writes extraction result and skips summarization when status is not ok', async () => {
    await finalizeExtraction({
      id: 'm1',
      fileName: 'Drive PDF: long.pdf',
      extractionStatus: 'low_text',
      extractedText: LONG,
    });
    expect(summarizeMaterial).not.toHaveBeenCalled();
  });

  it('summarizes when candidate and status ok', async () => {
    summarizeMaterial.mockResolvedValue({ summary: 'SUMMARY', model: 'gpt-5.4-mini' });
    await finalizeExtraction({
      id: 'm1',
      fileName: 'Drive PDF: chapter-3.pdf',
      extractionStatus: 'ok',
      extractedText: LONG,
    });
    expect(summarizeMaterial).toHaveBeenCalledOnce();
    expect(summarizeMaterial.mock.calls[0]![0]).toEqual({
      fileName: 'Drive PDF: chapter-3.pdf',
      extractedText: LONG,
    });
    expect(updateMaterialSummary).toHaveBeenCalledWith({
      id: 'm1',
      summary: 'SUMMARY',
      summaryModel: 'gpt-5.4-mini',
    });
  });

  it('does not throw when the summarizer fails — extraction succeeds anyway', async () => {
    summarizeMaterial.mockRejectedValue(new Error('OpenAI 500'));
    await expect(finalizeExtraction({
      id: 'm1',
      fileName: 'Drive PDF: long.pdf',
      extractionStatus: 'ok',
      extractedText: LONG,
    })).resolves.toBeUndefined();
    expect(updateExtractionResult).toHaveBeenCalledOnce();
    expect(updateMaterialSummary).not.toHaveBeenCalled();
  });

  it('passes through extractionMethod and pageCount', async () => {
    await finalizeExtraction({
      id: 'm1',
      fileName: 'foo.pdf',
      extractionStatus: 'ok',
      extractionMethod: 'vision',
      pageCount: 42,
      extractedText: 'short',
    });
    expect(updateExtractionResult).toHaveBeenCalledWith({
      id: 'm1',
      extractionStatus: 'ok',
      extractionMethod: 'vision',
      pageCount: 42,
      extractedText: 'short',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/lib/capture/finalize-extraction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `lib/capture/finalize-extraction.ts`:

```ts
import {
  updateExtractionResult,
  updateMaterialSummary,
  type ExtractionStatus,
  type ExtractionMethod,
} from '@/lib/db/course-materials-queries';
import { isCompressionCandidate } from '@/lib/capture/material-compression';
import { summarizeMaterial } from '@/lib/ai/analyze/material-summary';

export interface FinalizeExtractionInput {
  id: string;
  fileName: string;
  extractionStatus: ExtractionStatus;
  extractionMethod?: ExtractionMethod;
  extractedText?: string;
  pageCount?: number;
}

/**
 * Persist the result of an extraction attempt and, when the material is a
 * reference-style compression candidate, generate and persist a structured
 * summary in the same call. The summary call is best-effort: failures are
 * logged and swallowed so an OpenAI hiccup never fails an upload.
 *
 * Replaces direct `updateExtractionResult` calls in every extraction-completion
 * site (uploads, canvas import, scan-linked-docs, canvas re-extract).
 */
export async function finalizeExtraction(input: FinalizeExtractionInput): Promise<void> {
  await updateExtractionResult({
    id: input.id,
    extractionStatus: input.extractionStatus,
    ...(input.extractionMethod !== undefined && { extractionMethod: input.extractionMethod }),
    ...(input.extractedText !== undefined && { extractedText: input.extractedText }),
    ...(input.pageCount !== undefined && { pageCount: input.pageCount }),
  });

  if (input.extractionStatus !== 'ok') return;
  if (!input.extractedText) return;

  const candidate = isCompressionCandidate({
    fileName: input.fileName,
    extractedText: input.extractedText,
    summary: null,
    useSummary: false,
  });
  if (!candidate) return;

  try {
    const { summary, model } = await summarizeMaterial({
      fileName: input.fileName,
      extractedText: input.extractedText,
    });
    await updateMaterialSummary({ id: input.id, summary, summaryModel: model });
  } catch (err) {
    console.error(`finalizeExtraction: summarizer failed for ${input.id} (${input.fileName})`, err);
    // Intentionally swallowed — extraction itself succeeded. The backfill
    // endpoint can re-attempt later.
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/lib/capture/finalize-extraction.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/capture/finalize-extraction.ts tests/lib/capture/finalize-extraction.test.ts
git commit -m "feat(capture): finalizeExtraction wraps updateExtractionResult + auto-summary"
```

---

### Task 6: Wire `finalizeExtraction` into every extraction call site

This is mechanical. For each call site, replace the import + replace the call. The helper accepts a superset of `updateExtractionResult`'s args (it additionally needs `fileName`, which is in scope at every call site because the material row was just loaded or just inserted).

**Files:**
- Modify: `app/api/courses/[code]/materials/route.ts`
- Modify: `app/api/courses/[code]/canvas-import/route.ts` (2 call sites)
- Modify: `app/api/courses/[code]/scan-linked-docs/route.ts` (6 call sites)
- Modify: `app/api/courses/[code]/canvas-reextract/route.ts` (verify call count)

- [ ] **Step 1: Replace in `materials/route.ts` (upload path)**

Open `app/api/courses/[code]/materials/route.ts:8` and `:117`.

Change the import line from:
```ts
import { insertMaterial, updateExtractionResult } from '@/lib/db/course-materials-queries';
```
to:
```ts
import { insertMaterial } from '@/lib/db/course-materials-queries';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
```

At line ~117, change the call from:
```ts
await updateExtractionResult({
  id: row.id,
  extractionStatus,
  extractionMethod,
  extractedText,
  pageCount,
});
```
to:
```ts
await finalizeExtraction({
  id: row.id,
  fileName: row.fileName,
  extractionStatus,
  extractionMethod,
  extractedText,
  pageCount,
});
```

If the local variable names differ in your file (e.g., `material` instead of `row`), adapt accordingly — the rule is "pass the same args plus `fileName`."

- [ ] **Step 2: Replace in `canvas-import/route.ts`**

Same pattern. Two call sites at lines ~297 and ~314. Identify the row variable at each call site (it's the row that was just inserted/updated for the Canvas item) and pass its `fileName`. Keep the import block updated.

- [ ] **Step 3: Replace in `scan-linked-docs/route.ts`**

Six call sites at lines ~104, ~121, ~169, ~186, ~234, ~258 (Google docs, slides, sheets, Drive PDFs, YouTube transcripts, etc.). Same pattern at each. The Google-side handlers usually set extractionStatus to 'ok' on success and 'failed' on error — both paths should go through `finalizeExtraction` (the helper itself skips summarization when status isn't 'ok').

- [ ] **Step 4: Replace in `canvas-reextract/route.ts`**

Same pattern. Find every `updateExtractionResult` call (use `grep -n updateExtractionResult app/api/courses/\[code\]/canvas-reextract/route.ts`) and swap.

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit -p tsconfig.json && pnpm lint`
Expected: clean.

- [ ] **Step 6: Smoke test — upload one long PDF**

With `pnpm dev:lan` running:

1. From the Materials panel of any test course, upload a PDF that you know is >60k characters of extracted text (a textbook chapter, say).
2. Watch `/tmp/curriculum-next.log` — you should see the Docling extraction complete, then a short pause as the summarizer runs, then the response returns.
3. Re-fetch via `/api/capture/<code>/context?slug=<slug>` and confirm the returned material has non-null `summary` and `useSummary: true`.

- [ ] **Step 7: Commit**

```bash
git add app/api/courses/[code]/
git commit -m "feat(capture): route every extraction completion through finalizeExtraction"
```

---

### Task 7: Capture-chat uses summaries when present

**Files:**
- Modify: `lib/ai/analyze/capture-chat.ts`
- Modify: `app/api/capture/[code]/chat/route.ts`

- [ ] **Step 1: Extend the chat context material type**

In `lib/ai/analyze/capture-chat.ts`, update `CaptureChatMaterial`:

```ts
export interface CaptureChatMaterial {
  id: string;
  fileName: string;
  extractionStatus: string;
  extractedText: string | null;
  summary: string | null;
  useSummary: boolean;
}
```

- [ ] **Step 2: Substitute summary in formatMaterials**

Replace the body of `formatMaterials` in the same file:

```ts
import { effectiveAuditText } from '@/lib/capture/material-compression';

function formatMaterials(materials: CaptureChatMaterial[]): string {
  if (materials.length === 0) return '**Uploaded and Canvas-imported materials:**\n(none)';
  const sections: string[] = ['**Uploaded and Canvas-imported materials:**'];
  for (const m of materials) {
    const usingSummary = m.useSummary && m.summary !== null;
    const tag = usingSummary ? ' (audit summary — full text on file)' : '';
    const header = `### ${m.fileName} [status: ${m.extractionStatus}]${tag}`;
    const text = effectiveAuditText(m);
    const body = text && text.length > 0 ? text : '(no extracted text available)';
    sections.push(header, body, '');
  }
  return sections.join('\n');
}
```

- [ ] **Step 3: Pass the new fields from the chat route**

In `app/api/capture/[code]/chat/route.ts`, the `.map(m => ({ ... }))` that builds `context.materials`. Add two fields:

```ts
materials: materials
  .filter(m => !m.ignored)
  .map(m => ({
    id: m.id,
    fileName: m.fileName,
    extractionStatus: m.extractionStatus,
    extractedText: m.extractedText,
    summary: m.summary,
    useSummary: m.useSummary,
  })),
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/analyze/capture-chat.ts app/api/capture/[code]/chat/route.ts
git commit -m "feat(capture): audit chat substitutes summary for long materials"
```

---

### Task 8: PATCH endpoint accepts useSummary

**Files:**
- Modify: `app/api/courses/[code]/materials/[id]/route.ts`

- [ ] **Step 1: Locate the PATCH handler**

Open `app/api/courses/[code]/materials/[id]/route.ts`. The handler currently accepts `{ ignored: boolean }`.

- [ ] **Step 2: Extend it to accept useSummary**

Update the body parsing + dispatch. Pseudocode of the desired shape:

```ts
import { setMaterialIgnored, setMaterialUseSummary } from '@/lib/db/course-materials-queries';

const body = await req.json().catch(() => ({})) as { ignored?: boolean; useSummary?: boolean };

if (typeof body.ignored === 'boolean') {
  const ok = await setMaterialIgnored(id, body.ignored);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
}
if (typeof body.useSummary === 'boolean') {
  const ok = await setMaterialUseSummary(id, body.useSummary);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
}
return NextResponse.json({ ok: true });
```

Preserve the existing rate-limit + slug-check + course-existence checks that already wrap the handler — only the body parsing and dispatch change. If the original handler uses different argument names / response shape, match those.

- [ ] **Step 3: Type-check + smoke test**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

```bash
curl -sS -X PATCH 'http://localhost:3000/api/courses/GC%204800/materials/<id>?slug=<slug>' \
  -H 'content-type: application/json' -d '{"useSummary": false}'
```
Expected: `{"ok": true}`. Re-fetch via `/api/capture/GC%204800/context?slug=...` and confirm `useSummary` is now `false`.

- [ ] **Step 4: Commit**

```bash
git add app/api/courses/[code]/materials/[id]/route.ts
git commit -m "feat(capture): PATCH /materials/[id] accepts useSummary toggle"
```

---

### Task 9: Capture context endpoint surfaces summary fields

**Files:**
- Modify: `app/api/capture/[code]/context/route.ts`

- [ ] **Step 1: Add summary fields to the materials projection**

Find the route's `materials: materials.map(m => ({ ... }))` block. Add three fields:

```ts
materials: materials.map(m => ({
  id: m.id,
  fileName: m.fileName,
  mimeType: m.mimeType,
  sizeBytes: m.sizeBytes,
  pageCount: m.pageCount,
  extractionStatus: m.extractionStatus,
  extractionMethod: m.extractionMethod,
  extractedText: m.extractedText,
  ignored: m.ignored,
  summary: m.summary,
  summaryGeneratedAt: m.summaryGeneratedAt,
  useSummary: m.useSummary,
})),
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean (the client doesn't yet consume the new fields — that's Task 11).

- [ ] **Step 3: Commit**

```bash
git add app/api/capture/[code]/context/route.ts
git commit -m "feat(capture): context endpoint surfaces summary fields"
```

---

### Task 10: Backfill endpoint for pre-existing materials

For materials uploaded before this feature shipped, `summary` is null. This endpoint walks the course's compression-eligible materials and summarizes anything that doesn't already have one. Faculty trigger it once per course; the UI in Task 11 wires up the button.

**Files:**
- Create: `app/api/courses/[code]/materials/compress/route.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse, updateMaterialSummary } from '@/lib/db/course-materials-queries';
import { isCompressionCandidate } from '@/lib/capture/material-compression';
import { summarizeMaterial } from '@/lib/ai/analyze/material-summary';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// POST /api/courses/[code]/materials/compress?slug=...
// Body: { force?: boolean }  // if true, re-summarize rows that already have a summary
// Returns: { summarized: number, skipped: number, failed: number, results: ... }
//
// Backfill for materials uploaded before reference-compression shipped, or
// for re-running the summarizer after a prompt change. The primary path is
// finalizeExtraction at upload time; this endpoint is the escape hatch.
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { force?: boolean };
  const force = body.force === true;

  const materials = await listMaterialsByCourse(courseCode);
  const candidates = materials.filter(m =>
    !m.ignored &&
    isCompressionCandidate({
      fileName: m.fileName,
      extractedText: m.extractedText,
      summary: m.summary,
      useSummary: m.useSummary,
    }) &&
    (force || m.summary === null),
  );

  let summarized = 0;
  let failed = 0;
  const skipped = materials.length - candidates.length;
  const results: Array<{ id: string; fileName: string; status: 'summarized' | 'failed'; reason?: string }> = [];

  // Serial: keeps OpenAI usage predictable. Faculty hit this rarely.
  for (const m of candidates) {
    try {
      const { summary, model } = await summarizeMaterial({
        fileName: m.fileName,
        extractedText: m.extractedText!,
      });
      await updateMaterialSummary({ id: m.id, summary, summaryModel: model });
      summarized += 1;
      results.push({ id: m.id, fileName: m.fileName, status: 'summarized' });
    } catch (err) {
      failed += 1;
      const reason = err instanceof Error ? err.message : 'unknown error';
      console.error(`material-summary failed for ${m.id} (${m.fileName})`, err);
      results.push({ id: m.id, fileName: m.fileName, status: 'failed', reason });
    }
  }

  return NextResponse.json({ summarized, skipped, failed, results });
}
```

- [ ] **Step 2: Type-check + smoke test**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

```bash
curl -sS -X POST 'http://localhost:3000/api/courses/GC%204800/materials/compress?slug=<slug>' \
  -H 'content-type: application/json' -d '{}' | jq
```
Expected: `summarized` reflects however many pre-existing long reference materials were eligible; `failed: 0`. Re-running returns `summarized: 0` (already cached). Run with `{"force": true}` to re-summarize.

- [ ] **Step 3: Commit**

```bash
git add app/api/courses/[code]/materials/compress/route.ts
git commit -m "feat(capture): backfill endpoint for compression of pre-existing materials"
```

---

### Task 11: UI — summary fields + per-row toggle + backfill button

**Files:**
- Modify: `app/capture/[code]/MaterialsPanel.tsx`

- [ ] **Step 1: Extend the client type**

In `MaterialsPanel.tsx`, update `CaptureMaterial`:

```ts
export interface CaptureMaterial {
  // ...existing fields...
  summary: string | null;
  summaryGeneratedAt: string | null;
  useSummary: boolean;
}
```

Update `refetchMaterialsFromContext`'s response type identically.

In `handleFiles`, the newly inserted upload row needs initial values for the new fields (it gets refreshed shortly after via context refetch, but the optimistic insert must still typecheck):

```ts
const newMaterial: CaptureMaterial = {
  // ...existing fields...
  summary: null,
  summaryGeneratedAt: null,
  useSummary: false,
};
```

- [ ] **Step 2: Show summary token count + "summarized" badge in MaterialRow**

Inside `MaterialRow`, after the existing `tokenEstimate` line:

```ts
const summaryTokenEstimate = material.summary ? estimateTokens(material.summary) : 0;
const usingSummary = material.useSummary && material.summary !== null;
```

In the badge row (where the kind badges and `<StatusChip>` live), add immediately after `<StatusChip>`:

```tsx
{material.summary && (
  <span
    className={
      'rounded px-1.5 py-0.5 text-[10px] font-medium ' +
      (usingSummary
        ? 'bg-teal-100 text-teal-800'
        : 'bg-slate-100 text-slate-600')
    }
    title={
      usingSummary
        ? 'The audit prompt uses this material\'s structured summary instead of its full extracted text.'
        : 'A summary exists but is currently disabled — the audit uses the full extracted text.'
    }
  >
    {usingSummary ? `summary (~${formatTokens(summaryTokenEstimate)})` : 'summary off'}
  </span>
)}
```

In the meta line, append after the existing token-estimate span:

```tsx
{usingSummary && summaryTokenEstimate > 0 && (
  <span className="text-teal-700" title="Tokens the summary contributes to the audit prompt (replaces the full token count shown above).">
    audit sends ~{formatTokens(summaryTokenEstimate)} ·{' '}
  </span>
)}
```

In the action row (where `ignore`, `preview`, `delete` live), add BEFORE the `ignore` label, ONLY when a summary exists:

```tsx
{material.summary && (
  <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
    <input
      type="checkbox"
      checked={material.useSummary}
      onChange={e => onToggleUseSummary(e.target.checked)}
      disabled={busy}
      className="h-3 w-3"
    />
    summarize
  </label>
)}
```

Add `onToggleUseSummary: (next: boolean) => void` to the `MaterialRow` props interface.

- [ ] **Step 3: Wire up the toggle in MaterialsPanel**

Sibling to `toggleIgnored`:

```ts
async function toggleUseSummary(id: string, useSummary: boolean) {
  setBusy(id);
  try {
    const res = await fetch(
      `/api/courses/${encodeURIComponent(course.code)}/materials/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ useSummary }),
      },
    );
    if (res.ok) {
      pushMaterials(materials.map(m => (m.id === id ? { ...m, useSummary } : m)));
    }
  } finally {
    setBusy(null);
  }
}
```

Pass it to each `<MaterialRow>`:

```tsx
onToggleUseSummary={next => toggleUseSummary(m.id, next)}
```

- [ ] **Step 4: Add the "Compress existing materials" backfill button**

In the materials-section header (next to "Scan linked files" and "Import from Canvas"), add a new button BEFORE "Scan linked files":

```tsx
<button
  type="button"
  onClick={handleCompressMaterials}
  disabled={compressing}
  title="One-time backfill: generate structured summaries for any long reference materials uploaded before auto-compression shipped. New uploads are summarized automatically."
  className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
>
  {compressing ? 'Compressing…' : 'Compress existing materials'}
</button>
```

Add state at the top of `MaterialsPanel`:

```ts
const [compressing, setCompressing] = useState(false);
const [compressMessage, setCompressMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
```

Add the handler:

```ts
async function handleCompressMaterials() {
  setCompressing(true);
  setCompressMessage(null);
  try {
    const res = await fetch(
      `/api/courses/${encodeURIComponent(course.code)}/materials/compress?slug=${encodeURIComponent(slug)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    const json = await res.json() as {
      summarized?: number; skipped?: number; failed?: number; error?: string;
    };
    if (!res.ok) {
      setCompressMessage({ kind: 'error', text: json.error ?? `Compress failed (${res.status})` });
      return;
    }
    const parts = [`summarized ${json.summarized ?? 0}`];
    if ((json.skipped ?? 0) > 0) parts.push(`${json.skipped} skipped`);
    if ((json.failed ?? 0) > 0) parts.push(`${json.failed} failed`);
    setCompressMessage({ kind: (json.failed ?? 0) > 0 ? 'error' : 'ok', text: parts.join(', ') + '.' });
    await refetchMaterialsFromContext();
  } catch (e) {
    setCompressMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Compress failed' });
  } finally {
    setCompressing(false);
  }
}
```

Render `compressMessage` next to `scanMessage` / `reextractMessage` using the same banner pattern.

- [ ] **Step 5: Type-check + visual smoke test**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

In a browser at the affected capture page:
1. Reload — every material shows token estimate (already shipped).
2. Click "Compress existing materials" — banner reports `summarized N, skipped M`.
3. Long reference materials now display the `summary (~Xk)` badge and the `audit sends ~Xk` meta entry; the per-row `summarize` checkbox is checked.
4. Uncheck `summarize` on one row → badge flips to `summary off`, `audit sends` line disappears.
5. Click "Start session" — request succeeds (no 500 in `/tmp/curriculum-next.log`).
6. Upload one new long PDF — observe Docling + summarizer in the log, then refresh the page; the new row already has `summary (~Xk)` badge without clicking the backfill button.

- [ ] **Step 6: Commit**

```bash
git add app/capture/[code]/MaterialsPanel.tsx
git commit -m "feat(capture): UI for material compression — badge, toggle, backfill button"
```

---

### Task 12: Update the user-facing guide

**Files:**
- Modify: `docs/coursecapture-guide.md` (confirm exact filename via `ls docs/*guide*.md`)

- [ ] **Step 1: Add a "What if the audit won't start?" section**

Append under troubleshooting / FAQ:

```
## How material compression works

The auditor's prompt has a hard upper size limit. To stay under it without
losing the auditor's view of every material, the system automatically
generates a structured summary of long reference-style materials at upload
time:

- Textbook PDFs, reading PDFs (Drive PDFs), YouTube transcripts, and any
  plain PDF/DOCX upload over ~15,000 tokens get summarized.
- Canvas pages, syllabus, assignments, modules, quizzes, and Google Docs/
  Slides/Sheets are kept verbatim — that's the assignment-grade detail the
  audit needs.

In the Materials list, each row shows its estimated token contribution.
Summarized rows display a `summary (~Xk)` badge and an `audit sends ~Xk`
meta entry; you can uncheck the `summarize` box on any row to fall back to
the full text for that specific material.

If you have materials uploaded before this feature shipped, click
**Compress existing materials** once per course to backfill. New uploads
are summarized automatically.
```

- [ ] **Step 2: Commit**

```bash
git add docs/coursecapture-guide.md
git commit -m "docs(guide): document automatic material compression"
```

---

## Self-review checklist (for the implementer)

- [ ] Audit chat call to OpenAI no longer 500s on the original failing course (compare against `/tmp/curriculum-next.log`).
- [ ] `pnpm vitest run` — every test passes, not just the new ones.
- [ ] `npx tsc --noEmit -p tsconfig.json` — clean.
- [ ] No new ESLint warnings: `pnpm lint`.
- [ ] PATCH endpoint still works for the existing `{ ignored: boolean }` body (regression check — toggle "ignore" on any material).
- [ ] `grep -rn updateExtractionResult app/api/courses` returns nothing — every call site has been migrated to `finalizeExtraction`.
- [ ] Toggling `summarize` off on a compressed row and re-clicking "Start session" demonstrably re-includes the full text.
- [ ] An upload of a known-long PDF leaves the new row with `summary` non-null and `useSummary: true` without any further user action.

---

## Future directions (out of scope here)

When today's `gpt-5.4` headroom + reference compression stop being enough, the next layer is the two-tier shape from the design discussion:

**Tier 1: Universal per-material structured digest.**
Generated for *every* material at extraction time (not just long ones), stored in a sibling column or table. Always in the audit context regardless of size. Bounds the floor instead of compressing the ceiling.

**Tier 2: Agent-driven retrieval.**
Refactor the audit chat from a single-shot call to a multi-step agent loop. Give the auditor a `fetch_material_section(id, query)` tool backed by chunk-level retrieval (embeddings, vector store). Most turns won't need it; the ones that do get verbatim evidence on demand.

This plan deliberately stops short of both, because (a) we only have one course's worth of evidence about where the cap actually binds, (b) the agentic loop is a meaningful protocol change to the chat route, and (c) the digest pattern is the harder thing to get right and benefits from seeing 2–3 courses' worth of failure modes first.

Once 1–2 more faculty hit the wall even *after* compression, revisit and write the next plan.
