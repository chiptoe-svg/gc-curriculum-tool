# P3 Career Weights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute each career target's competency weights from O*NET Importance of confirmed core items, blended with Position Capture employer ratings, store them per source, and order the review queue so core items with the highest Importance come first.

**Architecture:** A pure module (`lib/catalog/career-weights.ts`) holds every formula. A DB module (`lib/db/career-weight-queries.ts`) loads inputs, writes one `onet` row and one `employer` row per (target, competency, horizon) beside the existing `faculty` rows, and reads them back through the pure `effectiveWeight`. A CLI recomputes on demand; the bundle-review and capture-submit routes recompute after their write. No migration: `career_target_requirements` already keys rows by `weight_source`.

**Tech Stack:** Next.js 15 route handlers, TypeScript strict, Drizzle on Postgres 17, Vitest (+ Testing Library for the panel).

**Spec:** [`docs/superpowers/specs/2026-10-21-p3-career-weights-design.md`](../specs/2026-10-21-p3-career-weights-design.md) (approved 2026-10-21; supersedes step 4 of `2026-10-11-competency-catalog-and-career-demand-design.md`).

## Global Constraints

- Importance rescale: (IM − 1) / 4 for O*NET (1–5); (r − 1) / 6 for employer ratings (1–7).
- Related discount `d` = 0 (core only); employer prior `k` = 3; disagreement flag at |w_onet − w_emp| ≥ 0.25 with n ≥ 2. One constant each, in `lib/catalog/career-weights.ts`.
- Fringe items never count. Only `status = 'confirmed'` members count, at their confirmed `position`.
- No counting item → O*NET weight is `null`, never 0. A competency not mentioned by a capture is "no data", never 0.
- Employer weights: `entry` horizon only.
- Faculty rows are never written by recompute. A faculty row with `status = 'confirmed'` and a non-null weight is an override and always wins.
- Retired captures and superseded captures are excluded.
- Never run anything that loads `.env.local` against live in tests: `env -u DATABASE_URL pnpm -s vitest run` for the suite; DB tests run only against the scratch DB `gc_curriculum_p2_scratch` (guard `isP2ScratchDb()`).
- US spelling; commit trailer as in CLAUDE.md.
- No AI calls in this plan: every weight is computed deterministically. If a later P3 step needs a model (AI-drafted faculty weights for competencies with no O*NET link; drafted required depths), use **GLM-5.3 on the RCD campus endpoint** for this round (owner, 2026-10-21; the curriculum OpenAI credits are exhausted): `AI_PROVIDER=campus CAMPUS_LLM_DEFAULT_MODEL=glm-5.3` for the script run, about 2 minutes per call.

## Rulings (controller, while writing the plan)

1. **Weights are written only for (target, competency) pairs that are already members of the target.** Membership is "has any `career_target_requirements` row" (the `target_sub_competencies` view, migration 0056). Writing `onet` rows for every catalog competency would silently add every competency to every target and change coverage scoring, the program views and the wiki. The spec talks about weights for the catalog; which competencies a target includes stays a faculty decision. Cost if wrong: weights for non-members are missing until faculty add the competency to the target; the CLI prints, read-only, the O*NET weight of non-members above 0.5 so they can be considered.
2. **"Components stored beside it" (spec §4) = the per-source rows** (`onet`, `employer`, `faculty`) the table already supports; the effective weight is computed at read time by `effectiveWeight`, not stored. Cost if wrong: one more column later; nothing is lost because every input is stored.
3. **An employer row with no rating but at least one "named" capture** is written with `weight = null`, `contributing_position_ids = []` and a note, so the source view can show "named, unrated". *n* is always `contributing_position_ids.length`.
4. **O*NET element ratings flagged `not_relevant = true` are ignored.**
5. **Recompute after a review action or a capture submission is best effort:** it runs after the triggering transaction commits, and a failure is logged (`[career-weights]`) without failing the request; the CLI repairs any gap.

## Review Focus

1. A target occupation with no rating for any counting item: contributes 0, does not make the weight null if another occupation has one (pinned in Task 1).
2. Ratings outside 1–7 or non-numeric in `rated_skills` (partner data is JSONB): ignored, not crashing, not counted (pinned in Task 2).
3. A competency that loses its last confirmed core item (reviewer rejects it): its `onet` row is deleted, so the weight falls back instead of keeping a stale value (pinned in Task 3).
4. A faculty override survives a recompute and still wins (pinned in Task 3).
5. Members of a blind-locked bundle are never used (they are `proposed`, so the confirmed-only rule already excludes them; pinned in Task 3).

---

### Task 1: Pure O*NET weight, blend and effective weight

**Files:**
- Create: `lib/catalog/career-weights.ts`
- Test: `lib/catalog/__tests__/career-weights.test.ts`

**Interfaces:**
- Produces:
  - `RELATED_DISCOUNT = 0`, `EMPLOYER_PRIOR_K = 3`, `DISAGREEMENT_GAP = 0.25`, `DISAGREEMENT_MIN_N = 2`
  - `type Position = 'core' | 'related' | 'fringe'`
  - `interface WeightItem { position: Position; importanceBySoc: Record<string, number> }` (IM 1–5; an element lists every rated occupation, a task only its own)
  - `interface Occupation { soc: string; share: number }`
  - `rescaleImportance(im: number): number`
  - `onetWeight(items: WeightItem[], occupations: Occupation[], relatedDiscount?: number): number | null`
  - `interface WeightSources { onet: number | null; employer: number | null; n: number; facultyOverride: number | null; facultyDraft: number | null }`
  - `type WeightBasis = 'faculty_override' | 'blend' | 'onet' | 'employer' | 'faculty_draft' | 'none'`
  - `effectiveWeight(s: WeightSources, k?: number): { weight: number | null; basis: WeightBasis; disagreement: boolean }`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/catalog/__tests__/career-weights.test.ts
import { describe, it, expect } from 'vitest';
import { onetWeight, effectiveWeight, rescaleImportance, type WeightItem } from '@/lib/catalog/career-weights';

const occ = [{ soc: 'A', share: 0.75 }, { soc: 'B', share: 0.25 }];

describe('onetWeight', () => {
  it('rescales Importance (IM − 1) / 4', () => {
    expect(rescaleImportance(1)).toBe(0);
    expect(rescaleImportance(5)).toBe(1);
    expect(rescaleImportance(4)).toBeCloseTo(0.75);
  });

  it('takes the highest core item per occupation, weighted by share', () => {
    const items: WeightItem[] = [
      { position: 'core', importanceBySoc: { A: 5, B: 3 } },
      { position: 'core', importanceBySoc: { A: 3, B: 4 } },
    ];
    // A: max(1, .5) = 1 → .75 ; B: max(.5, .75) = .75 → .1875
    expect(onetWeight(items, occ)).toBeCloseTo(0.9375);
  });

  it('ignores related items at the default discount 0 and fringe always', () => {
    const items: WeightItem[] = [
      { position: 'core', importanceBySoc: { A: 3 } },
      { position: 'related', importanceBySoc: { A: 5 } },
      { position: 'fringe', importanceBySoc: { A: 5, B: 5 } },
    ];
    expect(onetWeight(items, occ)).toBeCloseTo(0.75 * 0.5);
  });

  it('counts related items at the given discount', () => {
    const items: WeightItem[] = [{ position: 'related', importanceBySoc: { A: 5 } }];
    expect(onetWeight(items, occ, 0.5)).toBeCloseTo(0.75 * 0.5);
  });

  it('an occupation with no rated counting item contributes 0 without nulling the weight', () => {
    const items: WeightItem[] = [{ position: 'core', importanceBySoc: { A: 5 } }];
    expect(onetWeight(items, occ)).toBeCloseTo(0.75);
  });

  it('returns null, not 0, when no counting item is rated in any target occupation', () => {
    expect(onetWeight([], occ)).toBeNull();
    expect(onetWeight([{ position: 'related', importanceBySoc: { A: 5 } }], occ)).toBeNull();
    expect(onetWeight([{ position: 'core', importanceBySoc: { Z: 5 } }], occ)).toBeNull();
  });
});

