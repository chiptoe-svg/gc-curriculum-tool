import type { SearchHit } from '@/lib/capture/vector-store';

/** Comparison mode: keep at most `perCourse` highest-scoring hits per course,
 *  preserving overall descending-score order. A verbose course can't crowd out
 *  the comparison. Assumes `hits` is already score-sorted (Weaviate returns it so). */
export function diversifyByCourse(hits: SearchHit[], perCourse: number): SearchHit[] {
  const seen = new Map<string, number>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    const n = seen.get(h.courseCode) ?? 0;
    if (n >= perCourse) continue;
    seen.set(h.courseCode, n + 1);
    out.push(h);
  }
  return out;
}
