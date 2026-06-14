# Guided Faculty-Reconciliation Review Implementation Plan (Piece 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guided `reconcile` stage between synthesis and the review panel where faculty give per-section conversational feedback (apparent outcomes → incoming → outgoing KUDs), the AI proposes concrete edits, and accepted edits are applied to the profile — with faculty overrides marked `source:'instructor'` (the 'claimed' band), never silently evidenced. The transcript is stored on the snapshot.

**Architecture:** Engine-first. Pure `applyReconciliation` holds the evidence-discipline guarantee (deterministic, unit-tested). A new `reconcile-feedback` AI function PROPOSES edits (strict JSON, cost-capped route). A `ReconciliationStepper` drives the 3-step UX; `CaptureClient` gains a `reconcile` stage feeding the unchanged review panel. A nullable `reconciliation_log` JSONB column on `course_capture_snapshots` stores the transcript at Save-Snapshot.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle + Postgres, Zod 4, OpenAI strict structured output via `provider.complete`, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-14-guided-faculty-reconciliation-review-design.md`

**Conventions:** single test `pnpm vitest run <path>`; full suite `pnpm test`; typecheck `pnpm tsc --noEmit` (run explicitly). Migrations: `pnpm db:generate` then `DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | sed 's/[[:space:]]*#.*$//')" pnpm db:migrate` — local Postgres IS production; migrations must be additive; inspect generated SQL before applying. OpenAI strict schemas: every property in `properties` MUST be in `required`; optionals are nullable unions. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Key existing shapes:**
- `CaptureProfileSource = z.enum(['instructor','materials','inferred'])`.
- `competencies[]: { statement, k_depth, u_depth, d_depth, type, source?, citations?, evidence_* }` (foundational → K/U null).
- `incoming_expectations[]: { statement, expected_depth:{k,u,d}, confidence, source?, citations? }`.
- `revised_objectives_draft: string[] | null` (apparent outcomes — plain strings, no per-item provenance).
- AI fn pattern: `provider.complete({ systemPrompt, userMessage, schemaName, jsonSchema, validate })` → `{ data, telemetry:{ costUsdCents }, model }`; schemas live in `lib/ai/schemas.ts`; functions in `lib/ai/analyze/`.
- Cost-cap route pattern (`app/api/capture/[code]/stress-test/route.ts`): `isValidSlug` → `checkDailyCap()` (429 if `!ok`) → work → `recordSpend(costCents)` → return `{ ..., telemetry }`.

**File map:**
- `lib/ai/schemas.ts` — Proposal Zod + strict JSON schema + types.
- `lib/capture/apply-reconciliation.ts` (create) — pure apply + provenance.
- `lib/db/schema.ts` + `drizzle/0038_*.sql` — `reconciliation_log` column.
- `lib/db/capture-snapshots-queries.ts` — `reconciliationLog` on `CreateSnapshotInput`/insert/row.
- `app/api/capture/[code]/snapshots/route.ts` — read+persist `reconciliationLog`.
- `lib/ai/analyze/reconcile-feedback.ts` (create) + `lib/ai/prompts/reconcile-feedback.md` (create) + `lib/ai/function-settings.ts` (functionId).
- `app/api/capture/[code]/reconcile/route.ts` (create) — cost-capped proposals route.
- `app/capture/[code]/ReconciliationStepper.tsx` (create) + `app/capture/[code]/CaptureClient.tsx` (stage).
- `docs/STATE.md`.

---

### Task 1: Proposal schema (Zod + strict JSON) + types

**Files:**
- Modify: `lib/ai/schemas.ts` (append)
- Test: `tests/lib/ai/reconcile-schema.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/ai/reconcile-schema.test.ts
import { describe, it, expect } from 'vitest';
import { reconcileProposalsSchema, reconcileProposalsJsonSchema } from '@/lib/ai/schemas';

describe('reconcileProposalsSchema', () => {
  it('parses a valid proposals payload', () => {
    const r = reconcileProposalsSchema.parse({
      proposals: [
        { index: 0, action: 'modify', revised: { statement: 'Sharper outcome', k: null, u: null, d: 3 }, rationale: 'faculty lowered Do' },
        { index: 2, action: 'remove', revised: null, rationale: 'not actually taught' },
        { index: null, action: 'add', revised: { statement: 'New outcome', k: null, u: null, d: 2 }, rationale: 'added by faculty' },
      ],
    });
    expect(r.proposals).toHaveLength(3);
  });
  it('rejects an unknown action', () => {
    expect(() => reconcileProposalsSchema.parse({ proposals: [{ index: 0, action: 'nuke', revised: null, rationale: 'x' }] })).toThrow();
  });
});

describe('reconcileProposalsJsonSchema (OpenAI strict)', () => {
  it('lists every property in required, recursively', () => {
    const check = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n.type === 'object' || (Array.isArray(n.type) && (n.type as string[]).includes('object'))) {
        const props = Object.keys((n.properties as Record<string, unknown>) ?? {});
        const req = (n.required as string[]) ?? [];
        expect([...req].sort()).toEqual([...props].sort());
        for (const v of Object.values((n.properties as Record<string, unknown>) ?? {})) check(v);
      }
      if (n.items) check(n.items);
    };
    check(reconcileProposalsJsonSchema);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run tests/lib/ai/reconcile-schema.test.ts` (exports missing).

