# P3 Membership From Weights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide which competencies a career target shows from pins, hides and importance weights (not from "any requirements row"). Add an importance slider to /program and importance bands to the wiki's target pages. Fold in the P3 final review's Important #1 and #2 and Minor #1.

**Architecture:** Migration 0062 adds a derived table `career_target_membership` and points the two existing views at it, so every current reader keeps working unchanged. A pure module holds the rule and the bands. One function, `rebuildMembership(tx)`, rewrites the table from faculty pins/hides and stored effective weights. Every writer that can change membership (recompute, pin, hide, remove, add, batch apply) runs under one Postgres advisory transaction lock and calls it inside its own transaction. The recompute now writes `onet`/`employer` weight rows for every pair; those rows are data, not membership.

**Tech Stack:** Next.js 15, TypeScript strict, Drizzle on Postgres 17, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-21-p3-membership-from-weights-design.md` (approved 2026-10-21: τ = 0.5, today's links become pins, manual targeted wiki refresh). It extends `docs/superpowers/specs/2026-10-21-p3-career-weights-design.md` and replaces Ruling 1 of `docs/superpowers/plans/2026-10-21-p3-career-weights.md`. Final review of that plan: `.superpowers/sdd/2026-10-21-p3-career-weights/final-review.md`.

Branch: `feat/p3-career-weights`, worktree `/Users/admin/projects/curriculum_developer-wt-p3w`. Continue on it.

## Global Constraints

- Cutoff τ = **0.5** (`MEMBERSHIP_CUTOFF`). Membership uses the **entry** horizon only.
- Bands (floors inclusive): **Very or extremely important ≥ 0.75; Important ≥ 0.5; Somewhat important ≥ 0.25**; below 0.25 is not listed. A pin with no weight is labeled **"Selected by faculty"**.
- A competency is a member when (pinned OR entry effective weight ≥ τ) AND NOT hidden. A hide always wins; a pin always shows.
- Pin = a `faculty` row with status `draft` or `confirmed`. Hide = a `faculty` row with status `hidden`. A `confirmed` faculty row with a weight stays the faculty override.
- Membership `display_order`: pinned rows keep their faculty `display_order`; weight-based rows follow (max pinned order + 1 + rank), highest weight first, ties by competency id.
- Every membership-changing write takes `pg_advisory_xact_lock(MEMBERSHIP_LOCK_KEY)` first and calls `rebuildMembership(tx)` before commit.
- The slider changes only what a viewer sees. It never writes.
- Wiki refresh after a membership change is manual and targeted (owner decision). The recompute report lists the pairs that entered, left or changed band.
- Test runs: unit and route tests `env -u DATABASE_URL pnpm -s vitest run <file>`; DB tests `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run <file>`. Never load `.env.local` against live. Never touch the live database in this plan.
- Hand-written migrations, one transaction, with a re-run guard, a verify script and a rollback script, as in `drizzle/0061_item_embeddings_onet_element.sql` and `scripts/migrations/2026-10-19-blind-*.sql`. psql: `/Applications/Postgres.app/Contents/Versions/17/bin/psql`.
- US spelling. Public copy in plain language. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm`.
- No AI calls anywhere in this plan.

## Review Focus

1. **A removal racing a recompute.** Faculty remove a competency from a target while a recompute is running. Expected: it stays removed (hide wins, and the lock serializes the writes). Test in Task 4.
2. **Re-adding a competency that was removed.** The faculty row is `hidden`; the add path must turn it back into a pin, not fail on the unique key. Test in Task 4.
3. **Existing readers see the same rows on an unchanged database.** After 0062, `target_sub_competencies` and `target_coverage` return exactly what they did before (characterization). Test in Task 1.
4. **A competency weighted 0.25–0.49 has no coverage cells under that target**, because scoring uses membership. The slider must show the row with empty cells, not crash or hide it. Test in Task 7.
5. **The target-batch planner must only see pins.** If it saw weight-based members, it would report them as "not desired" removals on every run. Test in Task 4.

---

## File Structure

- Create `drizzle/0062_career_target_membership.sql`: status check gains `hidden`; new table; population from today's rows; views redefined.
- Create `scripts/migrations/2026-10-21-membership-verify.sql` and `scripts/migrations/2026-10-21-membership-rollback.sql`.
- Modify `lib/db/schema.ts`: `careerTargetMembership` table; status type adds `'hidden'`.
- Create `lib/catalog/membership.ts` (pure): constants, `bandOf`, `BAND_LABELS`, `decideMembership`.
- Create `lib/db/membership-queries.ts`: `lockMembership`, `rebuildMembership`, `readTargetCompetencyList`, `setPin`, `setHide`, `clearFacultyRow`.
- Modify `lib/db/career-weight-queries.ts`: weights for all pairs (batched), lock, rebuild, report changes.
- Modify `lib/db/competency-catalog-queries.ts`: removal becomes hide; add becomes upsert pin; membership reads from the table; batch reads pins only.
- Modify routes: `app/api/admin/bundles/[id]/blind/route.ts`, `.../reset-blind/route.ts`, `app/api/targets/[id]/sub-competencies/route.ts`, `.../[scId]/retire/route.ts` (recompute triggers).
- Create `app/api/admin/membership/route.ts`, `app/admin/membership/page.tsx`, `app/admin/membership/MembershipPanel.tsx`.
- Modify `lib/db/program-coverage-queries.ts` (`getMatrixData` adds weights and `belowCutoff`) and `app/program/ProgramCoverageClient.tsx` (slider).
- Modify `lib/ai/wiki/update.ts` (`loadTargetSubstrate` lists by band) and `lib/ai/prompts/wiki-update.md` (target page section 3).
- Modify `docs/STATE.md`.

---

### Task 1: Migration 0062, schema, verify and rollback

**Files:**
- Create: `drizzle/0062_career_target_membership.sql`
- Create: `scripts/migrations/2026-10-21-membership-verify.sql`
- Create: `scripts/migrations/2026-10-21-membership-rollback.sql`
- Modify: `lib/db/schema.ts` (around `careerTargetRequirements`, lines 866-894, and the two views near line 950)
- Test: `tests/db/p3-membership-migration.test.ts`

**Interfaces:**
- Produces: table `career_target_membership(career_target_id text, competency_id text, basis text 'pinned'|'weight', effective_weight real null, display_order int, updated_at timestamptz)`, primary key `(career_target_id, competency_id)`. Drizzle export `careerTargetMembership`. `careerTargetRequirements.status` type `'draft' | 'confirmed' | 'hidden'`.

- [ ] **Step 1: Capture the before-state of the views on scratch**

```bash
PSQL=/Applications/Postgres.app/Contents/Versions/17/bin/psql
S=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch
$PSQL "$S" -X -At -c "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM target_sub_competencies t" > .superpowers/sdd/2026-10-21-p3-membership-from-weights/views-before.txt
$PSQL "$S" -X -At -c "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM target_coverage t" >> .superpowers/sdd/2026-10-21-p3-membership-from-weights/views-before.txt
$PSQL "$S" -X -At -c "SELECT count(*) FROM career_target_requirements WHERE weight_source <> 'faculty'"
```

Expected: two md5 lines written; the last count is 0 (scratch has no P3 weight rows). If it is not 0, stop and record a ruling: the characterization needs a pre-P3 copy.

- [ ] **Step 2: Write the failing migration test**

