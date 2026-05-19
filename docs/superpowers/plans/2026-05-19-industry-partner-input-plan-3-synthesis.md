# Industry Partner Input — Plan 3: AI Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the AI synthesis layer for the Industry Partner Input Tool — a per-career-target faculty dashboard that aggregates partner submissions, synthesizes themes via the existing AI provider abstraction, and proposes concrete edits to Know/Understand/Do descriptors. No auto-write-back; faculty stays the gate for every change.

**Architecture:** Reuse the existing `lib/ai/` provider abstraction (system prompt + user message + JSON schema → validated typed result + cost telemetry). New `lib/ai/synthesis/` module orchestrates: load partner submissions for a target, build the structured prompt with partner identity + weight, call provider, validate against a Zod schema, mix in deterministic salary-distribution math (SQL — not LLM math), persist to a new `synthesis_runs` table, record spend through the existing `daily-cap` helper. A new admin surface at `/admin/synthesis/...` renders the cached result with re-run controls.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle ORM + Neon Postgres, Vitest, OpenAI provider (default) via existing `lib/ai/provider.ts`, Zod for response validation, Tailwind v4. Package manager: pnpm.

**Spec:** [`docs/superpowers/specs/2026-05-18-industry-partner-input-design.md`](../specs/2026-05-18-industry-partner-input-design.md) — sections "Faculty admin surface — Per-target synthesis" and "AI synthesis pipeline".

**Prior plan:** [`2026-05-19-industry-partner-input-plan-1-foundation.md`](./2026-05-19-industry-partner-input-plan-1-foundation.md) — shipped 2026-05-19; partner identity + submission flow.

**Out of scope (deferred):**
- Project-ratings heat map — requires `partner_project_ratings` table from Plan 2. Will ship as a separate small plan once Plan 2 lands.
- Karpathy-wiki cross-target synthesis — v2 of this surface.
- Auto-write-back of accepted KUD diffs to the `careerTargets` / `subCompetencies` tables — faculty paste manually for v1.

---

## File Structure

**New files:**

```
lib/
  ai/
    prompts/
      synthesize-target.md           # the synthesis system prompt
    synthesis/
      schema.ts                      # Zod + JSON schema for SynthesisResult
      prompt-builder.ts              # build the user message from partner submissions + KUD descriptors
      orchestrator.ts                # synthesizeTarget(targetId) entry point
      staleness.ts                   # stalenessCheck(targetId) helper
      queries.ts                     # SQL aggregations (header stats, salary distribution, unmapped labels)

app/
  admin/
    synthesis/
      page.tsx                       # index — list all career targets with synthesis status
      targets/
        [targetId]/
          page.tsx                   # per-target dashboard (server component)
          HeaderStats.tsx            # # submissions, # partners, weighted sum, salary, unmapped labels
          SynthesizedInsightsPanel.tsx
          ProposedKUDEditsPanel.tsx
          ReRunButton.tsx            # client; calls POST endpoint, shows cost inline
  api/
    admin/
      synthesis/
        [targetId]/
          run/
            route.ts                 # POST — trigger synthesis run

drizzle/
  0007_<auto>.sql                    # synthesis_runs

tests/
  ai/
    synthesis/
      schema.test.ts
      prompt-builder.test.ts
      orchestrator.test.ts
      staleness.test.ts
      queries.test.ts
  api/
    admin-synthesis-run.test.ts
```

**Modified files:**

- `lib/db/schema.ts` — append `synthesisRuns` table (T1).
- `lib/ai/prompts/load.ts` — extend `PromptName` union to include `'synthesize-target'` (T4).
- `.env.example` — add `SYNTHESIS_STALENESS_THRESHOLD` (T6).

---

## Phase A — Data + aggregation queries

### Task 1: Add `synthesis_runs` table to Drizzle schema

**Files:**
- Modify: `lib/db/schema.ts`
- Generate: `drizzle/0007_<auto>.sql`
- Test: `lib/db/__tests__/synthesis-runs-schema.test.ts` (create)

- [ ] **Step 1: Append the table definition to `lib/db/schema.ts`**

After the `partnerSubmissions` table at the end of the file, add:

```typescript
export const synthesisRuns = pgTable('synthesis_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  careerTargetId: text('career_target_id').notNull().references(() => careerTargets.id, { onDelete: 'cascade' }),
  submissionCount: integer('submission_count').notNull(),
  result: jsonb('result').notNull(),
  model: text('model').notNull(),
  costUsdCents: integer('cost_usd_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Generate + apply migration**

Run: `pnpm db:generate && pnpm db:migrate`. Expected: a new `drizzle/0007_*.sql` is created with `CREATE TABLE synthesis_runs (...)` and applied to the Neon DB.

If `pnpm db:migrate` complains about `DATABASE_URL` not being set, prefix with: `set -a && source .env.local && set +a && pnpm db:migrate`.

- [ ] **Step 3: Write the schema smoke test**

Create `lib/db/__tests__/synthesis-runs-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { synthesisRuns } from '@/lib/db/schema';

describe('synthesis_runs schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(synthesisRuns);
    for (const c of ['id', 'careerTargetId', 'submissionCount', 'result', 'model', 'costUsdCents', 'createdAt']) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 4: Run the schema test**

Run: `pnpm test lib/db/__tests__/synthesis-runs-schema.test.ts`
Expected: 1 passing test.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts drizzle/0007_*.sql lib/db/__tests__/synthesis-runs-schema.test.ts
git commit -m "feat(db): synthesis_runs table"
```

---

### Task 2: Synthesis aggregation queries (pure SQL, no LLM)

**Files:**
- Create: `lib/ai/synthesis/queries.ts`
- Test: `tests/ai/synthesis/queries.test.ts` (create)

The header stats on the per-target page (# submissions, # unique partners, weighted sum, salary distribution, unmapped labels) are deterministic — they're recomputed every page render rather than cached in `synthesis_runs`. The salary distribution is also passed into the orchestrator and mixed into the synthesis result so the LLM never has to compute percentiles.

- [ ] **Step 1: Write the failing test**

Create `tests/ai/synthesis/queries.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbExecute = vi.fn();
const dbSelect = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    execute: dbExecute,
    select: dbSelect,
  },
}));
vi.mock('@/lib/db/schema', () => ({
  partnerSubmissions: {},
  partners: {},
}));

import {
  countSubmittedForTarget,
  countUniquePartnersForTarget,
  sumPartnerWeightsForTarget,
  salaryDistributionForTarget,
  nearbyUnmappedLabelsForTarget,
} from '@/lib/ai/synthesis/queries';

beforeEach(() => {
  dbExecute.mockReset();
  dbSelect.mockReset();
});

describe('countSubmittedForTarget', () => {
  it('returns the integer count', async () => {
    dbExecute.mockResolvedValue({ rows: [{ n: 7 }] });
    const n = await countSubmittedForTarget('production-operations');
    expect(n).toBe(7);
  });

  it('returns 0 when no rows', async () => {
    dbExecute.mockResolvedValue({ rows: [] });
    const n = await countSubmittedForTarget('production-operations');
    expect(n).toBe(0);
  });
});

describe('countUniquePartnersForTarget', () => {
  it('returns the distinct partner count', async () => {
    dbExecute.mockResolvedValue({ rows: [{ n: 4 }] });
    const n = await countUniquePartnersForTarget('production-operations');
    expect(n).toBe(4);
  });
});

describe('sumPartnerWeightsForTarget', () => {
  it('sums partners.weight across distinct partners who submitted', async () => {
    dbExecute.mockResolvedValue({ rows: [{ s: 11 }] });
    const s = await sumPartnerWeightsForTarget('production-operations');
    expect(s).toBe(11);
  });

  it('returns 0 when no partners', async () => {
    dbExecute.mockResolvedValue({ rows: [{ s: null }] });
    const s = await sumPartnerWeightsForTarget('production-operations');
    expect(s).toBe(0);
  });
});

describe('salaryDistributionForTarget', () => {
  it('returns p25/p50/p75 + n when salaries are present', async () => {
    dbExecute.mockResolvedValue({
      rows: [{ p25: 48000, p50: 55000, p75: 65000, n: 6 }],
    });
    const d = await salaryDistributionForTarget('production-operations');
    expect(d).toEqual({ p25: 48000, p50: 55000, p75: 65000, n: 6 });
  });

  it('returns n=0 with no percentiles when no salaries reported', async () => {
    dbExecute.mockResolvedValue({ rows: [{ p25: null, p50: null, p75: null, n: 0 }] });
    const d = await salaryDistributionForTarget('production-operations');
    expect(d).toEqual({ n: 0 });
  });
});

