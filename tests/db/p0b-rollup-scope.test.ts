// @vitest-environment node
// P0b Task 8b / Amendment 1 (A2) — rollup isolation. Scoring scope widened to
// every program-visible course (listStaleSnapshots, tested in
// p0b-scoring.test.ts); this file proves the OTHER half holds: a coverage
// cell on an off-path course (builds_to_career = false) must never change
// what a career-rollup reader reports for a target, even though the
// per-competency wiki substrate correctly DOES pick it up.
//
// Needs the POST-0057 schema, so gated on isP0bMainDb() like the other
// post-0057 DB tests.
//
// Two approaches, per reader (Resolution 2 in the task brief):
//   - getMatrixData has no injectable executor and calls into another
//     module (listPairedCodesForCourses) that reads the bare `db` itself —
//     threading a transaction through it would be a real refactor, so it's
//     tested with a COMMITTED fixture course, cleaned up in try/finally
//     (same pattern as tests/db/p0b-rescore.test.ts).
//   - loadScaffoldingTarget and loadTargetSubstrate are each one
//     self-contained function with no cross-module DB calls, so Task 8b
//     gave each an optional trailing `executor` parameter (same shape as
//     listStaleSnapshots's) and this file exercises them inside ONE
//     rolled-back transaction, same pattern as p0b-scoring.test.ts /
//     p0b-retire-competency.test.ts.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  courses,
  courseCaptureSnapshots,
  snapshotCompetencyCoverage,
  targetSubCompetencies,
} from '@/lib/db/schema';
import { getMatrixData } from '@/lib/db/program-coverage-queries';
import { loadScaffoldingTarget } from '@/lib/db/scaffolding-queries';
import { loadTargetSubstrate, loadCompetencySubstrate } from '@/lib/ai/wiki/update';
import { isP0bMainDb } from './p0b/scratch-guard';

const RUN = isP0bMainDb();

const PROFILE_FOR = (code: string) => ({ course_code: code, scale_version: 'v1' }) as never;
const INPUTS_META = { catalog: {}, builderProfilePresent: false, materials: [], prereqSnapshotsUsed: [], scanPasses: {} } as never;

class Rollback extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

/** Any (target, active competency) pair — generic, doesn't hardcode seed ids. */
async function pickTargetAndCompetency(executor: Tx | typeof db): Promise<{ targetId: string; competencyId: string }> {
  const [row] = await executor
    .select({ targetId: targetSubCompetencies.careerTargetId, competencyId: targetSubCompetencies.id })
    .from(targetSubCompetencies)
    .where(eq(targetSubCompetencies.retired, false))
    .limit(1);
  if (!row) throw new Error('fixture precondition failed: no active (target, competency) pair in this DB');
  return row;
}

