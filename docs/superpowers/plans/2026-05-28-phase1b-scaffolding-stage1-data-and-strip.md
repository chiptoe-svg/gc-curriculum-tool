# Phase 1B Scaffolding Analysis — Stage 1 (Data Layer + Scaffolding Strip) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the deterministic analytic core for Phase 1B (depth-scaffolding status + productive-failure cumulative score per `careerTarget × subCompetency`) and View 1 — the per-target scaffolding strip at `/program/scaffolding?target=<id>`. Views 2/3 (brittle-scaffold list, course-contribution summary) and the AI narrative/summary functions are deferred to Stage 2 once we know the scoring lands defensible findings.

**Architecture:** All scoring is pure TypeScript over data already in the DB — `snapshot_target_coverage` (Phase 1A, K/U/D depths per snapshot × target × sub-competency) joined with each snapshot's `audit_notes.productive_failure_conditions` block from `course_capture_snapshots.profile`. A new module `lib/program/scaffolding.ts` exposes the scoring primitives as pure functions; `lib/db/scaffolding-queries.ts` loads the inputs in one round-trip per target. A new API route `GET /api/program/scaffolding?target=<id>&slug=...` returns `{ subCompetencies: ScaffoldingRow[] }` where each row carries the per-course cells (depth + PF condition + reflection indicator) plus the right-margin `scaffolding_status` / `pf_status` / cumulative score. View 1 renders the strip as a horizontal-scrolling table; cells are colored by D-depth (reusing the existing Phase 1A ramp), top-left badge encodes PF conditions density, top-right "R" badge encodes structured-post-mortem presence.

**Tech Stack:** Next.js 15 App Router, Drizzle, Neon Postgres, React 19, Tailwind, shadcn primitives, Vitest. No new schema, no new tables, no AI calls in Stage 1.

---

## File structure

- **Create:** `lib/program/scaffolding.ts` — pure scoring functions + types
- **Create:** `lib/program/__tests__/scaffolding.test.ts` — fixture-driven tests
- **Create:** `lib/db/scaffolding-queries.ts` — single-target loader
- **Create:** `app/api/program/scaffolding/route.ts` — GET endpoint
- **Create:** `app/program/scaffolding/page.tsx` — page shell with target selector
- **Create:** `app/program/scaffolding/ScaffoldingStripClient.tsx` — client-side scrolling strip
- **Modify:** `app/program/page.tsx` — add a "Scaffolding view →" header link
- **Modify:** `docs/STATE.md` — mark Stage 1 shipped, name remaining open work

---

## Task 1: Scoring primitives + types

**Files:** Create `lib/program/scaffolding.ts`.

- [ ] **Step 1: Write the failing test scaffolding**

