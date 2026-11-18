import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import type { Depth, Library } from '../types';
import type { PointRow, PointStatus } from './types';
import { checkRewords } from '@/lib/strings/reword';

export type PoolSkill = { statement: string; hash: string };
export type NeedsCheck = { kind: 'needs-check'; snapshotId: string; pool: PoolSkill[] };

const hashOf = (s: string) => textHash(normalizeStatement(s));
const heldKey = (p: { courseCode: string; role: string }) => `${p.courseCode}|${p.role}`;

/** The course's skills for a role, from its newest capture; null when the course or the capture is missing. */
function roleSkills(point: PointRow, lib: Library):
  | { why: 'course not found' | 'no capture' }
  | { snapshotId: string; skills: Array<PoolSkill & { depth: Depth }> } {
  const course = lib.courses.find((c) => c.code === point.courseCode);
  if (!course) return { why: 'course not found' };
  const v = course.versions[0];
  if (!v) return { why: 'no capture' };
  const skills = point.role === 'develops'
    ? v.skills.map((s) => ({ statement: s.statement, hash: hashOf(s.statement), depth: { k: s.k, u: s.u, d: s.d } }))
    : v.required.map((s) => ({ statement: s.statement, hash: hashOf(s.statement), depth: s.need }));
  return { snapshotId: v.snapshotId, skills };
}

/**
 * Settles a point against the current capture without any model: same hash = intact; otherwise the skills no other
 * point of this course and role holds go to the reword check. `held` = statement hashes of the OTHER such points.
 */
export function resolveExact(point: PointRow, lib: Library, held: Set<string>): PointStatus | NeedsCheck {
  const r = roleSkills(point, lib);
  if ('why' in r) return { kind: 'unanchored', why: r.why };
  const same = r.skills.find((s) => s.hash === point.statementHash);
  if (same) return { kind: 'intact', now: same.depth };
  const pool = r.skills.filter((s) => !held.has(s.hash)).map(({ statement, hash }) => ({ statement, hash }));
  if (pool.length === 0) return { kind: 'unanchored', why: 'skill gone' };
  return { kind: 'needs-check', snapshotId: r.snapshotId, pool };
}

export async function resolveAll(lib: Library, points: PointRow[]): Promise<Record<string, PointStatus>> {
  const heldBy = new Map<string, Map<string, string>>(); // course|role -> hash -> point id
  for (const p of points) {
    const k = heldKey(p);
    if (!heldBy.has(k)) heldBy.set(k, new Map());
    heldBy.get(k)!.set(p.statementHash, p.id);
  }
  const out: Record<string, PointStatus> = {};
  const checks: Array<{ point: PointRow; snapshotId: string; pool: PoolSkill[] }> = [];
  for (const p of points) {
    const held = new Set([...(heldBy.get(heldKey(p)) ?? [])].filter(([, id]) => id !== p.id).map(([h]) => h));
    const r = resolveExact(p, lib, held);
    if (r.kind === 'needs-check') checks.push({ point: p, snapshotId: r.snapshotId, pool: r.pool });
    else out[p.id] = r;
  }
  if (checks.length === 0) return out;
  const rewords = await checkRewords(checks);
  for (const c of checks) {
    const s = rewords[c.point.id] ?? { kind: 'unchecked' as const };
    if (s.kind === 'changed') {
      // The reword check knows statements only; the candidate's depth comes from the capture.
      const hit = roleSkills(c.point, lib);
      const cand = 'skills' in hit ? hit.skills.find((x) => x.hash === s.candidate.hash) : undefined;
      out[c.point.id] = { ...s, now: cand?.depth ?? null };
    } else out[c.point.id] = s;
  }
  return out;
}