- [ ] **Step 3: Implement (append to `lib/ai/schemas.ts`)**

```typescript
import { z } from 'zod'; // (already imported at top — do NOT duplicate; reuse existing import)

export const reconcileActionSchema = z.enum(['keep', 'modify', 'remove', 'add']);
export const reconcileRevisedSchema = z.object({
  statement: z.string().nullable(),
  k: z.number().int().nullable(),
  u: z.number().int().nullable(),
  d: z.number().int().nullable(),
}).nullable();
export const reconcileProposalSchema = z.object({
  index: z.number().int().nullable(),
  action: reconcileActionSchema,
  revised: reconcileRevisedSchema,
  rationale: z.string(),
});
export const reconcileProposalsSchema = z.object({
  proposals: z.array(reconcileProposalSchema),
});
export type ReconcileProposal = z.infer<typeof reconcileProposalSchema>;
export type ReconcileProposals = z.infer<typeof reconcileProposalsSchema>;
export type ReconcileSection = 'apparent_outcomes' | 'incoming' | 'outgoing';

/** OpenAI strict structured-output schema — every property in `required`,
 *  optionals as nullable unions (mirrors skillsMergeJsonSchema discipline). */
export const reconcileProposalsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'action', 'revised', 'rationale'],
        properties: {
          index: { type: ['integer', 'null'] },
          action: { type: 'string', enum: ['keep', 'modify', 'remove', 'add'] },
          revised: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['statement', 'k', 'u', 'd'],
            properties: {
              statement: { type: ['string', 'null'] },
              k: { type: ['integer', 'null'] },
              u: { type: ['integer', 'null'] },
              d: { type: ['integer', 'null'] },
            },
          },
          rationale: { type: 'string' },
        },
      },
    },
  },
} as const;
```

- [ ] **Step 4: Run, expect PASS + tsc** — test green; `pnpm tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/schemas.ts tests/lib/ai/reconcile-schema.test.ts
git commit -m "feat(reconcile): Proposal schema (Zod + strict OpenAI JSON) + types"
```

---

### Task 2: Pure `applyReconciliation` (the evidence-discipline engine)