describe('nearbyUnmappedLabelsForTarget', () => {
  it('returns up to 20 unmapped labels with their submission counts', async () => {
    dbExecute.mockResolvedValue({
      rows: [
        { label: 'Packaging design lead', count: 3 },
        { label: 'Pre-press supervisor', count: 1 },
      ],
    });
    const labels = await nearbyUnmappedLabelsForTarget('production-operations');
    expect(labels).toHaveLength(2);
    expect(labels[0]).toEqual({ label: 'Packaging design lead', count: 3 });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm test tests/ai/synthesis/queries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the queries module**

Create `lib/ai/synthesis/queries.ts`:

```typescript
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

export interface SalaryDistribution {
  p25?: number;
  p50?: number;
  p75?: number;
  n: number;
}

export interface UnmappedLabel {
  label: string;
  count: number;
}

export async function countSubmittedForTarget(targetId: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM partner_submissions
    WHERE status = 'submitted' AND career_target_id = ${targetId}
  `);
  return (r.rows[0] as { n: number } | undefined)?.n ?? 0;
}

export async function countUniquePartnersForTarget(targetId: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(DISTINCT partner_id)::int AS n
    FROM partner_submissions
    WHERE status = 'submitted' AND career_target_id = ${targetId}
  `);
  return (r.rows[0] as { n: number } | undefined)?.n ?? 0;
}

export async function sumPartnerWeightsForTarget(targetId: string): Promise<number> {
  // Sum distinct partners' weights — a partner who submitted 3 positions for the
  // same target still counts once for the weighted-sum stat (their voice isn't
  // amplified by repeating themselves).
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(weight), 0)::int AS s
    FROM partners
    WHERE id IN (
      SELECT DISTINCT partner_id
      FROM partner_submissions
      WHERE status = 'submitted' AND career_target_id = ${targetId}
    )
  `);
  return (r.rows[0] as { s: number | null } | undefined)?.s ?? 0;
}

export async function salaryDistributionForTarget(targetId: string): Promise<SalaryDistribution> {
  // Take the midpoint of low/high when both present; fall back to whichever is set.
  // Currency is ignored in v1 — most partners will be USD; we can normalize later.
  const r = await db.execute(sql`
    WITH samples AS (
      SELECT
        CASE
          WHEN salary_range_low IS NOT NULL AND salary_range_high IS NOT NULL
            THEN (salary_range_low + salary_range_high) / 2
          ELSE COALESCE(salary_range_low, salary_range_high)
        END AS sal
      FROM partner_submissions
      WHERE status = 'submitted'
        AND career_target_id = ${targetId}
        AND (salary_range_low IS NOT NULL OR salary_range_high IS NOT NULL)
    )
    SELECT
      PERCENTILE_DISC(0.25) WITHIN GROUP (ORDER BY sal)::int AS p25,
      PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY sal)::int AS p50,
      PERCENTILE_DISC(0.75) WITHIN GROUP (ORDER BY sal)::int AS p75,
      COUNT(*)::int AS n
    FROM samples
  `);
  const row = r.rows[0] as { p25: number | null; p50: number | null; p75: number | null; n: number } | undefined;
  const n = row?.n ?? 0;
  if (n === 0) return { n: 0 };
  return {
    p25: row?.p25 ?? undefined,
    p50: row?.p50 ?? undefined,
    p75: row?.p75 ?? undefined,
    n,
  };
}

export async function nearbyUnmappedLabelsForTarget(_targetId: string): Promise<UnmappedLabel[]> {
  // For v1, "nearby" just means "every unmapped label on any submission". A future
  // iteration can use embedding similarity to filter to labels actually adjacent
  // to this target. The point of the stat is to surface emerging target gaps.
  const r = await db.execute(sql`
    SELECT
      unmapped_target_label AS label,
      COUNT(*)::int AS count
    FROM partner_submissions
    WHERE status = 'submitted'
      AND unmapped_target_label IS NOT NULL
      AND career_target_id IS NULL
    GROUP BY unmapped_target_label
    ORDER BY count DESC, unmapped_target_label
    LIMIT 20
  `);
  return r.rows as UnmappedLabel[];
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/ai/synthesis/queries.test.ts`
Expected: 7 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/synthesis/queries.ts tests/ai/synthesis/queries.test.ts
git commit -m "feat(synthesis): SQL aggregation queries for target header stats"
```

---

## Phase B — AI synthesis pipeline

### Task 3: Zod + JSON schema for SynthesisResult

**Files:**
- Create: `lib/ai/synthesis/schema.ts`
- Test: `tests/ai/synthesis/schema.test.ts` (create)

This pairs a Zod parser (used for client-side validation) with a JSON schema object (used by OpenAI's structured-outputs `response_format`).

- [ ] **Step 1: Write the failing test**

Create `tests/ai/synthesis/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { synthesisResultSchema, synthesisResultJsonSchema } from '@/lib/ai/synthesis/schema';

describe('synthesisResultSchema', () => {
  it('accepts a minimal valid result', () => {
    const minimal = {
      aggregatedJobTitles: [],
      responsibilityThemes: [],
      commonRequiredSkills: [],
      commonNiceToHaveSkills: [],
      interviewQuestionThemes: [],
      salaryDistribution: { n: 0 },
      sampleQuotes: [],
      proposedKUDEdits: [],
    };
    expect(() => synthesisResultSchema.parse(minimal)).not.toThrow();
  });

  it('accepts a populated result', () => {
    const full = {
      aggregatedJobTitles: [{ title: 'Press Operator', count: 3, partnerIds: ['p1', 'p2', 'p3'] }],
      responsibilityThemes: [
        { theme: 'Color management', quotedFrom: [{ partnerId: 'p1', snippet: 'must hit Pantone match' }] },
      ],
      commonRequiredSkills: [{ skill: 'GMI', count: 2 }],
      commonNiceToHaveSkills: [{ skill: 'Esko ArtPro+', count: 1 }],
      interviewQuestionThemes: [
        { theme: 'Color science', examples: ['Explain delta-E.'] },
      ],
      salaryDistribution: { p25: 48000, p50: 55000, p75: 65000, n: 6 },
      sampleQuotes: [{ partnerId: 'p1', quote: 'We hire for color literacy first.' }],
      proposedKUDEdits: [
        {
          descriptor: 'know',
          type: 'addition',
          proposedText: 'Color management workflows including spectrophotometric measurement and ICC profile generation.',
          rationale: '7 of 12 submissions mention color management; not currently in Know descriptors.',
          supportingPartnerIds: ['p1', 'p2'],
        },
      ],
    };
    expect(() => synthesisResultSchema.parse(full)).not.toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => synthesisResultSchema.parse({ aggregatedJobTitles: [] })).toThrow();
  });

  it('rejects an invalid descriptor value on a proposed edit', () => {
    const bad = {
      aggregatedJobTitles: [],
      responsibilityThemes: [],
      commonRequiredSkills: [],
      commonNiceToHaveSkills: [],
      interviewQuestionThemes: [],
      salaryDistribution: { n: 0 },
      sampleQuotes: [],
      proposedKUDEdits: [
        { descriptor: 'nonsense', type: 'addition', proposedText: 'x', rationale: 'y', supportingPartnerIds: [] },
      ],
    };
    expect(() => synthesisResultSchema.parse(bad)).toThrow();
  });
});

describe('synthesisResultJsonSchema', () => {
  it('is a JSON Schema object with required top-level fields', () => {
    expect(synthesisResultJsonSchema.type).toBe('object');
    const required = synthesisResultJsonSchema.required ?? [];
    for (const f of ['aggregatedJobTitles', 'responsibilityThemes', 'commonRequiredSkills',
                     'commonNiceToHaveSkills', 'interviewQuestionThemes', 'salaryDistribution',
                     'sampleQuotes', 'proposedKUDEdits']) {
      expect(required).toContain(f);
    }
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm test tests/ai/synthesis/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema module**

Create `lib/ai/synthesis/schema.ts`:

```typescript
import { z } from 'zod';

const jobTitleSchema = z.object({
  title: z.string().min(1),
  count: z.number().int().nonnegative(),
  partnerIds: z.array(z.string()),
});

const responsibilityThemeSchema = z.object({
  theme: z.string().min(1),
  quotedFrom: z.array(z.object({
    partnerId: z.string(),
    snippet: z.string().min(1),
  })),
});

const skillCountSchema = z.object({
  skill: z.string().min(1),
  count: z.number().int().nonnegative(),
});

const interviewThemeSchema = z.object({
  theme: z.string().min(1),
  examples: z.array(z.string().min(1)),
});

const salaryDistributionSchema = z.object({
  p25: z.number().int().optional(),
  p50: z.number().int().optional(),
  p75: z.number().int().optional(),
  n: z.number().int().nonnegative(),
});

const sampleQuoteSchema = z.object({
  partnerId: z.string(),
  quote: z.string().min(1),
});

const proposedKUDEditSchema = z.object({
  descriptor: z.enum(['know', 'understand', 'do']),
  type: z.enum(['addition', 'edit']),
  targetDescriptorIndex: z.number().int().nonnegative().optional(),
  proposedText: z.string().min(1),
  rationale: z.string().min(1),
  supportingPartnerIds: z.array(z.string()),
});

export const synthesisResultSchema = z.object({
  aggregatedJobTitles: z.array(jobTitleSchema),
  responsibilityThemes: z.array(responsibilityThemeSchema),
  commonRequiredSkills: z.array(skillCountSchema),
  commonNiceToHaveSkills: z.array(skillCountSchema),
  interviewQuestionThemes: z.array(interviewThemeSchema),
  salaryDistribution: salaryDistributionSchema,
  sampleQuotes: z.array(sampleQuoteSchema),
  proposedKUDEdits: z.array(proposedKUDEditSchema),
});

export type SynthesisResult = z.infer<typeof synthesisResultSchema>;

// JSON Schema for OpenAI structured outputs. Mirrors the Zod schema above.
// Keep in sync — if you change one, change the other.
export const synthesisResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'aggregatedJobTitles', 'responsibilityThemes', 'commonRequiredSkills',
    'commonNiceToHaveSkills', 'interviewQuestionThemes', 'salaryDistribution',
    'sampleQuotes', 'proposedKUDEdits',
  ],
  properties: {
    aggregatedJobTitles: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'count', 'partnerIds'],
        properties: {
          title: { type: 'string' },
          count: { type: 'integer', minimum: 0 },
          partnerIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    responsibilityThemes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['theme', 'quotedFrom'],
        properties: {
          theme: { type: 'string' },
          quotedFrom: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              required: ['partnerId', 'snippet'],
              properties: {
                partnerId: { type: 'string' },
                snippet: { type: 'string' },
              },
            },
          },
        },
      },
    },
    commonRequiredSkills: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['skill', 'count'],
        properties: { skill: { type: 'string' }, count: { type: 'integer', minimum: 0 } },
      },
    },
    commonNiceToHaveSkills: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['skill', 'count'],
        properties: { skill: { type: 'string' }, count: { type: 'integer', minimum: 0 } },
      },
    },
    interviewQuestionThemes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['theme', 'examples'],
        properties: {
          theme: { type: 'string' },
          examples: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    salaryDistribution: {
      type: 'object', additionalProperties: false,
      required: ['n'],
      properties: {
        p25: { type: 'integer' },
        p50: { type: 'integer' },
        p75: { type: 'integer' },
        n: { type: 'integer', minimum: 0 },
      },
    },
    sampleQuotes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['partnerId', 'quote'],
        properties: { partnerId: { type: 'string' }, quote: { type: 'string' } },
      },
    },
    proposedKUDEdits: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['descriptor', 'type', 'proposedText', 'rationale', 'supportingPartnerIds'],
        properties: {
          descriptor: { type: 'string', enum: ['know', 'understand', 'do'] },
          type: { type: 'string', enum: ['addition', 'edit'] },
          targetDescriptorIndex: { type: 'integer', minimum: 0 },
          proposedText: { type: 'string' },
          rationale: { type: 'string' },
          supportingPartnerIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/ai/synthesis/schema.test.ts`
Expected: 5 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/synthesis/schema.ts tests/ai/synthesis/schema.test.ts
git commit -m "feat(synthesis): Zod + JSON schema for SynthesisResult"
```

---

### Task 4: Synthesis prompt file + PromptName extension

**Files:**
- Create: `lib/ai/prompts/synthesize-target.md`
- Modify: `lib/ai/prompts/load.ts`

- [ ] **Step 1: Create the prompt**

Create `lib/ai/prompts/synthesize-target.md`:

```markdown
---
name: synthesize-target
---

# Task

You are synthesizing input from multiple industry partners about a specific career target the Clemson Graphic Communications curriculum builds toward. Your job is to (1) aggregate what partners said into themes and counts and (2) propose concrete additions or edits to the target's existing Know / Understand / Do (KUD) descriptors — never invent edits the data doesn't support.

# Inputs you will receive

The user message contains:

1. The career target: its `id`, `name`, `shortDefinition`, and current Know / Understand / Do descriptors as numbered lists.
2. A salary distribution object computed deterministically from the data (do not modify it; pass it through unchanged in your output).
3. An enumerated list of partner submissions for this target. Each submission carries:
   - The partner's real first/last name and company.
   - A `weight` integer (default 1, faculty-set). Higher-weighted partners reflect employers who hire more GC graduates or whose roles are more representative of where the program places students.
   - The partner's position title, responsibilities, required and nice-to-have skills, interview questions, and additional notes.

# Weighting

Give submissions with higher `weight` proportionally more influence on the proposed edits and on what shows up in the aggregated themes. A `weight: 5` Coca-Cola submission should shape the synthesis more than a `weight: 1` submission from a five-person print shop, when their inputs conflict. When they agree, the agreement is the story. Do not invent details about a company from your general knowledge — only use what the partner wrote.

# Output

Return a JSON object matching the schema. Specifically:

- `aggregatedJobTitles`: cluster near-duplicate titles ("Press Op", "Press Operator", "Operator – press") into one entry. `partnerIds` lists every partner whose submission contributed.
- `responsibilityThemes`: 3–8 themes that recur across submissions. Each theme carries 1–3 short verbatim quotes from partners.
- `commonRequiredSkills` / `commonNiceToHaveSkills`: dedup'd skill names with counts. Normalize obvious variants (e.g., "Color Mgmt" → "Color management").
- `interviewQuestionThemes`: cluster questions by what they test for. Each theme carries 1–3 example questions taken directly from partner submissions.
- `salaryDistribution`: copy the input salary distribution exactly. Do not modify percentiles or `n`.
- `sampleQuotes`: 2–5 short verbatim quotes that capture distinctive partner voice. Prefer quotes that aren't already in `responsibilityThemes.quotedFrom`.
- `proposedKUDEdits`: 0–8 concrete proposed edits. Each one:
  - Sets `descriptor` to `know`, `understand`, or `do`.
  - Sets `type` to `addition` (a new bullet) or `edit` (modify an existing numbered bullet — provide `targetDescriptorIndex` zero-based).
  - `proposedText`: the text to add or replace with. Single sentence, students-can-do form (just the substantive bullet — no "Students will Know" prefix).
  - `rationale`: 1–2 sentences explaining what in the data supports this edit. Cite counts: "5 of 12 partners (3 weighted ≥3) mentioned X."
  - `supportingPartnerIds`: list of partner IDs whose submissions support this specific edit.

# Constraints

- Never propose an edit unsupported by at least 2 submissions (or 1 weighted ≥3). Faculty curate edits manually; surfacing weak signal wastes their attention.
- Never write text into the output that isn't grounded in the partner submissions. If responsibilities are sparse, fewer themes is fine.
- Do not summarize partners using your background knowledge of their companies — only use what they wrote in the submission.
- Quotes must be verbatim or near-verbatim (light cleanup for spelling only). Never invent a quote.
```

- [ ] **Step 2: Extend the `PromptName` union**

Open `lib/ai/prompts/load.ts` and find the `type PromptName = ...` declaration. Replace:

```typescript
type PromptName =
  | 'draft-outcomes'
  | 'score-coverage'
  | 'suggest-prerequisites'
  | 'analyze-prerequisite-gaps'
  | 'evaluate-scaffolding';
```

with:

```typescript
type PromptName =
  | 'draft-outcomes'
  | 'score-coverage'
  | 'suggest-prerequisites'
  | 'analyze-prerequisite-gaps'
  | 'evaluate-scaffolding'
  | 'synthesize-target';
```

- [ ] **Step 3: tsc check**

Run: `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/synthesize-target.md lib/ai/prompts/load.ts
git commit -m "feat(synthesis): synthesize-target prompt + register in PromptName union"
```

---

### Task 5: Prompt builder — assemble the user message from partner submissions

**Files:**
- Create: `lib/ai/synthesis/prompt-builder.ts`
- Test: `tests/ai/synthesis/prompt-builder.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/ai/synthesis/prompt-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSynthesisUserMessage } from '@/lib/ai/synthesis/prompt-builder';

const target = {
  id: 'production-operations',
  name: 'Production Operations',
  shortDefinition: 'Running the press floor day-to-day.',
  knowDescriptors: ['Press mechanics fundamentals', 'Substrate behavior under heat and pressure'],
  understandDescriptors: ['How a make-ready decision affects yield'],
  doDescriptors: ['Sustain a target color tolerance across a 10k impression run'],
};

const submissions = [
  {
    partnerId: 'p1', firstName: 'Alex', lastName: 'Jordan', company: 'Acme Print', weight: 1,
    positionTitle: 'Press Operator', responsibilities: 'Run the 8-color press; troubleshoot.',
    requiredSkills: ['Color management'], niceToHaveSkills: ['GMI cert'],
    interviewQuestions: ['How do you sequence a make-ready?'],
    additionalNotes: 'Want grads who can work nights.',
    salaryRangeLow: 48000, salaryRangeHigh: 55000, salaryCurrency: 'USD',
  },
  {
    partnerId: 'p2', firstName: 'Beth', lastName: 'Smith', company: 'Coca-Cola', weight: 5,
    positionTitle: 'Packaging Color Lead', responsibilities: 'Brand color governance across suppliers.',
    requiredSkills: ['Color management', 'Pantone Live'], niceToHaveSkills: [],
    interviewQuestions: [],
    additionalNotes: '',
    salaryRangeLow: 80000, salaryRangeHigh: 110000, salaryCurrency: 'USD',
  },
];

const salaryDistribution = { p25: 51500, p50: 70000, p75: 95000, n: 2 };

describe('buildSynthesisUserMessage', () => {
  it('includes career target identity and current KUD descriptors', () => {
    const msg = buildSynthesisUserMessage({ target, submissions, salaryDistribution });
    expect(msg).toContain('Production Operations');
    expect(msg).toContain('production-operations');
    expect(msg).toContain('Press mechanics fundamentals');
    expect(msg).toContain('Sustain a target color tolerance');
  });

  it('numbers each KUD descriptor zero-based so the LLM can target edits by index', () => {
    const msg = buildSynthesisUserMessage({ target, submissions, salaryDistribution });
    expect(msg).toMatch(/Know:[\s\S]+\[0\] Press mechanics fundamentals/);
    expect(msg).toMatch(/\[1\] Substrate behavior under heat and pressure/);
  });

  it('lists every submission with partner identity + weight', () => {
    const msg = buildSynthesisUserMessage({ target, submissions, salaryDistribution });
    expect(msg).toContain('p1');
    expect(msg).toContain('Alex Jordan (Acme Print, weight: 1)');
    expect(msg).toContain('Beth Smith (Coca-Cola, weight: 5)');
    expect(msg).toContain('Brand color governance across suppliers');
  });

  it('includes the salary distribution passthrough block', () => {
    const msg = buildSynthesisUserMessage({ target, submissions, salaryDistribution });
    expect(msg).toMatch(/Salary distribution.*p25.*51500/s);
    expect(msg).toContain('"n": 2');
  });

  it('omits empty fields without leaving dangling labels', () => {
    const msg = buildSynthesisUserMessage({ target, submissions, salaryDistribution });
    // p2 has empty interviewQuestions, empty niceToHave, and empty additionalNotes
    expect(msg).not.toMatch(/Interview questions:\s*\n\s*Required skills/);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm test tests/ai/synthesis/prompt-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the prompt builder**

Create `lib/ai/synthesis/prompt-builder.ts`:

```typescript
import type { SalaryDistribution } from './queries';

export interface TargetInput {
  id: string;
  name: string;
  shortDefinition: string;
  knowDescriptors: string[];
  understandDescriptors: string[];
  doDescriptors: string[];
}

export interface SubmissionInput {
  partnerId: string;
  firstName: string;
  lastName: string;
  company: string;
  weight: number;
  positionTitle: string;
  responsibilities: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  interviewQuestions: string[];
  additionalNotes: string;
  salaryRangeLow: number | null;
  salaryRangeHigh: number | null;
  salaryCurrency: string;
}

export interface BuildArgs {
  target: TargetInput;
  submissions: SubmissionInput[];
  salaryDistribution: SalaryDistribution;
}

function numberedList(items: string[]): string {
  if (items.length === 0) return '(none currently)';
  return items.map((it, i) => `  [${i}] ${it}`).join('\n');
}

function formatSubmission(s: SubmissionInput, idx: number): string {
  const parts: string[] = [];
  parts.push(`### Submission ${idx + 1} — partnerId: ${s.partnerId}`);
  parts.push(`Partner: ${s.firstName} ${s.lastName} (${s.company}, weight: ${s.weight})`);
  parts.push(`Position title: ${s.positionTitle}`);
  if (s.responsibilities.trim()) parts.push(`Responsibilities: ${s.responsibilities.trim()}`);
  if (s.requiredSkills.length > 0) parts.push(`Required skills: ${s.requiredSkills.join(', ')}`);
  if (s.niceToHaveSkills.length > 0) parts.push(`Nice-to-have skills: ${s.niceToHaveSkills.join(', ')}`);
  if (s.interviewQuestions.length > 0) {
    parts.push(`Interview questions:\n${s.interviewQuestions.map(q => `  - ${q}`).join('\n')}`);
  }
  if (s.additionalNotes.trim()) parts.push(`Additional notes: ${s.additionalNotes.trim()}`);
  if (s.salaryRangeLow != null || s.salaryRangeHigh != null) {
    const lo = s.salaryRangeLow ?? '—';
    const hi = s.salaryRangeHigh ?? '—';
    parts.push(`Salary range: ${lo}–${hi} ${s.salaryCurrency}`);
  }
  return parts.join('\n');
}

export function buildSynthesisUserMessage({ target, submissions, salaryDistribution }: BuildArgs): string {
  return [
    `# Career target`,
    ``,
    `id: ${target.id}`,
    `name: ${target.name}`,
    `definition: ${target.shortDefinition}`,
    ``,
    `## Current descriptors`,
    ``,
    `Know:\n${numberedList(target.knowDescriptors)}`,
    ``,
    `Understand:\n${numberedList(target.understandDescriptors)}`,
    ``,
    `Do:\n${numberedList(target.doDescriptors)}`,
    ``,
    `# Salary distribution (pre-computed — pass through unchanged)`,
    ``,
    '```json',
    JSON.stringify(salaryDistribution, null, 2),
    '```',
    ``,
    `# Partner submissions (${submissions.length})`,
    ``,
    submissions.map(formatSubmission).join('\n\n'),
  ].join('\n');
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/ai/synthesis/prompt-builder.test.ts`
Expected: 5 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/synthesis/prompt-builder.ts tests/ai/synthesis/prompt-builder.test.ts
git commit -m "feat(synthesis): user-message builder from career target + submissions"
```

---

### Task 6: synthesizeTarget orchestrator + cost guard + stalenessCheck

**Files:**
- Create: `lib/ai/synthesis/orchestrator.ts`
- Create: `lib/ai/synthesis/staleness.ts`
- Modify: `.env.example`
- Test: `tests/ai/synthesis/orchestrator.test.ts` (create)
- Test: `tests/ai/synthesis/staleness.test.ts` (create)

- [ ] **Step 1: Add the staleness env var to `.env.example`**

Append to `.env.example`:

```bash
# Synthesis re-run threshold — when current submission count exceeds the
# cached run's submissionCount by this many or more, the per-target page
# shows "needs re-run" and the re-run button is highlighted.
SYNTHESIS_STALENESS_THRESHOLD=5
```

- [ ] **Step 2: Write the failing staleness test**

Create `tests/ai/synthesis/staleness.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbSelect = vi.fn();
vi.mock('@/lib/db/client', () => ({
  db: { select: dbSelect },
}));
vi.mock('@/lib/db/schema', () => ({ synthesisRuns: {} }));

const countSubmittedForTarget = vi.fn();
vi.mock('@/lib/ai/synthesis/queries', () => ({ countSubmittedForTarget }));

import { stalenessCheck } from '@/lib/ai/synthesis/staleness';

beforeEach(() => {
  dbSelect.mockReset();
  countSubmittedForTarget.mockReset();
  delete process.env.SYNTHESIS_STALENESS_THRESHOLD;
});

function mockLatestRun(row: { submissionCount: number; createdAt: Date } | null) {
  dbSelect.mockReturnValue({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    }),
  });
}

describe('stalenessCheck', () => {
  it('returns stale=true with reason "no_run" when no run exists', async () => {
    mockLatestRun(null);
    countSubmittedForTarget.mockResolvedValue(3);
    const out = await stalenessCheck('production-operations');
    expect(out).toMatchObject({ stale: true, reason: 'no_run' });
  });

  it('returns stale=false when run is recent and within submission threshold', async () => {
    mockLatestRun({ submissionCount: 10, createdAt: new Date() });
    countSubmittedForTarget.mockResolvedValue(12);
    const out = await stalenessCheck('production-operations');
    expect(out.stale).toBe(false);
  });

  it('returns stale=true with reason "new_submissions" when delta meets threshold', async () => {
    mockLatestRun({ submissionCount: 10, createdAt: new Date() });
    countSubmittedForTarget.mockResolvedValue(15);
    const out = await stalenessCheck('production-operations');
    expect(out).toMatchObject({ stale: true, reason: 'new_submissions' });
  });

  it('honors a custom threshold from env', async () => {
    process.env.SYNTHESIS_STALENESS_THRESHOLD = '2';
    mockLatestRun({ submissionCount: 10, createdAt: new Date() });
    countSubmittedForTarget.mockResolvedValue(12);
    const out = await stalenessCheck('production-operations');
    expect(out).toMatchObject({ stale: true, reason: 'new_submissions' });
  });

  it('returns stale=true with reason "age" when run is older than 30 days', async () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    mockLatestRun({ submissionCount: 10, createdAt: old });
    countSubmittedForTarget.mockResolvedValue(10);
    const out = await stalenessCheck('production-operations');
    expect(out).toMatchObject({ stale: true, reason: 'age' });
  });
});
```

- [ ] **Step 3: Run the failing test**

Run: `pnpm test tests/ai/synthesis/staleness.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement staleness**

Create `lib/ai/synthesis/staleness.ts`:

```typescript
import { eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { synthesisRuns } from '@/lib/db/schema';
import { countSubmittedForTarget } from './queries';

export type StalenessReason = 'no_run' | 'new_submissions' | 'age';

export interface StalenessResult {
  stale: boolean;
  reason?: StalenessReason;
  cachedSubmissionCount?: number;
  currentSubmissionCount: number;
  threshold: number;
}

const AGE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;

function thresholdFromEnv(): number {
  const raw = process.env.SYNTHESIS_STALENESS_THRESHOLD?.trim();
  if (!raw) return 5;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function stalenessCheck(targetId: string): Promise<StalenessResult> {
  const threshold = thresholdFromEnv();
  const currentSubmissionCount = await countSubmittedForTarget(targetId);

  const rows = await db.select()
    .from(synthesisRuns)
    .where(eq(synthesisRuns.careerTargetId, targetId))
    .orderBy(desc(synthesisRuns.createdAt))
    .limit(1);
  const latest = rows[0];

  if (!latest) {
    return { stale: true, reason: 'no_run', currentSubmissionCount, threshold };
  }

  const age = Date.now() - latest.createdAt.getTime();
  if (age > AGE_LIMIT_MS) {
    return { stale: true, reason: 'age', cachedSubmissionCount: latest.submissionCount, currentSubmissionCount, threshold };
  }

  const delta = currentSubmissionCount - latest.submissionCount;
  if (delta >= threshold) {
    return { stale: true, reason: 'new_submissions', cachedSubmissionCount: latest.submissionCount, currentSubmissionCount, threshold };
  }

  return { stale: false, cachedSubmissionCount: latest.submissionCount, currentSubmissionCount, threshold };
}
```

- [ ] **Step 5: Run staleness test to verify it passes**

Run: `pnpm test tests/ai/synthesis/staleness.test.ts`
Expected: 5 passing tests.

- [ ] **Step 6: Write the failing orchestrator test**

Create `tests/ai/synthesis/orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProvider = vi.fn();
vi.mock('@/lib/ai/provider', () => ({ getProvider }));

const checkDailyCap = vi.fn();
const recordSpend = vi.fn();
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap, recordSpend }));

const loadPrompt = vi.fn();
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

const buildSynthesisUserMessage = vi.fn();
vi.mock('@/lib/ai/synthesis/prompt-builder', () => ({ buildSynthesisUserMessage }));

const salaryDistributionForTarget = vi.fn();
const countSubmittedForTarget = vi.fn();
vi.mock('@/lib/ai/synthesis/queries', () => ({
  salaryDistributionForTarget,
  countSubmittedForTarget,
  // unused in orchestrator but mocked to satisfy module shape:
  countUniquePartnersForTarget: vi.fn(),
  sumPartnerWeightsForTarget: vi.fn(),
  nearbyUnmappedLabelsForTarget: vi.fn(),
}));

// DB-layer mocks. The orchestrator does: load target, load submissions+partners,
// insert into synthesis_runs.
const targetSelectLimit = vi.fn();
const submissionsSelect = vi.fn();
const synthesisInsertReturning = vi.fn();
vi.mock('@/lib/db/client', () => ({
  db: {
    select: (..._args: unknown[]) => ({
      from: (table: { _name?: string }) => {
        // route based on which table is being queried — using a marker
        return {
          where: () => ({
            limit: targetSelectLimit,
            orderBy: () => ({ then: undefined }),
          }),
          innerJoin: () => ({
            where: () => ({
              orderBy: () => submissionsSelect(),
            }),
          }),
        };
      },
    }),
    insert: () => ({ values: () => ({ returning: synthesisInsertReturning }) }),
  },
}));
vi.mock('@/lib/db/schema', () => ({
  careerTargets: { _name: 'careerTargets' },
  partnerSubmissions: { _name: 'partnerSubmissions' },
  partners: { _name: 'partners' },
  synthesisRuns: { _name: 'synthesisRuns' },
}));

import { synthesizeTarget } from '@/lib/ai/synthesis/orchestrator';

beforeEach(() => {
  vi.clearAllMocks();
  checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0 });
  recordSpend.mockResolvedValue(undefined);
  loadPrompt.mockResolvedValue('SYSTEM PROMPT');
  buildSynthesisUserMessage.mockReturnValue('USER MESSAGE');
  salaryDistributionForTarget.mockResolvedValue({ p25: 50000, p50: 60000, p75: 70000, n: 3 });
  countSubmittedForTarget.mockResolvedValue(3);
  synthesisInsertReturning.mockResolvedValue([{ id: 'run-1' }]);
});

