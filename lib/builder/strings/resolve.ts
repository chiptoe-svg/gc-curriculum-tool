import { hashOf } from '@/lib/strings/hash';
import type { Depth, Library } from '../types';
import type { PointRow, PointStatus } from './types';

export type PoolSkill = { statement: string; hash: string };
export type NeedsCheck = { kind: 'needs-check'; snapshotId: string; pool: PoolSkill[] };

/** The course's skills for a role, from its newest capture; null when the course or the capture is missing. */
export function roleSkills(point: PointRow, lib: Library):
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