**Files:**
- Create: `lib/capture/apply-reconciliation.ts`
- Test: `tests/lib/capture/apply-reconciliation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/capture/apply-reconciliation.test.ts
import { describe, it, expect } from 'vitest';
import { applyReconciliation } from '@/lib/capture/apply-reconciliation';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const baseProfile = (over: Partial<CaptureProfile>): CaptureProfile => ({
  course_code: 'GC 9999', scale_version: 'kud-1' as CaptureProfile['scale_version'], generated_at: 'now',
  competencies: [], incoming_expectations: [], verification_summary: { course_shape: 'x', strongest_evidence: ['e'], dimensional_patterns: [], catalog_vs_evidence: [] } as CaptureProfile['verification_summary'],
  audit_notes: {} as CaptureProfile['audit_notes'], revised_objectives_draft: null, course_emphasis: null,
  ...over,
}) as CaptureProfile;

describe('applyReconciliation — outgoing (competencies)', () => {
  const profile = baseProfile({ competencies: [
    { statement: 'Color mgmt', k_depth: 3, u_depth: 3, d_depth: 4, type: 'technical', source: 'materials', citations: [{ chunkId: 'c1', messageId: null }] },
    { statement: 'Curiosity', k_depth: null, u_depth: null, d_depth: 3, type: 'foundational', source: 'inferred' },
  ] as CaptureProfile['competencies'] });

  it('modify flips source→instructor, clears citations, overwrites depth', () => {
    const out = applyReconciliation(profile, 'outgoing', [{ index: 0, action: 'modify', revised: { statement: null, k: null, u: null, d: 2 }, rationale: 'x' }]);
    expect(out.competencies[0]!.d_depth).toBe(2);
    expect(out.competencies[0]!.k_depth).toBe(3); // unchanged (revised.k null)
    expect(out.competencies[0]!.source).toBe('instructor');
    expect(out.competencies[0]!.citations ?? []).toEqual([]);
  });
  it('does not set K/U on a foundational competency', () => {
    const out = applyReconciliation(profile, 'outgoing', [{ index: 1, action: 'modify', revised: { statement: null, k: 4, u: 4, d: 5 }, rationale: 'x' }]);
    expect(out.competencies[1]!.k_depth).toBeNull();
    expect(out.competencies[1]!.u_depth).toBeNull();
    expect(out.competencies[1]!.d_depth).toBe(5);
  });
  it('remove drops the item; add appends with source=instructor', () => {
    const out = applyReconciliation(profile, 'outgoing', [
      { index: 0, action: 'remove', revised: null, rationale: 'x' },
      { index: null, action: 'add', revised: { statement: 'New skill', k: null, u: null, d: 9 }, rationale: 'x' },
    ]);
    expect(out.competencies.find(c => c.statement === 'Color mgmt')).toBeUndefined();
    const added = out.competencies.find(c => c.statement === 'New skill')!;
    expect(added.source).toBe('instructor');
    expect(added.d_depth).toBe(5); // clamped 9→5
  });
});

describe('applyReconciliation — incoming + apparent outcomes', () => {
  it('incoming modify writes expected_depth + source=instructor', () => {
    const p = baseProfile({ incoming_expectations: [{ statement: 'Spot color', expected_depth: { k: 1, u: null, d: 2 }, confidence: 'low', source: 'materials' }] as CaptureProfile['incoming_expectations'] });
    const out = applyReconciliation(p, 'incoming', [{ index: 0, action: 'modify', revised: { statement: 'Spot color matching', k: null, u: null, d: 3 }, rationale: 'x' }]);
    expect(out.incoming_expectations[0]!.statement).toBe('Spot color matching');
    expect(out.incoming_expectations[0]!.expected_depth.d).toBe(3);
    expect(out.incoming_expectations[0]!.source).toBe('instructor');
  });
  it('apparent outcomes are plain-string edits (no source)', () => {
    const p = baseProfile({ revised_objectives_draft: ['Old A', 'Old B'] });
    const out = applyReconciliation(p, 'apparent_outcomes', [
      { index: 0, action: 'modify', revised: { statement: 'New A', k: null, u: null, d: null }, rationale: 'x' },
      { index: 1, action: 'remove', revised: null, rationale: 'x' },
      { index: null, action: 'add', revised: { statement: 'Added C', k: null, u: null, d: null }, rationale: 'x' },
    ]);
    expect(out.revised_objectives_draft).toEqual(['New A', 'Added C']);
  });
  it('keep / bad index / unknown leave items untouched', () => {
    const p = baseProfile({ revised_objectives_draft: ['Only'] });
    const out = applyReconciliation(p, 'apparent_outcomes', [{ index: 0, action: 'keep', revised: null, rationale: 'x' }, { index: 7, action: 'modify', revised: { statement: 'ghost', k: null, u: null, d: null }, rationale: 'x' }]);
    expect(out.revised_objectives_draft).toEqual(['Only']);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — function not defined.

- [ ] **Step 3: Implement `lib/capture/apply-reconciliation.ts`**

```typescript
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import type { ReconcileProposal, ReconcileSection } from '@/lib/ai/schemas';

const clampDepth = (n: number | null | undefined): number | null =>
  n == null ? null : Math.max(0, Math.min(5, Math.trunc(n)));

/**
 * Deterministically apply the faculty-ACCEPTED reconciliation proposals to one
 * section of the profile. This is the evidence-discipline guarantee: any item a
 * faculty edit modifies or adds is marked `source: 'instructor'` (the 'claimed'
 * band) with citations cleared — never silently presented as evidenced. The AI
 * only proposed; this code (not the model) sets provenance.
 */
