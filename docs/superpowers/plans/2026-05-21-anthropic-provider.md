# AnthropicProvider + Native PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `AnthropicProvider` that uses the Anthropic SDK so PDFs are sent as native document blocks (preserving tables, figures, and image content) instead of being flattened to text by `pdf-parse`; surface a warning in the Materials UI when image content may not have been captured.

**Architecture:** A new `AnthropicProvider` class implements the existing `AIProvider` interface using `tool_use` for structured JSON output and native document blocks for PDF/DOCX analysis. The `complete()` interface gets an optional `documents` field; the `analyzeMaterial` helper passes raw PDF bytes through that field when available. The `analyze-materials` route fetches blob bytes on the fly when the Anthropic provider is active. A soft image-content warning chip appears in `MaterialsList` for text-extracted PDFs, where images were silently dropped by `pdf-parse`.

**Tech Stack:** `@anthropic-ai/sdk` (new dependency), Vercel Blob (existing, for re-fetching bytes), Vitest/vi.mock (tests), React (badge UI component already exists).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/ai/anthropic.ts` | **Create** | `AnthropicProvider` class: `complete()` via tool_use, `transcribeDocument()` via native doc blocks |
| `lib/ai/provider.ts` | **Modify** | Add `documents?` field to `complete()` args; add `anthropic` branch in `getProvider()` |
| `lib/ai/openai.ts` | **Modify** | Accept (and silently ignore) `documents?` field in `complete()` |
| `lib/ai/fake-provider.ts` | **Modify** | Accept (and silently ignore) `documents?` field in `complete()` |
| `lib/ai/course-profile/analyze-material.ts` | **Modify** | Accept `documentBytes?`; build document blocks when present; adjust user message |
| `lib/ai/prompts/analyze-material.md` | **Modify** | Add instruction to flag uncaptured images/charts/figures in `notes` |
| `app/api/courses/[code]/analyze-materials/route.ts` | **Modify** | Fetch blob bytes for PDF materials when provider is Anthropic; pass to `analyzeMaterial` |
| `app/preview/[slug]/courses/[code]/MaterialsList.tsx` | **Modify** | Show amber warning chip for text-extracted PDFs (images silently dropped) |
| `tests/lib/ai/anthropic.test.ts` | **Create** | Unit tests for `AnthropicProvider` |
| `tests/ai/course-profile/analyze-material.test.ts` | **Modify** | Add tests for native PDF path (documentBytes present) |
| `tests/api/analyze-materials.test.ts` | **Modify** | Add test: Anthropic provider → fetches blob bytes → passes documentBytes |

---

## Task 1: Install Anthropic SDK + AnthropicProvider

**Files:**
- Create: `lib/ai/anthropic.ts`
- Modify: `lib/ai/provider.ts`
- Create: `tests/lib/ai/anthropic.test.ts`

- [ ] **Step 1: Install `@anthropic-ai/sdk`**

```bash
cd /Users/admin/projects/curriculum_developer
npm install @anthropic-ai/sdk
```

Expected: `package.json` now includes `"@anthropic-ai/sdk": "^..."`

- [ ] **Step 2: Write failing tests for `AnthropicProvider`**

Create `tests/lib/ai/anthropic.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from '@/lib/ai/anthropic';
import { kudOutcomesSchema, kudOutcomesJsonSchema } from '@/lib/ai/schemas';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

const validKud = { description: 'A course', know: ['a'], understand: ['b'], do: ['c'] };