```ts
// tests/db/p3-membership-migration.test.ts
/** 0062 shape on the scratch DB (applied in Step 4). Scratch only. */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { isP2ScratchDb } from './p2/scratch-guard';

describe.skipIf(!isP2ScratchDb())('migration 0062 (scratch)', () => {
  it('creates career_target_membership with one pinned row per existing pair', async () => {
    const r = (await db.execute(sql`
      SELECT (SELECT count(*) FROM career_target_membership)::int AS m,
             (SELECT count(*) FROM (SELECT DISTINCT career_target_id, competency_id FROM career_target_requirements) p)::int AS p,
             (SELECT count(*) FROM career_target_membership WHERE basis <> 'pinned')::int AS nonpinned`)).rows[0] as { m: number; p: number; nonpinned: number };
    expect(r.m).toBe(r.p);
    expect(r.nonpinned).toBe(0);
  });

  it('allows status hidden', async () => {
    const def = (await db.execute(sql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'career_target_requirements_status_check'`)).rows[0] as { d: string };
    expect(def.d).toContain('hidden');
  });

  it('the views read the membership table', async () => {
    const v = (await db.execute(sql`SELECT pg_get_viewdef('target_sub_competencies'::regclass) AS a, pg_get_viewdef('target_coverage'::regclass) AS b`)).rows[0] as { a: string; b: string };
    expect(v.a).toContain('career_target_membership');
    expect(v.b).toContain('career_target_membership');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/p3-membership-migration.test.ts`
Expected: FAIL with `relation "career_target_membership" does not exist`.

- [ ] **Step 4: Write the migration and apply it to scratch**

```sql
-- 0062_career_target_membership.sql — which competencies a career target shows, decided by
-- pins, hides and importance weight (spec 2026-10-21-p3-membership-from-weights-design.md).
-- Membership is no longer "any career_target_requirements row": it is the derived table
-- career_target_membership, rewritten by rebuildMembership() (lib/db/membership-queries.ts).
-- Today's rows are all faculty links, so every existing pair becomes a pin (owner decision 2).
-- Live order: backup -> apply (this file) -> verify -> deploy the build.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF to_regclass('public.career_target_requirements') IS NULL THEN
    RAISE EXCEPTION '0062: precondition — 0056 is not applied';
  END IF;
  IF to_regclass('public.career_target_membership') IS NOT NULL THEN
    RAISE EXCEPTION '0062: already applied';
  END IF;
END $$;

ALTER TABLE career_target_requirements DROP CONSTRAINT career_target_requirements_status_check;
ALTER TABLE career_target_requirements ADD CONSTRAINT career_target_requirements_status_check
  CHECK (status IN ('draft', 'confirmed', 'hidden'));

CREATE TABLE career_target_membership (
  career_target_id text NOT NULL REFERENCES career_targets(id) ON DELETE CASCADE,
  competency_id text NOT NULL REFERENCES sub_competencies(id) ON DELETE CASCADE,
  basis text NOT NULL CHECK (basis IN ('pinned', 'weight')),
  effective_weight real CHECK (effective_weight IS NULL OR (effective_weight >= 0 AND effective_weight <= 1)),
  display_order integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (career_target_id, competency_id)
);
CREATE INDEX idx_career_target_membership_competency ON career_target_membership (competency_id);

INSERT INTO career_target_membership (career_target_id, competency_id, basis, effective_weight, display_order)
SELECT career_target_id, competency_id, 'pinned', NULL, min(display_order)
FROM career_target_requirements GROUP BY career_target_id, competency_id;

CREATE OR REPLACE VIEW target_sub_competencies AS
SELECT m.career_target_id,
       s.id,
       s.name,
       s.know_descriptor,
       s.understand_descriptor,
       s.do_descriptor,
       m.display_order,
       s.retired,
       s.updated_at
FROM career_target_membership m
JOIN sub_competencies s ON s.id = m.competency_id;

CREATE OR REPLACE VIEW target_coverage AS
SELECT c.snapshot_id,
       m.career_target_id,
       c.competency_id AS sub_competency_id,
       c.k_depth,
       c.u_depth,
       c.d_depth,
       c.matched_competency,
       c.evidence_excerpt,
       c.confidence,
       c.rationale,
       c.model,
       c.generated_at
FROM snapshot_competency_coverage c
JOIN career_target_membership m ON m.competency_id = c.competency_id;
COMMIT;
```

Before writing the views, open `drizzle/0056_competency_catalog_p0a.sql:174-203` and copy the column list and types exactly: `CREATE OR REPLACE VIEW` fails if a column's name, order or type changes. `display_order` in the old view is `min(integer)`, which is `integer`, so the new `m.display_order integer` matches.

Apply to scratch only:

```bash
/Applications/Postgres.app/Contents/Versions/17/bin/psql postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch -X -q -v ON_ERROR_STOP=1 -f drizzle/0062_career_target_membership.sql
```

Expected: no output, exit 0.

- [ ] **Step 5: Verify the views are unchanged**

```bash
PSQL=/Applications/Postgres.app/Contents/Versions/17/bin/psql
S=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch
diff <($PSQL "$S" -X -At -c "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM target_sub_competencies t"; $PSQL "$S" -X -At -c "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM target_coverage t") .superpowers/sdd/2026-10-21-p3-membership-from-weights/views-before.txt && echo SAME
```

Expected: `SAME`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/p3-membership-migration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Verify and rollback scripts**

`scripts/migrations/2026-10-21-membership-verify.sql`, in the same style as `2026-10-19-blind-verify.sql` (`\set ON_ERROR_STOP on`, `BEGIN READ ONLY`, printed rows, then a `DO` block that RAISEs):
- the table exists; the status check contains `hidden`;
- `count(career_target_membership)` = `count(DISTINCT (career_target_id, competency_id))` of requirements **when no `onet`/`employer` rows exist yet** (print both; RAISE only if weight rows are 0 and the counts differ);
- both view definitions contain `career_target_membership`.

`scripts/migrations/2026-10-21-membership-rollback.sql`: one transaction; RAISE if any requirements row has status `hidden` ("rollback refused: hidden rows exist; clear them first"); restore both views exactly as in 0056 lines 174-203; `DROP TABLE career_target_membership`; restore the check to `('draft', 'confirmed')`. Rollback does not delete `onet`/`employer` rows: under the old views they would become memberships, so it also RAISEs if any row has `weight_source <> 'faculty'` ("rollback refused: weight rows exist; run the P3 rollback note in STATE first").

Run verify on scratch:

```bash
/Applications/Postgres.app/Contents/Versions/17/bin/psql postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch -X -q -f scripts/migrations/2026-10-21-membership-verify.sql
```

Expected: rows print, no exception.

- [ ] **Step 8: Schema**

In `lib/db/schema.ts`, change the requirements `status` line and check to:

```ts
  status: text('status').$type<'draft' | 'confirmed' | 'hidden'>().notNull().default('draft'),
```
```ts
  check('career_target_requirements_status_check', sql`${t.status} IN ('draft', 'confirmed', 'hidden')`),
```

Add after `careerTargetRequirements`:

```ts
/**
 * Which competencies a career target shows (migration 0062; spec
 * 2026-10-21-p3-membership-from-weights-design.md). Derived: rewritten by
 * rebuildMembership() from faculty pins/hides and entry effective weights.
 * The views target_sub_competencies and target_coverage read it.
 */
export const careerTargetMembership = pgTable('career_target_membership', {
  careerTargetId: text('career_target_id').notNull(),
  competencyId: text('competency_id').notNull(),
  basis: text('basis').$type<'pinned' | 'weight'>().notNull(),
  effectiveWeight: real('effective_weight'),
  displayOrder: integer('display_order').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ name: 'career_target_membership_pkey', columns: [t.careerTargetId, t.competencyId] }),
  foreignKey({ name: 'career_target_membership_career_target_id_fkey', columns: [t.careerTargetId], foreignColumns: [careerTargets.id] }).onDelete('cascade'),
  foreignKey({ name: 'career_target_membership_competency_id_fkey', columns: [t.competencyId], foreignColumns: [subCompetencies.id] }).onDelete('cascade'),
  index('idx_career_target_membership_competency').on(t.competencyId),
  check('career_target_membership_basis_check', sql`${t.basis} IN ('pinned', 'weight')`),
]);
```

Import `primaryKey` from `drizzle-orm/pg-core` if it is not already imported. Run `pnpm -s tsc --noEmit`. Expected: clean. If a reader narrows on `status === 'draft' | 'confirmed'` and now fails to type-check, fix it to treat `hidden` as "not a pin" and ledger a ruling.

- [ ] **Step 9: Commit**

```bash
git add drizzle/0062_career_target_membership.sql scripts/migrations/2026-10-21-membership-*.sql lib/db/schema.ts tests/db/p3-membership-migration.test.ts
git commit -m "feat(catalog): migration 0062 — career_target_membership; views read it; status gains hidden"
```

---

### Task 2: The rule and the bands (pure)

**Files:**
- Create: `lib/catalog/membership.ts`
- Test: `lib/catalog/__tests__/membership.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MEMBERSHIP_CUTOFF = 0.5`, `LIST_FLOOR = 0.25`, `MEMBERSHIP_LOCK_KEY = 2026102101`
  - `type Band = 'very' | 'important' | 'somewhat'`
  - `BAND_LABELS: Record<Band, string>` and `PINNED_LABEL = 'Selected by faculty'`
  - `bandOf(weight: number | null): Band | null`
  - `interface PairState { careerTargetId: string; competencyId: string; pinned: boolean; hidden: boolean; pinOrder: number | null; weight: number | null }`
  - `interface MembershipRow { careerTargetId: string; competencyId: string; basis: 'pinned' | 'weight'; effectiveWeight: number | null; displayOrder: number }`
  - `decideMembership(pairs: PairState[], cutoff?: number): MembershipRow[]`

- [ ] **Step 1: Write the failing test**

```ts
// lib/catalog/__tests__/membership.test.ts
import { describe, it, expect } from 'vitest';
import { bandOf, decideMembership, MEMBERSHIP_CUTOFF, type PairState } from '@/lib/catalog/membership';

const p = (c: string, o: Partial<PairState>): PairState => ({ careerTargetId: 't', competencyId: c, pinned: false, hidden: false, pinOrder: null, weight: null, ...o });

describe('bandOf', () => {
  it('uses inclusive floors 0.75 / 0.5 / 0.25', () => {
    expect(bandOf(1)).toBe('very');
    expect(bandOf(0.75)).toBe('very');
    expect(bandOf(0.7499)).toBe('important');
    expect(bandOf(0.5)).toBe('important');
    expect(bandOf(0.4999)).toBe('somewhat');
    expect(bandOf(0.25)).toBe('somewhat');
    expect(bandOf(0.2499)).toBeNull();
    expect(bandOf(null)).toBeNull();
  });
});