export function applyReconciliation(
  profile: CaptureProfile,
  section: ReconcileSection,
  accepted: ReconcileProposal[],
): CaptureProfile {
  // Edits keyed by original index (modify/remove); adds collected separately.
  const byIndex = new Map<number, ReconcileProposal>();
  const adds: ReconcileProposal[] = [];
  for (const p of accepted) {
    if (p.action === 'add') { adds.push(p); continue; }
    if (p.action === 'keep') continue;
    if (p.index == null) continue;
    byIndex.set(p.index, p);
  }

  if (section === 'apparent_outcomes') {
    const items = profile.revised_objectives_draft ?? [];
    const next: string[] = [];
    items.forEach((s, i) => {
      const e = byIndex.get(i);
      if (e?.action === 'remove') return;
      if (e?.action === 'modify' && e.revised?.statement) { next.push(e.revised.statement); return; }
      next.push(s);
    });
    for (const a of adds) if (a.revised?.statement) next.push(a.revised.statement);
    return { ...profile, revised_objectives_draft: next };
  }

  if (section === 'incoming') {
    const items = profile.incoming_expectations ?? [];
    const next = [] as typeof items;
    items.forEach((it, i) => {
      const e = byIndex.get(i);
      if (e?.action === 'remove') return;
      if (e?.action === 'modify' && e.revised) {
        next.push({
          ...it,
          statement: e.revised.statement ?? it.statement,
          expected_depth: {
            k: e.revised.k != null ? clampDepth(e.revised.k) : it.expected_depth.k,
            u: e.revised.u != null ? clampDepth(e.revised.u) : it.expected_depth.u,
            d: e.revised.d != null ? (clampDepth(e.revised.d) ?? it.expected_depth.d) : it.expected_depth.d,
          },
          source: 'instructor',
          citations: [],
        });
        return;
      }
      next.push(it);
    });
    for (const a of adds) if (a.revised?.statement) {
      next.push({
        statement: a.revised.statement,
        expected_depth: { k: clampDepth(a.revised.k), u: clampDepth(a.revised.u), d: clampDepth(a.revised.d) ?? 0 },
        confidence: 'low',
        source: 'instructor',
        citations: [],
      } as typeof items[number]);
    }
    return { ...profile, incoming_expectations: next };
  }

  // section === 'outgoing' (competencies)
  const items = profile.competencies ?? [];
  const next = [] as typeof items;
  items.forEach((it, i) => {
    const e = byIndex.get(i);
    if (e?.action === 'remove') return;
    if (e?.action === 'modify' && e.revised) {
      const foundational = it.type === 'foundational';
      next.push({
        ...it,
        statement: e.revised.statement ?? it.statement,
        k_depth: foundational ? null : (e.revised.k != null ? clampDepth(e.revised.k) : it.k_depth),
        u_depth: foundational ? null : (e.revised.u != null ? clampDepth(e.revised.u) : it.u_depth),
        d_depth: e.revised.d != null ? (clampDepth(e.revised.d) ?? it.d_depth) : it.d_depth,
        source: 'instructor',
        citations: [],
      });
      return;
    }
    next.push(it);
  });
  for (const a of adds) if (a.revised?.statement) {
    next.push({
      statement: a.revised.statement,
      k_depth: clampDepth(a.revised.k),
      u_depth: clampDepth(a.revised.u),
      d_depth: clampDepth(a.revised.d) ?? 0,
      type: 'technical',
      source: 'instructor',
      citations: [],
    } as typeof items[number]);
  }
  return { ...profile, competencies: next };
}
```

(NOTE: confirm the exact competency/incoming field names against `lib/ai/capture/schema.ts` before finalizing — `k_depth/u_depth/d_depth`, `expected_depth.{k,u,d}`, `type`, `source`, `citations`. Adjust the casts so `pnpm tsc --noEmit` passes under strict mode.)

- [ ] **Step 4: Run, expect PASS + tsc** — test green; `pnpm tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/capture/apply-reconciliation.ts tests/lib/capture/apply-reconciliation.test.ts
git commit -m "feat(reconcile): pure applyReconciliation — faculty override → source=instructor (claimed)"
```

---

### Task 3: Migration — `reconciliation_log` on snapshots + persistence wiring

**Files:**
- Modify: `lib/db/schema.ts` (the `courseCaptureSnapshots` table, ~line 375)
- Generate: `drizzle/0038_*.sql`
- Modify: `lib/db/capture-snapshots-queries.ts` (`SnapshotRow`, `CreateSnapshotInput`, `createSnapshot`, `rowToSnapshot`)
- Modify: `app/api/capture/[code]/snapshots/route.ts` (read body + pass through)
- Test: `tests/lib/db/reconciliation-log.test.ts` (create — real-DB round-trip, mirrors existing snapshot query tests)

- [ ] **Step 1: Add the column to schema + a shared log type**

In `lib/db/schema.ts`, add a `reconciliationLog` column to `courseCaptureSnapshots` (place near `reviewerNote`):
```typescript
  reconciliationLog: jsonb('reconciliation_log').$type<ReconciliationLogEntry[]>(),