const makeToolUseResponse = (input: unknown, inputTokens = 100, outputTokens = 50) => ({
  content: [{ type: 'tool_use', id: 'tu_1', name: 'kud', input }],
  usage: {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
});

beforeEach(() => {
  mockCreate.mockReset();
});

describe('AnthropicProvider', () => {
  it('reports name and model', () => {
    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    expect(p.name).toBe('anthropic');
    expect(p.model).toBe('claude-sonnet-4-6');
  });

  it('returns parsed data and telemetry from a tool_use response', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse(validKud));

    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    const result = await p.complete({
      systemPrompt: 'sys',
      userMessage: 'analyze this',
      schemaName: 'kud',
      jsonSchema: kudOutcomesJsonSchema,
      validate: (raw) => kudOutcomesSchema.parse(raw),
    });

    expect(result.data.description).toBe('A course');
    expect(result.completionTokens).toBe(50);
    expect(result.costUsdCents).toBeGreaterThan(0);
    expect(result.cachedTokens).toBe(0);
  });

  it('applies 10% rate to cache_read tokens', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 'tu_2', name: 'kud', input: validKud }],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 0,
      },
    });

    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    const result = await p.complete({
      systemPrompt: 'sys',
      userMessage: 'usr',
      schemaName: 'kud',
      jsonSchema: kudOutcomesJsonSchema,
      validate: (raw) => kudOutcomesSchema.parse(raw),
    });

    expect(result.cachedTokens).toBe(80);
    expect(result.uncachedPromptTokens).toBe(20); // 100 - 80
    expect(result.completionTokens).toBe(20);
    // cached cost should be much lower than uncached cost
    expect(result.costUsdCents).toBeGreaterThan(0);
  });

  it('throws when validation fails', async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse({ description: '', know: [], understand: [], do: [] })
    );
    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    await expect(
      p.complete({
        systemPrompt: 'sys',
        userMessage: 'usr',
        schemaName: 'kud',
        jsonSchema: kudOutcomesJsonSchema,
        validate: (raw) => kudOutcomesSchema.parse(raw),
      })
    ).rejects.toThrow();
  });

  it('throws when response contains no tool_use block', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'sorry, cannot help' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    await expect(
      p.complete({
        systemPrompt: 'sys',
        userMessage: 'usr',
        schemaName: 'kud',
        jsonSchema: kudOutcomesJsonSchema,
        validate: (raw) => kudOutcomesSchema.parse(raw),
      })
    ).rejects.toThrow('No tool_use block');
  });

  it('transcribeDocument sends document block and returns text', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Transcribed content here.' }],
      usage: { input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });

    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    const result = await p.transcribeDocument({
      fileBytes: Buffer.from('%PDF-fake'),
      mimeType: 'application/pdf',
    });

    expect(result.text).toBe('Transcribed content here.');
    expect(result.truncated).toBe(false);
    expect(result.costUsdCents).toBeGreaterThan(0);

    const callArgs = mockCreate.mock.calls[0]![0];
    const userContent = callArgs.messages[0].content;
    expect(Array.isArray(userContent)).toBe(true);
    expect(userContent[0].type).toBe('document');
    expect(userContent[0].source.media_type).toBe('application/pdf');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run tests/lib/ai/anthropic.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '@/lib/ai/anthropic'`

- [ ] **Step 4: Implement `lib/ai/anthropic.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { AIProvider, CompletionTelemetry, TranscribeDocumentArgs, TranscribeDocumentResult } from './provider';

// USD per 1M tokens. Update from https://docs.anthropic.com/en/docs/about-claude/models
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7':                 { input: 15.0,  output: 75.0  },
  'claude-sonnet-4-6':               { input:  3.0,  output: 15.0  },
  'claude-haiku-4-5-20251001':       { input:  0.80, output:  4.0  },
};
const FALLBACK_PRICING = { input: 3.0, output: 15.0 };

function toCents(usd: number): number {
  return Math.ceil(usd * 100 * 100);
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic;

  constructor(model: string, apiKey: string) {
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  async complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    documents?: Array<{ bytes: Buffer; mimeType: string }>;
  }): Promise<{ data: T } & CompletionTelemetry> {
    const started = Date.now();

    const userContent: MessageParam['content'] = args.documents?.length
      ? [
          ...args.documents.map((doc) => ({
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: doc.mimeType as 'application/pdf',
              data: doc.bytes.toString('base64'),
            },
          })),
          { type: 'text' as const, text: args.userMessage },
        ]
      : args.userMessage;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: [{ type: 'text', text: args.systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: args.schemaName,
          description: 'Extract structured data according to the schema.',
          input_schema: args.jsonSchema as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: args.schemaName },
      messages: [{ role: 'user', content: userContent }],
    });

    const durationMs = Date.now() - started;

    const toolBlock = response.content.find((b): b is ToolUseBlock => b.type === 'tool_use');
    if (!toolBlock) throw new Error('No tool_use block in Anthropic response');

    const data = args.validate(toolBlock.input);

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const cacheReadTokens = (response.usage as { cache_read_input_tokens?: number } | undefined)
      ?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = (response.usage as { cache_creation_input_tokens?: number } | undefined)
      ?.cache_creation_input_tokens ?? 0;
    const uncachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);

    const pricing = MODEL_PRICING[this.model] ?? FALLBACK_PRICING;
    const costUsdCents =
      toCents((uncachedInputTokens / 1_000_000) * pricing.input) +
      toCents((cacheWriteTokens / 1_000_000) * pricing.input * 1.25) +
      toCents((cacheReadTokens / 1_000_000) * pricing.input * 0.1) +
      toCents((outputTokens / 1_000_000) * pricing.output);

    return {
      data,
      costUsdCents,
      durationMs,
      cachedTokens: cacheReadTokens,
      uncachedPromptTokens: uncachedInputTokens + cacheWriteTokens,
      completionTokens: outputTokens,
    };
  }

  async transcribeDocument(args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult> {
    const started = Date.now();
    const { fileBytes, mimeType } = args;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: mimeType as 'application/pdf',
                data: fileBytes.toString('base64'),
              },
            },
            {
              type: 'text',
              text: 'Please transcribe every piece of text visible in this document. Return plain text only, preserving the reading order. Do not add commentary. If pages are cut off, transcribe what is visible.',
            },
          ],
        },
      ],
    });

    const durationMs = Date.now() - started;
    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const pricing = MODEL_PRICING[this.model] ?? FALLBACK_PRICING;
    const costUsdCents =
      toCents((inputTokens / 1_000_000) * pricing.input) +
      toCents((outputTokens / 1_000_000) * pricing.output);

    void durationMs; // not in TranscribeDocumentResult
    return { text, costUsdCents, truncated: false };
  }
}
```

- [ ] **Step 5: Update `lib/ai/provider.ts` to support Anthropic**

Read `lib/ai/provider.ts` first, then replace the `complete` signature and `getProvider`:

```typescript
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';

