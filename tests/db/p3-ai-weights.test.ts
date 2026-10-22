/** AI-drafted provisional weights (addendum 3). Scratch only, rolled back. */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import type { Tx } from '@/lib/db/competency-catalog-queries';
import { importAiWeights, parseAiRatings } from '@/lib/db/ai-weight-queries';
import { recomputeCareerWeights } from '@/lib/db/career-weight-queries';
import { readTargetCompetencyList } from '@/lib/db/membership-queries';
import { isP2ScratchDb } from './p2/scratch-guard';

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try { await db.transaction(async (tx) => { await fn(tx); throw new Rollback('rollback'); }); }
  catch (err) { if (err instanceof Rollback) return; throw err; }
}
const T = 'p3a-target';
async function seed(tx: Tx) {
  await tx.execute(sql`INSERT INTO career_targets (id, name, short_definition, industry_contexts, know_descriptors, understand_descriptors, do_descriptors, defensibility_note, display_order)
    VALUES (${T}, 'P3A', 'd', '[]', '[]', '[]', '[]', 'n', 996)`);
  await tx.execute(sql`INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, origin) VALUES ('p3a-x', 'X', 'k', 'u', 'd', 'gc_authored'), ('p3a-y', 'Y', 'k', 'u', 'd', 'gc_authored')`);
  // An O*NET row that alone would make y a member at 0.9; the AI draft must win.
  await tx.execute(sql`INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, weight, status, display_order) VALUES (${T}, 'p3a-y', 'entry', 'onet', 0.9, 'draft', 0)`);
}
const ratings = (x: number, y: number) => ({ model: 'test-model', ratings: [
  { target: T, competency: 'p3a-x', weight: x, reason: 'X matters.' },
  { target: T, competency: 'p3a-y', weight: y, reason: 'Y barely matters.' },
] });
const members = async (tx: Tx) => (await tx.execute(sql`SELECT competency_id AS c FROM career_target_membership WHERE career_target_id = ${T} ORDER BY 1`)).rows;

describe.skipIf(!isP2ScratchDb())('AI draft weights (scratch)', () => {
  it('imported AI weights decide membership over O*NET, are provisional with their reason, and survive a recompute', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      const parsed = parseAiRatings(ratings(0.8, 0.1), { targets: [T], competencies: ['p3a-x', 'p3a-y'] });
      const report = await importAiWeights(tx, parsed, { apply: true });
      expect(report.upserted).toBe(2);
      expect(await members(tx)).toEqual([{ c: 'p3a-x' }]);
      const x = (await readTargetCompetencyList(tx)).find(r => r.careerTargetId === T && r.competencyId === 'p3a-x')!;
      expect(x).toMatchObject({ provisional: true, band: 'very', reason: 'X matters.' });
      await recomputeCareerWeights(tx, { apply: true });
      expect((await tx.execute(sql`SELECT count(*)::int AS n FROM career_target_requirements WHERE career_target_id = ${T} AND weight_source = 'ai'`)).rows[0]).toEqual({ n: 2 });
      expect(await members(tx)).toEqual([{ c: 'p3a-x' }]);
    });
  });

  it('the wiki target substrate carries the AI reason and the provisional flag', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await importAiWeights(tx, parseAiRatings(ratings(0.8, 0.3), { targets: [T], competencies: ['p3a-x', 'p3a-y'] }), { apply: true });
      const { loadTargetSubstrate } = await import('@/lib/ai/wiki/update');
      const sub = await loadTargetSubstrate(T, tx);
      expect(sub.coverageRollup.map(e => [e.subCompetencyId, e.importance, e.provisional, e.importanceReason])).toEqual([
        ['p3a-x', 'Very or extremely important', true, 'X matters.'],
        ['p3a-y', 'Somewhat important', true, 'Y barely matters.'],
      ]);
    });
  });

  it('a dry run writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      const parsed = parseAiRatings(ratings(0.8, 0.1), { targets: [T], competencies: ['p3a-x', 'p3a-y'] });
      const report = await importAiWeights(tx, parsed, { apply: false });
      expect(report.changes.some(c => c.competencyId === 'p3a-x' && c.change === 'entered')).toBe(true);
      expect((await tx.execute(sql`SELECT count(*)::int AS n FROM career_target_requirements WHERE weight_source = 'ai' AND career_target_id = ${T}`)).rows[0]).toEqual({ n: 0 });
      expect(await members(tx)).toEqual([]);
    });
  });
});

describe('parseAiRatings', () => {
  const known = { targets: ['t'], competencies: ['a', 'b'] };
  const ok = { model: 'm', ratings: [{ target: 't', competency: 'a', weight: 0.5, reason: 'r' }, { target: 't', competency: 'b', weight: 0, reason: 'r' }] };
  it('accepts a complete, valid file', () => expect(parseAiRatings(ok, known).ratings).toHaveLength(2));
  it('rejects a weight outside 0–1, an unknown id, a duplicate, a missing pair and a missing reason', () => {
    expect(() => parseAiRatings({ ...ok, ratings: [{ ...ok.ratings[0]!, weight: 1.2 }, ok.ratings[1]] }, known)).toThrow(/weight/);
    expect(() => parseAiRatings({ ...ok, ratings: [{ ...ok.ratings[0]!, competency: 'z' }, ok.ratings[1]] }, known)).toThrow(/unknown/);
    expect(() => parseAiRatings({ ...ok, ratings: [ok.ratings[0], ok.ratings[0]] }, known)).toThrow(/duplicate/);
    expect(() => parseAiRatings({ ...ok, ratings: [ok.ratings[0]] }, known)).toThrow(/missing/);
    expect(() => parseAiRatings({ ...ok, ratings: [{ ...ok.ratings[0]!, reason: '' }, ok.ratings[1]] }, known)).toThrow(/reason/);
  });
});
