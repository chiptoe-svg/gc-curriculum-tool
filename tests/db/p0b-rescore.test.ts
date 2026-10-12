// @vitest-environment node
// P0b Task 7 — owner-gated re-score script
// (scripts/migrations/2026-10-12-p0b-rescore.ts). Needs the POST-0057 schema
// (sub_competencies.merged_into, p0b_premerge_survivor_coverage,
// snapshot_competency_coverage keyed (snapshot, competency)), so this is
// gated on isP0bMainDb(), same as the other post-0057 DB tests.
//
// The scorer (scoreSnapshotCompetencies) and the wiki writer (writeMergedStub,
// regenerateWikiForSnapshot) are ALWAYS mocked here — this suite makes no
// paid AI calls and never touches the wiki repo. Everything else (the scope
// query, the catalog reads, upsertCoverageCell) runs for real against the
// scratch database, with a fixture course+snapshot created in each test and
// removed afterward.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots, snapshotCompetencyCoverage } from '@/lib/db/schema';
import {
  main,
  runRescore,
  findInScopeSnapshots,
  shouldWriteWiki,
  LIVE_DB_NAME,
  SURVIVOR_IDS,
  type RescoreDeps,
} from '@/scripts/migrations/2026-10-12-p0b-rescore';
import { SCRATCH_DB, isP0bMainDb } from './p0b/scratch-guard';

const RUN = isP0bMainDb();

const TEST_CODE = 'ZZ 9992'; // never a real course — distinct from the other DB tests' fixture codes
// I-1 fix (hostile review): off-path (builds_to_career=false) program-visible
// course — must now be IN scope (the owner's 8b decision: career views and
// scoring count every program-visible course, not just builds_to_career).
const OFFPATH_CODE = 'ZZ 9991';
// I-1/M-8 fix: a course with TWO non-retired snapshots for the SAME
// instructor — an older one with a group-member cell, and a newer (so
// "latest") one with no coverage at all. Scope must include the OLDER
// snapshot even though it isn't the latest capture for that instructor.
const MULTI_CODE = 'ZZ 9990';
const PROFILE = { course_code: TEST_CODE, scale_version: 'v1' } as never;
const INPUTS_META = { catalog: {}, builderProfilePresent: false, materials: [], prereqSnapshotsUsed: [], scanPasses: {} } as never;

/**
 * A fixture course + latest non-retired snapshot, with ONE merged-away
 * member's history cell (gc-production-literacy) — this is what the scope
 * query (findInScopeSnapshots) reads to decide the snapshot is in scope. The
 * fixture never gets a survivor (domain-knowledge/project-management) row of
 * its own, so "old" is expected to be null in the report rows.
 */
async function newFixtureSnapshot(): Promise<string> {
  await db.insert(courses).values({
    code: TEST_CODE, title: 'P0b rescore test course', level: 9000, track: 'test', buildsToCareer: true,
  } as never).onConflictDoNothing();
  const [snap] = await db.insert(courseCaptureSnapshots).values({
    courseCode: TEST_CODE, profile: PROFILE, inputsMeta: INPUTS_META, scaleVersion: 'v1', model: 'test',
    instructorName: 'P0b Rescore Test', createdAt: new Date('2026-10-12T00:00:00Z'),
  } as never).returning({ id: courseCaptureSnapshots.id });
  const snapshotId = snap!.id;
  await db.insert(snapshotCompetencyCoverage).values({
    snapshotId, competencyId: 'gc-production-literacy', kDepth: 2, uDepth: 2, dDepth: 2,
    matchedCompetency: null, evidenceExcerpt: null, confidence: 'high' as const, rationale: 'fixture premerge member', model: 'test',
  } as never);
  return snapshotId;
}

async function cleanupFixture(): Promise<void> {
  for (const code of [TEST_CODE, OFFPATH_CODE, MULTI_CODE]) {
    await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, code));
    await db.delete(courses).where(eq(courses.code, code));
  }
}

/** Off-path (builds_to_career=false) program-visible course, one non-retired
 * snapshot with a group-member cell (domain-grounding). */
