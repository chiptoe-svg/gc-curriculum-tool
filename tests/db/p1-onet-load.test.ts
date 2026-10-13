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
import { describe, it, expect, vi } from 'vitest';
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
  parseArgs,
  main,
  type Tx,
  type LoadDeps,
} from '@/scripts/onet/load-onet';
import { getOnetReleaseMetadata, type OnetReleaseMetadata } from '@/lib/onet/load';
import { isP1MainDb, SCRATCH_DB } from './p1/scratch-guard';

const RUN = isP1MainDb();
const FIXTURES_DIR = path.join(process.cwd(), 'tests/fixtures/onet');
// A synthetic release name, deliberately NOT '31.0' — this suite's writes
// must never touch the scratch DB's REAL '31.0' row/occupations (Task 4's
// real load). m4 (hostile-review fix wave): writeOnetStore no longer looks
// up metadata itself (that would refuse this synthetic name, since only
// '31.0' has a row in ONET_RELEASE_METADATA) — the caller supplies it, so
// this suite supplies its own synthetic metadata too, and asserts THAT
// round-trips, proving the write is release-specific rather than always
// stamping 31.0's text.
const RELEASE = 'test-31.0';
const TEST_RELEASE_METADATA: OnetReleaseMetadata = {
  published: 'Test Published Date',
  license: 'Test License',
  attribution: 'Test attribution text for test-31.0',
  sourceUrl: 'https://example.test/test-31.0',
};

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

      await writeOnetStore(tx, RELEASE, data, TEST_RELEASE_METADATA);

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
      // m4 (hostile-review fix wave): the written metadata is THIS release's
      // own (the caller-supplied TEST_RELEASE_METADATA), not a fixed
      // constant — the old assertion here expected the real 31.0 text
      // under a release named "test-31.0", which was exactly the bug.
      expect(releaseRow[0]).toMatchObject(TEST_RELEASE_METADATA);
    });
  });

  it('a re-run leaves row counts (and content) unchanged', async () => {
    const [target] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      await seedMix(tx, target!.id);
      const codes = await readRatedOnetCodes(tx);
      const data = readAndFilter(FIXTURES_DIR, codes);

      await writeOnetStore(tx, RELEASE, data, TEST_RELEASE_METADATA);
      const firstOcc = await tx.select({ onetSocCode: onetOccupations.onetSocCode }).from(onetOccupations).where(eq(onetOccupations.release, RELEASE)).orderBy(asc(onetOccupations.onetSocCode));
      const firstElementCount = (await tx.select().from(onetElementRatings).where(eq(onetElementRatings.release, RELEASE))).length;
      const firstTaskStatementCount = (await tx.select().from(onetTaskStatements).where(eq(onetTaskStatements.release, RELEASE))).length;
      const firstTaskRatingCount = (await tx.select().from(onetTaskRatings).where(eq(onetTaskRatings.release, RELEASE))).length;

      await writeOnetStore(tx, RELEASE, data, TEST_RELEASE_METADATA);
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

      await writeOnetStore(tx, RELEASE, data, TEST_RELEASE_METADATA);
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

// ─── P1 hostile-review fix wave: load-onet.ts default flipped to dry-run,
// m4's --release validation, m7's concise write-failure message. Pure
// (no DB) — runs unconditionally. ───────────────────────────────────────

describe('parseArgs', () => {
  it('defaults apply to false — --apply is required to write for real (flip, hostile-review fix wave)', () => {
    const args = parseArgs(['--dir', 'd', '--release', '31.0', '--expect-db', 'x']);
    expect(args.apply).toBe(false);
  });

  it('--apply sets apply to true', () => {
    const args = parseArgs(['--dir', 'd', '--release', '31.0', '--expect-db', 'x', '--apply']);
    expect(args.apply).toBe(true);
  });

  it('throws on a missing required flag', () => {
    expect(() => parseArgs(['--dir', 'd', '--expect-db', 'x'])).toThrow(/usage:/);
  });
});

describe('release metadata validation (m4)', () => {
  it('31.0 has a known metadata row', () => {
    expect(getOnetReleaseMetadata('31.0')).toMatchObject({ license: 'CC BY 4.0' });
  });

  it('an unlisted release throws, naming the release', () => {
    expect(() => getOnetReleaseMetadata('32.0')).toThrow(/no known metadata for release "32\.0"/);
  });
});

describe.skipIf(!RUN)('P1 Task 4 — main() default dry-run / --apply (m3 flip, m7 concise errors; scratch DB only)', () => {
  /** Runs main() with executor pinned to `tx` so nothing it does escapes this rolled-back transaction, same technique the other P1 CLI test files use. */
  function depsOn(tx: Tx, overrides: Partial<LoadDeps> = {}): LoadDeps {
    return {
      executor: tx,
      readRatedOnetCodes: async () => new Set(['99-0001.00', '99-0002.00']),
      readAndFilter: () => ({ occupations: [], elementRatings: [], taskStatements: [], taskRatings: [], skippedElementScaleCount: 0, skippedTaskRatingScaleCount: 0 }),
      ...overrides,
    };
  }

  // '31.0' here, not the suite's synthetic RELEASE — main() validates
  // --release against the real ONET_RELEASE_METADATA unconditionally (m4,
  // not mockable via deps, on purpose), so these main()-level tests must
  // pass a release that actually has a metadata row. They never assert on
  // onet_release table state (which would collide with the scratch DB's
  // real '31.0' row from Task 4's real load) — only on whether the
  // injected writeOnetStore mock ran.
  const KNOWN_RELEASE = '31.0';

  it('without --apply (the default), the write function is never called', async () => {
    await inRolledBackTx(async (tx) => {
      const argv = ['--dir', FIXTURES_DIR, '--release', KNOWN_RELEASE, '--expect-db', SCRATCH_DB];
      let writeCalled = false;
      const code = await main(argv, depsOn(tx, { writeOnetStore: async () => { writeCalled = true; } }));
      expect(code).toBe(0);
      expect(writeCalled).toBe(false);
    });
  });

  it('with --apply, the write runs', async () => {
    await inRolledBackTx(async (tx) => {
      const argv = ['--dir', FIXTURES_DIR, '--release', KNOWN_RELEASE, '--expect-db', SCRATCH_DB, '--apply'];
      let writeCalled = false;
      const code = await main(argv, depsOn(tx, { writeOnetStore: async () => { writeCalled = true; } }));
      expect(code).toBe(0);
      expect(writeCalled).toBe(true);
    });
  });

  it('an unknown --release refuses before any read (m4) — exit 2, no DB call attempted', async () => {
    await inRolledBackTx(async (tx) => {
      let readCalled = false;
      const argv = ['--dir', FIXTURES_DIR, '--release', '32.0', '--expect-db', SCRATCH_DB, '--apply'];
      const code = await main(argv, depsOn(tx, { readRatedOnetCodes: async () => { readCalled = true; return new Set<string>(); } }));
      expect(code).toBe(2);
      expect(readCalled).toBe(false);
    });
  });

  // Red-proof / m7: a write failure must print the short driver message
  // (via formatDbError), not crash with an unhandled rejection. Simulates
  // drizzle-orm's real shape — a wrapper error whose OWN .message is a
  // full query dump, with the short, useful message on .cause.
  it('a write failure returns exit 1 and prints the short driver message, not the query dump (m7)', async () => {
    await inRolledBackTx(async (tx) => {
      const argv = ['--dir', FIXTURES_DIR, '--release', KNOWN_RELEASE, '--expect-db', SCRATCH_DB, '--apply'];
      const queryDump = 'Failed query: insert into "onet_occupations" (...) values ($1, $2, $3, /* …thousands of characters of bound params… */)';
      const driverMessage = 'duplicate key value violates unique constraint "onet_occupations_pkey"';
      const wrapped = new Error(queryDump, { cause: new Error(driverMessage) });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const code = await main(argv, depsOn(tx, { writeOnetStore: async () => { throw wrapped; } }));
        expect(code).toBe(1);
        expect(errSpy).toHaveBeenCalledWith(driverMessage);
        expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining('Failed query'));
      } finally {
        errSpy.mockRestore();
      }
    });
  });
});