describe('decideMembership', () => {
  it('cutoff is 0.5', () => expect(MEMBERSHIP_CUTOFF).toBe(0.5));

  it('pinned below the cutoff shows; hidden above it does not; weight at the cutoff shows; below and null do not', () => {
    const rows = decideMembership([
      p('pin-low', { pinned: true, pinOrder: 3, weight: 0.1 }),
      p('hid-high', { hidden: true, weight: 0.9 }),
      p('at', { weight: 0.5 }),
      p('below', { weight: 0.4999 }),
      p('none', {}),
    ]);
    expect(rows.map(r => r.competencyId).sort()).toEqual(['at', 'pin-low']);
  });

  it('a hide wins over a pin', () => {
    expect(decideMembership([p('x', { pinned: true, hidden: true, pinOrder: 0, weight: 1 })])).toEqual([]);
  });

  it('pins keep their order; weight-based rows follow by weight, then id', () => {
    const rows = decideMembership([
      p('w-b', { weight: 0.6 }),
      p('w-a', { weight: 0.6 }),
      p('w-top', { weight: 0.9 }),
      p('pin', { pinned: true, pinOrder: 7, weight: null }),
    ]);
    expect(rows.map(r => [r.competencyId, r.basis, r.displayOrder])).toEqual([
      ['pin', 'pinned', 7],
      ['w-top', 'weight', 8],
      ['w-a', 'weight', 9],
      ['w-b', 'weight', 10],
    ]);
  });

  it('orders each target separately and keeps effective weight', () => {
    const rows = decideMembership([
      { ...p('a', { weight: 0.8 }), careerTargetId: 't1' },
      { ...p('a', { weight: 0.55 }), careerTargetId: 't2' },
    ]);
    expect(rows).toEqual([
      { careerTargetId: 't1', competencyId: 'a', basis: 'weight', effectiveWeight: 0.8, displayOrder: 0 },
      { careerTargetId: 't2', competencyId: 'a', basis: 'weight', effectiveWeight: 0.55, displayOrder: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `env -u DATABASE_URL pnpm -s vitest run lib/catalog/__tests__/membership.test.ts`
Expected: FAIL, cannot resolve `@/lib/catalog/membership`.

- [ ] **Step 3: Implement**

```ts
// lib/catalog/membership.ts
/**
 * Which competencies a career target shows (spec
 * docs/superpowers/specs/2026-10-21-p3-membership-from-weights-design.md).
 * Pure: no DB. Member = (pinned OR entry effective weight >= cutoff) AND NOT hidden.
 * Bands label weights in O*NET wording; their floors match the cutoff and the
 * /program slider stops.
 */
export const MEMBERSHIP_CUTOFF = 0.5;
export const LIST_FLOOR = 0.25;
/** pg_advisory_xact_lock key shared by every membership-changing write. */
export const MEMBERSHIP_LOCK_KEY = 2026102101;

export type Band = 'very' | 'important' | 'somewhat';
export const BAND_FLOORS: Record<Band, number> = { very: 0.75, important: 0.5, somewhat: 0.25 };
export const BAND_LABELS: Record<Band, string> = {
  very: 'Very or extremely important',
  important: 'Important',
  somewhat: 'Somewhat important',
};
export const PINNED_LABEL = 'Selected by faculty';

export function bandOf(weight: number | null): Band | null {
  if (weight === null) return null;
  if (weight >= BAND_FLOORS.very) return 'very';
  if (weight >= BAND_FLOORS.important) return 'important';
  if (weight >= BAND_FLOORS.somewhat) return 'somewhat';
  return null;
}

export interface PairState { careerTargetId: string; competencyId: string; pinned: boolean; hidden: boolean; pinOrder: number | null; weight: number | null }
export interface MembershipRow { careerTargetId: string; competencyId: string; basis: 'pinned' | 'weight'; effectiveWeight: number | null; displayOrder: number }

export function decideMembership(pairs: PairState[], cutoff: number = MEMBERSHIP_CUTOFF): MembershipRow[] {
  const byTarget = new Map<string, PairState[]>();
  for (const s of pairs) {
    const a = byTarget.get(s.careerTargetId);
    if (a) a.push(s); else byTarget.set(s.careerTargetId, [s]);
  }
  const out: MembershipRow[] = [];
  for (const t of [...byTarget.keys()].sort()) {
    const ps = byTarget.get(t)!.filter(s => !s.hidden);
    const pins = ps.filter(s => s.pinned).sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0) || a.competencyId.localeCompare(b.competencyId));
    const weighted = ps.filter(s => !s.pinned && s.weight !== null && s.weight >= cutoff)
      .sort((a, b) => b.weight! - a.weight! || a.competencyId.localeCompare(b.competencyId));
    let next = pins.length ? Math.max(...pins.map(s => s.pinOrder ?? 0)) + 1 : 0;
    for (const s of pins) out.push({ careerTargetId: t, competencyId: s.competencyId, basis: 'pinned', effectiveWeight: s.weight, displayOrder: s.pinOrder ?? 0 });
    for (const s of weighted) out.push({ careerTargetId: t, competencyId: s.competencyId, basis: 'weight', effectiveWeight: s.weight, displayOrder: next++ });
  }
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `env -u DATABASE_URL pnpm -s vitest run lib/catalog/__tests__/membership.test.ts`
Expected: PASS (6 tests). Red-proof: change `>= cutoff` to `> cutoff`, see "at" disappear and the test fail, restore, `git diff --stat` shows only the new files.

- [ ] **Step 5: Commit**

```bash
git add lib/catalog/membership.ts lib/catalog/__tests__/membership.test.ts
git commit -m "feat(catalog): pure membership rule and importance bands"
```

---

### Task 3: Recompute writes weights for every pair, then rebuilds membership under the lock

**Files:**
- Create: `lib/db/membership-queries.ts`
- Modify: `lib/db/career-weight-queries.ts`
- Modify: `scripts/catalog/recompute-career-weights.ts` (`formatReport`)
- Test: `tests/db/p3-career-weights.test.ts` (update the first test; add new ones)
- Test: `tests/catalog/recompute-career-weights.test.ts` (report formatting)

**Interfaces:**
- Consumes: `decideMembership`, `bandOf`, `MEMBERSHIP_LOCK_KEY`, `LIST_FLOOR` (Task 2); `effectiveWeight` (`lib/catalog/career-weights.ts`); `careerTargetMembership` (Task 1).
- Produces (`lib/db/membership-queries.ts`):
  - `lockMembership(ex: Executor): Promise<void>` — `SELECT pg_advisory_xact_lock(${MEMBERSHIP_LOCK_KEY})`
  - `readPairStates(ex: Executor): Promise<PairState[]>` — every (target, active competency) pair with entry effective weight, pin and hide flags
  - `rebuildMembership(ex: Executor): Promise<MembershipChange[]>` — rewrites the table; returns what changed
  - `type MembershipChange = { careerTargetId: string; competencyId: string; change: 'entered' | 'left' | 'band'; from: string | null; to: string | null }`
- Produces (`career-weight-queries.ts`): `RecomputeReport` gains `membershipChanges: MembershipChange[]`; `nonMemberCandidates` is removed (no longer meaningful).

- [ ] **Step 1: Write the failing DB tests**

In `tests/db/p3-career-weights.test.ts`, replace the first test's two assertions about `p3w-c2` with the new behavior, and add three tests:

```ts
  it('writes onet rows for non-member pairs too, without making them members below the cutoff', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      // c2: core element 9.Z.2 (IM 2 in A, none in B) → onet = 0.75 × 0.25 = 0.1875, below the cutoff.
      await addMember(tx, 'p3w-c2', '9.Z.2', 'core', 'confirmed');
      await recomputeCareerWeights(tx, { apply: true });
      const c2 = await rowsFor(tx, 'p3w-c2');
      expect(c2.find(r => r.weightSource === 'onet' && r.horizon === 'entry')!.weight).toBeCloseTo(0.1875);
      const m = (await tx.execute(sql`SELECT competency_id FROM career_target_membership WHERE career_target_id = ${T} ORDER BY 1`)).rows;
      expect(m).toEqual([{ competency_id: 'p3w-c1' }]); // c1 is pinned (faculty row); c2 is below 0.5
    });
  });

  it('a non-pinned competency at or above the cutoff becomes a weight-based member', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await addMember(tx, 'p3w-c2', '9.Z.1', 'core', 'confirmed'); // onet entry = 0.875
      const report = await recomputeCareerWeights(tx, { apply: true });
      const m = (await tx.execute(sql`SELECT competency_id, basis, display_order FROM career_target_membership WHERE career_target_id = ${T} ORDER BY display_order`)).rows;
      expect(m).toEqual([{ competency_id: 'p3w-c1', basis: 'pinned', display_order: 1 }, { competency_id: 'p3w-c2', basis: 'weight', display_order: 2 }]);
      expect(report.membershipChanges).toContainEqual({ careerTargetId: T, competencyId: 'p3w-c2', change: 'entered', from: null, to: 'very' });
    });
  });

  it('a hidden faculty row keeps a high-weight competency out', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await addMember(tx, 'p3w-c2', '9.Z.1', 'core', 'confirmed');
      await tx.execute(sql`INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, status, display_order) VALUES (${T}, 'p3w-c2', 'entry', 'faculty', 'hidden', 0)`);
      await recomputeCareerWeights(tx, { apply: true });
      const m = (await tx.execute(sql`SELECT competency_id FROM career_target_membership WHERE career_target_id = ${T} ORDER BY 1`)).rows;
      expect(m).toEqual([{ competency_id: 'p3w-c1' }]);
    });
  });

  it('a dry run writes neither weights nor membership', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await addMember(tx, 'p3w-c2', '9.Z.1', 'core', 'confirmed');
      const before = (await tx.execute(sql`SELECT count(*)::int AS n FROM career_target_membership`)).rows[0];
      const report = await recomputeCareerWeights(tx, { apply: false });
      expect(report.membershipChanges.some(c => c.competencyId === 'p3w-c2')).toBe(true);
      expect((await tx.execute(sql`SELECT count(*)::int AS n FROM career_target_membership`)).rows[0]).toEqual(before);
    });
  });
```

The `seed()` faculty row for c1 must also get a membership row, because 0062 populated the table only from pre-existing rows. Add at the end of `seed()`:

```ts
  await tx.execute(sql`INSERT INTO career_target_membership (career_target_id, competency_id, basis, effective_weight, display_order) VALUES (${T}, 'p3w-c1', 'pinned', NULL, 1)`);
```

Concurrency (Review Focus 1 belongs to Task 4; the lock itself is tested here). Add to a new file `tests/db/p3-membership-lock.test.ts`, which commits and cleans up because two connections are needed:

```ts
/** Two recomputes serialize on the advisory lock. Scratch only; commits and cleans up its own lock probe. */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { lockMembership } from '@/lib/db/membership-queries';
import { isP2ScratchDb } from './p2/scratch-guard';