async function newOffPathFixtureSnapshot(): Promise<string> {
  await db.insert(courses).values({
    code: OFFPATH_CODE, title: 'P0b rescore off-path test course', level: 9000, track: 'test', buildsToCareer: false,
  } as never).onConflictDoNothing();
  const [snap] = await db.insert(courseCaptureSnapshots).values({
    courseCode: OFFPATH_CODE, profile: { course_code: OFFPATH_CODE, scale_version: 'v1' } as never, inputsMeta: INPUTS_META,
    scaleVersion: 'v1', model: 'test', instructorName: 'P0b Rescore Off-Path Test', createdAt: new Date('2026-10-12T00:00:00Z'),
  } as never).returning({ id: courseCaptureSnapshots.id });
  const snapshotId = snap!.id;
  await db.insert(snapshotCompetencyCoverage).values({
    snapshotId, competencyId: 'domain-grounding', kDepth: 1, uDepth: 1, dDepth: 1,
    matchedCompetency: null, evidenceExcerpt: null, confidence: 'high' as const, rationale: 'fixture off-path member', model: 'test',
  } as never);
  return snapshotId;
}

/** Same (course, instructor), two non-retired snapshots: an OLDER one with a
 * group-member cell, and a NEWER ("latest") one with no coverage at all. */
async function newMultiSnapshotFixture(): Promise<{ older: string; newer: string }> {
  await db.insert(courses).values({
    code: MULTI_CODE, title: 'P0b rescore multi-snapshot test course', level: 9000, track: 'test', buildsToCareer: true,
  } as never).onConflictDoNothing();
  const [older] = await db.insert(courseCaptureSnapshots).values({
    courseCode: MULTI_CODE, profile: { course_code: MULTI_CODE, scale_version: 'v1' } as never, inputsMeta: INPUTS_META,
    scaleVersion: 'v1', model: 'test', instructorName: 'Same Instructor', createdAt: new Date('2026-01-01T00:00:00Z'),
  } as never).returning({ id: courseCaptureSnapshots.id });
  await db.insert(snapshotCompetencyCoverage).values({
    snapshotId: older!.id, competencyId: 'timeline-management', kDepth: 1, uDepth: 1, dDepth: 1,
    matchedCompetency: null, evidenceExcerpt: null, confidence: 'high' as const, rationale: 'fixture older-snapshot member', model: 'test',
  } as never);
  const [newer] = await db.insert(courseCaptureSnapshots).values({
    courseCode: MULTI_CODE, profile: { course_code: MULTI_CODE, scale_version: 'v1' } as never, inputsMeta: INPUTS_META,
    scaleVersion: 'v1', model: 'test', instructorName: 'Same Instructor', createdAt: new Date('2026-06-01T00:00:00Z'),
  } as never).returning({ id: courseCaptureSnapshots.id });
  return { older: older!.id, newer: newer!.id };
}

const FIXED_SCORE_RESULT = {
  result: {
    snapshot_id: 'irrelevant',
    generated_at: '2026-10-12T00:00:00.000Z',
    cells: [
      { competency_id: 'domain-knowledge', matched_competency: 'm', k_depth: 3, u_depth: 3, d_depth: 3, evidence_excerpt: 'e', confidence: 'high' as const, rationale: 'fixture re-score' },
      { competency_id: 'project-management', matched_competency: 'm', k_depth: 2, u_depth: 2, d_depth: 2, evidence_excerpt: 'e', confidence: 'high' as const, rationale: 'fixture re-score' },
    ],
  },
  model: 'test-model',
  costUsdCents: 123,
};

function mockDeps(overrides: Partial<RescoreDeps> = {}): RescoreDeps {
  return {
    scoreSnapshotCompetencies: vi.fn().mockResolvedValue(FIXED_SCORE_RESULT),
    checkDailyCap: vi.fn().mockResolvedValue({ ok: true, spentCents: 0, overCap: false }),
    recordSpend: vi.fn().mockResolvedValue(undefined),
    writeMergedStub: vi.fn().mockResolvedValue({ sha: 'deadbeef' }),
    regenerateWikiForSnapshot: vi.fn().mockResolvedValue({ sha: 'deadbeef' }),
    ...overrides,
  };
}

