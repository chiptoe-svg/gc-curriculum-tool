// @vitest-environment node
// P0b Task 7 — owner-gated re-score script
// (scripts/migrations/2026-10-12-p0b-rescore.ts). Needs the POST-0057 schema
// (sub_competencies.merged_into, p0b_premerge_survivor_coverage,
// snapshot_competency_coverage keyed (snapshot, competency)), so this is
// gated on isP0bMainDb(), same as the other post-0057 DB tests.
//
// The scorer (scoreSnapshotCompetencies) and the wiki writer (writeMergedStub,
// regenerateWikiInBackground) are ALWAYS mocked here — this suite makes no
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
  SURVIVOR_IDS,
  type RescoreDeps,
} from '@/scripts/migrations/2026-10-12-p0b-rescore';
import { SCRATCH_DB, isP0bMainDb } from './p0b/scratch-guard';

const RUN = isP0bMainDb();

const TEST_CODE = 'ZZ 9992'; // never a real course — distinct from the other DB tests' fixture codes
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
  await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, TEST_CODE));
  await db.delete(courses).where(eq(courses.code, TEST_CODE));
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
    regenerateWikiInBackground: vi.fn(),
    ...overrides,
  };
}

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
    expect(deps.regenerateWikiInBackground).not.toHaveBeenCalled();

    const fixtureRows = await db.select({ competencyId: snapshotCompetencyCoverage.competencyId })
      .from(snapshotCompetencyCoverage)
      .innerJoin(courseCaptureSnapshots, eq(courseCaptureSnapshots.id, snapshotCompetencyCoverage.snapshotId))
      .where(eq(courseCaptureSnapshots.courseCode, TEST_CODE));
    // Only the fixture's own pre-seeded merged-away row — the dry run added nothing.
    expect(fixtureRows.map(r => r.competencyId)).toEqual(['gc-production-literacy']);
  });

  it('--apply upserts exactly 2 cells (domain-knowledge, project-management) for the in-scope snapshot', async () => {
    const snapshotId = await newFixtureSnapshot();
    const deps = mockDeps();

    const outcome = await runRescore({ apply: true, expectDb: SCRATCH_DB, skipWiki: true }, deps);

    const scopedRow = outcome.scope.find(s => s.snapshotId === snapshotId);
    expect(scopedRow).toBeDefined();
    expect(scopedRow!.courseCode).toBe(TEST_CODE);

    expect(outcome.snapshotsProcessed).toBeGreaterThanOrEqual(1);
    expect(outcome.cappedEarly).toBe(false);

    const rowsForFixture = outcome.rows.filter(r => r.snapshotId === snapshotId);
    expect(rowsForFixture).toHaveLength(2);
    expect(rowsForFixture.map(r => r.competencyId).sort()).toEqual(['domain-knowledge', 'project-management']);
    for (const r of rowsForFixture) expect(r.old).toBeNull(); // fixture never had a survivor row before this run

    const dbRows = await db.select().from(snapshotCompetencyCoverage).where(eq(snapshotCompetencyCoverage.snapshotId, snapshotId));
    const survivorRows = dbRows.filter(r => SURVIVOR_IDS.includes(r.competencyId));
    expect(survivorRows).toHaveLength(2);
    expect(survivorRows.map(r => r.model)).toEqual(['test-model', 'test-model']);

    // skipWiki: true — no wiki writes at all, even though apply ran for real.
    expect(deps.writeMergedStub).not.toHaveBeenCalled();
    expect(deps.regenerateWikiInBackground).not.toHaveBeenCalled();
  });

  it('--apply without --skip-wiki writes the 3 merged-away stubs and fires one wiki regen per re-scored snapshot', async () => {
    const snapshotId = await newFixtureSnapshot();
    const deps = mockDeps();

    await runRescore({ apply: true, expectDb: SCRATCH_DB, skipWiki: false }, deps);

    expect(deps.writeMergedStub).toHaveBeenCalledTimes(3);
    const stubCalls = (deps.writeMergedStub as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(stubCalls.sort()).toEqual(['domain-grounding', 'gc-production-literacy', 'timeline-management']);

    expect(deps.regenerateWikiInBackground).toHaveBeenCalledWith(snapshotId, expect.any(String));
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
