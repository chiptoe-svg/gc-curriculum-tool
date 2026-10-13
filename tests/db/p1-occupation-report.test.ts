// @vitest-environment node
// P1 hostile-review fix wave, m4: occupation-report.ts's release selection
// used to be `SELECT release, attribution FROM onet_release` with no WHERE
// and no ORDER BY — "picks one arbitrarily" the moment a second release
// row exists. Gated isP1MainDb(): onet_release only exists once 0058 is
// applied. Every case runs inside its own rolled-back transaction, so the
// scratch DB's real onet_release row (from Task 4's real load) is never
// actually touched.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { onetRelease } from '@/lib/db/schema';
import { runReport } from '@/scripts/careers/occupation-report';
import type { Tx } from '@/scripts/careers/ingest-alumni-mix';
import { isP1MainDb } from './p1/scratch-guard';

const RUN = isP1MainDb();

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

describe.skipIf(!RUN)('P1 m4: occupation-report release selection (scratch DB only)', () => {
  it('an unknown --release refuses, naming the release', async () => {
    await inRolledBackTx(async (tx) => {
      await expect(runReport(tx, 'not-a-real-release')).rejects.toThrow(/release "not-a-real-release" has no onet_release row/);
    });
  });

  it('a known --release is accepted and named in the output', async () => {
    await inRolledBackTx(async (tx) => {
      // Real release from Task 4's load, still present on the scratch DB.
      const lines = await runReport(tx, '31.0');
      expect(lines[0]).toBe('release: 31.0');
    });
  });

  it('omitting --release picks the MOST RECENTLY LOADED release, not an arbitrary row — the actual m4 bug', async () => {
    await inRolledBackTx(async (tx) => {
      // A second, synthetic release row, loaded (by loaded_at) strictly
      // AFTER the real '31.0' row. Before the fix, the unordered,
      // unfiltered SELECT could return either row depending on physical
      // storage order; the fix must deterministically pick this one.
      await tx.insert(onetRelease).values({
        release: 'zz-test-newer-release',
        published: 'Someday',
        license: 'CC BY 4.0',
        attribution: 'ZZ test attribution',
        sourceUrl: 'https://example.test/newer',
        loadedAt: new Date('2099-01-01T00:00:00Z'),
      });
      const lines = await runReport(tx);
      expect(lines[0]).toBe('release: zz-test-newer-release');
      await tx.delete(onetRelease).where(eq(onetRelease.release, 'zz-test-newer-release'));
    });
  });

  it('with no release loaded at all, the report still runs and states so, printing no attribution', async () => {
    await inRolledBackTx(async (tx) => {
      // Clearing onet_release cascades onet_occupations etc. — fine, this
      // whole case rolls back.
      await tx.delete(onetRelease);
      const lines = await runReport(tx);
      expect(lines[0]).toBe('(no O*NET release loaded)');
      expect(lines.some(l => l.includes('CC BY 4.0'))).toBe(false);
    });
  });
});
