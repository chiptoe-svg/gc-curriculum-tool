# M-Trial Dual Analysis Modes + Target Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the M-trial prototype's single Analyze button into two tab-driven analysis modes — career-target alignment (a chain of courses vs. a target) and prereqs feeding a course (existing flow, unchanged externally) — while exposing the selected target's K/U/D descriptors inline so faculty see the scoring rubric before clicking Analyze.

**Architecture:** Extract the existing `/api/analyze/route.ts` orchestration into focused per-call helpers under `lib/ai/analyze/` (KUD draft, coverage scoring, scaffolding, prereq, gap, plus shared guards and persistence). Refactor the existing route to use the helpers (behavior unchanged externally). Add a new `/api/analyze/target-chain` route built from the same helpers. Add a tab switcher to the prototype page, a new `TargetChainForm` + `TargetChainResults` for Tab 1, and a shared `TargetKUDPreview` component below the target picker on both tabs. Add an `analysis_kind` discriminator column to `prototype_runs`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle ORM + Neon Postgres, Vitest, React 19, Tailwind v4, shadcn/ui primitives, existing OpenAI provider abstraction. Package manager: pnpm.

**Spec:** [`docs/superpowers/specs/2026-05-19-m-trial-dual-analysis-modes-design.md`](../specs/2026-05-19-m-trial-dual-analysis-modes-design.md).

---

## File Structure

**New files (created by this plan):**

```
lib/ai/analyze/
  target-context.ts            # buildTargetContext (moved from route.ts)
  accum.ts                     # TelemetryAccumulator class
  kud-draft.ts                 # draftKUD helper
  coverage-score.ts            # scoreCoverage helper
  scaffolding-eval.ts          # evaluateScaffolding helper
  prereq-suggest.ts            # suggestPrereqs helper (Tab 2 only)
  gap-analyze.ts               # analyzeGaps helper (Tab 2 only)
  guards.ts                    # applyAnalyzeGuards (rate-limit + cap)
  persist.ts                   # persistAnalyzeRun (insert + recordSpend)

app/api/analyze/target-chain/
  route.ts                     # POST handler for Tab 1

components/
  TargetKUDPreview.tsx         # shared K/U/D preview (both tabs)
  TargetChainForm.tsx          # Tab 1 form (target + checkbox list)
  TargetChainResults.tsx       # Tab 1 results renderer
  TabSwitcher.tsx              # simple two-pill tab bar

drizzle/
  0008_<auto>.sql              # add analysis_kind column to prototype_runs

tests/ai/analyze/
  target-context.test.ts
  accum.test.ts
  kud-draft.test.ts
  coverage-score.test.ts
  scaffolding-eval.test.ts
  prereq-suggest.test.ts
  gap-analyze.test.ts
  guards.test.ts
  persist.test.ts

tests/api/
  analyze-target-chain.test.ts

tests/components/
  TargetKUDPreview.test.tsx
  TargetChainForm.test.tsx
```

**Modified files:**

- `lib/db/schema.ts` — append `analysisKind` column to `prototypeRuns` (T1).
- `lib/db/queries.ts` — `InsertRunInput` gains `analysisKind` (T1).
- `lib/domain/types.ts` — add `TargetChainAnalysisResult` type (T2).
- `app/api/analyze/route.ts` — refactor to use helpers; pass `analysisKind: 'course_prereqs'` to persist (T9).
- `components/CoverageHeatMap.tsx` — add `mode` prop (T11).
- `components/PrototypeForm.tsx` — slot in `TargetKUDPreview` below target dropdown (T14).
- `app/preview/[slug]/PrototypeClient.tsx` — tab switcher + URL state + Tab 1 wiring (T15).
- `tests/api/analyze.test.ts` — regression guard, may need minor updates after refactor (T9).

---

## Phase A — Schema + types

### Task 1: Add `analysisKind` column + update `InsertRunInput`

**Files:**
- Modify: `lib/db/schema.ts`
- Generate: `drizzle/0008_<auto>.sql`
- Modify: `lib/db/queries.ts`
- Test: `lib/db/__tests__/analysis-kind-schema.test.ts` (create)

- [ ] **Step 1: Add the column to schema**

Open `lib/db/schema.ts`. Find the `prototypeRuns` table definition. After `durationMs: integer('duration_ms').notNull(),` add:

```typescript
  analysisKind: text('analysis_kind').notNull().default('course_prereqs'),
```

Place the line immediately before the closing `});` of `prototypeRuns`.

- [ ] **Step 2: Generate + apply migration**

Run: `pnpm db:generate && pnpm db:migrate`

If `pnpm db:migrate` complains about `DATABASE_URL`, prefix with: `set -a && source .env.local && set +a && pnpm db:migrate`.

Expected: `drizzle/0008_*.sql` is created with `ALTER TABLE "prototype_runs" ADD COLUMN "analysis_kind" text DEFAULT 'course_prereqs' NOT NULL;`. Migration applies successfully.

- [ ] **Step 3: Update `InsertRunInput` and `insertRun`**

In `lib/db/queries.ts`, change:

```typescript
export interface InsertRunInput {
  ipHash: string;
  careerTargetId: string;
  courseLabel: string | null;
  courseSyllabus: string;
  priorCoursework: Array<{ courseLabel: string; syllabus: string }>;
  result: AnalysisResult;
  aiProvider: string;
  aiModel: string;
  costUsdCents: number;
  durationMs: number;
}
```

to add the new field:

```typescript
export interface InsertRunInput {
  ipHash: string;
  careerTargetId: string;
  courseLabel: string | null;
  courseSyllabus: string;
  priorCoursework: Array<{ courseLabel: string; syllabus: string }>;
  result: AnalysisResult | TargetChainAnalysisResult;
  aiProvider: string;
  aiModel: string;
  costUsdCents: number;
  durationMs: number;
  analysisKind: 'course_prereqs' | 'target_chain';
}
```

Add the import at the top of `lib/db/queries.ts`:

```typescript
import type { AnalysisResult, TargetChainAnalysisResult } from '@/lib/domain/types';
```

Then update `insertRun` to pass through the new field:

```typescript
export async function insertRun(input: InsertRunInput): Promise<{ id: string }> {
  const [row] = await db.insert(prototypeRuns).values({
    ipHash: input.ipHash,
    careerTargetId: input.careerTargetId,
    courseLabel: input.courseLabel,
    courseSyllabus: input.courseSyllabus,
    priorCoursework: input.priorCoursework,
    result: input.result,
    aiProvider: input.aiProvider,
    aiModel: input.aiModel,
    costUsdCents: input.costUsdCents,
    durationMs: input.durationMs,
    analysisKind: input.analysisKind,
  }).returning({ id: prototypeRuns.id });
  if (!row) throw new Error('insertRun: no row returned');
  return row;
}
```

`TargetChainAnalysisResult` lands in T2 — TypeScript will error here until T2 is implemented. That's acceptable as a transient state between commits; both T1 and T2 ship in the same PR.

- [ ] **Step 4: Write the schema smoke test**

Create `lib/db/__tests__/analysis-kind-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { prototypeRuns } from '@/lib/db/schema';

describe('prototype_runs.analysis_kind column', () => {
  it('exists on the prototypeRuns table', () => {
    expect(Object.keys(prototypeRuns)).toContain('analysisKind');
  });
});
```

- [ ] **Step 5: Run the smoke test**

Run: `pnpm test lib/db/__tests__/analysis-kind-schema.test.ts`

Expected: 1 passing test. Note tsc may still fail until T2 lands `TargetChainAnalysisResult` — the test runs anyway because vitest compiles per-file.

- [ ] **Step 6: Stage files** — `git add lib/db/schema.ts drizzle/0008_*.sql lib/db/queries.ts lib/db/__tests__/analysis-kind-schema.test.ts`. **Do NOT commit yet** — wait until T2 lands so the commit doesn't leave the repo with a tsc error.

---

### Task 2: `TargetChainAnalysisResult` domain type

**Files:**
- Modify: `lib/domain/types.ts`

- [ ] **Step 1: Append the new type**

In `lib/domain/types.ts`, after the existing `AnalysisResult` interface (which ends around line 90), add:

```typescript
export interface TargetChainCourseAnalysis {
  courseLabel: string;
  kud: KUDOutcomes;
  coverage: CoverageScore[];
}

export interface TargetChainAnalysisResult {
  careerTargetId: string;
  courses: TargetChainCourseAnalysis[];   // sorted by level ascending, then by label
  scaffolding: ScaffoldingScore[];
  meta: {
    aiProvider: string;
    aiModel: string;
    durationMs: number;
    costUsdCents: number;
    cachedTokens: number;
    uncachedTokens: number;
    completionTokens: number;
  };
}
```

- [ ] **Step 2: tsc check — the T1+T2 changeset must compile cleanly**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors. (The `InsertRunInput.result` field now accepts either `AnalysisResult` or `TargetChainAnalysisResult`.)

- [ ] **Step 3: Stage + commit T1 + T2 jointly**

```bash
git add lib/domain/types.ts
git commit -m "feat(db): add analysis_kind column + TargetChainAnalysisResult type"
```

---

## Phase B — Shared AI helpers

Each helper extracts a single AI call (or a single concern) from the existing `/api/analyze/route.ts`. They get their own files + tests. The existing route still works after Phase B because nothing references the helpers yet — they're created but not consumed until T9.

### Task 3: `target-context.ts` + `accum.ts`

**Files:**
- Create: `lib/ai/analyze/target-context.ts`
- Create: `lib/ai/analyze/accum.ts`
- Test: `tests/ai/analyze/target-context.test.ts` (create)
- Test: `tests/ai/analyze/accum.test.ts` (create)

- [ ] **Step 1: Write the failing test for target-context**

Create `tests/ai/analyze/target-context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildTargetContext } from '@/lib/ai/analyze/target-context';
import type { CareerTarget } from '@/lib/domain/types';

const target: CareerTarget = {
  id: 'production-operations',
  name: 'Production Operations',
  shortDefinition: 'Running the press floor day-to-day.',
  industryContexts: ['commercial print', 'packaging'],
  knowDescriptors: [],
  understandDescriptors: [],
  doDescriptors: [],
  defensibilityNote: 'anchored to SOC code 51-5112.',
  socCode: '51-5112',
  subCompetencies: [
    { id: 'press-mechanics', name: 'Press Mechanics', knowDescriptor: 'press parts', understandDescriptor: 'wear patterns', doDescriptor: 'troubleshoot a jam' },
  ],
};

describe('buildTargetContext', () => {
  it('returns empty string when target is null', () => {
    expect(buildTargetContext(null)).toBe('');
  });
  it('includes name, definition, defensibility note, and each sub-competency', () => {
    const out = buildTargetContext(target);
    expect(out).toContain('Production Operations');
    expect(out).toContain('Running the press floor day-to-day.');
    expect(out).toContain('anchored to SOC code 51-5112.');
    expect(out).toContain('id=press-mechanics :: Press Mechanics');
    expect(out).toContain('Know: press parts');
    expect(out).toContain('Understand: wear patterns');
    expect(out).toContain('Do: troubleshoot a jam');
  });
});
```