describe.skipIf(!isP2ScratchDb())('membership lock (scratch)', () => {
  it('a second holder waits until the first commits', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const first = db.transaction(async (tx) => { await lockMembership(tx); order.push('first-locked'); await gate; order.push('first-done'); });
    await new Promise(r => setTimeout(r, 100));
    const second = db.transaction(async (tx) => { await lockMembership(tx); order.push('second-locked'); });
    await new Promise(r => setTimeout(r, 200));
    expect(order).toEqual(['first-locked']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-locked', 'first-done', 'second-locked']);
    void sql;
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/p3-career-weights.test.ts tests/db/p3-membership-lock.test.ts`
Expected: FAIL. The lock test fails to import `@/lib/db/membership-queries`; the weights tests fail because no `onet` row exists for `p3w-c2` and `membershipChanges` is undefined.

- [ ] **Step 3: Implement `lib/db/membership-queries.ts`**

```ts
/**
 * Membership from weights (spec 2026-10-21-p3-membership-from-weights-design.md).
 * rebuildMembership rewrites career_target_membership from faculty pins/hides
 * and entry effective weights. Every caller holds lockMembership(tx) first and
 * runs in the same transaction as its own write.
 */
import { sql } from 'drizzle-orm';
import { careerTargetMembership } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/bundle-queries';
import { effectiveWeight } from '@/lib/catalog/career-weights';
import { decideMembership, bandOf, MEMBERSHIP_LOCK_KEY, type PairState } from '@/lib/catalog/membership';

export type MembershipChange = { careerTargetId: string; competencyId: string; change: 'entered' | 'left' | 'band'; from: string | null; to: string | null };

export async function lockMembership(ex: Executor): Promise<void> {
  await ex.execute(sql`SELECT pg_advisory_xact_lock(${MEMBERSHIP_LOCK_KEY})`);
}

type ReqRow = { t: string; c: string; source: 'onet' | 'employer' | 'faculty'; weight: number | null; status: 'draft' | 'confirmed' | 'hidden'; order: number; n: number };

/** Every (target, active competency) pair that has an entry row of any source. */
export async function readPairStates(ex: Executor): Promise<PairState[]> {
  const rows = (await ex.execute(sql`
    SELECT r.career_target_id AS t, r.competency_id AS c, r.weight_source AS source, r.weight, r.status,
           r.display_order AS "order", jsonb_array_length(r.contributing_position_ids) AS n
    FROM career_target_requirements r JOIN sub_competencies s ON s.id = r.competency_id
    WHERE r.horizon = 'entry' AND NOT s.retired
    ORDER BY 1, 2`)).rows as ReqRow[];
  const by = new Map<string, ReqRow[]>();
  for (const r of rows) {
    const k = `${r.t}|${r.c}`;
    const a = by.get(k);
    if (a) a.push(r); else by.set(k, [r]);
  }
  const out: PairState[] = [];
  for (const rs of by.values()) {
    const onet = rs.find(r => r.source === 'onet');
    const emp = rs.find(r => r.source === 'employer');
    const fac = rs.find(r => r.source === 'faculty');
    const e = effectiveWeight({
      onet: onet?.weight ?? null,
      employer: emp?.weight ?? null,
      n: Number(emp?.n ?? 0),
      facultyOverride: fac && fac.status === 'confirmed' && fac.weight !== null ? fac.weight : null,
      facultyDraft: fac && fac.status === 'draft' ? fac.weight : null,
    });
    out.push({
      careerTargetId: rs[0]!.t,
      competencyId: rs[0]!.c,
      pinned: fac !== undefined && fac.status !== 'hidden',
      hidden: fac?.status === 'hidden',
      pinOrder: fac && fac.status !== 'hidden' ? fac.order : null,
      weight: e.weight,
    });
  }
  return out;
}

/** Caller holds lockMembership. With apply false, computes the changes and writes nothing. */
export async function rebuildMembership(ex: Executor, opts: { apply: boolean } = { apply: true }): Promise<MembershipChange[]> {
  const states = await readPairStates(ex);
  const next = decideMembership(states);
  const prev = (await ex.execute(sql`SELECT career_target_id AS t, competency_id AS c, effective_weight AS w FROM career_target_membership`)).rows as Array<{ t: string; c: string; w: number | null }>;
  const prevBy = new Map(prev.map(r => [`${r.t}|${r.c}`, r.w === null ? null : Number(r.w)]));
  const nextBy = new Map(next.map(r => [`${r.careerTargetId}|${r.competencyId}`, r.effectiveWeight]));
  const changes: MembershipChange[] = [];
  for (const [k, w] of nextBy) {
    const [t, c] = k.split('|') as [string, string];
    if (!prevBy.has(k)) changes.push({ careerTargetId: t, competencyId: c, change: 'entered', from: null, to: bandOf(w) ?? 'pinned' });
    else if (bandOf(prevBy.get(k)!) !== bandOf(w)) changes.push({ careerTargetId: t, competencyId: c, change: 'band', from: bandOf(prevBy.get(k)!), to: bandOf(w) });
  }
  for (const [k, w] of prevBy) {
    if (nextBy.has(k)) continue;
    const [t, c] = k.split('|') as [string, string];
    changes.push({ careerTargetId: t, competencyId: c, change: 'left', from: bandOf(w) ?? 'pinned', to: null });
  }
  // Band changes of pairs that are not members before or after are reported by the
  // recompute from its own before/after weights (career-weight-queries.ts).
  if (opts.apply) {
    await ex.delete(careerTargetMembership);
    if (next.length) {
      await ex.insert(careerTargetMembership).values(next.map(r => ({
        careerTargetId: r.careerTargetId, competencyId: r.competencyId, basis: r.basis,
        effectiveWeight: r.effectiveWeight, displayOrder: r.displayOrder, updatedAt: new Date(),
      })));
    }
  }
  return changes.sort((a, b) => a.careerTargetId.localeCompare(b.careerTargetId) || a.competencyId.localeCompare(b.competencyId));
}
```

- [ ] **Step 4: Change `recomputeCareerWeights`**

In `lib/db/career-weight-queries.ts`:

1. Update the header comment: weights are written for **every** pair of an active competency and a target with occupations (spec addendum §3); membership is rebuilt from them by `rebuildMembership`.
2. At the top of `recomputeCareerWeights`, when `opts.apply`, call `await lockMembership(ex)` **before** `loadInputs` (fixes final review Important #1 and Minor #1: inputs are read after any earlier writer commits).
3. Replace the per-member loops with a loop over `allCompetencies` for every target in `targets`. Compute `onet` per horizon and `employer` for entry exactly as now. Collect rows into two arrays instead of writing one at a time:
   - `upserts: Array<{ t; c; h; source; weight; contributing; note }>` for `onet` rows with a non-null weight and `employer` rows with any rater or namer;
   - every other (t, c, h, source) is a delete.
4. Write in bulk when `opts.apply` (final review Minor #7):

```ts
for (let i = 0; i < upserts.length; i += 500) {
  await ex.insert(careerTargetRequirements).values(upserts.slice(i, i + 500).map(v => ({
    careerTargetId: v.t, competencyId: v.c, horizon: v.h, weightSource: v.source, weight: v.weight,
    status: 'draft' as const, displayOrder: 0, contributingPositionIds: v.contributing, note: v.note,
  }))).onConflictDoUpdate({
    target: [careerTargetRequirements.careerTargetId, careerTargetRequirements.competencyId, careerTargetRequirements.horizon, careerTargetRequirements.weightSource],
    set: { weight: sql`excluded.weight`, contributingPositionIds: sql`excluded.contributing_position_ids`, note: sql`excluded.note`, updatedAt: sql`now()` },
  });
}
const keep = upserts.map(v => `${v.t}|${v.c}|${v.h}|${v.source}`);
const del = await ex.execute(sql`
  DELETE FROM career_target_requirements
  WHERE weight_source IN ('onet', 'employer')
    AND (career_target_id || '|' || competency_id || '|' || horizon || '|' || weight_source) <> ALL(${keep}::text[])
  RETURNING weight_source`);
```

   Count `onetDeleted` / `employerDeleted` from `del.rows`. Derived rows get `display_order = 0`: their order is never read for membership (the table owns it). `readCareerWeights` must stop using `Math.min(...displayOrder)`; use the faculty row's order if present, else the membership table's, else `Number.MAX_SAFE_INTEGER`, and sort by that.
5. Weight-band changes for pairs that are not members before or after: compute `before` with `readPairStates(ex)` at the start (after the lock) and `after` at the end; add `{ change: 'band', from, to }` for any pair whose `bandOf` differs and that `rebuildMembership` did not already report. Then `report.membershipChanges = [...fromRebuild, ...belowCutoff]`, sorted. For a dry run (`apply: false`), compute `after` from the in-memory weights: build `PairState[]` from `before` with the new `onet`/`employer` values substituted, and call `decideMembership` directly; do not write.
6. Call `report.membershipChanges = await rebuildMembership(ex, { apply: opts.apply })` after the weight writes (apply) — for the dry run, use step 5's in-memory path.
7. Delete `nonMemberCandidates` from the type, the code and `formatReport`. Update `byTarget` to report, per target and horizon, `withOnet` and min/median/max over **all** competencies with a weight, plus `members` from the membership table (entry horizon only).
8. `recomputeCareerWeightsSafely` is unchanged apart from its doc comment.

In `scripts/catalog/recompute-career-weights.ts`, replace the `nonMemberCandidates` block in `formatReport` with:

```ts
  if (r.membershipChanges.length > 0) {
    out.push('Membership and band changes (refresh these wiki target pages by hand):');
    for (const c of r.membershipChanges) out.push(`  ${c.careerTargetId}: ${c.competencyId} ${c.change} (${c.from ?? '-'} -> ${c.to ?? '-'})`);
  }
```

Also fix final review Minor #5 while editing this file, since the lock now makes the executor matter: run `executor.transaction(...)` instead of `db.transaction(...)`. Type `Executor` may not expose `.transaction` on a `Tx`; if it does not, narrow `deps.executor` to `typeof db` and ledger a ruling.

Update `tests/catalog/recompute-career-weights.test.ts` for the new `formatReport` output (replace the `nonMemberCandidates` expectation with a `membershipChanges` one: one change prints `  t1: c1 entered (- -> very)`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/p3-career-weights.test.ts tests/db/p3-membership-lock.test.ts tests/db/p3-membership-migration.test.ts && env -u DATABASE_URL pnpm -s vitest run tests/catalog/recompute-career-weights.test.ts lib/catalog/__tests__`
Expected: PASS. Red-proof the lock test: comment out the `pg_advisory_xact_lock` call, see `order` become `['first-locked', 'second-locked']` and fail, restore, `cmp` the file against `git show HEAD:` is not possible for a new file, so check `git diff` shows the line restored.

- [ ] **Step 6: Commit**

```bash
git add lib/db/membership-queries.ts lib/db/career-weight-queries.ts scripts/catalog/recompute-career-weights.ts tests/db/p3-career-weights.test.ts tests/db/p3-membership-lock.test.ts tests/catalog/recompute-career-weights.test.ts
git commit -m "feat(catalog): recompute weights for every pair; rebuild membership under an advisory lock"
```

---

### Task 4: Writers — remove becomes hide, add becomes pin, batch sees pins only

**Files:**
- Modify: `lib/db/competency-catalog-queries.ts`
- Modify: `lib/db/membership-queries.ts` (add `setPin`, `setHide`, `clearFacultyRow`)
- Test: `tests/db/p3-membership-writers.test.ts`

**Interfaces:**
- Consumes: `lockMembership`, `rebuildMembership` (Task 3).
- Produces (`membership-queries.ts`):
  - `setPin(tx: Executor, targetId: string, competencyId: string, displayOrder: number): Promise<void>` — upsert the entry faculty row to status `draft` (keeps an existing weight and a `confirmed` status)
  - `setHide(tx: Executor, targetId: string, competencyId: string): Promise<void>` — delete faculty rows of other horizons; upsert the entry faculty row to `status 'hidden'`, `weight null`
  - `clearFacultyRow(tx: Executor, targetId: string, competencyId: string): Promise<void>` — delete every faculty row of the pair (back to weight-only)
  - None of the three locks or rebuilds; callers do both.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/db/p3-membership-writers.test.ts
/** Membership writers under the addendum. Scratch only, rolled back. */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { retireCompetencyFromTarget, readCatalogState, catalogBatchWriter, nextDisplayOrderForTarget, targetIdsForCompetency } from '@/lib/db/competency-catalog-queries';
import { recomputeCareerWeights, type Executor } from '@/lib/db/career-weight-queries';
import { isP2ScratchDb } from './p2/scratch-guard';

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Executor) => Promise<void>): Promise<void> {
  try { await db.transaction(async (tx) => { await fn(tx); throw new Rollback('rollback'); }); }
  catch (err) { if (err instanceof Rollback) return; throw err; }
}
const T = 'p3m-target';
async function seed(tx: Executor) {
  await tx.execute(sql`INSERT INTO career_targets (id, name, short_definition, industry_contexts, know_descriptors, understand_descriptors, do_descriptors, defensibility_note, display_order)
    VALUES (${T}, 'P3M', 'd', '[]', '[]', '[]', '[]', 'n', 998)`);
  await tx.execute(sql`INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, origin) VALUES ('p3m-a', 'A', 'k', 'u', 'd', 'gc_authored'), ('p3m-b', 'B', 'k', 'u', 'd', 'gc_authored')`);
  await tx.execute(sql`INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, status, display_order) VALUES (${T}, 'p3m-a', 'entry', 'faculty', 'draft', 0)`);
  // A weight row that alone would make b a member (0.9 >= 0.5).
  await tx.execute(sql`INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, weight, status, display_order) VALUES (${T}, 'p3m-b', 'entry', 'onet', 0.9, 'draft', 0)`);
  const { rebuildMembership, lockMembership } = await import('@/lib/db/membership-queries');
  await lockMembership(tx); await rebuildMembership(tx);
}
const members = async (tx: Executor) => ((await tx.execute(sql`SELECT competency_id AS c, basis FROM career_target_membership WHERE career_target_id = ${T} ORDER BY display_order`)).rows);

describe.skipIf(!isP2ScratchDb())('membership writers (scratch)', () => {
  it('removing a weight-based member writes a hide that a later recompute does not undo', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      expect(await members(tx)).toEqual([{ c: 'p3m-a', basis: 'pinned' }, { c: 'p3m-b', basis: 'weight' }]);
      await retireCompetencyFromTarget(tx, T, 'p3m-b');
      expect(await members(tx)).toEqual([{ c: 'p3m-a', basis: 'pinned' }]);
      const fac = (await tx.execute(sql`SELECT status FROM career_target_requirements WHERE career_target_id = ${T} AND competency_id = 'p3m-b' AND weight_source = 'faculty'`)).rows;
      expect(fac).toEqual([{ status: 'hidden' }]);
      await recomputeCareerWeights(tx, { apply: true });
      expect((await members(tx)).map(r => r.c)).not.toContain('p3m-b');
    });
  });

  it('removing a pin keeps the weight rows and reports unlinked only when no target lists it', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      expect(await retireCompetencyFromTarget(tx, T, 'p3m-a')).toBe('unlinked');
      expect(await targetIdsForCompetency(tx, 'p3m-a')).toEqual([]);
      expect(await targetIdsForCompetency(tx, 'p3m-b')).toEqual([T]);
    });
  });

  it('re-adding a hidden competency through the batch writer turns the hide back into a pin', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await retireCompetencyFromTarget(tx, T, 'p3m-b');
      await catalogBatchWriter(tx).insertMembership(T, 'p3m-b', 5);
      const { rebuildMembership } = await import('@/lib/db/membership-queries');
      await rebuildMembership(tx); // the batch CLI rebuilds once after all its writes
      expect(await members(tx)).toEqual([{ c: 'p3m-a', basis: 'pinned' }, { c: 'p3m-b', basis: 'pinned' }]);
    });
  });

  it('the batch planner sees pins only, never weight-based members', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      const state = await readCatalogState(tx, false);
      const mine = state.memberships.filter(m => m.careerTargetId === T).map(m => m.competencyId);
      expect(mine).toEqual(['p3m-a']);
    });
  });

  it('the next display order follows the pins, not the weight-based rows', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      expect(await nextDisplayOrderForTarget(T, tx)).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/p3-membership-writers.test.ts`
Expected: FAIL. The first test fails because `retireCompetencyFromTarget` throws "not a member" (it reads requirements, where b has only a weight row) or deletes the weight row; `nextDisplayOrderForTarget` takes no executor.

- [ ] **Step 3: Implement the writer helpers**

Add to `lib/db/membership-queries.ts`:

```ts
import { and, eq, ne } from 'drizzle-orm';
import { careerTargetRequirements } from '@/lib/db/schema';

export async function setPin(tx: Executor, targetId: string, competencyId: string, displayOrder: number): Promise<void> {
  await tx.insert(careerTargetRequirements).values({
    careerTargetId: targetId, competencyId, horizon: 'entry', weight: null, weightSource: 'faculty', status: 'draft', displayOrder,
  }).onConflictDoUpdate({
    target: [careerTargetRequirements.careerTargetId, careerTargetRequirements.competencyId, careerTargetRequirements.horizon, careerTargetRequirements.weightSource],
    // A hidden row becomes a pin; an existing pin (draft or confirmed override) keeps its status and weight.
    set: { status: sql`CASE WHEN ${careerTargetRequirements.status} = 'hidden' THEN 'draft' ELSE ${careerTargetRequirements.status} END`, displayOrder, updatedAt: new Date() },
  });
}

export async function setHide(tx: Executor, targetId: string, competencyId: string): Promise<void> {
  await tx.delete(careerTargetRequirements).where(and(
    eq(careerTargetRequirements.careerTargetId, targetId), eq(careerTargetRequirements.competencyId, competencyId),
    eq(careerTargetRequirements.weightSource, 'faculty'), ne(careerTargetRequirements.horizon, 'entry'),
  ));
  await tx.insert(careerTargetRequirements).values({
    careerTargetId: targetId, competencyId, horizon: 'entry', weight: null, weightSource: 'faculty', status: 'hidden', displayOrder: 0,
  }).onConflictDoUpdate({
    target: [careerTargetRequirements.careerTargetId, careerTargetRequirements.competencyId, careerTargetRequirements.horizon, careerTargetRequirements.weightSource],
    set: { status: 'hidden', weight: null, updatedAt: new Date() },
  });
}

export async function clearFacultyRow(tx: Executor, targetId: string, competencyId: string): Promise<void> {
  await tx.delete(careerTargetRequirements).where(and(
    eq(careerTargetRequirements.careerTargetId, targetId), eq(careerTargetRequirements.competencyId, competencyId),
    eq(careerTargetRequirements.weightSource, 'faculty'),
  ));
}
```

- [ ] **Step 4: Change `competency-catalog-queries.ts`**

- Import `careerTargetMembership` and `lockMembership, rebuildMembership, setPin, setHide`.
- `nextDisplayOrderForTarget(careerTargetId, ex: Executor = db)`: max `display_order` over the target's **pins** (faculty rows with status ≠ `hidden`) + 1, or 0. Update its one caller (`app/api/targets/[id]/sub-competencies/route.ts`) only if the signature change breaks it (the new parameter is optional).
- `insertCompetencyForTarget`: after inserting the catalog row, `await lockMembership(tx); await setPin(tx, row.careerTargetId, row.id, row.displayOrder); await rebuildMembership(tx);` then read back from `targetSubCompetencies` as now.
- `retireCompetencyFromTarget`: keep the `FOR UPDATE` on `sub_competencies` and the "not a member" refusal (membership now read from `careerTargetMembership`). Replace the delete with `await lockMembership(tx); await setHide(tx, careerTargetId, competencyId); await rebuildMembership(tx);`. `'unlinked'` when `targetIdsForCompetency` is empty afterwards. Rewrite the doc comment: removal is a hide (spec addendum §4), weight rows stay, and the lock replaces the race reasoning about deleted rows.
- `targetIdsForCompetency`: read `careerTargetMembership`, not requirements.
- `readCatalogState`: when `lock`, call `await lockMembership(tx)` first (before the existing `FOR UPDATE`s; this also fixes final review Minor #3's lock order). `memberships` = pins only:

```ts
  const memberships = (await tx.execute(sql`
    SELECT career_target_id AS "careerTargetId", competency_id AS "competencyId", min(display_order)::int AS "displayOrder"
    FROM career_target_requirements WHERE weight_source = 'faculty' AND status <> 'hidden'
    GROUP BY 1, 2 ORDER BY 1, 3, 2`)).rows as DbMembershipRow[];
```

- `catalogBatchWriter`: `insertMembership` becomes `await setPin(tx, careerTargetId, competencyId, displayOrder)`. `retireCompetency` keeps deleting every row for the id (a retired competency leaves the catalog's active set; `readPairStates` skips retired rows). `updateMembershipOrder` is unchanged. Add a `finish()`-free approach: the batch CLI (`scripts/targets/apply-target-batch.ts`) must call `await rebuildMembership(tx)` once after all writes, inside its transaction, since it already holds the lock from `readCatalogState(tx, true)`. Read that script and add the one call where the transaction's writes end.
- `setCompetencyOrderInTarget`: update only the faculty rows of the pair (`weight_source = 'faculty'`), then the caller's route rebuilds. Check `app/api/targets/[id]/sub-competencies/reorder/route.ts`: wrap its writes so the transaction calls `lockMembership` first and `rebuildMembership` last.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/p3-membership-writers.test.ts tests/db/p3-career-weights.test.ts` then `env -u DATABASE_URL pnpm -s vitest run app/api/targets lib/domain`
Expected: PASS. Existing route and batch tests that mock `competency-catalog-queries` stay green; if a test asserts the old delete behavior, update its expectation to the hide and ledger it.

- [ ] **Step 6: Commit**

```bash
git add lib/db/membership-queries.ts lib/db/competency-catalog-queries.ts scripts/targets/apply-target-batch.ts app/api/targets tests/db/p3-membership-writers.test.ts
git commit -m "feat(catalog): removal writes a hide, adding writes a pin, batch planner sees pins only"
```

---

### Task 5: Recompute triggers on blind submit, blind reset and target edits

**Files:**
- Modify: `app/api/admin/bundles/[id]/blind/route.ts`, `app/api/admin/bundles/[id]/reset-blind/route.ts`
- Modify: `app/api/targets/[id]/sub-competencies/route.ts`, `app/api/targets/[id]/sub-competencies/[scId]/retire/route.ts`
- Test: `app/api/admin/bundles/__tests__/routes.test.ts` (extend the existing `describe('career-weight recompute after review writes')`)

Target edits already rebuild membership in their own transaction (Task 4). They do not need a weight recompute, because pins and hides do not change weights. Only the bundle routes change weights. So only the two blind routes get the recompute call; the target routes are left as Task 4 made them.

- [ ] **Step 1: Write the failing tests**

Add inside the existing describe block:

```ts
  it('runs after a successful blind submit, not after a refused one', async () => {
    const ok = await blindPOST(post('/api/admin/bundles/a/blind', { reviewer: 'R', picks: [], noCleanMatch: false }), params('a'));
    expect(ok.status).toBe(200);
    expect(mockRecompute).toHaveBeenCalledWith('blind submit');
    q.submitBlindPicks.mockResolvedValueOnce({ ok: false, status: 409, error: 'already submitted' });
    await blindPOST(post('/api/admin/bundles/a/blind', { reviewer: 'R', picks: [], noCleanMatch: false }), params('a'));
    expect(mockRecompute).toHaveBeenCalledTimes(1);
  });

  it('runs after a successful blind reset', async () => {
    const ok = await resetPOST(post('/api/admin/bundles/a/reset-blind', { reviewer: 'R', note: 'redo' }), params('a'));
    expect(ok.status).toBe(200);
    expect(mockRecompute).toHaveBeenCalledWith('blind reset');
  });
```

Check the file's mock object `q` for the exact mock names (`submitBlindPicks`, `resetBlind`) and their default resolved values; if the defaults do not return `{ ok: true }`, set them in these tests with `mockResolvedValueOnce({ ok: true })`.

- [ ] **Step 2: Run to verify they fail**

Run: `env -u DATABASE_URL pnpm -s vitest run app/api/admin/bundles/__tests__/routes.test.ts`
Expected: FAIL, `mockRecompute` not called with `'blind submit'`.

- [ ] **Step 3: Implement**

In each route, after the `if (!result.ok) return ...` line and before `return jsonOk(result)`:

```ts
  await recomputeCareerWeightsSafely('blind submit'); // P3: confirmed core items changed; after commit, never fails the request
```

(`'blind reset'` in reset-blind), with `import { recomputeCareerWeightsSafely } from '@/lib/db/career-weight-queries';`.

- [ ] **Step 4: Run to verify they pass**

Run: `env -u DATABASE_URL pnpm -s vitest run app/api/admin/bundles/__tests__/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'app/api/admin/bundles/[id]/blind/route.ts' 'app/api/admin/bundles/[id]/reset-blind/route.ts' app/api/admin/bundles/__tests__/routes.test.ts
git commit -m "fix(catalog): recompute career weights after blind submit and reset"
```

---

### Task 6: Admin Pin / Hide table

**Files:**
- Modify: `lib/db/membership-queries.ts` (add `readTargetCompetencyList`)
- Create: `app/api/admin/membership/route.ts`
- Create: `app/admin/membership/page.tsx`, `app/admin/membership/MembershipPanel.tsx`
- Modify: `app/admin/page.tsx` (one link to the new page, next to the bundles link)
- Test: `app/api/admin/membership/__tests__/route.test.ts`, `app/admin/membership/__tests__/MembershipPanel.test.tsx`, and one DB test in `tests/db/p3-membership-writers.test.ts`

**Interfaces:**
- Produces:
  - `interface ListedCompetency { careerTargetId: string; competencyId: string; name: string; weight: number | null; band: Band | null; pinned: boolean; hidden: boolean; member: boolean; displayOrder: number | null }`
  - `readTargetCompetencyList(ex: Executor, opts?: { includeHidden?: boolean }): Promise<ListedCompetency[]>` — every pair with a pin, a hide (only when `includeHidden`), or entry effective weight ≥ `LIST_FLOOR`; `member` from the membership table; sorted by target, then members by display order, then non-members by weight descending, then id.
  - `GET /api/admin/membership` → `{ targets: [{ id, name }], rows: ListedCompetency[] }` (includes hidden)
  - `POST /api/admin/membership` body `{ slug, targetId, competencyId, action: 'pin' | 'hide' | 'clear' }` → `{ ok: true, changes: MembershipChange[] }`

- [ ] **Step 1: Write the failing DB test** (append to `tests/db/p3-membership-writers.test.ts`)

```ts
  it('lists pins, hides and anything weighted at least 0.25, with bands', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await tx.execute(sql`INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, origin) VALUES ('p3m-c', 'C', 'k', 'u', 'd', 'gc_authored'), ('p3m-d', 'D', 'k', 'u', 'd', 'gc_authored')`);
      await tx.execute(sql`INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, weight, status, display_order) VALUES
        (${T}, 'p3m-c', 'entry', 'onet', 0.3, 'draft', 0), (${T}, 'p3m-d', 'entry', 'onet', 0.2, 'draft', 0)`);
      const { readTargetCompetencyList } = await import('@/lib/db/membership-queries');
      const rows = (await readTargetCompetencyList(tx)).filter(r => r.careerTargetId === T);
      expect(rows.map(r => [r.competencyId, r.band, r.pinned, r.member])).toEqual([
        ['p3m-a', null, true, true],
        ['p3m-b', 'very', false, true],
        ['p3m-c', 'somewhat', false, false],
      ]);
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/p3-membership-writers.test.ts`
Expected: FAIL, `readTargetCompetencyList` is not a function.