```
At the top of `lib/db/schema.ts` (or import from schemas), define/import the type. Add to `lib/ai/schemas.ts` (Task 1's file):
```typescript
export interface ReconciliationLogEntry {
  section: ReconcileSection;
  feedback: string;
  proposals: ReconcileProposal[];
  decisions: Array<{ index: number | null; accepted: boolean }>;
  at: string;
}
```
and `import type { ReconciliationLogEntry } from '@/lib/ai/schemas';` in `schema.ts` (`jsonb(...).$type<...>()` needs the type only).

- [ ] **Step 2: Generate + inspect + apply the migration**

Run: `pnpm db:generate` → inspect the generated `drizzle/0038_*.sql`. Confirm it is exactly an additive `ALTER TABLE course_capture_snapshots ADD COLUMN reconciliation_log jsonb;` (nullable, no default, no data change). Then apply:
```bash
DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | sed 's/[[:space:]]*#.*$//')" pnpm db:migrate
```

- [ ] **Step 3: Thread through the query layer**

In `lib/db/capture-snapshots-queries.ts`: add `reconciliationLog: ReconciliationLogEntry[] | null` to `SnapshotRow`; add `reconciliationLog?: ReconciliationLogEntry[] | null` to `CreateSnapshotInput`; set it in the `createSnapshot` insert (`reconciliationLog: input.reconciliationLog ?? null`); map it in `rowToSnapshot`. Import the type from `@/lib/ai/schemas`.

- [ ] **Step 4: Persist from the snapshots route**

In `app/api/capture/[code]/snapshots/route.ts`, after the body parse (`const body = await req.json()...`), read:
```typescript
  const reconciliationLog = Array.isArray(body.reconciliationLog) ? body.reconciliationLog as ReconciliationLogEntry[] : null;
```
and pass `reconciliationLog,` into the `createSnapshot({...})` call. Import the type.

- [ ] **Step 5: Write + run the round-trip test**

```typescript
// tests/lib/db/reconciliation-log.test.ts
import { describe, it, expect } from 'vitest';
import { createSnapshot, getSnapshotById } from '@/lib/db/capture-snapshots-queries';
// Build a minimal valid CreateSnapshotInput (mirror an existing snapshot test in this dir for the profile/inputsMeta shape).
// Assert: a snapshot created WITH reconciliationLog round-trips; one created WITHOUT it reads back null.
```
Model the input shape on the existing snapshot query test in `tests/lib/db/` (find it: `grep -rl createSnapshot tests`). Assert the log round-trips and is `null` when omitted.

Run: `pnpm vitest run tests/lib/db/reconciliation-log.test.ts` (green) + `pnpm tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts drizzle/ lib/db/capture-snapshots-queries.ts "app/api/capture/[code]/snapshots/route.ts" lib/ai/schemas.ts tests/lib/db/reconciliation-log.test.ts
git commit -m "feat(reconcile): reconciliation_log JSONB on snapshots (migration 0038) + persistence"
```

---

### Task 4: `reconcile-feedback` AI function + prompt + cost-capped route

**Files:**
- Create: `lib/ai/analyze/reconcile-feedback.ts`
- Create: `lib/ai/prompts/reconcile-feedback.md`
- Modify: `lib/ai/function-settings.ts` (`AI_FUNCTION_IDS`, `DEFAULT_TIERS`, `FUNCTION_LABELS`, `FUNCTION_DESCRIPTIONS`)
- Create: `app/api/capture/[code]/reconcile/route.ts`
- Test: `tests/lib/ai/reconcile-feedback.test.ts`

- [ ] **Step 1: Register the functionId**

In `lib/ai/function-settings.ts`: add `'reconcile-feedback'` to `AI_FUNCTION_IDS`; `'reconcile-feedback': 'default'` to `DEFAULT_TIERS` (with a one-line rationale comment); and entries in `FUNCTION_LABELS` (`'Reconcile feedback (guided faculty review)'`) + `FUNCTION_DESCRIPTIONS`.

- [ ] **Step 2: Write the prompt `lib/ai/prompts/reconcile-feedback.md`**

Frontmatter `name: reconcile-feedback`. Body: the model receives a section type, the section's current items (with values + provenance), and the faculty's prose feedback; it emits `{ proposals: [...] }`. Rules to encode:
- Propose only edits the feedback warrants; reference each item by its `index`. `keep` items the feedback doesn't touch (or simply omit them — apply treats absent as keep).
- `modify` carries the faculty-intended revised values in `revised`; `add` uses `index:null`; `remove` uses `revised:null`.
- For `apparent_outcomes` only `revised.statement` matters (k/u/d null). For `incoming`/`outgoing`, set the depths the faculty asserts.
- **NEVER claim evidence**: the model does not set provenance or mark anything verified — it only proposes the substance; the application layer records that a faculty change is instructor-asserted.
- One-line `rationale` per proposal; keep depths in 0–5.

- [ ] **Step 3: Write the failing test**

```typescript
// tests/lib/ai/reconcile-feedback.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: async () => ({
    complete: async ({ validate }: { validate: (raw: unknown) => unknown }) => ({
      data: validate({ proposals: [{ index: 0, action: 'modify', revised: { statement: null, k: null, u: null, d: 2 }, rationale: 'faculty lowered Do' }] }),
      telemetry: { costUsdCents: 1 }, model: 'fake',
    }),
  }),
}));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: async () => 'SYS' }));

