/**
 * The cross-course evidence spine builder.
 *
 * Projects the current, indexable per-course chunks into a single reserved
 * `program` tenant for cross-course semantic search. Pure projection — no
 * re-embedding, no new content. Currency is derived from Postgres
 * (ready ∧ ¬ignored ∧ retired_at IS NULL) so retired/ignored/removed material
 * drops out on refresh.
 */
import {
  createVectorStore,
  tenantForCourse,
  tenantForProgram,
  type VectorStore,
  type ChunkVectorRecord,
} from '@/lib/capture/vector-store';
import { listIndexableMaterialsForCourse } from '@/lib/db/course-materials-queries';
import { listCourses } from '@/lib/db/courses-queries';

export interface RefreshOptions {
  store?: VectorStore;
  snapshotId?: string | null;
}

/** Rebuild one course's slice of the program tenant from its current materials. */
export async function refreshProgramIndex(
  courseCode: string,
  opts: RefreshOptions = {},
): Promise<void> {
  const store = opts.store ?? createVectorStore();
  const snapshotId = opts.snapshotId ?? null;

  const current = await listIndexableMaterialsForCourse(courseCode);
  const uploadedByMaterial = new Map(current.map((m) => [m.id, m.uploadedAt]));
  const keepIds = new Set(current.map((m) => m.id));

  const sourceChunks = await store.listChunksByCourse(tenantForCourse(courseCode), courseCode);
  const stamped: ChunkVectorRecord[] = sourceChunks
    .filter((c) => keepIds.has(c.materialId))
    .map((c) => ({
      ...c,
      uploadedAt: (uploadedByMaterial.get(c.materialId) ?? null)?.toISOString() ?? null,
      snapshotId,
    }));

  await store.deleteByCourse(tenantForProgram(), courseCode);
  if (stamped.length > 0) await store.upsert(tenantForProgram(), stamped);
  console.log(
    `[program-index] ${courseCode}: ${stamped.length} chunks (from ${sourceChunks.length} source)`,
  );
}

/** Full backfill / recovery: refresh every course. Batch-tolerable, run on demand. */
export async function rebuildProgramIndex(
  opts: RefreshOptions = {},
): Promise<{ courses: number }> {
  const store = opts.store ?? createVectorStore();
  const courses = await listCourses();
  const codes = courses.map((c) => c.code);
  for (const code of codes) await refreshProgramIndex(code, { store });
  return { courses: codes.length };
}
