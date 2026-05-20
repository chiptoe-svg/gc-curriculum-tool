# Faculty Assignment Intake — Plan 1: Upload & Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the schema, Vercel Blob upload, text extraction, and the Materials zone of the per-course page — everything Plans 2 and 3 build on.

**Architecture:** Three new Drizzle tables (`course_materials`, `course_profiles`, `course_profile_runs`) land in one migration so Plans 2 and 3 can consume them without schema changes. Upload (`POST /api/courses/[code]/materials`) runs extraction synchronously: DOCX via `mammoth`, digital PDF via `pdf-parse`, image-based PDF via a new `transcribeDocument` method on the provider abstraction. The per-course page (`app/preview/[slug]/courses/[code]/page.tsx`) renders the Materials zone only — upload zone, file list with status badges, delete button, per-file progress. Analysis zones are added by Plans 2 and 3.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle ORM + Neon Postgres, Vitest, React 19, Tailwind v4, shadcn/ui primitives (`Badge`, `Button`, `Label`), `@vercel/blob`, `mammoth`, `pdf-parse`. Package manager: pnpm.

**Spec:** [`docs/superpowers/specs/2026-05-19-faculty-assignment-intake-design.md`](../specs/2026-05-19-faculty-assignment-intake-design.md).

---

## File Structure

**New files (created by this plan):**

```
drizzle/
  0009_<auto>.sql                                # three new tables

lib/db/
  __tests__/
    course-materials-schema.test.ts              # smoke-tests all three tables
  course-materials-queries.ts                    # CRUD for course_materials rows

lib/courses/
  extract-text.ts                                # DOCX / PDF / vision dispatcher

app/
  api/
    courses/
      [code]/
        materials/
          route.ts                               # POST upload + DELETE /:id
          [id]/
            route.ts                             # DELETE individual material

  preview/
    [slug]/
      courses/
        [code]/
          page.tsx                               # per-course page (Materials zone)
          MaterialsZone.tsx                      # client: owns materials state, renders UploadZone + file list
          MaterialsList.tsx                      # client: pure presentational file list + delete button
          UploadZone.tsx                         # client: drag-drop upload zone

tests/
  courses/
    extract-text.test.ts                         # extraction unit tests
  api/
    course-materials.test.ts                     # upload + delete route tests
  components/
    UploadZone.test.tsx                          # upload zone component tests
    MaterialsZone.test.tsx                       # MaterialsZone integration test
```

**Modified files:**

- `lib/db/schema.ts` — append `courseMaterials`, `courseProfiles`, `courseProfileRuns` tables.
- `lib/ai/provider.ts` — add `transcribeDocument` to `AIProvider` interface.
- `lib/ai/openai.ts` — implement `transcribeDocument` on `OpenAIProvider`.
- `lib/ai/fake-provider.ts` — implement `transcribeDocument` on `FakeProvider`.
- `.env.example` — add `BLOB_READ_WRITE_TOKEN`.

---

## Task 1: Install new dependencies + add env var

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install packages**

Run: `pnpm add @vercel/blob mammoth pdf-parse && pnpm add -D @types/mammoth @types/pdf-parse`

Expected: `package.json` gains `@vercel/blob`, `mammoth`, `pdf-parse` in `dependencies` and their types in `devDependencies`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Add env var to `.env.example`**

Open `.env.example`. After the existing `SYNTHESIS_STALENESS_THRESHOLD` line, append:

```bash

# Vercel Blob (upload bucket for faculty assignment materials)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "feat(deps): add @vercel/blob, mammoth, pdf-parse; add BLOB_READ_WRITE_TOKEN env var"
```

---

## Task 2: Schema — three new tables + migration

**Files:**
- Modify: `lib/db/schema.ts`
- Generate: `drizzle/0009_<auto>.sql`
- Create: `lib/db/__tests__/course-materials-schema.test.ts`

- [ ] **Step 1: Append three table definitions to `lib/db/schema.ts`**

After the existing `synthesisRuns` table at the end of the file, add:

```typescript
export const courseMaterials = pgTable('course_materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  blobUrl: text('blob_url').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  pageCount: integer('page_count'),
  extractionMethod: text('extraction_method'),      // 'text' | 'vision' | null
  extractionStatus: text('extraction_status').notNull().default('pending'), // 'pending' | 'ok' | 'low_text' | 'failed'
  extractedText: text('extracted_text'),
  analysisFinding: jsonb('analysis_finding').$type<{
    materialType: string;
    competencies: Array<{ name: string; description: string; evidenceQuotes: string[] }>;
    skills: string[];
    notes: string;
  }>(),
  analysisModel: text('analysis_model'),
  analysisCostUsdCents: integer('analysis_cost_usd_cents'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  ipHash: text('ip_hash').notNull(),
});

export const courseProfiles = pgTable('course_profiles', {
  courseCode: text('course_code').primaryKey().references(() => courses.code, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  learningObjectives: jsonb('learning_objectives').$type<string[]>().notNull().default([]),
  skills: jsonb('skills').$type<string[]>().notNull().default([]),
  competencies: jsonb('competencies').$type<Array<{
    name: string;
    description: string;
    level: string;
    evidence: Array<{ fileName: string; quote: string }>;
  }>>().notNull().default([]),
  catalogDivergence: jsonb('catalog_divergence').$type<{
    reinforced: string[];
    additions: string[];
    gaps: string[];
  }>().notNull().default({ reinforced: [], additions: [], gaps: [] }),
  sourceRunId: uuid('source_run_id'),
  manuallyEdited: boolean('manually_edited').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const courseProfileRuns = pgTable('course_profile_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  result: jsonb('result').$type<{
    summary: string;
    learningObjectives: string[];
    skills: string[];
    competencies: Array<{
      name: string;
      description: string;
      level: string;
      evidence: Array<{ fileName: string; quote: string }>;
    }>;
    catalogDivergence: { reinforced: string[]; additions: string[]; gaps: string[] };
  }>().notNull(),
  materialCount: integer('material_count').notNull(),
  model: text('model').notNull(),
  costUsdCents: integer('cost_usd_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Generate migration**

Run: `pnpm db:generate`

Expected: `drizzle/0009_*.sql` appears containing `CREATE TABLE "course_materials"`, `CREATE TABLE "course_profiles"`, `CREATE TABLE "course_profile_runs"`.

- [ ] **Step 3: Write the schema smoke test**

Create `lib/db/__tests__/course-materials-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { courseMaterials, courseProfiles, courseProfileRuns } from '@/lib/db/schema';

