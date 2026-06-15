import { isProgramVisible, isSandbox, isProposed } from '@/lib/courses/program-visibility';

/**
 * The roster-row shape this helper needs. Note: on `CourseStatusRow` the lifecycle
 * field is `courseStatus` (the plain `status` field there is the capture-ladder
 * status — not-started / captured / …), hence the field name here.
 */
export interface RosterVisibilityFields {
  scope: 'gc' | 'external';
  courseStatus: 'offered' | 'proposed' | 'sandbox' | 'retired';
}

export interface RosterPartition<T> {
  /** GC + offered — the normal roster (grouped by category as before). */
  gc: T[];
  /** GC + proposed — "test the waters" courses, segregated. */
  proposed: T[];
  /** External + sandbox — outside-party test courses, segregated. */
  external: T[];
}

/**
 * Partition roster rows into the GC-visible set plus the two segregated sections.
 * `retired` rows fall out of all three buckets (hidden by default). Routes scope +
 * courseStatus through the single inclusion predicates in program-visibility.ts.
 */
export function partitionRosterRows<T extends RosterVisibilityFields>(rows: T[]): RosterPartition<T> {
  const fields = (r: T) => ({ scope: r.scope, status: r.courseStatus });
  return {
    gc: rows.filter((r) => isProgramVisible(fields(r))),
    proposed: rows.filter((r) => r.scope === 'gc' && isProposed(fields(r))),
    external: rows.filter((r) => isSandbox(fields(r))),
  };
}