function mockTarget(value: object | null) {
  targetSelectLimit.mockResolvedValue(value ? [value] : []);
}
function mockSubmissions(rows: object[]) {
  submissionsSelect.mockResolvedValue(rows);
}
function mockProvider(data: object, costUsdCents: number) {
  getProvider.mockReturnValue({
    name: 'openai',
    model: 'gpt-5.4-mini',
    complete: vi.fn().mockResolvedValue({
      data, costUsdCents, durationMs: 1234, cachedTokens: 0, uncachedPromptTokens: 100, completionTokens: 50,
    }),
  });
}

describe('synthesizeTarget', () => {
  it('throws if daily cost cap exceeded', async () => {
    checkDailyCap.mockResolvedValueOnce({ ok: false, spentCents: 99999 });
    await expect(synthesizeTarget('production-operations')).rejects.toThrow(/daily cap/i);
  });

  it('throws if the career target does not exist', async () => {
    mockTarget(null);
    await expect(synthesizeTarget('does-not-exist')).rejects.toThrow(/not found/i);
  });

  it('throws if no submissions for the target', async () => {
    mockTarget({ id: 'production-operations', name: 'Production Operations', shortDefinition: 'x', knowDescriptors: [], understandDescriptors: [], doDescriptors: [] });
    mockSubmissions([]);
    await expect(synthesizeTarget('production-operations')).rejects.toThrow(/no submissions/i);
  });

  it('runs the full pipeline and persists the run with cost', async () => {
    mockTarget({ id: 'production-operations', name: 'Production Operations', shortDefinition: 'x', knowDescriptors: ['k1'], understandDescriptors: [], doDescriptors: [] });
    mockSubmissions([
      {
        submission: { partnerId: 'p1', positionTitle: 't', responsibilities: '', requiredSkills: [], niceToHaveSkills: [], interviewQuestions: [], additionalNotes: '', salaryRangeLow: null, salaryRangeHigh: null, salaryCurrency: 'USD' },
        partner: { firstName: 'A', lastName: 'X', company: 'Acme', weight: 1 },
      },
    ]);
    mockProvider({
      aggregatedJobTitles: [], responsibilityThemes: [], commonRequiredSkills: [], commonNiceToHaveSkills: [],
      interviewQuestionThemes: [], salaryDistribution: { p25: 50000, p50: 60000, p75: 70000, n: 3 },
      sampleQuotes: [], proposedKUDEdits: [],
    }, 42);
    const out = await synthesizeTarget('production-operations');
    expect(out.id).toBe('run-1');
    expect(recordSpend).toHaveBeenCalledWith(42);
  });

  it('excludes partners with weight=0 from the prompt input', async () => {
    mockTarget({ id: 'production-operations', name: 'X', shortDefinition: 'x', knowDescriptors: [], understandDescriptors: [], doDescriptors: [] });
    mockSubmissions([
      { submission: { partnerId: 'p1', positionTitle: 'a', responsibilities: '', requiredSkills: [], niceToHaveSkills: [], interviewQuestions: [], additionalNotes: '', salaryRangeLow: null, salaryRangeHigh: null, salaryCurrency: 'USD' }, partner: { firstName: 'A', lastName: 'X', company: 'Acme', weight: 1 } },
      { submission: { partnerId: 'p2', positionTitle: 'b', responsibilities: '', requiredSkills: [], niceToHaveSkills: [], interviewQuestions: [], additionalNotes: '', salaryRangeLow: null, salaryRangeHigh: null, salaryCurrency: 'USD' }, partner: { firstName: 'B', lastName: 'X', company: 'Zero', weight: 0 } },
    ]);
    mockProvider({
      aggregatedJobTitles: [], responsibilityThemes: [], commonRequiredSkills: [], commonNiceToHaveSkills: [],
      interviewQuestionThemes: [], salaryDistribution: { p25: 50000, p50: 60000, p75: 70000, n: 3 },
      sampleQuotes: [], proposedKUDEdits: [],
    }, 12);

    await synthesizeTarget('production-operations');
    const passed = buildSynthesisUserMessage.mock.calls[0]?.[0] as { submissions: { partnerId: string }[] } | undefined;
    expect(passed?.submissions.map(s => s.partnerId)).toEqual(['p1']);
  });
});
```

- [ ] **Step 7: Run the failing orchestrator test**

Run: `pnpm test tests/ai/synthesis/orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement the orchestrator**

