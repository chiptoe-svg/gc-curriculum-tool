/**
 * P0a characterization probes: the outputs of every read path P0a re-points,
 * in canonical JSON form. Captured with the pre-P0a code on a pre-migration
 * scratch clone (the golden), then compared with the P0a code on the migrated
 * clone. Arrays whose order the code defines (ORDER BY or an explicit sort) are
 * kept as returned. Arrays with no defined order (no ORDER BY) go through
 * sortJson, so the comparison does not depend on Postgres heap order.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseCaptureSnapshots, targetCoverage } from '@/lib/db/schema';
import { listTargets } from '@/lib/db/career-targets-queries';
import {
  getAllCells,
  getCellsForSnapshotTarget,
  getMatrixData,
  listStalePairs,
} from '@/lib/db/program-coverage-queries';
import { loadScaffoldingTarget } from '@/lib/db/scaffolding-queries';
import { computePrereqGaps } from '@/lib/program/prereq-gaps';
import { getTargetSufficiency } from '@/lib/program/sufficiency-read';
import { loadCourseViews, loadRetiredCompetencyIds, loadTargetMap } from '@/lib/wiki/course-views';
import { loadRefreshInputs } from '@/lib/ai/wiki/refresh-all';
import {
  computeAffectedPages,
  loadCompetencyLinksForSnapshot,
  loadCompetencySubstrate,
  loadTargetSubstrate,
} from '@/lib/ai/wiki/update';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { buildBaselineDelivered, resolveSubCompetencyDepths } from '@/lib/ai/explore/run-impact';

/** JSON-safe canonical form: Date → ISO string, Map → key-sorted entries, Set → sorted array, object keys sorted. */
export function canon(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Map) {
    return [...v.entries()]
      .map(([k, x]) => [canon(k), canon(x)] as const)
      .sort((a, b) => cmp(JSON.stringify(a[0]), JSON.stringify(b[0])));
  }
  if (v instanceof Set) return [...v].map(canon).sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => cmp(a, b))
        .map(([k, x]) => [k, canon(x)]),
    );
  }
  return v;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort an array whose order the code does not define. */
function sortJson<T>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => cmp(JSON.stringify(canon(a)), JSON.stringify(canon(b))));
}

