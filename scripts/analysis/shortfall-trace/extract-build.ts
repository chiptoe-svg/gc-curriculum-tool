/**
 * Turns raw rows from the live database into the extract JSON the CLI reads. Pure (extract.ts does the I/O).
 *
 * Coverage-reading rule, mirrored from lib/builder/library.ts + lib/db/live-captures.ts:
 *  - the capture is a non-retired snapshot; one per (course, instructor): scored ones first, then newest;
 *    the builder's map uses the first of those per course (versionOf takes versions[0]);
 *  - its depths are the competency_levels view (faculty level, else AI level, else the scorer's level; 0 when
 *    faculty rejected every link or the level is still needed), which is what the builder's rollUp passes through.
 */
export interface RawComp { id: string; name: string; foundational: boolean; weight: number | null; basis: string }
export interface RawRows {
  target: { id: string; name: string };
  path: string[];
  competencies: RawComp[];
  titles: Record<string, string>;
  /** Non-retired snapshots of the path courses. */
  snapshots: Array<{ id: string; course: string; instructor: string | null; createdAt: string }>;
  /** Snapshot ids with any scoring at all (any snapshot_competency_coverage row), for any competency. */
  scored: string[];
  /** competency_levels rows for the scope competencies. */
  levels: Array<{ snapshotId: string; competencyId: string; k: number | null; u: number | null; d: number; method: string }>;
  prereqs: Array<{ course: string; prereq: string; kind: string }>;
}

export interface ExtractCourse {
  code: string; title: string; captured: boolean;
  snapshotId: string | null; snapshotCreatedAt: string | null; liveSnapshots: number;
  note: string | null;
  depths: Record<string, { k: number | null; u: number | null; d: number; method: string }>;
}
export interface Extract {
  rule: string;
  target: { id: string; name: string };
  path: string[];
  competencies: RawComp[];
  courses: ExtractCourse[];
  prereqs: Array<{ course: string; prereq: string; kind: string }>;
}

export function buildExtract(raw: RawRows): Extract {
  const onPath = new Set(raw.path);
  const prereqs = raw.prereqs.filter(p => onPath.has(p.course) && onPath.has(p.prereq));
  for (const p of prereqs) {
    if (p.kind === 'coreq') continue; // a corequisite runs both ways and sets no order
    if (raw.path.indexOf(p.prereq) >= raw.path.indexOf(p.course)) {
      throw new Error(`path is not in topological order: ${p.prereq} (${p.kind}) must come before ${p.course}`);
    }
  }
  const scored = new Set(raw.scored);
  const foundational = new Map(raw.competencies.map(c => [c.id, c.foundational]));
  const courses: ExtractCourse[] = raw.path.map(code => {
    const live = raw.snapshots.filter(s => s.course === code)
      .sort((a, b) => Number(scored.has(b.id)) - Number(scored.has(a.id)) || b.createdAt.localeCompare(a.createdAt));
    const pick = live[0];
    const base = { code, title: raw.titles[code] ?? '', liveSnapshots: live.length };
    if (!pick) return { ...base, captured: false, snapshotId: null, snapshotCreatedAt: null, note: 'no live snapshot', depths: {} };
    if (!scored.has(pick.id)) {
      return { ...base, captured: false, snapshotId: null, snapshotCreatedAt: null, note: 'a live snapshot exists but has no competency levels', depths: {} };
    }
    const depths: ExtractCourse['depths'] = {};
    for (const r of raw.levels.filter(l => l.snapshotId === pick.id)) {
      depths[r.competencyId] = foundational.get(r.competencyId)
        ? { k: null, u: null, d: r.d, method: r.method }
        : { k: r.k, u: r.u, d: r.d, method: r.method };
    }
    return { ...base, captured: true, snapshotId: pick.id, snapshotCreatedAt: pick.createdAt, note: null, depths };
  });
  return {
    rule: 'Per course: newest scored non-retired snapshot (scored first, then newest, as lib/builder/library.ts versionOf); depths from the competency_levels view (faculty level, else AI level, else scorer level). A course without a scored live snapshot is not captured.',
    target: raw.target, path: raw.path, competencies: raw.competencies, courses, prereqs,
  };
}