Create `lib/ai/synthesis/orchestrator.ts`:

```typescript
import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  careerTargets,
  partnerSubmissions,
  partners,
  synthesisRuns,
} from '@/lib/db/schema';
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import {
  synthesisResultSchema,
  synthesisResultJsonSchema,
  type SynthesisResult,
} from './schema';
import { buildSynthesisUserMessage, type SubmissionInput } from './prompt-builder';
import { salaryDistributionForTarget, countSubmittedForTarget } from './queries';

export interface PersistedRun {
  id: string;
  result: SynthesisResult;
  model: string;
  costUsdCents: number;
  submissionCount: number;
}

export async function synthesizeTarget(targetId: string): Promise<PersistedRun> {
  // 1. Cost guard
  const cap = await checkDailyCap();
  if (!cap.ok) {
    throw new Error(`Daily cap exceeded (${cap.spentCents}¢). Synthesis blocked.`);
  }

  // 2. Load the career target
  const targetRows = await db.select()
    .from(careerTargets)
    .where(eq(careerTargets.id, targetId))
    .limit(1);
  const target = targetRows[0];
  if (!target) throw new Error(`Career target not found: ${targetId}`);

  // 3. Load submissions with partner identity, excluding weight=0 partners
  const subRows = await db.select({
    submission: partnerSubmissions,
    partner: partners,
  })
    .from(partnerSubmissions)
    .innerJoin(partners, eq(partnerSubmissions.partnerId, partners.id))
    .where(and(
      eq(partnerSubmissions.careerTargetId, targetId),
      eq(partnerSubmissions.status, 'submitted'),
    ))
    .orderBy(desc(partnerSubmissions.submittedAt));

  const submissions: SubmissionInput[] = subRows
    .filter(r => r.partner.weight > 0)
    .map(r => ({
      partnerId: r.partner.id,
      firstName: r.partner.firstName,
      lastName: r.partner.lastName,
      company: r.partner.company,
      weight: r.partner.weight,
      positionTitle: r.submission.positionTitle,
      responsibilities: r.submission.responsibilities,
      requiredSkills: r.submission.requiredSkills,
      niceToHaveSkills: r.submission.niceToHaveSkills,
      interviewQuestions: r.submission.interviewQuestions,
      additionalNotes: r.submission.additionalNotes,
      salaryRangeLow: r.submission.salaryRangeLow,
      salaryRangeHigh: r.submission.salaryRangeHigh,
      salaryCurrency: r.submission.salaryCurrency,
    }));

  if (submissions.length === 0) {
    throw new Error(`No submissions to synthesize for target ${targetId}.`);
  }

  // 4. Compute deterministic salary distribution (SQL — not LLM math)
  const salaryDistribution = await salaryDistributionForTarget(targetId);

  // 5. Build prompt + user message
  const systemPrompt = await loadPrompt('synthesize-target');
  const userMessage = buildSynthesisUserMessage({
    target: {
      id: target.id,
      name: target.name,
      shortDefinition: target.shortDefinition,
      knowDescriptors: target.knowDescriptors,
      understandDescriptors: target.understandDescriptors,
      doDescriptors: target.doDescriptors,
    },
    submissions,
    salaryDistribution,
  });

  // 6. Call provider with structured-outputs JSON schema
  const provider = getProvider();
  const completion = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'SynthesisResult',
    jsonSchema: synthesisResultJsonSchema,
    validate: raw => synthesisResultSchema.parse(raw),
  });

  // 7. Mix in the deterministic salary distribution (overwrite anything the LLM emitted)
  const result: SynthesisResult = {
    ...completion.data,
    salaryDistribution,
  };

  // 8. Persist + record spend
  const submissionCount = await countSubmittedForTarget(targetId);
  const [inserted] = await db.insert(synthesisRuns).values({
    careerTargetId: targetId,
    submissionCount,
    result,
    model: provider.model,
    costUsdCents: completion.costUsdCents,
  }).returning({ id: synthesisRuns.id });
  if (!inserted) throw new Error('synthesizeTarget: synthesis_runs insert returned no row');

  await recordSpend(completion.costUsdCents);

  return {
    id: inserted.id,
    result,
    model: provider.model,
    costUsdCents: completion.costUsdCents,
    submissionCount,
  };
}

export async function getLatestRun(targetId: string) {
  const rows = await db.select()
    .from(synthesisRuns)
    .where(eq(synthesisRuns.careerTargetId, targetId))
    .orderBy(desc(synthesisRuns.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 9: Run the orchestrator test**

Run: `pnpm test tests/ai/synthesis/orchestrator.test.ts`
Expected: 5 passing tests.

- [ ] **Step 10: tsc check**

Run: `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add lib/ai/synthesis/orchestrator.ts lib/ai/synthesis/staleness.ts .env.example tests/ai/synthesis/orchestrator.test.ts tests/ai/synthesis/staleness.test.ts
git commit -m "feat(synthesis): synthesizeTarget orchestrator + staleness check"
```

---

## Phase C — API endpoint

### Task 7: `POST /api/admin/synthesis/[targetId]/run`

**Files:**
- Create: `app/api/admin/synthesis/[targetId]/run/route.ts`
- Test: `tests/api/admin-synthesis-run.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/api/admin-synthesis-run.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const synthesizeTarget = vi.fn();
vi.mock('@/lib/ai/synthesis/orchestrator', () => ({ synthesizeTarget }));

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug-12345' }));