export async function collectProbes(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  const targets = await listTargets();
  out.listTargets = targets; // target and sub-competency order is part of the contract

  // Coverage probes differ in scope — do not assume equal coverage between them:
  //   getAllCells        = every snapshot_target_coverage row, unfiltered.
  //   getMatrixData.cells = getAllCells filtered to non-retired sub-competencies
  //                    only (lib/db/program-coverage-queries.ts:302-303) — narrower
  //                    than getAllCells by exactly the retired-sub-competency rows,
  //                    but NOT restricted to the matrix's own course/snapshot
  //                    selection (latest non-retired snapshot per course/instructor,
  //                    builds_to_career, scope 'gc', status 'offered' — queries.ts:
  //                    227-245): that filter narrows matrix.courses, not matrix.cells.
  //                    A row can appear in getAllCells and not in getMatrixData.cells
  //                    (retired sub-competency only).
  const matrix = await getMatrixData();
  out.getMatrixData = { ...matrix, cells: sortJson(matrix.cells) };

  out.listStalePairs = sortJson(await listStalePairs());

  const allCells = sortJson(await getAllCells());
  out.getAllCells = allCells;

  const perPair: Record<string, unknown> = {};
  for (const c of matrix.courses) {
    for (const t of targets) {
      perPair[`${c.snapshotId}|${t.id}`] = sortJson(await getCellsForSnapshotTarget(c.snapshotId, t.id));
    }
  }
  out.getCellsForSnapshotTarget = perPair;

  const scaffolding: Record<string, unknown> = {};
  const sufficiency: Record<string, unknown> = {};
  const targetSubstrate: Record<string, unknown> = {};
  for (const t of targets) {
    scaffolding[t.id] = await loadScaffoldingTarget(t.id);
    sufficiency[t.id] = sortJson(await getTargetSufficiency(t.id));
    const ts = await loadTargetSubstrate(t.id);
    targetSubstrate[t.id] = {
      ...ts,
      coverageRollup: sortJson(ts.coverageRollup),
      contributingCourses: [...ts.contributingCourses].sort(),
    };
  }
  out.loadScaffoldingTarget = scaffolding;
  out.getTargetSufficiency = sufficiency;
  out.loadTargetSubstrate = targetSubstrate;

  const focal = await db.execute(sql`SELECT DISTINCT focal_course_code AS code FROM prerequisite_edges ORDER BY 1`);
  const gapCodes = [...new Set([
    ...(focal.rows as Array<{ code: string }>).map(r => r.code),
    ...matrix.courses.slice(0, 3).map(c => c.courseCode),
  ])].sort();
  const gaps: Record<string, unknown> = {};
  for (const code of gapCodes) {
    const r = await computePrereqGaps(code);
    gaps[code] = { ...r, gaps: sortJson(r.gaps) };
  }
  out.computePrereqGaps = gaps;

  const intended = await db.execute(sql`SELECT DISTINCT course_code AS code FROM course_intended_coverage ORDER BY 1`);
  const viewCodes = [...new Set([
    ...matrix.courses.map(c => c.courseCode),
    ...(intended.rows as Array<{ code: string }>).map(r => r.code),
  ])].sort();
  const views: Record<string, unknown> = {};
  for (const code of viewCodes) views[code] = await loadCourseViews(code);
  out.loadCourseViews = views;
  out.loadTargetMap = await loadTargetMap();
  out.loadRetiredCompetencyIds = await loadRetiredCompetencyIds();

  const refresh = await loadRefreshInputs();
  out.loadRefreshInputs = {
    snapshots: sortJson(refresh.snapshots),
    competencySlugs: refresh.competencySlugs,
    targetSlugs: refresh.targetSlugs,
    hasProductiveFailure: refresh.hasProductiveFailure,
    latestProfileIds: [...refresh.latestProfiles.keys()].sort(),
    pagesPerSnapshot: sortJson(refresh.snapshots.map((s, i) => [s.id, refresh.oldPathPagesPerSnapshot[i]])),
  };

  const snapshotIds = [...new Set(allCells.map(c => c.snapshotId))].sort();
  const affected: Record<string, unknown> = {};
  const links: Record<string, unknown> = {};
  const baseline: Record<string, unknown> = {};
  const rippleDepths: Record<string, unknown> = {};
  for (const id of snapshotIds) {
    const snap = await getSnapshotById(id);
    if (!snap) continue;
    const pages = await computeAffectedPages(snap, null);
    affected[id] = pages.wiki.map(p => `${p.type}:${p.slug}`).sort();
    links[id] = sortJson(await loadCompetencyLinksForSnapshot(id));
    baseline[id] = sortJson(await buildBaselineDelivered(snap.courseCode, id));
    const statements = [...new Set(
      allCells.filter(c => c.snapshotId === id && c.matchedCompetency).map(c => c.matchedCompetency as string),
    )].sort();
    const deltas = statements.map(competency => ({
      competency,
      from: { k: null, u: null, d: 0 },
      to: { k: 1, u: 1, d: 1 },
      confidence: 'medium',
      rationale: 'p0a probe',
    })) as Parameters<typeof resolveSubCompetencyDepths>[1];
    rippleDepths[id] = sortJson(await resolveSubCompetencyDepths(id, deltas));
  }
  out.computeAffectedPages = affected;
  out.loadCompetencyLinksForSnapshot = links;
  out.buildBaselineDelivered = baseline;
  out.resolveSubCompetencyDepths = rippleDepths;

  const comps = await db.execute(sql`SELECT id FROM sub_competencies ORDER BY id`);
  const compSubstrate: Record<string, unknown> = {};
  for (const { id } of comps.rows as Array<{ id: string }>) {
    compSubstrate[id] = sortJson((await loadCompetencySubstrate(id)).contributingCells);
  }
  out.loadCompetencySubstrate = compSubstrate;

  return out;
}

// ---------------------------------------------------------------------------
// Tie-aware compare-time canon for the loadTargetSubstrate probe ONLY
// (controller ruling, 2026-10-11).
//
// lib/ai/wiki/update.ts:loadTargetSubstrate picks a "best" cell per
// sub-competency with (pre-fix) no tie-break — whichever cell the unordered
// SELECT happened to return first. That was never a stable behavior to lock
// into the golden: it was merely stable while reading the base table
// (snapshot_target_coverage) and visibly changed once P0a re-pointed the
// read to the target_coverage view, whose join gives Postgres a different
// (but equally valid) row order for cells tied on dDepth. A fix now adds a
// deterministic tie-break to the production code (generatedAt DESC,
// courseCode ASC, snapshotId ASC — see the comment there), but that is
// itself a visible-behavior change versus the pre-P0a golden, which recorded
// whichever tied cell the OLD physical order happened to pick — frequently
// not the new deterministic winner.
//
// So this probe's comparison is widened, for ties only: instead of comparing
// the arbitrary (golden) or deterministic (now) WINNER, it compares the max
// depth plus the full sorted SET of candidates tied at that depth. A
// non-tied entry — or any entry whose max depth itself differs — is passed
// through untouched and still fails the comparison exactly as before; only
// the "which equally-good cell won" dimension is widened away. Applied at
// COMPARE TIME in p0a-characterization.test.ts to BOTH the golden and the
// current probe output, using the SAME live-computed tie sets — golden.json
// itself is never rewritten.
// ---------------------------------------------------------------------------