- [ ] **Step 3: Implement `readTargetCompetencyList`**

```ts
export interface ListedCompetency { careerTargetId: string; competencyId: string; name: string; weight: number | null; band: Band | null; pinned: boolean; hidden: boolean; member: boolean; displayOrder: number | null }

export async function readTargetCompetencyList(ex: Executor, opts: { includeHidden?: boolean } = {}): Promise<ListedCompetency[]> {
  const states = await readPairStates(ex);
  const mem = (await ex.execute(sql`SELECT career_target_id AS t, competency_id AS c, display_order AS o FROM career_target_membership`)).rows as Array<{ t: string; c: string; o: number }>;
  const memBy = new Map(mem.map(r => [`${r.t}|${r.c}`, r.o]));
  const names = new Map(((await ex.execute(sql`SELECT id, name FROM sub_competencies`)).rows as Array<{ id: string; name: string }>).map(r => [r.id, r.name]));
  const out: ListedCompetency[] = [];
  for (const s of states) {
    if (s.hidden && !opts.includeHidden) continue;
    if (!s.pinned && !s.hidden && (s.weight === null || s.weight < LIST_FLOOR)) continue;
    const k = `${s.careerTargetId}|${s.competencyId}`;
    out.push({
      careerTargetId: s.careerTargetId, competencyId: s.competencyId, name: names.get(s.competencyId) ?? s.competencyId,
      weight: s.weight, band: bandOf(s.weight), pinned: s.pinned, hidden: s.hidden,
      member: memBy.has(k), displayOrder: memBy.get(k) ?? null,
    });
  }
  return out.sort((a, b) => a.careerTargetId.localeCompare(b.careerTargetId)
    || Number(b.member) - Number(a.member)
    || (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
    || (b.weight ?? -1) - (a.weight ?? -1)
    || a.competencyId.localeCompare(b.competencyId));
}
```

