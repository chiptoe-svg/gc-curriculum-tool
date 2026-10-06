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
  prereqText: string | null;
  coreqText: string | null;
  notes: string[];
  catalogYear: string;
  sourceUrl: string | null;
  catalogLastSynced: string | null;
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
      courseCode: r.code, title: r.title, prereqText: r.prereq_text, coreqText: r.coreq_text,
      notes: parsed.notes, catalogYear, sourceUrl: r.source_url, catalogLastSynced: r.last_synced,
    });
    for (const e of parsed.edges) {
      edges.push({ courseCode: r.code, prereqCode: e.code, kind: e.kind, anyOfGroup: e.anyOfGroup, catalogYear });
    }
  }
  return { entries, edges };
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