Create `lib/program/__tests__/scaffolding.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  conditionsScore,
  depthWeight,
  reflectionWeight,
  snapshotPfContribution,
  cumulativePfStatus,
  depthScaffoldingStatus,
  type SnapshotCellInput,
  type ProductiveFailureConditions,
} from '../scaffolding';

describe('conditionsScore', () => {
  it('returns 1.0 when all four conditions are present', () => {
    const pf: ProductiveFailureConditions = {
      generate_then_consolidate: 'present',
      open_ended_problems: 'present',
      revision_cycles: 'present',
      structured_post_mortem: 'present',
      max_supporting_depth: 3,
      notes: [],
    };
    expect(conditionsScore(pf)).toBe(1.0);
  });

  it('returns 0.25 for two partial + two absent', () => {
    const pf: ProductiveFailureConditions = {
      generate_then_consolidate: 'partial',
      open_ended_problems: 'partial',
      revision_cycles: 'absent',
      structured_post_mortem: 'absent',
      max_supporting_depth: 1,
      notes: [],
    };
    expect(conditionsScore(pf)).toBeCloseTo(0.25, 5);
  });

  it('returns 0 when null', () => {
    expect(conditionsScore(null)).toBe(0);
  });
});

describe('depthWeight', () => {
  it('matches the spec ramp', () => {
    expect(depthWeight(0)).toBe(0.0);
    expect(depthWeight(1)).toBe(0.15);
    expect(depthWeight(2)).toBe(0.35);
    expect(depthWeight(3)).toBe(0.60);
    expect(depthWeight(4)).toBe(0.85);
    expect(depthWeight(5)).toBe(1.0);
  });
});

describe('reflectionWeight', () => {
  it('1.0 / 0.75 / 0.5 for present / partial / absent', () => {
    expect(reflectionWeight('present')).toBe(1.0);
    expect(reflectionWeight('partial')).toBe(0.75);
    expect(reflectionWeight('absent')).toBe(0.5);
  });
});

describe('cumulativePfStatus', () => {
  it('returns absent below 0.1', () => {
    expect(cumulativePfStatus(0.05, false)).toBe('absent');
  });
  it('returns thin in 0.1-0.5', () => {
    expect(cumulativePfStatus(0.3, false)).toBe('thin');
  });
  it('returns developing in 0.5-1.5', () => {
    expect(cumulativePfStatus(1.0, false)).toBe('developing');
  });
  it('returns well_developed when >= 1.5 AND has upper-depth contributor', () => {
    expect(cumulativePfStatus(1.6, true)).toBe('well_developed');
  });
  it('caps at developing when >= 1.5 but no upper-depth contributor', () => {
    expect(cumulativePfStatus(1.6, false)).toBe('developing');
  });
});

describe('depthScaffoldingStatus', () => {
  const cell = (d: number, k: number | null = 1, u: number | null = 1, sequenceIndex: number = 0): SnapshotCellInput => ({
    snapshotId: `s${sequenceIndex}`,
    courseCode: `GC ${1000 + sequenceIndex}`,
    sequenceIndex,
    kDepth: k,
    uDepth: u,
    dDepth: d,
    productiveFailureConditions: null,
  });

  it('returns not_addressed when no contributing snapshot reaches K=1', () => {
    expect(depthScaffoldingStatus([cell(0, 0, 0)]).status).toBe('not_addressed');
  });

  it('returns coverage_only when shallow across many courses, never integration', () => {
    expect(depthScaffoldingStatus([
      cell(1, 1, 1, 0),
      cell(2, 2, 1, 1),
      cell(1, 2, 1, 2),
    ]).status).toBe('coverage_only');
  });

  it('returns well_scaffolded when all three phases present in sequence', () => {
    expect(depthScaffoldingStatus([
      cell(1, 1, 0, 0),  // introduction
      cell(3, 3, 2, 1),  // practice
      cell(4, 4, 4, 2),  // integration
    ]).status).toBe('well_scaffolded');
  });

  it('returns top_heavy when introduction + integration present but practice missing', () => {
    expect(depthScaffoldingStatus([
      cell(1, 1, 0, 0),
      cell(4, 4, 4, 1),
    ]).status).toBe('top_heavy');
  });

  it('returns brittle_scaffold when integration appears before introduction in sequence', () => {
    expect(depthScaffoldingStatus([
      cell(4, 4, 4, 0),  // integration FIRST in sequence
      cell(1, 1, 0, 1),  // introduction AFTER
    ]).status).toBe('brittle_scaffold');
  });
});
```

Run: `pnpm test lib/program/__tests__/scaffolding.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Write `lib/program/scaffolding.ts`**

```typescript
/**
 * Phase 1B Scaffolding Analysis — deterministic scoring primitives.
 *
 * Spec: docs/superpowers/specs/2026-05-25-scaffolding-analysis-design.md
 *
 * All functions are pure. Inputs are loaded by lib/db/scaffolding-queries.ts
 * and passed in; nothing here reaches into the DB.
 */

export type PfConditionValue = 'present' | 'partial' | 'absent';

export interface ProductiveFailureConditions {
  generate_then_consolidate: PfConditionValue;
  open_ended_problems: PfConditionValue;
  revision_cycles: PfConditionValue;
  structured_post_mortem: PfConditionValue;
  max_supporting_depth: number;
  notes: string[];
}

/**
 * One snapshot's contribution toward a single sub-competency. `sequenceIndex`
 * is the course's position in program order (catalog-level / prerequisite
 * chain). `productiveFailureConditions` is null when Audit Area 7 wasn't
 * probed (pre-2026-05-25 snapshots, or v2 captures that elected to skip it).
 */
export interface SnapshotCellInput {
  snapshotId: string;
  courseCode: string;
  sequenceIndex: number;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  productiveFailureConditions: ProductiveFailureConditions | null;
}

// ---------------------------------------------------------------------------
// Primitive 2 — Productive-failure scoring (continuous, depth-weighted)
// ---------------------------------------------------------------------------

const PF_FIELDS: Array<keyof Pick<ProductiveFailureConditions,
  'generate_then_consolidate' | 'open_ended_problems' | 'revision_cycles' | 'structured_post_mortem'
>> = [
  'generate_then_consolidate',
  'open_ended_problems',
  'revision_cycles',
  'structured_post_mortem',
];

function conditionWeight(v: PfConditionValue): number {
  return v === 'present' ? 1.0 : v === 'partial' ? 0.5 : 0.0;
}

/**
 * 0–1: fraction of the four conditions present (with partials at 0.5 weight).
 * Null/undefined PF blocks score 0 (no data).
 */
export function conditionsScore(pf: ProductiveFailureConditions | null): number {
  if (!pf) return 0;
  const sum = PF_FIELDS.reduce((acc, k) => acc + conditionWeight(pf[k]), 0);
  return sum / PF_FIELDS.length;
}