// In AIProvider interface, update complete() to accept optional documents:
complete<T>(args: {
  systemPrompt: string;
  userMessage: string;
  schemaName: string;
  jsonSchema: object;
  validate: (raw: unknown) => T;
  documents?: Array<{ bytes: Buffer; mimeType: string }>;
}): Promise<{ data: T } & CompletionTelemetry>;

// In getProvider():
export function getProvider(): AIProvider {
  const which = process.env.AI_PROVIDER?.trim() || 'openai';
  if (which === 'openai') {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error('OPENAI_API_KEY not set');
    return new OpenAIProvider(process.env.OPENAI_MODEL?.trim() || 'gpt-5.4', key);
  }
  if (which === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    return new AnthropicProvider(
      process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6',
      key,
    );
  }
  throw new Error(`Unknown AI provider: ${which}`);
}
```

The full updated `lib/ai/provider.ts` (complete replacement):

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
  /** Max pages to transcribe. Default: 40. */
  maxPages?: number;
}

export interface TranscribeDocumentResult {
  text: string;
  costUsdCents: number;
  /** True when the file exceeded maxPages and was truncated. */
  truncated: boolean;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;

  complete<T>(args: {
    systemPrompt: string;
    userMessage: string;
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    /** Optional raw file bytes to send as native document blocks (Anthropic only; ignored by OpenAI). */
    documents?: Array<{ bytes: Buffer; mimeType: string }>;
  }): Promise<{ data: T } & CompletionTelemetry>;

  transcribeDocument(args: TranscribeDocumentArgs): Promise<TranscribeDocumentResult>;
}

import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';

export function getProvider(): AIProvider {
  const which = process.env.AI_PROVIDER?.trim() || 'openai';
  if (which === 'openai') {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error('OPENAI_API_KEY not set');
    return new OpenAIProvider(process.env.OPENAI_MODEL?.trim() || 'gpt-5.4', key);
  }
  if (which === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    return new AnthropicProvider(
      process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6',
      key,
    );
  }
  throw new Error(`Unknown AI provider: ${which}`);
}
```

- [ ] **Step 6: Update `lib/ai/openai.ts` to accept (and ignore) `documents?`**

Find the `complete<T>(args: {` signature in `lib/ai/openai.ts` and add `documents?: Array<{ bytes: Buffer; mimeType: string }>;` to the args object. The implementation does not need to read `documents` — it is silently ignored. Example (only the args type changes):

```typescript
async complete<T>(args: {
  systemPrompt: string;
  userMessage: string;
  schemaName: string;
  jsonSchema: object;
  validate: (raw: unknown) => T;
  documents?: Array<{ bytes: Buffer; mimeType: string }>;
}): Promise<{ data: T } & CompletionTelemetry> {
  // ... existing implementation unchanged
}
```

- [ ] **Step 7: Update `lib/ai/fake-provider.ts` to accept (and ignore) `documents?`**

Same change as OpenAI — add `documents?: Array<{ bytes: Buffer; mimeType: string }>;` to the `complete()` args type. No implementation change needed.

- [ ] **Step 8: Run all tests**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run tests/lib/ai/anthropic.test.ts tests/lib/ai/openai.test.ts 2>&1 | tail -30
```

Expected: all tests pass (the 5 new anthropic tests + the 5 existing openai tests).

- [ ] **Step 9: Run full test suite to catch any type breakage**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run 2>&1 | tail -10
```