- [ ] **Step 2: Implement target-context**

Create `lib/ai/analyze/target-context.ts`:

```typescript
import type { CareerTarget } from '@/lib/domain/types';

export function buildTargetContext(target: CareerTarget | null): string {
  if (!target) return '';
  const lines: string[] = [
    `Career Target: ${target.name}`,
    `Definition: ${target.shortDefinition}`,
    `Defensibility note: ${target.defensibilityNote}`,
    '',
    'Sub-competencies:',
  ];
  for (const sc of target.subCompetencies) {
    lines.push(`- id=${sc.id} :: ${sc.name}`);
    lines.push(`    Know: ${sc.knowDescriptor}`);
    lines.push(`    Understand: ${sc.understandDescriptor}`);
    lines.push(`    Do: ${sc.doDescriptor}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 3: Run target-context test** — `pnpm test tests/ai/analyze/target-context.test.ts`. Expected: 2 passing.

- [ ] **Step 4: Write the failing test for accum**

Create `tests/ai/analyze/accum.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TelemetryAccumulator } from '@/lib/ai/analyze/accum';

describe('TelemetryAccumulator', () => {
  it('sums each metric across multiple calls', () => {
    const a = new TelemetryAccumulator();
    a.add({ costUsdCents: 10, cachedTokens: 100, uncachedPromptTokens: 50, completionTokens: 25 });
    a.add({ costUsdCents: 5, cachedTokens: 0, uncachedPromptTokens: 30, completionTokens: 20 });
    expect(a.totals()).toEqual({
      costUsdCents: 15,
      cachedTokens: 100,
      uncachedPromptTokens: 80,
      completionTokens: 45,
    });
  });
  it('returns zeros before any add()', () => {
    expect(new TelemetryAccumulator().totals()).toEqual({
      costUsdCents: 0, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0,
    });
  });
});
```

- [ ] **Step 5: Implement accum**

Create `lib/ai/analyze/accum.ts`:

```typescript
export interface CallTelemetry {
  costUsdCents: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
}

export class TelemetryAccumulator {
  private cost = 0;
  private cached = 0;
  private uncached = 0;
  private completion = 0;

  add(t: CallTelemetry): void {
    this.cost += t.costUsdCents;
    this.cached += t.cachedTokens;
    this.uncached += t.uncachedPromptTokens;
    this.completion += t.completionTokens;
  }

  totals(): CallTelemetry {
    return {
      costUsdCents: this.cost,
      cachedTokens: this.cached,
      uncachedPromptTokens: this.uncached,
      completionTokens: this.completion,
    };
  }
}
```

- [ ] **Step 6: Run accum test** — `pnpm test tests/ai/analyze/accum.test.ts`. Expected: 2 passing.

- [ ] **Step 7: tsc check** — `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 8: Stage + commit**

```bash
git add lib/ai/analyze/target-context.ts lib/ai/analyze/accum.ts tests/ai/analyze/target-context.test.ts tests/ai/analyze/accum.test.ts
git commit -m "feat(analyze): extract target-context formatter + telemetry accumulator"
```

---

### Task 4: `kud-draft.ts` helper

**Files:**
- Create: `lib/ai/analyze/kud-draft.ts`
- Test: `tests/ai/analyze/kud-draft.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/ai/analyze/kud-draft.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  loadPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { draftKUD } from '@/lib/ai/analyze/kud-draft';

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('DRAFT SYSTEM PROMPT');
  getProvider.mockReturnValue({
    name: 'openai',
    model: 'gpt-5.4-mini',
    complete: vi.fn().mockResolvedValue({
      data: { description: 'd', know: ['k1'], understand: ['u1'], do: ['d1'] },
      costUsdCents: 5, durationMs: 100, cachedTokens: 10, uncachedPromptTokens: 50, completionTokens: 30,
    }),
  });
});

describe('draftKUD', () => {
  it('returns parsed KUD outcomes plus telemetry', async () => {
    const out = await draftKUD({ targetContext: 'CTX', syllabusText: 'SYL' });
    expect(out.data.description).toBe('d');
    expect(out.telemetry.costUsdCents).toBe(5);
  });
  it('passes targetContext + syllabusText to the provider', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: { description: 'd', know: ['k'], understand: ['u'], do: ['x'] },
      costUsdCents: 1, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });
    await draftKUD({ targetContext: 'MY CTX', syllabusText: 'MY SYL' });
    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.systemPrompt).toBe('DRAFT SYSTEM PROMPT');
    expect(arg.userMessage).toContain('MY CTX');
    expect(arg.userMessage).toContain('MY SYL');
  });
});
```

- [ ] **Step 2: Run failing test** — `pnpm test tests/ai/analyze/kud-draft.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement draftKUD**

Create `lib/ai/analyze/kud-draft.ts`:

```typescript
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { kudOutcomesSchema, kudOutcomesJsonSchema } from '@/lib/ai/schemas';
import type { KUDOutcomes } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface DraftKUDArgs {
  targetContext: string;
  syllabusText: string;
}

export async function draftKUD({ targetContext, syllabusText }: DraftKUDArgs): Promise<{
  data: KUDOutcomes;
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('draft-outcomes');
  const provider = getProvider();
  const result = await provider.complete({
    systemPrompt,
    userMessage: `Career target context:\n${targetContext}\n\nSyllabus text:\n${syllabusText}`,
    schemaName: 'kud_outcomes',
    jsonSchema: kudOutcomesJsonSchema,
    validate: (raw) => kudOutcomesSchema.parse(raw),
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

- [ ] **Step 4: Run test** — `pnpm test tests/ai/analyze/kud-draft.test.ts`. Expected: 2 passing.

- [ ] **Step 5: tsc check** — `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Stage + commit**

```bash
git add lib/ai/analyze/kud-draft.ts tests/ai/analyze/kud-draft.test.ts
git commit -m "feat(analyze): draftKUD helper"
```

---

### Task 5: `coverage-score.ts` helper

**Files:**
- Create: `lib/ai/analyze/coverage-score.ts`
- Test: `tests/ai/analyze/coverage-score.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/ai/analyze/coverage-score.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  loadPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { scoreCoverage } from '@/lib/ai/analyze/coverage-score';

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('SCORE SYSTEM PROMPT');
});

describe('scoreCoverage', () => {
  it('passes target context, course label, and KUD into the prompt and returns parsed scores', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: [{ subCompetencyId: 'press', kudLevel: 'do', confidence: 'high', reasoning: 'because the syllabus says so explicitly in the assignment' }],
      costUsdCents: 4, durationMs: 80, cachedTokens: 20, uncachedPromptTokens: 10, completionTokens: 15,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });
    const out = await scoreCoverage({
      targetContext: 'CTX',
      courseLabel: 'GC 4060',
      kud: { description: 'd', know: ['k1'], understand: ['u1'], do: ['d1'] },
    });
    expect(out.data).toHaveLength(1);
    expect(out.data[0]!.kudLevel).toBe('do');
    expect(out.telemetry.costUsdCents).toBe(4);
    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.systemPrompt).toBe('SCORE SYSTEM PROMPT');
    expect(arg.userMessage).toContain('GC 4060');
    expect(arg.userMessage).toContain('CTX');
    expect(arg.userMessage).toContain('k1');
  });
});
```

- [ ] **Step 2: Run failing test** — `pnpm test tests/ai/analyze/coverage-score.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement scoreCoverage**

Create `lib/ai/analyze/coverage-score.ts`:

```typescript
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { coverageScoresSchema, coverageScoresJsonSchema } from '@/lib/ai/schemas';
import type { CoverageScore, KUDOutcomes } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface ScoreCoverageArgs {
  targetContext: string;
  courseLabel: string;
  kud: KUDOutcomes;
}

export async function scoreCoverage({ targetContext, courseLabel, kud }: ScoreCoverageArgs): Promise<{
  data: CoverageScore[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('score-coverage');
  const provider = getProvider();
  const userMessage = `Career target:\n${targetContext}\n\nCourse: ${courseLabel}\n\nCourse description: ${kud.description}\n\nKnow outcomes:\n${kud.know.map(b => `- ${b}`).join('\n')}\n\nUnderstand outcomes:\n${kud.understand.map(b => `- ${b}`).join('\n')}\n\nDo outcomes:\n${kud.do.map(b => `- ${b}`).join('\n')}`;
  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'coverage_scores',
    jsonSchema: coverageScoresJsonSchema,
    validate: (raw) => coverageScoresSchema.parse((raw as { scores: unknown }).scores),
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

- [ ] **Step 4: Run test** — Expected: 1 passing.

- [ ] **Step 5: tsc check** — clean.

- [ ] **Step 6: Stage + commit**

```bash
git add lib/ai/analyze/coverage-score.ts tests/ai/analyze/coverage-score.test.ts
git commit -m "feat(analyze): scoreCoverage helper"
```

---

### Task 6: `scaffolding-eval.ts` helper

**Files:**
- Create: `lib/ai/analyze/scaffolding-eval.ts`
- Test: `tests/ai/analyze/scaffolding-eval.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/ai/analyze/scaffolding-eval.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  loadPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { evaluateScaffolding } from '@/lib/ai/analyze/scaffolding-eval';

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('SCAFFOLD SYSTEM PROMPT');
});

describe('evaluateScaffolding', () => {
  it('emits one entry per sub-competency referenced and returns telemetry', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: [{ subCompetencyId: 'press', quality: 'strong', reasoning: 'Course 4 picks up where Course 2 left off and adds depth.' }],
      costUsdCents: 6, durationMs: 90, cachedTokens: 30, uncachedPromptTokens: 5, completionTokens: 25,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });

    const out = await evaluateScaffolding({
      targetContext: 'CTX',
      courses: [
        { label: 'GC 1010', level: 1, coverage: [{ subCompetencyId: 'press', kudLevel: 'know', confidence: 'medium', reasoning: '...' }] },
        { label: 'GC 4060', level: 4, coverage: [{ subCompetencyId: 'press', kudLevel: 'do', confidence: 'high', reasoning: '...' }] },
      ],
    });
    expect(out.data[0]!.quality).toBe('strong');
    expect(out.telemetry.costUsdCents).toBe(6);
    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.userMessage).toContain('GC 1010');
    expect(arg.userMessage).toContain('GC 4060');
    expect(arg.userMessage).toContain('level 1');
    expect(arg.userMessage).toContain('level 4');
  });
});
```

- [ ] **Step 2: Run failing test** — Expected: FAIL.

- [ ] **Step 3: Implement evaluateScaffolding**

Create `lib/ai/analyze/scaffolding-eval.ts`:

```typescript
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { scaffoldingScoresSchema, scaffoldingScoresJsonSchema } from '@/lib/ai/schemas';
import type { CoverageScore, ScaffoldingScore } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface ScaffoldingCourse {
  label: string;
  level: number;
  coverage: CoverageScore[];
}

export interface EvaluateScaffoldingArgs {
  targetContext: string;
  courses: ScaffoldingCourse[];
  focalCourseLabel?: string;  // marks one as the course-being-analyzed in Tab 2; omit in Tab 1
}

export async function evaluateScaffolding({ targetContext, courses, focalCourseLabel }: EvaluateScaffoldingArgs): Promise<{
  data: ScaffoldingScore[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('evaluate-scaffolding');
  const provider = getProvider();
  const coursesText = courses.map(c => {
    const lines = c.coverage.map(s => `  - ${s.subCompetencyId}: ${s.kudLevel} (confidence ${s.confidence})`).join('\n');
    const marker = focalCourseLabel && c.label === focalCourseLabel ? ' (course being analyzed)' : '';
    return `[${c.label} — level ${c.level}${marker}]\n${lines}`;
  }).join('\n\n');
  const userMessage = `Career target:\n${targetContext}\n\nCourses in this analysis with their coverage of each sub-competency:\n\n${coursesText}`;
  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'scaffolding_scores',
    jsonSchema: scaffoldingScoresJsonSchema,
    validate: (raw) => scaffoldingScoresSchema.parse((raw as { scaffolding: unknown }).scaffolding),
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

- [ ] **Step 4: Run test** — Expected: 1 passing.

- [ ] **Step 5: tsc check** — clean.

- [ ] **Step 6: Stage + commit**

```bash
git add lib/ai/analyze/scaffolding-eval.ts tests/ai/analyze/scaffolding-eval.test.ts
git commit -m "feat(analyze): evaluateScaffolding helper"
```

---

### Task 7: `prereq-suggest.ts` + `gap-analyze.ts` helpers (Tab 2 only)

**Files:**
- Create: `lib/ai/analyze/prereq-suggest.ts`
- Create: `lib/ai/analyze/gap-analyze.ts`
- Test: `tests/ai/analyze/prereq-suggest.test.ts` (create)
- Test: `tests/ai/analyze/gap-analyze.test.ts` (create)

- [ ] **Step 1: Write the failing test for prereq-suggest**

Create `tests/ai/analyze/prereq-suggest.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({ getProvider: vi.fn(), loadPrompt: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { suggestPrereqs } from '@/lib/ai/analyze/prereq-suggest';

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('PREREQ PROMPT');
});

describe('suggestPrereqs', () => {
  it('returns parsed claims with telemetry', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: [{ subCompetencyId: 'press', expectedKudLevel: 'know', rationale: 'students need basic press literacy before the make-ready unit' }],
      costUsdCents: 3, durationMs: 60, cachedTokens: 5, uncachedPromptTokens: 5, completionTokens: 10,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });
    const out = await suggestPrereqs({
      targetContext: 'CTX',
      courseKud: { description: 'd', know: ['k'], understand: ['u'], do: ['x'] },
    });
    expect(out.data[0]!.subCompetencyId).toBe('press');
    expect(out.telemetry.costUsdCents).toBe(3);
  });
});
```

- [ ] **Step 2: Implement suggestPrereqs**

Create `lib/ai/analyze/prereq-suggest.ts`:

```typescript
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { prerequisiteClaimsSchema, prerequisiteClaimsJsonSchema } from '@/lib/ai/schemas';
import type { KUDOutcomes, PrerequisiteCompetencyClaim } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface SuggestPrereqsArgs {
  targetContext: string;
  courseKud: KUDOutcomes;
}