Import `bandOf`, `LIST_FLOOR`, `type Band` from `@/lib/catalog/membership`.

- [ ] **Step 4: Run to verify it passes**

Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Write the failing route tests**

```ts
// app/api/admin/membership/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (_req: Request, o?: { slug?: string }) => o?.slug !== 'bad' }));
const m = {
  readTargetCompetencyList: vi.fn(async () => [] as unknown[]),
  lockMembership: vi.fn(async () => {}),
  rebuildMembership: vi.fn(async () => [] as unknown[]),
  setPin: vi.fn(async () => {}),
  setHide: vi.fn(async () => {}),
  clearFacultyRow: vi.fn(async () => {}),
};
vi.mock('@/lib/db/membership-queries', () => m);
vi.mock('@/lib/db/client', () => ({ db: { transaction: async (fn: (tx: unknown) => unknown) => fn({ execute: async () => ({ rows: [{ next: 3 }] }) }), select: () => ({ from: () => ({ orderBy: async () => [{ id: 't1', name: 'T1' }] }) }) } }));

import { GET, POST } from '../route';
const post = (body: unknown) => new Request('http://x/api/admin/membership', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe('/api/admin/membership', () => {
  it('pins, hides and clears under the lock, then rebuilds', async () => {
    for (const action of ['pin', 'hide', 'clear'] as const) {
      const res = await POST(post({ slug: 's', targetId: 't1', competencyId: 'c-1', action }));
      expect(res.status).toBe(200);
    }
    expect(m.setPin).toHaveBeenCalledTimes(1);
    expect(m.setHide).toHaveBeenCalledTimes(1);
    expect(m.clearFacultyRow).toHaveBeenCalledTimes(1);
    expect(m.lockMembership).toHaveBeenCalledTimes(3);
    expect(m.rebuildMembership).toHaveBeenCalledTimes(3);
  });

  it('refuses a bad action, a bad id, a non-JSON body and a bad slug', async () => {
    expect((await POST(post({ slug: 's', targetId: 't1', competencyId: 'c-1', action: 'drop' }))).status).toBe(400);
    expect((await POST(post({ slug: 's', targetId: 'T 1', competencyId: 'c-1', action: 'pin' }))).status).toBe(400);
    expect((await POST(new Request('http://x', { method: 'POST', body: '{}' }))).status).toBe(415);
    expect((await POST(post({ slug: 'bad', targetId: 't1', competencyId: 'c-1', action: 'pin' }))).status).toBe(401);
    expect(m.setPin).not.toHaveBeenCalled();
  });

  it('GET lists with hidden rows included', async () => {
    const res = await GET(new Request('http://x/api/admin/membership?slug=s'));
    expect(res.status).toBe(200);
    expect(m.readTargetCompetencyList).toHaveBeenCalledWith(expect.anything(), { includeHidden: true });
  });
});
```

Before writing it, read `app/api/admin/bundles/route.ts` and its test for how GET auth gets the slug (`checkAdminAuth(req)` reads it from the query string itself); mirror that in the mock if it differs.

- [ ] **Step 6: Run to verify they fail**

Run: `env -u DATABASE_URL pnpm -s vitest run app/api/admin/membership/__tests__/route.test.ts`
Expected: FAIL, cannot resolve `../route`.

- [ ] **Step 7: Implement the route**