Expected: all tests still passing.

- [ ] **Step 10: Commit**

```bash
git add lib/ai/anthropic.ts lib/ai/provider.ts lib/ai/openai.ts lib/ai/fake-provider.ts tests/lib/ai/anthropic.test.ts package.json package-lock.json
git commit -m "feat(ai): add AnthropicProvider with tool_use structured output and native document blocks"
```

---

## Task 2: Native PDF path in `analyzeMaterial`

**Files:**
- Modify: `lib/ai/course-profile/analyze-material.ts`
- Modify: `lib/ai/prompts/analyze-material.md`
- Modify: `tests/ai/course-profile/analyze-material.test.ts`

- [ ] **Step 1: Write failing tests for the native PDF path**

Open `tests/ai/course-profile/analyze-material.test.ts` and add these two tests at the end of the `describe('analyzeMaterial', ...)` block (keep all existing tests):

```typescript
it('passes document bytes to provider.complete() when documentBytes is provided', async () => {
  const completeMock = vi.fn().mockResolvedValue({
    data: fakeFinding,
    costUsdCents: 5,
    durationMs: 10,
    cachedTokens: 0,
    uncachedPromptTokens: 0,
    completionTokens: 0,
  });
  getProvider.mockReturnValue({ name: 'anthropic', model: 'claude-sonnet-4-6', complete: completeMock });

  const pdfBytes = Buffer.from('%PDF-1.4 fake pdf content');
  await analyzeMaterial({
    courseContext,
    fileName: 'rubric.pdf',
    extractedText: 'some fallback text',
    documentBytes: pdfBytes,
    documentMimeType: 'application/pdf',
  });

  const arg = completeMock.mock.calls[0]?.[0];
  expect(arg.documents).toHaveLength(1);
  expect(arg.documents[0].bytes).toEqual(pdfBytes);
  expect(arg.documents[0].mimeType).toBe('application/pdf');
});

it('omits extracted text from user message when documentBytes is provided', async () => {
  const completeMock = vi.fn().mockResolvedValue({
    data: fakeFinding,
    costUsdCents: 5,
    durationMs: 10,
    cachedTokens: 0,
    uncachedPromptTokens: 0,
    completionTokens: 0,
  });
  getProvider.mockReturnValue({ name: 'anthropic', model: 'claude-sonnet-4-6', complete: completeMock });

  await analyzeMaterial({
    courseContext,
    fileName: 'rubric.pdf',
    extractedText: 'DO NOT INCLUDE THIS TEXT',
    documentBytes: Buffer.from('%PDF'),
    documentMimeType: 'application/pdf',
  });

  const arg = completeMock.mock.calls[0]?.[0];
  expect(arg.userMessage).not.toContain('DO NOT INCLUDE THIS TEXT');
  expect(arg.userMessage).toContain('GC 4060');
  expect(arg.userMessage).toContain('rubric.pdf');
});
```

- [ ] **Step 2: Run to confirm both new tests fail**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run tests/ai/course-profile/analyze-material.test.ts 2>&1 | tail -20
```

Expected: FAIL — `documents` is not in the args, and the text-omission test passes (since there's no docBytes branch yet).

- [ ] **Step 3: Update `lib/ai/course-profile/analyze-material.ts`**

Replace the full file with:

```typescript
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { analysisFindingSchema, analysisFindingJsonSchema, type AnalysisFinding } from './schema';
import type { CallTelemetry } from '@/lib/ai/analyze/accum';

export interface CourseContext {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
}

export interface AnalyzeMaterialArgs {
  courseContext: CourseContext;
  fileName: string;
  extractedText: string;
  /** Raw file bytes. When present (Anthropic provider), sent as a native document block
   *  instead of pasting extractedText into the user message. */
  documentBytes?: Buffer;
  documentMimeType?: string;
}

