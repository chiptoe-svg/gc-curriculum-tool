import { sql } from 'drizzle-orm';

/** The minimal shape every predicate needs — a course's two classifiers. */
export interface CourseVisibilityFields {
  scope: 'gc' | 'external';
  status: 'offered' | 'proposed' | 'sandbox' | 'retired';
}

/**
 * THE inclusion rule. A course counts in the GC program record + public surface
 * iff it is a GC course that is currently offered. Every program rollup must
 * route its course/snapshot set through this (TS) or PROGRAM_VISIBLE_SQL (raw).
 */
export function isProgramVisible(c: CourseVisibilityFields): boolean {
  return c.scope === 'gc' && c.status === 'offered';
}

/** External test/sandbox course (isolated everywhere; reachable only via its scoped link). */
export function isSandbox(c: CourseVisibilityFields): boolean {
  return c.scope === 'external' && c.status === 'sandbox';
}

/** Proposed / "test the waters" course (excluded from delivered rollups; what-if eligible). */
export function isProposed(c: CourseVisibilityFields): boolean {
  return c.status === 'proposed';
}

/**
 * SQL equivalent of isProgramVisible for raw queries. Assumes the courses table
 * is aliased `c` in the query. Keep in lockstep with isProgramVisible.
 */
export const PROGRAM_VISIBLE_SQL = sql`c.scope = 'gc' AND c.status = 'offered'`;
