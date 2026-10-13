// @vitest-environment node
// P0b characterization (gc_curriculum_p0b_scratch ONLY — the main clone,
// post-0057, post-Task-7-rescore; never gc_curriculum_p0b_pre or live).
// Compares the P0a probe set (tests/db/p0a/probes.ts) against
// golden-pre.json — captured pre-0057 on gc_curriculum_p0b_pre, Task 1 —
// through an explicit, evidence-backed allow-list of expected differences.
// Anything outside the allow-list fails the comparison.
//
// The allow-list (each verified empirically against this scratch's actual
// probe output before being written — see task-9-report.md Step 1):
//
//   1. Merged competencies (migration 0057,
//      drizzle/0057_competency_catalog_p0b.sql; plan Ruling 6).
//      gc-production-literacy, domain-grounding, timeline-management are
//      retired and merged into one of two survivors — domain-knowledge,
//      project-management — whose descriptor text and scored cells change
//      (carry-forward + Task 7's real re-score of newly-stale snapshots).
//      Exactly 3 targets are touched: account-management (gc-production-
//      literacy -> domain-knowledge, same display position),
//      ai-workflow (domain-grounding -> domain-knowledge, same position),
//      production-operations (timeline-management removed; project-
//      management and domain-knowledge were already members, unchanged
//      position). brand-strategy and creative-generalist have no merge-id
//      membership and must come through byte-identical (modulo item 3).
//   2. Stale-pair count fix (Task 8b fix round 1, lib/program/stale-pairs.ts)
//      is a pure client-side function (app/program/ProgramCoverageClient.tsx)
//      with its own fixture unit test (lib/program/__tests__/stale-pairs.test.ts)
//      — it reads no DB table and is not one of collectProbes()'s reads.
//      No allow-list entry is needed here; recorded for completeness.
//   3. coverage_for_target '?' course-name fix (Task 8b fix round 2,
//      lib/ai/wiki/graph-tools.ts shapeCoverageForTarget) is driven by
//      MatrixData.snapshotCourses, a field ADDED to getMatrixData's return
//      shape after golden-pre.json was captured — it has no key in golden
//      at all. shapeCoverageForTarget itself has its own fixture unit test
//      (tests/lib/ai/wiki/graph-tools.test.ts) and is not read by
//      collectProbes(). The allowance here is narrow: getMatrixData.now may
//      have a `snapshotCourses` key golden lacks; every other key is
//      compared as normal.
//   4. Off-path courses (GC 3620/3700/3710/3730/3740/4900ap, MKT 3310/4320):
//      no allowance at all — every probe below is checked (after the merge-id
//      filter) across EVERY course, on-path or off, with no separate
//      off-path carve-out. The only exception is loadTargetSubstrate's
//      contributingCourses field (a target-level UNION across every
//      sub-competency, merge-id ones included), which gets a NARROW rule
//      instead of a blanket drop (fix round 1): a course is exempted from
//      the exact comparison only when, on the side it appears/disappears,
//      its only positive-depth (dDepth > 0) contributor among the target's
//      competencies is one of the 5 merge ids — i.e. the course has no
//      OTHER, non-merge-id sub-competency keeping it in contributingCourses.
//      That set is reconstructed from getAllCells (raw cells, careerTargetId
//      + subCompetencyId + dDepth) joined to a direct query for which
//      snapshots are non-retired AND program-visible (the same two
//      conditions loadTargetSubstrate's own cellRows query uses) — a courseCode
//      resolved from the DB directly, not from golden (which predates the
//      `snapshotCourses` field, item 3), since snapshot retirement and course
//      scope/status are untouched by migration 0057 and so are valid to read
//      from `now` for use against golden's rows too. Every OTHER course entry
//      (on-path or off) must still match exactly. One off-path-looking delta
//      was found during design (GC 4900ap newly appearing in
//      account-management's contributingCourses) and traced to exactly this
//      mechanism — domain-knowledge is its only dDepth>0 contributor there.
//   5. listStalePairs removed (Task 5; STATE.md Deferred/debt). golden has
//      this top-level probe key, now does not — the only allowed top-level
//      key-set delta.
//
// One more fix (Task 5's activeCompetencyIds, used by computeAffectedPages
// and loadRefreshInputs's SCHEDULING-ONLY fields) also correctly excludes
// two PRE-EXISTING retired competencies unrelated to the 0057 merge
// (change-management, prompt-design) that golden's pre-fix code still
// scheduled wiki regeneration for. This is folded into the same filtering
// below by deriving the exclusion set from `now`'s own
// loadRetiredCompetencyIds (which already contains both) rather than a
// hardcoded list, so it generalizes instead of hiding a second hardcoded
// allowance.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { PROGRAM_VISIBLE_SQL } from '@/lib/courses/program-visibility';
import { courseCodeToSlug } from '@/lib/ai/wiki/update';
import { canon, collectCoverageTieSets, collectProbes, tieAwareTargetSubstrate } from './p0a/probes';
import { isP0bMainDb } from './p0b/scratch-guard';