export async function analyzeMaterial({
  courseContext,
  fileName,
  extractedText,
  documentBytes,
  documentMimeType,
}: AnalyzeMaterialArgs): Promise<{ data: AnalysisFinding; telemetry: CallTelemetry }> {
  const systemPrompt = await loadPrompt('analyze-material');
  const provider = getProvider();

  const useNativeDoc = documentBytes !== undefined && documentBytes.length > 0;

  const userMessage = useNativeDoc
    ? [
        `# Course context`,
        `Code: ${courseContext.code}`,
        `Title: ${courseContext.title}`,
        `Level: ${courseContext.level}`,
        `Track: ${courseContext.track}`,
        `Catalog description: ${courseContext.description}`,
        ``,
        `# File name`,
        fileName,
        ``,
        `# Document`,
        `The full document is attached. Please analyze its content directly.`,
      ].join('\n')
    : [
        `# Course context`,
        `Code: ${courseContext.code}`,
        `Title: ${courseContext.title}`,
        `Level: ${courseContext.level}`,
        `Track: ${courseContext.track}`,
        `Catalog description: ${courseContext.description}`,
        ``,
        `# File name`,
        fileName,
        ``,
        `# Extracted text`,
        extractedText,
      ].join('\n');

  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'analysis_finding',
    jsonSchema: analysisFindingJsonSchema,
    validate: (raw) => analysisFindingSchema.parse(raw),
    ...(useNativeDoc && documentMimeType
      ? { documents: [{ bytes: documentBytes!, mimeType: documentMimeType }] }
      : {}),
  });

  return {
    data: result.data,
    telemetry: {
      costUsdCents: result.costUsdCents,
      cachedTokens: result.cachedTokens,
      uncachedPromptTokens: result.uncachedPromptTokens,
      completionTokens: result.completionTokens,
    },
  };
}
```

- [ ] **Step 4: Update `lib/ai/prompts/analyze-material.md`**

Add to the `# Constraints` section at the bottom (after the last bullet, before the end of the file):

```markdown
- In the `notes` field, explicitly flag any images, diagrams, charts, figures, or tables you can see in the document but cannot fully describe in text. For example: "This rubric includes a grading matrix as an image table; exact point values may not be fully captured." If no such elements are present, `notes` may be empty.
```

The full updated constraint block should look like:

```markdown
# Constraints

- Only extract what the document actually requires of students. Do not infer competencies from the course title or catalog description.
- If the document is too sparse to identify any competencies, return empty arrays and explain in `notes`.
- Quotes must be verbatim (light cleanup for OCR artifacts only). Never fabricate a quote.
- Competency names should be reusable across materials in the same course — if two rubrics both test "Color management," name it identically so synthesis can merge them.
- In the `notes` field, explicitly flag any images, diagrams, charts, figures, or tables you can see in the document but cannot fully describe in text. For example: "This rubric includes a grading matrix as an image table; exact point values may not be fully captured." If no such elements are present, `notes` may be empty.
```

- [ ] **Step 5: Run the updated tests**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run tests/ai/course-profile/analyze-material.test.ts 2>&1 | tail -20
```

Expected: all 5 tests pass (3 original + 2 new).

- [ ] **Step 6: Run full suite**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/course-profile/analyze-material.ts lib/ai/prompts/analyze-material.md tests/ai/course-profile/analyze-material.test.ts
git commit -m "feat(ai): native PDF path in analyzeMaterial — document bytes bypass text extraction for Anthropic provider"
```

---

## Task 3: Fetch blob bytes in analyze-materials route for Anthropic native PDF

**Files:**
- Modify: `app/api/courses/[code]/analyze-materials/route.ts`
- Modify: `tests/api/analyze-materials.test.ts`

- [ ] **Step 1: Write failing test first**

Open `tests/api/analyze-materials.test.ts`. Add a mock for `fetch` (used to fetch blob bytes) and add this test inside the `describe` block:

```typescript
it('fetches blob bytes and passes documentBytes when provider is anthropic and material is PDF', async () => {
  getProvider.mockReturnValue({ name: 'anthropic', model: 'claude-sonnet-4-6' });

  const pdfMaterial = {
    ...fakeMaterialOk,
    mimeType: 'application/pdf',
    blobUrl: 'https://blob.vercel-storage.com/rubric.pdf',
  };
  listMaterialsByCourse.mockResolvedValue([pdfMaterial]);

  const fakePdfBytes = Buffer.from('%PDF-1.4');
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => fakePdfBytes.buffer,
  } as unknown as Response);

  analyzeMaterial.mockResolvedValue({
    data: { materialType: 'rubric', competencies: [], skills: [], notes: '' },
    telemetry: { costUsdCents: 7, cachedTokens: 0, uncachedPromptTokens: 100, completionTokens: 50 },
  });
  synthesizeCourseProfile.mockResolvedValue({
    data: fakeProfile,
    telemetry: { costUsdCents: 15, cachedTokens: 0, uncachedPromptTokens: 200, completionTokens: 100 },
  });

  const res = await POST(makeReq(), ctx);
  expect(res.status).toBe(200);

  const callArg = analyzeMaterial.mock.calls[0]?.[0];
  expect(callArg?.documentBytes).toBeDefined();
  expect(callArg?.documentMimeType).toBe('application/pdf');
});
```

Also add `blobUrl` and `mimeType` to `fakeMaterialOk` in the existing `const fakeMaterialOk = {...}` definition:

