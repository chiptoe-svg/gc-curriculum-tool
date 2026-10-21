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
  await tx.execute(sql`INSERT INTO onet_occupations (release, onet_soc_code, title, description) VALUES (${REL}, ${SOC_A}, 'Occ A', 'd'), (${REL}, ${SOC_B}, 'Occ B', 'd') ON CONFLICT DO NOTHING`);
  await tx.execute(sql`INSERT INTO career_targets (id, name, short_definition, industry_contexts, know_descriptors, understand_descriptors, do_descriptors, defensibility_note, display_order)
    VALUES (${T}, 'P3W target', 'd', '[]', '[]', '[]', '[]', 'n', 999)`);
  await tx.execute(sql`INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, origin) VALUES ('p3w-c1', 'C1', 'k', 'u', 'd', 'gc_authored'), ('p3w-c2', 'C2', 'k', 'u', 'd', 'gc_authored')`);
  await tx.execute(sql`INSERT INTO career_target_requirements (career_target_id, competency_id, horizon, weight_source, status, display_order) VALUES (${T}, 'p3w-c1', 'entry', 'faculty', 'draft', 1)`);
  await tx.execute(sql`INSERT INTO career_target_occupations (career_target_id, horizon, soc_code, onet_soc_code, onet_status, count, share, source, source_version, as_of) VALUES
    (${T}, 'entry', '99-0001', ${SOC_A}, 'rated', 3, 0.75, 'alumni_rule', 't', '2026-10-21'), (${T}, 'entry', '99-0002', ${SOC_B}, 'rated', 1, 0.25, 'alumni_rule', 't', '2026-10-21'),
    (${T}, 'growth', '99-0001', ${SOC_A}, 'rated', 1, 1.0, 'alumni_rule', 't', '2026-10-21')`);
  await tx.execute(sql`INSERT INTO onet_element_ratings (release, onet_soc_code, domain, element_id, element_name, scale_id, data_value, recommend_suppress, not_relevant, date_text, domain_source) VALUES
    (${REL}, ${SOC_A}, 'work_activities', '9.Z.1', 'E1', 'IM', 5, false, false, '08/2026', 't'),
    (${REL}, ${SOC_B}, 'work_activities', '9.Z.1', 'E1', 'IM', 3, false, false, '08/2026', 't'),
    (${REL}, ${SOC_A}, 'work_activities', '9.Z.2', 'E2', 'IM', 2, false, false, '08/2026', 't')`);
}

async function addMember(tx: Executor, bundle: string, elementId: string, position: string, status: 'proposed' | 'confirmed'): Promise<void> {
  if (status === 'proposed') {
    await tx.execute(sql`INSERT INTO bundle_members (bundle_id, source, external_id, external_label, release, position, ai_position, status, proposed_by)
      VALUES (${bundle}, 'onet_element', ${elementId}, ${elementId}, ${REL}, ${position}, ${position}, 'proposed', 'model-x')`);
  } else {
    await tx.execute(sql`INSERT INTO bundle_members (bundle_id, source, external_id, external_label, release, position, ai_position, status, proposed_by, confirmed_by, confirmed_at)
      VALUES (${bundle}, 'onet_element', ${elementId}, ${elementId}, ${REL}, ${position}, ${position}, 'confirmed', 'model-x', 'tester', now())`);
  }
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

  it('employer rows from submitted, current captures; retired and superseded excluded', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      const partner = ((await tx.execute(sql`INSERT INTO partners (email, first_name, last_name, company, magic_token)
        VALUES ('p3w@example.edu', 'P', 'W', 'Co', 'p3w-token-0001') RETURNING id`)).rows[0] as { id: string }).id;
      const ins = async (rating: number, retired: boolean) => ((await tx.execute(sql`INSERT INTO position_captures (partner_id, career_target_id, status, company, rated_skills, profile, submitted_at, retired_at)
        VALUES (${partner}, ${T}, 'submitted', 'Co', ${JSON.stringify({ items: [{ name: 'x', sub_competency_id: 'p3w-c1', rating }] })}::jsonb, '{"qualifying_competencies":[]}'::jsonb, now(), ${retired ? sql`now()` : sql`NULL`}) RETURNING id`)).rows[0] as { id: string }).id;
      const live = await ins(7, false);
      await ins(1, true); // retired: excluded
      const old = await ins(1, false);
      await tx.execute(sql`INSERT INTO position_captures (partner_id, career_target_id, status, company, rated_skills, submitted_at, supersedes)
        VALUES (${partner}, ${T}, 'submitted', 'Co', '{"items":[]}'::jsonb, now(), ${old})`); // supersedes `old`; rates nothing
      await recomputeCareerWeights(tx, { apply: true });
      const emp = (await rowsFor(tx, 'p3w-c1')).find(r => r.weightSource === 'employer')!;
      expect(emp.weight).toBeCloseTo(1);
      expect(emp.contributingPositionIds).toEqual([live]);
    });
  });

  it('a faculty override survives a recompute and wins on read', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await addMember(tx, 'p3w-c1', '9.Z.1', 'core', 'confirmed');
      await tx.execute(sql`UPDATE career_target_requirements SET weight = 0.2, status = 'confirmed', note = 'faculty override' WHERE career_target_id = ${T} AND competency_id = 'p3w-c1' AND weight_source = 'faculty'`);
      await recomputeCareerWeights(tx, { apply: true });
      const fac = (await rowsFor(tx, 'p3w-c1')).find(r => r.weightSource === 'faculty')!;
      expect(fac.weight).toBeCloseTo(0.2);
      const [row] = await readCareerWeights(tx, T, 'entry');
      expect(row).toMatchObject({ competencyId: 'p3w-c1', basis: 'faculty_override' });
      expect(row!.weight).toBeCloseTo(0.2);
      expect(row!.onet).toBeCloseTo(0.875);
    });
  });

  it('readBundleDetail reports each member’s highest Importance across GC destination occupations', async () => {
    await inRolledBackTx(async (tx) => {
      await seed(tx);
      await addMember(tx, 'p3w-c1', '9.Z.1', 'core', 'confirmed');
      const { readBundleDetail } = await import('@/lib/db/bundle-queries');
      const d = await readBundleDetail('p3w-c1', tx);
      expect(d?.members?.find(m => m.externalId === '9.Z.1')?.importance).toBe(5);
    });
  });
});
