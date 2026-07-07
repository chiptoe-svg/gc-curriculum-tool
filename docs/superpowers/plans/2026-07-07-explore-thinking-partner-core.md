# Explore Thinking-Partner — Plan 1: Domain Core + Impact Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable, testable domain core of the rethought Explore — a serializable `Scenario` object, the impact engine that produces one (AI local-delta estimate + computed up/downstream ripple reusing the existing gap engine), scenario persistence, and comparison — provable end-to-end on a real course via a harness, with **no** agent/UI yet.

**Architecture:** A `Scenario` is the first-class unit: `{ baselineSnapshotId, change, predictedDeltas, computedRipple }`. `runImpact(courseCode, changeProse)` assembles neighbor context, calls one AI function (adapted from the existing `explore-what-if`) for the change-object + local KUD deltas + new upstream demands, then **reuses** `computeGapsFromInputs` (`lib/program/prereq-gaps.ts`) to diff baseline-vs-predicted gap statuses into a ripple. Scenarios persist to a single new `courseExploreScenarios` table; `compareScenarios(a,b)` is a pure diff. This is Plan 1 of 2 (Plan 2 = agent + chat UI + retirement of the old machinery).

**Tech Stack:** TypeScript strict, Zod, Drizzle + Postgres, Vitest. AI via `getProviderForFunction` + strict OpenAI JSON schema (`AI_PROVIDER=openai`).

**Spec:** [`docs/superpowers/specs/2026-07-07-explore-thinking-partner-design.md`](../specs/2026-07-07-explore-thinking-partner-design.md)

---

## Reused interfaces (read these before starting — do NOT reimplement)

- `computeGapsFromInputs(edges: RelyEdge[], delivered: DeliveredAttainment[]): SubCompetencyGap[]` — pure, `lib/program/prereq-gaps.ts:133`. `RelyEdge = { prereqCourseCode, subCompetencyId, expectedK|U|D }`; `DeliveredAttainment = { prereqCourseCode, subCompetencyId, k, u, d, basis:'measured'|'intended' }`; `SubCompetencyGap` has `.status: 'met'|'gap'|'no_data'`.
- `getLatestSnapshotByCourse(courseCode): Promise<SnapshotRow|null>` and `getSnapshotById(id)` — `lib/db/capture-snapshots-queries.ts:131,116`. `SnapshotRow` (line 39) carries the captured profile (a `CaptureProfile` from `lib/ai/capture/schema.ts`, with `.competencies[]`, each `{ statement, k_depth, u_depth, d_depth, ... }`, and `.incoming_expectations[]`).
- Prereq edges: `listConfirmedEdgePairs()` and `listEdgesForFocal(courseCode)` — `lib/db/prerequisite-edge-queries.ts:160,130`. `PrereqEdgeRow` (line 16).
- `getMatrixData(): Promise<MatrixData>` — `lib/db/program-coverage-queries.ts:224` (used only by the deferred career-fit note, not v1 compute).
- AI function pattern to mirror: `lib/ai/analyze/explore-what-if.ts` (`loadPrompt` + `getProviderForFunction('explore-what-if')` + strict `*JsonSchema` const + Zod parse). It already emits `competency_changes[] { competency, from_depth{k,u,d}, to_depth{k,u,d}, rationale }`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/ai/explore/scenario.ts` | **NEW** — `Scenario`/`ChangeObject`/`PredictedDelta`/`RippleLine` types + Zod schema. The domain keystone. |
| `lib/ai/explore/compare.ts` | **NEW** — `compareScenarios(a,b)` pure diff. |
| `lib/ai/explore/ripple.ts` | **NEW** — `computeRipple(...)` pure fn (reuses `computeGapsFromInputs`). |
| `lib/ai/explore/neighbor-context.ts` | **NEW** — `buildNeighborContext(courseCode)` assembles focal + up/downstream snapshots + edges. |
| `lib/ai/analyze/explore-local-delta.ts` | **NEW** — AI: change prose + focal profile → `ChangeObject` + `PredictedDelta[]`. Adapted from `explore-what-if.ts`. |
| `lib/ai/prompts/explore-local-delta.md` | **NEW** — its prompt. |
| `lib/ai/explore/run-impact.ts` | **NEW** — `runImpact(courseCode, changeProse)` orchestrator → `Scenario`. |
| `lib/db/explore-scenario-queries.ts` | **NEW** — `saveScenario` / `listScenarios` / `getScenario` repo. |
| `lib/db/schema.ts` | Modify — add `courseExploreScenarios` table. |
| `scripts/_one-off/explore-impact-harness.ts` | **NEW** — run `runImpact` on a real course, print the `Scenario`. |

---

## Task 1: The `Scenario` domain types + Zod schema

**Files:** Create `lib/ai/explore/scenario.ts`; Test `tests/lib/ai/explore/scenario.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { scenarioSchema, type Scenario } from '@/lib/ai/explore/scenario';

