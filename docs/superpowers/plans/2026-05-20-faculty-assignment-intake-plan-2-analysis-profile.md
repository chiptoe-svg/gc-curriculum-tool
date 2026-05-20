# Faculty Assignment Intake — Plan 2: Analysis Pipeline & Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the analysis pipeline (per-file `analyzeMaterial` helper, `synthesizeCourseProfile` helper, `POST /api/courses/[code]/analyze-materials` route) and the read-only profile display zone on the per-course page, wiring up cost guards, run history, and profile persistence.

**Architecture:** Two new prompt files + Zod schemas mirror the existing `lib/ai/synthesis/` pattern exactly. Per-file analysis runs in parallel (one AI call per unanalyzed material); a single synthesis call merges all findings into a course profile. Results land in two tables: `course_profile_runs` (immutable history) and `course_profiles` (current editable row). The per-course page at `app/preview/[slug]/courses/[code]/page.tsx` gains two new read-only zones ("Analyze" and "Profile") rendered as server components reading from those tables.

**Tech Stack:** Next.js 15 App Router, TypeScript strict with `noUncheckedIndexedAccess`, Drizzle ORM + Neon Postgres, Vitest, React 19, Tailwind v4, shadcn/ui primitives, existing `lib/ai/provider.ts` abstraction + `FakeProvider`. Package manager: pnpm.

**Spec:** [`docs/superpowers/specs/2026-05-19-faculty-assignment-intake-design.md`](../specs/2026-05-19-faculty-assignment-intake-design.md)

**Prior plan:** Plan 1 (Schema, upload & extraction) — ships tables `course_materials`, `course_profiles`, `course_profile_runs`, migration `0009`, and the per-course page with the "Materials" zone already present.

**Out of scope (other plans own these):** Drizzle migrations; the upload route; text extraction; `transcribeDocument`; the editable profile editor and its `PATCH` route; the `/preview/[slug]/courses` index page; `resolveCourseContext`.

---

## Assumptions about Plan 1's output

When Plan 2 runs, the following already exist (do NOT recreate them):

- `lib/db/schema.ts` exports `courseMaterials`, `courseProfiles`, and `courseProfileRuns` tables (migration `0009` applied).
- `lib/db/course-materials-queries.ts` — at minimum exports `listMaterialsByCourse(code: string)` returning rows with all columns of `courseMaterials`.
- `app/preview/[slug]/courses/[code]/page.tsx` exists and renders a "Materials" zone. Plan 2 appends two more zones to that same file.
- `lib/ai/prompts/load.ts` has `PromptName` with at least the existing six names.

---

## File Structure

**New files created by this plan:**

```
lib/ai/prompts/
  analyze-material.md                   # per-file analysis system prompt
  synthesize-course-profile.md          # synthesis system prompt

lib/ai/course-profile/
  schema.ts                             # Zod + JSON schemas for analysisFinding + courseProfileResult
  analyze-material.ts                   # analyzeMaterial() helper
  synthesize-course-profile.ts          # synthesizeCourseProfile() helper

lib/db/
  __tests__/
    course-profile-queries.test.ts      # tests for the profile queries module
  course-profile-queries.ts             # DB: insert run, upsert profile, read both, cache finding

app/api/courses/[code]/
  analyze-materials/
    route.ts                            # POST /api/courses/[code]/analyze-materials

components/
  CourseAnalyzeZone.tsx                 # "Analyze" button + last-run metadata + overwrite warning
  CourseProfileDisplay.tsx              # read-only profile view

tests/ai/course-profile/
  schema.test.ts
  analyze-material.test.ts
  synthesize-course-profile.test.ts

tests/api/
  analyze-materials.test.ts

tests/components/
  CourseAnalyzeZone.test.tsx
  CourseProfileDisplay.test.tsx
```

**Modified files:**

- `lib/ai/prompts/load.ts` — extend `PromptName` union with `'analyze-material'` and `'synthesize-course-profile'`.
- `app/preview/[slug]/courses/[code]/page.tsx` — append "Analyze" and "Profile" zones below the existing "Materials" zone.

---

## Phase A — Schemas

### Task 1: Zod + JSON schemas for `analysisFinding` and `courseProfileResult`

**Files:**
- Create: `lib/ai/course-profile/schema.ts`
- Create: `tests/ai/course-profile/schema.test.ts`

These schemas are the source of truth for what the AI must return. `analysisFinding` is cached per `course_materials` row. `courseProfileResult` is stored in `course_profile_runs.result` and used to upsert `course_profiles`.

- [ ] **Step 1: Write the failing tests**

Create `tests/ai/course-profile/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  analysisFindingSchema,
  analysisFindingJsonSchema,
  courseProfileResultSchema,
  courseProfileResultJsonSchema,
} from '@/lib/ai/course-profile/schema';

// ── analysisFinding ──────────────────────────────────────────────────────────

describe('analysisFindingSchema', () => {
  it('accepts a valid finding', () => {
    expect(() =>
      analysisFindingSchema.parse({
        materialType: 'rubric',
        competencies: [
          {
            name: 'Color management',
            description: 'Ability to match Pantone swatches.',
            evidenceQuotes: ['Students must hit a delta-E of ≤ 2.0 on the press check.'],
          },
        ],
        skills: ['Spectrophotometry', 'ICC profile generation'],
        notes: 'Assignment 3 is the most demanding.',
      })
    ).not.toThrow();
  });

  it('accepts a finding with empty competencies and skills', () => {
    expect(() =>
      analysisFindingSchema.parse({
        materialType: 'worksheet',
        competencies: [],
        skills: [],
        notes: '',
      })
    ).not.toThrow();
  });

  it('rejects missing materialType', () => {
    expect(() =>
      analysisFindingSchema.parse({ competencies: [], skills: [], notes: '' })
    ).toThrow();
  });
});

describe('analysisFindingJsonSchema', () => {
  it('is a JSON Schema object with required top-level fields', () => {
    expect(analysisFindingJsonSchema.type).toBe('object');
    const required = analysisFindingJsonSchema.required as string[];
    for (const f of ['materialType', 'competencies', 'skills', 'notes']) {
      expect(required).toContain(f);
    }
  });
});

// ── courseProfileResult ───────────────────────────────────────────────────────

describe('courseProfileResultSchema', () => {
  const minimal = {
    summary: 'This course develops press-floor fluency.',
    learningObjectives: ['Operate an 8-color press safely'],
    skills: ['Color management'],
    competencies: [
      {
        name: 'Press operation',
        description: 'Run a commercial press through make-ready and production.',
        level: 'developed',
        evidence: [{ fileName: 'rubric.pdf', quote: 'Student must complete a 10k-impression run.' }],
      },
    ],
    catalogDivergence: {
      reinforced: ['Color theory'],
      additions: ['Spectrophotometric measurement'],
      gaps: ['Bindery operations'],
    },
  };

  it('accepts a valid full result', () => {
    expect(() => courseProfileResultSchema.parse(minimal)).not.toThrow();
  });

  it('accepts empty arrays throughout', () => {
    expect(() =>
      courseProfileResultSchema.parse({
        summary: 'Short.',
        learningObjectives: [],
        skills: [],
        competencies: [],
        catalogDivergence: { reinforced: [], additions: [], gaps: [] },
      })
    ).not.toThrow();
  });

  it('rejects missing catalogDivergence', () => {
    const { catalogDivergence: _cd, ...bad } = minimal;
    expect(() => courseProfileResultSchema.parse(bad)).toThrow();
  });

  it('rejects a competency without required fields', () => {
    expect(() =>
      courseProfileResultSchema.parse({
        ...minimal,
        competencies: [{ name: 'X' }],
      })
    ).toThrow();
  });
});

describe('courseProfileResultJsonSchema', () => {
  it('has required top-level fields', () => {
    expect(courseProfileResultJsonSchema.type).toBe('object');
    const required = courseProfileResultJsonSchema.required as string[];
    for (const f of ['summary', 'learningObjectives', 'skills', 'competencies', 'catalogDivergence']) {
      expect(required).toContain(f);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/ai/course-profile/schema.test.ts`

Expected: FAIL with "Cannot find module '@/lib/ai/course-profile/schema'"

- [ ] **Step 3: Implement the schema module**

Create `lib/ai/course-profile/schema.ts`:

