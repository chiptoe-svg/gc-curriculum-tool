// @vitest-environment node
// retireCompetencyFromTarget (P0b Task 3). Needs the POST-0057 schema
// (career_target_requirements carrying the merge survivors' multi-target
// membership, sub_competencies with no deprecated mirror columns), so this
// is gated on isP0bMainDb() — NOT gc_curriculum_p0b_pre, which stays
// pre-0057 forever (controller ruling, Task 3 fix round 1 — isP0bMainDb()
// replaces the local exact-name check this file used to carry itself).
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { careerTargetRequirements, careerTargets, subCompetencies } from '@/lib/db/schema';
import {
  type Tx,
  insertCompetencyForTarget,
  retireCompetencyFromTarget,
} from '@/lib/db/competency-catalog-queries';
import { isP0bMainDb } from './p0b/scratch-guard';

const RUN = isP0bMainDb();

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

  it('on a competency used by exactly one target, removing that last membership leaves the catalog row active and unlinked, with zero requirement rows', async () => {
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
      expect(result).toBe('unlinked');

      // A1 (Amendment 1): unlinked is a valid active state — removing the
      // last target no longer retires the catalog row.
      const [sc] = await tx.select({ retired: subCompetencies.retired }).from(subCompetencies).where(eq(subCompetencies.id, created.id));
      expect(sc!.retired).toBe(false);

      const reqs = await tx.select().from(careerTargetRequirements).where(eq(careerTargetRequirements.competencyId, created.id));
      expect(reqs).toEqual([]);
    });
  });

  it('throws when careerTargetId is not a current member of the competency, and changes nothing', async () => {
    const [t1, t2] = await db.select({ id: careerTargets.id }).from(careerTargets).limit(2);
    await inRolledBackTx(async (tx) => {
      const created = await insertCompetencyForTarget(tx, {
        id: 'zz-p0b-retire-non-member',
        careerTargetId: t1!.id,
        name: 'ZZ P0b non-member fixture',
        knowDescriptor: 'k',
        understandDescriptor: 'u',
        doDescriptor: 'd',
        displayOrder: 999,
      });

      // t2 is a real career target, but never a member of this competency.
      await expect(retireCompetencyFromTarget(tx, t2!.id, created.id)).rejects.toThrow(/not a member/);

      const reqs = await tx.select().from(careerTargetRequirements).where(eq(careerTargetRequirements.competencyId, created.id));
      expect(reqs.map(r => r.careerTargetId)).toEqual([t1!.id]);

      const [sc] = await tx.select({ retired: subCompetencies.retired }).from(subCompetencies).where(eq(subCompetencies.id, created.id));
      expect(sc!.retired).toBe(false);
    });
  });

  // Fix round 2 (2026-10-12): without a lock, two concurrent retires of the
  // SAME shared competency from two DIFFERENT targets can each read the
  // pre-delete membership before either commits, each delete their own row,
  // each re-read and still see the other's (uncommitted) row, and both
  // return 'removed-from-target' — leaving the competency with 0
  // requirement rows but each caller under-reporting its own result.
  // Reproduced directly (lock disabled, two real connections, deterministic
  // — no timing needed since neither side commits until both have run):
  // tx1(target A) -> 'removed-from-target', tx2(target B) ->
  // 'removed-from-target', both commit, final state 0 rows / retired=false.
  // See task-3-report.md "Fix round 2" for that transcript. Since Amendment
  // 1 (A1), 0 rows / retired=false is simply 'unlinked' — a valid state —
  // but the race would still make tx2 under-report 'removed-from-target'
  // instead of 'unlinked'. This test uses two REAL pg connections (not
  // inRolledBackTx — a single transaction can't observe its own row lock
  // blocking a second session) to prove the fix: tx2's lock attempt
  // genuinely blocks on tx1's hold, and only resolves correctly (as
  // 'unlinked') once tx1 commits.
  it(
    "two concurrent retires of a shared competency from different targets serialize via the catalog row's FOR UPDATE lock, ending unlinked with zero requirement rows (not orphaned-and-misreported)",
    async () => {
      const [tA, tB] = await db.select({ id: careerTargets.id }).from(careerTargets).limit(2);
      const competencyId = 'zz-p0b-retire-race';

      // Fixture: one catalog competency shared by two real targets, committed
      // so both raw connections below see it.
      await db.transaction(async (tx) => {
        await insertCompetencyForTarget(tx, {
          id: competencyId,
          careerTargetId: tA!.id,
          name: 'ZZ P0b race fixture',
          knowDescriptor: 'k',
          understandDescriptor: 'u',
          doDescriptor: 'd',
          displayOrder: 999,
        });
        await tx.insert(careerTargetRequirements).values({
          careerTargetId: tB!.id,
          competencyId,
          horizon: 'entry',
          weight: null,
          weightSource: 'faculty',
          status: 'draft',
          displayOrder: 999,
        });
      });

      const url = process.env.DATABASE_URL!;
      const client1 = new Client({ connectionString: url });
      const client2 = new Client({ connectionString: url });
      await client1.connect();
      await client2.connect();

      try {
        const tx1 = drizzle(client1, { schema }) as unknown as Tx;
        const tx2 = drizzle(client2, { schema }) as unknown as Tx;

        await client1.query('BEGIN');
        await client2.query('BEGIN');

        // tx1 retires target A's claim and holds — not committed yet.
        const result1 = await retireCompetencyFromTarget(tx1, tA!.id, competencyId);
        expect(result1).toBe('removed-from-target'); // B's claim still stands from tx1's own view

        // tx2 retires target B's claim concurrently. With the lock in place
        // this blocks on tx1's FOR UPDATE hold instead of racing ahead.
        let tx2Done = false;
        const result2Promise = retireCompetencyFromTarget(tx2, tB!.id, competencyId).then((r) => {
          tx2Done = true;
          return r;
        });

        // Give tx2 a real window to have raced ahead if it weren't blocked.
        await new Promise((r) => setTimeout(r, 300));
        expect(tx2Done).toBe(false);

        await client1.query('COMMIT'); // releases the lock
        const result2 = await result2Promise;
        await client2.query('COMMIT');

        expect(result2).toBe('unlinked');

        const reqs = await db.select().from(careerTargetRequirements).where(eq(careerTargetRequirements.competencyId, competencyId));
        expect(reqs).toEqual([]);
        const [sc] = await db.select({ retired: subCompetencies.retired }).from(subCompetencies).where(eq(subCompetencies.id, competencyId));
        expect(sc!.retired).toBe(false);
      } finally {
        await client1.end();
        await client2.end();
        // Cascades career_target_requirements (already empty by this point).
        await db.delete(subCompetencies).where(eq(subCompetencies.id, competencyId));
      }
    },
    10_000,
  );
});