import { reconcileFeedback } from '@/lib/ai/analyze/reconcile-feedback';

describe('reconcileFeedback', () => {
  it('returns validated proposals + telemetry', async () => {
    const out = await reconcileFeedback({ section: 'outgoing', items: [{ statement: 'Color mgmt', k: 3, u: 3, d: 4 }], feedback: 'students cannot do this independently' });
    expect(out.proposals[0]!.action).toBe('modify');
    expect(out.telemetry.costUsdCents).toBe(1);
  });
});
```

- [ ] **Step 4: Run, expect FAIL**, then implement `lib/ai/analyze/reconcile-feedback.ts`:

```typescript
import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import {
  reconcileProposalsSchema,
  reconcileProposalsJsonSchema,
  type ReconcileProposals,
  type ReconcileSection,
} from '@/lib/ai/schemas';

export interface ReconcileFeedbackArgs {
  section: ReconcileSection;
  items: unknown[]; // the section's current items (statement + depths + provenance), index-ordered
  feedback: string;
  courseContext?: { code?: string; title?: string };
}

export async function reconcileFeedback(
  args: ReconcileFeedbackArgs,
): Promise<ReconcileProposals & { telemetry: { costUsdCents: number }; model: string }> {
  const systemPrompt = await loadPrompt('reconcile-feedback');
  const provider = await getProviderForFunction('reconcile-feedback');
  const userMessage = [
    args.courseContext?.code ? `Course: ${args.courseContext.code} — ${args.courseContext.title ?? ''}` : '',
    `Section: ${args.section}`,
    '',
    'Current items (index-ordered):',
    JSON.stringify(args.items, null, 2),
    '',
    'Faculty feedback:',
    args.feedback,
  ].filter(Boolean).join('\n');
  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'reconcile_proposals',
    jsonSchema: reconcileProposalsJsonSchema,
    validate: (raw) => reconcileProposalsSchema.parse(raw),
  });
  return { ...result.data, telemetry: { costUsdCents: result.telemetry.costUsdCents }, model: result.model };
}
```
(Confirm `provider.complete`'s exact return field names — `result.data` / `result.telemetry.costUsdCents` / `result.model` — against `lib/ai/provider.ts`; adjust if different.)

- [ ] **Step 5: Create the cost-capped route `app/api/capture/[code]/reconcile/route.ts`**

Mirror `app/api/capture/[code]/stress-test/route.ts`'s gate + cap pattern:
```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { reconcileFeedback } from '@/lib/ai/analyze/reconcile-feedback';
import type { ReconcileSection } from '@/lib/ai/schemas';

