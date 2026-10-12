// @vitest-environment node
// retireCompetencyFromTarget (P0b Task 3). Needs the POST-0057 schema
// (career_target_requirements carrying the merge survivors' multi-target
// membership, sub_competencies with no deprecated mirror columns), so this
// is gated on isP0bScratchDb() AND the exact database name
// gc_curriculum_p0b_scratch — NOT gc_curriculum_p0b_pre, which stays
// pre-0057 forever (controller ruling, Task 3). isP0bScratchDb() alone
// accepts either clone; the extra pathname check narrows to the one that's
// actually migrated.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements, careerTargets, subCompetencies } from '@/lib/db/schema';
import {
  type Tx,
  insertCompetencyForTarget,
  retireCompetencyFromTarget,
} from '@/lib/db/competency-catalog-queries';
import { isP0bScratchDb, SCRATCH_DB } from './p0b/scratch-guard';

function isMainP0bScratch(): boolean {
  if (!isP0bScratchDb()) return false;
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname === `/${SCRATCH_DB}`;
  } catch {
    return false;
  }
}
const RUN = isMainP0bScratch();

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

describe.skipIf(!RUN)('retireCompetencyFromTarget (P0b, post-0057)', () => {
  it("on a competency shared by several targets (a P0b merge survivor), removing one target's claim deletes only that target's requirement rows and leaves it active", async () => {
    await inRolledBackTx(async (tx) => {
      const before = await tx
        .select()
        .from(careerTargetRequirements)
        .where(eq(careerTargetRequirements.competencyId, 'domain-knowledge'));
      // Precondition: domain-knowledge absorbed gc-production-literacy
      // (account-management) and domain-grounding (ai-workflow) in the 0057
      // merge, on top of its own production-operations membership.
      expect(before.length).toBeGreaterThan(1);
      expect(before.some(r => r.careerTargetId === 'account-management')).toBe(true);

      const result = await retireCompetencyFromTarget(tx, 'account-management', 'domain-knowledge');
      expect(result).toBe('removed-from-target');

      const remaining = await tx
        .select()
        .from(careerTargetRequirements)
        .where(eq(careerTargetRequirements.competencyId, 'domain-knowledge'));
      expect(remaining.map(r => r.careerTargetId).sort()).toEqual(
        before.map(r => r.careerTargetId).filter(id => id !== 'account-management').sort(),
      );

      const [row] = await tx.select({ retired: subCompetencies.retired }).from(subCompetencies).where(eq(subCompetencies.id, 'domain-knowledge'));
      expect(row!.retired).toBe(false);
    });
  });

  it('on a competency used by exactly one target, retires the catalog row, removes the requirement, and returns retired', async () => {
    const [t] = await db.select({ id: careerTargets.id }).from(careerTargets).limit(1);
    await inRolledBackTx(async (tx) => {
      const created = await insertCompetencyForTarget(tx, {
        id: 'zz-p0b-retire-single-target',
        careerTargetId: t!.id,
        name: 'ZZ P0b single-target fixture',
        knowDescriptor: 'k',
        understandDescriptor: 'u',
        doDescriptor: 'd',
        displayOrder: 999,
      });

      const result = await retireCompetencyFromTarget(tx, t!.id, created.id);
      expect(result).toBe('retired');

      const [sc] = await tx.select({ retired: subCompetencies.retired }).from(subCompetencies).where(eq(subCompetencies.id, created.id));
      expect(sc!.retired).toBe(true);

      const reqs = await tx.select().from(careerTargetRequirements).where(eq(careerTargetRequirements.competencyId, created.id));
      expect(reqs).toEqual([]);
    });
  });
});