describe('effectiveWeight', () => {
  const none = { onet: null, employer: null, n: 0, facultyOverride: null, facultyDraft: null };

  it('a faculty override always wins', () => {
    expect(effectiveWeight({ ...none, onet: 0.9, employer: 0.1, n: 5, facultyOverride: 0.3 })).toEqual({ weight: 0.3, basis: 'faculty_override', disagreement: true });
  });

  it('with no employer ratings the weight is the O*NET weight', () => {
    expect(effectiveWeight({ ...none, onet: 0.8 })).toEqual({ weight: 0.8, basis: 'onet', disagreement: false });
  });

  it('blends (k·onet + n·employer)/(k + n) with k = 3', () => {
    const r = effectiveWeight({ ...none, onet: 0.8, employer: 0.4, n: 1 });
    expect(r.basis).toBe('blend');
    expect(r.weight).toBeCloseTo((3 * 0.8 + 1 * 0.4) / 4);
  });

  it('uses the employer weight when there is no O*NET weight', () => {
    expect(effectiveWeight({ ...none, employer: 0.6, n: 2 })).toEqual({ weight: 0.6, basis: 'employer', disagreement: false });
  });

  it('falls back to the faculty draft, then to none', () => {
    expect(effectiveWeight({ ...none, facultyDraft: 0.5 })).toEqual({ weight: 0.5, basis: 'faculty_draft', disagreement: false });
    expect(effectiveWeight(none)).toEqual({ weight: null, basis: 'none', disagreement: false });
  });

  it('flags disagreement only at a gap of 0.25 or more with n ≥ 2', () => {
    expect(effectiveWeight({ ...none, onet: 0.8, employer: 0.55, n: 2 }).disagreement).toBe(true);
    expect(effectiveWeight({ ...none, onet: 0.8, employer: 0.56, n: 2 }).disagreement).toBe(false);
    expect(effectiveWeight({ ...none, onet: 0.8, employer: 0.1, n: 1 }).disagreement).toBe(false);
  });

  it('ignores an employer weight with n = 0 (named-unrated rows carry weight null)', () => {
    expect(effectiveWeight({ ...none, onet: 0.7, employer: null, n: 0 })).toEqual({ weight: 0.7, basis: 'onet', disagreement: false });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `env -u DATABASE_URL pnpm -s vitest run lib/catalog/__tests__/career-weights.test.ts`
Expected: FAIL — cannot resolve `@/lib/catalog/career-weights`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/catalog/career-weights.ts
/**
 * P3 career weights (spec docs/superpowers/specs/2026-10-21-p3-career-weights-design.md).
 * Pure: no DB, no I/O. Weight = how much a competency matters for a career.
 *   O*NET: per occupation, the highest Importance among confirmed counting
 *   items (core fully, related × RELATED_DISCOUNT, fringe never), summed by
 *   occupation share. Employer (Position Capture): see employerWeight.
 *   Effective: faculty override > blend (k·onet + n·employer)/(k + n) >
 *   onet > employer > faculty draft > none.
 */
export const RELATED_DISCOUNT = 0;
export const EMPLOYER_PRIOR_K = 3;
export const DISAGREEMENT_GAP = 0.25;
export const DISAGREEMENT_MIN_N = 2;

export type Position = 'core' | 'related' | 'fringe';
export interface WeightItem { position: Position; importanceBySoc: Record<string, number> }
export interface Occupation { soc: string; share: number }

export function rescaleImportance(im: number): number {
  return Math.min(1, Math.max(0, (im - 1) / 4));
}

function positionFactor(p: Position, relatedDiscount: number): number {
  return p === 'core' ? 1 : p === 'related' ? relatedDiscount : 0;
}

export function onetWeight(items: WeightItem[], occupations: Occupation[], relatedDiscount: number = RELATED_DISCOUNT): number | null {
  let counted = false;
  let total = 0;
  for (const o of occupations) {
    let best = 0;
    for (const it of items) {
      const f = positionFactor(it.position, relatedDiscount);
      if (f === 0) continue;
      const im = it.importanceBySoc[o.soc];
      if (im === undefined) continue;
      counted = true;
      best = Math.max(best, f * rescaleImportance(im));
    }
    total += o.share * best;
  }
  return counted ? Math.min(1, total) : null;
}

export interface WeightSources { onet: number | null; employer: number | null; n: number; facultyOverride: number | null; facultyDraft: number | null }
export type WeightBasis = 'faculty_override' | 'blend' | 'onet' | 'employer' | 'faculty_draft' | 'none';

export function effectiveWeight(s: WeightSources, k: number = EMPLOYER_PRIOR_K): { weight: number | null; basis: WeightBasis; disagreement: boolean } {
  const hasEmp = s.employer !== null && s.n > 0;
  const disagreement = s.onet !== null && hasEmp && s.n >= DISAGREEMENT_MIN_N && Math.abs(s.onet - s.employer!) >= DISAGREEMENT_GAP;
  if (s.facultyOverride !== null) return { weight: s.facultyOverride, basis: 'faculty_override', disagreement };
  if (s.onet !== null && hasEmp) return { weight: (k * s.onet + s.n * s.employer!) / (k + s.n), basis: 'blend', disagreement };
  if (s.onet !== null) return { weight: s.onet, basis: 'onet', disagreement };
  if (hasEmp) return { weight: s.employer, basis: 'employer', disagreement };
  if (s.facultyDraft !== null) return { weight: s.facultyDraft, basis: 'faculty_draft', disagreement };
  return { weight: null, basis: 'none', disagreement };
}
```

Note the disagreement flag uses a small float tolerance concern: 0.8 − 0.55 = 0.25000000000000006 ≥ 0.25 and 0.8 − 0.56 = 0.24 < 0.25, so the test values are safe; keep them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `env -u DATABASE_URL pnpm -s vitest run lib/catalog/__tests__/career-weights.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Red-proof** — temporarily change `positionFactor` to return 1 for `related`; confirm "ignores related items" fails; revert. Temporarily return 0 instead of null at the end of `onetWeight`; confirm the null test fails; revert.

- [ ] **Step 6: Commit**

```bash
git add lib/catalog/career-weights.ts lib/catalog/__tests__/career-weights.test.ts
git commit -m "feat(catalog): pure P3 weight formulas — O*NET core-item importance, employer blend, effective weight"
```

---

### Task 2: Pure employer weight from Position Capture

**Files:**
- Modify: `lib/catalog/career-weights.ts` (append)
- Test: `lib/catalog/__tests__/career-weights.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `interface CaptureInput { id: string; ratedItems: Array<{ competencyId: string | null; rating: unknown }>; namedCompetencyIds: string[] }`
  - `employerWeight(captures: CaptureInput[], competencyId: string): { weight: number | null; ratedBy: string[]; namedOnlyBy: string[] }`
  - `captureInputFromRow(row: { id: string; ratedSkills: unknown; profile: unknown }): CaptureInput` — tolerant parser of the JSONB columns.

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { employerWeight, captureInputFromRow } from '@/lib/catalog/career-weights';

describe('employerWeight', () => {
  const cap = (id: string, rated: Array<[string | null, unknown]>, named: string[] = []) =>
    ({ id, ratedItems: rated.map(([competencyId, rating]) => ({ competencyId, rating })), namedCompetencyIds: named });

  it('per capture takes the highest rating tagged with the competency, rescaled (r − 1)/6, then averages captures', () => {
    const r = employerWeight([cap('p1', [['c', 4], ['c', 7], ['x', 1]]), cap('p2', [['c', 1]])], 'c');
    expect(r.weight).toBeCloseTo((1 + 0) / 2);
    expect(r.ratedBy).toEqual(['p1', 'p2']);
    expect(r.namedOnlyBy).toEqual([]);
  });

  it('a capture that only names the competency is named-unrated and adds no number', () => {
    const r = employerWeight([cap('p1', [['x', 7]], ['c'])], 'c');
    expect(r).toEqual({ weight: null, ratedBy: [], namedOnlyBy: ['p1'] });
  });

  it('a competency nobody mentions is no data, never 0', () => {
    expect(employerWeight([cap('p1', [['x', 7]])], 'c')).toEqual({ weight: null, ratedBy: [], namedOnlyBy: [] });
  });

  it('ignores ratings outside 1–7, non-integers outside range, and non-numbers', () => {
    const r = employerWeight([cap('p1', [['c', 0], ['c', 8], ['c', '7'], ['c', null], ['c', Number.NaN]])], 'c');
    expect(r).toEqual({ weight: null, ratedBy: [], namedOnlyBy: [] });
  });
});

describe('captureInputFromRow', () => {
  it('reads rated_skills items and qualifying competency ids, tolerating missing pieces', () => {
    const c = captureInputFromRow({
      id: 'p1',
      ratedSkills: { items: [{ name: 'a', sub_competency_id: 'c', rating: 6 }, { name: 'b', rating: 3 }], generatedAt: 'x' },
      profile: { qualifying_competencies: [{ name: 'n', sub_competency_id: 'd' }, { name: 'm', sub_competency_id: null }] },
    });
    expect(c).toEqual({ id: 'p1', ratedItems: [{ competencyId: 'c', rating: 6 }, { competencyId: null, rating: 3 }], namedCompetencyIds: ['d'] });
    expect(captureInputFromRow({ id: 'p2', ratedSkills: null, profile: null })).toEqual({ id: 'p2', ratedItems: [], namedCompetencyIds: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL pnpm -s vitest run lib/catalog/__tests__/career-weights.test.ts`
Expected: FAIL — `employerWeight` / `captureInputFromRow` not exported.

- [ ] **Step 3: Implement** (append to `lib/catalog/career-weights.ts`)

```ts
export interface CaptureInput { id: string; ratedItems: Array<{ competencyId: string | null; rating: unknown }>; namedCompetencyIds: string[] }

function validRating(r: unknown): r is number {
  return typeof r === 'number' && Number.isFinite(r) && r >= 1 && r <= 7;
}

/** Employer weight for one competency over a target's submitted captures. Silence is no data, never 0. */
export function employerWeight(captures: CaptureInput[], competencyId: string): { weight: number | null; ratedBy: string[]; namedOnlyBy: string[] } {
  const values: number[] = [];
  const ratedBy: string[] = [];
  const namedOnlyBy: string[] = [];
  for (const c of captures) {
    const ratings = c.ratedItems.filter(i => i.competencyId === competencyId && validRating(i.rating)).map(i => i.rating as number);
    if (ratings.length > 0) {
      values.push((Math.max(...ratings) - 1) / 6);
      ratedBy.push(c.id);
    } else if (c.namedCompetencyIds.includes(competencyId)) {
      namedOnlyBy.push(c.id);
    }
  }
  return { weight: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, ratedBy, namedOnlyBy };
}

/** Tolerant reader of position_captures.rated_skills / .profile (JSONB written by the partner flow). */
export function captureInputFromRow(row: { id: string; ratedSkills: unknown; profile: unknown }): CaptureInput {
  const items = (row.ratedSkills as { items?: unknown } | null)?.items;
  const ratedItems = Array.isArray(items) ? items.map(it => {
    const o = (it ?? {}) as { sub_competency_id?: unknown; rating?: unknown };
    return { competencyId: typeof o.sub_competency_id === 'string' ? o.sub_competency_id : null, rating: o.rating };
  }) : [];
  const q = (row.profile as { qualifying_competencies?: unknown } | null)?.qualifying_competencies;
  const namedCompetencyIds = Array.isArray(q)
    ? q.map(x => (x as { sub_competency_id?: unknown } | null)?.sub_competency_id).filter((x): x is string => typeof x === 'string')
    : [];
  return { id: row.id, ratedItems, namedCompetencyIds };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `env -u DATABASE_URL pnpm -s vitest run lib/catalog/__tests__/career-weights.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 5: Red-proof** — change `validRating` to accept any number; confirm the out-of-range test fails; revert.

- [ ] **Step 6: Commit**

```bash
git add lib/catalog/career-weights.ts lib/catalog/__tests__/career-weights.test.ts
git commit -m "feat(catalog): employer weight from Position Capture ratings (no data is never 0)"
```

---

### Task 3: Load inputs, recompute and read weights (DB)

**Files:**
- Create: `lib/db/career-weight-queries.ts`
- Test: `tests/db/p3-career-weights.test.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `onetWeight`, `employerWeight`, `captureInputFromRow`, `effectiveWeight`, `WeightItem`, `Occupation`, `CaptureInput`, `WeightBasis`.
- Produces:
  - `type Executor = Tx | typeof db` (re-export the one from `lib/db/bundle-queries.ts`)
  - `interface RecomputeReport { onetUpserted: number; onetDeleted: number; employerUpserted: number; employerDeleted: number; pairs: number; byTarget: Array<{ targetId: string; horizon: 'entry' | 'growth'; members: number; withOnet: number; onetMin: number | null; onetMedian: number | null; onetMax: number | null }>; nonMemberCandidates: Array<{ targetId: string; horizon: 'entry' | 'growth'; competencyId: string; onet: number }> }`
  - `recomputeCareerWeights(ex: Executor, opts: { apply: boolean; release?: string }): Promise<RecomputeReport>`
  - `recomputeCareerWeightsSafely(reason: string): Promise<void>` (Ruling 5)
  - `interface CareerWeightRow { competencyId: string; displayOrder: number; weight: number | null; basis: WeightBasis; disagreement: boolean; onet: number | null; employer: number | null; n: number; namedOnly: string | null }`
  - `readCareerWeights(ex: Executor, targetId: string, horizon: 'entry' | 'growth'): Promise<CareerWeightRow[]>`

- [ ] **Step 0: Scratch DB.** DB tests run only on `gc_curriculum_p2_scratch`. Check it has migrations 0060 and 0061 (`select 1 from information_schema.columns where table_name='bundle_golden_samples' and column_name='shown_items'`). If not, recreate it from live (scratch only; live is only read): `scripts/migrations/p2-scratch-db.sh drop && scripts/migrations/p2-scratch-db.sh create`. Run DB tests with `DATABASE_URL=$(scripts/migrations/p2-scratch-db.sh url) pnpm -s vitest run tests/db/p3-career-weights.test.ts`.

- [ ] **Step 1: Write the failing DB tests**

```ts
// tests/db/p3-career-weights.test.ts
/**
 * P3 career weights — DB behavior, scratch DB only, every test in a rolled-back
 * transaction. Seeds its own target, occupations, competencies, members,
 * ratings and captures under the prefix 'p3w-'.
 */
import { describe, it, expect } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements } from '@/lib/db/schema';
import { recomputeCareerWeights, readCareerWeights, type Executor } from '@/lib/db/career-weight-queries';
import { isP2ScratchDb } from './p2/scratch-guard';

const RUN = isP2ScratchDb();
const REL = '31.0';
const T = 'p3w-target';
const SOC_A = '99-0001.00';
const SOC_B = '99-0002.00';

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Executor) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => { await fn(tx); throw new Rollback('rollback'); });
  } catch (err) { if (err instanceof Rollback) return; throw err; }
  throw new Error('transaction committed — expected rollback');
}