/**
 * 0–1: how much this depth contributes per the spec's non-linear ramp.
 * D=0→0.0, D=1→0.15, D=2→0.35, D=3→0.60, D=4→0.85, D=5→1.0.
 * Out-of-range inputs clamp.
 */
export function depthWeight(d: number): number {
  const ramp = [0.0, 0.15, 0.35, 0.60, 0.85, 1.0];
  if (d < 0) return 0.0;
  if (d >= ramp.length) return 1.0;
  return ramp[Math.floor(d)]!;
}

/**
 * 0.5–1.0: reflection multiplier per the spec. Asymmetric because reflection
 * is the mechanism that converts struggle into transfer; a course without
 * structured post-mortem contributes at half-effectiveness.
 */
export function reflectionWeight(v: PfConditionValue): number {
  return v === 'present' ? 1.0 : v === 'partial' ? 0.75 : 0.5;
}

/**
 * Per-snapshot productive-failure contribution to one sub-competency.
 * snapshot_contribution = conditions_score × depth_weight × reflection_weight
 */
export function snapshotPfContribution(cell: SnapshotCellInput): number {
  const cs = conditionsScore(cell.productiveFailureConditions);
  const dw = depthWeight(cell.dDepth);
  const rw = reflectionWeight(cell.productiveFailureConditions?.structured_post_mortem ?? 'absent');
  return cs * dw * rw;
}

export type PfStatus = 'well_developed' | 'developing' | 'thin' | 'absent';

/**
 * Map a cumulative PF score to a band. `well_developed` requires both the
 * threshold AND at least one contributor at D≥4 — otherwise large cumulative
 * scores from many low-depth contributors cap at `developing` (it isn't the
 * same thing as integration-level PF).
 */
export function cumulativePfStatus(cumulative: number, hasUpperDepthContributor: boolean): PfStatus {
  if (cumulative >= 1.5 && hasUpperDepthContributor) return 'well_developed';
  if (cumulative >= 0.5) return 'developing';
  if (cumulative >= 0.1) return 'thin';
  return 'absent';
}

// ---------------------------------------------------------------------------
// Primitive 1 — Depth-sequence scaffolding
// ---------------------------------------------------------------------------

export type ScaffoldingStatus =
  | 'well_scaffolded'
  | 'top_heavy'
  | 'bottom_heavy'
  | 'coverage_only'
  | 'brittle_scaffold'
  | 'not_addressed';

export interface DepthPhasesPresent {
  introduction: boolean;
  practice: boolean;
  integration: boolean;
}

export interface DepthScaffoldingResult {
  phases: DepthPhasesPresent;
  status: ScaffoldingStatus;
}

// Phase thresholds per spec §"Primitive 1":
//   introduction: K=1–2 or U=1–2
//   practice:     K=3–4 or U=2–3 or D=2–3
//   integration:  U=4–5 or D=4–5
function isIntroduction(c: SnapshotCellInput): boolean {
  return (c.kDepth !== null && c.kDepth >= 1 && c.kDepth <= 2)
    || (c.uDepth !== null && c.uDepth >= 1 && c.uDepth <= 2);
}
function isPractice(c: SnapshotCellInput): boolean {
  return (c.kDepth !== null && c.kDepth >= 3 && c.kDepth <= 4)
    || (c.uDepth !== null && c.uDepth >= 2 && c.uDepth <= 3)
    || (c.dDepth >= 2 && c.dDepth <= 3);
}
function isIntegration(c: SnapshotCellInput): boolean {
  return (c.uDepth !== null && c.uDepth >= 4) || c.dDepth >= 4;
}

/**
 * Determine the depth-scaffolding status across the contributing snapshots
 * for one sub-competency. Cells should be passed in program-sequence order
 * (sequenceIndex ascending); the function double-checks for safety.
 */
