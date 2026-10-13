// @vitest-environment node
// P1 Task 4 — DB tests for the O*NET 31.0 reference-store loader
// (scratch DB only). Every write runs inside a transaction that is rolled
// back, so the cloned scratch DB is never actually changed. Gated
// isP1MainDb(): onet_release/onet_occupations/... only exist once 0058 has
// actually been applied (the main scratch, never the pre clone). Uses the
// synthetic fixtures under tests/fixtures/onet/ (3 codes: 99-0001.00,
// 99-0002.00 — both put in the mix below — and 99-0003.00, which is
// deliberately left OUT of the mix to prove an occupation not in the mix
// is not loaded even though its rows exist in the CSVs).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  careerTargetOccupations,
  careerTargets,
  onetRelease,
  onetOccupations,
  onetElementRatings,
  onetTaskStatements,
  onetTaskRatings,
} from '@/lib/db/schema';
import {
  readRatedOnetCodes,
  readAndFilter,
  writeOnetStore,
  assertExpectedDb,
  type Tx,
} from '@/scripts/onet/load-onet';
import { ONET_ATTRIBUTION } from '@/lib/onet/load';
import { isP1MainDb, SCRATCH_DB } from './p1/scratch-guard';

const RUN = isP1MainDb();
const FIXTURES_DIR = path.join(process.cwd(), 'tests/fixtures/onet');
const RELEASE = 'test-31.0';

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

/** Seeds exactly the mix career_target_occupations needs for this suite: two rated rows (matching fixture codes 99-0001.00/99-0002.00), one unrated row, one no_fit row. 99-0003.00 gets NO row at all. */
async function seedMix(tx: Tx, careerTargetId: string): Promise<void> {
  await tx.insert(careerTargetOccupations).values([
    { careerTargetId, horizon: 'entry', socCode: '99-0001', onetSocCode: '99-0001.00', onetStatus: 'rated', count: 5, share: 0.5, source: 'faculty', sourceVersion: 'test/v1', asOf: '2026-01-01' },
    { careerTargetId, horizon: 'entry', socCode: '99-0002', onetSocCode: '99-0002.00', onetStatus: 'rated', count: 3, share: 0.3, source: 'faculty', sourceVersion: 'test/v1', asOf: '2026-01-01' },
    { careerTargetId, horizon: 'entry', socCode: '99-9901', onetSocCode: null, onetStatus: 'unrated', count: 1, share: 0.1, source: 'faculty', sourceVersion: 'test/v1', asOf: '2026-01-01' },
    { careerTargetId, horizon: 'entry', socCode: '99-9902', onetSocCode: null, onetStatus: 'no_fit', count: 1, share: 0.1, source: 'faculty', sourceVersion: 'test/v1', asOf: '2026-01-01' },
  ]);
}

