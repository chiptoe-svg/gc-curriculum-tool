# Tiered Ingestion — Increment 2a: Classifier + Tier Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Auto-assign a tier (`high` | `middle` | `background`) to every discovered material and persist it, so Increment 2b's triage UI has tiers to show and Increment 3's worker has tiers to honor. Structure-first (Canvas item kind → tier, deterministic); an LLM only for the ambiguous *file* bucket, on cheap signals, biased toward the cheaper tier. Part of the [tiered-ingestion-triage spec](../specs/2026-06-18-tiered-ingestion-triage-design.md); builds on Increment 1 (list-mode manifest).

**Architecture:** A new `tier` column on `course_materials`. A pure `classifyByKind(kind)` maps structural kinds deterministically. A new light-tier AI function `material-classify` decides *deck (middle)* vs *reading (background)* for PDF/DOC files; PPTX/Keynote → middle deterministically (no LLM). `runListImport` populates `tier` per row and includes it in the manifest. All behind the existing `COURSECAPTURE_TRIAGE` flag.

**Tech Stack:** Drizzle migration, Vitest, the existing provider/`loadPrompt` pattern (mirrors `chunk-contextualize`).

---

## File Structure

- Modify: `lib/db/schema.ts` — add `tier` to `courseMaterials`.
- Create: migration SQL (numbered, next in sequence) adding the column.
- Create: `lib/capture/material-tier.ts` — `Tier` type, `classifyByKind`, `classifyFile` (LLM), `classifyManifestItem`.
- Create: `lib/ai/prompts/material-classify.md` — the file-bucket classifier prompt.
- Modify: `lib/ai/function-settings.ts` — register `material-classify` (id array, `DEFAULT_TIERS` light, label, description); `lib/ai/prompts/load.ts` PromptName if it enumerates names.
- Modify: `app/api/courses/[code]/canvas-import/list-import.ts` — call the classifier, persist `tier`, add `tier` to manifest rows.
- Tests: `tests/lib/capture/material-tier.test.ts`, extend `tests/api/canvas-list-import.test.ts`.

---

### Task 1: `tier` column

