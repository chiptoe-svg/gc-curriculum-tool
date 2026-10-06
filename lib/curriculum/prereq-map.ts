/**
 * The program's prerequisite map: Clemson catalog first, course sheet as
 * fallback. Directly linked courses only.
 *
 * Precedence, per FOCAL course:
 *   - it has a row in course_catalog_entries → its catalog edges (kinds
 *     'prereq' + 'concurrent_ok'; lab 'coreq' rows are not prerequisites),
 *     even when that means "no course prerequisites" — no sheet fallback;
 *   - otherwise → the course sheet's `courses.prerequisites` line
 *     (lib/curriculum/sheet-prereq-graph.ts), labelled source 'sheet'.
 * Only courses in our `courses` table are linked (as before with the sheet).
 *
 * The catalog tables are filled by scripts/catalog/sync-catalog-prereqs.ts
 * (migration 0053). Until that migration is applied the tables don't exist
 * and every course falls back to the sheet.
 */
import { db } from '@/lib/db/client';
import { courses, courseCatalogEntries, courseCatalogPrereqs } from '@/lib/db/schema';
import { sheetPrereqPairsFrom, type PrereqPair } from '@/lib/curriculum/sheet-prereq-graph';

export type PrereqEdgeKind = 'prereq' | 'concurrent_ok';
export type PrereqSource = 'catalog' | 'sheet';

export interface PrereqEdge extends PrereqPair {
  kind: PrereqEdgeKind;
  source: PrereqSource;
  /** Same non-null number on one focal course = any one of these satisfies. */
  anyOfGroup: number | null;
}

export interface PrereqMap {
  edges: PrereqEdge[];
  /** e.g. '2026-2027'; null when no catalog data is loaded. */
  catalogYear: string | null;
  /** Normalized codes of tracked courses that have a catalog row. */
  catalogCourses: Set<string>;
}

interface CatalogEntryRow { courseCode: string; catalogYear: string }
interface CatalogEdgeRow {
  courseCode: string;
  prereqCode: string;
  kind: string;
  anyOfGroup: number | null;
  catalogYear: string;
}

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

export function buildPrereqMap(input: {
  courses: ReadonlyArray<{ code: string; prerequisites: string | null }>;
  catalogEntries: ReadonlyArray<CatalogEntryRow>;
  catalogEdges: ReadonlyArray<CatalogEdgeRow>;
}): PrereqMap {
  const canonical = new Map(input.courses.map(r => [norm(r.code), r.code]));
  const inCatalog = new Set(input.catalogEntries.map(e => norm(e.courseCode)));
  const edges: PrereqEdge[] = [];
  const seen = new Set<string>();
  const push = (e: PrereqEdge) => {
    const k = `${norm(e.focal)}|${norm(e.prereq)}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push(e);
  };

  for (const r of input.catalogEdges) {
    if (r.kind !== 'prereq' && r.kind !== 'concurrent_ok') continue;
    const focal = canonical.get(norm(r.courseCode));
    const prereq = canonical.get(norm(r.prereqCode));
    if (!focal || !prereq || norm(focal) === norm(prereq) || !inCatalog.has(norm(focal))) continue;
    push({ focal, prereq, kind: r.kind, source: 'catalog', anyOfGroup: r.anyOfGroup });
  }
  const sheetRows = input.courses.filter(r => !inCatalog.has(norm(r.code)));
  // Sheet pairs are resolved against ALL tracked courses (a sheet-only course
  // may name a catalog-covered prerequisite).
  for (const p of sheetPrereqPairsFrom(input.courses)) {
    if (!sheetRows.some(r => norm(r.code) === norm(p.focal))) continue;
    push({ ...p, kind: 'prereq', source: 'sheet', anyOfGroup: null });
  }

  const years = new Map<string, number>();
  for (const e of input.catalogEntries) years.set(e.catalogYear, (years.get(e.catalogYear) ?? 0) + 1);
  const catalogYear = [...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const catalogCourses = new Set(input.courses.map(r => norm(r.code)).filter(c => inCatalog.has(c)));
  return { edges, catalogYear, catalogCourses };
}

function isMissingTable(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === '42P01') return true;
  }
  return false;
}

export async function loadPrereqMap(): Promise<PrereqMap> {
  const rows = await db.select({ code: courses.code, prerequisites: courses.prerequisites }).from(courses);
  let catalogEntries: CatalogEntryRow[] = [];
  let catalogEdges: CatalogEdgeRow[] = [];
  try {
    [catalogEntries, catalogEdges] = await Promise.all([
      db.select({ courseCode: courseCatalogEntries.courseCode, catalogYear: courseCatalogEntries.catalogYear }).from(courseCatalogEntries),
      db.select({
        courseCode: courseCatalogPrereqs.courseCode,
        prereqCode: courseCatalogPrereqs.prereqCode,
        kind: courseCatalogPrereqs.kind,
        anyOfGroup: courseCatalogPrereqs.anyOfGroup,
        catalogYear: courseCatalogPrereqs.catalogYear,
      }).from(courseCatalogPrereqs),
    ]);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    // Migration 0053 not applied yet: the course sheet is the only source.
    catalogEntries = [];
    catalogEdges = [];
  }
  return buildPrereqMap({ courses: rows, catalogEntries, catalogEdges });
}

const byCode = (a: string, b: string) => a.localeCompare(b);

export function prereqEdgesOf(map: PrereqMap, code: string): PrereqEdge[] {
  const c = norm(code);
  return map.edges.filter(e => norm(e.focal) === c).sort((a, b) => byCode(a.prereq, b.prereq));
}

export function dependentEdgesOf(map: PrereqMap, code: string): PrereqEdge[] {
  const c = norm(code);
  return map.edges.filter(e => norm(e.prereq) === c).sort((a, b) => byCode(a.focal, b.focal));
}

/** The direct prerequisite codes (prereq + concurrent_ok) scoring should load. */
export async function prereqCodesFor(code: string): Promise<string[]> {
  return [...new Set(prereqEdgesOf(await loadPrereqMap(), code).map(e => e.prereq))];
}

/** Where a course's own prerequisite list comes from. */
export function prereqSourceOf(map: PrereqMap, code: string): PrereqSource {
  return map.catalogCourses.has(norm(code)) ? 'catalog' : 'sheet';
}

/** '2026-2027' → 'Clemson catalog 2026–27'. */
export function prereqSourceLabel(map: Pick<PrereqMap, 'catalogYear'>, source: PrereqSource): string {
  if (source === 'sheet') return 'course sheet';
  const m = map.catalogYear?.match(/^(\d{4})-\d{2}(\d{2})$/);
  return m ? `Clemson catalog ${m[1]}–${m[2]}` : 'Clemson catalog';
}