/** Seeds one target with occupations A (0.75) and B (0.25), competencies c1 (member) and c2 (not a member). */
async function seed(tx: Executor): Promise<void> {
  await tx.execute(sql`INSERT INTO onet_occupations (release, onet_soc_code, title) VALUES (${REL}, ${SOC_A}, 'Occ A'), (${REL}, ${SOC_B}, 'Occ B') ON CONFLICT DO NOTHING`);
  await tx.execute(sql`INSERT INTO career_targets (id, name, description) VALUES (${T}, 'P3W target', 'd')`);
  await tx.execute(sql`INSERT INTO sub_competencies (id, name, do_descriptor, origin) VALUES ('p3w-c1', 'C1', 'd', 'gc_authored'), ('p3w-c2', 'C2', 'd', 'gc_authored')`);
  await tx.execute(sql`INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, status, display_order) VALUES (${T}, 'p3w-c1', 'entry', 'faculty', 'draft', 1)`);
  await tx.execute(sql`INSERT INTO career_target_occupations (career_target_id, horizon, soc_code, onet_soc_code, count, share, source, source_version, as_of) VALUES
    (${T}, 'entry', '99-0001', ${SOC_A}, 3, 0.75, 'alumni_rule', 't', '2026-10-21'), (${T}, 'entry', '99-0002', ${SOC_B}, 1, 0.25, 'alumni_rule', 't', '2026-10-21'),
    (${T}, 'growth', '99-0001', ${SOC_A}, 1, 1.0, 'alumni_rule', 't', '2026-10-21')`);
  await tx.execute(sql`INSERT INTO onet_element_ratings (release, onet_soc_code, domain, element_id, element_name, scale_id, data_value, recommend_suppress, not_relevant, date_text) VALUES
    (${REL}, ${SOC_A}, 'Skills', '9.Z.1', 'E1', 'IM', 5, false, false, '08/2026'),
    (${REL}, ${SOC_B}, 'Skills', '9.Z.1', 'E1', 'IM', 3, false, false, '08/2026'),
    (${REL}, ${SOC_A}, 'Skills', '9.Z.2', 'E2', 'IM', 2, false, false, '08/2026')`);
}