// Pure decision-function tests — no DB connection of any kind, so these run
// regardless of RUN/isP0bMainDb and never touch (or need to touch) a real
// 'gc_curriculum' connection. This is the "unit-level test of the decision
// function" for the live-named case the hard rules call for.
describe('shouldWriteWiki (fix: wiki writes only against --expect-db gc_curriculum)', () => {
  it('is true only for the live db name with --skip-wiki not passed', () => {
    expect(shouldWriteWiki({ apply: true, expectDb: LIVE_DB_NAME, skipWiki: false })).toBe(true);
  });

  it('--skip-wiki remains an explicit opt-out even against the live db name', () => {
    expect(shouldWriteWiki({ apply: true, expectDb: LIVE_DB_NAME, skipWiki: true })).toBe(false);
  });

  it('is false for any non-live --expect-db, regardless of --skip-wiki (the forgotten-flag case)', () => {
    expect(shouldWriteWiki({ apply: true, expectDb: 'gc_curriculum_p0b_scratch', skipWiki: false })).toBe(false);
    expect(shouldWriteWiki({ apply: true, expectDb: 'gc_curriculum_p0b_scratch', skipWiki: true })).toBe(false);
    expect(shouldWriteWiki({ apply: true, expectDb: 'gc_curriculum_p0b_pre', skipWiki: false })).toBe(false);
  });
});

describe.skipIf(!RUN)('findInScopeSnapshots scope (I-1 hostile-review fix: program-visible, not builds_to_career; every non-retired snapshot, not just the latest)', () => {
  afterEach(cleanupFixture);

  it('includes an off-path (builds_to_career=false) program-visible snapshot with a group-member cell', async () => {
    const snapshotId = await newOffPathFixtureSnapshot();

    const scope = await findInScopeSnapshots();

    expect(scope.map(s => s.snapshotId)).toContain(snapshotId);
    const row = scope.find(s => s.snapshotId === snapshotId);
    expect(row!.courseCode).toBe(OFFPATH_CODE);
  });

  it('includes an OLDER non-retired snapshot with a group-member cell even when a NEWER snapshot for the same instructor has no cell at all (M-8)', async () => {
    const { older, newer } = await newMultiSnapshotFixture();

    const scope = await findInScopeSnapshots();

    expect(scope.map(s => s.snapshotId)).toContain(older);
    // The newer snapshot has no group-member cell of its own, so it has no
    // business in THIS script's scope (listStaleSnapshots's "missing cell"
    // bulk refresh is a separate, later concern) — it simply never appears.
    expect(scope.map(s => s.snapshotId)).not.toContain(newer);
  });
});