```ts
// app/api/admin/membership/route.ts
import { asc, sql } from 'drizzle-orm';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { hasJsonContentType } from '@/lib/http/require-json';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { readTargetCompetencyList, lockMembership, rebuildMembership, setPin, setHide, clearFacultyRow } from '@/lib/db/membership-queries';
import { ID_RE, jsonError, jsonOk, readBody, bodySlug } from '../bundles/_shared';

// P3 membership addendum (spec 2026-10-21-p3-membership-from-weights-design.md §5):
// faculty pin or hide a competency for a career target. Same auth pattern as
// /api/admin/bundles: middleware grant gate, then checkAdminAuth with the slug.
export const dynamic = 'force-dynamic';
const ACTIONS = new Set(['pin', 'hide', 'clear']);

export async function GET(req: Request): Promise<Response> {
  if (!checkAdminAuth(req)) return jsonError('unauthorized', 401);
  const targets = await db.select({ id: careerTargets.id, name: careerTargets.name }).from(careerTargets).orderBy(asc(careerTargets.displayOrder));
  const rows = await readTargetCompetencyList(db, { includeHidden: true });
  return jsonOk({ targets, rows });
}

export async function POST(req: Request): Promise<Response> {
  if (!hasJsonContentType(req)) return jsonError('content-type must be application/json', 415);
  const body = await readBody(req);
  if (!checkAdminAuth(req, { slug: bodySlug(body) })) return jsonError('unauthorized', 401);
  const { targetId, competencyId, action } = body;
  if (typeof targetId !== 'string' || !ID_RE.test(targetId) || typeof competencyId !== 'string' || !ID_RE.test(competencyId)) return jsonError('bad id', 400);
  if (typeof action !== 'string' || !ACTIONS.has(action)) return jsonError('bad action', 400);
  const changes = await db.transaction(async (tx) => {
    await lockMembership(tx);
    if (action === 'pin') {
      const next = ((await tx.execute(sql`SELECT coalesce(max(display_order) + 1, 0)::int AS next FROM career_target_requirements
        WHERE career_target_id = ${targetId} AND weight_source = 'faculty' AND status <> 'hidden'`)).rows[0] as { next: number }).next;
      await setPin(tx, targetId, competencyId, next);
    } else if (action === 'hide') {
      await setHide(tx, targetId, competencyId);
    } else {
      await clearFacultyRow(tx, targetId, competencyId);
    }
    return rebuildMembership(tx);
  });
  return jsonOk({ ok: true, changes });
}
```

A pin on a pair that is already pinned keeps its status and weight but moves it to the end; that is acceptable for a first version. Note it in the panel's help line ("Pin moves it to the end of the pinned list").

Unknown target or competency ids fail on the foreign key and return 500 through Next's default handler. Wrap the transaction in `try { ... } catch (err) { if ((err as { code?: string }).code === '23503') return jsonError('unknown target or competency', 404); throw err; }` and add one test for it (mock `setPin` to reject with `{ code: '23503' }`, expect 404).

- [ ] **Step 8: Run to verify they pass**

Run: `env -u DATABASE_URL pnpm -s vitest run app/api/admin/membership/__tests__/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: The page and panel**

`app/admin/membership/page.tsx`: copy `app/admin/bundles/page.tsx` (slug check, header with an Admin link), title "Career target competencies", render `<MembershipPanel slug={slug} />`.

`app/admin/membership/MembershipPanel.tsx` (`'use client'`):
- Loads `GET /api/admin/membership?slug=…`.
- A target selector (buttons or a `<select>`), default the first target.
- One table per selected target: Competency, Importance (band label from `BAND_LABELS`, or `PINNED_LABEL` for a weightless pin, plus the weight to two decimals), Status ("Shown — pinned", "Shown — by importance", "Not shown", "Hidden"), and actions: **Pin** (when not pinned), **Hide** (when not hidden), **Reset** (`clear`, when pinned or hidden; label "Reset to importance only").
- One help line under the table: "Shown when pinned, or when importance is at least Important, unless hidden. Pin moves a competency to the end of the pinned list."
- After an action, POST, then reload the list. Show the returned `changes` count ("2 changes — refresh the wiki pages for this target").
- Plain Tailwind like `BundlesPanel`. No new dependencies.

Panel test (`app/admin/membership/__tests__/MembershipPanel.test.tsx`), following `app/admin/bundles/__tests__/BundlesPanel.test.tsx` for fetch mocking: renders a pinned row, a weight-based row and a hidden row; clicking **Hide** on the weight-based row POSTs `{ action: 'hide', targetId, competencyId, slug }`; the hidden row shows "Hidden" and a **Reset** button and no **Hide** button.

In `app/admin/page.tsx`, add one link to `/admin/membership?slug=…` next to the bundles link, in the same markup.

- [ ] **Step 10: Run the panel test, then commit**

Run: `env -u DATABASE_URL pnpm -s vitest run app/admin/membership`
Expected: PASS.

```bash
git add lib/db/membership-queries.ts app/api/admin/membership app/admin/membership app/admin/page.tsx tests/db/p3-membership-writers.test.ts
git commit -m "feat(admin): career target competencies page — pin, hide or reset to importance"
```

---

### Task 7: Importance slider on /program

**Files:**
- Modify: `lib/db/program-coverage-queries.ts` (`MatrixSubCompetency`, `MatrixData`, `getMatrixData`)
- Modify: `app/program/ProgramCoverageClient.tsx`
- Test: `tests/db/p3-membership-writers.test.ts` (one matrix test), `app/program/__tests__/importance-filter.test.ts`

**Interfaces:**
- Consumes: `readTargetCompetencyList` (Task 6), `BAND_FLOORS`, `MEMBERSHIP_CUTOFF` (Task 2).
- Produces:
  - `MatrixSubCompetency` gains `weight: number | null; pinned: boolean`.
  - `MatrixData` gains `belowCutoff: { subCompetencies: MatrixSubCompetency[]; cells: MatrixCoverageCell[] }` — listed competencies (0.25 ≤ weight < 0.5, not pinned, not hidden) and their cells from `snapshot_competency_coverage`, fanned out to that target. Every existing field is unchanged, so `graph-tools.ts` and `sufficiency-read.ts` see what they saw before.
  - `filterByImportance(subs: MatrixSubCompetency[], floor: number): MatrixSubCompetency[]` exported from `app/program/importance-filter.ts` (pure).

- [ ] **Step 1: Write the failing pure test**

```ts
// app/program/__tests__/importance-filter.test.ts
import { describe, it, expect } from 'vitest';
import { filterByImportance } from '../importance-filter';

const s = (id: string, weight: number | null, pinned = false) => ({ id, name: id, careerTargetId: 't', careerTargetName: 'T', displayOrder: 0, weight, pinned });

