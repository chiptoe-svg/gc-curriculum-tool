/**
 * A new syllabus fully replaces the older one (owner 2026-11-06). Called after
 * any write of a syllabus row — a Syllabus-box upload or a Canvas / IMSCC import
 * (insert or in-place refresh of `Canvas: Syllabus`).
 *
 * Every other active syllabus of the same course AND the same section
 * (sourceCode; null = the course's own shell, a code = a paired lab shell) is
 * retired, set aside from the AI (ignored, with SUPERSEDED_REASON so it can be
 * told apart from a faculty or FERPA set-aside), marked unindexed, and its
 * chunks are removed from the course search index. The program index drops it
 * on its next refresh (it already excludes retired/ignored materials).
 */
import { supersedeSyllabusRows, SUPERSEDED_REASON } from '@/lib/db/course-materials-queries';
import { createVectorStore, tenantForCourse, type VectorStore } from '@/lib/capture/vector-store';

export { SUPERSEDED_REASON };

/** Returns the ids of the syllabi it replaced. */
export async function supersedeOlderSyllabi(
  written: { id: string; courseCode: string; sourceCode: string | null; isSyllabus: boolean },
  opts: { store?: VectorStore } = {},
): Promise<string[]> {
  if (!written.isSyllabus) return [];
  const replaced = await supersedeSyllabusRows(written);

  const store = opts.store ?? createVectorStore();
  const tenant = tenantForCourse(written.courseCode);
  for (const id of replaced) {
    try {
      await store.deleteByMaterial(tenant, id);
    } catch (err) {
      // The row is already ignored, so scoring and the interviewer's context
      // skip it; a failed delete only leaves stale search hits — log it.
      console.error(`[syllabus-replace] chunk delete failed for ${id}:`, err);
    }
  }
  return replaced;
}
