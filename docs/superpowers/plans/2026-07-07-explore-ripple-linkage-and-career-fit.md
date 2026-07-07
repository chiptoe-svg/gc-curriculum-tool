# Explore Ripple — Linkage Fix + Career-Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Explore computed ripple actually fire — (a) fix the competency→sub-competency linkage so downstream/upstream lines appear, and (b) add the `career_fit` ripple kind — then re-run the harness to confirm.

**Architecture:** The harness proved the ripple fires empty for two reasons: the local-delta AI never sees competency `type`, so it attaches deltas only to foundational competencies (which don't map to sub-competencies); and resolution is a brittle exact string match. This plan flows `type` to the AI + steers the prompt toward technical competencies, normalizes the match, and adds a pure `computeCareerFit` (band-improvement over `getMatrixData`, reusing `depthBand`). No new tables; nothing writes to the evidenced snapshot.

**Tech Stack:** TypeScript strict, Zod, Vitest. Builds on the merged Explore Plan-1 core (`lib/ai/explore/*`, `lib/ai/analyze/explore-local-delta.ts`).

**Addresses:** tracked follow-ons #187 (ripple-linkage fix) + #186 (career-fit ripple). Plan-1 spec: [`2026-07-07-explore-thinking-partner-design.md`](../specs/2026-07-07-explore-thinking-partner-design.md).

---

## Reused interfaces (read before starting)

- `NeighborCompetency` / `NeighborProfile` — `lib/ai/explore/neighbor-context.ts`.
- `snapshotToNeighborProfile` + `resolveSubCompetencyDepths` + `assembleScenario` + `runImpact` — `lib/ai/explore/run-impact.ts`.
- `estimateLocalDelta` (builds the AI user message from `NeighborContext`) — `lib/ai/analyze/explore-local-delta.ts`; prompt `lib/ai/prompts/explore-local-delta.md`.
- `CaptureCompetency.type: 'technical' | 'foundational'` — `lib/ai/capture/schema.ts`.
- `depthBand(n: number|null): { key:'none'|'low'|'working'|'high'; short; word } | null` — `lib/program/depth-band.ts`.
- `getMatrixData(): Promise<MatrixData>` — `lib/db/program-coverage-queries.ts`. `MatrixData = { courses, targets:[{id,name,displayOrder}], subCompetencies:[{id,name,careerTargetId,careerTargetName,...}], cells:[{snapshotId, careerTargetId, subCompetencyId, kDepth, uDepth, dDepth, ...}] }`.
- `PredictedSubCompDepth = { subCompetencyId, k, u, d }` (d is `number|null`) — `lib/ai/explore/ripple.ts`. `RippleLine` — `lib/ai/explore/scenario.ts`.

---

## Task 1: Flow competency `type` to the AI + steer the prompt

**Files:** Modify `lib/ai/explore/neighbor-context.ts`, `lib/ai/explore/run-impact.ts` (`snapshotToNeighborProfile`), `lib/ai/analyze/explore-local-delta.ts` (user message), `lib/ai/prompts/explore-local-delta.md`; Test `tests/lib/ai/explore/neighbor-context.test.ts` (extend).

- [ ] **Step 1: Extend the neighbor test to require `type`.** In `tests/lib/ai/explore/neighbor-context.test.ts`, add `type: 'technical'` to the `focal` fixture's competency and add an assertion inside the existing test:

```typescript
    expect(ctx.focal.competencies[0]!.type).toBe('technical');
```

- [ ] **Step 2: Run it, verify FAIL** (`type` not on `NeighborCompetency`).

- [ ] **Step 3: Add `type` to `NeighborCompetency`.** In `neighbor-context.ts`:

```typescript
export interface NeighborCompetency { statement: string; type: 'technical' | 'foundational'; k_depth: number | null; u_depth: number | null; d_depth: number; }
```

- [ ] **Step 4: Populate it in `snapshotToNeighborProfile`** (`run-impact.ts`) — map `type: c.type` from each `CaptureCompetency` alongside `statement`/`k_depth`/… (the source competency carries `type`).

- [ ] **Step 5: Show `type` to the AI.** In `estimateLocalDelta` (`explore-local-delta.ts`), where the focal competency lines are built for the user message, include the type per line, e.g. `- [technical] ${c.statement} (K${c.k_depth ?? '–'} U${c.u_depth ?? '–'} D${c.d_depth})`. (Read the current message-building code and add the `[${c.type}]` tag to each focal competency line.)

- [ ] **Step 6: Steer the prompt.** In `lib/ai/prompts/explore-local-delta.md`, add a rule: *"Prefer the course's TECHNICAL competencies when naming what a change touches — those are what carry curriculum and career linkage. A production/technical change usually develops one or more technical competencies; name those explicitly using the course's exact competency wording. Include foundational competencies (Attention to Detail, Communication, etc.) only as SECONDARY effects, never as the only competencies touched. Use each competency's given `[technical]`/`[foundational]` tag to decide."*

- [ ] **Step 7: Run** `pnpm vitest run tests/lib/ai/explore/neighbor-context.test.ts` → pass; `pnpm tsc --noEmit` → clean (fix any other `NeighborCompetency` construction site the compiler flags).

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(explore): flow competency type to local-delta AI + steer toward technical competencies"`

---

## Task 2: Normalize the competency→sub-competency match

**Files:** Modify `lib/ai/explore/run-impact.ts` (add + use `normalizeCompetencyKey`); Test `tests/lib/ai/explore/run-impact.test.ts` (extend).

- [ ] **Step 1: Write the failing test.** Append to `tests/lib/ai/explore/run-impact.test.ts`:

```typescript
import { normalizeCompetencyKey } from '@/lib/ai/explore/run-impact';

describe('normalizeCompetencyKey', () => {
  it('collapses case + whitespace so near-identical statements match', () => {
    expect(normalizeCompetencyKey('  Prepress   Preparation ')).toBe(normalizeCompetencyKey('prepress preparation'));
  });
  it('distinguishes genuinely different statements', () => {
    expect(normalizeCompetencyKey('Trapping')).not.toBe(normalizeCompetencyKey('Imposition'));
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (not exported).

- [ ] **Step 3: Implement + use it.** In `run-impact.ts`:

```typescript
/** Normalize a competency statement for matching: trim, lowercase, collapse internal whitespace.
 *  Tolerates the formatting/casing drift between the local-delta AI's competency wording and
 *  snapshot_target_coverage.matched_competency (which the scoring AI may have re-cased/spaced). */
export function normalizeCompetencyKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}
```

Then in `resolveSubCompetencyDepths`: key the `byStatement` map on `normalizeCompetencyKey(row.matchedCompetency)` and look up each predicted delta with `normalizeCompetencyKey(delta.competency)`. Keep the "omit if unresolved, never fabricate" behavior — just on normalized keys.

- [ ] **Step 4: Run** `pnpm vitest run tests/lib/ai/explore/run-impact.test.ts` → pass; `pnpm tsc --noEmit` → clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(explore): normalize competency→sub-competency match (case/whitespace tolerant)"`

