import type { Library } from '@/lib/builder/types';
import type { PointRow, PointStatus } from '@/lib/builder/strings/types';
import { resolveExact } from '@/lib/builder/strings/resolve';

/** Each point's standing from exact matching alone (no model call): a point needing the reword check reads as unchecked. */
export function exactStatuses(lib: Library, points: PointRow[]): Record<string, PointStatus> {
  const out: Record<string, PointStatus> = {};
  for (const p of points) {
    const held = new Set(points.filter((o) => o.id !== p.id && o.courseCode === p.courseCode && o.role === p.role).map((o) => o.statementHash));
    const r = resolveExact(p, lib, held);
    out[p.id] = r.kind === 'needs-check' ? { kind: 'unchecked' } : r;
  }
  return out;
}