const GOLDEN = process.env.P0A_GOLDEN;

/** The 5 ids migration 0057 touches — see module doc above. */
const MERGE_IDS = new Set([
  'gc-production-literacy',
  'domain-grounding',
  'timeline-management',
  'domain-knowledge',
  'project-management',
]);

/** The only 3 targets any merge id belongs to (migration precondition + Ruling 6). */
const AFFECTED_TARGETS = new Set(['account-management', 'ai-workflow', 'production-operations']);

type Rec = Record<string, unknown>;

function byJson(a: unknown, b: unknown): number {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Order-independent array equality (sorts both sides by JSON before comparing). */
function expectSameSet(now: unknown[], golden: unknown[], label: string) {
  expect([...now].sort(byJson), label).toEqual([...golden].sort(byJson));
}

/** Drop array entries whose id (via `idOf`) is in `ids`, from both sides, order preserved. */
function dropIds<T>(arr: T[], idOf: (t: T) => string, ids: Set<string>): T[] {
  return arr.filter(x => !ids.has(idOf(x)));
}

describe.skipIf(!isP0bMainDb() || !GOLDEN)('P0b characterization: post-0057 + rescore vs. pre-0057 golden, allow-listed', () => {
  it('matches the golden except the documented merge/probe-shape allow-list', async () => {
    const golden = JSON.parse(readFileSync(GOLDEN!, 'utf8')) as Rec;
    const now = JSON.parse(JSON.stringify(canon(await collectProbes()))) as Rec;

    // --- Top-level key set: only allowed delta is listStalePairs (item 5) ---
    const goldenKeys = new Set(Object.keys(golden));
    const nowKeys = new Set(Object.keys(now));
    expect([...goldenKeys].filter(k => !nowKeys.has(k)), 'golden-only top-level keys').toEqual(['listStalePairs']);
    expect([...nowKeys].filter(k => !goldenKeys.has(k)), 'now-only top-level keys').toEqual([]);

    const nowRetiredIds = now.loadRetiredCompetencyIds as string[];
    const goldenRetiredIds = golden.loadRetiredCompetencyIds as string[];

    // --- loadRetiredCompetencyIds: now = golden + the 3 newly-retired ids, nothing else ---
    const newlyRetired = nowRetiredIds.filter(id => !goldenRetiredIds.includes(id));
    expect([...newlyRetired].sort(), 'newly retired ids').toEqual(['domain-grounding', 'gc-production-literacy', 'timeline-management']);
    expect(nowRetiredIds.filter(id => !newlyRetired.includes(id)).sort(), 'golden retired ids survive').toEqual([...goldenRetiredIds].sort());

    // Currently-retired set (old pre-existing retirees + the 3 newly-merged-
    // away ones) — used where a GLOBAL "does any cell exist anywhere for
    // this id" presence check applies (competencySlugs/targetSlugs): the two
    // survivors are NOT excluded there, since they already had cells before
    // the merge (production-operations) and still do.
    const currentlyRetiredIds = new Set(nowRetiredIds);
    // Scheduling-only exclusion set (item 1's note on activeCompetencyIds),
    // used where a PER-SNAPSHOT page-scheduling check applies
    // (computeAffectedPages): the above, plus the 2 survivors, whose
    // per-snapshot scheduling entries also legitimately changed (re-score
    // can add/remove a specific snapshot's need for a domain-knowledge or
    // project-management page even though the id as a whole was never retired).
    const schedulingExcluded = new Set([...nowRetiredIds, 'domain-knowledge', 'project-management']);

    // --- computePrereqGaps: untouched by P0b, exact ---
    expect(now.computePrereqGaps, 'computePrereqGaps').toEqual(golden.computePrereqGaps);

    // --- getMatrixData ---
    {
      const g = golden.getMatrixData as Rec;
      const n = now.getMatrixData as Rec;
      expect(n.targets, 'getMatrixData.targets').toEqual(g.targets);
      expect(n.courses, 'getMatrixData.courses').toEqual(g.courses);
      expectSameSet(
        dropIds(n.subCompetencies as Rec[], x => x.id as string, MERGE_IDS),
        dropIds(g.subCompetencies as Rec[], x => x.id as string, MERGE_IDS),
        'getMatrixData.subCompetencies (merge-id filtered)',
      );
      expectSameSet(
        dropIds(n.cells as Rec[], x => x.subCompetencyId as string, MERGE_IDS),
        dropIds(g.cells as Rec[], x => x.subCompetencyId as string, MERGE_IDS),
        'getMatrixData.cells (merge-id filtered)',
      );
      // item 3: snapshotCourses is a new field — present in now, absent from
      // golden entirely. Only sanity-check its shape; never compared to golden.
      expect(Array.isArray(n.snapshotCourses), 'getMatrixData.snapshotCourses is an array (new field, item 3)').toBe(true);
      expect(g.snapshotCourses, 'golden has no snapshotCourses key').toBeUndefined();
    }

    // --- getAllCells ---
    expectSameSet(
      dropIds(now.getAllCells as Rec[], x => x.subCompetencyId as string, MERGE_IDS),
      dropIds(golden.getAllCells as Rec[], x => x.subCompetencyId as string, MERGE_IDS),
      'getAllCells (merge-id filtered)',
    );

    // --- getCellsForSnapshotTarget: keyed "<snapshotId>|<targetId>" ---
    {
      const g = golden.getCellsForSnapshotTarget as Record<string, Rec[]>;
      const n = now.getCellsForSnapshotTarget as Record<string, Rec[]>;
      expect(Object.keys(n).sort(), 'getCellsForSnapshotTarget key set').toEqual(Object.keys(g).sort());
      for (const key of Object.keys(g)) {
        const targetId = key.split('|')[1]!;
        if (AFFECTED_TARGETS.has(targetId)) {
          expectSameSet(
            dropIds(n[key] ?? [], x => x.subCompetencyId as string, MERGE_IDS),
            dropIds(g[key]!, x => x.subCompetencyId as string, MERGE_IDS),
            `getCellsForSnapshotTarget[${key}] (merge-id filtered)`,
          );
        } else {
          expect(n[key], `getCellsForSnapshotTarget[${key}] (unaffected target, exact)`).toEqual(g[key]);
        }
      }
    }

    // --- listTargets: order is part of the contract (probe comment) — never sorted ---
    {
      const g = golden.listTargets as Rec[];
      const n = now.listTargets as Rec[];
      expect(n.map(t => t.id), 'listTargets target id order').toEqual(g.map(t => t.id));
      for (const gt of g) {
        const nt = n.find(t => t.id === gt.id)!;
        const { subCompetencies: gsc, ...gRest } = gt;
        const { subCompetencies: nsc, ...nRest } = nt;
        expect(nRest, `listTargets[${gt.id}] non-subCompetencies fields`).toEqual(gRest);
        if (!AFFECTED_TARGETS.has(gt.id as string)) {
          expect(nsc, `listTargets[${gt.id}].subCompetencies (unaffected, exact incl. order)`).toEqual(gsc);
          continue;
        }
        const gList = gsc as Rec[];
        const nList = nsc as Rec[];
        // Item 1's specific claim: removing the merge-id entries from each
        // side's array (position preserved) makes the two sides equal — i.e.
        // nothing OTHER than a merge-id entry moved or changed.
        expect(
          dropIds(nList, x => x.id as string, MERGE_IDS),
          `listTargets[${gt.id}].subCompetencies, merge-id entries excised (order-preserving)`,
        ).toEqual(dropIds(gList, x => x.id as string, MERGE_IDS));
        // And the specific replacement-at-same-position claim, for the two
        // targets that gain a renamed member (account-management,
        // ai-workflow) rather than simply losing one (production-operations):
        if (gt.id === 'account-management' || gt.id === 'ai-workflow') {
          const oldId = gt.id === 'account-management' ? 'gc-production-literacy' : 'domain-grounding';
          const oldIndex = gList.findIndex(x => x.id === oldId);
          expect(oldIndex, `listTargets[${gt.id}] golden had ${oldId}`).toBeGreaterThanOrEqual(0);
          expect(nList[oldIndex]?.id, `listTargets[${gt.id}] domain-knowledge takes ${oldId}'s position`).toBe('domain-knowledge');
        }
        if (gt.id === 'production-operations') {
          expect(nList.some(x => x.id === 'timeline-management'), 'production-operations no longer has timeline-management').toBe(false);
          expect(gList.length - nList.length, 'production-operations loses exactly 1 member (timeline-management)').toBe(1);
        }
      }
    }

    // --- loadScaffoldingTarget: keyed by target id ---
    {
      const g = golden.loadScaffoldingTarget as Record<string, Rec>;
      const n = now.loadScaffoldingTarget as Record<string, Rec>;
      for (const tid of Object.keys(g)) {
        if (!AFFECTED_TARGETS.has(tid)) {
          expect(n[tid], `loadScaffoldingTarget[${tid}] (unaffected, exact)`).toEqual(g[tid]);
          continue;
        }
        const gt = g[tid]!;
        const nt = n[tid]!;
        expect(nt.targetId, `loadScaffoldingTarget[${tid}].targetId`).toEqual(gt.targetId);
        expect(nt.targetName, `loadScaffoldingTarget[${tid}].targetName`).toEqual(gt.targetName);
        expect(nt.courses, `loadScaffoldingTarget[${tid}].courses`).toEqual(gt.courses);
        expectSameSet(
          dropIds(nt.subCompetencies as Rec[], x => (typeof x === 'object' ? (x as Rec).id as string : String(x)), MERGE_IDS),
          dropIds(gt.subCompetencies as Rec[], x => (typeof x === 'object' ? (x as Rec).id as string : String(x)), MERGE_IDS),
          `loadScaffoldingTarget[${tid}].subCompetencies (merge-id filtered)`,
        );
        const gCells = (gt.cellsBySubCompetency as [string, unknown][]).filter(([id]) => !MERGE_IDS.has(id));
        const nCells = (nt.cellsBySubCompetency as [string, unknown][]).filter(([id]) => !MERGE_IDS.has(id));
        expectSameSet(nCells, gCells, `loadScaffoldingTarget[${tid}].cellsBySubCompetency (merge-id filtered)`);
      }
    }

    // --- getTargetSufficiency: keyed by target id, array of {subCompetencyId,...} ---
    {
      const g = golden.getTargetSufficiency as Record<string, Rec[]>;
      const n = now.getTargetSufficiency as Record<string, Rec[]>;
      for (const tid of Object.keys(g)) {
        if (!AFFECTED_TARGETS.has(tid)) {
          expect(n[tid], `getTargetSufficiency[${tid}] (unaffected, exact)`).toEqual(g[tid]);
          continue;
        }
        expectSameSet(
          dropIds(n[tid] ?? [], x => x.subCompetencyId as string, MERGE_IDS),
          dropIds(g[tid]!, x => x.subCompetencyId as string, MERGE_IDS),
          `getTargetSufficiency[${tid}] (merge-id filtered)`,
        );
      }
    }

    // --- loadTargetSubstrate: tie-aware (existing infra) + merge-id filter.
    // contributingCourses gets the NARROW rule described in the module doc
    // (item 4) instead of a blanket drop: a course is exempted only when its
    // sole dDepth>0 contributor, on the side it differs, is one of the 5
    // merge ids. Built from getAllCells (careerTargetId/subCompetencyId/
    // dDepth per cell) joined to a direct query for which snapshots are
    // non-retired AND program-visible — the same two conditions
    // loadTargetSubstrate's own cellRows query filters on — since neither
    // snapshot retirement nor course scope/status is touched by 0057, this
    // mapping is valid against BOTH golden's and now's raw cells. ---
    {
      const qualifying = await db.execute(sql`
        SELECT s.id AS id, s.course_code AS course_code
        FROM course_capture_snapshots s
        JOIN courses c ON c.code = s.course_code
        WHERE s.retired_at IS NULL AND ${PROGRAM_VISIBLE_SQL}
      `);
      const snapshotCourseSlug = new Map<string, string>(
        (qualifying.rows as Array<{ id: string; course_code: string }>).map(r => [r.id, courseCodeToSlug(r.course_code)]),
      );
      /** Courses with a dDepth>0 cell, for target `tid`, among sub-competencies matching `idFilter`. */
      const coursesContributedBy = (cells: Rec[], tid: string, idFilter: (id: string) => boolean): Set<string> => {
        const out = new Set<string>();
        for (const c of cells) {
          if (c.careerTargetId !== tid) continue;
          if (!((c.dDepth as number) > 0)) continue;
          if (!idFilter(c.subCompetencyId as string)) continue;
          const slug = snapshotCourseSlug.get(c.snapshotId as string);
          if (slug) out.add(slug);
        }
        return out;
      };

      const tieSets = await collectCoverageTieSets();
      const g = golden.loadTargetSubstrate as Parameters<typeof tieAwareTargetSubstrate>[0];
      const n = now.loadTargetSubstrate as Parameters<typeof tieAwareTargetSubstrate>[0];
      const allCellsGolden = golden.getAllCells as Rec[];
      const allCellsNow = now.getAllCells as Rec[];
      for (const tid of Object.keys(g)) {
        const gReduced = tieAwareTargetSubstrate({ [tid]: g[tid]! }, tieSets)[tid] as Rec & { coverageRollup: Rec[]; contributingCourses: string[] };
        const nReduced = tieAwareTargetSubstrate({ [tid]: n[tid]! }, tieSets)[tid] as Rec & { coverageRollup: Rec[]; contributingCourses: string[] };
        if (!AFFECTED_TARGETS.has(tid)) {
          expect(nReduced, `loadTargetSubstrate[${tid}] (unaffected, exact tie-aware)`).toEqual(gReduced);
          continue;
        }
        const omitRollupAndCourses = (v: Rec & { coverageRollup: Rec[]; contributingCourses: string[] }): Rec => {
          const rest: Rec = { ...v };
          delete rest.contributingCourses;
          delete rest.coverageRollup;
          return rest;
        };
        expect(omitRollupAndCourses(nReduced), `loadTargetSubstrate[${tid}] non-rollup/non-courses fields`).toEqual(omitRollupAndCourses(gReduced));
        const gRoll = gReduced.coverageRollup;
        const nRoll = nReduced.coverageRollup;
        expectSameSet(
          dropIds(nRoll, x => x.subCompetencyId as string, MERGE_IDS),
          dropIds(gRoll, x => x.subCompetencyId as string, MERGE_IDS),
          `loadTargetSubstrate[${tid}].coverageRollup (merge-id filtered)`,
        );

        // contributingCourses: narrow rule. "merge-only" = this course's ONLY
        // dDepth>0 contributor on this side is a merge id (a course that ALSO
        // has a non-merge-id contributor is never exempted).
        const nonMergeGolden = coursesContributedBy(allCellsGolden, tid, id => !MERGE_IDS.has(id));
        const nonMergeNow = coursesContributedBy(allCellsNow, tid, id => !MERGE_IDS.has(id));
        const mergeOnlyGolden = coursesContributedBy(allCellsGolden, tid, id => MERGE_IDS.has(id));
        for (const c of nonMergeGolden) mergeOnlyGolden.delete(c);
        const mergeOnlyNow = coursesContributedBy(allCellsNow, tid, id => MERGE_IDS.has(id));
        for (const c of nonMergeNow) mergeOnlyNow.delete(c);

        const gContrib = gReduced.contributingCourses.filter(c => !mergeOnlyGolden.has(c));
        const nContrib = nReduced.contributingCourses.filter(c => !mergeOnlyNow.has(c));
        expectSameSet(nContrib, gContrib, `loadTargetSubstrate[${tid}].contributingCourses, merge-only-explained entries excised (narrow)`);
      }
    }

    // --- loadCourseViews: keyed by course code; only the "predicted"
    // per-target array can change, and only for the 3 affected targets ---
    {
      const g = golden.loadCourseViews as Record<string, Rec>;
      const n = now.loadCourseViews as Record<string, Rec>;
      expect(Object.keys(n).sort(), 'loadCourseViews course set').toEqual(Object.keys(g).sort());
      for (const code of Object.keys(g)) {
        const { predicted: gPred, ...gRest } = g[code]!;
        const { predicted: nPred, ...nRest } = n[code] ?? {};
        expect(nRest, `loadCourseViews[${code}] non-predicted fields`).toEqual(gRest);
        const gP = (gPred as Rec[] | undefined ?? []).filter(p => !AFFECTED_TARGETS.has(p.targetId as string));
        const nP = (nPred as Rec[] | undefined ?? []).filter(p => !AFFECTED_TARGETS.has(p.targetId as string));
        expectSameSet(nP, gP, `loadCourseViews[${code}].predicted (unaffected targets)`);
      }
    }

    // --- loadTargetMap: keyed by target id; {id, name, competencies:[{id,name}]} ---
    {
      const g = golden.loadTargetMap as Rec[];
      const n = now.loadTargetMap as Rec[];
      expect(n.map(t => t.id), 'loadTargetMap id order').toEqual(g.map(t => t.id));
      for (const gt of g) {
        const nt = n.find(t => t.id === gt.id)!;
        expect(nt.name, `loadTargetMap[${gt.id}].name`).toEqual(gt.name);
        expect(
          dropIds(nt.competencies as Rec[], x => x.id as string, MERGE_IDS),
          `loadTargetMap[${gt.id}].competencies, merge-id entries excised (order-preserving)`,
        ).toEqual(dropIds(gt.competencies as Rec[], x => x.id as string, MERGE_IDS));
      }
    }

    // --- loadRefreshInputs ---
    {
      const g = golden.loadRefreshInputs as Rec;
      const n = now.loadRefreshInputs as Rec;
      expect(n.targetSlugs, 'loadRefreshInputs.targetSlugs').toEqual(g.targetSlugs);
      expect(n.hasProductiveFailure, 'loadRefreshInputs.hasProductiveFailure').toEqual(g.hasProductiveFailure);
      expect(n.latestProfileIds, 'loadRefreshInputs.latestProfileIds').toEqual(g.latestProfileIds);
      expect(n.snapshots, 'loadRefreshInputs.snapshots').toEqual(g.snapshots);
      // competencySlugs: now = golden minus every currently-retired id (the
      // scheduling-only activeCompetencyIds fix, item 1's note) — nothing else.
      const gSlugs = new Set(g.competencySlugs as string[]);
      const nSlugs = new Set(n.competencySlugs as string[]);
      const expectedNSlugs = [...gSlugs].filter(id => !currentlyRetiredIds.has(id)).sort();
      expect([...nSlugs].sort(), 'loadRefreshInputs.competencySlugs').toEqual(expectedNSlugs);
      // pagesPerSnapshot (old-path wiki page count per snapshot): scheduling-
      // only (worst case is one wasted AI call, never an incorrect rollup —
      // see program-coverage-queries.ts's audit comment). Verified by hand
      // during design that every per-snapshot delta here is explained by the
      // same retired-id exclusion (never increases, and 0 for snapshots that
      // never touched a currently-excluded competency) — asserted here as
      // "never increases" rather than re-deriving refresh-all.ts's exact
      // page-count formula a second time inside the test.
      const gPages = new Map((g.pagesPerSnapshot as [string, number][]));
      const nPages = new Map((n.pagesPerSnapshot as [string, number][]));
      expect([...gPages.keys()].sort(), 'pagesPerSnapshot snapshot id set').toEqual([...nPages.keys()].sort());
      for (const [id, gCount] of gPages) {
        expect(nPages.get(id)!, `pagesPerSnapshot[${id}] never increases`).toBeLessThanOrEqual(gCount);
      }
    }

    // --- computeAffectedPages: keyed by snapshot id, array of "type:slug" ---
    {
      const g = golden.computeAffectedPages as Record<string, string[]>;
      const n = now.computeAffectedPages as Record<string, string[]>;
      const dropPages = (pages: string[]) => pages.filter((s) => {
        const [type, id] = s.split(':') as [string, string];
        if (type === 'competency' && schedulingExcluded.has(id)) return false;
        if (type === 'target' && AFFECTED_TARGETS.has(id)) return false;
        return true;
      });
      for (const id of Object.keys(g)) {
        expectSameSet(dropPages(n[id] ?? []), dropPages(g[id]!), `computeAffectedPages[${id}] (filtered)`);
      }
    }

    // --- loadCompetencyLinksForSnapshot: keyed by snapshot id, array of {slug,...} ---
    {
      const g = golden.loadCompetencyLinksForSnapshot as Record<string, Rec[]>;
      const n = now.loadCompetencyLinksForSnapshot as Record<string, Rec[]>;
      for (const id of Object.keys(g)) {
        expectSameSet(
          dropIds(n[id] ?? [], x => x.slug as string, MERGE_IDS),
          dropIds(g[id]!, x => x.slug as string, MERGE_IDS),
          `loadCompetencyLinksForSnapshot[${id}] (merge-id filtered)`,
        );
      }
    }

    // --- buildBaselineDelivered / resolveSubCompetencyDepths: keyed by
    // snapshot id, array of {subCompetencyId,...} ---
    for (const key of ['buildBaselineDelivered', 'resolveSubCompetencyDepths'] as const) {
      const g = golden[key] as Record<string, Rec[]>;
      const n = now[key] as Record<string, Rec[]>;
      for (const id of Object.keys(g)) {
        expectSameSet(
          dropIds(n[id] ?? [], x => x.subCompetencyId as string, MERGE_IDS),
          dropIds(g[id]!, x => x.subCompetencyId as string, MERGE_IDS),
          `${key}[${id}] (merge-id filtered)`,
        );
      }
    }

    // --- loadCompetencySubstrate: keyed DIRECTLY by competency id. Retired
    // rows persist (sub_competency_map covers every row), so the key set
    // itself is unaffected by the merge — only the 5 merge-id keys' own
    // content is excluded from comparison. ---
    {
      const g = golden.loadCompetencySubstrate as Record<string, unknown>;
      const n = now.loadCompetencySubstrate as Record<string, unknown>;
      expect(Object.keys(n).sort(), 'loadCompetencySubstrate key set').toEqual(Object.keys(g).sort());
      for (const id of Object.keys(g)) {
        if (MERGE_IDS.has(id)) continue;
        expect(n[id], `loadCompetencySubstrate[${id}] (non-merge, exact)`).toEqual(g[id]);
      }
    }
  }, 300_000);
});