describe('course_materials schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(courseMaterials);
    for (const c of [
      'id', 'courseCode', 'fileName', 'blobUrl', 'mimeType', 'sizeBytes',
      'pageCount', 'extractionMethod', 'extractionStatus', 'extractedText',
      'analysisFinding', 'analysisModel', 'analysisCostUsdCents',
      'uploadedAt', 'ipHash',
    ]) {
      expect(cols).toContain(c);
    }
  });
});

describe('course_profiles schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(courseProfiles);
    for (const c of [
      'courseCode', 'summary', 'learningObjectives', 'skills',
      'competencies', 'catalogDivergence', 'sourceRunId', 'manuallyEdited', 'updatedAt',
    ]) {
      expect(cols).toContain(c);
    }
  });
});

describe('course_profile_runs schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(courseProfileRuns);
    for (const c of [
      'id', 'courseCode', 'result', 'materialCount', 'model', 'costUsdCents', 'createdAt',
    ]) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 4: Run the smoke test**

Run: `pnpm test lib/db/__tests__/course-materials-schema.test.ts`

Expected: 3 passing tests.

- [ ] **Step 5: Apply migration**

Run: `pnpm db:migrate`

If `DATABASE_URL` is missing from the shell, prefix with: `set -a && source .env.local && set +a && pnpm db:migrate`

Expected: migration applied without error.

- [ ] **Step 6: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts drizzle/0009_*.sql lib/db/__tests__/course-materials-schema.test.ts
git commit -m "feat(db): add course_materials, course_profiles, course_profile_runs tables"
```

---

## Task 3: `course-materials-queries.ts` — CRUD for `course_materials`

**Files:**
- Create: `lib/db/course-materials-queries.ts`

No separate test file for this task — the queries are exercised via the route tests in Task 7. The schema types are already validated by T2.

- [ ] **Step 1: Create the queries module**

Create `lib/db/course-materials-queries.ts`:

```typescript
import { eq, asc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials } from '@/lib/db/schema';

export type CourseMaterialRow = typeof courseMaterials.$inferSelect;
export type ExtractionStatus = 'pending' | 'ok' | 'low_text' | 'failed';
export type ExtractionMethod = 'text' | 'vision';

export interface InsertMaterialInput {
  courseCode: string;
  fileName: string;
  blobUrl: string;
  mimeType: string;
  sizeBytes: number;
  ipHash: string;
}

export async function insertMaterial(input: InsertMaterialInput): Promise<CourseMaterialRow> {
  const [row] = await db
    .insert(courseMaterials)
    .values({ ...input, extractionStatus: 'pending' })
    .returning();
  if (!row) throw new Error('insertMaterial: no row returned');
  return row;
}

export async function listMaterialsByCourse(courseCode: string): Promise<CourseMaterialRow[]> {
  return db
    .select()
    .from(courseMaterials)
    .where(eq(courseMaterials.courseCode, courseCode))
    .orderBy(asc(courseMaterials.uploadedAt));
}

export interface UpdateExtractionInput {
  id: string;
  extractionStatus: ExtractionStatus;
  extractionMethod?: ExtractionMethod;
  extractedText?: string;
  pageCount?: number;
}

export async function updateExtractionResult(input: UpdateExtractionInput): Promise<void> {
  await db
    .update(courseMaterials)
    .set({
      extractionStatus: input.extractionStatus,
      ...(input.extractionMethod !== undefined && { extractionMethod: input.extractionMethod }),
      ...(input.extractedText !== undefined && { extractedText: input.extractedText }),
      ...(input.pageCount !== undefined && { pageCount: input.pageCount }),
    })
    .where(eq(courseMaterials.id, input.id));
}

export async function getMaterialById(id: string): Promise<CourseMaterialRow | null> {
  const rows = await db
    .select()
    .from(courseMaterials)
    .where(eq(courseMaterials.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteMaterial(id: string): Promise<void> {
  await db.delete(courseMaterials).where(eq(courseMaterials.id, id));
}
```

- [ ] **Step 2: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/course-materials-queries.ts
git commit -m "feat(db): course-materials-queries CRUD module"
```

---

## Task 4: Provider abstraction — `transcribeDocument`

**Files:**
- Modify: `lib/ai/provider.ts`
- Modify: `lib/ai/openai.ts`
- Modify: `lib/ai/fake-provider.ts`

- [ ] **Step 1: Add the method to the `AIProvider` interface**

Open `lib/ai/provider.ts`. After the `complete` method signature (line ~26), add a new method to the interface:

```typescript
export interface TranscribeDocumentArgs {
  fileBytes: Buffer;
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  /** Max pages to transcribe. Default: 40. */
  maxPages?: number;
}

export interface TranscribeDocumentResult {
  text: string;
  costUsdCents: number;
  /** True when the file exceeded maxPages and was truncated. */
  truncated: boolean;
}
```

Then add the method signature to the `AIProvider` interface:

```typescript
  /**
   * Send raw file bytes to a vision-capable model and return transcribed text.
   * Used only for image-based PDFs that yield too little text from pdf-parse.
   * Cost is NOT recorded here — caller is responsible for checkDailyCap + recordSpend.
   */
  transcribeDocument(args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult>;
```

The full updated `lib/ai/provider.ts` should look like:

```typescript
export interface CompletionTelemetry {
  costUsdCents: number;
  durationMs: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
}

export interface TranscribeDocumentArgs {
  fileBytes: Buffer;
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  maxPages?: number;
}

export interface TranscribeDocumentResult {
  text: string;
  costUsdCents: number;
  truncated: boolean;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;

  /**
   * Call the model with a system prompt and a user message.
   * Validates the response against the supplied JSON schema (provider-side validation
   * via response_format when the provider supports it; client-side validation always).
   * Returns the parsed object plus token/cost telemetry.
   */
  complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;            // for OpenAI structured outputs naming
    jsonSchema: object;
    validate: (raw: unknown) => T; // typically the Zod schema's parse
  }): Promise<{ data: T } & CompletionTelemetry>;

  /**
   * Send raw file bytes to a vision-capable model and return transcribed text.
   * Used only for image-based PDFs that yield too little text from pdf-parse.
   * Cost is NOT recorded here — caller is responsible for checkDailyCap + recordSpend.
   */
  transcribeDocument(args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult>;
}

import { OpenAIProvider } from './openai';

export function getProvider(): AIProvider {
  // Trim every env var defensively — Vercel sometimes preserves trailing
  // newlines from pasted values, and OpenAI rejects an API key with CR/LF.
  const which = process.env.AI_PROVIDER?.trim() || 'openai';
  if (which === 'openai') {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error('OPENAI_API_KEY not set');
    return new OpenAIProvider(process.env.OPENAI_MODEL?.trim() || 'gpt-5.4', key);
  }
  throw new Error(`Unknown AI provider: ${which}`);
}
```

- [ ] **Step 2: Implement `transcribeDocument` in `OpenAIProvider`**

Open `lib/ai/openai.ts`. Add the following method to the `OpenAIProvider` class after the `complete` method:

```typescript
  async transcribeDocument(args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult> {
    const { fileBytes, maxPages = 40 } = args;
    // Convert the raw PDF bytes to a base64 data URL for vision input.
    // We send the entire file as one image-URL message. For very long files we
    // truncate at maxPages — the caller sets this cap.
    const base64 = fileBytes.toString('base64');
    const dataUrl = `data:${args.mimeType};base64,${base64}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Please transcribe every piece of text visible in this document. Return plain text only, preserving the reading order. Do not add commentary. If pages are cut off, transcribe what is visible.`,
            },
            {
              type: 'file',
              file: {
                filename: 'document.pdf',
                file_data: dataUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0,
    });

    const text = response.choices[0]?.message?.content ?? '';
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const cachedTokens =
      (response.usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined)
        ?.prompt_tokens_details?.cached_tokens ?? 0;
    const uncachedPromptTokens = Math.max(0, promptTokens - cachedTokens);
    const pricing = MODEL_PRICING[this.model] ?? FALLBACK_PRICING;
    const costUsdCents =
      toCents((uncachedPromptTokens / 1_000_000) * pricing.input) +
      toCents((cachedTokens / 1_000_000) * pricing.input * 0.1) +
      toCents((completionTokens / 1_000_000) * pricing.output);

    // The vision API receives the full file; we cannot truly cap pages here.
    // We report truncated=true when the caller's maxPages cap is below a rough
    // estimate of the actual page count (we don't have pageCount at this point,
    // so we use file size as a heuristic: PDFs average ~50–100KB/page).
    const estimatedPages = Math.ceil(fileBytes.length / 75_000);
    const truncated = estimatedPages > maxPages;

    return { text, costUsdCents, truncated };
  }
```

Also add the import for `TranscribeDocumentArgs` and `TranscribeDocumentResult` at the top of `lib/ai/openai.ts`:

```typescript
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';
```

- [ ] **Step 3: Implement `transcribeDocument` in `FakeProvider`**

Open `lib/ai/fake-provider.ts`. Add a `transcribeResponses` queue and the method. The full updated file:

```typescript
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';

type FakeResponse = unknown;

export class FakeProvider implements AIProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  private responses: FakeResponse[];
  private callCount = 0;
  private transcribeResponses: string[];
  private transcribeCallCount = 0;

  constructor(responses: FakeResponse[], transcribeResponses: string[] = []) {
    this.responses = responses;
    this.transcribeResponses = transcribeResponses;
  }

  async complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
  }): Promise<{ data: T } & CompletionTelemetry> {
    const idx = this.callCount++;
    if (idx >= this.responses.length) {
      throw new Error(`FakeProvider exhausted at call ${idx}`);
    }
    const data = args.validate(this.responses[idx]);
    return { data, costUsdCents: 5, durationMs: 10, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 };
  }

  async transcribeDocument(_args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult> {
    const idx = this.transcribeCallCount++;
    const text = this.transcribeResponses[idx] ?? '';
    return { text, costUsdCents: 10, truncated: false };
  }

  reset() {
    this.callCount = 0;
    this.transcribeCallCount = 0;
  }
}
```

- [ ] **Step 4: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `pnpm test`

Expected: all existing tests pass (the `FakeProvider` change is additive — the `transcribeResponses` param defaults to `[]` so all existing usages still work).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/provider.ts lib/ai/openai.ts lib/ai/fake-provider.ts
git commit -m "feat(ai): add transcribeDocument to AIProvider interface + implementations"
```

---

## Task 5: Text-extraction dispatcher (`lib/courses/extract-text.ts`)

**Files:**
- Create: `lib/courses/extract-text.ts`
- Create: `tests/courses/extract-text.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/courses/extract-text.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks so they're available before imports are resolved.
const { mammoth, pdfParse, getProvider } = vi.hoisted(() => ({
  mammoth: { extractRawText: vi.fn() },
  pdfParse: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock('mammoth', () => ({ default: mammoth }));
vi.mock('pdf-parse', () => ({ default: pdfParse }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));

import { extractText } from '@/lib/courses/extract-text';

const fakeTranscribe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  getProvider.mockReturnValue({
    name: 'fake',
    model: 'fake-model',
    transcribeDocument: fakeTranscribe,
    complete: vi.fn(),
  });
});

describe('extractText — DOCX', () => {
  it('returns method=text, status=ok for a DOCX with good text', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: 'This is a rubric with lots of text to read.' });
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: 'rubric.docx',
    });
    expect(result.method).toBe('text');
    expect(result.status).toBe('ok');
    expect(result.text).toContain('rubric');
    expect(result.pageCount).toBeUndefined();
  });

  it('returns status=low_text when DOCX yields very little text', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: 'hi' });
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: 'blank.docx',
    });
    expect(result.status).toBe('low_text');
    expect(result.method).toBe('text');
  });

  it('returns status=failed when mammoth throws', async () => {
    mammoth.extractRawText.mockRejectedValue(new Error('corrupt file'));
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: 'bad.docx',
    });
    expect(result.status).toBe('failed');
    expect(result.method).toBeUndefined();
  });
});