describe.skipIf(!RUN)('rollup isolation — an off-path cell never changes a career rollup (P0b Amendment 1, A2)', () => {
  it('getMatrixData: a D=5 cell on a new off-path course snapshot leaves the target\'s cells byte-identical; the competency wiki substrate DOES pick it up', async () => {
    const { targetId, competencyId } = await pickTargetAndCompetency(db);
    const TEST_CODE = 'ZZ 9994'; // never a real course — distinct from the other DB tests' fixture codes

    const cleanup = async () => {
      await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, TEST_CODE));
      await db.delete(courses).where(eq(courses.code, TEST_CODE));
    };
    await cleanup(); // defensive, in case a previous run was interrupted before cleanup

    const before = await getMatrixData();
    const beforeTargetCells = JSON.stringify(before.cells.filter(c => c.careerTargetId === targetId));
    const beforeCourseCount = before.courses.length;

    try {
      // Off-path, program-visible: scope='gc' (default), status='offered'
      // (default), builds_to_career=false.
      await db.insert(courses).values({
        code: TEST_CODE, title: 'P0b rollup-isolation off-path fixture', level: 9000, track: 'test', buildsToCareer: false,
      } as never);
      const [snap] = await db.insert(courseCaptureSnapshots).values({
        courseCode: TEST_CODE, profile: PROFILE_FOR(TEST_CODE), inputsMeta: INPUTS_META, scaleVersion: 'v1', model: 'test',
        instructorName: 'P0b Rollup Test', createdAt: new Date('2026-10-12T00:00:00Z'),
      } as never).returning({ id: courseCaptureSnapshots.id });
      const snapshotId = snap!.id;
      await db.insert(snapshotCompetencyCoverage).values({
        snapshotId, competencyId, kDepth: 5, uDepth: 5, dDepth: 5,
        matchedCompetency: 'fixture off-path evidence', evidenceExcerpt: 'fixture', confidence: 'high' as const,
        rationale: 'rollup-isolation fixture', model: 'test',
      } as never);

      // Career rollup: unaffected. Neither the course count nor this
      // target's cells change — the off-path course never enters
      // `matrix.courses` (builds_to_career filter), and getMatrixData's
      // cells are now restricted to snapshots in that course set.
      const after = await getMatrixData();
      expect(after.courses.length).toBe(beforeCourseCount);
      const afterTargetCells = JSON.stringify(after.cells.filter(c => c.careerTargetId === targetId));
      expect(afterTargetCells).toEqual(beforeTargetCells);

      // Per-competency view: the opposite — this off-path course's evidence
      // DOES show up (A2: competency wiki pages include every
      // program-visible course, not just builds_to_career ones).
      const substrate = await loadCompetencySubstrate(competencyId);
      expect(substrate.contributingCells.some(c => c.courseCode === TEST_CODE && c.dDepth === 5)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('loadScaffoldingTarget and loadTargetSubstrate: a D=5 cell on a new off-path course snapshot leaves the target\'s output byte-identical', async () => {
    await inRolledBackTx(async (tx) => {
      const { targetId, competencyId } = await pickTargetAndCompetency(tx);
      const TEST_CODE = 'ZZ 9994'; // never a real course — distinct from the other DB tests' fixture codes

      const beforeScaffolding = JSON.stringify(await loadScaffoldingTarget(targetId, tx), mapReplacer);
      const beforeTargetSubstrate = JSON.stringify(await loadTargetSubstrate(targetId, tx));

      await tx.insert(courses).values({
        code: TEST_CODE, title: 'P0b rollup-isolation off-path fixture (tx)', level: 9000, track: 'test', buildsToCareer: false,
      } as never);
      const [snap] = await tx.insert(courseCaptureSnapshots).values({
        courseCode: TEST_CODE, profile: PROFILE_FOR(TEST_CODE), inputsMeta: INPUTS_META, scaleVersion: 'v1', model: 'test',
        instructorName: 'P0b Rollup Test (tx)', createdAt: new Date('2026-10-12T00:00:00Z'),
      } as never).returning({ id: courseCaptureSnapshots.id });
      const snapshotId = snap!.id;
      await tx.insert(snapshotCompetencyCoverage).values({
        snapshotId, competencyId, kDepth: 5, uDepth: 5, dDepth: 5,
        matchedCompetency: 'fixture off-path evidence', evidenceExcerpt: 'fixture', confidence: 'high' as const,
        rationale: 'rollup-isolation fixture', model: 'test',
      } as never);

      const afterScaffolding = JSON.stringify(await loadScaffoldingTarget(targetId, tx), mapReplacer);
      const afterTargetSubstrate = JSON.stringify(await loadTargetSubstrate(targetId, tx));

      expect(afterScaffolding).toEqual(beforeScaffolding);
      expect(afterTargetSubstrate).toEqual(beforeTargetSubstrate);
    });
  });
});

/** JSON.stringify replacer: ScaffoldingTargetInput carries a Map, which stringifies as {} otherwise. */
function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return [...value.entries()];
  return value;
}
