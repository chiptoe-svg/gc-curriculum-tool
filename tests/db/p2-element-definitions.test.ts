// @vitest-environment node
// P2 Task 3 — DB tests for loading O*NET element definitions into the
// onet_element_definitions table (scratch DB only).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { db } from '@/lib/db/client';
import {
  careerTargetOccupations,
  careerTargets,
  onetElementDefinitions,
} from '@/lib/db/schema';
import {
  readRatedOnetCodes,
  readAndFilter,
  writeOnetStore,
  type Tx,
} from '@/scripts/onet/load-onet';
import { getOnetReleaseMetadata, type OnetReleaseMetadata } from '@/lib/onet/load';
import { isP2ScratchDb } from './p2/scratch-guard';

const RUN = isP2ScratchDb();
const FIXTURES_DIR = path.join(process.cwd(), 'tests/fixtures/onet');
const RELEASE = 'test-p2';
const TEST_RELEASE_METADATA: OnetReleaseMetadata = {
  published: 'Test Published Date',
  license: 'Test License',
  attribution: 'Test attribution text for test-p2',
  sourceUrl: 'https://example.test/test-p2',
};

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

/** Seeds exactly the mix career_target_occupations needs for this suite: two rated rows (matching fixture codes 99-0001.00/99-0002.00). */
async function seedMix(tx: Tx, careerTargetId: string): Promise<void> {
  await tx.insert(careerTargetOccupations).values([
    { careerTargetId, horizon: 'entry', socCode: '99-0001', onetSocCode: '99-0001.00', onetStatus: 'rated', count: 5, share: 0.5, source: 'faculty', sourceVersion: 'test/v1', asOf: '2026-01-01' },
    { careerTargetId, horizon: 'entry', socCode: '99-0002', onetSocCode: '99-0002.00', onetStatus: 'rated', count: 3, share: 0.3, source: 'faculty', sourceVersion: 'test/v1', asOf: '2026-01-01' },
  ]);
}

describe.skipIf(!RUN)('P2 Task 3 — element definitions (scratch DB only)', () => {
  it('readAndFilter returns elementDefinitions for exactly the element ids in the rated codes\' ratings, and 9.Z.9 is absent', async () => {
    const [target] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      await seedMix(tx, target!.id);
      const codes = await readRatedOnetCodes(tx);
      const data = readAndFilter(FIXTURES_DIR, codes);

      // Element IDs in the fixture ratings for codes 99-0001.00 and 99-0002.00:
      // From knowledge.csv: 2.C.1.a, 2.C.3.a, 2.C.2.a
      // From abilities.csv: 1.A.1.a.1, 1.A.1.b.2
      // From work_activities.csv: 4.A.1.a.1
      // From essential_skills.csv: 2.A.1.a
      // From transferable_skills.csv: 2.B.1.a
      // Total: 8 unique elements
      expect(data.elementDefinitions).toHaveLength(8);
      const defIds = new Set(data.elementDefinitions.map(d => d.elementId));
      expect(defIds.has('2.C.1.a')).toBe(true);
      expect(defIds.has('2.C.3.a')).toBe(true);
      expect(defIds.has('2.C.2.a')).toBe(true);
      expect(defIds.has('1.A.1.a.1')).toBe(true);
      expect(defIds.has('1.A.1.b.2')).toBe(true);
      expect(defIds.has('4.A.1.a.1')).toBe(true);
      expect(defIds.has('2.A.1.a')).toBe(true);
      expect(defIds.has('2.B.1.a')).toBe(true);
      // 9.Z.9 is in the fixture but not in any ratings, so it should not be in elementDefinitions
      expect(defIds.has('9.Z.9')).toBe(false);
    });
  });

  it('writeOnetStore inserts element definitions and a re-run is idempotent', async () => {
    const [target] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      await seedMix(tx, target!.id);
      const codes = await readRatedOnetCodes(tx);
      const data = readAndFilter(FIXTURES_DIR, codes);

      await writeOnetStore(tx, RELEASE, data, TEST_RELEASE_METADATA);
      const firstCount = (await tx.select().from(onetElementDefinitions).where(eq(onetElementDefinitions.release, RELEASE))).length;
      expect(firstCount).toBe(8);

      // Re-run should be idempotent (delete and re-insert the same rows)
      await writeOnetStore(tx, RELEASE, data, TEST_RELEASE_METADATA);
      const secondCount = (await tx.select().from(onetElementDefinitions).where(eq(onetElementDefinitions.release, RELEASE))).length;
      expect(secondCount).toBe(firstCount);
    });
  });

  it('readAndFilter throws if a definition is missing for a rated element', async () => {
    const [target] = await db.select({ id: careerTargets.id }).from(careerTargets).orderBy(asc(careerTargets.id)).limit(1);
    await inRolledBackTx(async (tx) => {
      await seedMix(tx, target!.id);

      // Create a temporary directory with a modified fixture where we remove
      // one definition line
      const tmpDir = path.join(process.cwd(), '.tmp-test-missing-def');
      mkdirSync(tmpDir, { recursive: true });

      try {
        // Copy all fixture files
        const fixtures = [
          'occupation_data.csv',
          'knowledge.csv',
          'abilities.csv',
          'work_activities.csv',
          'essential_skills.csv',
          'transferable_skills.csv',
          'task_statements.csv',
          'task_ratings.csv',
          'content_model_reference.csv',
        ];

        for (const file of fixtures) {
          const src = path.join(FIXTURES_DIR, file);
          const dst = path.join(tmpDir, file);
          writeFileSync(dst, readFileSync(src));
        }

        // Remove the definition for 2.C.1.a from the fixture
        const cmrPath = path.join(tmpDir, 'content_model_reference.csv');
        const cmr = readFileSync(cmrPath, 'utf8');
        const lines = cmr.split('\n');
        const filtered = lines.filter(line => !line.startsWith('2.C.1.a,'));
        writeFileSync(cmrPath, filtered.join('\n'));

        // Try to read and filter — should throw because 2.C.1.a is in the
        // ratings but not in the definitions
        const codes = await readRatedOnetCodes(tx);
        expect(() => readAndFilter(tmpDir, codes)).toThrow(/no definition for rated element 2\.C\.1\.a/);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