```typescript
const fakeMaterialOk = {
  id: 'mat-1',
  fileName: 'rubric.pdf',
  blobUrl: 'https://blob.vercel-storage.com/rubric.pdf',
  mimeType: 'application/pdf',
  extractedText: 'delta-E ≤ 2.0',
  extractionStatus: 'ok',
  analysisFinding: null,
  analysisModel: null,
  analysisCostUsdCents: null,
};
```

- [ ] **Step 2: Run to confirm the new test fails**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run tests/api/analyze-materials.test.ts 2>&1 | tail -20
```

Expected: FAIL — `documentBytes` is undefined in the analyzeMaterial call.

- [ ] **Step 3: Update `app/api/courses/[code]/analyze-materials/route.ts`**

After the existing `const uncachedMaterials = ...` / `const cachedMaterials = ...` split, add blob-fetch logic for the Anthropic native PDF path. Replace the per-file analysis block (steps 5 onward) with:

```typescript
  // 5. Resolve native document bytes for Anthropic provider (PDF only)
  const provider = getProvider();
  const useNativePdf = provider.name === 'anthropic';

  type ByteMap = Map<string, { bytes: Buffer; mimeType: string }>;
  const nativeBytes: ByteMap = new Map();

  if (useNativePdf) {
    const pdfMaterials = uncachedMaterials.filter((m) => m.mimeType === 'application/pdf');
    await Promise.all(
      pdfMaterials.map(async (m) => {
        try {
          const resp = await fetch(m.blobUrl);
          if (!resp.ok) return;
          const buf = Buffer.from(await resp.arrayBuffer());
          nativeBytes.set(m.id, { bytes: buf, mimeType: m.mimeType });
        } catch {
          // Fall back to text extraction if blob fetch fails
        }
      })
    );
  }

  // 6. Per-file analysis in parallel, skipping cached findings
  let totalCostUsdCents = 0;

  const newFindingResults = await Promise.all(
    uncachedMaterials.map((m) => {
      const native = nativeBytes.get(m.id);
      return analyzeMaterial({
        courseContext,
        fileName: m.fileName,
        extractedText: m.extractedText ?? '',
        ...(native ? { documentBytes: native.bytes, documentMimeType: native.mimeType } : {}),
      });
    })
  );
