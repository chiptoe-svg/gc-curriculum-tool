// @vitest-environment node
// P1 hostile-review fix wave, I-1 (controller ruling): the branch's own
// Drizzle schema names `sub_competencies.origin` in every unprojected
// select/insert, so the running code — not just the new 0058 tables — needs
// 0058 applied first. STATE.md's and the plan's "merge and deploy, then
// apply 0058" ordering (Ruling 8) is superseded: the live order is now
// backup -> apply 0058 -> verify -> THEN build/deploy the new code. This
// file documents the dependency with a reproduction on the real pre-0058
// clone, read-only — every case is wrapped in its own rolled-back
// transaction, so nothing here ever persists, and gc_curriculum_p1_pre is
// never mutated.
//
// Gated isP1PreDb(): these three paths must FAIL on pre-0058 — pointed at
// the main (post-0058) scratch they'd all succeed, which proves nothing.
import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/client';
import { subCompetencies } from '@/lib/db/schema';
import { readCatalogState, insertCompetencyForTarget, type Tx } from '@/lib/db/competency-catalog-queries';
import { formatDbError } from '@/scripts/catalog/catalog-source';
import { isP1PreDb } from './p1/scratch-guard';

const RUN = isP1PreDb();

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

/** drizzle-orm wraps the real driver error in `.cause` (see formatDbError) —
 * assert against that, not the top-level `.message`, which is just "Failed
 * query: <the full SQL>". */
async function expectOriginColumnMissing(p: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  expect(caught, 'expected this call to reject on a pre-0058 database').toBeInstanceOf(Error);
  expect(formatDbError(caught)).toMatch(/column .*origin.* does not exist/i);
}

describe.skipIf(!RUN)('P1 I-1: the deployed code needs 0058 (pre-0058 clone only)', () => {
  it('app/api/program/coverage/refresh/route.ts:35\'s unprojected catalog select fails on "origin"', async () => {
    await inRolledBackTx(async (tx) => {
      await expectOriginColumnMissing(tx.select().from(subCompetencies));
    });
  });

  it('lib/db/competency-catalog-queries.ts readCatalogState (apply-target-batch) fails on "origin"', async () => {
    await inRolledBackTx(async (tx) => {
      await expectOriginColumnMissing(readCatalogState(tx, false));
    });
  });

  it('insertCompetencyForTarget (POST /api/targets/[id]/sub-competencies, faculty "add competency") fails on "origin"', async () => {
    await inRolledBackTx(async (tx) => {
      await expectOriginColumnMissing(
        insertCompetencyForTarget(tx, {
          id: 'zz-p1-fw-pre0058-probe',
          careerTargetId: 'production-operations',
          name: 'ZZ fixture (never committed — this case always fails before any insert succeeds)',
          knowDescriptor: 'k',
          understandDescriptor: 'u',
          doDescriptor: 'd',
          displayOrder: 999,
        }),
      );
    });
  });
});