```typescript
import { z } from 'zod';

// ── Per-file finding (cached on course_materials.analysisFinding) ─────────────

const analysisFindingCompetencySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  evidenceQuotes: z.array(z.string()),
});

export const analysisFindingSchema = z.object({
  materialType: z.string().min(1),
  competencies: z.array(analysisFindingCompetencySchema),
  skills: z.array(z.string()),
  notes: z.string(),
});

export type AnalysisFinding = z.infer<typeof analysisFindingSchema>;

// JSON Schema for OpenAI structured outputs — mirrors the Zod schema above.
// Keep in sync: if you change one, change the other.
export const analysisFindingJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['materialType', 'competencies', 'skills', 'notes'],
  properties: {
    materialType: { type: 'string' },
    competencies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'evidenceQuotes'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          evidenceQuotes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    skills: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
} as const;

// ── Synthesized course profile (stored in course_profile_runs + course_profiles) ──

const profileCompetencySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  level: z.string().min(1),           // free string: 'introduced' | 'developed' | 'mastered' or similar
  evidence: z.array(
    z.object({
      fileName: z.string().min(1),
      quote: z.string().min(1),
    })
  ),
});

const catalogDivergenceSchema = z.object({
  reinforced: z.array(z.string()),
  additions: z.array(z.string()),
  gaps: z.array(z.string()),
});

export const courseProfileResultSchema = z.object({
  summary: z.string().min(1),
  learningObjectives: z.array(z.string()),
  skills: z.array(z.string()),
  competencies: z.array(profileCompetencySchema),
  catalogDivergence: catalogDivergenceSchema,
});

export type CourseProfileResult = z.infer<typeof courseProfileResultSchema>;

export const courseProfileResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'learningObjectives', 'skills', 'competencies', 'catalogDivergence'],
  properties: {
    summary: { type: 'string' },
    learningObjectives: { type: 'array', items: { type: 'string' } },
    skills: { type: 'array', items: { type: 'string' } },
    competencies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'level', 'evidence'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          level: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['fileName', 'quote'],
              properties: {
                fileName: { type: 'string' },
                quote: { type: 'string' },
              },
            },
          },
        },
      },
    },
    catalogDivergence: {
      type: 'object',
      additionalProperties: false,
      required: ['reinforced', 'additions', 'gaps'],
      properties: {
        reinforced: { type: 'array', items: { type: 'string' } },
        additions: { type: 'array', items: { type: 'string' } },
        gaps: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/ai/course-profile/schema.test.ts`

Expected: 9 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/course-profile/schema.ts tests/ai/course-profile/schema.test.ts
git commit -m "feat(course-profile): Zod + JSON schemas for analysisFinding and courseProfileResult"
```

---

## Phase B — Prompt files + PromptName registration

### Task 2: `analyze-material.md` prompt + `PromptName` extension

**Files:**
- Create: `lib/ai/prompts/analyze-material.md`
- Modify: `lib/ai/prompts/load.ts`

- [ ] **Step 1: Create the analyze-material prompt**

Create `lib/ai/prompts/analyze-material.md`:

```markdown
---
name: analyze-material
---

# Task

You are analyzing a single course assignment material (a rubric, worksheet, exam, project brief, or stated expectation document) from a Graphic Communications course. Your job is to classify the material and extract the competencies and skills it evidences, grounded in direct quotes from the document.

# Inputs you will receive

The user message contains:

1. Course context: the course code, title, level (1–4), track, and catalog description.
2. File name: the original upload name, which may hint at the material type.
3. Extracted text: the full text content of the document.

# Output fields

- `materialType`: one short string classifying the document. Use one of: `rubric`, `exam`, `worksheet`, `project_brief`, `syllabus_section`, `lab_instructions`, `expectations_document`, or `other` — pick the closest match.
- `competencies`: an array of competency objects the document evidences. For each:
  - `name`: a short, noun-phrase label (e.g., "Color management", "Press make-ready").
  - `description`: one sentence explaining what the document expects students to be able to do with this competency.
  - `evidenceQuotes`: 1–3 short verbatim or near-verbatim excerpts from the document that demonstrate the competency is required. Quotes must come directly from the text — do not paraphrase.
- `skills`: flat list of specific technical or professional skills the document names or clearly requires (e.g., "Spectrophotometry", "Pantone Live", "InDesign preflight"). Normalize obvious variants ("color mgmt" → "Color management").
- `notes`: one sentence (or empty string) flagging anything unusual — e.g., "This document is a grading rubric only; no assignment prompt is included" or "Text appears truncated after page 3."

# Constraints

- Only extract what the document actually requires of students. Do not infer competencies from the course title or catalog description.
- If the document is too sparse to identify any competencies, return empty arrays and explain in `notes`.
- Quotes must be verbatim (light cleanup for OCR artifacts only). Never fabricate a quote.
- Competency names should be reusable across materials in the same course — if two rubrics both test "Color management," name it identically so synthesis can merge them.
```

- [ ] **Step 2: Extend the `PromptName` union**

Open `lib/ai/prompts/load.ts`. Find the `type PromptName = ...` declaration. Replace:

```typescript
type PromptName =
  | 'draft-outcomes'
  | 'score-coverage'
  | 'suggest-prerequisites'
  | 'analyze-prerequisite-gaps'
  | 'evaluate-scaffolding'
  | 'synthesize-target';
```

with:

```typescript
type PromptName =
  | 'draft-outcomes'
  | 'score-coverage'
  | 'suggest-prerequisites'
  | 'analyze-prerequisite-gaps'
  | 'evaluate-scaffolding'
  | 'synthesize-target'
  | 'analyze-material'
  | 'synthesize-course-profile';
```

- [ ] **Step 3: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/analyze-material.md lib/ai/prompts/load.ts
git commit -m "feat(course-profile): analyze-material prompt + extend PromptName union"
```

---

### Task 3: `synthesize-course-profile.md` prompt

**Files:**
- Create: `lib/ai/prompts/synthesize-course-profile.md`

- [ ] **Step 1: Create the synthesize-course-profile prompt**

Create `lib/ai/prompts/synthesize-course-profile.md`:

```markdown
---
name: synthesize-course-profile
---

# Task

You are synthesizing per-file analysis findings from multiple course assignment materials into an evidence-grounded course profile. The profile describes what this course *actually* develops — based on real assignments — not just what the catalog says it covers.

# Inputs you will receive

The user message contains:

1. Course context: course code, title, level (1–4), track, catalog description, catalog learning objectives, and catalog skills required.
2. Per-file findings: an array of `analysisFinding` objects (one per uploaded material). Each finding has: `fileName`, `materialType`, `competencies` (with `evidenceQuotes`), `skills`, and `notes`.

# Output fields

- `summary`: 2–4 sentences describing what the course actually develops, grounded in the assignments. Focus on the highest-stakes competencies and what students must demonstrably *do*.
- `learningObjectives`: a flat list of learning objective strings, derived from the assignment evidence. These should be action-verb statements ("Operate a multi-color press through make-ready and a 10k-impression run"). Aim for 3–8 objectives that cover the scope of the materials without duplication.
- `skills`: a deduplicated flat list of specific technical or professional skills evidenced across all materials. Normalize variants ("color mgmt" → "Color management").
- `competencies`: an array of competency objects with evidence chains. Merge competencies that appear across multiple files under a single name (match on normalized `name`). For each merged competency:
  - `name`: the normalized short label.
  - `description`: one sentence synthesizing what the course requires of students in this area.
  - `level`: your best judgment of the proficiency level this course targets for this competency. Use one of: `introduced`, `developed`, or `mastered`. Base this on assignment complexity, not catalog level.
  - `evidence`: an array of `{ fileName, quote }` objects — the best 1–3 verbatim quotes across all files, one per source file where possible.
- `catalogDivergence`:
  - `reinforced`: catalog objectives or skills that the assignments actively evidence (verbatim or close paraphrase of the catalog text).
  - `additions`: competencies or skills the assignments evidence that are **not** in the catalog (new ground the assignments cover beyond what's cataloged).
  - `gaps`: catalog objectives or skills that the assignments do **not** evidence (catalog claims the course covers these, but no assignment requires them).

# Constraints

- Base everything on the per-file findings. Do not invent competencies from your knowledge of Graphic Communications or press operation.
- For `catalogDivergence`, compare against the catalog fields supplied in the course context — not against general industry knowledge.
- If only one file was analyzed, the profile will be narrow; that is correct. Do not pad it.
- Keep `learningObjectives` as concrete and measurable as the evidence allows. Avoid vague verbs like "understand" or "appreciate."
```