```

The full updated route should look like this (complete replacement of `route.ts`):

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { applyAnalyzeGuards } from '@/lib/ai/analyze/guards';
import { analyzeMaterial } from '@/lib/ai/course-profile/analyze-material';
import { synthesizeCourseProfile } from '@/lib/ai/course-profile/synthesize-course-profile';
import {
  cacheAnalysisFinding,
  insertProfileRun,
  upsertCourseProfile,
} from '@/lib/db/course-profile-queries';
import { recordSpend } from '@/lib/rate-limit/daily-cap';
import { getProvider } from '@/lib/ai/provider';

export const maxDuration = 120;

interface Ctx {
  params: Promise<{ code: string }>;
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  // 1. Slug gate
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const { code } = await params;
  const decoded = decodeURIComponent(code);

  // 2. Course must exist
  const course = await getCourseByCode(decoded);
  if (!course) {
    return NextResponse.json({ error: `course not found: ${decoded}` }, { status: 404 });
  }

  // 3. IP rate limit + daily cap guard
  const guard = await applyAnalyzeGuards(req);
  if (guard.short) return guard.short;

  // 4. Fetch all materials for the course
  const allMaterials = await listMaterialsByCourse(decoded);
  const readableMaterials = (allMaterials ?? []).filter((m) => m.extractionStatus === 'ok');
  if (readableMaterials.length === 0) {
    return NextResponse.json(
      { error: 'no readable materials — upload files and wait for extraction to succeed before analyzing' },
      { status: 400 }
    );
  }

  const courseContext = {
    code: course.code,
    title: course.title,
    level: course.level,
    track: course.track,
    description: course.description,
  };

  const uncachedMaterials = readableMaterials.filter((m) => m.analysisFinding === null);
  const cachedMaterials = readableMaterials.filter((m) => m.analysisFinding !== null);

  // 5. Resolve native document bytes for Anthropic provider (PDF only)
  const provider = getProvider();
  const useNativePdf = provider.name === 'anthropic';

  type ByteMap = Map<string, { bytes: Buffer; mimeType: string }>;
  const nativeBytes: ByteMap = new Map();

  if (useNativePdf) {
    const pdfMaterials = uncachedMaterials.filter((m) => m.mimeType === 'application/pdf');
    await Promise.all(
      pdfMaterials.map(async (m) => {
        try {
          const resp = await fetch(m.blobUrl);
          if (!resp.ok) return;
          const buf = Buffer.from(await resp.arrayBuffer());
          nativeBytes.set(m.id, { bytes: buf, mimeType: m.mimeType });
        } catch {
          // Fall back to text extraction if blob fetch fails
        }
      })
    );
  }

  // 6. Per-file analysis in parallel, skipping cached findings
  let totalCostUsdCents = 0;

  const newFindingResults = await Promise.all(
    uncachedMaterials.map((m) => {
      const native = nativeBytes.get(m.id);
      return analyzeMaterial({
        courseContext,
        fileName: m.fileName,
        extractedText: m.extractedText ?? '',
        ...(native ? { documentBytes: native.bytes, documentMimeType: native.mimeType } : {}),
      });
    })
  );

  await Promise.all(
    uncachedMaterials.map(async (m, i) => {
      const result = newFindingResults[i];
      if (!result) return;
      totalCostUsdCents += result.telemetry.costUsdCents;
      await cacheAnalysisFinding({
        materialId: m.id,
        finding: result.data,
        model: provider.model,
        costUsdCents: result.telemetry.costUsdCents,
      });
    })
  );

  const allFindings = [
    ...cachedMaterials.map((m) => ({
      fileName: m.fileName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      finding: m.analysisFinding as any,
    })),
    ...uncachedMaterials.map((m, i) => ({
      fileName: m.fileName,
      finding: newFindingResults[i]!.data,
    })),
  ];

  // 7. Synthesis call — if this throws, cached per-file findings are kept
  let synthesisResult: Awaited<ReturnType<typeof synthesizeCourseProfile>>;
  try {
    synthesisResult = await synthesizeCourseProfile({
      course: {
        code: course.code,
        title: course.title,
        level: course.level,
        track: course.track,
        description: course.description,
        learningObjectives: (course.learningObjectives as string[]) ?? [],
        skillsRequired: (course.skillsRequired as string[]) ?? [],
      },
      findings: allFindings,
    });
  } catch {
    return NextResponse.json({ error: 'synthesis failed' }, { status: 500 });
  }

  totalCostUsdCents += synthesisResult.telemetry.costUsdCents;

  // 8. Persist
  const runId = await insertProfileRun({
    courseCode: decoded,
    result: synthesisResult.data,
    materialCount: readableMaterials.length,
    model: provider.model,
    costUsdCents: totalCostUsdCents,
  });

  await upsertCourseProfile({
    courseCode: decoded,
    result: synthesisResult.data,
    runId,
  });

  // 9. Record spend
  await recordSpend(totalCostUsdCents);

  return NextResponse.json({
    runId,
    totalCostUsdCents,
    materialCount: readableMaterials.length,
    newlyAnalyzed: uncachedMaterials.length,
  });
}
```

- [ ] **Step 4: Run the updated tests**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run tests/api/analyze-materials.test.ts 2>&1 | tail -20
```

Expected: all 9 tests pass (8 original + 1 new).

- [ ] **Step 5: Run full suite**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/courses/[code]/analyze-materials/route.ts tests/api/analyze-materials.test.ts
git commit -m "feat(ai): fetch PDF blob bytes for Anthropic native-doc path in analyze-materials route"
```

---

## Task 4: Image-content warning chip in MaterialsList

**Files:**
- Modify: `app/preview/[slug]/courses/[code]/MaterialsList.tsx`
- Modify: `tests/components/MaterialsZone.test.tsx`

When a PDF was extracted using `pdf-parse` (method=`'text'`), any embedded images/diagrams were silently dropped. Show an amber warning chip so faculty know to review AI notes carefully.

The condition: `m.mimeType === 'application/pdf'` AND `m.extractionMethod === 'text'` AND `m.extractionStatus === 'ok'`.

Since `mimeType` isn't currently in the `UploadedMaterial` interface or in what the upload API returns, we'll infer from the filename extension: `m.fileName.toLowerCase().endsWith('.pdf')`. This is accurate in practice since DOCX files have a different extension.

- [ ] **Step 1: Write failing test**

Open `tests/components/MaterialsZone.test.tsx`. Add this test at the end:

