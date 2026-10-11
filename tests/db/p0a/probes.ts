/**
 * P0a characterization probes: the outputs of every read path P0a re-points,
 * in canonical JSON form. Captured with the pre-P0a code on a pre-migration
 * scratch clone (the golden), then compared with the P0a code on the migrated
 * clone. Arrays whose order the code defines (ORDER BY or an explicit sort) are
 * kept as returned. Arrays with no defined order (no ORDER BY) go through
 * sortJson, so the comparison does not depend on Postgres heap order.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
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