export async function suggestPrereqs({ targetContext, courseKud }: SuggestPrereqsArgs): Promise<{
  data: PrerequisiteCompetencyClaim[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('suggest-prerequisites');
  const provider = getProvider();
  const userMessage = `Career target:\n${targetContext}\n\nCourse outcomes:\nDescription: ${courseKud.description}\nKnow: ${courseKud.know.join('; ')}\nUnderstand: ${courseKud.understand.join('; ')}\nDo: ${courseKud.do.join('; ')}`;
  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'prerequisite_claims',
    jsonSchema: prerequisiteClaimsJsonSchema,
    validate: (raw) => prerequisiteClaimsSchema.parse((raw as { claims: unknown }).claims),
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

- [ ] **Step 3: Run prereq test** — Expected: 1 passing.

- [ ] **Step 4: Write the failing test for gap-analyze**

Create `tests/ai/analyze/gap-analyze.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({ getProvider: vi.fn(), loadPrompt: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { analyzeGaps } from '@/lib/ai/analyze/gap-analyze';

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('GAP PROMPT');
});

describe('analyzeGaps', () => {
  it('returns parsed gaps with telemetry', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: [{
        subCompetencyId: 'press',
        expectedKudLevel: 'know',
        status: 'met',
        priorCourseworkEvidence: 'GC 1010 explicitly addresses press parts in Week 4 lab.',
        reasoning: 'The prior course meets the expected level of press literacy required by the focal course.',
      }],
      costUsdCents: 5, durationMs: 80, cachedTokens: 10, uncachedPromptTokens: 5, completionTokens: 15,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });
    const out = await analyzeGaps({
      targetContext: 'CTX',
      prereqs: [{ subCompetencyId: 'press', expectedKudLevel: 'know', rationale: 'rationale' }],
      priorCoursework: [
        { courseLabel: 'GC 1010', coverage: [{ subCompetencyId: 'press', kudLevel: 'know', confidence: 'high', reasoning: 'taught explicitly' }] },
      ],
    });
    expect(out.data[0]!.status).toBe('met');
    expect(out.telemetry.costUsdCents).toBe(5);
  });
});
```

- [ ] **Step 5: Implement analyzeGaps**

Create `lib/ai/analyze/gap-analyze.ts`:

```typescript
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { prerequisiteGapsSchema, prerequisiteGapsJsonSchema } from '@/lib/ai/schemas';
import type { CoverageScore, PrerequisiteCompetencyClaim, PrerequisiteGap } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface AnalyzeGapsArgs {
  targetContext: string;
  prereqs: PrerequisiteCompetencyClaim[];
  priorCoursework: Array<{ courseLabel: string; coverage: CoverageScore[] }>;
}

export async function analyzeGaps({ targetContext, prereqs, priorCoursework }: AnalyzeGapsArgs): Promise<{
  data: PrerequisiteGap[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('analyze-prerequisite-gaps');
  const provider = getProvider();
  const priorText = priorCoursework.map((c, i) => {
    const lines = c.coverage.map(
      s => `  - ${s.subCompetencyId}: ${s.kudLevel} (confidence ${s.confidence}) — ${s.reasoning}`
    ).join('\n');
    return `[Prior course ${i + 1}: ${c.courseLabel}]\n${lines}`;
  }).join('\n\n');
  const userMessage = `Career target:\n${targetContext}\n\nPrerequisite competencies for the course being analyzed:\n${prereqs.map(p => `- ${p.subCompetencyId} (expects ${p.expectedKudLevel}): ${p.rationale}`).join('\n')}\n\nPrior coursework (any order):\n\n${priorText}`;
  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'prerequisite_gaps',
    jsonSchema: prerequisiteGapsJsonSchema,
    validate: (raw) => prerequisiteGapsSchema.parse((raw as { gaps: unknown }).gaps),
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

- [ ] **Step 6: Run gap test + tsc** — Expected: 1 passing, tsc clean.

- [ ] **Step 7: Stage + commit**

```bash
git add lib/ai/analyze/prereq-suggest.ts lib/ai/analyze/gap-analyze.ts tests/ai/analyze/prereq-suggest.test.ts tests/ai/analyze/gap-analyze.test.ts
git commit -m "feat(analyze): suggestPrereqs + analyzeGaps helpers"
```

---

### Task 8: `guards.ts` + `persist.ts` helpers

**Files:**
- Create: `lib/ai/analyze/guards.ts`
- Create: `lib/ai/analyze/persist.ts`
- Test: `tests/ai/analyze/guards.test.ts` (create)
- Test: `tests/ai/analyze/persist.test.ts` (create)

- [ ] **Step 1: Write the failing test for guards**

Create `tests/ai/analyze/guards.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { checkIpRateLimit, checkDailyCap } = vi.hoisted(() => ({
  checkIpRateLimit: vi.fn(),
  checkDailyCap: vi.fn(),
}));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap }));

import { applyAnalyzeGuards } from '@/lib/ai/analyze/guards';

beforeEach(() => {
  vi.clearAllMocks();
});

function req(headers: Record<string, string> = {}) {
  return new Request('http://test/analyze', { headers });
}

describe('applyAnalyzeGuards', () => {
  it('returns null + ipHash when allowed', async () => {
    checkIpRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0 });
    const out = await applyAnalyzeGuards(req({ 'x-forwarded-for': '1.2.3.4' }));
    expect(out.short).toBe(null);
    expect(typeof out.ipHash).toBe('string');
    expect(out.ipHash.length).toBeGreaterThan(0);
  });
  it('returns a 429 NextResponse when rate-limited', async () => {
    checkIpRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0 });
    const out = await applyAnalyzeGuards(req());
    expect(out.short?.status).toBe(429);
  });
  it('returns a 503 NextResponse when daily cap exhausted', async () => {
    checkIpRateLimit.mockResolvedValue({ allowed: true, remaining: 5 });
    checkDailyCap.mockResolvedValue({ ok: false, spentCents: 99999 });
    const out = await applyAnalyzeGuards(req());
    expect(out.short?.status).toBe(503);
  });
});
```

- [ ] **Step 2: Implement guards**

Create `lib/ai/analyze/guards.ts`:

```typescript
import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';

export interface GuardOutcome {
  short: NextResponse | null;
  ipHash: string;
}

function hashIp(req: Request): string {
  // On Vercel (and most reverse proxies), the trusted client IP is the LAST
  // entry in X-Forwarded-For — the proxy appends it. Taking [0] would let a
  // client spoof the IP via their own forwarded header and bypass rate limits.
  const xff = req.headers.get('x-forwarded-for');
  const parts = xff?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  const ip = parts[parts.length - 1] ?? req.headers.get('x-real-ip') ?? 'unknown';
  return createHash('sha256').update(ip).digest('hex');
}

