# Problem-Solving Capture Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make productive-failure / structured-reflection capture honest — distinguish "not assessed" from "absent" (new `no_data` state), stop the v1 path fabricating all-`absent` blocks, require reflection to be evidenced, and surface "no data" distinctly — closing the scaffolding-spec "no data ≠ absent" requirement.

**Architecture:** Presence-as-sentinel (null `productive_failure_conditions` ⇒ not assessed; a present block ⇒ assessed). Pure scoring (`scaffolding.ts`) gains a no-data path and a 5th `pf_status` band excluded from rollups; the loader (`scaffolding-queries.ts`) reclassifies pre-fix snapshots to no-data via a deploy-time epoch; the Zod + JSON schemas add a citation-backed `structured_post_mortem_evidence`; the v1 prompt + JSON schema are unified with the already-correct v2 path; the capture UI adds a soft Area-7 generation nudge; the scaffolding strip renders `no_data` distinctly with a course-level grain disclaimer.

**Tech Stack:** TypeScript (strict), Zod, OpenAI strict-mode JSON schema, Next.js App Router (RSC + client), Vitest. Spec: `docs/superpowers/specs/2026-06-04-problem-solving-capture-fix-design.md`.

---

## File Structure

- **Modify** `lib/program/scaffolding.ts` — `PfStatus` gains `no_data`; `snapshotPfContribution` returns `number | null`; `aggregateSubCompetency` computes over data-bearing cells and emits `no_data` when none.
- **Modify** `lib/db/scaffolding-queries.ts` — `PF_CONTRACT_EPOCH` + a pure `pfForSnapshot()` cutoff helper; loader uses it.
- **Modify** `lib/ai/capture/schema.ts` — add `structured_post_mortem_evidence` + a `superRefine` to `productiveFailureConditionsSchema`; update the doc comment to the authoritative presence contract.
- **Modify** `lib/ai/analyze/capture-scores.ts` — widen v1 `productive_failure_conditions` JSON schema to nullable; add the evidence field to its `properties` + `required`.
- **Modify** `lib/ai/prompts/capture-scores.md` + `lib/ai/prompts/capture-synthesis.md` — honest emit-only-if-probed (scores) + reflection-evidence calibration (both).
- **Modify** `app/program/scaffolding/ScaffoldingStripClient.tsx` — `no_data` band in `pfChip`, `Row.pfStatus`, grain disclaimer.
- **Modify** `app/capture/[code]/CaptureChatPanel.tsx` — `coveredIncludesProblemSolving` helper + soft generation nudge.
- **Tests:** `tests/lib/program/scaffolding-nodata.test.ts`, `tests/lib/db/pf-contract-epoch.test.ts`, `tests/lib/ai/capture/pf-reflection-evidence.test.ts`, `tests/app/capture/covered-problem-solving.test.ts` (new); extend existing scaffolding tests if present.

Run tests: `pnpm exec vitest run <path>`. Full suite: `pnpm test`. Typecheck: `pnpm exec tsc --noEmit`.

---

## Task 1: `no_data` scoring path (`scaffolding.ts`)