describe('extractText — digital PDF', () => {
  it('returns method=text, status=ok for a PDF with good text density', async () => {
    pdfParse.mockResolvedValue({ text: 'A'.repeat(500), numpages: 2 });
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'syllabus.pdf',
    });
    expect(result.method).toBe('text');
    expect(result.status).toBe('ok');
    expect(result.pageCount).toBe(2);
  });

  it('routes to vision when text density is below threshold (< 100 chars/page)', async () => {
    // 1 page, only 50 chars — well below the 100 chars/page heuristic.
    pdfParse.mockResolvedValue({ text: 'B'.repeat(50), numpages: 1 });
    fakeTranscribe.mockResolvedValue({ text: 'Transcribed text from vision.', costUsdCents: 20, truncated: false });
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'scan.pdf',
    });
    expect(result.method).toBe('vision');
    expect(result.status).toBe('ok');
    expect(result.text).toBe('Transcribed text from vision.');
    expect(fakeTranscribe).toHaveBeenCalledOnce();
  });

  it('returns status=low_text when vision also returns very little text', async () => {
    pdfParse.mockResolvedValue({ text: '', numpages: 3 });
    fakeTranscribe.mockResolvedValue({ text: 'hi', costUsdCents: 10, truncated: false });
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'unreadable.pdf',
    });
    expect(result.method).toBe('vision');
    expect(result.status).toBe('low_text');
  });

  it('returns status=failed when pdf-parse throws', async () => {
    pdfParse.mockRejectedValue(new Error('bad pdf'));
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'corrupt.pdf',
    });
    expect(result.status).toBe('failed');
    expect(result.method).toBeUndefined();
  });

  it('caps vision at 40 pages and sets status=ok with truncated text', async () => {
    pdfParse.mockResolvedValue({ text: '', numpages: 60 });
    fakeTranscribe.mockResolvedValue({ text: 'Partial transcription.', costUsdCents: 30, truncated: true });
    const result = await extractText({
      fileBytes: Buffer.from('fake'),
      mimeType: 'application/pdf',
      fileName: 'huge.pdf',
    });
    expect(result.method).toBe('vision');
    // Truncated file still yields text — status is ok (not failed).
    expect(result.status).toBe('ok');
    expect(fakeTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({ maxPages: 40 }),
    );
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm test tests/courses/extract-text.test.ts`

Expected: FAIL with "Cannot find module '@/lib/courses/extract-text'".

- [ ] **Step 3: Implement the extraction dispatcher**

Create `lib/courses/extract-text.ts`:

```typescript
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { getProvider } from '@/lib/ai/provider';

export type ExtractedMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ExtractTextArgs {
  fileBytes: Buffer;
  mimeType: ExtractedMimeType;
  fileName: string;
}

export interface ExtractTextResult {
  method?: 'text' | 'vision';
  status: 'ok' | 'low_text' | 'failed';
  text?: string;
  pageCount?: number;
  /** Cost in 1/100 of a cent, only present when vision transcription was used. */
  visionCostUsdCents?: number;
}

/**
 * Heuristic: if the PDF yields fewer than this many characters per page on
 * average, it is treated as image-based and sent to vision transcription.
 */
const MIN_CHARS_PER_PAGE = 100;

/** Minimum chars for text to be considered meaningful (not low_text). */
const MIN_MEANINGFUL_CHARS = 30;

/** Max pages to send to vision to bound cost + latency. */
const VISION_PAGE_CAP = 40;

export async function extractText(args: ExtractTextArgs): Promise<ExtractTextResult> {
  const { fileBytes, mimeType, fileName: _fileName } = args;

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocx(fileBytes);
  }
  if (mimeType === 'application/pdf') {
    return extractPdf(fileBytes, mimeType);
  }
  // Should never reach here given MIME allowlist on the route.
  return { status: 'failed' };
}

async function extractDocx(fileBytes: Buffer): Promise<ExtractTextResult> {
  try {
    const result = await mammoth.extractRawText({ buffer: fileBytes });
    const text = result.value.trim();
    if (text.length < MIN_MEANINGFUL_CHARS) {
      return { method: 'text', status: 'low_text', text };
    }
    return { method: 'text', status: 'ok', text };
  } catch {
    return { status: 'failed' };
  }
}

async function extractPdf(
  fileBytes: Buffer,
  mimeType: 'application/pdf',
): Promise<ExtractTextResult> {
  let pageCount: number | undefined;
  let pdfText = '';

  try {
    const parsed = await pdfParse(fileBytes);
    pdfText = (parsed.text ?? '').trim();
    pageCount = parsed.numpages;
  } catch {
    return { status: 'failed' };
  }

  const charsPerPage = pageCount && pageCount > 0 ? pdfText.length / pageCount : pdfText.length;
  const isImageBased = charsPerPage < MIN_CHARS_PER_PAGE;

  if (!isImageBased) {
    if (pdfText.length < MIN_MEANINGFUL_CHARS) {
      return { method: 'text', status: 'low_text', text: pdfText, pageCount };
    }
    return { method: 'text', status: 'ok', text: pdfText, pageCount };
  }

  // Image-based PDF — use vision transcription.
  try {
    const provider = getProvider();
    const transcribed = await provider.transcribeDocument({
      fileBytes,
      mimeType,
      maxPages: VISION_PAGE_CAP,
    });
    const text = transcribed.text.trim();
    const status = text.length < MIN_MEANINGFUL_CHARS ? 'low_text' : 'ok';
    return {
      method: 'vision',
      status,
      text,
      pageCount,
      visionCostUsdCents: transcribed.costUsdCents,
    };
  } catch {
    return { method: 'vision', status: 'failed', pageCount };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test tests/courses/extract-text.test.ts`

Expected: 8 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add lib/courses/extract-text.ts tests/courses/extract-text.test.ts
git commit -m "feat(courses): text-extraction dispatcher (DOCX/PDF/vision)"
```

---

## Task 6: Upload + delete API routes

**Files:**
- Create: `app/api/courses/[code]/materials/route.ts`
- Create: `app/api/courses/[code]/materials/[id]/route.ts`
- Create: `tests/api/course-materials.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/api/course-materials.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  isValidSlug,
  getCourseByCode,
  put,
  del,
  insertMaterial,
  updateExtractionResult,
  getMaterialById,
  deleteMaterial,
  listMaterialsByCourse,
  extractText,
  checkIpRateLimit,
  checkDailyCap,
  recordSpend,
  hashIp,
} = vi.hoisted(() => ({
  isValidSlug: vi.fn(),
  getCourseByCode: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  insertMaterial: vi.fn(),
  updateExtractionResult: vi.fn(),
  getMaterialById: vi.fn(),
  deleteMaterial: vi.fn(),
  listMaterialsByCourse: vi.fn(),
  extractText: vi.fn(),
  checkIpRateLimit: vi.fn(),
  checkDailyCap: vi.fn(),
  recordSpend: vi.fn(),
  hashIp: vi.fn(),
}));

vi.mock('@/lib/slug', () => ({ isValidSlug }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode }));
vi.mock('@vercel/blob', () => ({ put, del }));
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial,
  updateExtractionResult,
  getMaterialById,
  deleteMaterial,
  listMaterialsByCourse,
}));
vi.mock('@/lib/courses/extract-text', () => ({ extractText }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap, recordSpend }));
vi.mock('@/lib/ip-hash', () => ({ hashIp }));

import { POST } from '@/app/api/courses/[code]/materials/route';
import { DELETE } from '@/app/api/courses/[code]/materials/[id]/route';

const SLUG = 'valid-slug-12345';
const CODE = 'GC 3460';

function makeUploadReq(overrides: {
  slug?: string;
  code?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  body?: Uint8Array;
} = {}): [Request, { params: Promise<{ code: string }> }] {
  const {
    slug = SLUG,
    fileName = 'rubric.pdf',
    mimeType = 'application/pdf',
    sizeBytes = 100_000,
    body = new Uint8Array(100),
  } = overrides;
  const file = new File([body], fileName, { type: mimeType });
  const form = new FormData();
  form.set('slug', slug);
  form.set('file', file);
  const req = new Request('http://test/api/courses/GC%203460/materials', {
    method: 'POST',
    body: form,
  });
  // Override Content-Length header for size checks by adding it to the file's size
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return [req, { params: Promise.resolve({ code: overrides.code ?? CODE }) }];
}

function makeDeleteReq(slug: string, materialId: string): [Request, { params: Promise<{ code: string; id: string }> }] {
  const req = new Request(`http://test/api/courses/GC%203460/materials/${materialId}?slug=${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  });
  return [req, { params: Promise.resolve({ code: CODE, id: materialId }) }];
}

beforeEach(() => {
  vi.clearAllMocks();
  isValidSlug.mockImplementation((s: string) => s === SLUG);
  getCourseByCode.mockResolvedValue({ code: CODE, title: 'Digital Publishing' });
  put.mockResolvedValue({ url: 'https://blob.vercel-storage.com/rubric.pdf' });
  insertMaterial.mockResolvedValue({ id: 'mat-1', courseCode: CODE, fileName: 'rubric.pdf', blobUrl: 'https://blob.vercel-storage.com/rubric.pdf', extractionStatus: 'pending' });
  updateExtractionResult.mockResolvedValue(undefined);
  checkIpRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
  checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0 });
  recordSpend.mockResolvedValue(undefined);
  hashIp.mockReturnValue('abc123hash');
  extractText.mockResolvedValue({ method: 'text', status: 'ok', text: 'Rubric content here.' });
});

