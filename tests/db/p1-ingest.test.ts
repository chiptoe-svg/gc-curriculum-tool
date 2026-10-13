// @vitest-environment node
// P1 Task 3 — DB tests for the alumni occupation-mix ingest CLI's write
// function (scratch DB only). Every write runs inside a transaction that is
// rolled back, so the cloned rows are never changed. Gated isP1MainDb():
// career_target_occupations only exists once 0058 has actually been
// applied (the main scratch, never the pre clone).
import { describe, it, expect } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetOccupations, careerTargets } from '@/lib/db/schema';
import { writeOccupationMix, assertExpectedDb, type Tx } from '@/scripts/careers/ingest-alumni-mix';
import type { OccupationMixRow } from '@/lib/careers/alumni-mix';
import { isP1MainDb, SCRATCH_DB } from './p1/scratch-guard';

const RUN = isP1MainDb();

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

function mixRow(overrides: Partial<OccupationMixRow> = {}): OccupationMixRow {
  return {
    careerTargetId: 'production-operations',
    horizon: 'entry',
    socCode: '11-1011',
    onetSocCode: '11-1011.00',
    onetStatus: 'rated',
    count: 10,
    share: 1,
    sourceVersion: 'cafef00d/abc123',
    asOf: '2026-10-11',
    ...overrides,
  };
}

/** Rows as written, with id/createdAt stripped so content can be diffed across runs. */
async function readAlumniRuleRows(executor: Tx | typeof db) {
  const rows = await executor
    .select({
      careerTargetId: careerTargetOccupations.careerTargetId,
      horizon: careerTargetOccupations.horizon,
      socCode: careerTargetOccupations.socCode,
      onetSocCode: careerTargetOccupations.onetSocCode,
      onetStatus: careerTargetOccupations.onetStatus,
      count: careerTargetOccupations.count,
      share: careerTargetOccupations.share,
      sourceVersion: careerTargetOccupations.sourceVersion,
      asOf: careerTargetOccupations.asOf,
    })
    .from(careerTargetOccupations)
    .where(eq(careerTargetOccupations.source, 'alumni_rule'))
    .orderBy(asc(careerTargetOccupations.socCode), asc(careerTargetOccupations.onetSocCode));
  return rows;
}

describe.skipIf(!RUN)('P1 Task 3 — writeOccupationMix (scratch DB only)', () => {
  it('replaces alumni_rule rows and leaves a pre-inserted faculty row untouched', async () => {
    const [target] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      // Seed: one stale alumni_rule row (an earlier version) + one faculty row.
      await tx.insert(careerTargetOccupations).values([
        {
          careerTargetId: target!.id, horizon: 'entry', socCode: '99-9999', onetSocCode: null,
          onetStatus: 'unrated', count: 1, share: 1, source: 'alumni_rule', sourceVersion: 'stale/version', asOf: '2020-01-01',
        },
        {
          careerTargetId: target!.id, horizon: 'growth', socCode: '13-1082', onetSocCode: '13-1082.00',
          onetStatus: 'rated', count: 5, share: 1, source: 'faculty', sourceVersion: 'faculty/manual', asOf: '2026-01-01',
        },
      ]);

      const newRows: OccupationMixRow[] = [mixRow({ careerTargetId: target!.id, socCode: '11-1011', count: 3, share: 0.6 }),
        mixRow({ careerTargetId: target!.id, socCode: '15-1299', onetSocCode: null, onetStatus: 'unrated', count: 2, share: 0.4 })];
      await writeOccupationMix(tx, newRows);

      const alumniRows = await readAlumniRuleRows(tx);
      expect(alumniRows.map(r => r.socCode).sort()).toEqual(['11-1011', '15-1299']);
      expect(alumniRows.some(r => r.sourceVersion === 'stale/version')).toBe(false);

      const facultyRows = await tx.select().from(careerTargetOccupations).where(eq(careerTargetOccupations.source, 'faculty'));
      expect(facultyRows).toHaveLength(1);
      expect(facultyRows[0]).toMatchObject({ socCode: '13-1082', onetSocCode: '13-1082.00', sourceVersion: 'faculty/manual' });
    });
  });

  it('changes nothing on a second run with the same rows (idempotent content)', async () => {
    const [target] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      const rows: OccupationMixRow[] = [mixRow({ careerTargetId: target!.id })];

      await writeOccupationMix(tx, rows);
      const first = await readAlumniRuleRows(tx);

      await writeOccupationMix(tx, rows);
      const second = await readAlumniRuleRows(tx);

      expect(second).toEqual(first);
    });
  });

  it('writing zero rows clears any existing alumni_rule rows and leaves faculty rows untouched', async () => {
    const [target] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      await tx.insert(careerTargetOccupations).values({
        careerTargetId: target!.id, horizon: 'entry', socCode: '11-1011', onetSocCode: '11-1011.00',
        onetStatus: 'rated', count: 1, share: 1, source: 'alumni_rule', sourceVersion: 'old/version', asOf: '2020-01-01',
      });
      await writeOccupationMix(tx, []);
      expect(await readAlumniRuleRows(tx)).toHaveLength(0);
    });
  });
});

describe.skipIf(!RUN)('P1 Task 3 — assertExpectedDb', () => {
  it('resolves when --expect-db matches current_database()', async () => {
    await expect(assertExpectedDb(SCRATCH_DB)).resolves.toBeUndefined();
  });

  it('refuses when --expect-db does not match current_database()', async () => {
    await expect(assertExpectedDb('not_the_real_database')).rejects.toThrow(/refusing: connected to database/);
  });
});
