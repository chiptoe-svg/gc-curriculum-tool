/**
 * Pure transform from clemson-advising catalog rows to our
 * course_catalog_entries / course_catalog_prereqs rows (migration 0053).
 * Used by scripts/catalog/sync-catalog-prereqs.ts and
 * scripts/catalog/prereq-discrepancies.ts. No I/O here.
 */
import { parseCatalogPrereqs, parseCatalogCoreqs, type CatalogEdge, type CatalogEdgeKind } from '@/lib/catalog/catalog-prereq-parser';

export interface CatalogCourseRow {
  code: string;
  title: string | null;
  prereq_text: string | null;
  coreq_text: string | null;
  last_synced: string | null;
  source_url: string | null;
}

export interface CatalogEntryInsert {
  courseCode: string;
  title: string | null;
  // Full-catalog course info (2026-10-07 access-panel addendum, migration
  // 0055) — null from buildCatalogSyncRows (it never reads these columns);
  // populated by buildFullCatalogEntries below.
  description: string | null;
  credits: string | null;
  prereqText: string | null;
  coreqText: string | null;
  notes: string[];
  catalogYear: string;
  sourceUrl: string | null;
  catalogLastSynced: string | null;
}

/** A full catalog.db `course` row (code, title, credits, description, plus
 * the provenance fields `buildFullCatalogEntries` needs) — the shape
 * scripts/catalog/sync-catalog-courses.ts reads for EVERY course, not just
 * GC + tracked ones. */
export interface FullCatalogCourseRow {
  code: string;
  title: string | null;
  credits: string | null;
  description: string | null;
  last_synced: string | null;
  source_url: string | null;
}

export interface CatalogEdgeInsert {
  courseCode: string;
  prereqCode: string;
  kind: CatalogEdgeKind;
  anyOfGroup: number | null;
  catalogYear: string;
}

export function catalogYearOf(sourceUrl: string | null, yearByCatoid: ReadonlyMap<number, string>): string {
  const m = sourceUrl?.match(/[?&]catoid=(\d+)/);
  return (m && yearByCatoid.get(Number(m[1]))) || 'unknown';
}

export function catalogEdgesOf(row: Pick<CatalogCourseRow, 'code' | 'prereq_text' | 'coreq_text'>): { edges: CatalogEdge[]; notes: string[] } {
  const parsed = parseCatalogPrereqs(row.prereq_text);
  const coreqs = parseCatalogCoreqs(row.coreq_text).filter(c => !parsed.edges.some(e => e.code === c.code));
  return {
    edges: [...parsed.edges, ...coreqs].filter(e => e.code !== row.code),
    notes: parsed.notes,
  };
}

export function buildCatalogSyncRows(
  rows: ReadonlyArray<CatalogCourseRow>,
  yearByCatoid: ReadonlyMap<number, string>,
): { entries: CatalogEntryInsert[]; edges: CatalogEdgeInsert[] } {
  const entries: CatalogEntryInsert[] = [];
  const edges: CatalogEdgeInsert[] = [];
  for (const r of rows) {
    const catalogYear = catalogYearOf(r.source_url, yearByCatoid);
    const parsed = catalogEdgesOf(r);
    entries.push({
      courseCode: r.code, title: r.title, description: null, credits: null,
      prereqText: r.prereq_text, coreqText: r.coreq_text,
      notes: parsed.notes, catalogYear, sourceUrl: r.source_url, catalogLastSynced: r.last_synced,
    });
    for (const e of parsed.edges) {
      edges.push({ courseCode: r.code, prereqCode: e.code, kind: e.kind, anyOfGroup: e.anyOfGroup, catalogYear });
    }
  }
  return { entries, edges };
}

/**
 * The full-catalog counterpart to buildCatalogSyncRows: one entry per row,
 * every Clemson course (not scoped to GC + tracked). Carries title/
 * description/credits; leaves prereqText/coreqText/notes null/empty — that
 * data is sync-catalog-prereqs.ts's to own for its scoped subset, and this
 * sync's upsert never overwrites those columns on an existing row (see the
 * script) so the two syncs layer safely regardless of run order, EXCEPT
 * that sync-catalog-prereqs.ts's unscoped `DELETE FROM course_catalog_entries`
 * would wipe rows this sync added — run this sync AFTER sync-catalog-prereqs.ts.
 */
export function buildFullCatalogEntries(
  rows: ReadonlyArray<FullCatalogCourseRow>,
  yearByCatoid: ReadonlyMap<number, string>,
): CatalogEntryInsert[] {
  return rows.map((r) => ({
    courseCode: r.code,
    title: r.title,
    description: r.description,
    credits: r.credits,
    prereqText: null,
    coreqText: null,
    notes: [],
    catalogYear: catalogYearOf(r.source_url, yearByCatoid),
    sourceUrl: r.source_url,
    catalogLastSynced: r.last_synced,
  }));
}

/** "GC 3500, (GC 4060 | GC 4400), COOP 2020 (or concurrent)" — prereq + concurrent_ok only. */
export function formatCatalogPrereqs(edges: ReadonlyArray<Pick<CatalogEdge, 'code' | 'kind' | 'anyOfGroup'>>): string {
  const parts: string[] = [];
  const doneGroups = new Set<number>();
  const label = (e: Pick<CatalogEdge, 'code' | 'kind'>) => (e.kind === 'concurrent_ok' ? `${e.code} (or concurrent)` : e.code);
  for (const e of edges) {
    if (e.kind === 'coreq') continue;
    if (e.anyOfGroup === null) { parts.push(label(e)); continue; }
    if (doneGroups.has(e.anyOfGroup)) continue;
    doneGroups.add(e.anyOfGroup);
    parts.push(`(${edges.filter(x => x.anyOfGroup === e.anyOfGroup && x.kind !== 'coreq').map(label).join(' | ')})`);
  }
  return parts.join(', ');
}