- [ ] **Step 2: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/prompts/synthesize-course-profile.md
git commit -m "feat(course-profile): synthesize-course-profile prompt"
```

---

## Phase C — AI helpers

### Task 4: `analyzeMaterial` helper

**Files:**
- Create: `lib/ai/course-profile/analyze-material.ts`
- Create: `tests/ai/course-profile/analyze-material.test.ts`

The `analyzeMaterial` helper makes one AI call per file. It takes course context and the file's extracted text, returns a structured `AnalysisFinding` plus telemetry. It follows the exact same pattern as `kud-draft.ts` — load prompt (memoized), get provider, call `provider.complete`, return `{ data, telemetry }`.

- [ ] **Step 1: Write the failing test**

Create `tests/ai/course-profile/analyze-material.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  loadPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { analyzeMaterial } from '@/lib/ai/course-profile/analyze-material';

const fakeFinding = {
  materialType: 'rubric',
  competencies: [
    { name: 'Color management', description: 'Hit delta-E ≤ 2.', evidenceQuotes: ['delta-E of ≤ 2.0'] },
  ],
  skills: ['Spectrophotometry'],
  notes: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('ANALYZE SYSTEM PROMPT');
  getProvider.mockReturnValue({
    name: 'openai',
    model: 'gpt-5.4-mini',
    complete: vi.fn().mockResolvedValue({
      data: fakeFinding,
      costUsdCents: 7,
      durationMs: 200,
      cachedTokens: 0,
      uncachedPromptTokens: 300,
      completionTokens: 100,
    }),
  });
});

const courseContext = {
  code: 'GC 4060',
  title: 'Color Science and Management',
  level: 4,
  track: 'print',
  description: 'Advanced color management for press and digital output.',
};