```typescript
it('shows image-content warning for text-extracted PDFs', () => {
  const pdfTextMaterial = {
    id: 'mat-pdf',
    fileName: 'rubric-with-images.pdf',
    blobUrl: 'https://blob.vercel-storage.com/rubric.pdf',
    extractionStatus: 'ok' as const,
    extractionMethod: 'text',
    pageCount: 3,
  };
  render(<MaterialsZone courseCode="GC 3460" slug="test-slug" initialMaterials={[pdfTextMaterial]} />);
  expect(screen.getByText(/images/i)).toBeTruthy();
});

it('does not show image warning for DOCX files', () => {
  const docxMaterial = {
    id: 'mat-docx',
    fileName: 'rubric.docx',
    blobUrl: 'https://blob.vercel-storage.com/rubric.docx',
    extractionStatus: 'ok' as const,
    extractionMethod: 'text',
  };
  render(<MaterialsZone courseCode="GC 3460" slug="test-slug" initialMaterials={[docxMaterial]} />);
  // Query by text — should NOT find the image warning
  expect(screen.queryByText(/may contain images/i)).toBeNull();
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run tests/components/MaterialsZone.test.tsx 2>&1 | tail -20
```

Expected: FAIL — no image warning chip exists yet.

- [ ] **Step 3: Update `app/preview/[slug]/courses/[code]/MaterialsList.tsx`**

Add an `ImageContentWarning` chip and render it conditionally:

```typescript
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

function ImageWarningChip() {
  return (
    <Badge
      variant="secondary"
      className="text-amber-700 bg-amber-50 border-amber-200"
      title="This PDF was text-extracted. Embedded images, charts, and figures may not have been captured."
    >
      May contain images not captured in text
    </Badge>
  );
}

function hasPdfImageRisk(m: UploadedMaterial): boolean {
  return (
    m.extractionStatus === 'ok' &&
    m.extractionMethod === 'text' &&
    m.fileName.toLowerCase().endsWith('.pdf')
  );
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
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <StatusBadge status={m.extractionStatus} />
              {m.extractionMethod && (
                <span className="text-xs text-muted-foreground">via {m.extractionMethod}</span>
              )}
              {m.pageCount !== undefined && (
                <span className="text-xs text-muted-foreground">{m.pageCount}p</span>
              )}
              {hasPdfImageRisk(m) && <ImageWarningChip />}
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

- [ ] **Step 4: Run all component tests**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run tests/components/MaterialsZone.test.tsx 2>&1 | tail -20
```

Expected: all tests pass (2 existing + 2 new).

- [ ] **Step 5: Run full suite**

```bash
cd /Users/admin/projects/curriculum_developer
npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/preview/[slug]/courses/[code]/MaterialsList.tsx tests/components/MaterialsZone.test.tsx
git commit -m "feat(ui): amber warning chip in MaterialsList for text-extracted PDFs with potential image content"
```

---

## Self-Review

**Spec coverage:**
- ✅ AnthropicProvider with `complete()` via tool_use (Task 1)
- ✅ Native PDF document blocks (Task 1 + Task 2)
- ✅ `getProvider()` supports `AI_PROVIDER=anthropic` (Task 1)
- ✅ `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` env var pattern (Task 1)
- ✅ `transcribeDocument()` via Anthropic native doc blocks (Task 1)
- ✅ `analyzeMaterial` sends PDF bytes as document blocks when available (Task 2)
- ✅ Prompt instruction to flag uncaptured images/charts in `notes` (Task 2)
- ✅ analyze-materials route fetches blob bytes for Anthropic + PDF materials (Task 3)
- ✅ Amber warning chip for text-extracted PDFs in MaterialsList (Task 4)

**Placeholder scan:** No placeholders found — all code blocks are complete.

**Type consistency:**
- `documents?: Array<{ bytes: Buffer; mimeType: string }>` — consistent across `AIProvider` interface, `OpenAIProvider`, `AnthropicProvider`, `FakeProvider`, and `analyzeMaterial` args
- `provider.name === 'anthropic'` check — consistent between route and provider
- `UploadedMaterial` interface unchanged — `hasPdfImageRisk` only uses existing fields

**Env vars added:**
- `ANTHROPIC_API_KEY` — required when `AI_PROVIDER=anthropic`
- `ANTHROPIC_MODEL` — optional, defaults to `claude-sonnet-4-6`
- `AI_PROVIDER=anthropic` — opt-in; `openai` remains the default

**Notes for the implementer:**
- The Anthropic SDK's `cache_read_input_tokens` and `cache_creation_input_tokens` fields are present on the usage object but may not be in older SDK type definitions. The narrow cast `(response.usage as { cache_read_input_tokens?: number })?.cache_read_input_tokens ?? 0` handles this safely.
- `mimeType` in the `courseMaterials` schema is always stored as a valid MIME string; it is present on `CourseMaterialRow` returned by `listMaterialsByCourse`.
- The blob fetch in the route is a no-op for OpenAI path (`useNativePdf === false`), so existing behavior is unchanged.
