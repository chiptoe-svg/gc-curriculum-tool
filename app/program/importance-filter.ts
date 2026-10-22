import type { MatrixSubCompetency } from '@/lib/db/program-coverage-queries';

/** The /program importance slider: pins always show; others need weight >= floor. Read-only. */
export function filterByImportance(subs: MatrixSubCompetency[], floor: number): MatrixSubCompetency[] {
  return subs.filter(s => s.pinned || (s.weight !== null && s.weight >= floor));
}
