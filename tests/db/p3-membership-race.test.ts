/**
 * A removal racing another membership writer must not deadlock (final review
 * Important 1). Two real transactions, so the seed is COMMITTED and removed in
 * `finally`. Scratch only.
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { lockMembership, rebuildMembership } from '@/lib/db/membership-queries';
import { retireCompetencyFromTarget } from '@/lib/db/competency-catalog-queries';
import { isP2ScratchDb } from './p2/scratch-guard';

const T = 'p3d-target';
const C = 'p3d-x';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function cleanup() {
  await db.execute(sql`DELETE FROM career_targets WHERE id = ${T}`);
  await db.execute(sql`DELETE FROM sub_competencies WHERE id = ${C}`);
}

describe.skipIf(!isP2ScratchDb())('membership writers race (scratch)', () => {
  it('a removal waiting behind a rebuild completes; neither side deadlocks', async () => {
    await cleanup();
    // The rebuilds below are global; restore the table exactly afterwards so the scratch DB is unchanged.
    const saved = (await db.execute(sql`SELECT career_target_id, competency_id, basis, effective_weight, display_order FROM career_target_membership`)).rows;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO career_targets (id, name, short_definition, industry_contexts, know_descriptors, understand_descriptors, do_descriptors, defensibility_note, display_order)
          VALUES (${T}, 'P3D', 'd', '[]', '[]', '[]', '[]', 'n', 997)`);
        await tx.execute(sql`INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, origin) VALUES (${C}, 'X', 'k', 'u', 'd', 'gc_authored')`);
        await tx.execute(sql`INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, status, display_order) VALUES (${T}, ${C}, 'entry', 'faculty', 'draft', 0)`);
        await lockMembership(tx);
        await rebuildMembership(tx);
      });
      let release!: () => void;
      const gate = new Promise<void>(r => { release = r; });
      const writer = db.transaction(async (tx) => { await lockMembership(tx); await gate; await rebuildMembership(tx); });
      await sleep(100);
      const removal = db.transaction(tx => retireCompetencyFromTarget(tx, T, C));
      await sleep(200);
      release();
      const [w, r] = await Promise.allSettled([writer, removal]);
      expect(w.status).toBe('fulfilled');
      expect(r).toEqual({ status: 'fulfilled', value: 'unlinked' });
    } finally {
      await cleanup();
      await db.transaction(async (tx) => {
        await lockMembership(tx);
        await tx.execute(sql`DELETE FROM career_target_membership`);
        await tx.execute(sql`INSERT INTO career_target_membership (career_target_id, competency_id, basis, effective_weight, display_order)
          SELECT career_target_id, competency_id, basis, effective_weight, display_order
          FROM jsonb_to_recordset(${JSON.stringify(saved)}::jsonb) AS x(career_target_id text, competency_id text, basis text, effective_weight real, display_order int)`);
      });
    }
  }, 15000);
});