import { POST } from '@/app/api/admin/synthesis/[targetId]/run/route';

beforeEach(() => {
  synthesizeTarget.mockReset();
});

function makeReq(body: unknown): Request {
  return new Request('http://test/api/admin/synthesis/production-operations/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/synthesis/[targetId]/run', () => {
  it('401s on invalid slug', async () => {
    const res = await POST(makeReq({ slug: 'wrong' }), { params: Promise.resolve({ targetId: 'production-operations' }) });
    expect(res.status).toBe(401);
  });

  it('runs synthesis and returns the run on success', async () => {
    synthesizeTarget.mockResolvedValue({
      id: 'run-1', result: { aggregatedJobTitles: [] }, model: 'gpt-5.4-mini', costUsdCents: 42, submissionCount: 3,
    });
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ targetId: 'production-operations' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.run.id).toBe('run-1');
    expect(synthesizeTarget).toHaveBeenCalledWith('production-operations');
  });

  it('429s on daily cap exhaustion', async () => {
    synthesizeTarget.mockRejectedValue(new Error('Daily cap exceeded (99999¢). Synthesis blocked.'));
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ targetId: 'production-operations' }) });
    expect(res.status).toBe(429);
  });

  it('404s when target not found', async () => {
    synthesizeTarget.mockRejectedValue(new Error('Career target not found: does-not-exist'));
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ targetId: 'does-not-exist' }) });
    expect(res.status).toBe(404);
  });

  it('409s when there are no submissions', async () => {
    synthesizeTarget.mockRejectedValue(new Error('No submissions to synthesize for target production-operations.'));
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ targetId: 'production-operations' }) });
    expect(res.status).toBe(409);
  });

  it('500s on any other failure', async () => {
    synthesizeTarget.mockRejectedValue(new Error('OpenAI returned non-JSON'));
    const res = await POST(makeReq({ slug: 'valid-slug-12345' }), { params: Promise.resolve({ targetId: 'production-operations' }) });
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm test tests/api/admin-synthesis-run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the endpoint**

Create `app/api/admin/synthesis/[targetId]/run/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { synthesizeTarget } from '@/lib/ai/synthesis/orchestrator';

export const maxDuration = 120;

interface Ctx { params: Promise<{ targetId: string }>; }

export async function POST(req: Request, { params }: Ctx) {
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const { targetId } = await params;

  try {
    const run = await synthesizeTarget(targetId);
    return NextResponse.json({ run });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/daily cap/i.test(msg)) return NextResponse.json({ error: msg }, { status: 429 });
    if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
    if (/no submissions/i.test(msg)) return NextResponse.json({ error: msg }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test tests/api/admin-synthesis-run.test.ts`
Expected: 6 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/synthesis tests/api/admin-synthesis-run.test.ts
git commit -m "feat(api): admin synthesis-run endpoint"
```

---

## Phase D — Admin UI

### Task 8: `/admin/synthesis` index page

**Files:**
- Create: `app/admin/synthesis/page.tsx`
- Create: `app/admin/synthesis/TargetsIndexTable.tsx`

- [ ] **Step 1: Create the server page**

Create `app/admin/synthesis/page.tsx`:

```tsx
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import {
  countSubmittedForTarget,
  countUniquePartnersForTarget,
} from '@/lib/ai/synthesis/queries';
import { stalenessCheck } from '@/lib/ai/synthesis/staleness';
import { getLatestRun } from '@/lib/ai/synthesis/orchestrator';
import { TargetsIndexTable, type IndexRow } from './TargetsIndexTable';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function SynthesisIndexPage({ searchParams }: Props) {
  const { slug } = await searchParams;
  if (!slug) {
    return <main className="p-8"><p className="text-sm text-slate-600">Missing slug query param.</p></main>;
  }

  const targets = await db.select().from(careerTargets).orderBy(asc(careerTargets.displayOrder));

  const rows: IndexRow[] = await Promise.all(
    targets.map(async t => {
      const [submissions, partners, staleness, latest] = await Promise.all([
        countSubmittedForTarget(t.id),
        countUniquePartnersForTarget(t.id),
        stalenessCheck(t.id),
        getLatestRun(t.id),
      ]);
      return {
        id: t.id,
        name: t.name,
        shortDefinition: t.shortDefinition,
        submissions,
        partners,
        stale: staleness.stale,
        staleReason: staleness.reason,
        lastRunAt: latest?.createdAt ? latest.createdAt.toISOString() : null,
      };
    })
  );

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Industry partner synthesis</h1>
        <p className="text-sm text-slate-600">
          Aggregated insights and proposed KUD edits per career target. Faculty reviews and curates;
          the tool never auto-writes to the curriculum.
        </p>
      </header>
      <TargetsIndexTable rows={rows} slug={slug} />
    </main>
  );
}
```

- [ ] **Step 2: Create the client table**

Create `app/admin/synthesis/TargetsIndexTable.tsx`:

```tsx
'use client';

import Link from 'next/link';

export interface IndexRow {
  id: string;
  name: string;
  shortDefinition: string;
  submissions: number;
  partners: number;
  stale: boolean;
  staleReason?: 'no_run' | 'new_submissions' | 'age';
  lastRunAt: string | null;
}

const REASON_LABEL: Record<NonNullable<IndexRow['staleReason']>, string> = {
  no_run: 'No run yet',
  new_submissions: 'New submissions',
  age: 'Run > 30 days old',
};

export function TargetsIndexTable({ rows, slug }: { rows: IndexRow[]; slug: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No career targets configured.</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="text-left text-xs uppercase text-slate-500">
        <tr>
          <th className="py-2">Career target</th>
          <th>Submissions</th>
          <th>Partners</th>
          <th>Last run</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} className="border-t border-slate-200">
            <td className="py-3">
              <Link href={`/admin/synthesis/targets/${r.id}?slug=${slug}`} className="font-medium text-blue-700 hover:underline">
                {r.name}
              </Link>
              <div className="text-xs text-slate-500">{r.shortDefinition}</div>
            </td>
            <td>{r.submissions}</td>
            <td>{r.partners}</td>
            <td className="text-xs">{r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : '—'}</td>
            <td>
              {r.stale ? (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  {r.staleReason ? REASON_LABEL[r.staleReason] : 'Stale'}
                </span>
              ) : (
                <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">Fresh</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: tsc check**

Run: `pnpm exec tsc --noEmit`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/admin/synthesis/page.tsx app/admin/synthesis/TargetsIndexTable.tsx
git commit -m "feat(admin): synthesis index page listing all career targets"
```

---

### Task 9: Per-target page server component

**Files:**
- Create: `app/admin/synthesis/targets/[targetId]/page.tsx`

This page imports `HeaderStats`, `SynthesizedInsightsPanel`, `ProposedKUDEditsPanel`, and `ReRunButton` — those land in Tasks 10–13. The build will be transiently broken between this task's commit and Task 13's commit; the plan accepts that and rolls T9–T13 into a single commit at T13.

- [ ] **Step 1: Create the server page**

Create `app/admin/synthesis/targets/[targetId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  countSubmittedForTarget,
  countUniquePartnersForTarget,
  sumPartnerWeightsForTarget,
  salaryDistributionForTarget,
  nearbyUnmappedLabelsForTarget,
} from '@/lib/ai/synthesis/queries';
import { stalenessCheck } from '@/lib/ai/synthesis/staleness';
import { getLatestRun } from '@/lib/ai/synthesis/orchestrator';
import type { SynthesisResult } from '@/lib/ai/synthesis/schema';
import { HeaderStats } from './HeaderStats';
import { SynthesizedInsightsPanel } from './SynthesizedInsightsPanel';
import { ProposedKUDEditsPanel } from './ProposedKUDEditsPanel';
import { ReRunButton } from './ReRunButton';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ targetId: string }>;
  searchParams: Promise<{ slug?: string }>;
}

export default async function SynthesisTargetPage({ params, searchParams }: Props) {
  const [{ targetId }, { slug }] = await Promise.all([params, searchParams]);
  if (!slug) {
    return <main className="p-8"><p className="text-sm text-slate-600">Missing slug query param.</p></main>;
  }

  const rows = await db.select().from(careerTargets).where(eq(careerTargets.id, targetId)).limit(1);
  const target = rows[0];
  if (!target) return notFound();

  const [submissions, partnersCount, weightedSum, salary, unmapped, staleness, latestRun] = await Promise.all([
    countSubmittedForTarget(targetId),
    countUniquePartnersForTarget(targetId),
    sumPartnerWeightsForTarget(targetId),
    salaryDistributionForTarget(targetId),
    nearbyUnmappedLabelsForTarget(targetId),
    stalenessCheck(targetId),
    getLatestRun(targetId),
  ]);

  const result = latestRun?.result as SynthesisResult | undefined;

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-8">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Career target</div>
          <h1 className="mt-1 text-2xl font-semibold">{target.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">{target.shortDefinition}</p>
        </div>
        <ReRunButton
          targetId={targetId}
          slug={slug}
          stale={staleness.stale}
          submissionsAvailable={submissions > 0}
          lastRunCostCents={latestRun?.costUsdCents ?? null}
        />
      </header>

      <HeaderStats
        submissions={submissions}
        partners={partnersCount}
        weightedSum={weightedSum}
        salary={salary}
        unmapped={unmapped}
      />

      {!result ? (
        <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          {submissions === 0
            ? 'No submissions yet. Once partners respond, run synthesis to see proposed KUD edits and aggregated themes.'
            : 'No synthesis run yet for this target. Click "Run synthesis" above.'}
        </div>
      ) : (
        <>
          <SynthesizedInsightsPanel result={result} />
          <ProposedKUDEditsPanel
            target={{
              knowDescriptors: target.knowDescriptors,
              understandDescriptors: target.understandDescriptors,
              doDescriptors: target.doDescriptors,
            }}
            edits={result.proposedKUDEdits}
          />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: tsc check (will fail on missing T10–T13 components — expected)**

Run: `pnpm exec tsc --noEmit 2>&1 | head -20`. Expected: errors about missing `./HeaderStats`, `./SynthesizedInsightsPanel`, `./ProposedKUDEditsPanel`, `./ReRunButton`. Confirm those are the ONLY new errors.

- [ ] **Step 3: Stage (no commit — rolls into T13)**

Run: `git add app/admin/synthesis/targets/[targetId]/page.tsx`.

---

### Task 10: HeaderStats component

**Files:**
- Create: `app/admin/synthesis/targets/[targetId]/HeaderStats.tsx`

- [ ] **Step 1: Create the component**

Create `app/admin/synthesis/targets/[targetId]/HeaderStats.tsx`:

```tsx
import type { SalaryDistribution, UnmappedLabel } from '@/lib/ai/synthesis/queries';

interface Props {
  submissions: number;
  partners: number;
  weightedSum: number;
  salary: SalaryDistribution;
  unmapped: UnmappedLabel[];
}

function formatSalary(n?: number): string {
  if (n == null) return '—';
  return `$${Math.round(n / 1000)}k`;
}

export function HeaderStats({ submissions, partners, weightedSum, salary, unmapped }: Props) {
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Submissions" value={String(submissions)} />
        <Stat label="Unique partners" value={String(partners)} />
        <Stat label="Weighted sum" value={String(weightedSum)} hint="∑ of partners.weight (distinct partners)" />
        <Stat
          label="Salary (p25 · p50 · p75)"
          value={`${formatSalary(salary.p25)} · ${formatSalary(salary.p50)} · ${formatSalary(salary.p75)}`}
          hint={salary.n === 0 ? 'no salary data yet' : `n = ${salary.n}`}
        />
      </div>

      {unmapped.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-amber-800">
            Unmapped labels from partners
          </div>
          <p className="mt-1 text-xs text-amber-900">
            These are roles partners described but couldn't fit into your current targets. Worth a look — may indicate emerging targets.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {unmapped.map(u => (
              <li key={u.label} className="rounded bg-white px-2 py-1 text-xs text-slate-700">
                {u.label} <span className="text-slate-400">×{u.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Stage (no commit — rolls into T13)**

Run: `git add app/admin/synthesis/targets/[targetId]/HeaderStats.tsx`.

---

### Task 11: SynthesizedInsightsPanel component

**Files:**
- Create: `app/admin/synthesis/targets/[targetId]/SynthesizedInsightsPanel.tsx`

- [ ] **Step 1: Create the component**

Create `app/admin/synthesis/targets/[targetId]/SynthesizedInsightsPanel.tsx`:

```tsx
import type { SynthesisResult } from '@/lib/ai/synthesis/schema';

interface Props {
  result: SynthesisResult;
}

export function SynthesizedInsightsPanel({ result }: Props) {
  return (
    <section className="space-y-6 rounded-lg border border-slate-200 bg-white p-6">
      <header>
        <h2 className="text-lg font-semibold">Synthesized insights</h2>
        <p className="text-sm text-slate-500">
          Aggregated across partner submissions. Higher-weighted partners influenced these themes more.
        </p>
      </header>

      <Group title="Aggregated job titles">
        {result.aggregatedJobTitles.length === 0 ? (
          <Empty>No titles yet.</Empty>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {result.aggregatedJobTitles.map(t => (
              <li key={t.title} className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-700">
                {t.title} <span className="text-slate-400">×{t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="Responsibility themes">
        {result.responsibilityThemes.length === 0 ? (
          <Empty>No themes synthesized.</Empty>
        ) : (
          <ul className="space-y-3">
            {result.responsibilityThemes.map((t, i) => (
              <li key={i} className="border-l-2 border-slate-200 pl-3">
                <div className="font-medium">{t.theme}</div>
                {t.quotedFrom.length > 0 && (
                  <ul className="mt-1 space-y-1 text-sm text-slate-600">
                    {t.quotedFrom.map((q, j) => (
                      <li key={j}>
                        <span className="italic">&ldquo;{q.snippet}&rdquo;</span>{' '}
                        <span className="text-xs text-slate-400">— {q.partnerId}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Group>

      <div className="grid gap-6 sm:grid-cols-2">
        <Group title="Common required skills">
          {result.commonRequiredSkills.length === 0 ? <Empty>—</Empty> : (
            <ul className="flex flex-wrap gap-2">
              {result.commonRequiredSkills.map(s => (
                <li key={s.skill} className="rounded bg-slate-100 px-2 py-1 text-sm">
                  {s.skill} <span className="text-slate-400">×{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Group>
        <Group title="Common nice-to-haves">
          {result.commonNiceToHaveSkills.length === 0 ? <Empty>—</Empty> : (
            <ul className="flex flex-wrap gap-2">
              {result.commonNiceToHaveSkills.map(s => (
                <li key={s.skill} className="rounded bg-slate-50 px-2 py-1 text-sm text-slate-700">
                  {s.skill} <span className="text-slate-400">×{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Group>
      </div>

      <Group title="Interview question themes">
        {result.interviewQuestionThemes.length === 0 ? <Empty>—</Empty> : (
          <ul className="space-y-3">
            {result.interviewQuestionThemes.map((t, i) => (
              <li key={i} className="border-l-2 border-slate-200 pl-3">
                <div className="font-medium">{t.theme}</div>
                {t.examples.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-sm text-slate-600">
                    {t.examples.map((q, j) => <li key={j}>{q}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Group>

      {result.sampleQuotes.length > 0 && (
        <Group title="Sample partner voice">
          <ul className="space-y-2">
            {result.sampleQuotes.map((q, i) => (
              <li key={i} className="rounded bg-slate-50 p-3 text-sm">
                <span className="italic">&ldquo;{q.quote}&rdquo;</span>{' '}
                <span className="text-xs text-slate-500">— {q.partnerId}</span>
              </li>
            ))}
          </ul>
        </Group>
      )}
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400">{children}</p>;
}
```

- [ ] **Step 2: Stage (no commit — rolls into T13)**

Run: `git add app/admin/synthesis/targets/[targetId]/SynthesizedInsightsPanel.tsx`.

---

### Task 12: ProposedKUDEditsPanel component

**Files:**
- Create: `app/admin/synthesis/targets/[targetId]/ProposedKUDEditsPanel.tsx`

- [ ] **Step 1: Create the component**

Create `app/admin/synthesis/targets/[targetId]/ProposedKUDEditsPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { SynthesisResult } from '@/lib/ai/synthesis/schema';

interface Props {
  target: {
    knowDescriptors: string[];
    understandDescriptors: string[];
    doDescriptors: string[];
  };
  edits: SynthesisResult['proposedKUDEdits'];
}

const DESCRIPTOR_LABEL = { know: 'Know', understand: 'Understand', do: 'Do' } as const;

export function ProposedKUDEditsPanel({ target, edits }: Props) {
  if (edits.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Proposed KUD edits</h2>
        <p className="mt-2 text-sm text-slate-500">
          No proposed edits this run. The data either supports the current descriptors or doesn't surface a strong-enough signal yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      <header>
        <h2 className="text-lg font-semibold">Proposed KUD edits</h2>
        <p className="text-sm text-slate-500">
          Each card is a suggestion grounded in partner submissions. Faculty curate: copy the text and paste into the curriculum tool's career-target editor.
        </p>
      </header>
      <ul className="space-y-3">
        {edits.map((e, i) => (
          <EditCard key={i} edit={e} target={target} />
        ))}
      </ul>
    </section>
  );
}

function EditCard({ edit, target }: { edit: SynthesisResult['proposedKUDEdits'][number]; target: Props['target'] }) {
  const [copied, setCopied] = useState(false);
  const existing = edit.type === 'edit' && edit.targetDescriptorIndex != null
    ? descriptorAt(target, edit.descriptor, edit.targetDescriptorIndex)
    : null;

  async function onCopy() {
    await navigator.clipboard.writeText(edit.proposedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs uppercase tracking-wide text-white">
            {DESCRIPTOR_LABEL[edit.descriptor]}
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-700">
            {edit.type}
          </span>
          <span className="text-xs text-slate-500">
            supported by {edit.supportingPartnerIds.length} partner{edit.supportingPartnerIds.length === 1 ? '' : 's'}
          </span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
        >
          {copied ? 'Copied ✓' : 'Copy text'}
        </button>
      </div>

      {existing != null && (
        <div className="mt-3 rounded bg-slate-50 p-3 text-sm text-slate-600">
          <div className="text-xs uppercase tracking-wide text-slate-400">Replaces (index {edit.targetDescriptorIndex})</div>
          <div className="line-through">{existing}</div>
        </div>
      )}

      <div className="mt-3 rounded bg-amber-50 p-3 text-sm">
        <div className="text-xs uppercase tracking-wide text-amber-700">Proposed</div>
        <div className="mt-1">{edit.proposedText}</div>
      </div>

      <div className="mt-3 text-xs text-slate-600">
        <strong className="text-slate-800">Why:</strong> {edit.rationale}
      </div>
    </li>
  );
}

function descriptorAt(target: Props['target'], descriptor: 'know' | 'understand' | 'do', idx: number): string | null {
  const arr =
    descriptor === 'know' ? target.knowDescriptors :
    descriptor === 'understand' ? target.understandDescriptors :
    target.doDescriptors;
  return arr[idx] ?? null;
}
```

- [ ] **Step 2: Stage (no commit — rolls into T13)**

Run: `git add app/admin/synthesis/targets/[targetId]/ProposedKUDEditsPanel.tsx`.

---

### Task 13: ReRunButton + joint commit + verification

**Files:**
- Create: `app/admin/synthesis/targets/[targetId]/ReRunButton.tsx`

- [ ] **Step 1: Create the component**

Create `app/admin/synthesis/targets/[targetId]/ReRunButton.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  targetId: string;
  slug: string;
  stale: boolean;
  submissionsAvailable: boolean;
  lastRunCostCents: number | null;
}

function formatCents(c: number): string {
  // Cost is stored in 1/100 of a cent. Show in dollars to 4 decimals when small.
  const dollars = c / 10_000;
  if (dollars < 0.01) return `< $0.01`;
  return `$${dollars.toFixed(2)}`;
}

export function ReRunButton({ targetId, slug, stale, submissionsAvailable, lastRunCostCents }: Props) {
  const [pending, start] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  function run() {
    setErrorMsg(null);
    start(async () => {
      const res = await fetch(`/api/admin/synthesis/${targetId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setErrorMsg(`(${res.status}) ${json.error ?? 'Run failed'}`);
        return;
      }
      router.refresh();
    });
  }

  const disabled = pending || !submissionsAvailable;
  const tone = stale ? 'bg-amber-600 hover:bg-amber-700' : 'bg-slate-800 hover:bg-slate-900';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={disabled}
        className={`rounded ${tone} px-4 py-2 text-sm font-medium text-white disabled:opacity-50`}
      >
        {pending ? 'Running synthesis…' : stale ? 'Run synthesis (stale)' : 'Re-run synthesis'}
      </button>
      <div className="text-xs text-slate-500">
        {lastRunCostCents != null ? `last run cost: ${formatCents(lastRunCostCents)}` : ''}
      </div>
      {errorMsg && <div className="text-xs text-red-700">{errorMsg}</div>}
      {!submissionsAvailable && (
        <div className="text-xs text-slate-500">No submissions yet.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc check — must be clean now**

Run: `pnpm exec tsc --noEmit`. Expected: zero errors (the missing-module errors from T9 are now resolved by T10–T13 components landing).

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test 2>&1 | tail -5`. All tests pass.

- [ ] **Step 4: Run lint**

Run: `pnpm lint 2>&1 | tail -10`. The only allowed error is the pre-existing `tests/lib/rate-limit/ip-rate-limit.test.ts` `no-explicit-any` from before Plan 1. Any new error in T9–T13 must be fixed inline before committing.

If new `react/no-unescaped-entities` errors appear in your JSX (apostrophes inside `<p>` tags), fix them by replacing `'` with `&apos;` in the affected strings.

- [ ] **Step 5: Stage + commit T9–T13 jointly**

```bash
git add app/admin/synthesis/targets/[targetId]
git commit -m "feat(admin): per-target synthesis dashboard (header stats + insights + proposed edits + re-run)"
```

---

## Phase E — Documentation

### Task 14: Documentation pass

**Files:**
- Modify: `docs/superpowers/README.md`
- Modify: `README.md`

- [ ] **Step 1: Update the docs index**

In `docs/superpowers/README.md`, add a row to the Plans table:

```markdown
| 2026-05-19 | [`plans/2026-05-19-industry-partner-input-plan-3-synthesis.md`](./plans/2026-05-19-industry-partner-input-plan-3-synthesis.md) | ✅ Done. AI synthesis layer for the Industry Partner Input Tool — per-target dashboard with aggregated insights and proposed KUD edits (14 tasks). |
```

(Mark Done only after every task above is implemented and verified.)

- [ ] **Step 2: Update top-level README Status section**

In `README.md`, find the "Industry Partner Input — Plan 1 shipped." line under Status. After it, add a new line:

```markdown
**Industry Partner Input — Plan 3 shipped.** AI synthesis layer is live: faculty can now visit `/admin/synthesis?slug=<slug>` to see per-career-target aggregated themes, salary distributions, sample partner quotes, and proposed Know/Understand/Do edits with rationale. Each proposed edit shows a "Copy text" button — faculty curate edits into the curriculum tool manually. Plan 2 (admin views + project ratings) is still ahead.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/README.md README.md
git commit -m "docs: mark Industry Partner Input Plan 3 complete"
```

---

## Plan Self-Review Checklist

After implementing all 14 tasks:

- [ ] **Spec coverage:** Every Plan-3 deliverable from the spec is represented. The deferred items (project-rating heat map, Karpathy-wiki cross-target synthesis, auto-write-back) are intentionally left out and noted at the top of this plan.
- [ ] **No partner data leaks to wrong audiences.** The synthesis endpoint checks slug-based admin auth. The per-target page also checks slug. Partner-facing routes don't import any of the synthesis modules.
- [ ] **Cost guard fires before any LLM call.** Step 1 of `synthesizeTarget` calls `checkDailyCap()`. If it fails, no LLM request is made.
- [ ] **`partners.weight = 0` is honored.** The orchestrator filters those rows out before passing to the prompt builder. Both the test and the implementation enforce this.
- [ ] **The salary distribution is deterministic, not LLM-computed.** The orchestrator overwrites whatever the LLM returns with the SQL-computed value before persisting.
- [ ] **Real partner identity reaches the LLM.** The spec's design choice was to pass real names + companies + explicit weight metadata. The prompt builder does this; the system prompt instructs the LLM to weight inputs by `weight` but not invent details from training knowledge of those companies.
- [ ] **No auto-write-back to `careerTargets`.** The `ProposedKUDEditsPanel` only offers a "Copy text" button. Faculty paste edits manually into the existing curriculum tool. Verify by searching the diff for any `update(careerTargets)` or `update(subCompetencies)` calls outside the existing curriculum-tool code.
- [ ] **Staleness threshold is configurable.** `SYNTHESIS_STALENESS_THRESHOLD` in `.env.example` and `staleness.ts` reads it with a default of 5.
- [ ] **JSON schema and Zod schema agree.** Manually walk down the two definitions in `lib/ai/synthesis/schema.ts` — field names and required lists must match. (A future refactor could derive the JSON schema from Zod, but for v1 the duplication is acceptable.)
- [ ] **Type consistency at the seams:** `SynthesisResult`, `PersistedRun`, `IndexRow`, `Props` interfaces — names match across files. `getLatestRun` is exported once from `orchestrator.ts` and used by both the index page and the per-target page.

If any check fails, fix inline before declaring the plan done.

---

## What's NOT in this plan (for clarity)

- **Project ratings heat map.** Waits until Plan 2 ships the `partner_project_ratings` table + partner-facing rating UI. Once those exist, a small follow-on plan can add the heat map at `/admin/synthesis/projects`.
- **Auto-write-back of accepted edits to `careerTargets`.** Faculty curate manually for v1. Adding write-back would require careful versioning of synthesis runs vs. edits and is deferred.
- **Karpathy-wiki cross-target synthesis.** A higher-order synthesis that finds themes across all career targets at once. The spec calls this out as v2.
- **Per-partner rate limiting and token expiry.** Both deferred to Plan 2 alongside the rest of the admin surface.
- **Project comment summaries (`project_comment_summaries` table).** Part of the deferred project-ratings work.
- **CI integration / next.config update.** No changes needed; existing Next.js config covers the new routes.