describe('analyzeMaterial', () => {
  it('returns the parsed finding plus telemetry', async () => {
    const out = await analyzeMaterial({
      courseContext,
      fileName: 'rubric-press-check.pdf',
      extractedText: 'Students must hit a delta-E of ≤ 2.0 on the press check.',
    });
    expect(out.data.materialType).toBe('rubric');
    expect(out.data.competencies).toHaveLength(1);
    expect(out.telemetry.costUsdCents).toBe(7);
  });

  it('passes course context, fileName, and extractedText into the user message', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: fakeFinding,
      costUsdCents: 1,
      durationMs: 1,
      cachedTokens: 0,
      uncachedPromptTokens: 0,
      completionTokens: 0,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });

    await analyzeMaterial({
      courseContext,
      fileName: 'project-brief.docx',
      extractedText: 'Design a 4-color trade-show display.',
    });

    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.systemPrompt).toBe('ANALYZE SYSTEM PROMPT');
    expect(arg.userMessage).toContain('GC 4060');
    expect(arg.userMessage).toContain('project-brief.docx');
    expect(arg.userMessage).toContain('Design a 4-color trade-show display.');
  });

  it('uses the analyze-material prompt name', async () => {
    await analyzeMaterial({ courseContext, fileName: 'f.pdf', extractedText: 'text' });
    expect(loadPrompt).toHaveBeenCalledWith('analyze-material');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/ai/course-profile/analyze-material.test.ts`

Expected: FAIL with "Cannot find module '@/lib/ai/course-profile/analyze-material'"

- [ ] **Step 3: Implement `analyzeMaterial`**

Create `lib/ai/course-profile/analyze-material.ts`:

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
}

export async function analyzeMaterial({
  courseContext,
  fileName,
  extractedText,
}: AnalyzeMaterialArgs): Promise<{ data: AnalysisFinding; telemetry: CallTelemetry }> {
  const systemPrompt = await loadPrompt('analyze-material');
  const provider = getProvider();

  const userMessage = [
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/ai/course-profile/analyze-material.test.ts`

Expected: 3 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/course-profile/analyze-material.ts tests/ai/course-profile/analyze-material.test.ts
git commit -m "feat(course-profile): analyzeMaterial helper"
```

---

### Task 5: `synthesizeCourseProfile` helper

**Files:**
- Create: `lib/ai/course-profile/synthesize-course-profile.ts`
- Create: `tests/ai/course-profile/synthesize-course-profile.test.ts`

One synthesis call merges all per-file `AnalysisFinding` objects with the full catalog course record into a `CourseProfileResult`. The `findings` parameter includes `fileName` so the synthesis prompt can build evidence chains.

- [ ] **Step 1: Write the failing test**

Create `tests/ai/course-profile/synthesize-course-profile.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  loadPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { synthesizeCourseProfile } from '@/lib/ai/course-profile/synthesize-course-profile';

const fakeProfile = {
  summary: 'This course develops press-floor fluency.',
  learningObjectives: ['Operate an 8-color press through make-ready'],
  skills: ['Color management'],
  competencies: [
    {
      name: 'Press operation',
      description: 'Run a commercial press through make-ready.',
      level: 'developed',
      evidence: [{ fileName: 'rubric.pdf', quote: 'Student must complete a 10k-impression run.' }],
    },
  ],
  catalogDivergence: {
    reinforced: ['Color theory'],
    additions: ['Spectrophotometric measurement'],
    gaps: ['Bindery operations'],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('SYNTHESIZE SYSTEM PROMPT');
  getProvider.mockReturnValue({
    name: 'openai',
    model: 'gpt-5.4-mini',
    complete: vi.fn().mockResolvedValue({
      data: fakeProfile,
      costUsdCents: 15,
      durationMs: 500,
      cachedTokens: 100,
      uncachedPromptTokens: 400,
      completionTokens: 200,
    }),
  });
});

const course = {
  code: 'GC 4060',
  title: 'Color Science and Management',
  level: 4,
  track: 'print',
  description: 'Advanced color management.',
  learningObjectives: ['Understand color theory'],
  skillsRequired: ['Color management'],
};

const findings = [
  {
    fileName: 'rubric.pdf',
    finding: {
      materialType: 'rubric',
      competencies: [
        { name: 'Color management', description: 'Hit delta-E.', evidenceQuotes: ['delta-E ≤ 2.0'] },
      ],
      skills: ['Spectrophotometry'],
      notes: '',
    },
  },
];

describe('synthesizeCourseProfile', () => {
  it('returns the parsed profile plus telemetry', async () => {
    const out = await synthesizeCourseProfile({ course, findings });
    expect(out.data.summary).toContain('press-floor fluency');
    expect(out.data.catalogDivergence.additions).toContain('Spectrophotometric measurement');
    expect(out.telemetry.costUsdCents).toBe(15);
  });

  it('passes course fields and findings into the user message', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: fakeProfile,
      costUsdCents: 1,
      durationMs: 1,
      cachedTokens: 0,
      uncachedPromptTokens: 0,
      completionTokens: 0,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });

    await synthesizeCourseProfile({ course, findings });

    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.systemPrompt).toBe('SYNTHESIZE SYSTEM PROMPT');
    expect(arg.userMessage).toContain('GC 4060');
    expect(arg.userMessage).toContain('rubric.pdf');
    expect(arg.userMessage).toContain('delta-E ≤ 2.0');
    expect(arg.userMessage).toContain('Understand color theory');
  });

  it('uses the synthesize-course-profile prompt name', async () => {
    await synthesizeCourseProfile({ course, findings });
    expect(loadPrompt).toHaveBeenCalledWith('synthesize-course-profile');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/ai/course-profile/synthesize-course-profile.test.ts`

Expected: FAIL with "Cannot find module '@/lib/ai/course-profile/synthesize-course-profile'"

- [ ] **Step 3: Implement `synthesizeCourseProfile`**

Create `lib/ai/course-profile/synthesize-course-profile.ts`:

```typescript
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import {
  courseProfileResultSchema,
  courseProfileResultJsonSchema,
  type CourseProfileResult,
  type AnalysisFinding,
} from './schema';
import type { CallTelemetry } from '@/lib/ai/analyze/accum';

export interface SynthesisCourse {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  learningObjectives: string[];
  skillsRequired: string[];
}

export interface FindingWithFileName {
  fileName: string;
  finding: AnalysisFinding;
}

export interface SynthesizeCourseProfileArgs {
  course: SynthesisCourse;
  findings: FindingWithFileName[];
}

function formatFinding(f: FindingWithFileName, idx: number): string {
  const parts: string[] = [
    `### Material ${idx + 1}: ${f.fileName} (${f.finding.materialType})`,
  ];
  if (f.finding.competencies.length > 0) {
    parts.push('Competencies evidenced:');
    for (const c of f.finding.competencies) {
      parts.push(`- ${c.name}: ${c.description}`);
      for (const q of c.evidenceQuotes) {
        parts.push(`  Quote: "${q}"`);
      }
    }
  }
  if (f.finding.skills.length > 0) {
    parts.push(`Skills: ${f.finding.skills.join(', ')}`);
  }
  if (f.finding.notes.trim()) {
    parts.push(`Notes: ${f.finding.notes.trim()}`);
  }
  return parts.join('\n');
}

export async function synthesizeCourseProfile({
  course,
  findings,
}: SynthesizeCourseProfileArgs): Promise<{ data: CourseProfileResult; telemetry: CallTelemetry }> {
  const systemPrompt = await loadPrompt('synthesize-course-profile');
  const provider = getProvider();

  const userMessage = [
    `# Course context`,
    `Code: ${course.code}`,
    `Title: ${course.title}`,
    `Level: ${course.level}`,
    `Track: ${course.track}`,
    `Catalog description: ${course.description}`,
    ``,
    `Catalog learning objectives:`,
    course.learningObjectives.length > 0
      ? course.learningObjectives.map((o) => `- ${o}`).join('\n')
      : '(none)',
    ``,
    `Catalog skills required:`,
    course.skillsRequired.length > 0
      ? course.skillsRequired.map((s) => `- ${s}`).join('\n')
      : '(none)',
    ``,
    `# Per-file analysis findings (${findings.length} file${findings.length === 1 ? '' : 's'})`,
    ``,
    findings.map(formatFinding).join('\n\n'),
  ].join('\n');

  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'course_profile_result',
    jsonSchema: courseProfileResultJsonSchema,
    validate: (raw) => courseProfileResultSchema.parse(raw),
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/ai/course-profile/synthesize-course-profile.test.ts`

Expected: 3 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/course-profile/synthesize-course-profile.ts tests/ai/course-profile/synthesize-course-profile.test.ts
git commit -m "feat(course-profile): synthesizeCourseProfile helper"
```

---

## Phase D — DB queries module

### Task 6: Profile queries module

**Files:**
- Create: `lib/db/course-profile-queries.ts`
- Create: `lib/db/__tests__/course-profile-queries.test.ts`

Four operations: (1) cache an `analysisFinding` onto a `course_materials` row; (2) insert a `course_profile_runs` row; (3) upsert the current `course_profiles` row (handles first-analysis vs re-analysis); (4) read the latest run for a course + the current profile.

**Key constraint:** `course_materials`, `course_profiles`, and `course_profile_runs` tables are created by Plan 1's migration `0009` — they exist, do NOT add them here.

- [ ] **Step 1: Write the failing tests**

Create `lib/db/__tests__/course-profile-queries.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Drizzle db client. We capture the fluent chain calls and let each
// test control what the terminal promise resolves to.
const dbInsertReturning = vi.fn();
const dbUpdateWhere = vi.fn();
const dbSelectFromWhere = vi.fn();
const dbSelectFromWhereOrderByLimit = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: dbInsertReturning }) }),
    update: () => ({ set: () => ({ where: dbUpdateWhere }) }),
    select: () => ({
      from: () => ({
        where: dbSelectFromWhere,
      }),
    }),
  },
}));

// We need two different select() behaviors:
// - getLatestRunForCourse: select().from().where().orderBy().limit() -> one row
// - getCourseProfile: select().from().where() -> one row (no orderBy/limit)
// Override after import so individual tests can customize:
vi.mock('@/lib/db/schema', () => ({
  courseMaterials: {},
  courseProfiles: {},
  courseProfileRuns: {},
}));

import {
  cacheAnalysisFinding,
  insertProfileRun,
  upsertCourseProfile,
  getLatestRunForCourse,
  getCourseProfile,
} from '@/lib/db/course-profile-queries';
import type { CourseProfileResult } from '@/lib/ai/course-profile/schema';

beforeEach(() => {
  vi.clearAllMocks();
});

const fakeFinding = {
  materialType: 'rubric',
  competencies: [],
  skills: ['Color management'],
  notes: '',
};

const fakeProfile: CourseProfileResult = {
  summary: 'Develops press fluency.',
  learningObjectives: ['Operate a press'],
  skills: ['Color management'],
  competencies: [],
  catalogDivergence: { reinforced: [], additions: [], gaps: [] },
};

describe('cacheAnalysisFinding', () => {
  it('updates the course_materials row with the finding + model + cost', async () => {
    dbUpdateWhere.mockResolvedValue(undefined);
    await cacheAnalysisFinding({
      materialId: 'mat-uuid-1',
      finding: fakeFinding,
      model: 'gpt-5.4-mini',
      costUsdCents: 7,
    });
    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
  });
});

describe('insertProfileRun', () => {
  it('inserts a run row and returns the new id', async () => {
    dbInsertReturning.mockResolvedValue([{ id: 'run-uuid-1' }]);
    const id = await insertProfileRun({
      courseCode: 'GC 4060',
      result: fakeProfile,
      materialCount: 2,
      model: 'gpt-5.4-mini',
      costUsdCents: 42,
    });
    expect(id).toBe('run-uuid-1');
    expect(dbInsertReturning).toHaveBeenCalledTimes(1);
  });

  it('throws when no row is returned', async () => {
    dbInsertReturning.mockResolvedValue([]);
    await expect(
      insertProfileRun({ courseCode: 'GC 4060', result: fakeProfile, materialCount: 1, model: 'gpt', costUsdCents: 5 })
    ).rejects.toThrow('insertProfileRun: no row returned');
  });
});

describe('upsertCourseProfile', () => {
  it('calls insert on first-analysis (no existing row)', async () => {
    // Simulate: no existing profile found
    dbSelectFromWhere.mockResolvedValue([]);
    dbInsertReturning.mockResolvedValue([{}]);
    await upsertCourseProfile({
      courseCode: 'GC 4060',
      result: fakeProfile,
      runId: 'run-uuid-1',
    });
    expect(dbInsertReturning).toHaveBeenCalledTimes(1);
    expect(dbUpdateWhere).not.toHaveBeenCalled();
  });

  it('calls update on re-analysis (existing row found)', async () => {
    // Simulate: existing profile found
    dbSelectFromWhere.mockResolvedValue([{ courseCode: 'GC 4060' }]);
    dbUpdateWhere.mockResolvedValue(undefined);
    await upsertCourseProfile({
      courseCode: 'GC 4060',
      result: fakeProfile,
      runId: 'run-uuid-2',
    });
    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
    expect(dbInsertReturning).not.toHaveBeenCalled();
  });
});

describe('getLatestRunForCourse', () => {
  it('returns null when no runs exist', async () => {
    // getLatestRunForCourse uses a longer chain: .orderBy().limit()
    // We override db.select for this test by reassigning the mock behavior.
    dbSelectFromWhere.mockReturnValue({
      orderBy: () => ({ limit: () => Promise.resolve([]) }),
    });
    const result = await getLatestRunForCourse('GC 4060');
    expect(result).toBeNull();
  });

  it('returns the run row when one exists', async () => {
    const row = {
      id: 'run-uuid-1',
      courseCode: 'GC 4060',
      result: fakeProfile,
      materialCount: 2,
      model: 'gpt-5.4-mini',
      costUsdCents: 42,
      createdAt: new Date('2026-05-20T10:00:00Z'),
    };
    dbSelectFromWhere.mockReturnValue({
      orderBy: () => ({ limit: () => Promise.resolve([row]) }),
    });
    const result = await getLatestRunForCourse('GC 4060');
    expect(result?.id).toBe('run-uuid-1');
    expect(result?.materialCount).toBe(2);
  });
});

describe('getCourseProfile', () => {
  it('returns null when no profile exists', async () => {
    dbSelectFromWhere.mockResolvedValue([]);
    const result = await getCourseProfile('GC 4060');
    expect(result).toBeNull();
  });

  it('returns the profile row when it exists', async () => {
    const row = {
      courseCode: 'GC 4060',
      summary: 'Develops press fluency.',
      learningObjectives: ['Operate a press'],
      skills: ['Color management'],
      competencies: [],
      catalogDivergence: { reinforced: [], additions: [], gaps: [] },
      sourceRunId: 'run-uuid-1',
      manuallyEdited: false,
      updatedAt: new Date('2026-05-20T10:00:00Z'),
    };
    dbSelectFromWhere.mockResolvedValue([row]);
    const result = await getCourseProfile('GC 4060');
    expect(result?.courseCode).toBe('GC 4060');
    expect(result?.manuallyEdited).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/db/__tests__/course-profile-queries.test.ts`

Expected: FAIL with "Cannot find module '@/lib/db/course-profile-queries'"

- [ ] **Step 3: Implement the queries module**

Create `lib/db/course-profile-queries.ts`:

```typescript
import { eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials, courseProfiles, courseProfileRuns } from '@/lib/db/schema';
import type { AnalysisFinding, CourseProfileResult } from '@/lib/ai/course-profile/schema';

// ── Cache a per-file finding onto course_materials ───────────────────────────

export interface CacheAnalysisFindingInput {
  materialId: string;
  finding: AnalysisFinding;
  model: string;
  costUsdCents: number;
}

export async function cacheAnalysisFinding({
  materialId,
  finding,
  model,
  costUsdCents,
}: CacheAnalysisFindingInput): Promise<void> {
  await db
    .update(courseMaterials)
    .set({ analysisFinding: finding, analysisModel: model, analysisCostUsdCents: costUsdCents })
    .where(eq(courseMaterials.id, materialId));
}

// ── Insert an immutable history row ─────────────────────────────────────────

export interface InsertProfileRunInput {
  courseCode: string;
  result: CourseProfileResult;
  materialCount: number;
  model: string;
  costUsdCents: number;
}

export async function insertProfileRun({
  courseCode,
  result,
  materialCount,
  model,
  costUsdCents,
}: InsertProfileRunInput): Promise<string> {
  const [row] = await db
    .insert(courseProfileRuns)
    .values({ courseCode, result, materialCount, model, costUsdCents })
    .returning({ id: courseProfileRuns.id });
  if (!row) throw new Error('insertProfileRun: no row returned');
  return row.id;
}

// ── Upsert the current editable profile ─────────────────────────────────────

export interface UpsertCourseProfileInput {
  courseCode: string;
  result: CourseProfileResult;
  runId: string;
}

export async function upsertCourseProfile({
  courseCode,
  result,
  runId,
}: UpsertCourseProfileInput): Promise<void> {
  const existing = await db
    .select()
    .from(courseProfiles)
    .where(eq(courseProfiles.courseCode, courseCode));

  if (existing.length === 0) {
    // First analysis — create the row.
    await db
      .insert(courseProfiles)
      .values({
        courseCode,
        summary: result.summary,
        learningObjectives: result.learningObjectives,
        skills: result.skills,
        competencies: result.competencies,
        catalogDivergence: result.catalogDivergence,
        sourceRunId: runId,
        manuallyEdited: false,
        updatedAt: new Date(),
      })
      .returning();
  } else {
    // Re-analysis — overwrite content, reset manuallyEdited, update sourceRunId.
    await db
      .update(courseProfiles)
      .set({
        summary: result.summary,
        learningObjectives: result.learningObjectives,
        skills: result.skills,
        competencies: result.competencies,
        catalogDivergence: result.catalogDivergence,
        sourceRunId: runId,
        manuallyEdited: false,
        updatedAt: new Date(),
      })
      .where(eq(courseProfiles.courseCode, courseCode));
  }
}

// ── Read helpers ─────────────────────────────────────────────────────────────

export async function getLatestRunForCourse(courseCode: string) {
  const rows = await db
    .select()
    .from(courseProfileRuns)
    .where(eq(courseProfileRuns.courseCode, courseCode))
    .orderBy(desc(courseProfileRuns.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCourseProfile(courseCode: string) {
  const rows = await db
    .select()
    .from(courseProfiles)
    .where(eq(courseProfiles.courseCode, courseCode));
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/db/__tests__/course-profile-queries.test.ts`

Expected: 8 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add lib/db/course-profile-queries.ts lib/db/__tests__/course-profile-queries.test.ts
git commit -m "feat(db): course-profile-queries — cache finding, insert run, upsert profile, read helpers"
```

---

## Phase E — Route

### Task 7: `POST /api/courses/[code]/analyze-materials` route

**Files:**
- Create: `app/api/courses/[code]/analyze-materials/route.ts`
- Create: `tests/api/analyze-materials.test.ts`

This route orchestrates: guard → fetch materials → per-file analysis (parallel, skipping cached) → synthesis → persist run → upsert profile → record spend. Zero readable files → 400. Synthesis failure keeps cached per-file findings (retry is cheap).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/analyze-materials.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist all mocks before any imports ───────────────────────────────────────

const { applyAnalyzeGuards } = vi.hoisted(() => ({ applyAnalyzeGuards: vi.fn() }));
vi.mock('@/lib/ai/analyze/guards', () => ({ applyAnalyzeGuards }));

const { checkDailyCap, recordSpend } = vi.hoisted(() => ({
  checkDailyCap: vi.fn(),
  recordSpend: vi.fn(),
}));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap, recordSpend }));

const { isValidSlug } = vi.hoisted(() => ({ isValidSlug: vi.fn() }));
vi.mock('@/lib/slug', () => ({ isValidSlug }));

const { getCourseByCode } = vi.hoisted(() => ({ getCourseByCode: vi.fn() }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode }));

const { listMaterialsByCourse } = vi.hoisted(() => ({ listMaterialsByCourse: vi.fn() }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse }));

const { analyzeMaterial } = vi.hoisted(() => ({ analyzeMaterial: vi.fn() }));
vi.mock('@/lib/ai/course-profile/analyze-material', () => ({ analyzeMaterial }));

const { synthesizeCourseProfile } = vi.hoisted(() => ({ synthesizeCourseProfile: vi.fn() }));
vi.mock('@/lib/ai/course-profile/synthesize-course-profile', () => ({ synthesizeCourseProfile }));

const { cacheAnalysisFinding, insertProfileRun, upsertCourseProfile, getLatestRunForCourse } = vi.hoisted(
  () => ({
    cacheAnalysisFinding: vi.fn(),
    insertProfileRun: vi.fn(),
    upsertCourseProfile: vi.fn(),
    getLatestRunForCourse: vi.fn(),
  })
);
vi.mock('@/lib/db/course-profile-queries', () => ({
  cacheAnalysisFinding,
  insertProfileRun,
  upsertCourseProfile,
  getLatestRunForCourse,
}));

const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));

// ── Import under test ─────────────────────────────────────────────────────────

import { POST } from '@/app/api/courses/[code]/analyze-materials/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(slug = 'valid-slug-12345'): Request {
  return new Request(`http://test/api/courses/GC%204060/analyze-materials?slug=${slug}`, {
    method: 'POST',
  });
}

