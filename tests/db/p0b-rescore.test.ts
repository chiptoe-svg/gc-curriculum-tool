// @vitest-environment node
// P0b Task 7 — owner-gated re-score script
// (scripts/migrations/2026-10-12-p0b-rescore.ts). Needs the POST-0057 schema
// (sub_competencies.merged_into, p0b_premerge_survivor_coverage,
// snapshot_competency_coverage keyed (snapshot, competency)), so this is
// gated on isP0bMainDb(), same as the other post-0057 DB tests.
//
// The scorer (scoreSnapshotCompetencies) and every wiki writer
// (writeMergedStub, regenerateCoursePage, runProgramWikiPass) are ALWAYS
// mocked here — this suite makes no paid AI calls and never touches the
// wiki repo. Everything else (the scope query, the catalog reads,
// upsertCoverageCell) runs for real against the scratch database, with a
// fixture course+snapshot created in each test and removed afterward.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots, snapshotCompetencyCoverage } from '@/lib/db/schema';
import {
  main,
  runRescore,
  parseArgs,
  findInScopeSnapshots,
  findLatestNonRetiredSnapshot,
  shouldWriteWiki,
  allFailures,
  LIVE_DB_NAME,
  DEFAULT_MAX_CALLS,
  SURVIVOR_IDS,
  type RescoreArgs,
  type RescoreDeps,
} from '@/scripts/migrations/2026-10-12-p0b-rescore';
import { SCRATCH_DB, isP0bMainDb } from './p0b/scratch-guard';

const RUN = isP0bMainDb();

const TEST_CODE = 'ZZ 9992'; // never a real course — distinct from the other DB tests' fixture codes
// I-1 fix (hostile review): off-path (builds_to_career=false) program-visible
// course — must now be IN scope (the owner's 8b decision: career views and
// scoring count every program-visible course, not just builds_to_career).
const OFFPATH_CODE = 'ZZ 9991';
// I-1/M-8/I-3 fix: a course with TWO non-retired snapshots for the SAME
// instructor — an older one with a group-member cell, and a newer (so
// "latest") one with no coverage at all. Scope must include the OLDER
// snapshot even though it isn't the latest capture for that instructor
// (M-8); the wiki course regen must use the NEWER one regardless (I-3).
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
    regenerateCoursePage: vi.fn().mockResolvedValue({ sha: 'deadbeef' }),
    runProgramWikiPass: vi.fn().mockResolvedValue([{ batchIndex: 0, pages: ['index.md'], ok: true }]),
    estimateWikiCalls: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

/** RescoreArgs builder — keeps every call site from having to spell out wikiOnly/maxCalls. */
function args(overrides: Partial<RescoreArgs> = {}): RescoreArgs {
  return { apply: true, expectDb: SCRATCH_DB, skipWiki: false, wikiOnly: false, maxCalls: DEFAULT_MAX_CALLS, ...overrides };
}

// Pure decision-function tests — no DB connection of any kind, so these run
// regardless of RUN/isP0bMainDb and never touch (or need to touch) a real
// 'gc_curriculum' connection. This is the "unit-level test of the decision
// function" for the live-named case the hard rules call for.
describe('shouldWriteWiki (fix: wiki writes only against --expect-db gc_curriculum)', () => {
  it('is true only for the live db name with --skip-wiki not passed', () => {
    expect(shouldWriteWiki(args({ expectDb: LIVE_DB_NAME, skipWiki: false }))).toBe(true);
  });

  it('--skip-wiki remains an explicit opt-out even against the live db name', () => {
    expect(shouldWriteWiki(args({ expectDb: LIVE_DB_NAME, skipWiki: true }))).toBe(false);
  });

  it('is false for any non-live --expect-db, regardless of --skip-wiki (the forgotten-flag case)', () => {
    expect(shouldWriteWiki(args({ expectDb: 'gc_curriculum_p0b_scratch', skipWiki: false }))).toBe(false);
    expect(shouldWriteWiki(args({ expectDb: 'gc_curriculum_p0b_scratch', skipWiki: true }))).toBe(false);
    expect(shouldWriteWiki(args({ expectDb: 'gc_curriculum_p0b_pre', skipWiki: false }))).toBe(false);
  });
});