describe('POST /api/courses/[code]/materials', () => {
  it('returns 401 on invalid slug', async () => {
    const [req, ctx] = makeUploadReq({ slug: 'wrong' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 404 when course not found', async () => {
    getCourseByCode.mockResolvedValue(null);
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 429 when IP rate-limited', async () => {
    checkIpRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(429);
  });

  it('returns 400 on unsupported MIME type', async () => {
    const [req, ctx] = makeUploadReq({ mimeType: 'image/jpeg' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/mime/i);
  });

  it('returns 400 when no file is attached', async () => {
    // Build a form without a file field.
    const form = new FormData();
    form.set('slug', SLUG);
    const req = new Request('http://test/api/courses/GC%203460/materials', { method: 'POST', body: form });
    const res = await POST(req, { params: Promise.resolve({ code: CODE }) });
    expect(res.status).toBe(400);
  });

  it('uploads to Blob, inserts row, runs extraction, returns 200 with status', async () => {
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('mat-1');
    expect(json.extractionStatus).toBe('ok');
    expect(put).toHaveBeenCalledOnce();
    expect(insertMaterial).toHaveBeenCalledOnce();
    expect(extractText).toHaveBeenCalledOnce();
    expect(updateExtractionResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mat-1', extractionStatus: 'ok' }),
    );
  });

  it('records vision spend when extraction uses vision', async () => {
    extractText.mockResolvedValue({ method: 'vision', status: 'ok', text: 'Transcribed.', visionCostUsdCents: 30 });
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(recordSpend).toHaveBeenCalledWith(30);
  });

  it('returns extractionStatus=failed without throwing when extraction fails', async () => {
    extractText.mockResolvedValue({ status: 'failed' });
    const [req, ctx] = makeUploadReq();
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.extractionStatus).toBe('failed');
  });
});

describe('DELETE /api/courses/[code]/materials/[id]', () => {
  beforeEach(() => {
    getMaterialById.mockResolvedValue({
      id: 'mat-1',
      courseCode: CODE,
      blobUrl: 'https://blob.vercel-storage.com/rubric.pdf',
    });
    del.mockResolvedValue(undefined);
    deleteMaterial.mockResolvedValue(undefined);
  });

  it('returns 401 on invalid slug', async () => {
    const [req, ctx] = makeDeleteReq('wrong', 'mat-1');
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 404 when material not found', async () => {
    getMaterialById.mockResolvedValue(null);
    const [req, ctx] = makeDeleteReq(SLUG, 'mat-1');
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 403 when material belongs to a different course', async () => {
    getMaterialById.mockResolvedValue({ id: 'mat-1', courseCode: 'GC 9999', blobUrl: 'https://blob.vercel-storage.com/x.pdf' });
    const [req, ctx] = makeDeleteReq(SLUG, 'mat-1');
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(403);
  });

  it('deletes Blob object + row and returns 200', async () => {
    const [req, ctx] = makeDeleteReq(SLUG, 'mat-1');
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith('https://blob.vercel-storage.com/rubric.pdf');
    expect(deleteMaterial).toHaveBeenCalledWith('mat-1');
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm test tests/api/course-materials.test.ts`

Expected: FAIL with "Cannot find module '@/app/api/courses/[code]/materials/route'".

- [ ] **Step 3: Implement the upload route**

Create `app/api/courses/[code]/materials/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { hashIp } from '@/lib/ip-hash';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { insertMaterial, updateExtractionResult } from '@/lib/db/course-materials-queries';
import { extractText } from '@/lib/courses/extract-text';
import type { ExtractedMimeType } from '@/lib/courses/extract-text';

export const maxDuration = 120;

const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { code } = await params;

  // Parse multipart form data.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 });
  }

  const slug = typeof form.get('slug') === 'string' ? (form.get('slug') as string) : '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  // Verify the course exists.
  const course = await getCourseByCode(code);
  if (!course) {
    return NextResponse.json({ error: `course not found: ${code}` }, { status: 404 });
  }

  // IP rate limit.
  const ipHash = hashIp(req);
  const rl = await checkIpRateLimit(ipHash);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate limit exceeded — try again in an hour' }, { status: 429 });
  }

  // Validate the uploaded file.
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported MIME type: ${file.type}. Allowed: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document` },
      { status: 400 },
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `file too large: ${file.size} bytes (max ${MAX_SIZE_BYTES})` },
      { status: 400 },
    );
  }

  // Store in Vercel Blob.
  const blobKey = `course-materials/${code}/${Date.now()}-${file.name}`;
  const blob = await put(blobKey, file, { access: 'public' });

  // Insert the row with extractionStatus='pending'.
  const material = await insertMaterial({
    courseCode: code,
    fileName: file.name,
    blobUrl: blob.url,
    mimeType: file.type,
    sizeBytes: file.size,
    ipHash,
  });

  // Run extraction synchronously.
  const fileBytes = Buffer.from(await file.arrayBuffer());
  const extracted = await extractText({
    fileBytes,
    mimeType: file.type as ExtractedMimeType,
    fileName: file.name,
  });

  // Gate vision transcription cost.
  if (extracted.visionCostUsdCents !== undefined && extracted.visionCostUsdCents > 0) {
    const cap = await checkDailyCap();
    if (cap.ok) {
      await recordSpend(extracted.visionCostUsdCents);
    }
  }

  // Persist extraction result.
  await updateExtractionResult({
    id: material.id,
    extractionStatus: extracted.status,
    extractionMethod: extracted.method,
    extractedText: extracted.text,
    pageCount: extracted.pageCount,
  });

  return NextResponse.json({
    id: material.id,
    fileName: material.fileName,
    blobUrl: material.blobUrl,
    extractionStatus: extracted.status,
    extractionMethod: extracted.method,
    pageCount: extracted.pageCount,
  });
}
```

- [ ] **Step 4: Implement the delete route**

Create `app/api/courses/[code]/materials/[id]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { isValidSlug } from '@/lib/slug';
import { getMaterialById, deleteMaterial } from '@/lib/db/course-materials-queries';

interface RouteContext {
  params: Promise<{ code: string; id: string }>;
}

export async function DELETE(req: Request, { params }: RouteContext): Promise<Response> {
  const { code, id } = await params;
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const material = await getMaterialById(id);
  if (!material) {
    return NextResponse.json({ error: 'material not found' }, { status: 404 });
  }
  if (material.courseCode !== code) {
    return NextResponse.json({ error: 'material does not belong to this course' }, { status: 403 });
  }

  // Remove from Vercel Blob first, then the DB row.
  await del(material.blobUrl);
  await deleteMaterial(id);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test tests/api/course-materials.test.ts`

Expected: all tests pass. If any test fails because `FormData.get('file')` returns a `File` in the test environment — verify that the test's `makeUploadReq` mock creates a valid `File` object. jsdom supports `File` and `FormData`, so this should work without additional setup.

- [ ] **Step 6: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add app/api/courses tests/api/course-materials.test.ts
git commit -m "feat(api): POST /api/courses/[code]/materials upload + DELETE route"
```

---

## Task 7: Per-course page — Materials zone

**Files:**
- Create: `app/preview/[slug]/courses/[code]/page.tsx`
- Create: `app/preview/[slug]/courses/[code]/MaterialsZone.tsx`
- Create: `app/preview/[slug]/courses/[code]/MaterialsList.tsx`
- Create: `app/preview/[slug]/courses/[code]/UploadZone.tsx`
- Create: `tests/components/UploadZone.test.tsx`
- Create: `tests/components/MaterialsZone.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `tests/components/UploadZone.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UploadZone } from '@/app/preview/[slug]/courses/[code]/UploadZone';

describe('UploadZone', () => {
  it('renders the drop area with instructional text', () => {
    render(<UploadZone courseCode="GC 3460" slug="test-slug" onUploaded={vi.fn()} />);
    expect(screen.getByText(/drag.*drop|upload/i)).toBeTruthy();
  });

  it('shows an error when an unsupported file type is dropped', () => {
    render(<UploadZone courseCode="GC 3460" slug="test-slug" onUploaded={vi.fn()} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    // Simulate selecting an unsupported file type.
    const file = new File(['content'], 'image.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    expect(screen.getByText(/unsupported|pdf.*docx|only pdf/i)).toBeTruthy();
  });

  it('calls onUploaded with the server response after a successful fetch', async () => {
    const onUploaded = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'mat-1', fileName: 'rubric.pdf', extractionStatus: 'ok' }),
    } as Response);

    render(<UploadZone courseCode="GC 3460" slug="test-slug" onUploaded={onUploaded} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['%PDF content'], 'rubric.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    // Wait for the async upload.
    await vi.waitFor(() => expect(onUploaded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mat-1', extractionStatus: 'ok' }),
    ));
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm test tests/components/UploadZone.test.tsx`

Expected: FAIL with "Cannot find module '@/app/preview/[slug]/courses/[code]/UploadZone'".

- [ ] **Step 3: Implement `UploadZone`**

Create `app/preview/[slug]/courses/[code]/UploadZone.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';

export interface UploadedMaterial {
  id: string;
  fileName: string;
  blobUrl: string;
  extractionStatus: 'pending' | 'ok' | 'low_text' | 'failed';
  extractionMethod?: string;
  pageCount?: number;
}

interface Props {
  courseCode: string;
  slug: string;
  onUploaded: (material: UploadedMaterial) => void;
}

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

interface UploadState {
  fileName: string;
  progress: 'uploading' | 'done' | 'error';
  error?: string;
}

export function UploadZone({ courseCode, slug, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<UploadState | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFiles(files: FileList | null) {
    setTypeError(null);
    if (!files || files.length === 0) return;
    const file = files[0]!;

    if (!ALLOWED_TYPES.has(file.type)) {
      setTypeError('Unsupported file type. Only PDF and DOCX files are accepted.');
      return;
    }

    setUploading({ fileName: file.name, progress: 'uploading' });
    const form = new FormData();
    form.set('slug', slug);
    form.set('file', file);

    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseCode)}/materials`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setUploading({ fileName: file.name, progress: 'error', error: (json as { error?: string }).error ?? `Upload failed (${res.status})` });
        return;
      }
      const material = (await res.json()) as UploadedMaterial;
      setUploading({ fileName: file.name, progress: 'done' });
      onUploaded(material);
    } catch (e) {
      setUploading({ fileName: file.name, progress: 'error', error: e instanceof Error ? e.message : 'Upload failed' });
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
        dragging ? 'border-primary bg-accent' : 'border-muted-foreground/30 bg-muted/20'
      }`}
    >
      <p className="text-sm text-muted-foreground">
        Drag &amp; drop or{' '}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={() => inputRef.current?.click()}
        >
          browse
        </button>{' '}
        to upload assignment materials (PDF or DOCX, max 15 MB per file)
      </p>

      <input
        ref={inputRef}
        data-testid="file-input"
        type="file"
        accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {typeError && (
        <p className="mt-3 text-sm text-destructive">{typeError}</p>
      )}

      {uploading && (
        <div className="mt-4 w-full max-w-sm text-sm">
          <p className="truncate text-muted-foreground">
            {uploading.fileName} —{' '}
            {uploading.progress === 'uploading' && (
              <span className="text-primary animate-pulse">Uploading &amp; extracting…</span>
            )}
            {uploading.progress === 'done' && (
              <span className="text-green-700">Done</span>
            )}
            {uploading.progress === 'error' && (
              <span className="text-destructive">{uploading.error}</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the component test**

Run: `pnpm test tests/components/UploadZone.test.tsx`

Expected: 3 passing tests.

- [ ] **Step 5: Implement `MaterialsList` (pure presentational)**

Create `app/preview/[slug]/courses/[code]/MaterialsList.tsx`:

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import type { UploadedMaterial } from './UploadZone';

interface Props {
  courseCode: string;
  slug: string;
  materials: UploadedMaterial[];
  onDelete: (id: string) => void;
  deleting: string | null;
}

function StatusBadge({ status }: { status: UploadedMaterial['extractionStatus'] }) {
  if (status === 'ok') {
    return <Badge variant="secondary" className="text-green-800 bg-green-100 border-green-300">Extracted</Badge>;
  }
  if (status === 'low_text') {
    return <Badge variant="secondary" className="text-amber-800 bg-amber-100 border-amber-300">Low text — consider replacing</Badge>;
  }
  if (status === 'failed') {
    return <Badge variant="secondary" className="text-red-800 bg-red-100 border-red-300">Extraction failed</Badge>;
  }
  return <Badge variant="secondary" className="text-slate-600">Pending</Badge>;
}

export function MaterialsList({ materials, onDelete, deleting }: Props) {
  if (materials.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No files uploaded yet. Drag and drop a PDF or DOCX above.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-lg border">
      {materials.map((m) => (
        <li key={m.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{m.fileName}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <StatusBadge status={m.extractionStatus} />
              {m.extractionMethod && (
                <span className="text-xs text-muted-foreground">via {m.extractionMethod}</span>
              )}
              {m.pageCount !== undefined && (
                <span className="text-xs text-muted-foreground">{m.pageCount}p</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDelete(m.id)}
            disabled={deleting === m.id}
            className="shrink-0 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
            aria-label={`Delete ${m.fileName}`}
          >
            {deleting === m.id ? 'Deleting…' : 'Delete'}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Implement `MaterialsZone` (client, owns state)**

Create `app/preview/[slug]/courses/[code]/MaterialsZone.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { UploadZone, type UploadedMaterial } from './UploadZone';
import { MaterialsList } from './MaterialsList';

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

- [ ] **Step 7: Write the `MaterialsZone` component test**

Create `tests/components/MaterialsZone.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MaterialsZone } from '@/app/preview/[slug]/courses/[code]/MaterialsZone';

const initialMat = {
  id: 'mat-1',
  fileName: 'rubric.pdf',
  blobUrl: 'https://blob.vercel-storage.com/rubric.pdf',
  extractionStatus: 'ok' as const,
};

describe('MaterialsZone', () => {
  it('renders existing materials', () => {
    render(<MaterialsZone courseCode="GC 3460" slug="test-slug" initialMaterials={[initialMat]} />);
    expect(screen.getByText('rubric.pdf')).toBeTruthy();
  });

  it('adds a new material after a successful upload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'mat-2', fileName: 'worksheet.docx', blobUrl: 'https://blob.vercel-storage.com/worksheet.docx', extractionStatus: 'ok' }),
    } as Response);

    render(<MaterialsZone courseCode="GC 3460" slug="test-slug" initialMaterials={[initialMat]} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['%PDF'], 'worksheet.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    Object.defineProperty(input, 'files', { value: [file] });

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input);

    await waitFor(() => expect(screen.getByText('worksheet.docx')).toBeTruthy());
  });
});
```

- [ ] **Step 8: Run the MaterialsZone test**

Run: `pnpm test tests/components/MaterialsZone.test.tsx`

Expected: 2 passing tests.

- [ ] **Step 9: Implement the server page**

Create `app/preview/[slug]/courses/[code]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { MaterialsZone } from './MaterialsZone';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string; code: string }>;
}

export default async function CourseDetailPage({ params }: Props) {
  const { slug, code } = await params;
  if (!isValidSlug(slug)) notFound();

  const course = await getCourseByCode(code);
  if (!course) notFound();

  const rawMaterials = await listMaterialsByCourse(code);
  const materials = rawMaterials.map((m) => ({
    id: m.id,
    fileName: m.fileName,
    blobUrl: m.blobUrl,
    extractionStatus: m.extractionStatus as 'pending' | 'ok' | 'low_text' | 'failed',
    extractionMethod: m.extractionMethod ?? undefined,
    pageCount: m.pageCount ?? undefined,
  }));

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-12 space-y-8">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href={`/preview/${slug}`} className="underline underline-offset-2 hover:text-foreground">
          &larr; Back to prototype
        </Link>
      </div>

      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{course.code}</p>
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <p className="text-sm text-muted-foreground">Level {course.level} · {course.track}</p>
      </header>

      {/* Zone 1 — Materials (Plan 1). Zones 2 + 3 added by Plans 2 and 3. */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Assignment Materials</h2>
          <span className="text-xs text-muted-foreground">{materials.length} file{materials.length !== 1 ? 's' : ''}</span>
        </div>

        <MaterialsZone
          courseCode={code}
          slug={slug}
          initialMaterials={materials}
        />
      </section>
    </main>
  );
}
```

- [ ] **Step 10: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 11: Run full test suite**

Run: `pnpm test`

Expected: all tests pass (the schema test from T2, the extraction tests from T5, the route tests from T6, the UploadZone test and MaterialsZone test from this task).

- [ ] **Step 12: Commit**

```bash
git add "app/preview/[slug]/courses" tests/components/UploadZone.test.tsx tests/components/MaterialsZone.test.tsx
git commit -m "feat(ui): per-course Materials zone — MaterialsZone client component + pure MaterialsList + UploadZone"
```

---

## Self-Review

### Spec coverage check

| Spec requirement (Plan 1 scope) | Task |
|---|---|
| Three tables: `course_materials`, `course_profiles`, `course_profile_runs` | T2 |
| One migration `drizzle/0009_*.sql` | T2 |
| Schema smoke test covering all three tables | T2 |
| New deps: `@vercel/blob`, `mammoth`, `pdf-parse` | T1 |
| `BLOB_READ_WRITE_TOKEN` env var in `.env.example` | T1 |
| `course_materials` queries: insert, list, update, get, delete | T3 |
| `extractText` dispatcher: DOCX via mammoth, PDF via pdf-parse | T5 |
| `extractionStatus` values: `ok`, `low_text`, `failed` | T5 |
| `extractionMethod` values: `text`, `vision` | T5 |
| Low-text PDF heuristic (< 100 chars/page) → vision | T5 |
| Vision page cap (40 pages) | T5 |
| `transcribeDocument({ fileBytes, mimeType }) → { text, costUsdCents }` on `AIProvider` | T4 |
| `transcribeDocument` implemented on `OpenAIProvider` | T4 |
| `transcribeDocument` implemented on `FakeProvider` | T4 |
| `POST /api/courses/[code]/materials`: slug gate | T6 |
| `POST /api/courses/[code]/materials`: IP rate limit | T6 |
| `POST /api/courses/[code]/materials`: size cap (15 MB) | T6 |
| `POST /api/courses/[code]/materials`: MIME allowlist | T6 |
| `POST /api/courses/[code]/materials`: store to Vercel Blob | T6 |
| `POST /api/courses/[code]/materials`: insert `course_materials` row | T6 |
| `POST /api/courses/[code]/materials`: run extraction synchronously | T6 |
| `POST /api/courses/[code]/materials`: return per-file status | T6 |
| Vision cost gated by `checkDailyCap` + recorded via `recordSpend` | T6 |
| `DELETE /api/courses/[code]/materials/[id]`: remove Blob + row | T6 |
| Per-course page with Materials zone (drag-drop + file list + delete + status) | T7 |
| Per-file upload progress shown in UI | T7 (`UploadZone` uploading state) |

All Plan-1-scoped spec requirements are covered. The `analysisFinding` JSON shape and `catalogDivergence` / `competencies` shapes are defined in the schema (T2) exactly as the spec specifies, ready for Plans 2 and 3.

### Placeholder scan

No TBD, TODO, "similar to Task N", or incomplete code blocks found. Every step includes the full file content or the exact diff to apply.

### Type consistency check

- `ExtractionStatus` and `ExtractionMethod` are defined in `course-materials-queries.ts` (T3) and used in `UpdateExtractionInput` — consistent.
- `ExtractedMimeType` is defined in `extract-text.ts` (T5) and imported by the upload route (T6) — consistent.
- `UploadedMaterial` is defined in `UploadZone.tsx` (T7) and re-used by `MaterialsList.tsx` and `MaterialsZone.tsx` (T7) — consistent.
- `TranscribeDocumentArgs` and `TranscribeDocumentResult` are defined in `provider.ts` (T4) and consumed by `openai.ts` and `fake-provider.ts` (T4) — consistent.
- `FakeProvider` constructor gains an optional second param `transcribeResponses: string[] = []` — all existing `new FakeProvider([...])` calls continue to work without change.
- `transcribeDocument` in `OpenAIProvider` uses the correct OpenAI **`file` content part** (`{ type: 'file', file: { filename, file_data } }`) for PDF input — the chat completions `image_url` part is only valid for raster images (PNG/JPEG/WebP/GIF) and rejects PDF data URLs.
- `MaterialsZone` owns `materials` state in `useState` and passes it down to `MaterialsList` as a plain prop; `UploadZone`'s `onUploaded` calls `setMaterials` via `handleUploaded` inside `MaterialsZone` — no module-level mutable functions.
- `MaterialsList` is now a pure presentational component: it receives `materials`, `onDelete`, and `deleting` as props and has no internal state — testable in isolation without mocking React state.