describe('filterByImportance', () => {
  const subs = [s('pin', null, true), s('v', 0.8), s('i', 0.5), s('w', 0.3)];
  it('each stop filters by its floor; pins show at every stop', () => {
    expect(filterByImportance(subs, 0.75).map(x => x.id)).toEqual(['pin', 'v']);
    expect(filterByImportance(subs, 0.5).map(x => x.id)).toEqual(['pin', 'v', 'i']);
    expect(filterByImportance(subs, 0.25).map(x => x.id)).toEqual(['pin', 'v', 'i', 'w']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `env -u DATABASE_URL pnpm -s vitest run app/program/__tests__/importance-filter.test.ts`
Expected: FAIL, cannot resolve `../importance-filter`.

- [ ] **Step 3: Implement the filter**

```ts
// app/program/importance-filter.ts
import type { MatrixSubCompetency } from '@/lib/db/program-coverage-queries';

/** The /program importance slider: pins always show; others need weight >= floor. Read-only. */
export function filterByImportance(subs: MatrixSubCompetency[], floor: number): MatrixSubCompetency[] {
  return subs.filter(s => s.pinned || (s.weight !== null && s.weight >= floor));
}
```

- [ ] **Step 4: Run to verify it passes**

Same command. Expected: PASS.

- [ ] **Step 5: Write the failing matrix DB test** (append to `tests/db/p3-membership-writers.test.ts`)

`getMatrixData` uses the global `db`, not a transaction, so this test cannot see rolled-back seed rows. Instead, give `getMatrixData` an optional executor parameter (`getMatrixData(ex: Executor = db)`) and thread it through every query in the function (the same pattern as `loadTargetSubstrate(targetId, executor)` and `listStaleSnapshots(executor)`). Then:

```ts
  it('getMatrixData marks weights and pins, and lists 0.25–0.49 competencies under belowCutoff with no cells', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await tx.execute(sql`INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, origin) VALUES ('p3m-c', 'C', 'k', 'u', 'd', 'gc_authored')`);
      await tx.execute(sql`INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, weight, status, display_order) VALUES (${T}, 'p3m-c', 'entry', 'onet', 0.3, 'draft', 0)`);
      const { getMatrixData } = await import('@/lib/db/program-coverage-queries');
      const d = await getMatrixData(tx);
      const mine = d.subCompetencies.filter(x => x.careerTargetId === T).map(x => [x.id, x.pinned, x.weight]);
      expect(mine).toEqual([['p3m-a', true, null], ['p3m-b', false, 0.9]]);
      expect(d.belowCutoff.subCompetencies.filter(x => x.careerTargetId === T).map(x => x.id)).toEqual(['p3m-c']);
      expect(d.belowCutoff.cells.filter(c => c.careerTargetId === T)).toEqual([]);
    });
  });
```

`0.9` comes back from a Postgres `real`; if it reads as `0.8999999761581421`, assert with `toBeCloseTo` per element instead and ledger it.

- [ ] **Step 6: Run to verify it fails**

Run: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/p3-membership-writers.test.ts`
Expected: FAIL (`pinned` undefined; `belowCutoff` undefined).

- [ ] **Step 7: Implement in `getMatrixData`**

- Add `ex: Executor = db` and use it for every query, including `getAllCells` (give it the same optional parameter).
- After building `subCompetenciesOut` from the view, read `const listed = await readTargetCompetencyList(ex);`, index it by `${target}|${competency}`, and set each `weight` and `pinned` from it (`weight: null, pinned: false` if absent, which cannot happen for a member but keeps types total).
- `belowCutoff.subCompetencies` = `listed` rows with `!member && !hidden && weight !== null && weight < MEMBERSHIP_CUTOFF` (the list already excludes < 0.25), mapped to `MatrixSubCompetency` with `displayOrder: 100000 + index` so they sort after members.
- `belowCutoff.cells`: read `snapshot_competency_coverage` rows for those competency ids, restricted to the same `programVisibleSnapshotIds`, and emit one `MatrixCoverageCell` per (row, listing target) with `careerTargetId` set to that target. Scoring never ran for most of these, so this is usually empty. That is expected (Review Focus 4): the client renders the row with empty cells.
- Do not change `subCompetencies` or `cells` membership, so `sufficiency-read.ts` and `graph-tools.ts` are unaffected.

- [ ] **Step 8: Run to verify it passes**

Same command as Step 6. Expected: PASS. Then run the existing matrix consumers' tests: `env -u DATABASE_URL pnpm -s vitest run lib/program lib/ai/wiki app/program`. Expected: PASS. A test fixture that builds a `MatrixData` literal will fail to type-check for the new fields; add `weight: null, pinned: true` and `belowCutoff: { subCompetencies: [], cells: [] }` to those fixtures.

- [ ] **Step 9: The slider in `ProgramCoverageClient.tsx`**

- State: `const [importanceFloor, setImportanceFloor] = useState<number>(MEMBERSHIP_CUTOFF);`
- Where `activeSubs` is computed (around line 180), use

```ts
const activeSubs = useMemo(() => {
  const all = [...data.subCompetencies, ...(importanceFloor < MEMBERSHIP_CUTOFF ? data.belowCutoff.subCompetencies : [])]
    .filter(s => s.careerTargetId === activeTargetId);
  return filterByImportance(all, importanceFloor);
}, [data.subCompetencies, data.belowCutoff, activeTargetId, importanceFloor]);
```

  and add `data.belowCutoff.cells` to the cell map built around line 174, so cells exist when those rows show.
- The second place that filters `data.subCompetencies` by target (around line 253) feeds a target summary; keep it on the stored list (no slider), so the summary does not change with the view. Add a one-line comment saying so.
- The control, above the matrix next to the existing lens/depth controls, in the same style:

```tsx
<label className="flex items-center gap-2 text-sm">
  <span>Show competencies at least</span>
  <select value={importanceFloor} onChange={e => setImportanceFloor(Number(e.target.value))} className="rounded border px-2 py-1">
    <option value={BAND_FLOORS.somewhat}>{BAND_LABELS.somewhat}</option>
    <option value={BAND_FLOORS.important}>{BAND_LABELS.important}</option>
    <option value={BAND_FLOORS.very}>{BAND_LABELS.very}</option>
  </select>
</label>
```

  A three-stop `<select>` is the slider: it is accessible and needs no new component. Under it, one muted line: "Pinned competencies always show. Rows below Important are not scored yet, so their cells may be empty."
- Show each row's band next to the competency name in the row header, small and muted (`BAND_LABELS[bandOf(weight)]` or `PINNED_LABEL`).

- [ ] **Step 10: Run, type-check, commit**

Run: `env -u DATABASE_URL pnpm -s vitest run app/program && pnpm -s tsc --noEmit`
Expected: PASS, clean.

```bash
git add lib/db/program-coverage-queries.ts app/program tests/db/p3-membership-writers.test.ts
git commit -m "feat(program): importance filter on the coverage page; weights and pins on matrix rows"
```

---

### Task 8: Wiki target pages list by importance band

**Files:**
- Modify: `lib/ai/wiki/update.ts` (`CoverageRollupEntry`, `loadTargetSubstrate`)
- Modify: `lib/ai/prompts/wiki-update.md` (target page section 3, line 385)
- Test: `tests/db/p3-membership-writers.test.ts` (one substrate test); the existing `lib/ai/wiki` tests

**Interfaces:**
- Consumes: `readTargetCompetencyList` (Task 6), `BAND_LABELS`, `PINNED_LABEL` (Task 2).
- Produces: `CoverageRollupEntry` gains `importance: string` — one of the three band labels or `'Selected by faculty'`.

- [ ] **Step 1: Write the failing test** (append to `tests/db/p3-membership-writers.test.ts`)

```ts
  it('the wiki target substrate lists pins and every competency weighted at least 0.25, with its band; hidden left out', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await tx.execute(sql`INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, origin) VALUES ('p3m-c', 'C', 'k', 'u', 'd', 'gc_authored'), ('p3m-h', 'H', 'k', 'u', 'd', 'gc_authored')`);
      await tx.execute(sql`INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, weight, status, display_order) VALUES
        (${T}, 'p3m-c', 'entry', 'onet', 0.3, 'draft', 0), (${T}, 'p3m-h', 'entry', 'onet', 0.95, 'draft', 0), (${T}, 'p3m-h', 'entry', 'faculty', NULL, 'hidden', 0)`);
      const { loadTargetSubstrate } = await import('@/lib/ai/wiki/update');
      const s = await loadTargetSubstrate(T, tx);
      expect(s.coverageRollup.map(e => [e.subCompetencyId, e.importance])).toEqual([
        ['p3m-a', 'Selected by faculty'],
        ['p3m-b', 'Very or extremely important'],
        ['p3m-c', 'Somewhat important'],
      ]);
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/p3-membership-writers.test.ts`
Expected: FAIL (`p3m-c` missing; `importance` undefined).

- [ ] **Step 3: Implement**

In `loadTargetSubstrate`:
- Replace the `subs` read from `targetSubCompetencies` with `readTargetCompetencyList(executor)` filtered to `careerTargetId === targetId`, keeping its order (members first in display order, then the rest by weight). Map to `{ id, name, importance }`, where `importance = band ? BAND_LABELS[band] : PINNED_LABEL`. Retired competencies are already excluded by `readPairStates`.
- The cell query reads `targetCoverage` filtered by `careerTargetId = targetId`, which has no rows for non-members. Read `snapshotCompetencyCoverage` instead, filtered by `competencyId IN subIds`, with the same joins, order and filters. Rename the selected columns so the rest of the function (`subCompetencyId`, `snapshotId`, ...) is unchanged.
- Add `importance` to each `CoverageRollupEntry` and to the interface.
- Update the comment above the read: the page lists pins and every competency at least "Somewhat important", grouped by band (spec addendum §5), not the stored membership.

In `lib/ai/prompts/wiki-update.md`, replace item 3 of the target page (line 385) with:

```markdown
3. **Competencies by importance** — group the competencies under these headings, in this order, using each entry's `importance` field: `Very or extremely important`, `Important`, `Somewhat important`, `Selected by faculty`. Skip a heading with no entries. List each as `[[competency-slug|Competency Name]]`, followed by one of: `well-developed (D{n})` / `developing (D{n})` / `thin (D{n})` / `not addressed (D0)`. Base the status label on the best dDepth in `coverageRollup`: ≥3 = well-developed, 2 = developing, 1 = thin, 0 = not addressed.
```

Also update the `coverageRollup` example near line 116 to include `"importance": "Important"` in its entry. If the prompt file carries a version string or a hash checked by a test, bump it as that test requires and ledger it.

- [ ] **Step 4: Run to verify it passes**

Run: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/p3-membership-writers.test.ts && env -u DATABASE_URL pnpm -s vitest run lib/ai/wiki`
Expected: PASS. A wiki test that snapshots the substrate or prompt will need its expectation updated for `importance`; update it and ledger it.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/wiki/update.ts lib/ai/prompts/wiki-update.md tests/db/p3-membership-writers.test.ts lib/ai/wiki
git commit -m "feat(wiki): target pages list competencies by importance band"
```

---

### Task 9: STATE, full suite, review

**Files:**
- Modify: `docs/STATE.md`
- Modify: `scripts/migrations/2026-10-11-p0a-verify.sql` (one comment line at the top, final review Minor #8)

- [ ] **Step 1: Full suite and types**

Run: `env -u DATABASE_URL pnpm -s vitest run > .superpowers/sdd/2026-10-21-p3-membership-from-weights/suite.txt 2>&1; tail -5 .superpowers/sdd/2026-10-21-p3-membership-from-weights/suite.txt; pnpm -s tsc --noEmit`
Then the scratch DB tests: `env DATABASE_URL=postgresql://admin@127.0.0.1:5433/gc_curriculum_p2_scratch pnpm -s vitest run tests/db/p3-*`
Expected: all pass, tsc clean. Report the counts.

- [ ] **Step 2: STATE.md**

Update the P3 entry (BUILT on `feat/p3-career-weights`, NOT live):
- Migration **0062** (`career_target_membership`; status gains `hidden`; both views read the table; verify and rollback scripts named; rollback refuses while hidden or weight rows exist).
- The rule, τ = 0.5, bands, pins, hides; the advisory lock key; who rebuilds membership.
- New route `GET/POST /api/admin/membership` and page `/admin/membership`; `/program` importance filter; wiki target pages by band (prompt `wiki-update.md` changed).
- **Live runbook order:** backup (`pg_dump -Fc` + `pg_restore --list`) → apply 0062 → verify → deploy the build → `recompute-career-weights --expect-db gc_curriculum` dry run → owner yes → `--apply` → refresh the wiki target pages the report lists.
- **Deferred / debt:** final review Minors #2 (a blind-locked bundle can hold confirmed members after a reset; the recompute counts them; human decisions, not shown to the blind reviewer; restate the invariant), #4 (review-queue Importance not release-scoped), #6 (test gaps: task-rating join, d = 0 at DB level, named-unrated employer row). Below-cutoff competencies are not scored, so their /program cells stay empty until scoring scope widens (decision for later). The wiki compile loop still does not regenerate target pages (manual targeted refresh, owner decision 2026-10-21).

Add to `scripts/migrations/2026-10-11-p0a-verify.sql`, first line:

```sql
-- Historical (P0a, 2026-10-11). After P3 (weight rows) and 0062 (hidden rows), its requirement counts no longer hold; do not re-run against a later database.
```

- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md scripts/migrations/2026-10-11-p0a-verify.sql
git commit -m "docs(state): P3 membership from weights — built, not live; runbook and deferred items"
```

- [ ] **Step 4: Final whole-branch review**

Fresh reviewer on the most capable model over `cc550000..HEAD` (the whole P3 branch, since this plan changes the earlier tasks' behavior), with both specs, both plans, both ledgers' `Ruling:` lines, and this plan's Review Focus verbatim. Live steps (backup, 0062, deploy, apply) are not part of this plan; each needs the owner's yes.