const ctx = { params: Promise.resolve({ code: 'GC 4060' }) };

const fakeCourse = {
  code: 'GC 4060',
  title: 'Color Science',
  level: 4,
  track: 'print',
  description: 'Advanced color.',
  learningObjectives: ['Understand color theory'],
  skillsRequired: ['Color management'],
};

const fakeMaterialOk = {
  id: 'mat-1',
  fileName: 'rubric.pdf',
  extractedText: 'delta-E ≤ 2.0',
  extractionStatus: 'ok',
  analysisFinding: null,
  analysisModel: null,
  analysisCostUsdCents: null,
};

const fakeMaterialCached = {
  id: 'mat-2',
  fileName: 'worksheet.pdf',
  extractedText: 'some text',
  extractionStatus: 'ok',
  analysisFinding: { materialType: 'worksheet', competencies: [], skills: [], notes: '' },
  analysisModel: 'gpt-5.4-mini',
  analysisCostUsdCents: 5,
};

const fakeProfile = {
  summary: 'Develops press fluency.',
  learningObjectives: ['Operate a press'],
  skills: ['Color management'],
  competencies: [],
  catalogDivergence: { reinforced: [], additions: [], gaps: [] },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  isValidSlug.mockReturnValue(true);
  applyAnalyzeGuards.mockResolvedValue({ short: null, ipHash: 'abc123' });
  checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0 });
  recordSpend.mockResolvedValue(undefined);
  getCourseByCode.mockResolvedValue(fakeCourse);
  getLatestRunForCourse.mockResolvedValue(null);
  insertProfileRun.mockResolvedValue('run-uuid-1');
  upsertCourseProfile.mockResolvedValue(undefined);
  cacheAnalysisFinding.mockResolvedValue(undefined);
  getProvider.mockReturnValue({ name: 'openai', model: 'gpt-5.4-mini' });
});