interface RouteContext { params: Promise<{ code: string }>; }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const section = body.section as ReconcileSection;
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : '';
  const items = Array.isArray(body.items) ? body.items : [];
  if (!['apparent_outcomes', 'incoming', 'outgoing'].includes(section)) {
    return NextResponse.json({ error: 'invalid section' }, { status: 400 });
  }
  if (!feedback) return NextResponse.json({ error: 'feedback is required' }, { status: 400 });

  try {
    const out = await reconcileFeedback({ section, items, feedback, courseContext: { code: courseCode } });
    await recordSpend(out.telemetry.costUsdCents);
    return NextResponse.json({ proposals: out.proposals, telemetry: { ...out.telemetry, model: out.model } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'reconcile failed';
    console.error(`POST /api/capture/${courseCode}/reconcile failed:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run + verify** — `pnpm vitest run tests/lib/ai/reconcile-feedback.test.ts` (green); `pnpm tsc --noEmit` (clean); `pnpm vitest run tests/app/api/settings` or the function-settings test if one asserts the ID list (update it if it enumerates IDs).

- [ ] **Step 7: Commit**

```bash
git add lib/ai/analyze/reconcile-feedback.ts lib/ai/prompts/reconcile-feedback.md lib/ai/function-settings.ts "app/api/capture/[code]/reconcile/route.ts" tests/lib/ai/reconcile-feedback.test.ts
git commit -m "feat(reconcile): reconcile-feedback AI function + prompt + cost-capped route"
```

---

### Task 5: `ReconciliationStepper` UI + `CaptureClient` stage integration

**Files:**
- Create: `app/capture/[code]/ReconciliationStepper.tsx`
- Modify: `app/capture/[code]/CaptureClient.tsx`
- Test: `tests/app/capture/reconciliation-stepper.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
// tests/app/capture/reconciliation-stepper.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReconciliationStepper } from '@/app/capture/[code]/ReconciliationStepper';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const profile = {
  course_code: 'GC 1', scale_version: 'kud-1', generated_at: 'now',
  competencies: [{ statement: 'Color mgmt', k_depth: 3, u_depth: 3, d_depth: 4, type: 'technical', source: 'materials' }],
  incoming_expectations: [], revised_objectives_draft: ['Deliver artwork'],
  verification_summary: { course_shape: 'x', strongest_evidence: ['e'], dimensional_patterns: [], catalog_vs_evidence: [] },
  audit_notes: {}, course_emphasis: null,
} as unknown as CaptureProfile;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ proposals: [{ index: 0, action: 'modify', revised: { statement: null, k: null, u: null, d: 2 }, rationale: 'lower Do' }] }) }));
});