**Files:** `lib/db/schema.ts`; new migration; Test: none (schema-only; covered by Task 4's integration).

- [ ] **Step 1:** Add to `courseMaterials` in `schema.ts`, after `indexingStatus`:

```typescript
  // Ingestion depth tier assigned at discovery: 'high' (full pipeline) |
  // 'middle' (per-unit summary) | 'background' (one digest). Null until the
  // tiered-ingestion classifier runs. Faculty-overridable on the triage screen.
  tier: text('tier'),  // 'high' | 'middle' | 'background' | null
```

- [ ] **Step 2:** Generate the migration: `pnpm drizzle-kit generate` (or hand-write the next numbered SQL file in the migrations dir: `ALTER TABLE course_materials ADD COLUMN tier text;`). Confirm the generated file matches and apply per the repo's migration flow.

- [ ] **Step 3:** `pnpm exec tsc --noEmit` clean.

- [ ] **Step 4: Commit** — `git commit -m "feat(triage): course_materials.tier column"`

---

### Task 2: Structure-first classifier (pure, deterministic)

**Files:** Create `lib/capture/material-tier.ts`; Test: `tests/lib/capture/material-tier.test.ts`

`ManifestKind` = the manifest `kind` from Increment 1 (`'syllabus'|'assignments'|'pages'|'discussions'|'quizzes'|'modules'|'file'`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { classifyByKind } from '@/lib/capture/material-tier';

describe('classifyByKind', () => {
  it('maps graded/assessed kinds to high', () => {
    for (const k of ['syllabus', 'assignments', 'quizzes'] as const) {
      expect(classifyByKind(k)).toBe('high');
    }
  });
  it('maps instructional kinds to middle', () => {
    for (const k of ['pages', 'discussions', 'modules'] as const) {
      expect(classifyByKind(k)).toBe('middle');
    }
  });
  it('returns null for files (needs signal-based classification)', () => {
    expect(classifyByKind('file')).toBeNull();
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** (the kind map + types; `classifyFile`/`classifyManifestItem` added in Task 3):

```typescript
export type Tier = 'high' | 'middle' | 'background';
export type ManifestKind = 'syllabus' | 'assignments' | 'pages' | 'discussions' | 'quizzes' | 'modules' | 'file';

const KIND_TIER: Record<Exclude<ManifestKind, 'file'>, Tier> = {
  syllabus: 'high', assignments: 'high', quizzes: 'high',
  pages: 'middle', discussions: 'middle', modules: 'middle',
};

/** Deterministic structure-first tier. Returns null for 'file' — files need
 *  signal-based classification (classifyFile). */
export function classifyByKind(kind: ManifestKind): Tier | null {
  return kind === 'file' ? null : KIND_TIER[kind];
}
```

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(triage): structure-first tier classifier"`

---

### Task 3: File-bucket classifier (deterministic PPTX + LLM for PDF/DOC)

**Files:** Modify `lib/capture/material-tier.ts`; Create `lib/ai/prompts/material-classify.md`; Modify `lib/ai/function-settings.ts` (+ `prompts/load.ts` if it enumerates `PromptName`); Test: extend `tests/lib/capture/material-tier.test.ts`.

`classifyFile` takes cheap signals `{ fileName, mimeType, sizeBytes, pageCount?, slideCount?, peekText? }`. PPTX/Keynote → `middle` deterministically (it's a deck). Otherwise call the `material-classify` LLM function to decide `middle` (deck/slides exported to PDF) vs `background` (reading), **defaulting to `background` on any error or low confidence** (bias cheap).

- [ ] **Step 1: Write the failing test** (mock the provider; assert PPTX is deterministic — no LLM call — and PDF routes through the LLM with background-on-error)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/ai/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>('@/lib/ai/provider');
  return { ...actual, getProviderForFunction: vi.fn() };
});
import { classifyFile } from '@/lib/capture/material-tier';
import { getProviderForFunction } from '@/lib/ai/provider';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const stub = (tier: string) => ({ name: 'fake', model: 'm',
  complete: vi.fn(async (a: { validate: (r: unknown) => unknown }) => ({ data: a.validate({ tier }), costUsdCents: 0, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 1, completionTokens: 1 })),
  completeWithTools: vi.fn(), transcribeDocument: vi.fn() });

beforeEach(() => vi.mocked(getProviderForFunction).mockReset());

describe('classifyFile', () => {
  it('classifies PPTX as middle without any LLM call', async () => {
    const t = await classifyFile({ fileName: 'wk1.pptx', mimeType: PPTX, sizeBytes: 1000 });
    expect(t).toBe('middle');
    expect(getProviderForFunction).not.toHaveBeenCalled();
  });
  it('routes PDFs through the LLM (deck → middle)', async () => {
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub('middle') as never);
    expect(await classifyFile({ fileName: 'lecture3.pdf', mimeType: 'application/pdf', sizeBytes: 9, pageCount: 30 })).toBe('middle');
  });
  it('defaults to background when the LLM errors (bias cheap)', async () => {
    vi.mocked(getProviderForFunction).mockResolvedValueOnce({ name: 'f', model: 'm',
      complete: vi.fn(async () => { throw new Error('down'); }), completeWithTools: vi.fn(), transcribeDocument: vi.fn() } as never);
    expect(await classifyFile({ fileName: 'reading.pdf', mimeType: 'application/pdf', sizeBytes: 9 })).toBe('background');
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3a: Register the AI function** in `lib/ai/function-settings.ts`: add `'material-classify'` to the `AI_FUNCTION_IDS` array, `DEFAULT_TIERS` (`'material-classify': 'light'`), the label map (`'material-classify': 'Material tier classifier (deck vs reading)'`), and the description map. If `lib/ai/prompts/load.ts` enumerates `PromptName`, add `'material-classify'`.

- [ ] **Step 3b: Write the prompt** `lib/ai/prompts/material-classify.md`: instruct the model to decide whether a course file is a **lecture deck / slides** (→ `middle`) or a **reading / reference document** (→ `background`), given filename, mime, size, page/slide count, and an optional text peek; **when unsure, choose `background`** (cheaper). Output strict JSON `{ "tier": "middle" | "background" }`.

- [ ] **Step 3c: Implement** `classifyFile` (+ `classifyManifestItem`) in `material-tier.ts`:

```typescript
import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DECK_MIMES = new Set([PPTX, 'application/vnd.apple.keynote']);

export interface FileSignals {
  fileName: string; mimeType: string; sizeBytes: number;
  pageCount?: number; slideCount?: number; peekText?: string;
}

/** Tier for a file from cheap signals. PPTX/Keynote → middle (deck) with no
 *  LLM. Other files → material-classify LLM (deck=middle vs reading=background),
 *  defaulting to background on any error / low confidence (bias cheap). */
export async function classifyFile(sig: FileSignals): Promise<Tier> {
  if (DECK_MIMES.has(sig.mimeType) || sig.slideCount != null) return 'middle';
  try {
    const provider = await getProviderForFunction('material-classify');
    const systemPrompt = await loadPrompt('material-classify');
    const jsonSchema = { type: 'object', properties: { tier: { type: 'string', enum: ['middle', 'background'] } }, required: ['tier'], additionalProperties: false };
    const userMessage = [
      `File: ${sig.fileName}`, `MIME: ${sig.mimeType}`, `Size: ${sig.sizeBytes} bytes`,
      sig.pageCount != null ? `Pages: ${sig.pageCount}` : '',
      sig.peekText ? `First-page peek:\n${sig.peekText.slice(0, 1500)}` : '',
      'Return JSON {"tier":"middle"|"background"}.',
    ].filter(Boolean).join('\n');
    const { data } = await provider.complete<{ tier: Tier }>({
      systemPrompt, userMessage, schemaName: 'material_classify', jsonSchema,
      validate: (raw) => {
        const t = (raw as { tier?: unknown }).tier;
        return { tier: t === 'middle' ? 'middle' : 'background' };  // bias cheap
      },
    });
    return data.tier;
  } catch {
    return 'background';  // bias cheap on any failure
  }
}

export async function classifyManifestItem(item: { kind: ManifestKind } & Partial<FileSignals>): Promise<Tier> {
  const byKind = classifyByKind(item.kind);
  if (byKind) return byKind;
  return classifyFile(item as FileSignals);
}
```

- [ ] **Step 4:** Run → PASS (3/3 new). `pnpm exec tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(triage): file-bucket tier classifier (material-classify, bias cheap)"`

---

### Task 4: Wire classifier into list-mode + persist tier

**Files:** Modify `lib/capture/material-tier.ts` consumers in `app/api/courses/[code]/canvas-import/list-import.ts`; extend `tests/api/canvas-list-import.test.ts`.

- [ ] **Step 1: Extend the test:** assert every manifest row now has a `tier` in `{high,middle,background}`; an `assignments` row is `high`; a `.pptx` file row is `middle`. (Mock `material-classify`'s provider so PDF files resolve deterministically in-test, OR rely on the background-default by not mocking.)

- [ ] **Step 2: Implement:** in `runListImport`, after computing each row's `kind` + signals, `await classifyManifestItem(...)` and write the result to the inserted/updated row's `tier` (extend `insertMaterial`/an update to set `tier`, or a dedicated `updateMaterialTier(id, tier)` query) and include `tier` in the manifest row object. Classify files using the probe signals already computed (`pageCount`/`slideCount`/`sizeBytes`). Do NOT block the response on a classifier failure — `classifyFile` already defaults to background.

> Add a tiny query `updateMaterialTier(id: string, tier: string)` in `lib/db/course-materials-queries.ts` if no existing update sets `tier`.

- [ ] **Step 3:** Run the list-import test + tier test → green.
- [ ] **Step 4: Commit** — `git commit -m "feat(triage): list-mode assigns + persists tier per material"`

---

### Task 5: Typecheck + suite + STATE.md

- [ ] **Step 1:** `pnpm exec tsc --noEmit` clean.
- [ ] **Step 2:** `pnpm exec vitest run tests/lib/capture tests/api tests/lib/ai` green.
- [ ] **Step 3:** Update `docs/STATE.md`: new AI function id `material-classify` (light tier); new `course_materials.tier` column + migration number; Increment 2a done (classifier + tier persistence behind `COURSECAPTURE_TRIAGE`); note 2b (triage UI + ingest) next.
- [ ] **Step 4: Commit** — `git commit -m "docs(state): tiered-ingestion 2a (classifier + tier) done"`

---

## Self-Review notes (controller)

- **Spec coverage:** covers the spec's *classifier* (structure-first + file-bucket LLM, bias cheap). Does NOT cover the triage UI, the Ingest action, or the tier-aware worker (2b / Increment 3). Tier is persisted but **not yet honored** by the worker — that's Increment 3; until then a flag-on ingest would still run the existing full pipeline.
- **Tracked surfaces:** new AI function id (`material-classify`) and new schema column (`tier`) + migration → STATE.md update is required (Task 5).
- **Type consistency:** `Tier` and `ManifestKind` here must match the manifest row shape from Increment 1 and what 2b's UI + Increment 3's worker consume.
- **No placeholders:** the prompt body (3b) and the migration SQL (1) are described precisely; the implementer writes the prompt prose and runs the migration generator.