export async function applyAnalyzeGuards(req: Request): Promise<GuardOutcome> {
  const ipHash = hashIp(req);
  const rl = await checkIpRateLimit(ipHash);
  if (!rl.allowed) {
    return { short: NextResponse.json({ error: 'rate limit exceeded — try again in an hour' }, { status: 429 }), ipHash };
  }
  const cap = await checkDailyCap();
  if (!cap.ok) {
    return { short: NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 }), ipHash };
  }
  return { short: null, ipHash };
}
```

- [ ] **Step 3: Run guards test** — Expected: 3 passing.

- [ ] **Step 4: Write the failing test for persist**

Create `tests/ai/analyze/persist.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insertRun, recordSpend } = vi.hoisted(() => ({ insertRun: vi.fn(), recordSpend: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({ insertRun }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ recordSpend }));

import { persistAnalyzeRun } from '@/lib/ai/analyze/persist';

beforeEach(() => {
  vi.clearAllMocks();
});

const baseInput = {
  ipHash: 'hash',
  careerTargetId: 'target',
  courseLabel: 'GC 4060',
  courseSyllabus: 'syllabus body',
  priorCoursework: [],
  result: { careerTargetId: 'target', courses: [], scaffolding: [], meta: { aiProvider: 'openai', aiModel: 'gpt', durationMs: 1, costUsdCents: 1, cachedTokens: 0, uncachedTokens: 0, completionTokens: 0 } },
  aiProvider: 'openai',
  aiModel: 'gpt',
  costUsdCents: 5,
  durationMs: 100,
  analysisKind: 'target_chain' as const,
};

describe('persistAnalyzeRun', () => {
  it('inserts a run and records spend, returning the runId', async () => {
    insertRun.mockResolvedValue({ id: 'run-1' });
    recordSpend.mockResolvedValue(undefined);
    const runId = await persistAnalyzeRun(baseInput);
    expect(runId).toBe('run-1');
    expect(insertRun).toHaveBeenCalled();
    expect(recordSpend).toHaveBeenCalledWith(5);
  });
  it('returns null on insert failure rather than throwing', async () => {
    insertRun.mockRejectedValue(new Error('db down'));
    const runId = await persistAnalyzeRun(baseInput);
    expect(runId).toBeNull();
    expect(recordSpend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Implement persist**

Create `lib/ai/analyze/persist.ts`:

```typescript
import { insertRun, type InsertRunInput } from '@/lib/db/queries';
import { recordSpend } from '@/lib/rate-limit/daily-cap';

/**
 * Persists a successful analyze run and records spend. Returns the runId on
 * success, or null on persistence failure — losing the run log is preferable
 * to losing the user's analysis after the AI work has already been paid for.
 */
export async function persistAnalyzeRun(input: InsertRunInput): Promise<string | null> {
  try {
    const { id } = await insertRun(input);
    await recordSpend(input.costUsdCents);
    return id;
  } catch (err) {
    console.error('persistAnalyzeRun: persistence failed after successful AI calls', err);
    return null;
  }
}
```

- [ ] **Step 6: Run persist test + tsc** — Expected: 2 passing, tsc clean.

- [ ] **Step 7: Stage + commit**

```bash
git add lib/ai/analyze/guards.ts lib/ai/analyze/persist.ts tests/ai/analyze/guards.test.ts tests/ai/analyze/persist.test.ts
git commit -m "feat(analyze): guards + persist helpers"
```

---

## Phase C — Refactor existing `/api/analyze`

### Task 9: Refactor `/api/analyze/route.ts` to use shared helpers

**Files:**
- Modify: `app/api/analyze/route.ts`
- Possibly modify: `tests/api/analyze.test.ts` (only if it imports or asserts on internal helpers)

The behavior and response shape of `/api/analyze` must NOT change. This task is a pure refactor — same request shape, same response shape, same call count, same AI provider/model semantics. Externally indistinguishable from before.

- [ ] **Step 1: Replace the route body**

Open `app/api/analyze/route.ts`. Replace the entire file contents with:

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { applyAnalyzeGuards } from '@/lib/ai/analyze/guards';
import { buildTargetContext } from '@/lib/ai/analyze/target-context';
import { TelemetryAccumulator } from '@/lib/ai/analyze/accum';
import { draftKUD } from '@/lib/ai/analyze/kud-draft';
import { scoreCoverage } from '@/lib/ai/analyze/coverage-score';
import { suggestPrereqs } from '@/lib/ai/analyze/prereq-suggest';
import { analyzeGaps } from '@/lib/ai/analyze/gap-analyze';
import { evaluateScaffolding } from '@/lib/ai/analyze/scaffolding-eval';
import { persistAnalyzeRun } from '@/lib/ai/analyze/persist';
import { getProvider } from '@/lib/ai/provider';
import type { AnalysisResult, PriorCourseAnalysis } from '@/lib/domain/types';

export const maxDuration = 120;

const MAX_SYLLABUS_LEN = 20000;
const MAX_PRIOR_COURSES = 8;

const courseInputSchema = z.object({
  courseLabel: z.string().min(1).max(200),
  syllabusText: z.string().min(50).max(MAX_SYLLABUS_LEN),
});

const requestSchema = z.object({
  careerTargetId: z.string().min(1).max(100),
  course: courseInputSchema,
  priorCoursework: z.array(courseInputSchema).min(1).max(MAX_PRIOR_COURSES),
});

function parseLevelFromLabel(label: string): number {
  const m = label.match(/GC\s+(\d)/i);
  return m ? parseInt(m[1]!, 10) : 0;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { careerTargetId, course, priorCoursework } = parsed.data;

  const target = await getTargetById(careerTargetId);
  if (!target) {
    return NextResponse.json({ error: `unknown careerTargetId: ${careerTargetId}` }, { status: 400 });
  }

  const guard = await applyAnalyzeGuards(req);
  if (guard.short) return guard.short;

  const targetContext = buildTargetContext(target);
  const accum = new TelemetryAccumulator();
  const started = Date.now();

  // Round 1 (parallel): N+1 KUD drafts
  const round1 = await Promise.all([
    ...priorCoursework.map(c => draftKUD({ targetContext, syllabusText: c.syllabusText })),
    draftKUD({ targetContext, syllabusText: course.syllabusText }),
  ]);
  const priorKudCalls = round1.slice(0, priorCoursework.length);
  const courseKudCall = round1[priorCoursework.length]!;
  for (const c of round1) accum.add(c.telemetry);
  const priorKuds = priorKudCalls.map(c => c.data);
  const courseKud = courseKudCall.data;

  // Round 2 (parallel): N+1 coverage + 1 prereq suggest
  const [coverageCalls, prereqCall] = await Promise.all([
    Promise.all([
      ...priorCoursework.map((c, i) => scoreCoverage({ targetContext, courseLabel: c.courseLabel, kud: priorKuds[i]! })),
      scoreCoverage({ targetContext, courseLabel: course.courseLabel, kud: courseKud }),
    ]),
    suggestPrereqs({ targetContext, courseKud }),
  ] as const);
  const priorCoverageCalls = coverageCalls.slice(0, priorCoursework.length);
  const courseCoverageCall = coverageCalls[priorCoursework.length]!;
  for (const c of coverageCalls) accum.add(c.telemetry);
  accum.add(prereqCall.telemetry);
  const priorCoverages = priorCoverageCalls.map(c => c.data);
  const courseCoverage = courseCoverageCall.data;
  const prereqs = prereqCall.data;

  // Round 3 (parallel): gap analysis + scaffolding evaluation
  const scaffoldingCourses = [
    { label: course.courseLabel, level: parseLevelFromLabel(course.courseLabel), coverage: courseCoverage },
    ...priorCoursework.map((c, i) => ({
      label: c.courseLabel,
      level: parseLevelFromLabel(c.courseLabel),
      coverage: priorCoverages[i]!,
    })),
  ];

  const [gapCall, scaffoldingCall] = await Promise.all([
    analyzeGaps({
      targetContext,
      prereqs,
      priorCoursework: priorCoursework.map((c, i) => ({ courseLabel: c.courseLabel, coverage: priorCoverages[i]! })),
    }),
    evaluateScaffolding({
      targetContext,
      courses: scaffoldingCourses,
      focalCourseLabel: course.courseLabel,
    }),
  ]);
  accum.add(gapCall.telemetry);
  accum.add(scaffoldingCall.telemetry);

  const priorCourseworkResult: PriorCourseAnalysis[] = priorCoursework.map((c, i) => ({
    courseLabel: c.courseLabel,
    kud: priorKuds[i]!,
    coverage: priorCoverages[i]!,
  }));

  const totals = accum.totals();
  const provider = getProvider();
  const result: AnalysisResult = {
    priorCoursework: priorCourseworkResult,
    course: {
      courseLabel: course.courseLabel,
      kud: courseKud,
      coverage: courseCoverage,
      prerequisiteCompetencies: prereqs,
      prerequisiteGaps: gapCall.data,
    },
    careerTargetId,
    scaffolding: scaffoldingCall.data,
    meta: {
      aiProvider: provider.name,
      aiModel: provider.model,
      durationMs: Date.now() - started,
      costUsdCents: totals.costUsdCents,
      cachedTokens: totals.cachedTokens,
      uncachedTokens: totals.uncachedPromptTokens,
      completionTokens: totals.completionTokens,
    },
  };

  const runId = await persistAnalyzeRun({
    ipHash: guard.ipHash,
    careerTargetId,
    courseLabel: course.courseLabel,
    courseSyllabus: course.syllabusText,
    priorCoursework: priorCoursework.map(c => ({ courseLabel: c.courseLabel, syllabus: c.syllabusText })),
    result,
    aiProvider: provider.name,
    aiModel: provider.model,
    costUsdCents: totals.costUsdCents,
    durationMs: result.meta.durationMs,
    analysisKind: 'course_prereqs',
  });

  return NextResponse.json({ ...result, runId });
}
```

- [ ] **Step 2: Run the existing analyze regression test**

Run: `pnpm test tests/api/analyze.test.ts`

Expected: every test that previously passed still passes. If a test imports internal symbols that no longer exist (`buildTargetContext` was internal, now in `target-context.ts`), update the import to `@/lib/ai/analyze/target-context`. Do NOT change any assertions — the route's external contract is unchanged.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test 2>&1 | tail -5`

Expected: all tests still passing. No new failures.

- [ ] **Step 4: tsc check** — `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 5: Stage + commit**

```bash
git add app/api/analyze/route.ts tests/api/analyze.test.ts
git commit -m "refactor(analyze): route uses shared lib/ai/analyze helpers (no behavior change)"
```

---

## Phase D — New `/api/analyze/target-chain` route

### Task 10: Add the route

**Files:**
- Create: `app/api/analyze/target-chain/route.ts`
- Test: `tests/api/analyze-target-chain.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/api/analyze-target-chain.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  applyAnalyzeGuards, buildTargetContext, draftKUD, scoreCoverage, evaluateScaffolding,
  persistAnalyzeRun, getTargetById, getProvider,
} = vi.hoisted(() => ({
  applyAnalyzeGuards: vi.fn(),
  buildTargetContext: vi.fn(),
  draftKUD: vi.fn(),
  scoreCoverage: vi.fn(),
  evaluateScaffolding: vi.fn(),
  persistAnalyzeRun: vi.fn(),
  getTargetById: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock('@/lib/ai/analyze/guards', () => ({ applyAnalyzeGuards }));
vi.mock('@/lib/ai/analyze/target-context', () => ({ buildTargetContext }));
vi.mock('@/lib/ai/analyze/kud-draft', () => ({ draftKUD }));
vi.mock('@/lib/ai/analyze/coverage-score', () => ({ scoreCoverage }));
vi.mock('@/lib/ai/analyze/scaffolding-eval', () => ({ evaluateScaffolding }));
vi.mock('@/lib/ai/analyze/persist', () => ({ persistAnalyzeRun }));
vi.mock('@/lib/db/career-targets-queries', () => ({ getTargetById }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));

import { POST } from '@/app/api/analyze/target-chain/route';

beforeEach(() => {
  vi.clearAllMocks();
  applyAnalyzeGuards.mockResolvedValue({ short: null, ipHash: 'hash' });
  buildTargetContext.mockReturnValue('CTX');
  getProvider.mockReturnValue({ name: 'openai', model: 'gpt' });
  persistAnalyzeRun.mockResolvedValue('run-1');
  getTargetById.mockResolvedValue({
    id: 'production-operations',
    name: 'Production Operations',
    shortDefinition: 'def',
    industryContexts: [], knowDescriptors: [], understandDescriptors: [], doDescriptors: [],
    defensibilityNote: 'note', socCode: null, subCompetencies: [],
  });
  draftKUD.mockImplementation(async () => ({
    data: { description: 'd', know: ['k'], understand: ['u'], do: ['x'] },
    telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
  }));
  scoreCoverage.mockImplementation(async () => ({
    data: [{ subCompetencyId: 'press', kudLevel: 'do', confidence: 'high', reasoning: 'because it is taught explicitly' }],
    telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
  }));
  evaluateScaffolding.mockResolvedValue({
    data: [{ subCompetencyId: 'press', quality: 'strong', reasoning: 'good progression' }],
    telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
  });
});

function makeReq(body: unknown) {
  return new Request('http://test/api/analyze/target-chain', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const minimalSyllabus = 'a'.repeat(60);  // satisfies min(50)

describe('POST /api/analyze/target-chain', () => {
  it('400s on invalid JSON', async () => {
    const res = await POST(new Request('http://t', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it('400s on fewer than 2 courses', async () => {
    const res = await POST(makeReq({
      careerTargetId: 'production-operations',
      courses: [{ courseLabel: 'GC 1010', syllabusText: minimalSyllabus }],
    }));
    expect(res.status).toBe(400);
  });

  it('400s on more than 16 courses', async () => {
    const courses = Array.from({ length: 17 }, (_, i) => ({ courseLabel: `GC 10${i}`, syllabusText: minimalSyllabus }));
    const res = await POST(makeReq({ careerTargetId: 'production-operations', courses }));
    expect(res.status).toBe(400);
  });

  it('400s on unknown careerTargetId', async () => {
    getTargetById.mockResolvedValueOnce(null);
    const res = await POST(makeReq({
      careerTargetId: 'does-not-exist',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minimalSyllabus },
        { courseLabel: 'GC 4060', syllabusText: minimalSyllabus },
      ],
    }));
    expect(res.status).toBe(400);
  });

  it('429s when guard rate-limits', async () => {
    const { NextResponse } = await import('next/server');
    applyAnalyzeGuards.mockResolvedValueOnce({ short: NextResponse.json({ error: 'rate limit' }, { status: 429 }), ipHash: 'hash' });
    const res = await POST(makeReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minimalSyllabus },
        { courseLabel: 'GC 4060', syllabusText: minimalSyllabus },
      ],
    }));
    expect(res.status).toBe(429);
  });

  it('runs draftKUD per course, scoreCoverage per course, and one scaffolding call', async () => {
    const res = await POST(makeReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minimalSyllabus },
        { courseLabel: 'GC 4060', syllabusText: minimalSyllabus },
      ],
    }));
    expect(res.status).toBe(200);
    expect(draftKUD).toHaveBeenCalledTimes(2);
    expect(scoreCoverage).toHaveBeenCalledTimes(2);
    expect(evaluateScaffolding).toHaveBeenCalledTimes(1);
  });

  it('sorts courses by level ascending in the returned payload', async () => {
    const res = await POST(makeReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 4060', syllabusText: minimalSyllabus },
        { courseLabel: 'GC 1010', syllabusText: minimalSyllabus },
      ],
    }));
    const body = await res.json();
    expect(body.courses[0].courseLabel).toBe('GC 1010');
    expect(body.courses[1].courseLabel).toBe('GC 4060');
  });

  it('persists with analysisKind=target_chain and includes runId in response', async () => {
    const res = await POST(makeReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minimalSyllabus },
        { courseLabel: 'GC 4060', syllabusText: minimalSyllabus },
      ],
    }));
    expect(persistAnalyzeRun).toHaveBeenCalledWith(expect.objectContaining({ analysisKind: 'target_chain' }));
    const body = await res.json();
    expect(body.runId).toBe('run-1');
  });
});
```

- [ ] **Step 2: Run failing tests** — `pnpm test tests/api/analyze-target-chain.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement the route**