const sample: Scenario = {
  id: 's1', courseCode: 'GC 3460', baselineSnapshotId: 'snap1',
  change: {
    prose: 'add a 3-week trapping lab graded on registration accuracy',
    activity: 'trapping lab (3 wk)', artifact: 'graded',
    competencies: ['prepress preparation'], rubricCriteria: ['registration accuracy'],
    assumesIncoming: [{ label: 'color models', subCompetencyId: null, k: 3, u: null, d: null }],
  },
  predictedDeltas: [{
    competency: 'prepress preparation',
    from: { k: 2, u: 2, d: 3 }, to: { k: 3, u: 2, d: 4 },
    confidence: 'medium', rationale: 'graded artifact with enforced rubric evidences D4',
  }],
  computedRipple: [{ kind: 'downstream_gap', courseCode: 'GC 4440', subCompetencyId: 'sc-trap', label: 'trapping', before: 'gap', after: 'met' }],
  agentNotes: null, caption: null, createdAt: '2026-07-07T00:00:00.000Z',
};

describe('scenarioSchema', () => {
  it('accepts a well-formed scenario', () => {
    expect(scenarioSchema.safeParse(sample).success).toBe(true);
  });
  it('rejects an unknown artifact kind', () => {
    const bad = { ...sample, change: { ...sample.change, artifact: 'sometimes' } };
    expect(scenarioSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects a ripple line with an unknown kind', () => {
    const bad = { ...sample, computedRipple: [{ ...sample.computedRipple[0], kind: 'sideways' }] };
    expect(scenarioSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm vitest run tests/lib/ai/explore/scenario.test.ts` → module not found.

- [ ] **Step 3: Implement**

```typescript
import { z } from 'zod';

const kudSchema = z.object({
  k: z.number().int().min(0).max(5).nullable(),
  u: z.number().int().min(0).max(5).nullable(),
  d: z.number().int().min(0).max(5),
});

export const incomingDemandSchema = z.object({
  label: z.string().min(1),
  subCompetencyId: z.string().nullable(),
  k: z.number().int().min(0).max(5).nullable(),
  u: z.number().int().min(0).max(5).nullable(),
  d: z.number().int().min(0).max(5).nullable(),
});

export const changeObjectSchema = z.object({
  prose: z.string().min(1),
  activity: z.string().min(1),
  artifact: z.enum(['graded', 'ungraded', 'formative', 'none']),
  competencies: z.array(z.string().min(1)),
  rubricCriteria: z.array(z.string().min(1)),
  assumesIncoming: z.array(incomingDemandSchema),
});

export const predictedDeltaSchema = z.object({
  competency: z.string().min(1),
  from: kudSchema,
  to: kudSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  rationale: z.string().min(1),
});

export const rippleLineSchema = z.object({
  kind: z.enum(['downstream_gap', 'upstream_gap', 'career_fit']),
  courseCode: z.string().nullable().optional(),
  subCompetencyId: z.string().nullable().optional(),
  label: z.string().min(1),
  before: z.string().min(1),
  after: z.string().min(1),
});

export const scenarioSchema = z.object({
  id: z.string().min(1),
  courseCode: z.string().min(1),
  baselineSnapshotId: z.string().min(1),
  change: changeObjectSchema,
  predictedDeltas: z.array(predictedDeltaSchema),
  computedRipple: z.array(rippleLineSchema),
  agentNotes: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  createdAt: z.string().min(1),
});

export type ChangeObject = z.infer<typeof changeObjectSchema>;
export type PredictedDelta = z.infer<typeof predictedDeltaSchema>;
export type RippleLine = z.infer<typeof rippleLineSchema>;
export type IncomingDemand = z.infer<typeof incomingDemandSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
```

- [ ] **Step 4: Run, verify pass** — `pnpm vitest run tests/lib/ai/explore/scenario.test.ts` → 3 pass.
- [ ] **Step 5: Commit** — `git add lib/ai/explore/scenario.ts tests/lib/ai/explore/scenario.test.ts && git commit -m "feat(explore): Scenario domain types + zod schema"`

---

## Task 2: `compareScenarios` pure diff

**Files:** Create `lib/ai/explore/compare.ts`; Test `tests/lib/ai/explore/compare.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { compareScenarios } from '@/lib/ai/explore/compare';
import type { Scenario } from '@/lib/ai/explore/scenario';

const base = (over: Partial<Scenario>): Scenario => ({
  id: 'x', courseCode: 'GC 3460', baselineSnapshotId: 'snap1',
  change: { prose: 'p', activity: 'a', artifact: 'graded', competencies: ['prepress'], rubricCriteria: [], assumesIncoming: [] },
  predictedDeltas: [{ competency: 'prepress', from: { k: 2, u: 2, d: 3 }, to: { k: 2, u: 2, d: 4 }, confidence: 'medium', rationale: 'r' }],
  computedRipple: [{ kind: 'downstream_gap', courseCode: 'GC 4440', subCompetencyId: 'sc', label: 'trapping', before: 'gap', after: 'met' }],
  createdAt: '2026-07-07T00:00:00.000Z',
  ...over,
});

describe('compareScenarios', () => {
  it('reports deltas that differ between two scenarios', () => {
    const a = base({ id: 'a' });
    const b = base({ id: 'b', predictedDeltas: [{ competency: 'prepress', from: { k: 2, u: 2, d: 3 }, to: { k: 2, u: 2, d: 5 }, confidence: 'low', rationale: 'r2' }] });
    const diff = compareScenarios(a, b);
    expect(diff.deltaChanges).toHaveLength(1);
    expect(diff.deltaChanges[0]).toMatchObject({ competency: 'prepress', aTo: { d: 4 }, bTo: { d: 5 } });
  });
  it('reports ripple lines present in one but not the other', () => {
    const a = base({ id: 'a' });
    const b = base({ id: 'b', computedRipple: [] });
    const diff = compareScenarios(a, b);
    expect(diff.rippleOnlyInA.map(r => r.label)).toEqual(['trapping']);
    expect(diff.rippleOnlyInB).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```typescript
import type { Scenario, PredictedDelta, RippleLine } from './scenario';

export interface DeltaChange {
  competency: string;
  aTo: PredictedDelta['to'] | null;
  bTo: PredictedDelta['to'] | null;
}
export interface ScenarioComparison {
  deltaChanges: DeltaChange[];      // competencies whose predicted `to` differs (or exists in only one)
  rippleOnlyInA: RippleLine[];
  rippleOnlyInB: RippleLine[];
}

const rippleKey = (r: RippleLine) => `${r.kind}|${r.courseCode ?? ''}|${r.subCompetencyId ?? ''}|${r.after}`;
const sameTo = (a: PredictedDelta['to'], b: PredictedDelta['to']) => a.k === b.k && a.u === b.u && a.d === b.d;

export function compareScenarios(a: Scenario, b: Scenario): ScenarioComparison {
  const aByComp = new Map(a.predictedDeltas.map(d => [d.competency, d]));
  const bByComp = new Map(b.predictedDeltas.map(d => [d.competency, d]));
  const comps = new Set([...aByComp.keys(), ...bByComp.keys()]);
  const deltaChanges: DeltaChange[] = [];
  for (const c of comps) {
    const da = aByComp.get(c) ?? null;
    const db = bByComp.get(c) ?? null;
    if (!da || !db || !sameTo(da.to, db.to)) {
      deltaChanges.push({ competency: c, aTo: da?.to ?? null, bTo: db?.to ?? null });
    }
  }
  const aKeys = new Set(a.computedRipple.map(rippleKey));
  const bKeys = new Set(b.computedRipple.map(rippleKey));
  return {
    deltaChanges,
    rippleOnlyInA: a.computedRipple.filter(r => !bKeys.has(rippleKey(r))),
    rippleOnlyInB: b.computedRipple.filter(r => !aKeys.has(rippleKey(r))),
  };
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(explore): compareScenarios pure diff"`

---

## Task 3: `computeRipple` — the computed ripple, reusing `computeGapsFromInputs`

**Files:** Create `lib/ai/explore/ripple.ts`; Test `tests/lib/ai/explore/ripple.test.ts`

This is the heart. Given the focal course's **baseline delivered attainment**, the **rely-edges** of downstream courses onto the focal course, and the **predicted deltas**, it computes which downstream gap statuses flip, and turns the change's `assumesIncoming` demands into upstream gap lines.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { computeRipple } from '@/lib/ai/explore/ripple';
import type { DeliveredAttainment, RelyEdge } from '@/lib/program/prereq-gaps';
import type { PredictedDelta, IncomingDemand } from '@/lib/ai/explore/scenario';

describe('computeRipple — downstream gap flips', () => {
  it('flags a downstream gap that closes when the focal course delivers more', () => {
    // GC 4440 relies on GC 3460 for sub-comp 'sc-trap' at D4.
    const edges: RelyEdge[] = [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', expectedK: null, expectedU: null, expectedD: 4 }];
    // Baseline: GC 3460 delivers D3 (a gap).
    const baseline: DeliveredAttainment[] = [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', k: null, u: null, d: 3, basis: 'measured' }];
    // Predicted: the change raises GC 3460's matched sub-comp to D4.
    const deltas: PredictedDelta[] = [{ competency: 'prepress', from: { k: null, u: null, d: 3 }, to: { k: null, u: null, d: 4 }, confidence: 'medium', rationale: 'r' }];
    const ripple = computeRipple({
      focalCourseCode: 'GC 3460',
      downstreamEdges: edges,
      baselineDelivered: baseline,
      predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 4 }],
      assumesIncoming: [],
      subCompLabel: (id) => (id === 'sc-trap' ? 'trapping' : id),
    });
    const down = ripple.filter(r => r.kind === 'downstream_gap');
    expect(down).toHaveLength(1);
    // computeRipple is per-focal-course and pure: it surfaces the flipped sub-comp
    // but does NOT attach the downstream courseCode (a RelyEdge has no relying-course
    // field). courseCode stamping is Task 6's job (one computeRipple call per
    // downstream course). Assert the sub-comp here; assert courseCode in Task 6.
    expect(down[0]).toMatchObject({ subCompetencyId: 'sc-trap', label: 'trapping', before: 'gap', after: 'met' });
  });

  it('emits an upstream_gap line for each new incoming demand', () => {
    const assumes: IncomingDemand[] = [{ label: 'color models', subCompetencyId: 'sc-color', k: 3, u: null, d: null }];
    const ripple = computeRipple({
      focalCourseCode: 'GC 3460', downstreamEdges: [], baselineDelivered: [],
      predictedSubCompDepths: [], assumesIncoming: assumes, subCompLabel: (id) => id,
    });
    const up = ripple.filter(r => r.kind === 'upstream_gap');
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ kind: 'upstream_gap', label: 'color models', after: 'new demand K3' });
  });

  it('does not flag a downstream gap that was already met', () => {
    const edges: RelyEdge[] = [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', expectedK: null, expectedU: null, expectedD: 3 }];
    const baseline: DeliveredAttainment[] = [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', k: null, u: null, d: 3, basis: 'measured' }];
    const ripple = computeRipple({
      focalCourseCode: 'GC 3460', downstreamEdges: edges, baselineDelivered: baseline,
      predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 4 }],
      assumesIncoming: [], subCompLabel: (id) => id,
    });
    expect(ripple.filter(r => r.kind === 'downstream_gap')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** (note: `downstreamEdges` are edges where `prereqCourseCode === focalCourseCode` — i.e. courses that RELY ON the focal course; the caller assembles these. Baseline `computeGapsFromInputs` keys gaps by sub-comp; we map each sub-comp back to its relying downstream course(s) via the edge list.)

```typescript
import { computeGapsFromInputs, type DeliveredAttainment, type RelyEdge, type SubCompetencyGap } from '@/lib/program/prereq-gaps';
import type { RippleLine, IncomingDemand } from './scenario';

export interface PredictedSubCompDepth { subCompetencyId: string; k: number | null; u: number | null; d: number | null; }

export interface ComputeRippleInput {
  focalCourseCode: string;
  /** Edges where a DOWNSTREAM course relies on the focal course (prereqCourseCode === focalCourseCode). */
  downstreamEdges: RelyEdge[];
  /** Baseline delivered attainment for the focal course (from snapshotTargetCoverage). */
  baselineDelivered: DeliveredAttainment[];
  /** The change's predicted new depths, keyed to sub-competency. */
  predictedSubCompDepths: PredictedSubCompDepth[];
  /** New incoming demands the change introduces (upstream). */
  assumesIncoming: IncomingDemand[];
  /** Resolve a sub-competency id to a human label. */
  subCompLabel: (subCompetencyId: string) => string;
}

const statusOf = (gaps: SubCompetencyGap[], subId: string): string =>
  gaps.find(g => g.subCompetencyId === subId)?.status ?? 'no_data';

export function computeRipple(input: ComputeRippleInput): RippleLine[] {
  const out: RippleLine[] = [];

  // --- Downstream: re-run the gap engine on baseline vs. predicted-overridden delivered ---
  const predBySub = new Map(input.predictedSubCompDepths.map(p => [p.subCompetencyId, p]));
  const scenarioDelivered: DeliveredAttainment[] = input.baselineDelivered.map(d => {
    const p = d.prereqCourseCode === input.focalCourseCode ? predBySub.get(d.subCompetencyId) : undefined;
    return p ? { ...d, k: p.k, u: p.u, d: p.d } : d;
  });
  // Ensure predicted sub-comps with no baseline row still get a scenario row for the focal course.
  for (const p of input.predictedSubCompDepths) {
    if (!scenarioDelivered.some(d => d.prereqCourseCode === input.focalCourseCode && d.subCompetencyId === p.subCompetencyId)) {
      scenarioDelivered.push({ prereqCourseCode: input.focalCourseCode, subCompetencyId: p.subCompetencyId, k: p.k, u: p.u, d: p.d, basis: 'measured' });
    }
  }

  const baseGaps = computeGapsFromInputs(input.downstreamEdges, input.baselineDelivered);
  const scenGaps = computeGapsFromInputs(input.downstreamEdges, scenarioDelivered);

  // Map each sub-comp to the downstream course(s) that rely on the focal course for it.
  const subToCourses = new Map<string, Set<string>>();
  for (const e of input.downstreamEdges) {
    if (e.prereqCourseCode !== input.focalCourseCode) continue;
    if (!subToCourses.has(e.subCompetencyId)) subToCourses.set(e.subCompetencyId, new Set());
    // The relying (downstream) course isn't on RelyEdge; the caller must have grouped edges per downstream course.
    // We surface the sub-comp; the caller annotates courseCode via the edge source (see run-impact assembly).
  }

  const subs = new Set(input.downstreamEdges.map(e => e.subCompetencyId));
  for (const subId of subs) {
    const before = statusOf(baseGaps, subId);
    const after = statusOf(scenGaps, subId);
    if (before === 'gap' && after === 'met') {
      out.push({ kind: 'downstream_gap', subCompetencyId: subId, label: input.subCompLabel(subId), before, after });
    }
  }

  // --- Upstream: each new incoming demand is a new prereq requirement on this course ---
  for (const a of input.assumesIncoming) {
    const dims = [a.k != null ? `K${a.k}` : null, a.u != null ? `U${a.u}` : null, a.d != null ? `D${a.d}` : null].filter(Boolean).join(' ');
    out.push({ kind: 'upstream_gap', subCompetencyId: a.subCompetencyId ?? null, label: a.label, before: 'no demand', after: `new demand ${dims}` });
  }

  return out;
}
```

> **Note for the implementer:** `RelyEdge` has no `relyingCourseCode` field, so `computeRipple` cannot itself attach the downstream `courseCode` to a `downstream_gap` line — it leaves `courseCode` unset and returns the flipped sub-comp. Task 6 (`run-impact`) owns edge assembly and will attach `courseCode` per downstream course by calling `computeRipple` **once per downstream course** (each call scoped to that course's edges) and stamping `courseCode` onto the returned lines. This keeps `computeRipple` pure and per-course. (The Task-3 test already asserts `subCompetencyId` rather than `courseCode`, consistent with this.)

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(explore): computeRipple reuses computeGapsFromInputs for downstream flips + upstream demands"`

---

## Task 4: `buildNeighborContext` — assemble focal + up/downstream context

**Files:** Create `lib/ai/explore/neighbor-context.ts`; Test `tests/lib/ai/explore/neighbor-context.test.ts`

Pure assembler over already-fetched rows (so it's unit-testable without a DB): given the focal snapshot, the confirmed edge pairs, and a snapshot-lookup map, produce the context object the AI + ripple consume.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { assembleNeighborContext } from '@/lib/ai/explore/neighbor-context';

const focal = { courseCode: 'GC 3460', competencies: [{ statement: 'prepress preparation', k_depth: 2, u_depth: 2, d_depth: 3 }], incoming_expectations: [] };
const gc4440 = { courseCode: 'GC 4440', competencies: [{ statement: 'imposition', k_depth: 3, u_depth: 3, d_depth: 4 }], incoming_expectations: [{ statement: 'trapping', expected_depth: { k: null, u: null, d: 4 } }] };
const gc1010 = { courseCode: 'GC 1010', competencies: [{ statement: 'color models', k_depth: 2, u_depth: 2, d_depth: 2 }], incoming_expectations: [] };

describe('assembleNeighborContext', () => {
  it('splits neighbors into upstream (focal relies on) and downstream (relies on focal)', () => {
    const ctx = assembleNeighborContext({
      focalCourseCode: 'GC 3460',
      profiles: { 'GC 3460': focal, 'GC 4440': gc4440, 'GC 1010': gc1010 },
      edgePairs: [
        { relyingCourseCode: 'GC 3460', prereqCourseCode: 'GC 1010' }, // focal relies on 1010 (upstream)
        { relyingCourseCode: 'GC 4440', prereqCourseCode: 'GC 3460' }, // 4440 relies on focal (downstream)
      ],
    });
    expect(ctx.upstream.map(c => c.courseCode)).toEqual(['GC 1010']);
    expect(ctx.downstream.map(c => c.courseCode)).toEqual(['GC 4440']);
    expect(ctx.focal.courseCode).toBe('GC 3460');
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.** Define a minimal structural `NeighborProfile` type (subset of `CaptureProfile` this module needs) and `EdgePair = { relyingCourseCode, prereqCourseCode }`. `assembleNeighborContext` partitions by the focal code. (The DB-backed wrapper `loadNeighborContext(courseCode)` that fetches snapshots via `getLatestSnapshotByCourse` + edges via `listConfirmedEdgePairs` is added in Task 6; keep this task pure.)

```typescript
export interface NeighborCompetency { statement: string; k_depth: number | null; u_depth: number | null; d_depth: number; }
export interface NeighborIncoming { statement: string; expected_depth: { k: number | null; u: number | null; d: number }; }
export interface NeighborProfile { courseCode: string; competencies: NeighborCompetency[]; incoming_expectations: NeighborIncoming[]; }
export interface EdgePair { relyingCourseCode: string; prereqCourseCode: string; }

export interface NeighborContext {
  focal: NeighborProfile;
  upstream: NeighborProfile[];   // courses the focal relies on
  downstream: NeighborProfile[]; // courses that rely on the focal
}

export function assembleNeighborContext(input: {
  focalCourseCode: string;
  profiles: Record<string, NeighborProfile>;
  edgePairs: EdgePair[];
}): NeighborContext {
  const focal = input.profiles[input.focalCourseCode];
  if (!focal) throw new Error(`no profile for focal course ${input.focalCourseCode}`);
  const upstreamCodes = new Set(input.edgePairs.filter(e => e.relyingCourseCode === input.focalCourseCode).map(e => e.prereqCourseCode));
  const downstreamCodes = new Set(input.edgePairs.filter(e => e.prereqCourseCode === input.focalCourseCode).map(e => e.relyingCourseCode));
  const pick = (codes: Set<string>) => [...codes].map(c => input.profiles[c]).filter((p): p is NeighborProfile => !!p);
  return { focal, upstream: pick(upstreamCodes), downstream: pick(downstreamCodes) };
}
```

> Verify `listConfirmedEdgePairs()`'s row shape (`lib/db/prerequisite-edge-queries.ts:160`) exposes the relying + prereq course codes; map its fields to `EdgePair` in Task 6. If the field names differ, adapt the Task-6 mapping, not this pure type.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(explore): assembleNeighborContext (pure up/downstream partition)"`

---

## Task 5: `explore-local-delta` AI function (adapt from `explore-what-if`)

**Files:** Create `lib/ai/analyze/explore-local-delta.ts` + `lib/ai/prompts/explore-local-delta.md`; Test `tests/lib/ai/analyze/explore-local-delta.test.ts` (schema-shape test only — no live AI call in unit tests).

The AI's ONLY job: from the change prose + the focal course's competencies (+ light neighbor context for grounding), emit a `ChangeObject` + `PredictedDelta[]`. Mirror `explore-what-if.ts` exactly for the provider/schema/parse mechanics.

- [ ] **Step 1: Write the failing test** (asserts the exported strict JSON schema is self-consistent — the OpenAI footgun — and that the Zod result parser accepts a representative payload).

```typescript
import { describe, it, expect } from 'vitest';
import { localDeltaJsonSchema, localDeltaResultSchema } from '@/lib/ai/analyze/explore-local-delta';

describe('explore-local-delta schema', () => {
  it('strict request schema: every property is required (OpenAI strict-mode invariant)', () => {
    const walk = (node: any) => {
      if (node?.type === 'object' && node.properties) {
        expect(new Set(node.required)).toEqual(new Set(Object.keys(node.properties)));
        Object.values(node.properties).forEach(walk);
      }
      if (node?.type === 'array' && node.items) walk(node.items);
    };
    walk(localDeltaJsonSchema);
  });
  it('result parser accepts a representative payload', () => {
    const payload = {
      change: { prose: 'add trapping lab', activity: 'trapping lab', artifact: 'graded', competencies: ['prepress'], rubricCriteria: ['registration'], assumesIncoming: [{ label: 'color', subCompetencyId: null, k: 3, u: null, d: null }] },
      predictedDeltas: [{ competency: 'prepress', from: { k: 2, u: 2, d: 3 }, to: { k: 3, u: 2, d: 4 }, confidence: 'medium', rationale: 'r' }],
    };
    expect(localDeltaResultSchema.safeParse(payload).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.** Reuse `changeObjectSchema`/`predictedDeltaSchema` from Task 1 for the Zod `localDeltaResultSchema = z.object({ change: changeObjectSchema, predictedDeltas: z.array(predictedDeltaSchema) })`. Build `localDeltaJsonSchema` as the strict OpenAI request schema mirroring those (every property in `required`; nullables as `['integer','null']`), copying the pattern and helper style from `explore-what-if.ts:10-45`. Export `estimateLocalDelta(courseCode, changeProse, focal: NeighborProfile, neighbors: NeighborContext): Promise<LocalDeltaResult>` that does `loadPrompt('explore-local-delta')`, `getProviderForFunction('explore-local-delta')`, sends the focal competencies + a compact neighbor summary + the change prose, and `localDeltaResultSchema.parse(...)` the response. (Register the new function id `explore-local-delta` wherever `explore-what-if` is registered — grep `'explore-what-if'` across `lib/ai/` and `/settings` and add the sibling id at the `default` tier.)

- [ ] **Step 4: Write the prompt** `lib/ai/prompts/explore-local-delta.md` (frontmatter `name: explore-local-delta`, `includes: [shared/depth-scale.md]`). Role: translate a proposed change into (1) a structured `change` object — which existing focal competencies it touches, artifact type, rubric criteria, and any NEW incoming skill it assumes students bring (`assumesIncoming`); and (2) a small, evidence-reasoned `predictedDeltas` per touched competency (from current depth → predicted depth, confidence + rationale). Hard rules: predictions are hypotheses, not measurements; a single change rarely moves a dimension by >1; only touch competencies the change plausibly affects; `assumesIncoming` is the change's *upstream* demand, not the course's output.

- [ ] **Step 5: Run, verify pass** (schema tests). Note in the commit that live-AI behavior is validated by the Task 7 harness, not unit tests.
- [ ] **Step 6: Commit** — `git commit -m "feat(explore): explore-local-delta AI function + prompt (change-object + predicted KUD deltas)"`

---

## Task 6: `runImpact` orchestrator + `courseExploreScenarios` table + repo

**Files:** Modify `lib/db/schema.ts`; Create `lib/db/explore-scenario-queries.ts`, `lib/ai/explore/run-impact.ts`; Test `tests/lib/ai/explore/run-impact.test.ts` (pure-assembly test with injected fakes — no DB/AI).

- [ ] **Step 1: Add the table** to `lib/db/schema.ts`, following the existing table style in that file (pgTable, uuid pk, `courseCode`, `baselineSnapshotId`, jsonb columns for `change`/`predictedDeltas`/`computedRipple`, nullable `agentNotes`/`caption`, `createdAt` default now). Name it `courseExploreScenarios`. Then run `pnpm db:generate` to emit the migration, and review the generated SQL is additive-only.

- [ ] **Step 2: Repo** `lib/db/explore-scenario-queries.ts`: `saveScenario(s: Scenario): Promise<void>` (upsert by id), `listScenarios(courseCode: string): Promise<Scenario[]>` (newest first), `getScenario(id: string): Promise<Scenario | null>`. Serialize/deserialize via `scenarioSchema.parse` on read so stored rows are validated.

- [ ] **Step 3: Write the failing test** for the pure orchestration seam. Extract the assembly logic into a pure `assembleScenario(...)` that takes the AI result + neighbor context + baseline delivered + per-downstream edge groups + an id/timestamp, and returns a `Scenario` — including the per-downstream-course ripple stamping described in Task 3's note:

```typescript
import { describe, it, expect } from 'vitest';
import { assembleScenario } from '@/lib/ai/explore/run-impact';

it('stamps downstream courseCode by running ripple per downstream course', () => {
  const scenario = assembleScenario({
    id: 's1', courseCode: 'GC 3460', baselineSnapshotId: 'snap1', createdAt: '2026-07-07T00:00:00.000Z',
    aiResult: {
      change: { prose: 'add trapping lab', activity: 'lab', artifact: 'graded', competencies: ['prepress'], rubricCriteria: [], assumesIncoming: [] },
      predictedDeltas: [{ competency: 'prepress', from: { k: null, u: null, d: 3 }, to: { k: null, u: null, d: 4 }, confidence: 'medium', rationale: 'r' }],
    },
    predictedSubCompDepths: [{ subCompetencyId: 'sc-trap', k: null, u: null, d: 4 }],
    baselineDelivered: [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', k: null, u: null, d: 3, basis: 'measured' }],
    downstreamByCourse: { 'GC 4440': [{ prereqCourseCode: 'GC 3460', subCompetencyId: 'sc-trap', expectedK: null, expectedU: null, expectedD: 4 }] },
    subCompLabel: (id) => (id === 'sc-trap' ? 'trapping' : id),
  });
  const down = scenario.computedRipple.filter(r => r.kind === 'downstream_gap');
  expect(down).toHaveLength(1);
  expect(down[0]).toMatchObject({ courseCode: 'GC 4440', label: 'trapping', before: 'gap', after: 'met' });
});
```

- [ ] **Step 4: Implement `assembleScenario`** — for each `[courseCode, edges]` in `downstreamByCourse`, call `computeRipple({ focalCourseCode, downstreamEdges: edges, ... })` and stamp `courseCode` onto each returned `downstream_gap` line; concat all courses' lines + the upstream lines (compute once with `assumesIncoming`); build the `Scenario` and `scenarioSchema.parse` it before returning.

- [ ] **Step 5: Implement the DB/AI wrapper `runImpact(courseCode, changeProse)`** (not unit-tested; validated by harness): load focal + neighbor snapshots (`getLatestSnapshotByCourse` per neighbor from `listConfirmedEdgePairs`), `assembleNeighborContext`, `estimateLocalDelta`, map the predicted deltas → `predictedSubCompDepths` (match each touched competency to its sub-competency id via the coverage/matched-competency linkage — reuse whatever `computePrereqGaps` uses to key delivered attainment; if a competency doesn't resolve to a sub-comp, it contributes to the local delta display but not the computed ripple, and that's surfaced honestly), fetch `baselineDelivered` for the focal course, group downstream edges by relying course, call `assembleScenario`, `saveScenario`, return the `Scenario`.

- [ ] **Step 6: Run tests, `pnpm tsc --noEmit`, verify pass.**
- [ ] **Step 7: Commit** — `git commit -m "feat(explore): runImpact orchestrator + courseExploreScenarios table + repo"`

---

## Task 7: Harness — prove the center on a real course

**Files:** Create `scripts/_one-off/explore-impact-harness.ts`

- [ ] **Step 1: Implement** a tsx script: `runImpact(process.argv[2], process.argv[3])` and `console.log(JSON.stringify(scenario, null, 2))`. Run it against 2–3 real captured courses with real proposed changes, e.g.:
  `pnpm tsx --env-file=.env.local scripts/_one-off/explore-impact-harness.ts "GC 3460" "add a 3-week trapping lab graded on registration accuracy and clean separations"`

- [ ] **Step 2: Eyeball the output** — is the change-object a faithful structuring? Are the predicted deltas small, reasoned, plausible? Does the computed ripple surface real downstream flips / upstream demands, or is it empty (edge-sparsity)? Capture findings in the commit body — this is the go/no-go signal for Plan 2.

- [ ] **Step 3: Commit** — `git commit -m "chore(explore): impact harness + prove-the-center findings on real courses"` with the eyeballed findings in the body.

- [ ] **Step 4: Record the decision in STATE.md** — add a one-line **Deferred/In-flight** note: "Explore rebuild Plan 1 (domain core) landed on branch; Plan 2 (agent + UI + retirement) pending prove-the-center eyeball — see harness findings in `<sha>`." (STATE.md ritual: this touches new AI function id `explore-local-delta`, a new table `courseExploreScenarios`, and new lib surface.)

---

## Notes for the implementer

- **Nothing here writes to the evidenced snapshot.** Scenarios are their own table; predicted depths never touch `snapshotTargetCoverage` or the capture profile. This is the load-bearing epistemic boundary.
- **Career-fit ripple (`kind: 'career_fit'`) is intentionally NOT computed in Plan 1** — the downstream/upstream gap flips are the clean reuse; career-fit needs target-threshold logic over `getMatrixData` and is a fast-follow. `rippleLineSchema` already allows the kind so adding it later is additive. Record this deferral in STATE.md Deferred/debt at Task 7.
- **The competency→sub-competency resolution** (Task 6 Step 5) is the one fuzzy join; where a touched competency doesn't map to a sub-comp, the ripple simply omits it and the local delta still shows — never fabricate a mapping. Reuse the same matching path `computePrereqGaps` already uses so Explore and `/program` agree.
- **Do NOT retire the old Explore machinery in Plan 1** — that's Plan 2, after the harness proves the center. Plan 1 only adds.