---

## Task 3: `computeCareerFit` — band-improvement career_fit lines

**Files:** Create `lib/ai/explore/career-fit.ts`; Test `tests/lib/ai/explore/career-fit.test.ts`.

- [ ] **Step 1: Write the failing test.**

```typescript
import { describe, it, expect } from 'vitest';
import { computeCareerFit } from '@/lib/ai/explore/career-fit';
import type { MatrixData } from '@/lib/db/program-coverage-queries';

const matrix = {
  courses: [], targets: [{ id: 't1', name: 'Prepress Technician', displayOrder: 0 }],
  subCompetencies: [{ id: 'sc-trap', name: 'Trapping', careerTargetId: 't1', careerTargetName: 'Prepress Technician', displayOrder: 0 }],
  cells: [{ snapshotId: 'snap1', careerTargetId: 't1', subCompetencyId: 'sc-trap', kDepth: null, uDepth: null, dDepth: 3, matchedCompetency: null, evidenceExcerpt: null, confidence: 'medium', rationale: '', model: 'x' }],
} as unknown as MatrixData;

describe('computeCareerFit', () => {
  it('emits a career_fit line when the predicted D band improves', () => {
    const out = computeCareerFit({ focalSnapshotId: 'snap1', predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 4 }], matrix });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'career_fit', subCompetencyId: 'sc-trap', label: 'Prepress Technician · Trapping', before: 'working (3)', after: 'high (4–5)' });
  });
  it('no line when the band is unchanged', () => {
    const out = computeCareerFit({ focalSnapshotId: 'snap1', predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 3 }], matrix });
    expect(out).toHaveLength(0);
  });
  it('ignores cells from other snapshots and unpredicted sub-comps', () => {
    expect(computeCareerFit({ focalSnapshotId: 'OTHER', predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 5 }], matrix })).toHaveLength(0);
    expect(computeCareerFit({ focalSnapshotId: 'snap1', predictedSubCompDepths: [], matrix })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (module not found).

- [ ] **Step 3: Implement `lib/ai/explore/career-fit.ts`.**

```typescript
/**
 * Career-fit ripple: does a predicted delta improve the DEPTH BAND of the focal
 * course's contribution to a career-target sub-competency? There is no stored
 * "required depth" per sub-comp — program coverage is expressed as bands
 * (depth-band.ts) — so "better career fit" = the focal course's cell for a
 * (target, sub-comp) moving up a band (e.g. working → high). Do-centric in v1;
 * K/U career-fit is a deferred refinement. Pure; reads the matrix, mutates nothing.
 */
