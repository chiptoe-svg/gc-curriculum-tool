// @vitest-environment node
// P1 hostile-review fix wave, m2 + final-review n2: competencies created
// through EITHER the faculty UI (POST /api/targets/[id]/sub-competencies
// -> insertCompetencyForTarget) OR the admin batch CLI
// (scripts/targets/apply-target-batch.ts -> catalogBatchWriter.insertCompetency)
// must be stamped origin = 'gc_authored', not left to the DB default
// ('migrated') — a wrong provenance record otherwise, and invisible to the
// rollback's gc_authored/onet_seeded provenance guard. Gated isP1MainDb():
// sub_competencies.origin only exists once 0058 is applied. Every write
// runs inside a rolled-back transaction.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies } from '@/lib/db/schema';
import { insertCompetencyForTarget, catalogBatchWriter, type Tx } from '@/lib/db/competency-catalog-queries';
import { isP1MainDb, SCRATCH_DB } from './p1/scratch-guard';

const RUN = isP1MainDb();

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

describe.skipIf(!RUN)(`P1 m2: insertCompetencyForTarget stamps origin=gc_authored (${SCRATCH_DB} only)`, () => {
  it('a faculty-created competency gets origin = gc_authored, not the migrated default', async () => {
    await inRolledBackTx(async (tx) => {
      await insertCompetencyForTarget(tx, {
        id: 'zz-p1-fw-facadd',
        careerTargetId: 'production-operations',
        name: 'ZZ faculty-added fixture',
        knowDescriptor: 'k',
        understandDescriptor: 'u',
        doDescriptor: 'd',
        displayOrder: 999,
      });
      const [row] = await tx.select({ origin: subCompetencies.origin }).from(subCompetencies).where(eq(subCompetencies.id, 'zz-p1-fw-facadd'));
      expect(row?.origin).toBe('gc_authored');
    });
  });

  // Red-proof: confirms the assertion above actually discriminates. Without
  // the fix, insertCompetencyForTarget omits `origin` and the column
  // default ('migrated') applies — this case fails if that line is reverted.
  it('red-proof: omitting origin from the insert would leave the DB default (migrated), not gc_authored', async () => {
    await inRolledBackTx(async (tx) => {
      // Same insert as insertCompetencyForTarget, but deliberately WITHOUT
      // origin, to prove the DB default is 'migrated' and the fix above is
      // the only thing standing between a faculty add and a wrong record.
      await tx.insert(subCompetencies).values({
        id: 'zz-p1-fw-facadd-noorigin',
        name: 'ZZ no-origin fixture',
        knowDescriptor: 'k',
        understandDescriptor: 'u',
        doDescriptor: 'd',
        retired: false,
        updatedAt: new Date(),
      });
      const [row] = await tx.select({ origin: subCompetencies.origin }).from(subCompetencies).where(eq(subCompetencies.id, 'zz-p1-fw-facadd-noorigin'));
      expect(row?.origin).toBe('migrated');
    });
  });
});

describe.skipIf(!RUN)(`P1 n2: catalogBatchWriter.insertCompetency stamps origin=gc_authored (${SCRATCH_DB} only)`, () => {
  it('a batch-CLI-created competency gets origin = gc_authored, not the migrated default', async () => {
    await inRolledBackTx(async (tx) => {
      const writer = catalogBatchWriter(tx);
      await writer.insertCompetency({
        id: 'zz-p1-fw-batchadd',
        name: 'ZZ batch-added fixture',
        knowDescriptor: 'k',
        understandDescriptor: 'u',
        doDescriptor: 'd',
        retired: false,
        mergedInto: null,
      });
      const [row] = await tx.select({ origin: subCompetencies.origin }).from(subCompetencies).where(eq(subCompetencies.id, 'zz-p1-fw-batchadd'));
      expect(row?.origin).toBe('gc_authored');
    });
  });

  // Red-proof: same technique as m2's — the DB default is 'migrated' when
  // origin is omitted, which is exactly the bug this fix closes on the
  // second insert path m2 didn't cover.
  it('red-proof: omitting origin from the batch insert would leave the DB default (migrated), not gc_authored', async () => {
    await inRolledBackTx(async (tx) => {
      await tx.insert(subCompetencies).values({
        id: 'zz-p1-fw-batchadd-noorigin',
        name: 'ZZ batch no-origin fixture',
        knowDescriptor: 'k',
        understandDescriptor: 'u',
        doDescriptor: 'd',
        retired: false,
        mergedInto: null,
        updatedAt: new Date(),
      });
      const [row] = await tx.select({ origin: subCompetencies.origin }).from(subCompetencies).where(eq(subCompetencies.id, 'zz-p1-fw-batchadd-noorigin'));
      expect(row?.origin).toBe('migrated');
    });
  });
});