Create `app/api/analyze/target-chain/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { applyAnalyzeGuards } from '@/lib/ai/analyze/guards';
import { buildTargetContext } from '@/lib/ai/analyze/target-context';
import { TelemetryAccumulator } from '@/lib/ai/analyze/accum';
import { draftKUD } from '@/lib/ai/analyze/kud-draft';
import { scoreCoverage } from '@/lib/ai/analyze/coverage-score';
import { evaluateScaffolding } from '@/lib/ai/analyze/scaffolding-eval';
import { persistAnalyzeRun } from '@/lib/ai/analyze/persist';
import { getProvider } from '@/lib/ai/provider';
import type { TargetChainAnalysisResult, TargetChainCourseAnalysis } from '@/lib/domain/types';

export const maxDuration = 120;

const MAX_SYLLABUS_LEN = 20000;
const MIN_COURSES = 2;
const MAX_COURSES = 16;

const courseInputSchema = z.object({
  courseLabel: z.string().min(1).max(200),
  syllabusText: z.string().min(50).max(MAX_SYLLABUS_LEN),
});

const requestSchema = z.object({
  careerTargetId: z.string().min(1).max(100),
  courses: z.array(courseInputSchema).min(MIN_COURSES).max(MAX_COURSES),
});

function parseLevelFromLabel(label: string): number {
  const m = label.match(/GC\s+(\d)/i);
  return m ? parseInt(m[1]!, 10) : 0;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { careerTargetId, courses } = parsed.data;

  const target = await getTargetById(careerTargetId);
  if (!target) {
    return NextResponse.json({ error: `unknown careerTargetId: ${careerTargetId}` }, { status: 400 });
  }

  const guard = await applyAnalyzeGuards(req);
  if (guard.short) return guard.short;

  // Sort courses by level ascending, then by label
  const sortedCourses = [...courses].sort((a, b) => {
    const la = parseLevelFromLabel(a.courseLabel);
    const lb = parseLevelFromLabel(b.courseLabel);
    if (la !== lb) return la - lb;
    return a.courseLabel.localeCompare(b.courseLabel);
  });

  const targetContext = buildTargetContext(target);
  const accum = new TelemetryAccumulator();
  const started = Date.now();

  // Round 1 (parallel): N KUD drafts
  const kudCalls = await Promise.all(
    sortedCourses.map(c => draftKUD({ targetContext, syllabusText: c.syllabusText }))
  );
  for (const k of kudCalls) accum.add(k.telemetry);
  const kuds = kudCalls.map(c => c.data);

  // Round 2 (parallel): N coverage scores
  const coverageCalls = await Promise.all(
    sortedCourses.map((c, i) => scoreCoverage({ targetContext, courseLabel: c.courseLabel, kud: kuds[i]! }))
  );
  for (const c of coverageCalls) accum.add(c.telemetry);
  const coverages = coverageCalls.map(c => c.data);

  // Round 3: scaffolding across the chain
  const scaffoldingCall = await evaluateScaffolding({
    targetContext,
    courses: sortedCourses.map((c, i) => ({
      label: c.courseLabel,
      level: parseLevelFromLabel(c.courseLabel),
      coverage: coverages[i]!,
    })),
    // no focalCourseLabel — chain mode
  });
  accum.add(scaffoldingCall.telemetry);

  const courseResults: TargetChainCourseAnalysis[] = sortedCourses.map((c, i) => ({
    courseLabel: c.courseLabel,
    kud: kuds[i]!,
    coverage: coverages[i]!,
  }));

  const totals = accum.totals();
  const provider = getProvider();
  const result: TargetChainAnalysisResult = {
    careerTargetId,
    courses: courseResults,
    scaffolding: scaffoldingCall.data,
    meta: {
      aiProvider: provider.name,
      aiModel: provider.model,
      durationMs: Date.now() - started,
      costUsdCents: totals.costUsdCents,
      cachedTokens: totals.cachedTokens,
      uncachedTokens: totals.uncachedPromptTokens,
      completionTokens: totals.completionTokens,
    },
  };

  // courseLabel in prototype_runs is "the focal one"; for target-chain there's
  // no focal, so we store the first sorted label as a representative anchor.
  // courseSyllabus stores nothing — the syllabi are captured in priorCoursework.
  const runId = await persistAnalyzeRun({
    ipHash: guard.ipHash,
    careerTargetId,
    courseLabel: null,
    courseSyllabus: '',
    priorCoursework: sortedCourses.map(c => ({ courseLabel: c.courseLabel, syllabus: c.syllabusText })),
    result,
    aiProvider: provider.name,
    aiModel: provider.model,
    costUsdCents: totals.costUsdCents,
    durationMs: result.meta.durationMs,
    analysisKind: 'target_chain',
  });

  return NextResponse.json({ ...result, runId });
}
```

- [ ] **Step 4: Run tests** — `pnpm test tests/api/analyze-target-chain.test.ts`. Expected: 8 passing.

- [ ] **Step 5: tsc check** — `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Stage + commit**

```bash
git add app/api/analyze/target-chain/route.ts tests/api/analyze-target-chain.test.ts
git commit -m "feat(api): /api/analyze/target-chain — Tab 1 endpoint"
```

---

## Phase E — UI

### Task 11: `CoverageHeatMap` gets a `mode` prop

**Files:**
- Modify: `components/CoverageHeatMap.tsx`
- Modify: `tests/components/CoverageHeatMap.test.tsx`

- [ ] **Step 1: Add the `mode` prop**

In `components/CoverageHeatMap.tsx`, change the `Props` interface from:

```typescript
interface Props {
  target: CareerTarget;
  courseLabel: string;
  courseScores: CoverageScore[];
  priorCoursework: Array<{ courseLabel: string; coverage: CoverageScore[] }>;
  scaffolding: ScaffoldingScore[];
  onFlag: (target: string, note: string) => Promise<void>;
}
```

to:

```typescript
interface Props {
  target: CareerTarget;
  courseLabel: string;
  courseScores: CoverageScore[];
  priorCoursework: Array<{ courseLabel: string; coverage: CoverageScore[] }>;
  scaffolding: ScaffoldingScore[];
  onFlag: (target: string, note: string) => Promise<void>;
  /** 'focal-plus-priors' (default): renders course-being-analyzed as a distinct group above prior coursework.
   *  'chain': all rows render uniformly as peers; no focal/prior labeling. */
  mode?: 'focal-plus-priors' | 'chain';
}
```

- [ ] **Step 2: Use the mode in render logic**

Find where the component renders the "course being analyzed" group header (likely a heading like "Course being analyzed" or similar). Wrap that header rendering in `mode !== 'chain' &&`. Likewise wrap any "prior coursework" group label in the same conditional. In `'chain'` mode, render all rows in a single uniform list ordered by level.

The exact render-logic edits depend on the existing component structure. Open the file, find the section that introduces the focal-course row group, and gate it. The chain mode should:

1. Build a single array of `{ label, coverage }` from `[{ label: courseLabel, coverage: courseScores }, ...priorCoursework]`.
2. Sort that array by level (parsed from label, same regex as the route).
3. Render rows directly without group headers.

If the existing render structure is complex enough that a clean conditional is difficult, add a small `getRenderedRows()` helper at the top of the component that returns the row array given the mode.

- [ ] **Step 3: Add a regression test + chain-mode test**

Open `tests/components/CoverageHeatMap.test.tsx`. Locate the existing test (which renders in default mode). Add a new `describe('mode prop')` block:

```typescript
describe('mode prop', () => {
  it('renders without focal-course grouping when mode="chain"', () => {
    const { queryByText } = render(
      <CoverageHeatMap
        target={mockTarget}
        courseLabel="GC 4060"
        courseScores={mockCourseScores}
        priorCoursework={mockPriorCoursework}
        scaffolding={mockScaffolding}
        onFlag={async () => {}}
        mode="chain"
      />
    );
    // The focal-course group header used in default mode should not appear.
    expect(queryByText(/Course being analyzed/i)).toBeNull();
  });
});
```

Reuse whatever mock fixtures the existing test in this file already defines. If they're inline in the file, just reference them by their existing names.

- [ ] **Step 4: Run the component tests** — `pnpm test tests/components/CoverageHeatMap.test.tsx`. Expected: all passing, including the new test.

- [ ] **Step 5: tsc check** — `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Stage + commit**