import { depthBand } from '@/lib/program/depth-band';
import type { MatrixData } from '@/lib/db/program-coverage-queries';
import type { RippleLine } from './scenario';
import type { PredictedSubCompDepth } from './ripple';

const BAND_RANK: Record<string, number> = { none: 0, low: 1, working: 2, high: 3 };
const bandRankOf = (n: number | null): number => {
  const b = depthBand(n);
  return b ? BAND_RANK[b.key]! : -1; // null / no-data ranks below every real band
};
const bandWord = (n: number | null): string => depthBand(n)?.word ?? 'no data';

export function computeCareerFit(input: {
  focalSnapshotId: string;
  predictedSubCompDepths: PredictedSubCompDepth[];
  matrix: MatrixData;
}): RippleLine[] {
  const predBySub = new Map(input.predictedSubCompDepths.map(p => [p.subCompetencyId, p]));
  const targetName = new Map(input.matrix.targets.map(t => [t.id, t.name]));
  const subName = new Map(input.matrix.subCompetencies.map(s => [s.id, s.name]));
  const out: RippleLine[] = [];
  for (const cell of input.matrix.cells) {
    if (cell.snapshotId !== input.focalSnapshotId) continue;
    const p = predBySub.get(cell.subCompetencyId);
    if (!p) continue;
    if (bandRankOf(p.d) > bandRankOf(cell.dDepth)) {
      out.push({
        kind: 'career_fit',
        courseCode: null,
        subCompetencyId: cell.subCompetencyId,
        label: `${targetName.get(cell.careerTargetId) ?? cell.careerTargetId} · ${subName.get(cell.subCompetencyId) ?? cell.subCompetencyId}`,
        before: bandWord(cell.dDepth),
        after: bandWord(p.d),
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run** `pnpm vitest run tests/lib/ai/explore/career-fit.test.ts` → 3 pass.
- [ ] **Step 5: Commit** — `git add lib/ai/explore/career-fit.ts tests/lib/ai/explore/career-fit.test.ts && git commit -m "feat(explore): computeCareerFit band-improvement lines over the coverage matrix"`

---

## Task 4: Wire career-fit into `assembleScenario` + `runImpact`

**Files:** Modify `lib/ai/explore/run-impact.ts`; Test `tests/lib/ai/explore/run-impact.test.ts` (extend).

- [ ] **Step 1: Write the failing test.** Append to `run-impact.test.ts` — `assembleScenario` accepts pre-computed `careerFitLines` and includes them in `computedRipple`:

```typescript
it('includes provided career_fit lines in the scenario ripple', () => {
  const scenario = assembleScenario({
    id: 's2', courseCode: 'GC 3460', baselineSnapshotId: 'snap1', createdAt: '2026-07-07T00:00:00.000Z',
    aiResult: { change: { prose: 'x', activity: 'x', artifact: 'graded', competencies: ['prepress'], rubricCriteria: [], assumesIncoming: [] }, predictedDeltas: [] },
    predictedSubCompDepths: [], baselineDelivered: [], downstreamByCourse: {},
    careerFitLines: [{ kind: 'career_fit', courseCode: null, subCompetencyId: 'sc-trap', label: 'Prepress Technician · Trapping', before: 'working (3)', after: 'high (4–5)' }],
    subCompLabel: (id) => id,
  });
  expect(scenario.computedRipple.filter(r => r.kind === 'career_fit')).toHaveLength(1);
});
```

- [ ] **Step 2: Run, verify FAIL** (`assembleScenario` has no `careerFitLines` param).

- [ ] **Step 3: Implement.** Add `careerFitLines?: RippleLine[]` to `assembleScenario`'s input type; after building the downstream + upstream lines, `rippleLines.push(...(input.careerFitLines ?? []).filter(l => l.kind === 'career_fit'))` (mirror the per-kind filter discipline already in that function), then build + `scenarioSchema.parse`. In `runImpact` (the DB/AI wrapper), after resolving `predictedSubCompDepths`: `const matrix = await getMatrixData();` then `const careerFitLines = computeCareerFit({ focalSnapshotId: focalSnapshot.id, predictedSubCompDepths, matrix });` (use the focal snapshot's id field — confirm the field name on `SnapshotRow`), and pass `careerFitLines` into `assembleScenario`. Import `computeCareerFit` + `getMatrixData`.

- [ ] **Step 4: Run** `pnpm vitest run tests/lib/ai/explore/` → all green; `pnpm tsc --noEmit` → clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(explore): compute + attach career_fit lines in runImpact/assembleScenario"`

---

## Task 5: Harness re-run — prove the ripple now fires

**Files:** none (uses `scripts/_one-off/explore-impact-harness.ts`).

- [ ] **Step 1: Run the harness** on the same 2 real courses used in the Plan-1 run (GC 4800, GC 3460) with a technical-flavored change, e.g.:
  `pnpm tsx --env-file=.env.local scripts/_one-off/explore-impact-harness.ts "GC 3460" "add a graded project requiring students to independently produce a multi-page publication with correct trapping and separations"`

- [ ] **Step 2: Inspect the output** for the three things that were broken/absent before: (a) do `predictedDeltas` now include TECHNICAL competencies (not only foundationals)? (b) does `computedRipple` now contain `downstream_gap` and/or non-null-subCompetencyId lines (resolution succeeded)? (c) do any `career_fit` lines appear? Capture the raw JSON in the commit body.

- [ ] **Step 3: Record the outcome.** If the ripple now fires → success; note it. If it STILL fires empty, capture why (e.g. the courses genuinely have no confirmed downstream prereq edges, or matched_competency values still don't align even normalized) — that is itself the finding, and distinguishes "linkage fixed but data-sparse" from "linkage still broken." Do NOT paper over an empty result.

- [ ] **Step 4: Commit the finding** (no code) — `git commit --allow-empty -m "chore(explore): harness re-run after linkage fix + career-fit — <one-line outcome>"` with the raw output + read in the body.

- [ ] **Step 5: Update STATE.md** — amend the Explore Deferred/debt entry: mark #187 (ripple-linkage) + #186 (career-fit) as DONE with the harness outcome; note career-fit is Do-only in v1 (K/U career-fit deferred). (STATE.md ritual: new module `career-fit.ts`, no new AI function/table/route — a small surface note.) Commit STATE.md.

---

## Notes for the implementer

- **Still nothing writes to the evidenced snapshot** — career-fit only READS `getMatrixData`; scenarios stay in their own table.
- **Career-fit is Do-only in v1** (compares the D band). K and U band-improvement is a deliberate deferral — record it in the STATE.md note at Task 5.
- **The harness re-run is the real acceptance test.** Unit tests prove the mechanics; only a live run on real courses proves the AI now names technical competencies that resolve. Treat an empty result as a finding to report, not a failure to hide.
- **If `tsc` flags other `NeighborCompetency` construction sites** when you add `type` (Task 1), fix them to pass `type` — grep `NeighborCompetency` / `competencies:` in `lib/ai/explore` and any test fixtures.