describe('ReconciliationStepper', () => {
  it('shows the first step (apparent outcomes) and a feedback box', () => {
    render(<ReconciliationStepper profile={profile} slug="s" courseCode="GC 1" onComplete={() => {}} />);
    expect(screen.getByText(/Apparent outcomes/i)).toBeTruthy();
    expect(screen.getByText(/Deliver artwork/)).toBeTruthy();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
  it('submitting feedback fetches proposals and renders them for accept', async () => {
    render(<ReconciliationStepper profile={profile} slug="s" courseCode="GC 1" onComplete={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'tighten this' } });
    fireEvent.click(screen.getByRole('button', { name: /get suggestions|propose|suggest/i }));
    await waitFor(() => expect(screen.getByText(/lower Do/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run, expect FAIL**, then implement `ReconciliationStepper.tsx`.

Contract (props): `{ profile: CaptureProfile; slug: string; courseCode: string; onComplete: (reconciled: CaptureProfile, log: ReconciliationLogEntry[]) => void }`. Behavior:
- Local `working` state initialized from `profile`; local `step` (0=apparent_outcomes, 1=incoming, 2=outgoing); local `log: ReconciliationLogEntry[]`; local `proposals` + `pending`.
- For the current step, render the section's items from `working` (reuse `DepthChip` from `CapturedView` or the review panel for incoming/outgoing; plain list for apparent outcomes) + a `<textarea>` feedback box + a "Get suggestions" button.
- On submit: POST `/api/capture/${courseCode}/reconcile?slug=${slug}` with `{ section, items, feedback }` where `items` is the current section's array (index-ordered). Render returned `proposals` as a diff list: each shows action + before/after + rationale + Accept/Reject (default Accept) + (for modify/add) editable depth/statement inputs ("tweak").
- "Apply accepted" → call `applyReconciliation(working, section, acceptedProposals)` → setWorking; append a `ReconciliationLogEntry` to `log` (section, feedback, proposals, decisions, at — use a passed-in or `new Date().toISOString()` timestamp); clear proposals.
- "Next"/"Back" move between steps; on the last step, "Continue to review" calls `onComplete(working, log)`.
- Reuse the section→field mapping: apparent_outcomes ↔ `revised_objectives_draft` (strings); incoming ↔ `incoming_expectations` ({statement, expected_depth}); outgoing ↔ `competencies` ({statement, k_depth,u_depth,d_depth}). Build the `items` payload for the API as `{ statement, k, u, d }`-shaped objects (map k_depth→k etc.) so the prompt sees a uniform shape.

Keep it a focused client component; match the visual idiom of the existing capture panels (mono-plex section labels, DepthChip). The load-bearing logic (the fetch→proposals→applyReconciliation→log loop + onComplete) must be exactly as above; presentational details may follow the codebase's existing styles.

- [ ] **Step 3: Wire `CaptureClient`**

- Extend `type Stage = 'chat' | 'generating' | 'reconcile' | 'review'`.
- On synthesis success (where it currently `setStage('review')` after a fresh generate), `setStage('reconcile')` instead.
- Render: when `stage === 'reconcile'`, render `<ReconciliationStepper profile={profile!} slug={slug} courseCode={courseCode} onComplete={(reconciled, log) => { setProfile(reconciled); setReconciliationLog(log); setStage('review'); }} />`. Add `const [reconciliationLog, setReconciliationLog] = useState<ReconciliationLogEntry[]>([])`.
- When a re-opened existing profile lands on `review`, add a small "Reconcile with the auditor" button that `setStage('reconcile')`.
- Where the snapshot is saved (the Save-Snapshot POST to the snapshots route), include `reconciliationLog` in the request body so Task 3's route persists it. (Locate the snapshot-save call — it may live in `ProfileReviewPanel`/`SnapshotHistoryPanel`; thread `reconciliationLog` down as a prop and add it to that POST body. If the snapshot save is triggered from the review panel, pass `reconciliationLog` as a prop to it.)

- [ ] **Step 4: Run + verify** — `pnpm vitest run tests/app/capture/reconciliation-stepper.test.tsx` (green); `pnpm tsc --noEmit` (clean); `pnpm vitest run tests/app/capture/` (existing capture tests still green).

- [ ] **Step 5: Commit**

```bash
git add "app/capture/[code]/ReconciliationStepper.tsx" "app/capture/[code]/CaptureClient.tsx" tests/app/capture/reconciliation-stepper.test.tsx
git commit -m "feat(reconcile): ReconciliationStepper UI + CaptureClient reconcile stage"
```

---

### Task 6: Full suite + STATE.md

- [ ] **Step 1: Full suite + tsc** — `pnpm tsc --noEmit && pnpm test` (clean + green; report counts).

- [ ] **Step 2: Update `docs/STATE.md`**

- Schema section / migration lineage: prepend migration `0038` (`reconciliation_log` JSONB on `course_capture_snapshots`; additive; applied date).
- Routes / AI functions: add `POST /api/capture/[code]/reconcile` + the `reconcile-feedback` functionId.
- "What's live" / Active arc: one line — guided faculty-reconciliation review shipped (Piece 2): synthesis → reconcile stage → review; faculty override → `source='instructor'` (claimed); transcript in `reconciliation_log`. Spec/plan links.
- Deferred/debt: update the Piece-2 entry to RESOLVED; record the v1 limitation (in-progress reconcile is client-side only — a mid-pass reload restarts it; server-side `reconcile_messages` persistence is the future enhancement) + the optional `revised_objectives_draft` → `apparent_outcomes` rename still deferred.

- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): guided faculty-reconciliation review shipped (Piece 2, migration 0038)"
```

---

## Plan self-review (done at write time)

- **Spec coverage:** Proposal schema (T1); pure apply + provenance flip + foundational/clamp (T2); `reconciliation_log` migration + persistence (T3); `reconcile-feedback` fn + prompt + cost-capped route (T4); stepper UI + `reconcile` stage + re-open entry + log-to-snapshot wiring (T5); suite + STATE (T6). The "model proposes, code applies provenance" guarantee is T2 (deterministic) + T4 prompt rule. ✓
- **Placeholder scan:** engine tasks (T1–T4) carry complete code; T5's load-bearing loop is fully specified with a contract + the exact fetch→apply→log→onComplete logic; the two "confirm exact field/return names" notes are explicit verification steps, not deferred work. ✓
- **Type consistency:** `ReconcileProposal`/`ReconcileSection`/`ReconciliationLogEntry`/`applyReconciliation`/`reconcileFeedback`/`reconcile-feedback` (functionId) consistent across tasks; section literals `apparent_outcomes|incoming|outgoing` identical everywhere; `revised:{statement,k,u,d}` shape consistent (schema, apply, prompt, UI payload). ✓
- **Migration safety:** 0038 is a single additive nullable JSONB column; inspect-before-apply step included; local Postgres is prod. ✓
- **Frozen-surface guard:** no change to synthesis, the profile schema field set, `CaptureProfileSource`, `deriveEvidenceBand`, or the matrix; the review panel only receives an already-reconciled profile. ✓