```bash
git add components/CoverageHeatMap.tsx tests/components/CoverageHeatMap.test.tsx
git commit -m "feat(ui): CoverageHeatMap mode='chain' for uniform-row rendering"
```

---

### Task 12: `TargetKUDPreview` component

**Files:**
- Create: `components/TargetKUDPreview.tsx`
- Test: `tests/components/TargetKUDPreview.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/components/TargetKUDPreview.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TargetKUDPreview } from '@/components/TargetKUDPreview';
import type { CareerTarget } from '@/lib/domain/types';

const target: CareerTarget = {
  id: 'production-operations',
  name: 'Production Operations',
  shortDefinition: 'def',
  industryContexts: [],
  knowDescriptors: [],
  understandDescriptors: [],
  doDescriptors: [],
  defensibilityNote: 'note',
  socCode: null,
  subCompetencies: [
    {
      id: 'press-mechanics',
      name: 'Press Mechanics',
      knowDescriptor: 'press parts',
      understandDescriptor: 'wear patterns',
      doDescriptor: 'troubleshoot a jam',
    },
  ],
};

describe('TargetKUDPreview', () => {
  it('renders collapsed by default', () => {
    render(<TargetKUDPreview slug="slug" target={target} />);
    expect(screen.getByText(/Current Know \/ Understand \/ Do/i)).toBeInTheDocument();
    expect(screen.queryByText('press parts')).toBeNull();
  });
  it('expands when the header is clicked', () => {
    render(<TargetKUDPreview slug="slug" target={target} />);
    fireEvent.click(screen.getByText(/Current Know \/ Understand \/ Do/i));
    expect(screen.getByText('press parts')).toBeInTheDocument();
    expect(screen.getByText('wear patterns')).toBeInTheDocument();
    expect(screen.getByText('troubleshoot a jam')).toBeInTheDocument();
  });
  it('includes an "Edit this target" link to the correct editor URL', () => {
    render(<TargetKUDPreview slug="my-slug" target={target} />);
    fireEvent.click(screen.getByText(/Current Know \/ Understand \/ Do/i));
    const link = screen.getByRole('link', { name: /Edit this target/i });
    expect(link.getAttribute('href')).toBe('/preview/my-slug/targets/production-operations');
  });
  it('renders nothing if target is null', () => {
    const { container } = render(<TargetKUDPreview slug="slug" target={null} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run failing test** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the component**

Create `components/TargetKUDPreview.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { CareerTarget } from '@/lib/domain/types';

interface Props {
  slug: string;
  target: CareerTarget | null;
}