describe.skipIf(!RUN)('P1 Task 4 — readRatedOnetCodes + readAndFilter + writeOnetStore (scratch DB only)', () => {
  it('reads only rated codes, excludes an occupation not in the mix, and an unrated/no_fit row loads nothing', async () => {
    const [target] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      await seedMix(tx, target!.id);

      // The scratch DB already carries Task 3's real ingest (~96 distinct
      // rated codes across every career target), so readRatedOnetCodes
      // returns a superset, not just this test's two seeded codes — assert
      // membership, not exact equality.
      const codes = await readRatedOnetCodes(tx);
      expect(codes.has('99-0001.00')).toBe(true);
      expect(codes.has('99-0002.00')).toBe(true);
      expect(codes.has('99-0003.00')).toBe(false);

      const data = readAndFilter(FIXTURES_DIR, codes);
      expect(data.occupations.map(o => o.onetSocCode).sort()).toEqual(['99-0001.00', '99-0002.00']);
      // 99-0003.00 is present in every fixture CSV but never in the mix — must not survive the filter.
      expect(data.occupations.some(o => o.onetSocCode === '99-0003.00')).toBe(false);
      expect(data.elementRatings.some(r => r.onetSocCode === '99-0003.00')).toBe(false);
      expect(data.taskStatements.some(t => t.onetSocCode === '99-0003.00')).toBe(false);
      expect(data.taskRatings.some(r => r.onetSocCode === '99-0003.00')).toBe(false);

      // Expected counts, hand-computed from tests/fixtures/onet (see test
      // comments in tests/lib/onet/load.test.ts for the per-file breakdown):
      // knowledge 4 + abilities 3 + work_activities 2 + essential_skills 2 + transferable_skills 2 = 13.
      expect(data.elementRatings).toHaveLength(13);
      expect(data.taskStatements).toHaveLength(3); // 90001, 90002 (code 1) + 90003 (code 2); 90004 (code 3) excluded
      expect(data.taskRatings).toHaveLength(5); // code1: IM+RT+FT(1)+FT(2) = 4; code2: IM = 1
      expect(data.skippedElementScaleCount).toBe(1); // the single 'OJ' row in knowledge.csv
      expect(data.skippedTaskRatingScaleCount).toBe(1); // the single 'XX' row in task_ratings.csv

      await writeOnetStore(tx, RELEASE, data);

      const occRows = await tx.select().from(onetOccupations).where(eq(onetOccupations.release, RELEASE));
      expect(occRows.map(r => r.onetSocCode).sort()).toEqual(['99-0001.00', '99-0002.00']);

      const elementRows = await tx.select().from(onetElementRatings).where(eq(onetElementRatings.release, RELEASE));
      expect(elementRows).toHaveLength(13);

      const taskStatementRows = await tx.select().from(onetTaskStatements).where(eq(onetTaskStatements.release, RELEASE));
      expect(taskStatementRows).toHaveLength(3);

      const taskRatingRows = await tx.select().from(onetTaskRatings).where(eq(onetTaskRatings.release, RELEASE));
      expect(taskRatingRows).toHaveLength(5);

      const releaseRow = await tx.select().from(onetRelease).where(eq(onetRelease.release, RELEASE));
      expect(releaseRow).toHaveLength(1);
      expect(releaseRow[0]).toMatchObject({ published: 'August 2026', license: 'CC BY 4.0', attribution: ONET_ATTRIBUTION, sourceUrl: 'https://www.onetcenter.org/database.html' });
    });
  });

  it('a re-run leaves row counts (and content) unchanged', async () => {
    const [target] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      await seedMix(tx, target!.id);
      const codes = await readRatedOnetCodes(tx);
      const data = readAndFilter(FIXTURES_DIR, codes);

      await writeOnetStore(tx, RELEASE, data);
      const firstOcc = await tx.select({ onetSocCode: onetOccupations.onetSocCode }).from(onetOccupations).where(eq(onetOccupations.release, RELEASE)).orderBy(asc(onetOccupations.onetSocCode));
      const firstElementCount = (await tx.select().from(onetElementRatings).where(eq(onetElementRatings.release, RELEASE))).length;
      const firstTaskStatementCount = (await tx.select().from(onetTaskStatements).where(eq(onetTaskStatements.release, RELEASE))).length;
      const firstTaskRatingCount = (await tx.select().from(onetTaskRatings).where(eq(onetTaskRatings.release, RELEASE))).length;

      await writeOnetStore(tx, RELEASE, data);
      const secondOcc = await tx.select({ onetSocCode: onetOccupations.onetSocCode }).from(onetOccupations).where(eq(onetOccupations.release, RELEASE)).orderBy(asc(onetOccupations.onetSocCode));
      const secondElementCount = (await tx.select().from(onetElementRatings).where(eq(onetElementRatings.release, RELEASE))).length;
      const secondTaskStatementCount = (await tx.select().from(onetTaskStatements).where(eq(onetTaskStatements.release, RELEASE))).length;
      const secondTaskRatingCount = (await tx.select().from(onetTaskRatings).where(eq(onetTaskRatings.release, RELEASE))).length;

      expect(secondOcc).toEqual(firstOcc);
      expect(secondElementCount).toBe(firstElementCount);
      expect(secondTaskStatementCount).toBe(firstTaskStatementCount);
      expect(secondTaskRatingCount).toBe(firstTaskRatingCount);
    });
  });

  it('an unrated/no_fit-only mix for these codes loads nothing (no rated row ever seeded for 99-0001.00/99-0002.00/99-0003.00)', async () => {
    const [target] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      await tx.insert(careerTargetOccupations).values([
        { careerTargetId: target!.id, horizon: 'entry', socCode: '99-9901', onetSocCode: null, onetStatus: 'unrated', count: 1, share: 0.5, source: 'faculty', sourceVersion: 'test/v1', asOf: '2026-01-01' },
        { careerTargetId: target!.id, horizon: 'entry', socCode: '99-9902', onetSocCode: null, onetStatus: 'no_fit', count: 1, share: 0.5, source: 'faculty', sourceVersion: 'test/v1', asOf: '2026-01-01' },
      ]);

      // No rated row exists anywhere for the three synthetic fixture codes
      // in this rolled-back transaction (the real scratch data never
      // contains them either), so none of them should appear in the rated
      // set, and none of the fixture CSVs' rows should load.
      const codes = await readRatedOnetCodes(tx);
      expect(codes.has('99-0001.00')).toBe(false);
      expect(codes.has('99-0002.00')).toBe(false);
      expect(codes.has('99-0003.00')).toBe(false);

      const data = readAndFilter(FIXTURES_DIR, codes);
      expect(data.occupations).toHaveLength(0);
      expect(data.elementRatings).toHaveLength(0);
      expect(data.taskStatements).toHaveLength(0);
      expect(data.taskRatings).toHaveLength(0);

      await writeOnetStore(tx, RELEASE, data);
      const occRows = await tx.select().from(onetOccupations).where(eq(onetOccupations.release, RELEASE));
      expect(occRows).toHaveLength(0);
    });
  });
});

describe.skipIf(!RUN)('P1 Task 4 — assertExpectedDb', () => {
  it('resolves when --expect-db matches current_database()', async () => {
    await expect(assertExpectedDb(SCRATCH_DB)).resolves.toBeUndefined();
  });

  it('refuses when --expect-db does not match current_database()', async () => {
    await expect(assertExpectedDb('not_the_real_database')).rejects.toThrow(/refusing: connected to database/);
  });
});