describe('parseArgs — --wiki-only and --max-calls (hostile review round 2)', () => {
  it('defaults maxCalls to 40 and wikiOnly to false', () => {
    const a = parseArgs(['--dry-run', '--expect-db', 'gc_curriculum_p0b_scratch']);
    expect(a.maxCalls).toBe(DEFAULT_MAX_CALLS);
    expect(a.wikiOnly).toBe(false);
  });

  it('--wiki-only sets wikiOnly true', () => {
    const a = parseArgs(['--apply', '--expect-db', 'gc_curriculum', '--wiki-only']);
    expect(a.wikiOnly).toBe(true);
  });

  it('--max-calls <n> overrides the default', () => {
    const a = parseArgs(['--apply', '--expect-db', 'gc_curriculum', '--max-calls', '60']);
    expect(a.maxCalls).toBe(60);
  });

  it('rejects a non-integer or non-positive --max-calls', () => {
    expect(() => parseArgs(['--apply', '--expect-db', 'gc_curriculum', '--max-calls', 'abc'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--apply', '--expect-db', 'gc_curriculum', '--max-calls', '0'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--apply', '--expect-db', 'gc_curriculum', '--max-calls', '-5'])).toThrow(/positive integer/);
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

describe.skipIf(!RUN)('findLatestNonRetiredSnapshot (I-3: the wiki course regen reads from here, never from a scope item directly)', () => {
  afterEach(cleanupFixture);

  it('returns the NEWER snapshot for a course even though only the OLDER one has a group cell', async () => {
    const { newer } = await newMultiSnapshotFixture();

    const latest = await findLatestNonRetiredSnapshot(MULTI_CODE);

    expect(latest).toEqual({ snapshotId: newer });
  });
});

describe.skipIf(!RUN)('p0b rescore script (P0b Task 7, post-0057)', () => {
  afterEach(cleanupFixture);

  it('--dry-run writes nothing and reports both a scoring and a wiki call estimate', async () => {
    await newFixtureSnapshot();
    const deps = mockDeps();

    const code = await main(['--dry-run', '--expect-db', SCRATCH_DB], deps);

    expect(code).toBe(0);
    expect(deps.scoreSnapshotCompetencies).not.toHaveBeenCalled();
    expect(deps.checkDailyCap).not.toHaveBeenCalled();
    expect(deps.recordSpend).not.toHaveBeenCalled();
    expect(deps.writeMergedStub).not.toHaveBeenCalled();
    expect(deps.regenerateCoursePage).not.toHaveBeenCalled();
    expect(deps.runProgramWikiPass).not.toHaveBeenCalled();

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

    const outcome = await runRescore(args({ expectDb: SCRATCH_DB, skipWiki: true }), deps);

    expect(outcome.scope).toEqual([{ snapshotId, courseCode: TEST_CODE }]);
    expect(outcome.scoreResults).toEqual([{ snapshotId, courseCode: TEST_CODE, ok: true }]);
    expect(outcome.snapshotsProcessed).toBe(1);
    expect(outcome.cappedEarly).toBe(false);
    expect(outcome.refused).toBe(false);

    expect(outcome.rows).toHaveLength(2);
    expect(outcome.rows.map(r => r.competencyId).sort()).toEqual(['domain-knowledge', 'project-management']);
    for (const r of outcome.rows) expect(r.old).toBeNull(); // fixture never had a survivor row before this run

    const dbRows = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
    const survivorRows = dbRows.filter(r => SURVIVOR_IDS.includes(r.competencyId));
    expect(survivorRows).toHaveLength(2);
    expect(survivorRows.map(r => r.model)).toEqual(['test-model', 'test-model']);

    // skipWiki: true — no wiki writes at all, even though apply ran for real.
    expect(outcome.courseWikiResults).toEqual([]);
    expect(outcome.programWikiResults).toEqual([]);
    expect(outcome.stubResults).toEqual([]);
    expect(deps.writeMergedStub).not.toHaveBeenCalled();
    expect(deps.regenerateCoursePage).not.toHaveBeenCalled();
    expect(deps.runProgramWikiPass).not.toHaveBeenCalled();
  });

  it('--apply against scratch WITHOUT --skip-wiki still makes 0 wiki calls — only --expect-db gc_curriculum writes wiki', async () => {
    const snapshotId = await newFixtureSnapshot();
    // Scoped to ONLY the fixture snapshot — see note above.
    const deps = mockDeps({ findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]) });

    // SCRATCH_DB !== LIVE_DB_NAME, so even with skipWiki left false (forgetting
    // --skip-wiki, the exact scenario this guard exists for), no wiki write may happen.
    expect(SCRATCH_DB).not.toBe(LIVE_DB_NAME);
    const outcome = await runRescore(args({ expectDb: SCRATCH_DB, skipWiki: false }), deps);

    expect(outcome.wikiWritesEnabled).toBe(false);
    expect(deps.writeMergedStub).not.toHaveBeenCalled();
    expect(deps.regenerateCoursePage).not.toHaveBeenCalled();
    expect(deps.runProgramWikiPass).not.toHaveBeenCalled();
  });

  // --- I-3 (hostile review round 2): the wiki course regen must use the
  // course's ACTUAL latest non-retired snapshot, never a superseded
  // snapshot that merely happened to be in the SCORING scope.
  it("wiki course regeneration uses the course's actual latest non-retired snapshot, never a superseded in-scope snapshot (I-3)", async () => {
    const { older, newer } = await newMultiSnapshotFixture();
    const deps = mockDeps({
      // Only the OLDER (superseded) snapshot is in the scoring scope —
      // exactly GC 1010's real shape in the hostile review's reproduction.
      findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId: older, courseCode: MULTI_CODE }]),
    });

    const outcome = await runRescore(args({ expectDb: LIVE_DB_NAME, skipWiki: false }), deps);

    expect(outcome.scoreResults).toEqual([{ snapshotId: older, courseCode: MULTI_CODE, ok: true }]);
    expect(deps.regenerateCoursePage).toHaveBeenCalledTimes(1);
    expect(deps.regenerateCoursePage).toHaveBeenCalledWith(newer, expect.any(String));
    expect(deps.regenerateCoursePage).not.toHaveBeenCalledWith(older, expect.any(String));
    expect(outcome.courseWikiResults).toEqual([{ courseCode: MULTI_CODE, snapshotId: newer, ok: true }]);
  });

  it('awaits a slow course wiki regeneration before returning — it is not dropped (I-2/I-3)', async () => {
    const snapshotId = await newFixtureSnapshot();
    let resolved = false;
    const regenCourse = vi.fn().mockImplementation(() => new Promise(resolve => {
      setTimeout(() => { resolved = true; resolve({ sha: 'deadbeef' }); }, 50);
    }));
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
      regenerateCoursePage: regenCourse,
    });

    const outcome = await runRescore(args({ expectDb: LIVE_DB_NAME, skipWiki: false }), deps);

    expect(resolved).toBe(true);
    expect(outcome.courseWikiResults.every(r => r.ok)).toBe(true);
  });

  it('a failed course wiki regeneration does not undo the DB cell writes, is reported, and main() exits non-zero', async () => {
    const snapshotId = await newFixtureSnapshot();
    const regenCourse = vi.fn().mockRejectedValue(new Error('simulated git push failure'));
    // assertExpectedDb (main()'s own db-identity check) needs a connected
    // database literally named 'gc_curriculum' to exercise the live wiki
    // path through main() — this suite only ever runs against the real
    // scratch database, so its `executor` is stubbed to answer that ONE
    // query. upsertCoverageCell is NOT parameterized by executor — it
    // always writes through the real db singleton — so the cell writes
    // this test checks for below are real, not stubbed.
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
      findLatestNonRetiredSnapshot: vi.fn().mockResolvedValue({ snapshotId }),
      regenerateCoursePage: regenCourse,
    });

    const code = await main(['--apply', '--expect-db', LIVE_DB_NAME], deps);

    expect(code).not.toBe(0);
    // The DB cell writes from scoring are NOT undone by the wiki failure.
    const dbRows = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
    const survivorRows = dbRows.filter(r => SURVIVOR_IDS.includes(r.competencyId));
    expect(survivorRows).toHaveLength(2);
  });

  it('runRescore itself reports a failed course wiki regeneration without throwing, and scoring still fully succeeded', async () => {
    const snapshotId = await newFixtureSnapshot();
    const regenCourse = vi.fn().mockRejectedValue(new Error('simulated git push failure'));
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
      regenerateCoursePage: regenCourse,
    });

    const outcome = await runRescore(args({ expectDb: LIVE_DB_NAME, skipWiki: false }), deps);

    expect(outcome.courseWikiResults).toEqual([{ courseCode: TEST_CODE, snapshotId, ok: false, error: 'simulated git push failure' }]);
    expect(outcome.rows).toHaveLength(2); // scoring succeeded regardless
  });

  it('a failed merged-stub write is also reported and does not throw out of runRescore', async () => {
    const snapshotId = await newFixtureSnapshot();
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
      writeMergedStub: vi.fn().mockRejectedValue(new Error('simulated stub push failure')),
    });

    const outcome = await runRescore(args({ expectDb: LIVE_DB_NAME, skipWiki: false }), deps);

    expect(outcome.stubResults.every(r => r.ok === false)).toBe(true);
    expect(outcome.stubResults).toHaveLength(3);
  });

  // --- m5 (hostile review round 2): a scoring failure on one item must not
  // stop the rest of the run.
  it('a scoring failure on one snapshot is caught, reported, and does not stop the rest of the run (m5)', async () => {
    const snapshotA = await newFixtureSnapshot();
    const snapshotB = await newOffPathFixtureSnapshot();
    const score = vi.fn().mockImplementation(async (input: { snapshotId: string }) => {
      if (input.snapshotId === snapshotB) throw new Error('simulated scorer failure');
      return FIXED_SCORE_RESULT;
    });
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([
        { snapshotId: snapshotA, courseCode: TEST_CODE },
        { snapshotId: snapshotB, courseCode: OFFPATH_CODE },
      ]),
      scoreSnapshotCompetencies: score,
    });

    const outcome = await runRescore(args({ expectDb: SCRATCH_DB, skipWiki: true }), deps);

    expect(outcome.scoreResults).toEqual([
      { snapshotId: snapshotA, courseCode: TEST_CODE, ok: true },
      { snapshotId: snapshotB, courseCode: OFFPATH_CODE, ok: false, error: 'simulated scorer failure' },
    ]);
    // Snapshot A's cells are still written — the failure on B didn't undo them.
    const dbRowsA = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotA));
    expect(dbRowsA.filter(r => SURVIVOR_IDS.includes(r.competencyId))).toHaveLength(2);
    // Snapshot B never got a survivor cell.
    const dbRowsB = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotB));
    expect(dbRowsB.filter(r => SURVIVOR_IDS.includes(r.competencyId))).toHaveLength(0);

    expect(allFailures(outcome)).toEqual([{ label: `scoring for ${OFFPATH_CODE} (${snapshotB})`, error: 'simulated scorer failure' }]);
  });

  // --- m6 (hostile review round 2): --wiki-only skips scoring entirely.
  it("--wiki-only skips scoring and regenerates wiki only, from the scope's course set", async () => {
    const snapshotId = await newFixtureSnapshot();
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
      findLatestNonRetiredSnapshot: vi.fn().mockResolvedValue({ snapshotId }),
    });

    const outcome = await runRescore(args({ expectDb: LIVE_DB_NAME, skipWiki: false, wikiOnly: true }), deps);

    expect(deps.scoreSnapshotCompetencies).not.toHaveBeenCalled();
    // m2: checkDailyCap IS called once, for the wiki phase itself — just
    // never for a scoring call, since --wiki-only skips scoring entirely.
    expect(deps.checkDailyCap).toHaveBeenCalledTimes(1);
    expect(outcome.scoreResults).toEqual([]);
    expect(outcome.rows).toEqual([]);
    expect(outcome.totalCostUsdCents).toBe(0);
    expect(deps.regenerateCoursePage).toHaveBeenCalledWith(snapshotId, expect.any(String));
    expect(outcome.courseWikiResults).toEqual([{ courseCode: TEST_CODE, snapshotId, ok: true }]);

    // No cells were upserted by a --wiki-only run.
    const dbRows = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
    expect(dbRows.filter(r => SURVIVOR_IDS.includes(r.competencyId))).toHaveLength(0);
  });

  it('--wiki-only without --apply behaves like an ordinary dry run (no wiki calls either)', async () => {
    await newFixtureSnapshot();
    const deps = mockDeps();

    const code = await main(['--dry-run', '--expect-db', SCRATCH_DB, '--wiki-only'], deps);

    expect(code).toBe(0);
    expect(deps.regenerateCoursePage).not.toHaveBeenCalled();
    expect(deps.runProgramWikiPass).not.toHaveBeenCalled();
  });

  // --- Hard stop (hostile review round 2): --max-calls.
  it('--apply refuses to start scoring when the planned call count exceeds --max-calls', async () => {
    const snapshotId = await newFixtureSnapshot();
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([
        { snapshotId, courseCode: TEST_CODE },
        { snapshotId: 'fake-2', courseCode: TEST_CODE },
        { snapshotId: 'fake-3', courseCode: TEST_CODE },
      ]),
    });

    const outcome = await runRescore(args({ expectDb: SCRATCH_DB, skipWiki: true, maxCalls: 2 }), deps);

    expect(outcome.refused).toBe(true);
    expect(outcome.refusedReason).toMatch(/planned 3 scoring call\(s\) exceeds --max-calls 2/);
    expect(deps.scoreSnapshotCompetencies).not.toHaveBeenCalled();
    expect(deps.checkDailyCap).not.toHaveBeenCalled();

    const dbRows = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
    expect(dbRows.filter(r => SURVIVOR_IDS.includes(r.competencyId))).toHaveLength(0);
  });

  it('--max-calls exactly equal to the scope length does NOT refuse', async () => {
    const snapshotId = await newFixtureSnapshot();
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
    });

    const outcome = await runRescore(args({ expectDb: SCRATCH_DB, skipWiki: true, maxCalls: 1 }), deps);

    expect(outcome.refused).toBe(false);
    expect(deps.scoreSnapshotCompetencies).toHaveBeenCalledTimes(1);
  });

  it('--max-calls does not apply to --wiki-only (which does no scoring at all)', async () => {
    const snapshotId = await newFixtureSnapshot();
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([
        { snapshotId, courseCode: TEST_CODE },
        { snapshotId: 'fake-2', courseCode: TEST_CODE },
      ]),
      findLatestNonRetiredSnapshot: vi.fn().mockResolvedValue({ snapshotId }),
    });

    const outcome = await runRescore(args({ expectDb: LIVE_DB_NAME, skipWiki: false, wikiOnly: true, maxCalls: 1 }), deps);

    expect(outcome.refused).toBe(false);
  });

  // --- n1 (final review): a daily-cap trip during scoring, or at the
  // wiki-phase check, must exit non-zero with an accurate phase-specific
  // message, in every mode including --wiki-only — and merged-away stubs
  // must never be written when the wiki phase itself was skipped by the cap.
  describe('n1: daily-cap trip exits non-zero and names the stopped phase', () => {
    it('a cap trip during the SCORING phase: no scoring happens, no wiki write happens, cappedAt is "scoring"', async () => {
      const snapshotId = await newFixtureSnapshot();
      const capped = vi.fn().mockResolvedValue({ ok: false, spentCents: 999, overCap: true });
      const deps = mockDeps({
        findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
        checkDailyCap: capped,
      });

      const outcome = await runRescore(args({ expectDb: LIVE_DB_NAME, skipWiki: false }), deps);

      expect(outcome.cappedEarly).toBe(true);
      expect(outcome.cappedAt).toBe('scoring');
      expect(outcome.snapshotsProcessed).toBe(0);
      expect(outcome.scoreResults).toEqual([]);
      expect(deps.scoreSnapshotCompetencies).not.toHaveBeenCalled();
      // Nothing in the wiki phase ran either — the cap was already tripped.
      expect(outcome.courseWikiResults).toEqual([]);
      expect(outcome.programWikiResults).toEqual([]);
      expect(outcome.stubResults).toEqual([]);
      expect(deps.regenerateCoursePage).not.toHaveBeenCalled();
      expect(deps.runProgramWikiPass).not.toHaveBeenCalled();
      expect(deps.writeMergedStub).not.toHaveBeenCalled();

      // No cells were upserted — scoring never ran.
      const dbRows = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
      expect(dbRows.filter(r => SURVIVOR_IDS.includes(r.competencyId))).toHaveLength(0);

      // main() surfaces this as a non-zero exit naming the scoring phase.
      // getSurvivorCompetencies(executor) is called unconditionally before
      // the scoring loop (even though the loop's first iteration trips the
      // cap) — the fakeExecutor below only answers assertExpectedDb's one
      // query, so this must be mocked too, same as the existing "failed
      // course wiki regeneration" test above.
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const fakeExecutor = { execute: vi.fn().mockResolvedValue({ rows: [{ name: LIVE_DB_NAME }] }) } as unknown as RescoreDeps['executor'];
        const code = await main(['--apply', '--expect-db', LIVE_DB_NAME], {
          ...deps,
          executor: fakeExecutor,
          getSurvivorCompetencies: vi.fn().mockResolvedValue([
            { id: 'domain-knowledge', name: 'Domain knowledge', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd' },
            { id: 'project-management', name: 'Project management', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd' },
          ]),
          getCarriedCells: vi.fn().mockResolvedValue({}),
        });
        expect(code).toBe(3);
        expect(errSpy.mock.calls.flat().join('\n')).toMatch(/STOPPED EARLY at the scoring phase/);
      } finally {
        errSpy.mockRestore();
      }
    });

    it('a cap trip at the WIKI-phase check (scoring already finished): no wiki write happens, no stub is written, cappedAt is "wiki"', async () => {
      const snapshotId = await newFixtureSnapshot();
      const makeCheckCap = () => {
        let calls = 0;
        return vi.fn().mockImplementation(async () => {
          calls += 1;
          // 1st call: the scoring loop's single item — let it through.
          // 2nd call: the wiki-phase check — trip the cap.
          return calls === 1 ? { ok: true, spentCents: 0, overCap: false } : { ok: false, spentCents: 999, overCap: true };
        });
      };
      const deps = mockDeps({
        findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
        checkDailyCap: makeCheckCap(),
      });

      const outcome = await runRescore(args({ expectDb: LIVE_DB_NAME, skipWiki: false }), deps);

      // Scoring itself completed fully and its cells stand.
      expect(outcome.snapshotsProcessed).toBe(1);
      expect(outcome.scoreResults).toEqual([{ snapshotId, courseCode: TEST_CODE, ok: true }]);
      const dbRows = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
      expect(dbRows.filter(r => SURVIVOR_IDS.includes(r.competencyId))).toHaveLength(2);

      // But the wiki phase never ran — including the merged-stub writes.
      expect(outcome.cappedEarly).toBe(true);
      expect(outcome.cappedAt).toBe('wiki');
      expect(outcome.courseWikiResults).toEqual([]);
      expect(outcome.programWikiResults).toEqual([]);
      expect(outcome.stubResults).toEqual([]);
      expect(deps.regenerateCoursePage).not.toHaveBeenCalled();
      expect(deps.runProgramWikiPass).not.toHaveBeenCalled();
      expect(deps.writeMergedStub).not.toHaveBeenCalled();

      // main() surfaces this as a non-zero exit naming the wiki phase. Uses
      // a FRESH checkCap counter (and fresh mock-call counts) — not the one
      // from the runRescore call above, which already spent its two calls.
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const fakeExecutor = { execute: vi.fn().mockResolvedValue({ rows: [{ name: LIVE_DB_NAME }] }) } as unknown as RescoreDeps['executor'];
        const code = await main(['--apply', '--expect-db', LIVE_DB_NAME], {
          ...deps,
          executor: fakeExecutor,
          checkDailyCap: makeCheckCap(),
          getSurvivorCompetencies: vi.fn().mockResolvedValue([
            { id: 'domain-knowledge', name: 'Domain knowledge', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd' },
            { id: 'project-management', name: 'Project management', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd' },
          ]),
          getCarriedCells: vi.fn().mockResolvedValue({}),
        });
        expect(code).toBe(3);
        expect(errSpy.mock.calls.flat().join('\n')).toMatch(/STOPPED EARLY at the wiki phase/);
      } finally {
        errSpy.mockRestore();
      }
    });

    it('a cap trip at the WIKI-phase check in --wiki-only mode: still exits non-zero, no stub is written', async () => {
      const snapshotId = await newFixtureSnapshot();
      const capped = vi.fn().mockResolvedValue({ ok: false, spentCents: 999, overCap: true });
      const deps = mockDeps({
        findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
        checkDailyCap: capped,
      });

      const outcome = await runRescore(args({ expectDb: LIVE_DB_NAME, skipWiki: false, wikiOnly: true }), deps);

      expect(outcome.cappedEarly).toBe(true);
      expect(outcome.cappedAt).toBe('wiki');
      expect(outcome.courseWikiResults).toEqual([]);
      expect(outcome.programWikiResults).toEqual([]);
      expect(outcome.stubResults).toEqual([]);
      expect(deps.regenerateCoursePage).not.toHaveBeenCalled();
      expect(deps.writeMergedStub).not.toHaveBeenCalled();

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const fakeExecutor = { execute: vi.fn().mockResolvedValue({ rows: [{ name: LIVE_DB_NAME }] }) } as unknown as RescoreDeps['executor'];
        const code = await main(['--apply', '--expect-db', LIVE_DB_NAME, '--wiki-only'], { ...deps, executor: fakeExecutor });
        expect(code).toBe(3);
        expect(errSpy.mock.calls.flat().join('\n')).toMatch(/STOPPED EARLY at the wiki phase/);
      } finally {
        errSpy.mockRestore();
      }
    });
  });

  // --- n2 (final review): the exit-3 advice for a wiki-only failure must
  // not claim the --wiki-only retry is "for free"/"costs nothing extra" —
  // it re-runs the whole wiki phase and re-pays roughly the full wiki-call
  // count — and must spell out the exact flags the retry needs.
  it('n2: a wiki-only-failed exit-3 message says the --wiki-only retry re-pays the wiki calls and names the required flags, not "for free"', async () => {
    const snapshotId = await newFixtureSnapshot();
    const deps = mockDeps({
      findInScopeSnapshots: vi.fn().mockResolvedValue([{ snapshotId, courseCode: TEST_CODE }]),
      writeMergedStub: vi.fn().mockRejectedValue(new Error('simulated stub push failure')),
      getSurvivorCompetencies: vi.fn().mockResolvedValue([
        { id: 'domain-knowledge', name: 'Domain knowledge', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd' },
        { id: 'project-management', name: 'Project management', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd' },
      ]),
      getCarriedCells: vi.fn().mockResolvedValue({}),
      getMergedAwayNames: vi.fn().mockResolvedValue({}),
      findLatestNonRetiredSnapshot: vi.fn().mockResolvedValue({ snapshotId }),
    });
    const fakeExecutor = { execute: vi.fn().mockResolvedValue({ rows: [{ name: LIVE_DB_NAME }] }) } as unknown as RescoreDeps['executor'];

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const code = await main(['--apply', '--expect-db', LIVE_DB_NAME], { ...deps, executor: fakeExecutor });
      expect(code).toBe(3);
      const out = errSpy.mock.calls.flat().join('\n');
      expect(out).not.toMatch(/for free/i);
      expect(out).not.toMatch(/costs nothing extra/i);
      expect(out).toMatch(/--apply --expect-db gc_curriculum --wiki-only/);
      expect(out).toMatch(/re-pays roughly the FULL wiki-call count/);
    } finally {
      errSpy.mockRestore();
    }
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