export interface TieSetEntry {
  dDepth: number;
  tied: Array<{ courseCode: string; snapshotId: string }>;
}

/**
 * For every (careerTargetId, subCompetencyId) pair with at least one
 * non-retired-snapshot cell in `target_coverage`, the max dDepth and every
 * cell tied at that max (sorted by courseCode then snapshotId). Mirrors the
 * cellRows join in loadTargetSubstrate, unfiltered by target/sub-ids (one
 * query covers every target at once; callers key into the result).
 */
export async function collectCoverageTieSets(): Promise<Map<string, TieSetEntry>> {
  const rows = await db
    .select({
      careerTargetId: targetCoverage.careerTargetId,
      subCompetencyId: targetCoverage.subCompetencyId,
      courseCode: courseCaptureSnapshots.courseCode,
      snapshotId: targetCoverage.snapshotId,
      dDepth: targetCoverage.dDepth,
    })
    .from(targetCoverage)
    .innerJoin(
      courseCaptureSnapshots,
      and(
        eq(targetCoverage.snapshotId, courseCaptureSnapshots.id),
        isNull(courseCaptureSnapshots.retiredAt),
      ),
    );

  const maxBySub = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.careerTargetId}|${r.subCompetencyId}`;
    const cur = maxBySub.get(key);
    if (cur === undefined || r.dDepth > cur) maxBySub.set(key, r.dDepth);
  }
  const tiedBySub = new Map<string, Array<{ courseCode: string; snapshotId: string }>>();
  for (const r of rows) {
    const key = `${r.careerTargetId}|${r.subCompetencyId}`;
    if (r.dDepth !== maxBySub.get(key)) continue;
    const arr = tiedBySub.get(key) ?? [];
    arr.push({ courseCode: r.courseCode, snapshotId: r.snapshotId });
    tiedBySub.set(key, arr);
  }
  const out = new Map<string, TieSetEntry>();
  for (const [key, dDepth] of maxBySub) {
    const tied = (tiedBySub.get(key) ?? []).sort((a, b) =>
      a.courseCode === b.courseCode ? cmp(a.snapshotId, b.snapshotId) : cmp(a.courseCode, b.courseCode));
    out.set(key, { dDepth, tied });
  }
  return out;
}

type TargetSubstrateValue = Record<string, { coverageRollup: Array<Record<string, unknown>>; [k: string]: unknown }>;

/**
 * Pure: reduce every tied coverageRollup entry (more than one cell tied at
 * the max dDepth for that sub-competency) to {subCompetencyId,
 * subCompetencyName, dDepth, tied}, dropping bestCourseCode/kDepth/uDepth/
 * evidenceExcerpt — fields that legitimately vary by WHICH tied cell won,
 * which is exactly the dimension this comparison must not penalize. A
 * non-tied entry (0 or 1 candidate at the max) is returned unchanged, so its
 * every field is still compared exactly. See the module doc above.
 */
export function tieAwareTargetSubstrate(
  value: TargetSubstrateValue,
  tieSets: Map<string, TieSetEntry>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [targetId, ts] of Object.entries(value)) {
    const coverageRollup = ts.coverageRollup
      .map((entry) => {
        const tie = tieSets.get(`${targetId}|${entry.subCompetencyId as string}`);
        if (tie && tie.tied.length > 1) {
          return {
            subCompetencyId: entry.subCompetencyId,
            subCompetencyName: entry.subCompetencyName,
            dDepth: entry.dDepth,
            tied: tie.tied,
          };
        }
        return entry;
      })
      // Re-sort by subCompetencyId (stable, never touched by the tie bug) rather
      // than keeping sortJson's original position: collectProbes() sorted
      // coverageRollup by each entry's FULL serialized JSON, which includes the
      // arbitrary winner fields — so golden's and now's arrays can legitimately
      // place the SAME sub-competency at different indices whenever its winner
      // differs. Comparing by index without re-sorting on a stable key would
      // compare unrelated sub-competencies against each other.
      .sort((a, b) => cmp(String(a.subCompetencyId), String(b.subCompetencyId)));
    out[targetId] = { ...ts, coverageRollup };
  }
  return out;
}
