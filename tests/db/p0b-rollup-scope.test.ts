// @vitest-environment node
// P0b Task 8b — career-rollup course scope.
//
// Owner decision (2026-10-12, fix round 1) SUPERSEDES Amendment 1 ruling A2's
// "career rollups stay builds_to_career-only": career views now count every
// PROGRAM-VISIBLE course (scope='gc' AND status='offered'), same scope as
// scoring (listStaleSnapshots, tested in p0b-scoring.test.ts) — not
// restricted to builds_to_career. Only external, sandbox and non-offered
// courses are excluded from a career rollup; an off-path (builds_to_career=
// false) GC/offered course counts the same as an on-path one. The matrix's
// own ROW list (which courses get a row in the `/program` UI) is unchanged
// and stays builds_to_career=true — that's a display choice, not a rollup
// scope question.
//
// This file proves BOTH directions for every career-rollup reader:
//   - an off-path (builds_to_career=false) GC/offered course's cell DOES
//     reach the rollup;
//   - an external or sandbox course's cell does NOT.
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
//   - loadCompetencySubstrate (a per-competency view, never builds_to_career-
//     restricted even before this decision) has no executor param either;
//     its test uses the same committed-fixture pattern as getMatrixData's.
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

describe.skipIf(!RUN)('career-rollup course scope — program-visible, not builds_to_career (owner decision, 2026-10-12)', () => {
  it('getMatrixData: an off-path (builds_to_career=false) GC/offered course\'s D=5 cell DOES reach the target rollup, even though it is not a matrix row', async () => {
    const { targetId, competencyId } = await pickTargetAndCompetency(db);
    const TEST_CODE = 'ZZ 9994'; // never a real course — distinct from the other DB tests' fixture codes

    const cleanup = async () => {
      await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, TEST_CODE));
      await db.delete(courses).where(eq(courses.code, TEST_CODE));
    };
    await cleanup(); // defensive, in case a previous run was interrupted before cleanup

    const before = await getMatrixData();
    const beforeCourseCount = before.courses.length;

    try {
      // Off-path, program-visible: scope='gc' (default), status='offered'
      // (default), builds_to_career=false.
      await db.insert(courses).values({
        code: TEST_CODE, title: 'P0b off-path rollup fixture', level: 9000, track: 'test', buildsToCareer: false,
      } as never);
      const [snap] = await db.insert(courseCaptureSnapshots).values({
        courseCode: TEST_CODE, profile: PROFILE_FOR(TEST_CODE), inputsMeta: INPUTS_META, scaleVersion: 'v1', model: 'test',
        instructorName: 'P0b Rollup Test', createdAt: new Date('2026-10-12T00:00:00Z'),
      } as never).returning({ id: courseCaptureSnapshots.id });
      const snapshotId = snap!.id;
      await db.insert(snapshotCompetencyCoverage).values({
        snapshotId, competencyId, kDepth: 5, uDepth: 5, dDepth: 5,
        matchedCompetency: 'fixture off-path evidence', evidenceExcerpt: 'fixture', confidence: 'high' as const,
        rationale: 'off-path rollup fixture', model: 'test',
      } as never);

      const after = await getMatrixData();
      // Matrix ROWS (display) are unchanged — builds_to_career=true, as today.
      expect(after.courses.length).toBe(beforeCourseCount);
      expect(after.courses.some(c => c.courseCode === TEST_CODE)).toBe(false);
      // But the career ROLLUP for this target now includes the off-path cell.
      const cell = after.cells.find(c => c.snapshotId === snapshotId && c.careerTargetId === targetId && c.subCompetencyId === competencyId);
      expect(cell).toBeDefined();
      expect(cell!.dDepth).toBe(5);
    } finally {
      await cleanup();
    }
  });

  it('getMatrixData: an external/sandbox course\'s D=5 cell does NOT reach the target rollup', async () => {
    const { targetId, competencyId } = await pickTargetAndCompetency(db);
    const TEST_CODE = 'ZZ 9988'; // never a real course — distinct from the other DB tests' fixture codes

    const cleanup = async () => {
      await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, TEST_CODE));
      await db.delete(courses).where(eq(courses.code, TEST_CODE));
    };
    await cleanup();

    const before = await getMatrixData();
    const beforeTargetCells = JSON.stringify(before.cells.filter(c => c.careerTargetId === targetId));

    try {
      await db.insert(courses).values({
        code: TEST_CODE, title: 'P0b sandbox rollup fixture', level: 9000, track: 'test', buildsToCareer: false,
        scope: 'external', status: 'sandbox',
      } as never);
      const [snap] = await db.insert(courseCaptureSnapshots).values({
        courseCode: TEST_CODE, profile: PROFILE_FOR(TEST_CODE), inputsMeta: INPUTS_META, scaleVersion: 'v1', model: 'test',
        instructorName: 'P0b Rollup Test', createdAt: new Date('2026-10-12T00:00:00Z'),
      } as never).returning({ id: courseCaptureSnapshots.id });
      await db.insert(snapshotCompetencyCoverage).values({
        snapshotId: snap!.id, competencyId, kDepth: 5, uDepth: 5, dDepth: 5,
        matchedCompetency: 'fixture sandbox evidence', evidenceExcerpt: 'fixture', confidence: 'high' as const,
        rationale: 'sandbox rollup fixture', model: 'test',
      } as never);

      const after = await getMatrixData();
      const afterTargetCells = JSON.stringify(after.cells.filter(c => c.careerTargetId === targetId));
      expect(afterTargetCells).toEqual(beforeTargetCells);
    } finally {
      await cleanup();
    }
  });

  it('loadScaffoldingTarget and loadTargetSubstrate: an off-path GC/offered course\'s D=5 cell DOES change the target\'s output', async () => {
    await inRolledBackTx(async (tx) => {
      const { targetId, competencyId } = await pickTargetAndCompetency(tx);
      const TEST_CODE = 'ZZ 9994'; // never a real course — distinct from the other DB tests' fixture codes (tx-isolated, reused from the getMatrixData test above)

      await tx.insert(courses).values({
        code: TEST_CODE, title: 'P0b off-path rollup fixture (tx)', level: 9000, track: 'test', buildsToCareer: false,
      } as never);
      const [snap] = await tx.insert(courseCaptureSnapshots).values({
        courseCode: TEST_CODE, profile: PROFILE_FOR(TEST_CODE), inputsMeta: INPUTS_META, scaleVersion: 'v1', model: 'test',
        instructorName: 'P0b Rollup Test (tx)', createdAt: new Date('2026-10-12T00:00:00Z'),
      } as never).returning({ id: courseCaptureSnapshots.id });
      const snapshotId = snap!.id;
      await tx.insert(snapshotCompetencyCoverage).values({
        snapshotId, competencyId, kDepth: 5, uDepth: 5, dDepth: 5,
        matchedCompetency: 'fixture off-path evidence', evidenceExcerpt: 'fixture', confidence: 'high' as const,
        rationale: 'off-path rollup fixture', model: 'test',
      } as never);

      const scaffolding = await loadScaffoldingTarget(targetId, tx);
      expect(scaffolding!.courses.some(c => c.courseCode === TEST_CODE)).toBe(true);
      const cells = scaffolding!.cellsBySubCompetency.get(competencyId) ?? [];
      expect(cells.some(c => c.courseCode === TEST_CODE && c.dDepth === 5)).toBe(true);

      const targetSubstrate = await loadTargetSubstrate(targetId, tx);
      const rollupEntry = targetSubstrate.coverageRollup.find(r => r.subCompetencyId === competencyId);
      expect(rollupEntry).toBeDefined();
      expect(rollupEntry!.dDepth).toBe(5);
      expect(rollupEntry!.bestCourseCode).toBe(TEST_CODE);
    });
  });

  it('loadScaffoldingTarget and loadTargetSubstrate: an external/sandbox course\'s D=5 cell leaves the target\'s output byte-identical', async () => {
    await inRolledBackTx(async (tx) => {
      const { targetId, competencyId } = await pickTargetAndCompetency(tx);
      const TEST_CODE = 'ZZ 9987'; // never a real course — distinct from the other DB tests' fixture codes

      const beforeScaffolding = JSON.stringify(await loadScaffoldingTarget(targetId, tx), mapReplacer);
      const beforeTargetSubstrate = JSON.stringify(await loadTargetSubstrate(targetId, tx));

      await tx.insert(courses).values({
        code: TEST_CODE, title: 'P0b sandbox rollup fixture (tx)', level: 9000, track: 'test', buildsToCareer: false,
        scope: 'external', status: 'sandbox',
      } as never);
      const [snap] = await tx.insert(courseCaptureSnapshots).values({
        courseCode: TEST_CODE, profile: PROFILE_FOR(TEST_CODE), inputsMeta: INPUTS_META, scaleVersion: 'v1', model: 'test',
        instructorName: 'P0b Rollup Test (tx)', createdAt: new Date('2026-10-12T00:00:00Z'),
      } as never).returning({ id: courseCaptureSnapshots.id });
      const snapshotId = snap!.id;
      await tx.insert(snapshotCompetencyCoverage).values({
        snapshotId, competencyId, kDepth: 5, uDepth: 5, dDepth: 5,
        matchedCompetency: 'fixture sandbox evidence', evidenceExcerpt: 'fixture', confidence: 'high' as const,
        rationale: 'sandbox rollup fixture', model: 'test',
      } as never);

      const afterScaffolding = JSON.stringify(await loadScaffoldingTarget(targetId, tx), mapReplacer);
      const afterTargetSubstrate = JSON.stringify(await loadTargetSubstrate(targetId, tx));

      expect(afterScaffolding).toEqual(beforeScaffolding);
      expect(afterTargetSubstrate).toEqual(beforeTargetSubstrate);
    });
  });

  it('loadCompetencySubstrate: an external/sandbox course snapshot never appears on a competency page (fix round 1 — unaffected by the owner decision, always program-visible scope)', async () => {
    const { competencyId } = await pickTargetAndCompetency(db);
    const CODE = 'ZZ 9986'; // never a real course — distinct from the other DB tests' fixture codes

    const cleanup = async () => {
      await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, CODE));
      await db.delete(courses).where(eq(courses.code, CODE));
    };
    await cleanup(); // defensive, in case a previous run was interrupted before cleanup

    try {
      await db.insert(courses).values({
        code: CODE, title: 'P0b sandbox competency-substrate fixture', level: 9000, track: 'test', buildsToCareer: false,
        scope: 'external', status: 'sandbox',
      } as never);
      const [snap] = await db.insert(courseCaptureSnapshots).values({
        courseCode: CODE, profile: PROFILE_FOR(CODE), inputsMeta: INPUTS_META, scaleVersion: 'v1', model: 'test',
        instructorName: 'P0b Sandbox Test', createdAt: new Date('2026-10-12T00:00:00Z'),
      } as never).returning({ id: courseCaptureSnapshots.id });
      await db.insert(snapshotCompetencyCoverage).values({
        snapshotId: snap!.id, competencyId, kDepth: 5, uDepth: 5, dDepth: 5,
        matchedCompetency: 'fixture sandbox evidence', evidenceExcerpt: 'fixture', confidence: 'high' as const,
        rationale: 'program-visible-scope fixture', model: 'test',
      } as never);

      const substrate = await loadCompetencySubstrate(competencyId);
      expect(substrate.contributingCells.some(c => c.courseCode === CODE)).toBe(false);
    } finally {
      await cleanup();
    }
  });
});

/** JSON.stringify replacer: ScaffoldingTargetInput carries a Map, which stringifies as {} otherwise. */
function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return [...value.entries()];
  return value;
}