async function addMember(tx: Executor, bundle: string, elementId: string, position: string, status: string): Promise<void> {
  await tx.execute(sql`INSERT INTO bundle_members (bundle_id, source, external_id, external_label, release, position, status, proposed_by)
    VALUES (${bundle}, 'onet_element', ${elementId}, ${elementId}, ${REL}, ${position}, ${status}, 'reviewer')`);
}

async function rowsFor(tx: Executor, competencyId: string) {
  return tx.select().from(careerTargetRequirements).where(and(eq(careerTargetRequirements.careerTargetId, T), eq(careerTargetRequirements.competencyId, competencyId)));
}

describe.skipIf(!RUN)('P3 career weights (scratch DB only)', () => {
  it('writes an onet row from confirmed core items only, for member pairs only', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await addMember(tx, 'p3w-c1', '9.Z.1', 'core', 'confirmed');
      await addMember(tx, 'p3w-c1', '9.Z.2', 'related', 'confirmed');
      await addMember(tx, 'p3w-c2', '9.Z.1', 'core', 'confirmed');
      const report = await recomputeCareerWeights(tx, { apply: true });
      const c1 = await rowsFor(tx, 'p3w-c1');
      const onetEntry = c1.find(r => r.weightSource === 'onet' && r.horizon === 'entry')!;
      expect(onetEntry.weight).toBeCloseTo(0.75 * 1 + 0.25 * 0.5);
      expect(onetEntry.displayOrder).toBe(1);
      expect(c1.find(r => r.weightSource === 'onet' && r.horizon === 'growth')!.weight).toBeCloseTo(1);
      expect(await rowsFor(tx, 'p3w-c2')).toHaveLength(0); // not a member: no rows, membership unchanged
      expect(report.nonMemberCandidates.some(c => c.targetId === T && c.competencyId === 'p3w-c2')).toBe(true);
    });
  });

  it('ignores proposed members (blind-locked or unreviewed) and deletes a stale onet row when the last core item goes', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await addMember(tx, 'p3w-c1', '9.Z.1', 'core', 'confirmed');
      await recomputeCareerWeights(tx, { apply: true });
      expect((await rowsFor(tx, 'p3w-c1')).some(r => r.weightSource === 'onet')).toBe(true);
      await tx.execute(sql`UPDATE bundle_members SET status = 'rejected' WHERE bundle_id = 'p3w-c1'`);
      await addMember(tx, 'p3w-c1', '9.Z.2', 'core', 'proposed');
      await recomputeCareerWeights(tx, { apply: true });
      expect((await rowsFor(tx, 'p3w-c1')).some(r => r.weightSource === 'onet')).toBe(false);
    });
  });

  it('a dry run writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await addMember(tx, 'p3w-c1', '9.Z.1', 'core', 'confirmed');
      const report = await recomputeCareerWeights(tx, { apply: false });
      expect(report.onetUpserted).toBeGreaterThan(0);
      expect((await rowsFor(tx, 'p3w-c1')).filter(r => r.weightSource === 'onet')).toHaveLength(0);
    });
  });

  it('employer rows from submitted, current captures; retired and superseded excluded; named-unrated kept with null weight', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      const [{ id: partner }] = (await tx.execute(sql`INSERT INTO partners (name, email) VALUES ('P', 'p3w@example.edu') RETURNING id`)).rows as Array<{ id: string }>;
      const ins = async (rating: number, extra: string) => ((await tx.execute(sql.raw(`INSERT INTO position_captures (partner_id, career_target_id, status, company, rated_skills, profile, submitted_at, retired_at)
        VALUES ('${partner}', '${T}', 'submitted', 'Co', '{"items":[{"name":"x","sub_competency_id":"p3w-c1","rating":${rating}}]}', '{"qualifying_competencies":[]}', now(), ${extra}) RETURNING id`))).rows[0] as { id: string }).id;
      const live = await ins(7, 'NULL');
      await ins(1, 'now()'); // retired: excluded
      const old = await ins(1, 'NULL');
      await tx.execute(sql`INSERT INTO position_captures (partner_id, career_target_id, status, company, rated_skills, submitted_at, supersedes)
        VALUES (${partner}, ${T}, 'submitted', 'Co', '{"items":[]}', now(), ${old})`); // supersedes `old`; rates nothing
      await recomputeCareerWeights(tx, { apply: true });
      const emp = (await rowsFor(tx, 'p3w-c1')).find(r => r.weightSource === 'employer')!;
      expect(emp.weight).toBeCloseTo(1);
      expect(emp.contributingPositionIds).toEqual([live]);
    });
  });

  it('a faculty override survives a recompute and wins on read; disagreement is reported', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await addMember(tx, 'p3w-c1', '9.Z.1', 'core', 'confirmed');
      await tx.execute(sql`UPDATE career_target_requirements SET weight = 0.2, status = 'confirmed', note = 'faculty override' WHERE career_target_id = ${T} AND competency_id = 'p3w-c1' AND weight_source = 'faculty'`);
      await recomputeCareerWeights(tx, { apply: true });
      const fac = (await rowsFor(tx, 'p3w-c1')).find(r => r.weightSource === 'faculty')!;
      expect(fac.weight).toBeCloseTo(0.2);
      const [row] = await readCareerWeights(tx, T, 'entry');
      expect(row).toMatchObject({ competencyId: 'p3w-c1', weight: 0.2, basis: 'faculty_override' });
      expect(row!.onet).toBeCloseTo(0.875);
    });
  });
});
```

If a seed `INSERT` fails on a column this plan did not list (the tables have more NOT NULL columns than shown here), read the column list with `\d <table>` on the scratch DB and add the missing column with a neutral value; do not change the production code to suit the seed.

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL=$(scripts/migrations/p2-scratch-db.sh url) pnpm -s vitest run tests/db/p3-career-weights.test.ts`
Expected: FAIL — cannot resolve `@/lib/db/career-weight-queries`. (Without the scratch URL the suite is skipped — that is not a pass.)

- [ ] **Step 3: Implement**