describe.skipIf(!RUN)('p0b rescore script (P0b Task 7, post-0057)', () => {
  afterEach(cleanupFixture);

  it('--dry-run writes nothing: no scoring call, no cell upsert, no wiki write', async () => {
    await newFixtureSnapshot();
    const deps = mockDeps();

    const code = await main(['--dry-run', '--expect-db', SCRATCH_DB], deps);

    expect(code).toBe(0);
    expect(deps.scoreSnapshotCompetencies).not.toHaveBeenCalled();
    expect(deps.checkDailyCap).not.toHaveBeenCalled();
    expect(deps.recordSpend).not.toHaveBeenCalled();
    expect(deps.writeMergedStub).not.toHaveBeenCalled();
    expect(deps.regenerateWikiForSnapshot).not.toHaveBeenCalled();

    const fixtureRows = await db.select({ competencyId: snapshotCompetencyCoverage.competencyId })
      .from(snapshotCompetencyCoverage)
      .innerJoin(courseCaptureSnapshots, eq(courseCaptureSnapshots.id, snapshotCompetencyCoverage.snapshotId))
      .where(eq(courseCaptureSnapshots.courseCode, TEST_CODE));
    // Only the fixture's own pre-seeded merged-away row — the dry run added nothing.
    expect(fixtureRows.map(r => r.competencyId)).toEqual(['gc-production-literacy']);
  });

  it('--apply upserts exactly 2 cells (domain-knowledge, project-management) for the in-scope snapshot', async () => {
    const snapshotId = await newFixtureSnapshot();
    // Scoped to ONLY the fixture snapshot — never the real scope query.
    // Without this override, runRescore's default findInScopeSnapshots would
    // hit every real in-scope snapshot in the shared scratch database and
    // overwrite its cells with this test's fixed mock score.
    const deps = mockDeps({ findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]) });

    const outcome = await runRescore({ apply: true, expectDb: SCRATCH_DB, skipWiki: true }, deps);

    expect(outcome.scope).toEqual([{ snapshotId, courseCode: TEST_CODE }]);
    expect(outcome.snapshotsProcessed).toBe(1);
    expect(outcome.cappedEarly).toBe(false);

    expect(outcome.rows).toHaveLength(2);
    expect(outcome.rows.map(r => r.competencyId).sort()).toEqual(['domain-knowledge', 'project-management']);
    for (const r of outcome.rows) expect(r.old).toBeNull(); // fixture never had a survivor row before this run

    const dbRows = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
    const survivorRows = dbRows.filter(r => SURVIVOR_IDS.includes(r.competencyId));
    expect(survivorRows).toHaveLength(2);
    expect(survivorRows.map(r => r.model)).toEqual(['test-model', 'test-model']);

    // skipWiki: true — no wiki writes at all, even though apply ran for real.
    expect(deps.writeMergedStub).not.toHaveBeenCalled();
    expect(deps.regenerateWikiForSnapshot).not.toHaveBeenCalled();
  });

  it('--apply against scratch WITHOUT --skip-wiki still makes 0 wiki calls — only --expect-db gc_curriculum writes wiki', async () => {
    const snapshotId = await newFixtureSnapshot();
    // Scoped to ONLY the fixture snapshot — see note above.
    const deps = mockDeps({ findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]) });

    // SCRATCH_DB !== LIVE_DB_NAME, so even with skipWiki left false (forgetting
    // --skip-wiki, the exact scenario this guard exists for), no wiki write may happen.
    expect(SCRATCH_DB).not.toBe(LIVE_DB_NAME);
    const outcome = await runRescore({ apply: true, expectDb: SCRATCH_DB, skipWiki: false }, deps);

    expect(outcome.wikiWritesEnabled).toBe(false);
    expect(deps.writeMergedStub).not.toHaveBeenCalled();
    expect(deps.regenerateWikiForSnapshot).not.toHaveBeenCalled();
  });

  // --- I-2 (hostile review): wiki regenerations must be AWAITED, not fired
  // and dropped by process.exit. These call runRescore directly with
  // expectDb: LIVE_DB_NAME (shouldWriteWiki is a pure function of args —
  // no real 'gc_curriculum' connection is involved; the executor/db
  // connection underneath is still the real scratch database throughout).
  it('awaits a slow wiki regeneration before returning — it is not dropped (I-2)', async () => {
    const snapshotId = await newFixtureSnapshot();
    let resolved = false;
    const regen = vi.fn().mockImplementation(() => new Promise(resolve => {
      setTimeout(() => { resolved = true; resolve({ sha: 'deadbeef' }); }, 50);
    }));
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
      regenerateWikiForSnapshot: regen,
    });

    const outcome = await runRescore({ apply: true, expectDb: LIVE_DB_NAME, skipWiki: false }, deps);

    // By the time runRescore's promise resolves, the slow regen must
    // already have resolved too — proves it was awaited, not fired and
    // forgotten the way a bare call to regenerateWikiInBackground would be.
    expect(resolved).toBe(true);
    expect(regen).toHaveBeenCalledWith(snapshotId, expect.any(String));
    expect(outcome.wikiResults).toEqual([{ snapshotId, courseCode: TEST_CODE, ok: true }]);
  });

  it('a failed wiki regeneration does not undo the DB cell writes, is reported per snapshot, and main() exits non-zero', async () => {
    const snapshotId = await newFixtureSnapshot();
    const regen = vi.fn().mockRejectedValue(new Error('simulated git push failure'));
    // assertExpectedDb (main()'s own db-identity check) needs a connected
    // database literally named 'gc_curriculum' to exercise the live wiki
    // path through main() — this suite only ever runs against the real
    // scratch database, so its `executor` is stubbed to answer that ONE
    // query. Every OTHER executor-consuming read is overridden below too
    // (getSurvivorCompetencies/getCarriedCells/getMergedAwayNames), so the
    // stub's `.execute()` is genuinely the only method ever called on it.
    // upsertCoverageCell is NOT parameterized by executor — it always
    // writes through the real db singleton — so the cell writes this test
    // checks for below are real, not stubbed.
    const fakeExecutor = { execute: vi.fn().mockResolvedValue({ rows: [{ name: LIVE_DB_NAME }] }) } as unknown as RescoreDeps['executor'];
    const deps = mockDeps({
      executor: fakeExecutor,
      findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
      getSurvivorCompetencies: vi.fn().mockResolvedValue([
        { id: 'domain-knowledge', name: 'Domain knowledge', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd' },
        { id: 'project-management', name: 'Project management', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd' },
      ]),
      getCarriedCells: vi.fn().mockResolvedValue({}),
      getMergedAwayNames: vi.fn().mockResolvedValue({}),
      regenerateWikiForSnapshot: regen,
    });

    const code = await main(['--apply', '--expect-db', LIVE_DB_NAME], deps);

    expect(code).not.toBe(0);
    // The DB cell writes from scoring are NOT undone by the wiki failure.
    const dbRows = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
    const survivorRows = dbRows.filter(r => SURVIVOR_IDS.includes(r.competencyId));
    expect(survivorRows).toHaveLength(2);
  });

  it('runRescore itself reports the failed wiki regeneration per snapshot without throwing', async () => {
    const snapshotId = await newFixtureSnapshot();
    const regen = vi.fn().mockRejectedValue(new Error('simulated git push failure'));
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
      regenerateWikiForSnapshot: regen,
    });

    const outcome = await runRescore({ apply: true, expectDb: LIVE_DB_NAME, skipWiki: false }, deps);

    expect(outcome.wikiResults).toEqual([{ snapshotId, courseCode: TEST_CODE, ok: false, error: 'simulated git push failure' }]);
    // Scoring itself still fully succeeded despite the wiki failure.
    expect(outcome.rows).toHaveLength(2);
  });

  it('a failed merged-stub write is also reported and does not throw out of runRescore', async () => {
    const snapshotId = await newFixtureSnapshot();
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
      writeMergedStub: vi.fn().mockRejectedValue(new Error('simulated stub push failure')),
    });

    const outcome = await runRescore({ apply: true, expectDb: LIVE_DB_NAME, skipWiki: false }, deps);

    expect(outcome.stubResults.every(r => r.ok === false)).toBe(true);
    expect(outcome.stubResults).toHaveLength(3);
  });

  it('a wrong --expect-db exits non-zero before any read', async () => {
    const findInScopeSnapshots = vi.fn();
    const deps: RescoreDeps = { ...mockDeps(), findInScopeSnapshots };

    const code = await main(['--apply', '--expect-db', 'definitely-not-the-connected-database'], deps);

    expect(code).not.toBe(0);
    expect(findInScopeSnapshots).not.toHaveBeenCalled();
    expect(deps.scoreSnapshotCompetencies).not.toHaveBeenCalled();
    expect(deps.checkDailyCap).not.toHaveBeenCalled();
  });

  it('a missing --expect-db refuses before touching the database at all', async () => {
    const findInScopeSnapshots = vi.fn();
    const deps: RescoreDeps = { ...mockDeps(), findInScopeSnapshots };

    const code = await main(['--dry-run'], deps);

    expect(code).not.toBe(0);
    expect(findInScopeSnapshots).not.toHaveBeenCalled();
  });
});