export function depthScaffoldingStatus(cells: SnapshotCellInput[]): DepthScaffoldingResult {
  const ordered = [...cells].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

  const phases: DepthPhasesPresent = {
    introduction: ordered.some(isIntroduction),
    practice: ordered.some(isPractice),
    integration: ordered.some(isIntegration),
  };

  // Nothing reaches even K=1 / U=1 / D=1 → not addressed.
  const anyAboveZero = ordered.some(c =>
    (c.kDepth ?? 0) >= 1 || (c.uDepth ?? 0) >= 1 || c.dDepth >= 1,
  );
  if (!anyAboveZero) {
    return { phases, status: 'not_addressed' };
  }

  // Brittle: integration appears in the course sequence before any
  // introduction OR practice cell — the upper-division course expects
  // mastery of something never set up.
  const firstIntegrationIdx = ordered.findIndex(isIntegration);
  const firstIntroIdx = ordered.findIndex(isIntroduction);
  const firstPracticeIdx = ordered.findIndex(isPractice);
  if (firstIntegrationIdx !== -1) {
    const introBefore = firstIntroIdx !== -1 && firstIntroIdx < firstIntegrationIdx;
    const practiceBefore = firstPracticeIdx !== -1 && firstPracticeIdx < firstIntegrationIdx;
    if (!introBefore && !practiceBefore) {
      return { phases, status: 'brittle_scaffold' };
    }
  }

  if (phases.introduction && phases.practice && phases.integration) {
    return { phases, status: 'well_scaffolded' };
  }
  if (phases.introduction && phases.integration && !phases.practice) {
    return { phases, status: 'top_heavy' };
  }
  if (phases.introduction && phases.practice && !phases.integration) {
    return { phases, status: 'bottom_heavy' };
  }
  // Only introduction (possibly stacked across multiple courses).
  return { phases, status: 'coverage_only' };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export interface SubCompetencyScaffolding {
  subCompetencyId: string;
  subCompetencyName: string;
  cells: SnapshotCellInput[];
  scaffolding: DepthScaffoldingResult;
  cumulativePfScore: number;
  pfStatus: PfStatus;
}

export function aggregateSubCompetency(
  subCompetencyId: string,
  subCompetencyName: string,
  cells: SnapshotCellInput[],
): SubCompetencyScaffolding {
  const scaffolding = depthScaffoldingStatus(cells);
  const cumulative = cells.reduce((acc, c) => acc + snapshotPfContribution(c), 0);
  const hasUpper = cells.some(c => c.dDepth >= 4);
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

- [ ] **Step 3: Run tests, expect PASS**

Run: `pnpm test lib/program/__tests__/scaffolding.test.ts`
Expected: all tests pass.

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add lib/program/scaffolding.ts lib/program/__tests__/scaffolding.test.ts
git commit -m "feat(program): Phase 1B scoring primitives (depth-scaffolding + PF aggregation)"
```

---

## Task 2: Single-target query loader

**Files:** Create `lib/db/scaffolding-queries.ts`.

- [ ] **Step 1: Write the loader**

```typescript
/**
 * Phase 1B query layer. One round-trip per (career-target) load —
 * returns the snapshot × sub-competency cells with the productive-failure
 * conditions block joined in from each snapshot's profile JSON.
 *
 * Program-sequence ordering: courses are ordered by catalog `level` first
 * (1000 / 2000 / 3000 / 4000), then by course code. The catalog `level`
 * column already exists; the prerequisite-chain refinement is deferred to
 * Stage 2 if simple level-ordering proves coarse.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  snapshotTargetCoverage,
  courseCaptureSnapshots,
  courses,
  careerTargets,
  subCompetencies,
} from '@/lib/db/schema';
import type { SnapshotCellInput } from '@/lib/program/scaffolding';

export interface ScaffoldingCourse {
  snapshotId: string;
  courseCode: string;
  courseTitle: string;
  level: number;
  sequenceIndex: number;
  snapshotCreatedAt: Date;
  snapshotCaption: string | null;
}

export interface ScaffoldingSubCompetency {
  id: string;
  name: string;
  descriptorK: string | null;
  descriptorU: string | null;
  descriptorD: string | null;
}

export interface ScaffoldingTargetInput {
  targetId: string;
  targetName: string;
  courses: ScaffoldingCourse[];
  subCompetencies: ScaffoldingSubCompetency[];
  cellsBySubCompetency: Map<string, SnapshotCellInput[]>;
}

export async function loadScaffoldingTarget(targetId: string): Promise<ScaffoldingTargetInput | null> {
  const target = await db.select().from(careerTargets).where(eq(careerTargets.id, targetId)).limit(1);
  if (!target[0]) return null;

  const subs = await db
    .select()
    .from(subCompetencies)
    .where(eq(subCompetencies.careerTargetId, targetId))
    .orderBy(asc(subCompetencies.orderIndex));

  // All latest (non-retired) snapshots, joined with their course for level
  // ordering. We use the cross-product of (snapshot × subCompetency) below.
  const snapshotRows = await db
    .select({
      snapshotId: courseCaptureSnapshots.id,
      courseCode: courseCaptureSnapshots.courseCode,
      profile: courseCaptureSnapshots.profile,
      caption: courseCaptureSnapshots.caption,
      createdAt: courseCaptureSnapshots.createdAt,
      level: courses.level,
      courseTitle: courses.title,
    })
    .from(courseCaptureSnapshots)
    .leftJoin(courses, eq(courses.code, courseCaptureSnapshots.courseCode))
    .where(isNull(courseCaptureSnapshots.retiredAt))
    .orderBy(asc(courses.level), asc(courseCaptureSnapshots.courseCode));

  // Pick the LATEST snapshot per course (keep first occurrence when ordering
  // by level then code; resolve by created_at within course).
  const byCourse = new Map<string, typeof snapshotRows[number]>();
  for (const row of snapshotRows) {
    const existing = byCourse.get(row.courseCode);
    if (!existing || row.createdAt > existing.createdAt) {
      byCourse.set(row.courseCode, row);
    }
  }
  const latest = Array.from(byCourse.values()).sort((a, b) => {
    const la = a.level ?? 9999, lb = b.level ?? 9999;
    if (la !== lb) return la - lb;
    return a.courseCode.localeCompare(b.courseCode);
  });

  const coursesOut: ScaffoldingCourse[] = latest.map((r, i) => ({
    snapshotId: r.snapshotId,
    courseCode: r.courseCode,
    courseTitle: r.courseTitle ?? r.courseCode,
    level: r.level ?? 0,
    sequenceIndex: i,
    snapshotCreatedAt: r.createdAt,
    snapshotCaption: r.caption,
  }));

  const snapshotIds = coursesOut.map(c => c.snapshotId);

  // Pull coverage cells for these snapshots × this target.
  // Drizzle doesn't have a clean `IN` for an array of arbitrary length on
  // sqlite-style adapters, but neon's pg supports inArray. We filter by
  // target and then loop in TS to keep the query simple.
  const cells = await db
    .select()
    .from(snapshotTargetCoverage)
    .where(eq(snapshotTargetCoverage.careerTargetId, targetId));

  const cellMap = new Map<string, typeof cells[number]>();
  for (const c of cells) {
    if (snapshotIds.includes(c.snapshotId)) {
      cellMap.set(`${c.snapshotId}:${c.subCompetencyId}`, c);
    }
  }

  // Reconstruct productive-failure conditions per snapshot from its profile blob.
  const pfBySnapshot = new Map<string, SnapshotCellInput['productiveFailureConditions']>();
  for (const r of latest) {
    const profile = r.profile as { audit_notes?: { productive_failure_conditions?: SnapshotCellInput['productiveFailureConditions'] } } | null;
    pfBySnapshot.set(r.snapshotId, profile?.audit_notes?.productive_failure_conditions ?? null);
  }

  const cellsBySub = new Map<string, SnapshotCellInput[]>();
  for (const sub of subs) {
    const list: SnapshotCellInput[] = [];
    for (const course of coursesOut) {
      const cell = cellMap.get(`${course.snapshotId}:${sub.id}`);
      if (!cell) continue;
      list.push({
        snapshotId: course.snapshotId,
        courseCode: course.courseCode,
        sequenceIndex: course.sequenceIndex,
        kDepth: cell.kDepth,
        uDepth: cell.uDepth,
        dDepth: cell.dDepth,
        productiveFailureConditions: pfBySnapshot.get(course.snapshotId) ?? null,
      });
    }
    cellsBySub.set(sub.id, list);
  }

  return {
    targetId,
    targetName: target[0].name,
    courses: coursesOut,
    subCompetencies: subs.map(s => ({
      id: s.id,
      name: s.name,
      descriptorK: s.descriptorK ?? null,
      descriptorU: s.descriptorU ?? null,
      descriptorD: s.descriptorD ?? null,
    })),
    cellsBySubCompetency: cellsBySub,
  };
}
```

- [ ] **Step 2: Verify field names against schema**

Read `lib/db/schema.ts` for `careerTargets`, `subCompetencies`, `courses`, `courseCaptureSnapshots`, `snapshotTargetCoverage`. If `descriptorK` / `descriptorU` / `descriptorD` or `orderIndex` have different column names, adjust the select. Same for `retiredAt`. The plan's column names are spec-aligned, not necessarily exact — confirm and patch.

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit` — clean.

- [ ] **Step 4: Commit**

```bash
git add lib/db/scaffolding-queries.ts
git commit -m "feat(program): scaffolding query loader — single-target snapshot cells + PF"
```

---

## Task 3: API route

**Files:** Create `app/api/program/scaffolding/route.ts`.

- [ ] **Step 1: Write the GET handler**

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { loadScaffoldingTarget } from '@/lib/db/scaffolding-queries';
import { aggregateSubCompetency } from '@/lib/program/scaffolding';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const targetId = url.searchParams.get('target') ?? '';
  if (!targetId) return NextResponse.json({ error: 'missing target' }, { status: 400 });

  const input = await loadScaffoldingTarget(targetId);
  if (!input) return NextResponse.json({ error: 'target not found' }, { status: 404 });

  const rows = input.subCompetencies.map(sub => {
    const cells = input.cellsBySubCompetency.get(sub.id) ?? [];
    const agg = aggregateSubCompetency(sub.id, sub.name, cells);
    return {
      subCompetency: sub,
      cells: cells.map(c => ({
        snapshotId: c.snapshotId,
        courseCode: c.courseCode,
        sequenceIndex: c.sequenceIndex,
        kDepth: c.kDepth,
        uDepth: c.uDepth,
        dDepth: c.dDepth,
        pfConditions: c.productiveFailureConditions,
      })),
      scaffoldingStatus: agg.scaffolding.status,
      phases: agg.scaffolding.phases,
      cumulativePfScore: Number(agg.cumulativePfScore.toFixed(3)),
      pfStatus: agg.pfStatus,
    };
  });

  return NextResponse.json({
    target: { id: input.targetId, name: input.targetName },
    courses: input.courses,
    rows,
  });
}
```

- [ ] **Step 2: Type-check + commit**

Run: `pnpm tsc --noEmit` — clean.

```bash
git add app/api/program/scaffolding/route.ts
git commit -m "feat(api): GET /api/program/scaffolding?target= — per-target strip data"
```

---

## Task 4: View 1 — scaffolding strip page + client

**Files:** Create `app/program/scaffolding/page.tsx` and `app/program/scaffolding/ScaffoldingStripClient.tsx`. Modify `app/program/page.tsx` to link to the new route.

- [ ] **Step 1: Write the page shell**

`app/program/scaffolding/page.tsx`:

```typescript
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { ScaffoldingStripClient } from './ScaffoldingStripClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string; target?: string }>;
}

export default async function ScaffoldingPage({ searchParams }: Props) {
  const { slug = '', target = '' } = await searchParams;
  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }
  const targets = await db.select({ id: careerTargets.id, name: careerTargets.name }).from(careerTargets).orderBy(asc(careerTargets.name));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Phase 1B · Scaffolding</p>
            <h1 className="mt-0.5 text-xl font-semibold">GC Program — Scaffolding Strip</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/program?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">← Coverage matrix</Link>
            <Link href={`/?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">Hub</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">
        <ScaffoldingStripClient slug={slug} targets={targets} selectedTargetId={target || (targets[0]?.id ?? '')} />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Write the client strip**

`app/program/scaffolding/ScaffoldingStripClient.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Target { id: string; name: string; }
interface PfConditions {
  generate_then_consolidate: 'present' | 'partial' | 'absent';
  open_ended_problems: 'present' | 'partial' | 'absent';
  revision_cycles: 'present' | 'partial' | 'absent';
  structured_post_mortem: 'present' | 'partial' | 'absent';
  max_supporting_depth: number;
  notes: string[];
}
interface Cell {
  snapshotId: string;
  courseCode: string;
  sequenceIndex: number;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  pfConditions: PfConditions | null;
}
interface Row {
  subCompetency: { id: string; name: string; descriptorD: string | null };
  cells: Cell[];
  scaffoldingStatus: 'well_scaffolded' | 'top_heavy' | 'bottom_heavy' | 'coverage_only' | 'brittle_scaffold' | 'not_addressed';
  phases: { introduction: boolean; practice: boolean; integration: boolean };
  cumulativePfScore: number;
  pfStatus: 'well_developed' | 'developing' | 'thin' | 'absent';
}
interface CourseHeader {
  snapshotId: string;
  courseCode: string;
  courseTitle: string;
  level: number;
  sequenceIndex: number;
}
interface Payload {
  target: { id: string; name: string };
  courses: CourseHeader[];
  rows: Row[];
}

const D_PALETTE = ['bg-stone-100', 'bg-amber-100', 'bg-amber-200', 'bg-orange-200', 'bg-orange-300', 'bg-rose-300'];

function depthBg(d: number | null): string {
  if (d === null || d === undefined) return 'bg-stone-50';
  return D_PALETTE[Math.max(0, Math.min(5, d))] ?? 'bg-stone-100';
}

function pfDotColor(pf: PfConditions | null): string {
  if (!pf) return 'bg-stone-300';
  const score =
    (['present', 'partial', 'absent'] as const).reduce((_a, _v) => _a, 0) + 0; // placeholder so TS doesn't bark on unused
  const count = (k: keyof Pick<PfConditions, 'generate_then_consolidate' | 'open_ended_problems' | 'revision_cycles' | 'structured_post_mortem'>) =>
    pf[k] === 'present' ? 1 : pf[k] === 'partial' ? 0.5 : 0;
  const total = count('generate_then_consolidate') + count('open_ended_problems') + count('revision_cycles') + count('structured_post_mortem');
  const _ = score;
  if (total >= 3) return 'bg-emerald-500';
  if (total >= 1.5) return 'bg-amber-400';
  return 'bg-rose-500';
}

function statusChip(s: Row['scaffoldingStatus']): { label: string; cls: string } {
  switch (s) {
    case 'well_scaffolded':  return { label: 'well-scaffolded', cls: 'bg-emerald-100 text-emerald-900' };
    case 'top_heavy':        return { label: 'top-heavy',       cls: 'bg-amber-100 text-amber-900' };
    case 'bottom_heavy':     return { label: 'bottom-heavy',    cls: 'bg-amber-100 text-amber-900' };
    case 'coverage_only':    return { label: 'coverage-only',   cls: 'bg-orange-100 text-orange-900' };
    case 'brittle_scaffold': return { label: 'brittle',         cls: 'bg-rose-100 text-rose-900' };
    case 'not_addressed':    return { label: 'not addressed',   cls: 'bg-stone-100 text-stone-700' };
  }
}

function pfChip(s: Row['pfStatus'], cum: number): { label: string; cls: string } {
  const label = `${s.replace('_', '-')} · ${cum.toFixed(2)}`;
  switch (s) {
    case 'well_developed': return { label, cls: 'bg-emerald-100 text-emerald-900' };
    case 'developing':     return { label, cls: 'bg-amber-100 text-amber-900' };
    case 'thin':           return { label, cls: 'bg-orange-100 text-orange-900' };
    case 'absent':         return { label, cls: 'bg-stone-100 text-stone-700' };
  }
}

interface Props {
  slug: string;
  targets: Target[];
  selectedTargetId: string;
}

export function ScaffoldingStripClient({ slug, targets, selectedTargetId }: Props) {
  const [targetId, setTargetId] = useState(selectedTargetId);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!targetId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/program/scaffolding?slug=${encodeURIComponent(slug)}&target=${encodeURIComponent(targetId)}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error?: string }) => { throw new Error(e.error ?? `HTTP ${r.status}`); }))
      .then((payload: Payload) => setData(payload))
      .catch(e => setError(e instanceof Error ? e.message : 'fetch failed'))
      .finally(() => setLoading(false));
  }, [targetId, slug]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Career target</label>
        <select
          value={targetId}
          onChange={e => setTargetId(e.target.value)}
          className="rounded border border-input bg-background px-2 py-1 text-sm"
        >
          {targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      {data && (
        <div className="overflow-x-auto rounded border bg-card">
          <table className="text-xs">
            <thead>
              <tr className="bg-muted/40">
                <th className="sticky left-0 z-10 bg-muted/40 px-2 py-2 text-left font-medium min-w-[220px]">Sub-competency</th>
                {data.courses.map(c => (
                  <th key={c.snapshotId} className="px-2 py-2 text-left font-medium min-w-[120px]">
                    <div className="font-mono">{c.courseCode}</div>
                    <div className="text-[10px] font-normal text-muted-foreground truncate max-w-[120px]">{c.courseTitle}</div>
                  </th>
                ))}
                <th className="px-2 py-2 text-left font-medium min-w-[220px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => {
                const status = statusChip(r.scaffoldingStatus);
                const pf = pfChip(r.pfStatus, r.cumulativePfScore);
                const cellBySnap = new Map(r.cells.map(c => [c.snapshotId, c]));
                return (
                  <tr key={r.subCompetency.id} className="border-t">
                    <td className="sticky left-0 z-10 bg-card px-2 py-1.5">{r.subCompetency.name}</td>
                    {data.courses.map(c => {
                      const cell = cellBySnap.get(c.snapshotId);
                      if (!cell) return <td key={c.snapshotId} className="px-1 py-0.5"><div className="h-6 w-full rounded bg-stone-50 border border-dashed border-stone-200" /></td>;
                      return (
                        <td key={c.snapshotId} className="px-1 py-0.5">
                          <div
                            className={`relative h-6 w-full rounded ${depthBg(cell.dDepth)} ring-1 ring-stone-300`}
                            title={`K=${cell.kDepth ?? '·'} U=${cell.uDepth ?? '·'} D=${cell.dDepth}`}
                          >
                            <span className={`absolute left-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${pfDotColor(cell.pfConditions)}`} />
                            {cell.pfConditions?.structured_post_mortem === 'present' && (
                              <span className="absolute right-0.5 top-0 text-[8px] font-bold text-emerald-700">R</span>
                            )}
                            {cell.pfConditions?.structured_post_mortem === 'partial' && (
                              <span className="absolute right-0.5 top-0 text-[8px] font-bold text-amber-700">r</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1">
                      <div className="flex flex-col gap-0.5">
                        <span className={`inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${status.cls}`}>{status.label}</span>
                        <span className={`inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${pf.cls}`}>{pf.label}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1 text-[11px] text-muted-foreground">
        <p><span className="inline-block h-2 w-2 rounded-full bg-emerald-500 mr-1.5 align-middle" />green dot = ≥3 PF conditions present · <span className="inline-block h-2 w-2 rounded-full bg-amber-400 mx-1.5 align-middle" />amber = ≥1.5 · <span className="inline-block h-2 w-2 rounded-full bg-rose-500 mx-1.5 align-middle" />red = &lt;1.5 or no data</p>
        <p>R = structured post-mortem present · r = partial · cell background = D depth (0–5, light→saturated)</p>
      </div>
    </div>
  );
}
```

NOTE: the `pfDotColor` function has placeholder `score` / `_` lines that compile but are visually noisy. Remove them — they're a leftover from initial drafting:

```typescript
function pfDotColor(pf: PfConditions | null): string {
  if (!pf) return 'bg-stone-300';
  const w = (v: 'present' | 'partial' | 'absent') => v === 'present' ? 1 : v === 'partial' ? 0.5 : 0;
  const total = w(pf.generate_then_consolidate) + w(pf.open_ended_problems) + w(pf.revision_cycles) + w(pf.structured_post_mortem);
  if (total >= 3) return 'bg-emerald-500';
  if (total >= 1.5) return 'bg-amber-400';
  return 'bg-rose-500';
}
```

(Use the cleaned version above in the actual file; the noisy version is illustrative only.)

- [ ] **Step 3: Add a header link from `/program`**

In `app/program/page.tsx`, in the header `<div className="flex items-center gap-4">`, add (before the existing Settings link):

```tsx
<Link href={`/program/scaffolding?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">Scaffolding view →</Link>
```

- [ ] **Step 4: Type-check + commit**

Run: `pnpm tsc --noEmit` — clean.

```bash
git add app/program/scaffolding/page.tsx app/program/scaffolding/ScaffoldingStripClient.tsx app/program/page.tsx
git commit -m "feat(program): View 1 scaffolding strip — per-target depth × PF heat map"
```

---

## Task 5: STATE update

**Files:** Modify `docs/STATE.md`.

- [ ] **Step 1: Edit STATE**

In the "Active arc" section, append a new paragraph after the Stage 5 paragraph:

```markdown
**Phase 1B Scaffolding Analysis — Stage 1 shipped 2026-05-28**: deterministic scoring primitives at `lib/program/scaffolding.ts` (depth-scaffolding status: `well_scaffolded / top_heavy / bottom_heavy / coverage_only / brittle_scaffold / not_addressed`; productive-failure cumulative score with depth-weight ramp and reflection multiplier; `pf_status` band: `well_developed / developing / thin / absent`). Query loader at `lib/db/scaffolding-queries.ts` joins `snapshot_target_coverage` with each snapshot's `audit_notes.productive_failure_conditions` block. API: `GET /api/program/scaffolding?target=<id>`. View 1 — scaffolding strip — at `/program/scaffolding`, with target selector and per-row status + PF chips. Views 2 (brittle-scaffold list) and 3 (course-contribution summary) plus the AI narrative + summary functions (`program-scaffolding-narrative`, `program-scaffolding-summary`) are Stage 2.
```

Under "What's live → faculty surfaces" table, add a new row before `/settings`:

```markdown
| `/program/scaffolding` | **Scaffolding Strip (Phase 1B Stage 1)** — per-target depth × PF condition × reflection heat map | live | 2026-05-28 |
```

Bump `**Last verified:**` to the SHA of this commit.

- [ ] **Step 2: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): Phase 1B Stage 1 — scaffolding scoring + strip view shipped"
```

---

## Self-Review

**Spec coverage (Stage 1 scope only):**
- Primitive 1 (depth-scaffolding) — Task 1. ✅
- Primitive 2 (productive-failure scoring) — Task 1. ✅
- Cumulative score thresholds (0.1 / 0.5 / 1.5) — Task 1. ✅
- View 1 (scaffolding strip) — Task 4. ✅
- Data layer — Task 2 (single-target loader). ✅
- Program-sequence ordering — Task 2 uses `courses.level` first, then code; spec's prerequisite-chain refinement is noted as a Stage-2 polish.

**Out of Stage 1 scope (deferred to Stage 2):**
- View 2 — brittle-scaffold list at `?lens=brittle` with AI-narrated rows.
- View 3 — course-contribution summary at `?lens=course-contributions`.
- `program-scaffolding-narrative` and `program-scaffolding-summary` AI functions.
- Sub-competency type classification (`technical | horizontal | mixed`) and type-specific interpretation framing.
- Cross-target program-level rollups + "unproductive success" / "premature pedagogy" / "coverage-without-integration" named patterns.

**Type consistency:** `SnapshotCellInput` is the lingua franca between `lib/program/scaffolding.ts` and `lib/db/scaffolding-queries.ts`; the API route serializes the same shape. The strip client redeclares the wire-shape (no shared types between server and client in Next.js — that's standard for this codebase).

**Placeholders:** none. The single noisy `pfDotColor` stub in the initial drafting has a cleaned replacement explicitly called out in Task 4 Step 2.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-phase1b-scaffolding-stage1-data-and-strip.md`.

Execute via superpowers:subagent-driven-development (one subagent per task, two-stage review between).