```ts
// lib/db/career-weight-queries.ts
/**
 * P3 career weights (spec 2026-10-21-p3-career-weights-design.md; plan Rulings 1–5).
 * Writes `onet` and `employer` rows of career_target_requirements beside the
 * faculty rows, ONLY for (target, competency) pairs that are already members
 * (Ruling 1 — membership is any requirements row). Never writes faculty rows.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/bundle-queries';
import {
  onetWeight, employerWeight, captureInputFromRow, effectiveWeight,
  type WeightItem, type Occupation, type CaptureInput, type Position, type WeightBasis,
} from '@/lib/catalog/career-weights';

export type { Executor };
const DEFAULT_RELEASE = '31.0';
const HORIZONS = ['entry', 'growth'] as const;
type Horizon = typeof HORIZONS[number];

export interface RecomputeReport {
  onetUpserted: number; onetDeleted: number; employerUpserted: number; employerDeleted: number; pairs: number;
  byTarget: Array<{ targetId: string; horizon: Horizon; members: number; withOnet: number; onetMin: number | null; onetMedian: number | null; onetMax: number | null }>;
  nonMemberCandidates: Array<{ targetId: string; horizon: Horizon; competencyId: string; onet: number }>;
}

async function loadInputs(ex: Executor, release: string) {
  const pairRows = (await ex.execute(sql`
    SELECT career_target_id AS t, competency_id AS c, MIN(display_order) AS o
    FROM career_target_requirements GROUP BY 1, 2`)).rows as Array<{ t: string; c: string; o: number }>;
  const occRows = (await ex.execute(sql`
    SELECT career_target_id AS t, horizon AS h, onet_soc_code AS soc, share
    FROM career_target_occupations WHERE onet_soc_code IS NOT NULL`)).rows as Array<{ t: string; h: Horizon; soc: string; share: number }>;
  const occupations = new Map<string, Occupation[]>();
  for (const r of occRows) {
    const k = `${r.t}|${r.h}`;
    (occupations.get(k) ?? occupations.set(k, []).get(k)!).push({ soc: r.soc, share: Number(r.share) });
  }
  const socs = [...new Set(occRows.map(r => r.soc))];
  // Confirmed members only (proposed ones — incl. blind-locked bundles — never count).
  const memberRows = (await ex.execute(sql`
    SELECT bundle_id AS c, source, external_id AS id, onet_soc_code AS soc, position
    FROM bundle_members WHERE status = 'confirmed' AND source IN ('onet_element', 'onet_task')`)).rows as Array<{ c: string; source: string; id: string; soc: string | null; position: Position }>;
  const elementIds = [...new Set(memberRows.filter(m => m.source === 'onet_element').map(m => m.id))];
  const el = new Map<string, Record<string, number>>();
  if (elementIds.length > 0 && socs.length > 0) {
    const rows = (await ex.execute(sql`
      SELECT element_id AS id, onet_soc_code AS soc, data_value AS v FROM onet_element_ratings
      WHERE release = ${release} AND scale_id = 'IM' AND NOT not_relevant
        AND element_id IN (${sql.join(elementIds.map(x => sql`${x}`), sql`, `)})
        AND onet_soc_code IN (${sql.join(socs.map(x => sql`${x}`), sql`, `)})`)).rows as Array<{ id: string; soc: string; v: number }>;
    for (const r of rows) (el.get(r.id) ?? el.set(r.id, {}).get(r.id)!)[r.soc] = Number(r.v);
  }
  const taskRows = (await ex.execute(sql`
    SELECT r.task_id AS id, r.onet_soc_code AS soc, r.data_value AS v FROM onet_task_ratings r
    JOIN bundle_members m ON m.source = 'onet_task' AND m.status = 'confirmed' AND m.external_id = r.task_id AND m.onet_soc_code = r.onet_soc_code
    WHERE r.release = ${release} AND r.scale_id = 'IM'`)).rows as Array<{ id: string; soc: string; v: number }>;
  const task = new Map(taskRows.map(r => [`${r.id}|${r.soc}`, Number(r.v)]));
  const items = new Map<string, WeightItem[]>();
  for (const m of memberRows) {
    const importanceBySoc = m.source === 'onet_element'
      ? (el.get(m.id) ?? {})
      : (m.soc && task.has(`${m.id}|${m.soc}`) ? { [m.soc]: task.get(`${m.id}|${m.soc}`)! } : {});
    (items.get(m.c) ?? items.set(m.c, []).get(m.c)!).push({ position: m.position, importanceBySoc });
  }
  const capRows = (await ex.execute(sql`
    SELECT pc.id, pc.career_target_id AS t, pc.rated_skills AS "ratedSkills", pc.profile FROM position_captures pc
    WHERE pc.status = 'submitted' AND pc.retired_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM position_captures sup WHERE sup.supersedes = pc.id AND sup.status = 'submitted' AND sup.retired_at IS NULL)`)).rows as Array<{ id: string; t: string; ratedSkills: unknown; profile: unknown }>;
  const captures = new Map<string, CaptureInput[]>();
  for (const r of capRows) (captures.get(r.t) ?? captures.set(r.t, []).get(r.t)!).push(captureInputFromRow(r));
  const allCompetencies = (await ex.execute(sql`SELECT id FROM sub_competencies WHERE NOT retired`)).rows as Array<{ id: string }>;
  return { pairs: pairRows, occupations, items, captures, allCompetencies: allCompetencies.map(r => r.id) };
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)]! : null; };

async function upsert(ex: Executor, v: { t: string; c: string; h: Horizon; source: 'onet' | 'employer'; weight: number | null; order: number; contributing: string[]; note: string | null }) {
  await ex.insert(careerTargetRequirements).values({
    careerTargetId: v.t, competencyId: v.c, horizon: v.h, weightSource: v.source, weight: v.weight,
    status: 'draft', displayOrder: v.order, contributingPositionIds: v.contributing, note: v.note,
  }).onConflictDoUpdate({
    target: [careerTargetRequirements.careerTargetId, careerTargetRequirements.competencyId, careerTargetRequirements.horizon, careerTargetRequirements.weightSource],
    set: { weight: v.weight, contributingPositionIds: v.contributing, note: v.note, updatedAt: new Date() },
  });
}

async function remove(ex: Executor, t: string, c: string, h: Horizon, source: 'onet' | 'employer'): Promise<number> {
  const r = await ex.delete(careerTargetRequirements).where(and(
    eq(careerTargetRequirements.careerTargetId, t), eq(careerTargetRequirements.competencyId, c),
    eq(careerTargetRequirements.horizon, h), eq(careerTargetRequirements.weightSource, source),
  )).returning({ id: careerTargetRequirements.id });
  return r.length;
}

export async function recomputeCareerWeights(ex: Executor, opts: { apply: boolean; release?: string }): Promise<RecomputeReport> {
  const { pairs, occupations, items, captures, allCompetencies } = await loadInputs(ex, opts.release ?? DEFAULT_RELEASE);
  const report: RecomputeReport = { onetUpserted: 0, onetDeleted: 0, employerUpserted: 0, employerDeleted: 0, pairs: pairs.length, byTarget: [], nonMemberCandidates: [] };
  const targets = [...new Set([...pairs.map(p => p.t), ...[...occupations.keys()].map(k => k.split('|')[0]!)])].sort();
  for (const t of targets) {
    const members = pairs.filter(p => p.t === t);
    const memberSet = new Set(members.map(p => p.c));
    for (const h of HORIZONS) {
      const occ = occupations.get(`${t}|${h}`) ?? [];
      const values: number[] = [];
      for (const p of members) {
        const w = onetWeight(items.get(p.c) ?? [], occ);
        if (w !== null) {
          values.push(w); report.onetUpserted++;
          if (opts.apply) await upsert(ex, { t, c: p.c, h, source: 'onet', weight: w, order: p.o, contributing: [], note: null });
        } else if (opts.apply) report.onetDeleted += await remove(ex, t, p.c, h, 'onet');
        if (h === 'entry') {
          const e = employerWeight(captures.get(t) ?? [], p.c);
          if (e.ratedBy.length > 0 || e.namedOnlyBy.length > 0) {
            report.employerUpserted++;
            const note = e.namedOnlyBy.length > 0 ? `named without a rating by ${e.namedOnlyBy.length} position(s)` : null;
            if (opts.apply) await upsert(ex, { t, c: p.c, h, source: 'employer', weight: e.weight, order: p.o, contributing: e.ratedBy, note });
          } else if (opts.apply) report.employerDeleted += await remove(ex, t, p.c, h, 'employer');
        }
      }
      report.byTarget.push({ targetId: t, horizon: h, members: members.length, withOnet: values.length, onetMin: values.length ? Math.min(...values) : null, onetMedian: median(values), onetMax: values.length ? Math.max(...values) : null });
      for (const c of allCompetencies) {
        if (memberSet.has(c)) continue;
        const w = onetWeight(items.get(c) ?? [], occ);
        if (w !== null && w > 0.5) report.nonMemberCandidates.push({ targetId: t, horizon: h, competencyId: c, onet: w });
      }
    }
  }
  return report;
}

/** Ruling 5: after a review action or capture submission; never throws. */
export async function recomputeCareerWeightsSafely(reason: string): Promise<void> {
  try {
    await db.transaction(tx => recomputeCareerWeights(tx, { apply: true }).then(() => undefined));
  } catch (err) {
    console.warn(`[career-weights] recompute after ${reason} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface CareerWeightRow { competencyId: string; displayOrder: number; weight: number | null; basis: WeightBasis; disagreement: boolean; onet: number | null; employer: number | null; n: number; namedOnly: string | null }

