/**
 * Pure helpers for skill strings on a cluster: which skills a string may run through, which existing strings a
 * required skill could be added to, and the course-to-course curves drawn on the canvas.
 */
import { WHAT_IF_PREFIX } from '@/lib/builder/compute';
import type { ClusterState } from '@/lib/builder/cluster/state';
import type { Library } from '@/lib/builder/types';
import type { PointRow, Role, StringGraph, StringRow } from '@/lib/builder/strings/types';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';

export const CAPTURED_ONLY = 'Strings can only run through captured courses.';

/** A skill as the string API takes it. */
export interface LockPoint {
  courseCode: string; role: Role; statement: string; snapshotId: string; k: number | null; u: number | null; d: number | null;
}

const hashOf = (s: string) => textHash(normalizeStatement(s));

/**
 * The skill as a string point, or null when it cannot be one: only a captured catalog course counts, and the statement
 * must be in its newest capture as written (not a what-if chosen on the cluster, a proposed course, or a map edit or draft).
 */
export function lockPoint(library: Library, cluster: ClusterState, ref: string, role: Role, statement: string): LockPoint | null {
  const lc = library.courses.find(c => c.code === ref);
  const v = lc?.versions[0];
  if (!lc || !v || cluster.versions[ref]?.startsWith(WHAT_IF_PREFIX)) return null;
  if (role === 'develops') {
    const s = v.skills.find(x => x.statement === statement);
    return s ? { courseCode: ref, role, statement, snapshotId: v.snapshotId, k: s.k, u: s.u, d: s.d } : null;
  }
  const r = v.required.find(x => x.statement === statement);
  return r ? { courseCode: ref, role, statement, snapshotId: v.snapshotId, k: r.need.k, u: r.need.u, d: r.need.d } : null;
}

/** Every skill a string could run through on this cluster's captured cards, for the extend and branch pickers. */
export function lockTargets(library: Library, cluster: ClusterState): LockPoint[] {
  const out: LockPoint[] = [];
  for (const card of cluster.cards) {
    const v = library.courses.find(c => c.code === card.ref)?.versions[0];
    if (!v) continue;
    for (const s of v.skills) { const p = lockPoint(library, cluster, card.ref, 'develops', s.statement); if (p) out.push(p); }
    for (const r of v.required) { const p = lockPoint(library, cluster, card.ref, 'requires', r.statement); if (p) out.push(p); }
  }
  return out;
}

/** A skill offered to LockString: `snapshotId` is null when it cannot be on a string (see lockPoint). */
export type SkillInput = Omit<LockPoint, 'snapshotId'> & { snapshotId: string | null };

export const sameSkill = (p: PointRow, q: Pick<SkillInput, 'courseCode' | 'role' | 'statement'>) =>
  p.courseCode === q.courseCode && p.role === q.role && p.statementHash === hashOf(q.statement);

export type AddOption =
  | { kind: 'extend-end'; string: StringRow; supplier: SkillInput }
  | { kind: 'extend-start'; string: StringRow; supplier: SkillInput }
  | { kind: 'branch'; string: StringRow; supplier: SkillInput; position: number };

/** Where a required skill and a ticked supplier could join an existing active string. */
export function addOptions(g: StringGraph, required: SkillInput, suppliers: SkillInput[]): AddOption[] {
  const out: AddOption[] = [];
  for (const str of g.strings) {
    if (str.status !== 'active') continue;
    const pts = str.path.map(id => g.points[id]);
    if (pts.some(p => !p)) continue;
    const rows = pts as PointRow[];
    const hasR = rows.some(p => sameSkill(p, required));
    for (const s of suppliers) {
      const at = rows.findIndex(p => sameSkill(p, s));
      if (at === -1) continue;
      if (!hasR && at === rows.length - 1) out.push({ kind: 'extend-end', string: str, supplier: s });
      else if (!hasR) out.push({ kind: 'branch', string: str, supplier: s, position: at });
    }
    if (rows[0] && sameSkill(rows[0], required)) {
      for (const s of suppliers) if (!rows.some(p => sameSkill(p, s))) out.push({ kind: 'extend-start', string: str, supplier: s });
    }
  }
  return out;
}

export interface StringCurve { id: string; name: string; color: number; hops: Array<{ from: string; to: string }> }

/** One curve set per active string with at least two different courses on the cluster's cards. */
export function stringCurves(g: StringGraph, cardCodes: ReadonlySet<string>): StringCurve[] {
  const out: StringCurve[] = [];
  g.strings.forEach((s, i) => {
    if (s.status !== 'active') return;
    const codes: string[] = [];
    for (const id of s.path) {
      const c = g.points[id]?.courseCode;
      if (c && cardCodes.has(c) && codes[codes.length - 1] !== c) codes.push(c);
    }
    const hops = codes.slice(1).map((to, j) => ({ from: codes[j]!, to })).filter(h => h.from !== h.to);
    if (hops.length) out.push({ id: s.id, name: s.name, color: i % 6, hops });
  });
  return out;
}