describe('POST /api/courses/[code]/analyze-materials', () => {
  it('401s when slug is invalid', async () => {
    isValidSlug.mockReturnValue(false);
    const res = await POST(makeReq('bad-slug'), ctx);
    expect(res.status).toBe(401);
  });

  it('404s when course does not exist', async () => {
    getCourseByCode.mockResolvedValue(null);
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(404);
  });

  it('returns the guard short-circuit response when rate-limited', async () => {
    const { NextResponse } = await import('next/server');
    applyAnalyzeGuards.mockResolvedValue({
      short: NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 }),
      ipHash: '',
    });
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(429);
  });

  it('400s when there are zero readable (ok) materials', async () => {
    listMaterialsByCourse.mockResolvedValue([]);
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/no readable/i);
  });

  it('400s when all materials have non-ok extraction status', async () => {
    listMaterialsByCourse.mockResolvedValue([
      { ...fakeMaterialOk, extractionStatus: 'failed', analysisFinding: null },
    ]);
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(400);
  });

  it('skips materials that already have a cached analysisFinding', async () => {
    listMaterialsByCourse.mockResolvedValue([fakeMaterialCached]);
    synthesizeCourseProfile.mockResolvedValue({
      data: fakeProfile,
      telemetry: { costUsdCents: 15, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
    });
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(200);
    expect(analyzeMaterial).not.toHaveBeenCalled();
  });

  it('runs per-file analysis for uncached materials and synthesizes', async () => {
    listMaterialsByCourse.mockResolvedValue([fakeMaterialOk]);
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
    expect(analyzeMaterial).toHaveBeenCalledTimes(1);
    expect(synthesizeCourseProfile).toHaveBeenCalledTimes(1);
    expect(cacheAnalysisFinding).toHaveBeenCalledWith(
      expect.objectContaining({ materialId: 'mat-1', costUsdCents: 7 })
    );
    expect(insertProfileRun).toHaveBeenCalledTimes(1);
    expect(upsertCourseProfile).toHaveBeenCalledTimes(1);
    expect(recordSpend).toHaveBeenCalledWith(22); // 7 + 15
  });

  it('returns runId and totalCostUsdCents in the 200 body', async () => {
    listMaterialsByCourse.mockResolvedValue([fakeMaterialOk]);
    analyzeMaterial.mockResolvedValue({
      data: { materialType: 'rubric', competencies: [], skills: [], notes: '' },
      telemetry: { costUsdCents: 10, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
    });
    synthesizeCourseProfile.mockResolvedValue({
      data: fakeProfile,
      telemetry: { costUsdCents: 20, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
    });

    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.runId).toBe('run-uuid-1');
    expect(json.totalCostUsdCents).toBe(30);
  });

  it('500s when synthesis throws, keeping cached per-file findings intact', async () => {
    listMaterialsByCourse.mockResolvedValue([fakeMaterialOk]);
    analyzeMaterial.mockResolvedValue({
      data: { materialType: 'rubric', competencies: [], skills: [], notes: '' },
      telemetry: { costUsdCents: 7, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
    });
    synthesizeCourseProfile.mockRejectedValue(new Error('OpenAI error'));

    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(500);
    // Per-file findings were still cached before synthesis threw
    expect(cacheAnalysisFinding).toHaveBeenCalledTimes(1);
    expect(insertProfileRun).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/api/analyze-materials.test.ts`

Expected: FAIL with "Cannot find module '@/app/api/courses/[code]/analyze-materials/route'"

- [ ] **Step 3: Implement the route**

Create `app/api/courses/[code]/analyze-materials/route.ts`:

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

  // Only analyze materials with extractionStatus = 'ok'
  const readableMaterials = allMaterials.filter((m) => m.extractionStatus === 'ok');
  if (readableMaterials.length === 0) {
    return NextResponse.json(
      { error: 'no readable materials — upload files and wait for extraction to succeed before analyzing' },
      { status: 400 }
    );
  }

  // 5. Per-file analysis in parallel, skipping cached findings
  const courseContext = {
    code: course.code,
    title: course.title,
    level: course.level,
    track: course.track,
    description: course.description,
  };

  let totalCostUsdCents = 0;

  // Separate cached from uncached
  const uncachedMaterials = readableMaterials.filter((m) => m.analysisFinding === null);
  const cachedMaterials = readableMaterials.filter((m) => m.analysisFinding !== null);

  // Run per-file analysis in parallel for uncached materials
  const newFindingResults = await Promise.all(
    uncachedMaterials.map((m) =>
      analyzeMaterial({
        courseContext,
        fileName: m.fileName,
        extractedText: m.extractedText ?? '',
      })
    )
  );

  // Cache the new findings and accumulate costs
  await Promise.all(
    uncachedMaterials.map(async (m, i) => {
      const result = newFindingResults[i];
      if (!result) return;
      totalCostUsdCents += result.telemetry.costUsdCents;
      await cacheAnalysisFinding({
        materialId: m.id,
        finding: result.data,
        model: getProvider().model,
        costUsdCents: result.telemetry.costUsdCents,
      });
    })
  );

  // Assemble all findings (cached + newly computed) for synthesis
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

  // 6. Synthesis call — if this throws, cached per-file findings are kept
  const synthesisResult = await synthesizeCourseProfile({
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

  totalCostUsdCents += synthesisResult.telemetry.costUsdCents;

  // 7. Persist — insert run history row, then upsert current profile
  const runId = await insertProfileRun({
    courseCode: decoded,
    result: synthesisResult.data,
    materialCount: readableMaterials.length,
    model: getProvider().model,
    costUsdCents: totalCostUsdCents,
  });

  await upsertCourseProfile({
    courseCode: decoded,
    result: synthesisResult.data,
    runId,
  });

  // 8. Record spend
  await recordSpend(totalCostUsdCents);

  return NextResponse.json({
    runId,
    totalCostUsdCents,
    materialCount: readableMaterials.length,
    newlyAnalyzed: uncachedMaterials.length,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/api/analyze-materials.test.ts`

Expected: 9 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add "app/api/courses/[code]/analyze-materials/route.ts" tests/api/analyze-materials.test.ts
git commit -m "feat(course-profile): POST /api/courses/[code]/analyze-materials route"
```

---

## Phase F — UI components

### Task 8: `CourseAnalyzeZone` component

**Files:**
- Create: `components/CourseAnalyzeZone.tsx`
- Create: `tests/components/CourseAnalyzeZone.test.tsx`

A client component rendered by the per-course page. Renders the "Analyze materials" button (disabled when no `okCount`), shows the last-run date/file-count/cost when a run exists, and shows a warning when `manuallyEdited` is true.

- [ ] **Step 1: Write the failing test**

Create `tests/components/CourseAnalyzeZone.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CourseAnalyzeZone } from '@/components/CourseAnalyzeZone';

// Mock fetch
global.fetch = vi.fn();

const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

const baseProps = {
  slug: 'valid-slug-12345',
  courseCode: 'GC 4060',
  okCount: 2,
  lastRun: null,
  manuallyEdited: false,
  onAnalyzed: vi.fn(),
};

describe('CourseAnalyzeZone', () => {
  it('renders an enabled Analyze button when okCount > 0', () => {
    render(<CourseAnalyzeZone {...baseProps} />);
    const btn = screen.getByRole('button', { name: /analyze materials/i });
    expect(btn).not.toBeDisabled();
  });

  it('renders a disabled Analyze button when okCount is 0', () => {
    render(<CourseAnalyzeZone {...baseProps} okCount={0} />);
    const btn = screen.getByRole('button', { name: /analyze materials/i });
    expect(btn).toBeDisabled();
  });

  it('shows last-run metadata when lastRun is provided', () => {
    render(
      <CourseAnalyzeZone
        {...baseProps}
        lastRun={{ id: 'run-1', createdAt: '2026-05-20T10:00:00Z', materialCount: 3, costUsdCents: 42 }}
      />
    );
    expect(screen.getByText(/3 files/i)).toBeTruthy();
    expect(screen.getByText(/42/)).toBeTruthy(); // cost in cents displayed
  });

  it('shows the overwrite warning when manuallyEdited is true', () => {
    render(<CourseAnalyzeZone {...baseProps} manuallyEdited={true} />);
    expect(screen.getByText(/your edits will be replaced/i)).toBeTruthy();
  });

  it('does not show the overwrite warning when manuallyEdited is false', () => {
    render(<CourseAnalyzeZone {...baseProps} manuallyEdited={false} />);
    expect(screen.queryByText(/your edits will be replaced/i)).toBeNull();
  });

  it('calls the analyze endpoint on button click and invokes onAnalyzed on success', async () => {
    const onAnalyzed = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ runId: 'run-1', totalCostUsdCents: 22, materialCount: 1, newlyAnalyzed: 1 }),
    } as Response);

    render(<CourseAnalyzeZone {...baseProps} onAnalyzed={onAnalyzed} />);
    fireEvent.click(screen.getByRole('button', { name: /analyze materials/i }));

    await waitFor(() => expect(onAnalyzed).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/courses/GC%204060/analyze-materials'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('shows an error message when the fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'no readable materials' }),
    } as Response);

    render(<CourseAnalyzeZone {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /analyze materials/i }));

    await waitFor(() => expect(screen.getByText(/no readable materials/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/CourseAnalyzeZone.test.tsx`

Expected: FAIL with "Cannot find module '@/components/CourseAnalyzeZone'"

- [ ] **Step 3: Implement `CourseAnalyzeZone`**

Create `components/CourseAnalyzeZone.tsx`:

```typescript
'use client';

import { useState } from 'react';

export interface LastRunMeta {
  id: string;
  createdAt: string;  // ISO string
  materialCount: number;
  costUsdCents: number;
}

export interface CourseAnalyzeZoneProps {
  slug: string;
  courseCode: string;
  okCount: number;
  lastRun: LastRunMeta | null;
  manuallyEdited: boolean;
  onAnalyzed: () => void;
}

export function CourseAnalyzeZone({
  slug,
  courseCode,
  okCount,
  lastRun,
  manuallyEdited,
  onAnalyzed,
}: CourseAnalyzeZoneProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const encoded = encodeURIComponent(courseCode);
      const res = await fetch(`/api/courses/${encoded}/analyze-materials?slug=${slug}`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'Analysis failed');
        return;
      }
      onAnalyzed();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5 space-y-3">
      <h2 className="text-base font-semibold">Analyze</h2>

      {manuallyEdited && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Your edits will be replaced by the new analysis. Previous versions are preserved in history.
        </p>
      )}

      {lastRun && (
        <div className="text-sm text-muted-foreground space-y-0.5">
          <p>
            Last run:{' '}
            <time dateTime={lastRun.createdAt}>
              {new Date(lastRun.createdAt).toLocaleString()}
            </time>
          </p>
          <p>{lastRun.materialCount} files &middot; {lastRun.costUsdCents}¢</p>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <button
        type="button"
        disabled={okCount === 0 || loading}
        onClick={handleAnalyze}
        className="inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Analyzing…' : 'Analyze materials'}
      </button>

      {okCount === 0 && (
        <p className="text-xs text-muted-foreground">
          Upload files and wait for extraction before analyzing.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/components/CourseAnalyzeZone.test.tsx`

Expected: 7 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add components/CourseAnalyzeZone.tsx tests/components/CourseAnalyzeZone.test.tsx
git commit -m "feat(course-profile): CourseAnalyzeZone client component"
```

---

### Task 9: `CourseProfileDisplay` component

**Files:**
- Create: `components/CourseProfileDisplay.tsx`
- Create: `tests/components/CourseProfileDisplay.test.tsx`

A read-only display component for the course profile. Shows `summary`, `learningObjectives`, `skills`, `competencies` (with `evidence` quotes), and a `catalogDivergence` panel. Pure presentational — no state, no fetching.

- [ ] **Step 1: Write the failing test**

Create `tests/components/CourseProfileDisplay.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CourseProfileDisplay } from '@/components/CourseProfileDisplay';
import type { CourseProfileResult } from '@/lib/ai/course-profile/schema';

const profile: CourseProfileResult = {
  summary: 'Develops press-floor fluency through high-stakes assignments.',
  learningObjectives: [
    'Operate an 8-color press through make-ready and a 10k-impression run.',
    'Identify and resolve color deviation using spectrophotometric data.',
  ],
  skills: ['Spectrophotometry', 'Pantone Live', 'ICC profile generation'],
  competencies: [
    {
      name: 'Color management',
      description: 'Hit delta-E ≤ 2.0 on a live press check.',
      level: 'developed',
      evidence: [
        { fileName: 'rubric.pdf', quote: 'Student must achieve delta-E of ≤ 2.0 on the press check.' },
      ],
    },
  ],
  catalogDivergence: {
    reinforced: ['Color theory'],
    additions: ['Spectrophotometric measurement'],
    gaps: ['Bindery operations'],
  },
};

describe('CourseProfileDisplay', () => {
  it('renders the summary text', () => {
    render(<CourseProfileDisplay profile={profile} />);
    expect(screen.getByText(/develops press-floor fluency/i)).toBeTruthy();
  });

  it('renders all learning objectives', () => {
    render(<CourseProfileDisplay profile={profile} />);
    expect(screen.getByText(/operate an 8-color press/i)).toBeTruthy();
    expect(screen.getByText(/spectrophotometric data/i)).toBeTruthy();
  });

  it('renders all skills', () => {
    render(<CourseProfileDisplay profile={profile} />);
    expect(screen.getByText('Spectrophotometry')).toBeTruthy();
    expect(screen.getByText('Pantone Live')).toBeTruthy();
  });

  it('renders competencies with name, level, and evidence', () => {
    render(<CourseProfileDisplay profile={profile} />);
    expect(screen.getByText('Color management')).toBeTruthy();
    expect(screen.getByText(/developed/i)).toBeTruthy();
    expect(screen.getByText(/delta-E of ≤ 2\.0/i)).toBeTruthy();
    expect(screen.getByText(/rubric\.pdf/i)).toBeTruthy();
  });

  it('renders the catalogDivergence panel with all three sections', () => {
    render(<CourseProfileDisplay profile={profile} />);
    expect(screen.getByText(/catalog divergence/i)).toBeTruthy();
    expect(screen.getByText('Color theory')).toBeTruthy();
    expect(screen.getByText('Spectrophotometric measurement')).toBeTruthy();
    expect(screen.getByText('Bindery operations')).toBeTruthy();
  });

  it('renders a placeholder when no profile is provided', () => {
    render(<CourseProfileDisplay profile={null} />);
    expect(screen.getByText(/no profile yet/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/CourseProfileDisplay.test.tsx`

Expected: FAIL with "Cannot find module '@/components/CourseProfileDisplay'"

- [ ] **Step 3: Implement `CourseProfileDisplay`**

Create `components/CourseProfileDisplay.tsx`:

```typescript
import type { CourseProfileResult } from '@/lib/ai/course-profile/schema';

interface Props {
  profile: CourseProfileResult | null;
}

export function CourseProfileDisplay({ profile }: Props) {
  if (!profile) {
    return (
      <section className="rounded-lg border bg-card p-5 space-y-2">
        <h2 className="text-base font-semibold">Profile</h2>
        <p className="text-sm text-muted-foreground">No profile yet — analyze materials to generate one.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border bg-card p-5 space-y-6">
      <h2 className="text-base font-semibold">Profile</h2>

      {/* Summary */}
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Summary</h3>
        <p className="text-sm leading-relaxed">{profile.summary}</p>
      </div>

      {/* Learning objectives */}
      {profile.learningObjectives.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Learning Objectives
          </h3>
          <ul className="space-y-1 text-sm list-disc list-inside">
            {profile.learningObjectives.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Skills */}
      {profile.skills.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Skills</h3>
          <div className="flex flex-wrap gap-1.5">
            {profile.skills.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Competencies */}
      {profile.competencies.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Competencies
          </h3>
          <div className="space-y-4">
            {profile.competencies.map((c, i) => (
              <div key={i} className="rounded-md border p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold">{c.name}</h4>
                  <span className="shrink-0 text-xs text-muted-foreground rounded-full border px-2 py-0.5">
                    {c.level}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{c.description}</p>
                {c.evidence.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {c.evidence.map((ev, j) => (
                      <blockquote
                        key={j}
                        className="border-l-2 border-muted pl-3 text-xs text-muted-foreground italic"
                      >
                        &ldquo;{ev.quote}&rdquo;
                        <span className="not-italic ml-1 text-muted-foreground/60">— {ev.fileName}</span>
                      </blockquote>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Catalog divergence (read-only) */}
      <div className="space-y-2 rounded-md border bg-muted/30 p-4">
        <h3 className="text-sm font-medium">Catalog Divergence</h3>
        <p className="text-xs text-muted-foreground">
          How real assignments compare to what the catalog says this course covers.
        </p>
        <div className="grid gap-3 sm:grid-cols-3 mt-2">
          <DivergenceColumn label="Reinforced" items={profile.catalogDivergence.reinforced} accent="green" />
          <DivergenceColumn label="Additions" items={profile.catalogDivergence.additions} accent="blue" />
          <DivergenceColumn label="Gaps" items={profile.catalogDivergence.gaps} accent="amber" />
        </div>
      </div>
    </section>
  );
}

function DivergenceColumn({
  label,
  items,
  accent,
}: {
  label: string;
  items: string[];
  accent: 'green' | 'blue' | 'amber';
}) {
  const accentClass = {
    green: 'text-green-700 dark:text-green-400',
    blue: 'text-blue-700 dark:text-blue-400',
    amber: 'text-amber-700 dark:text-amber-400',
  }[accent];

  return (
    <div className="space-y-1">
      <p className={`text-xs font-semibold uppercase tracking-wide ${accentClass}`}>{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None identified.</p>
      ) : (
        <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/components/CourseProfileDisplay.test.tsx`

Expected: 6 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add components/CourseProfileDisplay.tsx tests/components/CourseProfileDisplay.test.tsx
git commit -m "feat(course-profile): CourseProfileDisplay read-only component"
```

---

## Phase G — Wire into the per-course page

### Task 10: Add "Analyze" and "Profile" zones to the per-course page

**Files:**
- Modify: `app/preview/[slug]/courses/[code]/page.tsx`

The per-course page is a server component created by Plan 1. It already renders the "Materials" zone. This task appends two more zones below it. The page fetches the latest run and current profile from DB, then renders `CourseAnalyzeZone` (client) and `CourseProfileDisplay` (server-renderable).

**Read the file before editing.** The exact current content of the file is unknown to this plan (it was created by Plan 1). Read it first to understand the existing structure, then append the two new zones.

- [ ] **Step 1: Read the current file**

Run: `cat "app/preview/[slug]/courses/[code]/page.tsx"`

Verify: the file exists, the component renders the Materials zone, and you can see where to append.

- [ ] **Step 2: Import the new queries and components**

Open `app/preview/[slug]/courses/[code]/page.tsx`. At the top of the import block, add:

```typescript
import { getLatestRunForCourse, getCourseProfile } from '@/lib/db/course-profile-queries';
import { CourseAnalyzeZone } from '@/components/CourseAnalyzeZone';
import { CourseProfileDisplay } from '@/components/CourseProfileDisplay';
import type { CourseProfileResult } from '@/lib/ai/course-profile/schema';
```

- [ ] **Step 3: Fetch run and profile data in the server component**

Inside the server component function body (alongside the existing data fetches for the Materials zone), add parallel fetches for the latest run and current profile. The exact location depends on Plan 1's implementation — add them near where other DB queries are called. Example:

```typescript
const [materials, latestRun, currentProfile] = await Promise.all([
  listMaterialsByCourse(decoded),     // already present from Plan 1
  getLatestRunForCourse(decoded),
  getCourseProfile(decoded),
]);
```

If Plan 1 already calls `listMaterialsByCourse` without `Promise.all`, replace that pattern with the parallel form above.

- [ ] **Step 4: Compute derived props for `CourseAnalyzeZone`**

After the data fetches, compute:

```typescript
const okCount = materials.filter((m) => m.extractionStatus === 'ok').length;
const manuallyEdited = currentProfile?.manuallyEdited ?? false;
const lastRunMeta = latestRun
  ? {
      id: latestRun.id,
      createdAt: latestRun.createdAt.toISOString(),
      materialCount: latestRun.materialCount,
      costUsdCents: latestRun.costUsdCents,
    }
  : null;
const profileResult = currentProfile
  ? (currentProfile.competencies !== undefined
      ? (currentProfile as unknown as { summary: string; learningObjectives: string[]; skills: string[]; competencies: unknown[]; catalogDivergence: { reinforced: string[]; additions: string[]; gaps: string[] } }) as CourseProfileResult
      : null)
  : null;
```

- [ ] **Step 5: Append the two zones to the JSX return**

Find the closing tag of the Materials zone section in the JSX. Immediately after it (still inside the outer `<main>` or wrapper element), add:

```tsx
<CourseAnalyzeZone
  slug={slug}
  courseCode={decoded}
  okCount={okCount}
  lastRun={lastRunMeta}
  manuallyEdited={manuallyEdited}
  onAnalyzed={() => { /* server component — refresh is handled by the client */ }}
/>

<CourseProfileDisplay profile={profileResult} />
```

**Note:** Because `CourseAnalyzeZone` is `'use client'` and `onAnalyzed` needs to trigger a page reload after analysis completes, `onAnalyzed` in the server component context must be a no-op placeholder. The client component will handle the refresh via `router.refresh()` — update `CourseAnalyzeZone.tsx` in the next sub-step to call `router.refresh()` from `next/navigation` inside `onAnalyzed` when used in a real Next.js context.

- [ ] **Step 6: Update `CourseAnalyzeZone` to call `router.refresh()` after analysis**

Open `components/CourseAnalyzeZone.tsx`. Add the `useRouter` import and call `router.refresh()` at the end of `handleAnalyze` before calling `onAnalyzed()`:

```typescript
import { useRouter } from 'next/navigation';

// Inside CourseAnalyzeZone function body:
const router = useRouter();

// At the end of the success branch in handleAnalyze:
router.refresh();
onAnalyzed();
```

The full updated `handleAnalyze` success branch becomes:

```typescript
const json = await res.json();
if (!res.ok) {
  setError((json as { error?: string }).error ?? 'Analysis failed');
  return;
}
router.refresh();
onAnalyzed();
```

- [ ] **Step 7: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors. If the `profileResult` cast is too loose, adjust the cast to use the schema's inferred type directly (Plan 1's DB columns for `course_profiles` will be typed by Drizzle's inference).

- [ ] **Step 8: Run all tests to confirm nothing regressed**

Run: `pnpm test`

Expected: all passing. Note: component tests for `CourseAnalyzeZone` will still pass because they mock `fetch` not `useRouter` — add a `vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))` to `tests/components/CourseAnalyzeZone.test.tsx` if the test runner complains about the new import.

- [ ] **Step 9: Update `CourseAnalyzeZone` test to mock `useRouter`**

Open `tests/components/CourseAnalyzeZone.test.tsx`. Add before the import of the component:

```typescript
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
```

Run: `pnpm test tests/components/CourseAnalyzeZone.test.tsx`

Expected: 7 passing.

- [ ] **Step 10: Commit**

```bash
git add "app/preview/[slug]/courses/[code]/page.tsx" components/CourseAnalyzeZone.tsx tests/components/CourseAnalyzeZone.test.tsx
git commit -m "feat(course-profile): wire Analyze + Profile zones into per-course page"
```

---

## Final verification

- [ ] **Full test suite**

Run: `pnpm test`

Expected: all tests pass. Zero failures.

- [ ] **Full tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Manual smoke test (if running locally)**

Start the dev server: `pnpm dev`

Navigate to `/preview/<PROTOTYPE_SLUG>/courses/GC 4060` (URL-encoded: `/preview/<slug>/courses/GC%204060`).

Verify:
1. The page loads with the Materials zone (Plan 1's output), the Analyze zone, and the Profile zone.
2. The "Analyze materials" button is disabled when no `ok` files exist.
3. With at least one `ok` file, clicking "Analyze materials" calls the route and the page refreshes with the profile.
4. A second analyze run shows the "Your edits will be replaced" warning only after a profile has been manually edited (via Plan 3's editor — not testable until Plan 3).

---

## Self-Review

### File path and import consistency

- DB queries module is at **`lib/db/course-profile-queries.ts`** (consistent with Plan 1's `lib/db/course-materials-queries.ts` convention — located in `lib/db/`, not under `lib/ai/course-profile/`). All imports throughout this plan use `@/lib/db/course-profile-queries`.
- Test file is at **`lib/db/__tests__/course-profile-queries.test.ts`**, not `tests/ai/course-profile/queries.test.ts`.
- The queries module imports types from `@/lib/ai/course-profile/schema` (via absolute alias) — `schema.ts`, `analyze-material.ts`, and `synthesize-course-profile.ts` remain under `lib/ai/course-profile/` unchanged.

### Plan 1 boundary contract

- Plan 2 calls **`listMaterialsByCourse(courseCode)`** from `@/lib/db/course-materials-queries` — matching the function name Plan 1 actually exports in Task 3 (the query lists materials ordered by `uploadedAt`).
- Plan 2's Task 10 `Promise.all` fetches `listMaterialsByCourse(decoded)`, `getLatestRunForCourse(decoded)`, `getCourseProfile(decoded)` in parallel.

### Type consistency check

- `CourseProfileResult` is defined in `lib/ai/course-profile/schema.ts` and used as the `result` column type in `course_profile_runs` (schema T2 of Plan 1) and as the return type of `synthesizeCourseProfile` — consistent.
- `getCourseProfile` returns `typeof courseProfiles.$inferSelect | null` (Drizzle inference). Plan 3 imports and reuses `getCourseProfile` for reads; it does not redefine a `CourseProfile` type that conflicts.
- `AnalysisFinding` from `schema.ts` is used as the parameter type for `cacheAnalysisFinding.finding` — consistent with the `course_materials.analysisFinding` JSONB column type defined in Plan 1's schema.