export async function readCareerWeights(ex: Executor, targetId: string, horizon: Horizon): Promise<CareerWeightRow[]> {
  const rows = await ex.select().from(careerTargetRequirements)
    .where(and(eq(careerTargetRequirements.careerTargetId, targetId), inArray(careerTargetRequirements.horizon, [horizon])));
  const by = new Map<string, typeof rows>();
  for (const r of rows) (by.get(r.competencyId) ?? by.set(r.competencyId, []).get(r.competencyId)!).push(r);
  const out: CareerWeightRow[] = [];
  for (const [c, rs] of by) {
    const onet = rs.find(r => r.weightSource === 'onet') ?? null;
    const emp = rs.find(r => r.weightSource === 'employer') ?? null;
    const fac = rs.find(r => r.weightSource === 'faculty') ?? null;
    const n = emp?.contributingPositionIds.length ?? 0;
    const e = effectiveWeight({
      onet: onet?.weight ?? null,
      employer: emp?.weight ?? null, n,
      facultyOverride: fac && fac.status === 'confirmed' && fac.weight !== null ? fac.weight : null,
      facultyDraft: fac && fac.status === 'draft' ? fac.weight : null,
    });
    out.push({ competencyId: c, displayOrder: Math.min(...rs.map(r => r.displayOrder)), ...e, onet: onet?.weight ?? null, employer: emp?.weight ?? null, n, namedOnly: emp?.note ?? null });
  }
  return out.sort((a, b) => a.displayOrder - b.displayOrder || a.competencyId.localeCompare(b.competencyId));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=$(scripts/migrations/p2-scratch-db.sh url) pnpm -s vitest run tests/db/p3-career-weights.test.ts`
Expected: PASS (5 tests), and confirm in the output that they ran (not "skipped").

- [ ] **Step 5: Red-proof** — remove `status = 'confirmed' AND` from the member query; confirm "ignores proposed members" fails; revert. Change the pair loop to iterate `allCompetencies`; confirm "member pairs only" fails; revert.

- [ ] **Step 6: Type-check and commit**

```bash
npx tsc --noEmit -p .
git add lib/db/career-weight-queries.ts tests/db/p3-career-weights.test.ts
git commit -m "feat(catalog): recompute and read P3 career weights (onet + employer rows beside faculty rows, member pairs only)"
```

---

### Task 4: CLI `recompute-career-weights`

**Files:**
- Create: `scripts/catalog/recompute-career-weights.ts`
- Test: `scripts/catalog/__tests__/recompute-career-weights.test.ts`

**Interfaces:**
- Consumes: `recomputeCareerWeights`, `RecomputeReport` (Task 3); `assertExpectedDb`, `loadAppEnv`, `isMainModule`, `formatDbError` from `scripts/catalog/catalog-source.ts`.
- Produces: `main(argv: string[], deps?: { executor?: Executor; recompute?: typeof recomputeCareerWeights }): Promise<number>`; `formatReport(r: RecomputeReport): string`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/catalog/__tests__/recompute-career-weights.test.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/db/client', () => ({ db: { transaction: (fn: (tx: unknown) => unknown) => fn('TX') } }));
vi.mock('@/scripts/catalog/catalog-source', async (orig) => ({
  ...(await orig<typeof import('@/scripts/catalog/catalog-source')>()),
  assertExpectedDb: vi.fn(async (name: string) => { if (name !== 'scratch') throw new Error('wrong database'); }),
}));
import { main, formatReport } from '@/scripts/catalog/recompute-career-weights';
import type { RecomputeReport } from '@/lib/db/career-weight-queries';

const report: RecomputeReport = {
  onetUpserted: 3, onetDeleted: 1, employerUpserted: 0, employerDeleted: 0, pairs: 3,
  byTarget: [{ targetId: 't1', horizon: 'entry', members: 3, withOnet: 2, onetMin: 0.4, onetMedian: 0.5, onetMax: 0.9 }],
  nonMemberCandidates: [{ targetId: 't1', horizon: 'entry', competencyId: 'c9', onet: 0.8 }],
};

describe('recompute-career-weights CLI', () => {
  it('requires --expect-db (exit 2) and refuses the wrong database (exit 1)', async () => {
    expect(await main([])).toBe(2);
    expect(await main(['--expect-db', 'live'])).toBe(1);
  });

  it('dry run by default: calls recompute with apply false', async () => {
    const recompute = vi.fn(async () => report);
    expect(await main(['--expect-db', 'scratch'], { recompute })).toBe(0);
    expect(recompute).toHaveBeenCalledWith('TX', { apply: false });
  });

  it('--apply writes', async () => {
    const recompute = vi.fn(async () => report);
    expect(await main(['--expect-db', 'scratch', '--apply'], { recompute })).toBe(0);
    expect(recompute).toHaveBeenCalledWith('TX', { apply: true });
  });

  it('the report lists per-target spread, members without an O*NET weight, and non-member candidates', () => {
    const text = formatReport(report);
    expect(text).toMatch(/t1 entry: 3 members, 2 with an O\*NET weight, min 0\.40 median 0\.50 max 0\.90/);
    expect(text).toMatch(/not members.*c9 \(t1 entry, 0\.80\)/s);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL pnpm -s vitest run scripts/catalog/__tests__/recompute-career-weights.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
#!/usr/bin/env tsx
/**
 * P3 — recompute career weights (spec 2026-10-21-p3-career-weights-design.md).
 * Deterministic, no AI. Dry run by default (computes, prints, writes nothing);
 * --apply writes the onet/employer rows in one transaction.
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/recompute-career-weights.ts --expect-db <name> [--apply]
 *
 * Exit codes: 0 ok · 1 wrong database or failure · 2 bad args.
 */
import { db } from '@/lib/db/client';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb } from '@/scripts/catalog/catalog-source';
import { recomputeCareerWeights, type RecomputeReport, type Executor } from '@/lib/db/career-weight-queries';

const f2 = (x: number | null) => (x === null ? 'n/a' : x.toFixed(2));

export function formatReport(r: RecomputeReport): string {
  const out = [`pairs ${r.pairs} · onet rows ${r.onetUpserted} (deleted ${r.onetDeleted}) · employer rows ${r.employerUpserted} (deleted ${r.employerDeleted})`];
  for (const b of r.byTarget) out.push(`  ${b.targetId} ${b.horizon}: ${b.members} members, ${b.withOnet} with an O*NET weight, min ${f2(b.onetMin)} median ${f2(b.onetMedian)} max ${f2(b.onetMax)}`);
  if (r.nonMemberCandidates.length > 0) {
    out.push('O*NET weight above 0.5 but not members of the target (faculty decide; nothing written):');
    for (const c of r.nonMemberCandidates) out.push(`  ${c.competencyId} (${c.targetId} ${c.horizon}, ${c.onet.toFixed(2)})`);
  }
  return out.join('\n');
}

export async function main(argv: string[], deps: { executor?: Executor; recompute?: typeof recomputeCareerWeights } = {}): Promise<number> {
  const i = argv.indexOf('--expect-db');
  const expectDb = i >= 0 ? argv[i + 1] : undefined;
  if (!expectDb) { console.error('usage: --expect-db <name> [--apply]'); return 2; }
  const executor = deps.executor ?? db;
  try { await assertExpectedDb(expectDb, executor); } catch (err) { console.error(formatDbError(err)); return 1; }
  const apply = argv.includes('--apply');
  const run = deps.recompute ?? recomputeCareerWeights;
  try {
    const report = await db.transaction(tx => run(tx as Executor, { apply }));
    console.log(`${apply ? 'APPLY' : 'DRY RUN'} expect-db: ${expectDb}\n${formatReport(report)}${apply ? '' : '\nDRY RUN — nothing written.'}`);
    return 0;
  } catch (err) { console.error(formatDbError(err)); return 1; }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `env -u DATABASE_URL pnpm -s vitest run scripts/catalog/__tests__/recompute-career-weights.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Scratch smoke** — `DATABASE_URL=$(scripts/migrations/p2-scratch-db.sh url) node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs scripts/catalog/recompute-career-weights.ts --expect-db gc_curriculum_p2_scratch` prints the report and "DRY RUN — nothing written."

- [ ] **Step 6: Commit**

```bash
git add scripts/catalog/recompute-career-weights.ts scripts/catalog/__tests__/recompute-career-weights.test.ts
git commit -m "feat(catalog): recompute-career-weights CLI (dry run by default)"
```

---

### Task 5: Recompute after review actions and capture submission

**Files:**
- Modify: `app/api/admin/bundles/[id]/members/route.ts` (after the successful transaction)
- Modify: `app/api/admin/bundles/[id]/bulk-confirm/route.ts` (after the successful transaction)
- Modify: `app/api/partners/[token]/positions/[id]/route.ts:79-90` (after `finalizePosition` succeeds)
- Test: `app/api/admin/bundles/__tests__/routes.test.ts` (append), `app/api/partners/[token]/positions/[id]/__tests__/finalize-recompute.test.ts` (create)

**Interfaces:**
- Consumes: `recomputeCareerWeightsSafely(reason: string): Promise<void>` (Task 3).

- [ ] **Step 1: Write the failing tests**

In `app/api/admin/bundles/__tests__/routes.test.ts`, add a module mock next to the existing ones and two tests:

```ts
const mockRecompute = vi.fn(async (_reason: string) => {});
vi.mock('@/lib/db/career-weight-queries', () => ({ recomputeCareerWeightsSafely: (r: string) => mockRecompute(r) }));

describe('career-weight recompute after review writes', () => {
  beforeEach(() => mockRecompute.mockClear());

  it('runs after a successful member action, not after a refused one', async () => {
    // Arrange the existing applyMemberAction mock to succeed, then to return { ok: false, status: 409 }.
    // Use the same request helper the "POST action shapes" tests use, with action 'confirm'.
    // After success: expect(mockRecompute).toHaveBeenCalledWith('bundle review');
    // After the 409: expect(mockRecompute).toHaveBeenCalledTimes(1) (unchanged).
  });

  it('runs after a successful bulk confirm', async () => {
    // Same pattern with the bulk-confirm route: expect(mockRecompute).toHaveBeenCalledWith('bundle review').
  });
});
```

The two test bodies must use this file's existing request builders and `applyMemberAction` / `bulkConfirm` mocks (read lines 1–70 and the "POST action shapes" block before writing them); the assertions are exactly the ones in the comments.

Create `app/api/partners/[token]/positions/[id]/__tests__/finalize-recompute.test.ts` mocking `@/lib/db/position-capture-queries` (`finalizePosition` resolves) and the partner-token lookup the route uses (read the route's imports first), then assert one submit calls `recomputeCareerWeightsSafely('position capture submitted')` and a failing `finalizePosition` does not.

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL pnpm -s vitest run app/api/admin/bundles/__tests__/routes.test.ts "app/api/partners/[token]/positions/[id]/__tests__/finalize-recompute.test.ts"`
Expected: FAIL — `mockRecompute` never called.

- [ ] **Step 3: Implement**

`app/api/admin/bundles/[id]/members/route.ts` — add the import and replace the last three lines of `POST`:

```ts
import { recomputeCareerWeightsSafely } from '@/lib/db/career-weight-queries';
// …
  const result = await db.transaction(tx => applyMemberAction(tx, id, r.reviewer, action, ONET_RELEASE));
  if (!result.ok) return jsonError(result.error, result.status);
  await recomputeCareerWeightsSafely('bundle review'); // plan Ruling 5: after commit, never fails the request
  return jsonOk(result);
```

`app/api/admin/bundles/[id]/bulk-confirm/route.ts` — same import; after its success check, before `return jsonOk(...)`: `await recomputeCareerWeightsSafely('bundle review');`

`app/api/partners/[token]/positions/[id]/route.ts` — same import; after the `try { await finalizePosition(...) } catch {...}` block, before `return NextResponse.json({ ok: true })`: `await recomputeCareerWeightsSafely('position capture submitted');`

- [ ] **Step 4: Run to verify pass**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Red-proof** — move the recompute call above the `if (!result.ok)` line; confirm "not after a refused one" fails; revert.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/bundles/[id]/members/route.ts app/api/admin/bundles/[id]/bulk-confirm/route.ts "app/api/partners/[token]/positions/[id]/route.ts" app/api/admin/bundles/__tests__/routes.test.ts "app/api/partners/[token]/positions/[id]/__tests__/finalize-recompute.test.ts"
git commit -m "feat(catalog): recompute career weights after bundle review and capture submission (best effort)"
```

---

### Task 6: Review queue — core first by Importance

**Files:**
- Modify: `lib/db/bundle-queries.ts:535` (`MemberView` gains `importance: number | null`) and `readBundleDetail` (fills it)
- Modify: `app/admin/bundles/BundlesPanel.tsx:39` (`MemberView`), `:520` (`GroupedMemberRow` gains `importance`), `groupMembers` (sort), the queue row header and position headings
- Test: `app/admin/bundles/__tests__/BundlesPanel.test.tsx` (append), `tests/db/p3-career-weights.test.ts` (append one test)

**Interfaces:**
- Produces: `MemberView.importance` = the highest O*NET Importance (1–5) of the item across all GC destination occupations (`career_target_occupations`), `null` when unrated there.

- [ ] **Step 1: Write the failing tests**

Panel test (append inside `describe('BundlesPanel')`; uses the file's `queueBundle`, `pathOf`, `listResponse`, `detailResponse`, `ATTRIBUTION`):

```ts
  it('queue shows core items highest Importance first, shows the Importance, and says related/fringe do not change weights', async () => {
    const m = (id: string, label: string, position: string, importance: number | null) =>
      ({ id, source: 'onet_element', externalId: id, externalLabel: label, onetSocCode: null, position, aiPosition: position, status: 'proposed', proposedBy: 'model-x', rationale: null, reviewNote: null, bulkConfirmed: false, importance });
    const detail = { ...queueDetail, members: [m('a', 'Low core', 'core', 2.1), m('b', 'High core', 'core', 4.6), m('c', 'Unrated core', 'core', null), m('d', 'Some related', 'related', 4.9)] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const p = pathOf(url);
      if (p === '/api/admin/bundles') return listResponse([queueBundle]);
      if (p === '/api/admin/bundles/queue-bundle') return detailResponse(detail);
      return { ok: true, json: async () => ({ rows: [], total: { bundleId: 'ALL', aiCount: 0, blindCount: 0, both: 0, precision: null, recall: null, exact: 0 }, kappas: [], noMatch: [], notYetMapped: [], attribution: ATTRIBUTION }) };
    }));
    render(<BundlesPanel slug="s" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /review queue/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /review queue/i }));
    fireEvent.click(await screen.findByText('Queue bundle'));
    await screen.findByText('High core');
    const labels = screen.getAllByText(/core$/).map(e => e.textContent);
    expect(labels.indexOf('High core')).toBeLessThan(labels.indexOf('Low core'));
    expect(labels.indexOf('Low core')).toBeLessThan(labels.indexOf('Unrated core'));
    expect(screen.getByText(/importance 4\.6/i)).toBeInTheDocument();
    expect(screen.getByText(/related and fringe items don't change career weights/i)).toBeInTheDocument();
  });
```

DB test (append to `tests/db/p3-career-weights.test.ts`):

```ts
  it('readBundleDetail reports each member’s highest Importance across GC destination occupations', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await addMember(tx, 'p3w-c1', '9.Z.1', 'core', 'confirmed');
      const { readBundleDetail } = await import('@/lib/db/bundle-queries');
      const d = await readBundleDetail('p3w-c1', tx);
      expect(d?.members?.find(m => m.externalId === '9.Z.1')?.importance).toBe(5);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `env -u DATABASE_URL pnpm -s vitest run app/admin/bundles/__tests__/BundlesPanel.test.tsx` and `DATABASE_URL=$(scripts/migrations/p2-scratch-db.sh url) pnpm -s vitest run tests/db/p3-career-weights.test.ts`
Expected: FAIL — order is alphabetical, no Importance text, `importance` undefined.

- [ ] **Step 3: Implement**

`lib/db/bundle-queries.ts` — extend the interface and fill the field after `rows` is read in `readBundleDetail`:

```ts
export interface MemberView { id: string; source: string; externalId: string; externalLabel: string; onetSocCode: string | null; position: string; aiPosition: string | null; status: string; proposedBy: string; rationale: string | null; reviewNote: string | null; bulkConfirmed: boolean; importance: number | null }

// in readBundleDetail, replacing the `members` mapping:
  const imp = (await ex.execute(sql`
    SELECT m.id, MAX(r.data_value) AS v FROM bundle_members m
    JOIN onet_element_ratings r ON m.source = 'onet_element' AND r.element_id = m.external_id AND r.scale_id = 'IM' AND NOT r.not_relevant
      AND r.onet_soc_code IN (SELECT onet_soc_code FROM career_target_occupations WHERE onet_soc_code IS NOT NULL)
    WHERE m.bundle_id = ${bundleId} GROUP BY m.id
    UNION ALL
    SELECT m.id, MAX(r.data_value) FROM bundle_members m
    JOIN onet_task_ratings r ON m.source = 'onet_task' AND r.task_id = m.external_id AND r.onet_soc_code = m.onet_soc_code AND r.scale_id = 'IM'
    WHERE m.bundle_id = ${bundleId} GROUP BY m.id`)).rows as Array<{ id: string; v: number | null }>;
  const importance = new Map(imp.map(r => [r.id, r.v === null ? null : Number(r.v)]));
  const members: MemberView[] = rows.map(m => ({
    id: m.id, source: m.source, externalId: m.externalId, externalLabel: m.externalLabel, onetSocCode: m.onetSocCode,
    position: m.position, aiPosition: m.aiPosition, status: m.status, proposedBy: m.proposedBy, rationale: m.rationale,
    reviewNote: m.reviewNote, bulkConfirmed: m.bulkConfirmed, importance: importance.get(m.id) ?? null,
  }));
```

`app/admin/bundles/BundlesPanel.tsx`:
- Add `importance: number | null` to its `MemberView` (line 39) and to `GroupedMemberRow` (line 520).
- In `groupMembers`, set `importance` on every pushed row: element rows `m.importance`; a merged task row `Math.max(...ms.map(x => x.importance ?? -1))` mapped back to `null` when it is −1; a split task row `m.importance`. At the end, before returning, sort: `rows.sort((a, b) => (b.importance ?? -1) - (a.importance ?? -1));` (stable, so equal Importance keeps the existing order).
- In the queue row header, after the label: `{row.importance !== null && <span className="ml-2 text-xs text-slate-500">Importance {row.importance.toFixed(1)}</span>}`.
- Under the position heading `<h5>` for `related` and `fringe` only: `<p className="text-xs text-slate-500">Related and fringe items don't change career weights; reviewing them is optional.</p>`.

Update the fixtures in the existing panel tests that build `MemberView` objects (`queueDetail`, `divergedQueueDetail`, any others) to include `importance: null` so they type-check.

- [ ] **Step 4: Run to verify pass**

Run both Step 2 commands. Expected: PASS; the whole panel file passes.

- [ ] **Step 5: Red-proof** — remove the sort line; confirm the order assertion fails; revert.

- [ ] **Step 6: Commit**

```bash
git add lib/db/bundle-queries.ts app/admin/bundles/BundlesPanel.tsx app/admin/bundles/__tests__/BundlesPanel.test.tsx tests/db/p3-career-weights.test.ts
git commit -m "feat(admin): review queue lists items by O*NET Importance and marks related/fringe as optional for weights"
```

---

### Task 7: Verify, document, hand over the live steps

**Files:**
- Modify: `docs/STATE.md` (P3 weights entry under the catalog P2 bullet; "What's live" stays unchanged until the owner runs the live steps)

- [ ] **Step 1: Full verification**

Run: `env -u DATABASE_URL pnpm -s vitest run` → all pass; report the count. `npx tsc --noEmit -p .` → clean. `DATABASE_URL=$(scripts/migrations/p2-scratch-db.sh url) pnpm -s vitest run tests/db/p3-career-weights.test.ts` → 6 tests ran and passed.

- [ ] **Step 2: STATE.md** — add under the P2 entry: what was built (files), the rulings 1–5 one line each, "no migration", and the live steps below as **pending owner go-ahead**.

- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): P3 career weights built; live steps pending owner"
```

- [ ] **Step 4: Live steps (controller, only after the owner's explicit yes in that session)**
  1. Backup: `pg_dump -Fc -t career_target_requirements` of live to `~/.local/share/gc-curriculum-tool/p3/pre-weights-<UTC stamp>.dump`; verify with `pg_restore -l`.
  2. Merge to `dev`, deploy with the standard chain (SHA guard, `$SHA:main`, build, kickstart).
  3. Dry run on live: `recompute-career-weights.ts --expect-db gc_curriculum`; show the owner the report (few weights expected until core items are confirmed).
  4. `--apply` on the owner's yes.

---

## Self-review notes

- Spec §2 → Task 1 (+ Task 3 loading, Ruling 4); §3 → Task 2 (+ Task 3 capture filtering); §4 → Tasks 1, 3, 5 (Rulings 2, 5); §5 → Task 6; §6 defaults → Global Constraints; §7 tests → Tasks 1–3, 6.
- Review Focus items 1–5 are pinned in Tasks 1, 2, 3, 3, 3 respectively.
- Type names used across tasks: `WeightItem`, `Occupation`, `CaptureInput`, `WeightBasis`, `RecomputeReport`, `CareerWeightRow`, `Executor` — defined in Tasks 1–3 and used unchanged after.