**Files:**
- Modify: `lib/program/scaffolding.ts` (`PfStatus` line 96; `snapshotPfContribution` lines 89-94; `aggregateSubCompetency` lines 218-235)
- Test: `tests/lib/program/scaffolding-nodata.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/program/scaffolding-nodata.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  snapshotPfContribution,
  aggregateSubCompetency,
  type SnapshotCellInput,
  type ProductiveFailureConditions,
} from '@/lib/program/scaffolding';

const PF: ProductiveFailureConditions = {
  generate_then_consolidate: 'present',
  open_ended_problems: 'present',
  revision_cycles: 'present',
  structured_post_mortem: 'present',
  max_supporting_depth: 4,
  notes: [],
};

function cell(over: Partial<SnapshotCellInput> = {}): SnapshotCellInput {
  return {
    snapshotId: 's1', courseCode: 'GC 1000', sequenceIndex: 0,
    kDepth: 3, uDepth: 3, dDepth: 4, productiveFailureConditions: null,
    ...over,
  };
}

describe('no_data PF scoring', () => {
  it('snapshotPfContribution returns null for a not-assessed cell', () => {
    expect(snapshotPfContribution(cell({ productiveFailureConditions: null }))).toBeNull();
  });

  it('snapshotPfContribution returns a number for an assessed cell', () => {
    const v = snapshotPfContribution(cell({ productiveFailureConditions: PF }));
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThan(0);
  });

  it('aggregate yields no_data when every contributing cell is not-assessed', () => {
    const agg = aggregateSubCompetency('sc1', 'Typography', [
      cell({ productiveFailureConditions: null }),
      cell({ snapshotId: 's2', sequenceIndex: 1, productiveFailureConditions: null }),
    ]);
    expect(agg.pfStatus).toBe('no_data');
    expect(agg.cumulativePfScore).toBe(0);
  });

  it('aggregate yields no_data for an empty cell list', () => {
    expect(aggregateSubCompetency('sc1', 'Typography', []).pfStatus).toBe('no_data');
  });

  it('aggregate computes over data-bearing cells only, ignoring not-assessed ones', () => {
    const agg = aggregateSubCompetency('sc1', 'Typography', [
      cell({ productiveFailureConditions: null }),
      cell({ snapshotId: 's2', sequenceIndex: 1, productiveFailureConditions: PF, dDepth: 4 }),
    ]);
    expect(agg.pfStatus).not.toBe('no_data');
    expect(agg.cumulativePfScore).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/lib/program/scaffolding-nodata.test.ts`
Expected: FAIL — `pfStatus` is `'absent'` (not `'no_data'`) and `snapshotPfContribution` returns `0` not `null`.

- [ ] **Step 3: Implement the no-data path**

In `lib/program/scaffolding.ts`, change the `PfStatus` type (line 96):

```ts
export type PfStatus = 'well_developed' | 'developing' | 'thin' | 'absent' | 'no_data';
```

Replace `snapshotPfContribution` (lines 85-94) with a `number | null` return:

```ts
/**
 * Per-snapshot productive-failure contribution to one sub-competency.
 * snapshot_contribution = conditions_score × depth_weight × reflection_weight.
 * Returns null when the snapshot's PF was NOT assessed (Area 7 not probed) —
 * the caller excludes null contributions rather than scoring them 0.
 */
export function snapshotPfContribution(cell: SnapshotCellInput): number | null {
  if (!cell.productiveFailureConditions) return null;
  const cs = conditionsScore(cell.productiveFailureConditions);
  const dw = depthWeight(cell.dDepth);
  const rw = reflectionWeight(cell.productiveFailureConditions.structured_post_mortem);
  return cs * dw * rw;
}
```

Replace `aggregateSubCompetency` (lines 218-235):

```ts
export function aggregateSubCompetency(
  subCompetencyId: string,
  subCompetencyName: string,
  cells: SnapshotCellInput[],
): SubCompetencyScaffolding {
  const scaffolding = depthScaffoldingStatus(cells);
  // PF is computed over data-bearing (assessed) cells only. A not-assessed
  // cell contributes null and is excluded — never scored as 0.
  const contributions = cells
    .map(snapshotPfContribution)
    .filter((c): c is number => c !== null);
  if (contributions.length === 0) {
    return {
      subCompetencyId,
      subCompetencyName,
      cells,
      scaffolding,
      cumulativePfScore: 0,
      pfStatus: 'no_data',
    };
  }
  const cumulative = contributions.reduce((acc, c) => acc + c, 0);
  // A D≥4 contributor only counts toward `well_developed` if it was assessed.
  const hasUpper = cells.some(c => c.productiveFailureConditions !== null && c.dDepth >= 4);
  const pfStatus = cumulativePfStatus(cumulative, hasUpper);
  return {
    subCompetencyId,
    subCompetencyName,
    cells,
    scaffolding,
    cumulativePfScore: cumulative,
    pfStatus,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/lib/program/scaffolding-nodata.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run any existing scaffolding tests + typecheck**

Run: `pnpm exec vitest run lib/program tests/lib/program && pnpm exec tsc --noEmit`
Expected: PASS / no errors. (If a pre-existing scaffolding test asserted `snapshotPfContribution(...) === 0` for a null cell, update that assertion to `=== null` — that was the bug.)

- [ ] **Step 6: Commit**

```bash
git add lib/program/scaffolding.ts tests/lib/program/scaffolding-nodata.test.ts
git commit -m "feat(scaffolding): no_data PF band — not-assessed excluded from rollups, never scored 0"
```

---

## Task 2: Legacy reclassification (`scaffolding-queries.ts`)

**Files:**
- Modify: `lib/db/scaffolding-queries.ts` (imports; new helper + constant; loop at lines 119-128)
- Test: `tests/lib/db/pf-contract-epoch.test.ts`

- [ ] **Step 1: Write the failing test for the pure helper**

Create `tests/lib/db/pf-contract-epoch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pfForSnapshot, PF_CONTRACT_EPOCH } from '@/lib/db/scaffolding-queries';
import type { ProductiveFailureConditions } from '@/lib/program/scaffolding';

