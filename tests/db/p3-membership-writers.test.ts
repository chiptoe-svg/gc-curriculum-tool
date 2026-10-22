/** Membership writers under the addendum. Scratch only, rolled back. */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { retireCompetencyFromTarget, readCatalogState, catalogBatchWriter, nextDisplayOrderForTarget, targetIdsForCompetency, type Tx } from '@/lib/db/competency-catalog-queries';
import { recomputeCareerWeights } from '@/lib/db/career-weight-queries';

type Executor = Tx; // the catalog writers take a transaction
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
});