export function TargetKUDPreview({ slug, target }: Props) {
  const [open, setOpen] = useState(false);

  // Auto-collapse when the target changes so we don't show stale content.
  useEffect(() => {
    setOpen(false);
  }, [target?.id]);

  if (!target) return null;

  return (
    <div className="rounded-md border border-border bg-card/60 text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/40"
        aria-expanded={open}
      >
        <span className="text-muted-foreground">
          Current Know / Understand / Do descriptors for <strong className="text-foreground">{target.name}</strong>
        </span>
        <span className="text-muted-foreground">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          <div className="flex justify-end">
            <Link
              href={`/preview/${slug}/targets/${target.id}`}
              className="text-xs text-blue-700 hover:underline"
            >
              Edit this target →
            </Link>
          </div>
          {target.subCompetencies.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sub-competencies defined.</p>
          ) : (
            <ul className="space-y-3">
              {target.subCompetencies.map(sc => (
                <li key={sc.id} className="rounded border border-border p-3">
                  <div className="font-medium">{sc.name}</div>
                  <dl className="mt-2 grid gap-2 sm:grid-cols-3 text-xs">
                    <div>
                      <dt className="font-medium uppercase tracking-wide text-muted-foreground">Know</dt>
                      <dd>{sc.knowDescriptor}</dd>
                    </div>
                    <div>
                      <dt className="font-medium uppercase tracking-wide text-muted-foreground">Understand</dt>
                      <dd>{sc.understandDescriptor}</dd>
                    </div>
                    <div>
                      <dt className="font-medium uppercase tracking-wide text-muted-foreground">Do</dt>
                      <dd>{sc.doDescriptor}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests** — `pnpm test tests/components/TargetKUDPreview.test.tsx`. Expected: 4 passing.

- [ ] **Step 5: tsc check** — clean.

- [ ] **Step 6: Stage + commit**

```bash
git add components/TargetKUDPreview.tsx tests/components/TargetKUDPreview.test.tsx
git commit -m "feat(ui): TargetKUDPreview shared component"
```

---

### Task 13: `TargetChainForm` component

**Files:**
- Create: `components/TargetChainForm.tsx`
- Test: `tests/components/TargetChainForm.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/components/TargetChainForm.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TargetChainForm } from '@/components/TargetChainForm';

const targets = [
  { id: 'production-operations', name: 'Production Operations' },
  { id: 'brand-strategy', name: 'Brand Strategy' },
];

const courses = [
  { code: 'GC 1010', title: 'Intro', level: 1, track: 'core', syllabusText: 'syllabus 1010 body that is long enough fifty chars min' },
  { code: 'GC 2020', title: 'Mid', level: 2, track: 'core', syllabusText: 'syllabus 2020 body that is long enough fifty chars min' },
  { code: 'GC 4060', title: 'Senior', level: 4, track: 'core', syllabusText: 'syllabus 4060 body that is long enough fifty chars min' },
];

describe('TargetChainForm', () => {
  it('renders the career target picker and the checkbox list grouped by level', () => {
    render(<TargetChainForm slug="s" targets={targets} courses={courses} onAnalyze={() => {}} isAnalyzing={false} />);
    expect(screen.getByText(/Production Operations/i)).toBeInTheDocument();
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.getByText('Level 2')).toBeInTheDocument();
    expect(screen.getByText('Level 4')).toBeInTheDocument();
    expect(screen.getByLabelText(/GC 1010/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/GC 4060/i)).toBeInTheDocument();
  });

  it('disables Analyze until at least 2 courses are selected', () => {
    render(<TargetChainForm slug="s" targets={targets} courses={courses} onAnalyze={() => {}} isAnalyzing={false} />);
    const btn = screen.getByRole('button', { name: /Analyze/i });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/GC 1010/i));
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/GC 2020/i));
    expect(btn).not.toBeDisabled();
  });

  it('shows a counter and enforces 16-course cap', () => {
    const many = Array.from({ length: 16 }, (_, i) => ({
      code: `GC 1${String(i).padStart(3, '0')}`,
      title: `Course ${i}`, level: 1, track: 'core',
      syllabusText: 'a'.repeat(60),
    }));
    const overflow = { ...many[0]!, code: 'GC 9999', title: 'extra' };
    render(<TargetChainForm slug="s" targets={targets} courses={[...many, overflow]} onAnalyze={() => {}} isAnalyzing={false} />);
    for (let i = 0; i < 16; i++) fireEvent.click(screen.getByLabelText(new RegExp(many[i]!.code, 'i')));
    expect(screen.getByText(/16 of 16/i)).toBeInTheDocument();
    // 17th checkbox should be disabled because cap is reached
    const overCheckbox = screen.getByLabelText(/GC 9999/i) as HTMLInputElement;
    expect(overCheckbox.disabled).toBe(true);
  });

  it('clears selections via the Clear all link', () => {
    render(<TargetChainForm slug="s" targets={targets} courses={courses} onAnalyze={() => {}} isAnalyzing={false} />);
    fireEvent.click(screen.getByLabelText(/GC 1010/i));
    fireEvent.click(screen.getByLabelText(/GC 2020/i));
    expect(screen.getByText(/2 of 16/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Clear all/i));
    expect(screen.getByText(/0 of 16/i)).toBeInTheDocument();
  });

  it('calls onAnalyze with target + selected course payloads when clicked', () => {
    const onAnalyze = vi.fn();
    render(<TargetChainForm slug="s" targets={targets} courses={courses} onAnalyze={onAnalyze} isAnalyzing={false} />);
    fireEvent.click(screen.getByLabelText(/GC 1010/i));
    fireEvent.click(screen.getByLabelText(/GC 4060/i));
    fireEvent.click(screen.getByRole('button', { name: /Analyze/i }));
    expect(onAnalyze).toHaveBeenCalledWith({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: courses[0]!.syllabusText },
        { courseLabel: 'GC 4060', syllabusText: courses[2]!.syllabusText },
      ],
    });
  });
});
```

- [ ] **Step 2: Run failing test** — Expected: FAIL.

- [ ] **Step 3: Implement TargetChainForm**

Create `components/TargetChainForm.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { TargetKUDPreview } from './TargetKUDPreview';
import type { CareerTarget } from '@/lib/domain/types';

export interface TargetOption {
  id: string;
  name: string;
}

export interface CourseChoice {
  code: string;
  title: string;
  level: number;
  track: string;
  syllabusText: string;
}

export interface TargetChainAnalyzeInput {
  careerTargetId: string;
  courses: Array<{ courseLabel: string; syllabusText: string }>;
}

interface Props {
  slug: string;
  targets: TargetOption[];
  courses: CourseChoice[];
  fullTarget?: CareerTarget | null;  // for K/U/D preview; optional so loading state works
  onAnalyze: (input: TargetChainAnalyzeInput) => void;
  isAnalyzing: boolean;
}

const CAP = 16;
const MIN_TO_ANALYZE = 2;

export function TargetChainForm({ slug, targets, courses, fullTarget, onAnalyze, isAnalyzing }: Props) {
  const [careerTargetId, setCareerTargetId] = useState(targets[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const groupedByLevel = useMemo(() => {
    const groups = new Map<number, CourseChoice[]>();
    for (const c of courses) {
      const arr = groups.get(c.level) ?? [];
      arr.push(c);
      groups.set(c.level, arr);
    }
    for (const arr of groups.values()) arr.sort((a, b) => a.code.localeCompare(b.code));
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [courses]);

  function toggle(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setSelected(next);
  }

  function clearAll() {
    setSelected(new Set());
  }

  function handleAnalyze() {
    const orderedSelected = courses.filter(c => selected.has(c.code));
    onAnalyze({
      careerTargetId,
      courses: orderedSelected.map(c => ({ courseLabel: c.code, syllabusText: c.syllabusText })),
    });
  }

  const count = selected.size;
  const canAnalyze = count >= MIN_TO_ANALYZE && count <= CAP && Boolean(careerTargetId);
  const atCap = count >= CAP;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="target-picker">Career target</Label>
        <Select value={careerTargetId} onValueChange={setCareerTargetId}>
          <SelectTrigger id="target-picker" className="w-full">
            <SelectValue placeholder="Pick a career target" />
          </SelectTrigger>
          <SelectContent>
            {targets.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TargetKUDPreview slug={slug} target={fullTarget ?? null} />

      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            <span className={count > 0 ? 'text-foreground' : 'text-muted-foreground'}>{count} of {CAP}</span> max selected
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-blue-700 hover:underline disabled:text-muted-foreground"
            disabled={count === 0}
          >
            Clear all
          </button>
        </div>
        {groupedByLevel.length === 0 ? (
          <p className="text-sm text-muted-foreground">No courses loaded.</p>
        ) : (
          <div className="space-y-4">
            {groupedByLevel.map(([level, items]) => (
              <div key={level} className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Level {level}</div>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {items.map(c => {
                    const isSel = selected.has(c.code);
                    const disable = !isSel && atCap;
                    return (
                      <li key={c.code}>
                        <label className="flex items-center gap-2 rounded px-2 py-1 hover:bg-accent/40 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggle(c.code)}
                            disabled={disable}
                          />
                          <span className="text-sm">
                            <span className="font-medium">{c.code}</span>{' '}
                            <span className="text-muted-foreground">{c.title}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleAnalyze} disabled={!canAnalyze || isAnalyzing}>
          {isAnalyzing ? 'Analyzing…' : 'Analyze'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test** — Expected: 5 passing.

- [ ] **Step 5: tsc check** — clean.

- [ ] **Step 6: Stage + commit**

```bash
git add components/TargetChainForm.tsx tests/components/TargetChainForm.test.tsx
git commit -m "feat(ui): TargetChainForm with target picker + course-checkbox list"
```

---

### Task 14: `TargetChainResults` component + tab switcher + wiring

**Files:**
- Create: `components/TargetChainResults.tsx`
- Create: `components/TabSwitcher.tsx`
- Modify: `components/PrototypeForm.tsx` (add TargetKUDPreview slot)
- Modify: `app/preview/[slug]/PrototypeClient.tsx` (tab switcher, Tab 1 wiring)

- [ ] **Step 1: Create TargetChainResults**

Create `components/TargetChainResults.tsx`:

```tsx
'use client';

import { KUDCard } from './KUDCard';
import { CoverageHeatMap } from './CoverageHeatMap';
import { Separator } from './ui/separator';
import type { CareerTarget, TargetChainAnalysisResult } from '@/lib/domain/types';

interface Props {
  target: CareerTarget;
  result: TargetChainAnalysisResult;
  onFlag: (target: string, note: string, flagType: 'target_chain_coverage' | 'target_chain_scaffolding') => Promise<void>;
}

export function TargetChainResults({ target, result, onFlag }: Props) {
  const first = result.courses[0];
  const rest = result.courses.slice(1);
  if (!first) return null;

  return (
    <section className="space-y-8">
      <Separator />

      <div className="space-y-4">
        <h3 className="text-base font-medium">Course Know / Understand / Do outcomes</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {result.courses.map((c) => (
            <KUDCard key={c.courseLabel} courseLabel={c.courseLabel} kud={c.kud} />
          ))}
        </div>
      </div>

      <CoverageHeatMap
        target={target}
        courseLabel={first.courseLabel}
        courseScores={first.coverage}
        priorCoursework={rest.map(c => ({ courseLabel: c.courseLabel, coverage: c.coverage }))}
        scaffolding={result.scaffolding}
        onFlag={(t, n) => onFlag(t, n, 'target_chain_coverage')}
        mode="chain"
      />

      <footer className="text-xs text-muted-foreground pt-6 border-t">
        Analysis run with {result.meta.aiProvider} ({result.meta.aiModel}) in {(result.meta.durationMs / 1000).toFixed(1)}s. Cost ≈ ${(result.meta.costUsdCents / 10000).toFixed(2)}. {result.courses.length} courses in chain.
        {(result.meta.cachedTokens + result.meta.uncachedTokens) > 0 && (
          <> Cache hit: {((result.meta.cachedTokens / (result.meta.cachedTokens + result.meta.uncachedTokens)) * 100).toFixed(0)}%.</>
        )}
      </footer>
    </section>
  );
}
```

- [ ] **Step 2: Create TabSwitcher**

Create `components/TabSwitcher.tsx`:

```tsx
'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export type AnalysisTab = 'target' | 'prereqs';

export function TabSwitcher({ active }: { active: AnalysisTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  function switchTo(tab: AnalysisTab) {
    if (tab === active) return;
    const params = new URLSearchParams(search?.toString() ?? '');
    params.set('tab', tab);
    router.push(`${pathname}?${params.toString()}`);
  }

  const inactiveCls = 'rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground';
  const activeCls = 'rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium';

  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => switchTo('target')} className={active === 'target' ? activeCls : inactiveCls}>
        Career-target alignment
      </button>
      <button type="button" onClick={() => switchTo('prereqs')} className={active === 'prereqs' ? activeCls : inactiveCls}>
        Prereqs feeding a course
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Add `TargetKUDPreview` slot to `PrototypeForm`**

Open `components/PrototypeForm.tsx`. Find where the career-target select is rendered (the `<Select>` block bound to `careerTargetId`). Immediately AFTER that closing `</div>` of the target-picker block, render the preview:

```tsx
import { TargetKUDPreview } from './TargetKUDPreview';

// at top of component, add fullTarget loading:
const [fullTarget, setFullTarget] = useState<import('@/lib/domain/types').CareerTarget | null>(null);
useEffect(() => {
  if (!careerTargetId) { setFullTarget(null); return; }
  fetch('/api/targets').then(r => r.json()).then((data: import('@/lib/domain/types').CareerTarget[]) => {
    setFullTarget(data.find(t => t.id === careerTargetId) ?? null);
  }).catch(() => setFullTarget(null));
}, [careerTargetId]);

// in JSX after target picker:
<TargetKUDPreview slug={slug} target={fullTarget} />
```

The PrototypeForm already has the target picker — just locate it, then slot in the imports + the `useEffect` near the existing `useEffect` for targets list, and the JSX render right below the picker.

- [ ] **Step 4: Wire the tab switcher + Tab 1 into `PrototypeClient`**

Open `app/preview/[slug]/PrototypeClient.tsx`. Replace the file with this version:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrototypeForm, type AnalyzeInput } from '@/components/PrototypeForm';
import { TargetChainForm, type TargetChainAnalyzeInput, type CourseChoice, type TargetOption as TargetChainTargetOption } from '@/components/TargetChainForm';
import { TargetChainResults } from '@/components/TargetChainResults';
import { TabSwitcher, type AnalysisTab } from '@/components/TabSwitcher';
import { KUDCard } from '@/components/KUDCard';
import { CoverageHeatMap } from '@/components/CoverageHeatMap';
import { PrerequisiteGapPanel } from '@/components/PrerequisiteGapPanel';
import { Separator } from '@/components/ui/separator';
import type { AnalysisResult, TargetChainAnalysisResult, CareerTarget } from '@/lib/domain/types';

export function PrototypeClient({ slug }: { slug: string }) {
  const search = useSearchParams();
  const tab: AnalysisTab = search?.get('tab') === 'target' ? 'target' : 'prereqs';

  const [analyzing, setAnalyzing] = useState(false);
  const [prereqResult, setPrereqResult] = useState<AnalysisResult | null>(null);
  const [chainResult, setChainResult] = useState<TargetChainAnalysisResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetsList, setTargetsList] = useState<CareerTarget[]>([]);
  const [courses, setCourses] = useState<CourseChoice[]>([]);

  useEffect(() => {
    fetch('/api/targets').then(r => r.json()).then((data: CareerTarget[]) => setTargetsList(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== 'target') return;
    // Load all courses for the checkbox list. The /api/courses endpoint returns the list.
    fetch('/api/courses').then(r => r.json()).then(async (codes: Array<{ code: string; title: string; level: number; track: string }>) => {
      // For checkbox list we need the syllabus text too — fetch each course's record. To avoid 28 sequential fetches at page-load, we batch in parallel:
      const detailed = await Promise.all(codes.map(async (c) => {
        const r = await fetch(`/api/courses/${encodeURIComponent(c.code)}`);
        if (!r.ok) return null;
        const j = await r.json();
        return {
          code: c.code,
          title: c.title,
          level: c.level,
          track: c.track,
          syllabusText: formatSyllabusFromApi(j),
        } as CourseChoice;
      }));
      setCourses(detailed.filter((c): c is CourseChoice => c !== null));
    }).catch(() => {});
  }, [tab]);

  const targetsMap = new Map(targetsList.map(t => [t.id, t]));

  async function handlePrereqAnalyze(input: AnalyzeInput) {
    setAnalyzing(true); setError(null); setPrereqResult(null);
    try {
      const resp = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (!resp.ok) throw new Error(`Analysis failed: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
      const body = (await resp.json()) as AnalysisResult & { runId?: string };
      setPrereqResult(body);
      if (body.runId) setRunId(body.runId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleChainAnalyze(input: TargetChainAnalyzeInput) {
    setAnalyzing(true); setError(null); setChainResult(null);
    try {
      const resp = await fetch('/api/analyze/target-chain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (!resp.ok) throw new Error(`Analysis failed: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
      const body = (await resp.json()) as TargetChainAnalysisResult & { runId?: string };
      setChainResult(body);
      if (body.runId) setRunId(body.runId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFlag(target: string, note: string, flagType: string) {
    if (!runId) return;
    await fetch('/api/flag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId, flagType, target, note }) });
  }

  const prereqTarget = prereqResult ? targetsMap.get(prereqResult.careerTargetId) ?? null : null;
  const chainTarget = chainResult ? targetsMap.get(chainResult.careerTargetId) ?? null : null;

  const targetCount = targetsList.length || 5;
  const simpleTargetOptions: TargetChainTargetOption[] = targetsList.map(t => ({ id: t.id, name: t.name }));
  const targetForPreview: CareerTarget | null = (() => {
    if (tab !== 'target') return null;
    const id = chainResult?.careerTargetId ?? simpleTargetOptions[0]?.id;
    return id ? targetsMap.get(id) ?? null : null;
  })();

  return (
    <main className="mx-auto max-w-5xl p-6 md:p-12 space-y-10">
      <div className="rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground flex items-center justify-between gap-4">
        <span>Re-sync courses from the Google Sheet &middot; Edit career target definitions.</span>
        <a href={`/preview/${slug}/targets`} className="text-foreground underline underline-offset-2 font-medium whitespace-nowrap">
          Open admin →
        </a>
      </div>

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Clemson GC — Curriculum Tool Prototype</p>
        <h1 className="text-4xl font-semibold leading-tight">A working preview of how the curriculum tool will analyze courses.</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Two analyses, two questions. <em>Career-target alignment</em> evaluates how a set of courses build toward a career target ({targetCount} targets). <em>Prereqs feeding a course</em> evaluates whether a focal course&apos;s prior coursework actually prepares students for it. Pick the tab matching the question you&apos;re asking.
        </p>
      </header>

      <TabSwitcher active={tab} />

      {tab === 'target' && (
        <TargetChainForm
          slug={slug}
          targets={simpleTargetOptions}
          courses={courses}
          fullTarget={targetForPreview}
          onAnalyze={handleChainAnalyze}
          isAnalyzing={analyzing}
        />
      )}

      {tab === 'prereqs' && (
        <PrototypeForm slug={slug} onAnalyze={handlePrereqAnalyze} isAnalyzing={analyzing} />
      )}

      {error && (
        <div className="rounded border border-destructive bg-destructive/5 text-destructive p-4 text-sm">{error}</div>
      )}

      {tab === 'target' && chainResult && chainTarget && (
        <TargetChainResults
          target={chainTarget}
          result={chainResult}
          onFlag={(t, n, ft) => handleFlag(t, n, ft)}
        />
      )}

      {tab === 'prereqs' && prereqResult && prereqTarget && (
        <section className="space-y-8">
          <Separator />
          <div className="space-y-4">
            <h3 className="text-base font-medium">Course being analyzed — Know / Understand / Do outcomes</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <KUDCard courseLabel={prereqResult.course.courseLabel} kud={prereqResult.course.kud} />
            </div>
          </div>
          <div className="space-y-4">
            <h3 className="text-base font-medium text-muted-foreground">Prior coursework — Know / Understand / Do outcomes</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {prereqResult.priorCoursework.map((c, i) => (
                <KUDCard key={i} courseLabel={c.courseLabel} kud={c.kud} />
              ))}
            </div>
          </div>
          <CoverageHeatMap
            target={prereqTarget}
            courseLabel={prereqResult.course.courseLabel}
            courseScores={prereqResult.course.coverage}
            priorCoursework={prereqResult.priorCoursework.map(c => ({ courseLabel: c.courseLabel, coverage: c.coverage }))}
            scaffolding={prereqResult.scaffolding}
            onFlag={(t, n) => handleFlag(t, n, 'coverage')}
          />
          <PrerequisiteGapPanel
            target={prereqTarget}
            courseLabel={prereqResult.course.courseLabel}
            gaps={prereqResult.course.prerequisiteGaps}
            onFlag={(t, n) => handleFlag(t, n, 'prerequisite_gap')}
          />
          <footer className="text-xs text-muted-foreground pt-6 border-t">
            Analysis run with {prereqResult.meta.aiProvider} ({prereqResult.meta.aiModel}) in {(prereqResult.meta.durationMs / 1000).toFixed(1)}s. Cost ≈ ${(prereqResult.meta.costUsdCents / 10000).toFixed(2)}.{' '}
            {prereqResult.priorCoursework.length} prior course{prereqResult.priorCoursework.length !== 1 ? 's' : ''}.
          </footer>
        </section>
      )}

      <footer className="pt-12 border-t text-sm text-muted-foreground">
        This is a prototype — see the <a className="underline" href="https://chiptoe-svg.github.io/gc-curriculum-tool/docs/superpowers/vision/gc-curriculum-tool-vision.html" target="_blank" rel="noopener noreferrer">vision for the full tool</a>.
      </footer>
    </main>
  );
}

// Format a course-record API response into the labeled-markdown syllabus the
// /api/analyze endpoints accept. Mirrors what lib/courses/formatCourseSyllabus
// already does for prereq form usage.
function formatSyllabusFromApi(r: {
  description: string | null;
  prerequisites: string | null;
  learningObjectives: string[] | null;
  majorProjects: string[] | null;
  skillsRequired: string[] | null;
}): string {
  const parts: string[] = [];
  if (r.description) parts.push(`Description:\n${r.description}`);
  if (r.prerequisites) parts.push(`Prerequisites:\n${r.prerequisites}`);
  if (r.learningObjectives && r.learningObjectives.length > 0) parts.push(`Learning objectives:\n${r.learningObjectives.map(o => `- ${o}`).join('\n')}`);
  if (r.majorProjects && r.majorProjects.length > 0) parts.push(`Major projects:\n${r.majorProjects.map(p => `- ${p}`).join('\n')}`);
  if (r.skillsRequired && r.skillsRequired.length > 0) parts.push(`Skills:\n${r.skillsRequired.map(s => `- ${s}`).join('\n')}`);
  return parts.join('\n\n');
}
```

- [ ] **Step 5: Smoke test**

Run: `pnpm dev`. Open `http://localhost:3000/preview/<your-slug>?tab=target`. Verify:

1. Tab switcher appears, "Career-target alignment" is active.
2. Target picker renders, K/U/D preview expands when clicked.
3. Course checkbox list loads grouped by level.
4. Pick 2+ courses, click Analyze, see results.

Then `?tab=prereqs` — verify the existing flow still works exactly as before.

- [ ] **Step 6: Run full test suite + tsc + lint**

```bash
pnpm test 2>&1 | tail -5
pnpm exec tsc --noEmit
pnpm lint 2>&1 | tail -10
```

Expected: all tests passing, tsc clean, no NEW lint errors introduced by Phase E files (the pre-existing `tests/lib/rate-limit/ip-rate-limit.test.ts` `no-explicit-any` is allowed).

If new lint errors from your files appear (most likely `react/no-unescaped-entities` from apostrophes), fix them inline by replacing `'` with `&apos;` in the affected JSX strings.

- [ ] **Step 7: Stage + commit**

```bash
git add components/TargetChainResults.tsx components/TabSwitcher.tsx components/PrototypeForm.tsx app/preview/[slug]/PrototypeClient.tsx
git commit -m "feat(ui): tab switcher + Tab 1 wiring + TargetKUDPreview in Tab 2 form"
```

---

## Phase F — Documentation

### Task 15: Documentation pass

**Files:**
- Modify: `docs/superpowers/README.md`
- Modify: `README.md`

- [ ] **Step 1: Update the docs index**

In `docs/superpowers/README.md`, add a row to the Plans table:

```markdown
| 2026-05-19 | [`plans/2026-05-19-m-trial-dual-analysis-modes.md`](./plans/2026-05-19-m-trial-dual-analysis-modes.md) | ✅ Done. M-trial: split the single Analyze button into Career-target alignment + Prereqs feeding a course tabs, with inline K/U/D preview of the selected target on both tabs (15 tasks). |
```

(Mark Done only after all 14 implementation tasks above are complete and verified.)

- [ ] **Step 2: Update top-level README**

In `README.md`, under Status, after the existing M-trial line, append:

```markdown
**M-trial dual analysis modes shipped.** /preview/[slug] now offers two analyses via a tab switcher: *Career-target alignment* (a chain of 2–16 courses vs. a target → coverage heat map + scaffolding) and *Prereqs feeding a course* (the existing focal-course-plus-priors flow, unchanged). Both tabs show an inline K/U/D preview of the selected target with an *Edit →* link to the existing target editor.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/README.md README.md
git commit -m "docs: mark M-trial dual analysis modes complete"
```

---

## Plan Self-Review Checklist

After implementing all 15 tasks, verify:

- [ ] **Spec coverage:**
  - Two API routes (`/api/analyze` refactored, `/api/analyze/target-chain` new) — T9, T10.
  - Shared helpers under `lib/ai/analyze/` — T3, T4, T5, T6, T7, T8.
  - `analysis_kind` discriminator on `prototype_runs` — T1.
  - `TargetKUDPreview` component (collapsed, expandable, "Edit →" link) — T12. Slotted into both tabs — T14 step 3.
  - `TargetChainForm` (target picker + checkbox list + counter + cap) — T13.
  - `TargetChainResults` (KUD cards + heat map in chain mode + footer telemetry) — T14 step 1.
  - `CoverageHeatMap` gains `mode` prop — T11.
  - Tab switcher with URL state, default `prereqs` — T14 step 2, T14 step 4.

- [ ] **No partner-facing surface touched.** All new code lives under `app/preview/`, `app/api/analyze/`, and `lib/ai/analyze/`. `app/partners/`, `app/admin/partners/`, `app/admin/synthesis/` are untouched.

- [ ] **`/api/analyze` external contract unchanged.** Request shape and response shape are byte-identical to before this plan; only the internals refactored. The existing `tests/api/analyze.test.ts` passes without assertion changes (only imports may need updating if it referenced internal helpers).

- [ ] **Migration ordering.** `0008_*.sql` is the next slot. Plan 1 and Plan 3 of Industry Partner Input shipped through `0007`. No conflicts.

- [ ] **Type consistency:** `TargetChainAnalysisResult` defined in `lib/domain/types.ts` (T2), referenced by `InsertRunInput.result` (T1), produced by `/api/analyze/target-chain` (T10), consumed by `TargetChainResults` (T14). All four agree on shape.

- [ ] **Tab default = prereqs** so the M-trial pilot UX doesn't change for current faculty. T14 step 4's `tab` derivation (`search?.get('tab') === 'target' ? 'target' : 'prereqs'`) defaults to `'prereqs'` when no query param is present.

- [ ] **Cost guards** still fire before any LLM call in both routes (T9 calls `applyAnalyzeGuards` before target context build; T10 same).

- [ ] **Backwards compatibility:** `CoverageHeatMap`'s `mode` prop defaults to `'focal-plus-priors'` (T11). Existing callers without the prop render exactly as before.

If any check fails, fix inline before declaring the plan done.

---

## What's NOT in this plan (deferred)

- **Faculty assignment intake** — separate brainstorm queued after this plan ships. Will produce enriched KUDs that the `draftKUD` helper can optionally pull from instead of regenerating from raw syllabus.
- **Editing career targets inline on the analysis page.** Out of scope. The "Edit →" link routes to the existing editor at `/preview/[slug]/targets/[id]`.
- **Drag-to-reorder courses in Tab 1.** Out of scope. Order is derived from `parseLevelFromLabel`.
- **Persisting Tab 1 runs to a separate table.** Out of scope. `analysis_kind` discriminator column is enough.
- **Admin dashboards aggregating runs by analysis kind.** Out of scope.
- **CoverageHeatMap visual polish** beyond the `mode` prop. Out of scope; the existing component works.