const BLOCK: ProductiveFailureConditions = {
  generate_then_consolidate: 'absent',
  open_ended_problems: 'absent',
  revision_cycles: 'absent',
  structured_post_mortem: 'absent',
  max_supporting_depth: 0,
  notes: [],
};

describe('pfForSnapshot legacy cutoff', () => {
  it('reclassifies a pre-epoch snapshot to null even when it carries a block', () => {
    const before = new Date(PF_CONTRACT_EPOCH.getTime() - 1000);
    expect(pfForSnapshot(before, BLOCK)).toBeNull();
  });

  it('passes a post-epoch block through unchanged', () => {
    const after = new Date(PF_CONTRACT_EPOCH.getTime() + 1000);
    expect(pfForSnapshot(after, BLOCK)).toBe(BLOCK);
  });

  it('passes a post-epoch null through as null', () => {
    const after = new Date(PF_CONTRACT_EPOCH.getTime() + 1000);
    expect(pfForSnapshot(after, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/lib/db/pf-contract-epoch.test.ts`
Expected: FAIL — `pfForSnapshot`/`PF_CONTRACT_EPOCH` not exported.

- [ ] **Step 3: Add the constant + helper, and wire the loader**

In `lib/db/scaffolding-queries.ts`, add after the imports (the type import on line 21 already brings `SnapshotCellInput`; add the value import too):

```ts
import type { SnapshotCellInput, ProductiveFailureConditions } from '@/lib/program/scaffolding';

/**
 * Deploy moment of the problem-solving capture fix. Snapshots created BEFORE
 * this cannot be trusted for productive-failure data: the pre-fix v1 scores
 * path fabricated an all-`absent` block when Area 7 wasn't probed, so a stored
 * block may be fake-absent. Such snapshots are reclassified to no-data.
 *
 * SET THIS to the UTC timestamp at which this change merges/deploys
 * (`date -u +%Y-%m-%dT%H:%M:%SZ`). The default below is the fix's design date;
 * bump it to the actual deploy moment so snapshots captured today under the
 * OLD prompts are also reclassified.
 */
export const PF_CONTRACT_EPOCH = new Date('2026-06-05T00:00:00Z');

/** Presence-as-sentinel with the legacy cutoff: pre-epoch ⇒ null (no data). */
export function pfForSnapshot(
  createdAt: Date,
  block: ProductiveFailureConditions | null,
): ProductiveFailureConditions | null {
  if (createdAt < PF_CONTRACT_EPOCH) return null;
  return block;
}
```

(If line 21 is `import type { SnapshotCellInput } from '@/lib/program/scaffolding';`, replace it with the combined import above.)

Then change the PF reconstruction loop (lines 121-128) to route through the helper:

```ts
  for (const r of latest) {
    const profile = r.profile as {
      audit_notes?: {
        productive_failure_conditions?: ProductiveFailureConditions | null;
      };
    } | null;
    pfBySnapshot.set(
      r.snapshotId,
      pfForSnapshot(r.createdAt, profile?.audit_notes?.productive_failure_conditions ?? null),
    );
  }
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `pnpm exec vitest run tests/lib/db/pf-contract-epoch.test.ts && pnpm exec tsc --noEmit`
Expected: PASS / no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/db/scaffolding-queries.ts tests/lib/db/pf-contract-epoch.test.ts
git commit -m "feat(scaffolding): reclassify pre-fix snapshots to no-data via PF_CONTRACT_EPOCH"
```

---

## Task 3: Citation-backed reflection (Zod schema)

**Files:**
- Modify: `lib/ai/capture/schema.ts` (`productiveFailureConditionsSchema` lines 134-142; doc comment 149-153)
- Test: `tests/lib/ai/capture/pf-reflection-evidence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/capture/pf-reflection-evidence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { productiveFailureConditionsSchema } from '@/lib/ai/capture/schema';

const base = {
  generate_then_consolidate: 'present' as const,
  open_ended_problems: 'present' as const,
  revision_cycles: 'present' as const,
  max_supporting_depth: 4,
  notes: [] as string[],
};
const validCite = { type: 'chunk' as const, chunkId: 'chunk-abc123', excerpt: 'graded post-mortem memo' };

describe('structured_post_mortem evidence requirement', () => {
  it('rejects non-absent reflection with no evidence', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, structured_post_mortem: 'present' });
    expect(r.success).toBe(false);
  });

  it('rejects non-absent reflection with an empty evidence array', () => {
    const r = productiveFailureConditionsSchema.safeParse({
      ...base, structured_post_mortem: 'partial', structured_post_mortem_evidence: [],
    });
    expect(r.success).toBe(false);
  });

  it('accepts non-absent reflection with a resolvable citation', () => {
    const r = productiveFailureConditionsSchema.safeParse({
      ...base, structured_post_mortem: 'present', structured_post_mortem_evidence: [validCite],
    });
    expect(r.success).toBe(true);
  });

  it('accepts absent reflection with no evidence', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, structured_post_mortem: 'absent' });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/lib/ai/capture/pf-reflection-evidence.test.ts`
Expected: FAIL — present/partial without evidence currently parse as valid (no rule yet).

- [ ] **Step 3: Add the field + superRefine**

In `lib/ai/capture/schema.ts`, replace `productiveFailureConditionsSchema` (lines 134-142):

```ts
export const productiveFailureConditionsSchema = z.object({
  generate_then_consolidate: productiveFailureConditionEnum,
  open_ended_problems: productiveFailureConditionEnum,
  revision_cycles: productiveFailureConditionEnum,
  structured_post_mortem: productiveFailureConditionEnum,
  // Required when structured_post_mortem is above 'absent' (see superRefine).
  // Nullable for OpenAI strict-mode; the model emits null when reflection is
  // 'absent'. Mirrors the evidence-above-zero discipline on K/U/D.
  structured_post_mortem_evidence: z.array(CaptureProfileCitation).nullable().optional(),
  max_supporting_depth: z.number().int().min(0).max(5),
  notes: z.array(z.string()),
}).superRefine((pf, ctx) => {
  if (pf.structured_post_mortem !== 'absent') {
    const ev = pf.structured_post_mortem_evidence;
    if (!ev || ev.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['structured_post_mortem_evidence'],
        message: 'structured_post_mortem above "absent" requires at least one resolvable citation (mirrors the K/U/D evidence-above-zero rule). With no graded post-mortem artifact to cite, rate it "absent".',
      });
    }
  }
});
```

Update the `productive_failure_conditions` doc comment (lines 149-153) to the authoritative presence contract:

```ts
  // PRESENCE CONTRACT (authoritative): null/omitted ⇒ Audit Area 7 was NOT
  // assessed ("no data"); a PRESENT block ⇒ assessed, and its conditions are
  // real judgments — an 'absent' condition then means "we looked, there's
  // none", NOT "not probed". Downstream scoring treats null as a distinct
  // no-data state (excluded from rollups), never as 0. Snapshots created
  // before PF_CONTRACT_EPOCH are reclassified to no-data (their pre-fix block
  // may be fabricated-absent).
  productive_failure_conditions: productiveFailureConditionsSchema.nullable().optional(),
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/lib/ai/capture/pf-reflection-evidence.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the existing capture-schema tests + typecheck**

Run: `pnpm exec vitest run tests/lib/ai/capture && pnpm exec tsc --noEmit`
Expected: PASS / no errors. (`ProductiveFailureConditions` inferred type now includes the optional evidence field; the scaffolding-layer `ProductiveFailureConditions` interface in `scaffolding.ts` is a separate structural type and does not need it.)

- [ ] **Step 6: Commit**

```bash
git add lib/ai/capture/schema.ts tests/lib/ai/capture/pf-reflection-evidence.test.ts
git commit -m "feat(capture): require a citation for structured_post_mortem above absent"
```

---

## Task 4: JSON schema — nullable v1 PF + evidence field (`capture-scores.ts`)

**Files:**
- Modify: `lib/ai/analyze/capture-scores.ts` (`productive_failure_conditions` JSON schema, lines 184-203; `audit_notes.required` already lists it on line 169)
- Test: `tests/lib/ai/capture/pf-json-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/capture/pf-json-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { captureProfileJsonSchema, captureProfileJsonSchemaV2 } from '@/lib/ai/analyze/capture-scores';

function pf(schema: unknown): any {
  return (schema as any).properties.audit_notes.properties.productive_failure_conditions;
}

describe('productive_failure_conditions JSON schema', () => {
  it('v1 PF block is nullable (object|null) so the model can emit null', () => {
    expect(pf(captureProfileJsonSchema).type).toEqual(['object', 'null']);
  });

  it('v1 PF block declares structured_post_mortem_evidence in properties and required', () => {
    const block = pf(captureProfileJsonSchema);
    expect(block.properties.structured_post_mortem_evidence).toBeDefined();
    expect(block.properties.structured_post_mortem_evidence.type).toEqual(['array', 'null']);
    expect(block.required).toContain('structured_post_mortem_evidence');
  });

  it('v2 inherits both (it clones v1)', () => {
    const block = pf(captureProfileJsonSchemaV2);
    expect(block.type).toEqual(['object', 'null']);
    expect(block.required).toContain('structured_post_mortem_evidence');
  });
});
```

> If `captureProfileJsonSchemaV2` is not currently exported, add `export` to its declaration (line 310) as part of Step 3.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/lib/ai/capture/pf-json-schema.test.ts`
Expected: FAIL — v1 PF `type` is `'object'` and `structured_post_mortem_evidence` is absent.

- [ ] **Step 3: Widen v1 PF + add the evidence field**

In `lib/ai/analyze/capture-scores.ts`, update the `productive_failure_conditions` JSON schema (lines 184-203): change `type`, add the evidence field to `properties` and `required`:

```ts
        productive_failure_conditions: {
          // Nullable: the model emits null when Audit Area 7 was not probed
          // (presence-as-sentinel). Unified with the v2 variant.
          type: ['object', 'null'],
          additionalProperties: false,
          required: [
            'generate_then_consolidate',
            'open_ended_problems',
            'revision_cycles',
            'structured_post_mortem',
            'structured_post_mortem_evidence',
            'max_supporting_depth',
            'notes',
          ],
          properties: {
            generate_then_consolidate: { type: 'string', enum: ['present', 'partial', 'absent'] },
            open_ended_problems: { type: 'string', enum: ['present', 'partial', 'absent'] },
            revision_cycles: { type: 'string', enum: ['present', 'partial', 'absent'] },
            structured_post_mortem: { type: 'string', enum: ['present', 'partial', 'absent'] },
            // Nullable array of citations; required-by-superRefine in Zod when
            // structured_post_mortem is above 'absent'. Model emits null otherwise.
            structured_post_mortem_evidence: { type: ['array', 'null'], items: CITATIONS_ARRAY.items },
            max_supporting_depth: { type: 'integer', minimum: 0, maximum: 5 },
            notes: { type: 'array', items: { type: 'string' } },
          },
        },
```

Export the v2 variant so the test can read it — change line 310 `const captureProfileJsonSchemaV2 = (() => {` to `export const captureProfileJsonSchemaV2 = (() => {`. (The v2 IIFE's manual `pf.type = ['object','null']` widening on line 322 is now redundant but harmless — leave it.)

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `pnpm exec vitest run tests/lib/ai/capture/pf-json-schema.test.ts && pnpm exec tsc --noEmit`
Expected: PASS / no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/analyze/capture-scores.ts tests/lib/ai/capture/pf-json-schema.test.ts
git commit -m "feat(capture): v1 PF JSON schema nullable + structured_post_mortem_evidence (strict-mode)"
```

---

## Task 5: Unify the prompts (honest emit + reflection calibration)

**Files:**
- Modify: `lib/ai/prompts/capture-scores.md` (the `productive_failure_conditions` bullet + the "four enum fields are required" paragraph)
- Modify: `lib/ai/prompts/capture-synthesis.md` (the "emit only if probed" section — add the reflection calibration)

> No automated test (markdown prompts); verification is reading the result and the schema tests already written. This is a doc-only task.

- [ ] **Step 1: Fix `capture-scores.md`**

In `lib/ai/prompts/capture-scores.md`, find the paragraph that currently reads:

> Each finding entry is a one-sentence string. Empty arrays are fine when there are no findings in a category. The four `present`/`partial`/`absent` enum fields are required (not optional) — output `absent` when the course truly has none of the condition, not when you're unsure.

Replace its second/third sentences with the honest presence contract + reflection rule:

```markdown
Each finding entry is a one-sentence string. Empty arrays are fine when there are no findings in a category.

**Emit the `productive_failure_conditions` block ONLY IF Audit Area 7 was probed** in the conversation. If the auditor never asked about generate-then-consolidate structure, open-ended/ill-structured problems, revision cycles, or structured post-mortem, set `productive_failure_conditions` to **null** — do NOT fabricate an all-`absent` block to satisfy the schema (silence is "not assessed", not "absent"). When you DO emit the block, each of the four condition fields is `present`/`partial`/`absent` judged from evidence; output `absent` only when the course genuinely lacks the condition, never as a stand-in for "unsure" or "not probed".

**`structured_post_mortem` may be `present` or `partial` ONLY when you can cite a specific graded post-mortem / debrief artifact** in `structured_post_mortem_evidence` (a real chunk or instructor-turn citation, same provenance rules as competency citations). A generic "reflect on your learning" prompt with no graded artifact is `absent`.
```

- [ ] **Step 2: Add the reflection calibration to `capture-synthesis.md`**

In `lib/ai/prompts/capture-synthesis.md`, in the `# `productive_failure_conditions` — emit only if Audit Area 7 was probed` section (it already correctly says omit-when-not-probed), append a paragraph after the "If you do emit the block:" guidance:

```markdown

`structured_post_mortem` may be `present` or `partial` ONLY when you can cite a specific graded post-mortem / debrief artifact in `structured_post_mortem_evidence` (a real chunk or instructor-turn citation, same provenance rules as competency citations). A generic "reflect on your learning" prompt with no graded artifact is `absent` — do not credit reflection you cannot ground.
```

- [ ] **Step 3: Verify the prompts read coherently**

Run: `grep -n "structured_post_mortem_evidence\|fabricate an all-\`absent\`" lib/ai/prompts/capture-scores.md lib/ai/prompts/capture-synthesis.md`
Expected: both prompts now reference `structured_post_mortem_evidence`; `capture-scores.md` references the no-fabrication rule.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/capture-scores.md lib/ai/prompts/capture-synthesis.md
git commit -m "docs(prompts): unify PF emit-only-if-probed + citation-backed reflection"
```

---

## Task 6: Strip renders `no_data` distinctly + grain disclaimer

**Files:**
- Modify: `app/program/scaffolding/ScaffoldingStripClient.tsx` (`Row.pfStatus` line 29; `pfChip` lines 71-79; add disclaimer)
- Verify: `app/api/program/scaffolding/route.ts` passes `pfStatus` through without enum narrowing.

> UI task — verification is `tsc` + a manual check (no unit test).

- [ ] **Step 1: Confirm the API route passes `pfStatus` through**

Run: `grep -n "pfStatus" app/api/program/scaffolding/route.ts`
Expected: the route maps `pfStatus: <agg>.pfStatus` (a passthrough string). If it declares a local union type for `pfStatus` that omits `no_data`, add `'no_data'` to it. If it serializes the value directly, no change needed.

- [ ] **Step 2: Extend the client types + `pfChip`**

In `app/program/scaffolding/ScaffoldingStripClient.tsx`, add `no_data` to `Row.pfStatus` (line 29):

```ts
  pfStatus: 'well_developed' | 'developing' | 'thin' | 'absent' | 'no_data';
```

Replace `pfChip` (lines 71-79) so `no_data` renders distinctly and without a meaningless `0.00`:

```ts
function pfChip(s: Row['pfStatus'], cum: number): { label: string; cls: string } {
  if (s === 'no_data') {
    return { label: 'no PF data', cls: 'bg-stone-50 text-stone-400 italic' };
  }
  const label = `${s.replace('_', '-')} · ${cum.toFixed(2)}`;
  switch (s) {
    case 'well_developed': return { label, cls: 'bg-emerald-100 text-emerald-900' };
    case 'developing':     return { label, cls: 'bg-amber-100 text-amber-900' };
    case 'thin':           return { label, cls: 'bg-orange-100 text-orange-900' };
    case 'absent':         return { label, cls: 'bg-stone-100 text-stone-700' };
  }
}
```

- [ ] **Step 3: Add the course-level grain disclaimer**

Add a `title` to the per-cell PF dot so its course-level nature is explicit. Find the element rendered with `pfDotColor(...)` (around line 137-151) and add to it:

```tsx
title="Productive-failure conditions are assessed at the course level and shown against each sub-competency this course contributes to."
```

And add a one-line legend note below the strip (near the existing status/legend area; if none, just above the closing container) :

```tsx
<p className="mt-2 text-[11px] text-stone-500">
  PF dots reflect course-level productive-failure conditions applied to each sub-competency the course contributes to. “no PF data” means Audit Area 7 was not assessed for that course (distinct from “absent”).
</p>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (the `pfChip` switch is now exhaustive because `no_data` is handled before the switch).

- [ ] **Step 5: Commit**

```bash
git add app/program/scaffolding/ScaffoldingStripClient.tsx app/api/program/scaffolding/route.ts
git commit -m "feat(scaffolding-ui): render no_data distinctly + course-level PF grain disclaimer"
```

---

## Task 7: Soft generation nudge (`CaptureChatPanel.tsx`)

**Files:**
- Modify: `app/capture/[code]/CaptureChatPanel.tsx` (module-level helper; component state + handler; the generate button at lines 574-597)
- Test: `tests/app/capture/covered-problem-solving.test.ts`

- [ ] **Step 1: Write the failing test for the helper**

Create `tests/app/capture/covered-problem-solving.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { coveredIncludesProblemSolving } from '@/app/capture/[code]/CaptureChatPanel';

describe('coveredIncludesProblemSolving', () => {
  it('true when a topic mentions reflection', () => {
    expect(coveredIncludesProblemSolving(['outcomes', 'reflection'])).toBe(true);
  });
  it('true (case-insensitive) for "Productive Failure"', () => {
    expect(coveredIncludesProblemSolving(['Productive Failure'])).toBe(true);
  });
  it('true for "problem-solving"', () => {
    expect(coveredIncludesProblemSolving(['problem-solving conditions'])).toBe(true);
  });
  it('false when no topic relates to problem-solving', () => {
    expect(coveredIncludesProblemSolving(['outcomes', 'projects', 'rubrics', 'prereqs'])).toBe(false);
  });
  it('false for an empty list', () => {
    expect(coveredIncludesProblemSolving([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/app/capture/covered-problem-solving.test.ts`
Expected: FAIL — `coveredIncludesProblemSolving` not exported.

- [ ] **Step 3: Add the helper (module-level, exported)**

In `app/capture/[code]/CaptureChatPanel.tsx`, add near the top (after imports, before the component):

```ts
// Heuristic: did the audit cover problem-solving (Audit Area 7)? The agent's
// readiness `covered` topics are free-form prose, so we substring-match a small
// token set. A soft nudge only — a false negative just shows an extra prompt,
// a false positive just skips it; neither corrupts data (the profile records PF
// honestly regardless).
const PROBLEM_SOLVING_TOKENS = [
  'productive failure', 'problem-solving', 'problem solving',
  'post-mortem', 'post mortem', 'reflection', 'area 7',
];
export function coveredIncludesProblemSolving(topics: string[]): boolean {
  return topics.some(t => {
    const s = t.toLowerCase();
    return PROBLEM_SOLVING_TOKENS.some(tok => s.includes(tok));
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/app/capture/covered-problem-solving.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the soft nudge into the generate button**

In the component, add state near the other `useState` hooks (around line 159-179):

```ts
  const [pendingGenerate, setPendingGenerate] = useState(false);
```

Add a handler near `canGenerate` (line 329):

```ts
  function handleGenerateClick() {
    if (!coveredIncludesProblemSolving(coveredEver)) {
      setPendingGenerate(true);
      return;
    }
    onGenerate();
  }
```

Change the generate button's `onClick` (line 576) from `onClick={onGenerate}` to `onClick={handleGenerateClick}`.

Immediately above the `<div className="flex items-center justify-between gap-3">` row that holds the buttons (line 571), insert the non-blocking confirm banner:

```tsx
          {pendingGenerate && (
            <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="mb-2">
                Problem-solving (productive failure, Audit Area 7) wasn’t probed — the profile will record it as <strong>“not assessed”</strong>. You can generate anyway, or keep auditing to capture it.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setPendingGenerate(false); onGenerate(); }}
                  className="rounded border border-amber-400 bg-white px-2 py-1 font-medium hover:bg-amber-100"
                >
                  Generate anyway
                </button>
                <button
                  type="button"
                  onClick={() => setPendingGenerate(false)}
                  className="rounded border border-stone-300 bg-white px-2 py-1 font-medium text-stone-700 hover:bg-stone-50"
                >
                  Keep auditing
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 6: Typecheck + targeted test**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run tests/app/capture/covered-problem-solving.test.ts`
Expected: no errors / PASS.

- [ ] **Step 7: Commit**

```bash
git add app/capture/[code]/CaptureChatPanel.tsx tests/app/capture/covered-problem-solving.test.ts
git commit -m "feat(capture): soft Area-7 generation nudge when problem-solving unprobed"
```

---

## Task 8: Full suite + STATE.md close-out

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Run the full suite**

Run: `pnpm test`
Expected: full suite green (baseline 649; this adds the new test files). Investigate any failure before proceeding.

- [ ] **Step 2: Set the epoch to the real deploy moment**

In `lib/db/scaffolding-queries.ts`, set `PF_CONTRACT_EPOCH` to the current UTC timestamp:

Run: `date -u +%Y-%m-%dT%H:%M:%SZ`
Then replace the `PF_CONTRACT_EPOCH` value with `new Date('<that timestamp>')` so every existing snapshot (all captured under the old prompts) is reclassified to no-data and only profiles generated after this merge are trusted.

- [ ] **Step 3: Update STATE.md**

In `docs/STATE.md`: flip the "Problem-solving capture fix" Next-up row from "Plan pending" to shipped (link the [plan](./superpowers/plans/2026-06-04-problem-solving-capture-fix.md)); add a one-line Active-arc note describing the `no_data` band + citation-backed reflection + nullable v1 PF schema + soft nudge; bump the `Last verified` line to `git rev-parse --short HEAD` + 2026-06-04.

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md lib/db/scaffolding-queries.ts
git commit -m "docs(state): problem-solving capture fix shipped; set PF_CONTRACT_EPOCH to deploy moment"
```

---

## Self-Review

**1. Spec coverage:**
- Presence-as-sentinel → Task 3 (doc comment) + Task 1 (scoring treats null as no-data). ✓
- Unify both prompt paths / stop fabricated all-absent → Task 4 (v1 JSON nullable) + Task 5 (v1 prompt). v2 was already correct; Task 5 adds reflection calibration to it. ✓
- New `no_data` band excluded from rollups → Task 1 (aggregate) + Task 6 (strip). ✓ (Rollup exclusion: `no_data` cells contribute null and are filtered, so they never enter cumulative/diagnostics — the Stage-2 named-pattern rollups read `pfStatus`/cumulative, both of which now exclude no-data.)
- Soft generation nudge → Task 7. ✓
- Citation-backed reflection → Task 3 (Zod superRefine) + Task 4 (JSON field) + Task 5 (prompts). ✓
- Legacy reclassification via cutoff → Task 2 + Task 8 step 2 (epoch set to deploy). ✓
- PF-grain disclaimer → Task 6. ✓
- Closes scaffolding-spec :61 → satisfied by the no_data band. ✓
- No migration → confirmed (no `drizzle/` changes anywhere). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. The `PF_CONTRACT_EPOCH` default is a concrete date with an explicit Task-8 step to set it to the deploy moment (not a placeholder). The Task-6 route check and Task-5 prompt edits are exact-anchor instructions with the full replacement text. ✓

**3. Type consistency:** `snapshotPfContribution` returns `number | null` (Task 1) and is consumed by `aggregateSubCompetency` with a `.filter((c): c is number => c !== null)` (Task 1). `PfStatus` gains `no_data` (Task 1); `Row.pfStatus` mirrors it (Task 6). `pfForSnapshot` / `PF_CONTRACT_EPOCH` defined Task 2, set Task 8. `structured_post_mortem_evidence` is `z.array(CaptureProfileCitation).nullable().optional()` (Task 3) and `{ type: ['array','null'], items: CITATIONS_ARRAY.items }` in JSON (Task 4) — consistent. `coveredIncludesProblemSolving` named identically in helper (Task 7) and test. ✓
