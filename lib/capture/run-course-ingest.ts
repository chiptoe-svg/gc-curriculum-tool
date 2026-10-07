import { eq, and, not } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials, courses } from '@/lib/db/schema';
import { enqueue } from '@/lib/capture/ingest-queue';
import { ingestAction } from '@/lib/capture/ingest-selection';

export type IngestMode = 'hybrid' | 'local';

export interface IngestMaterialResult {
  id: string;
  fileName: string;
  status: string;
  error?: string;
}

export interface IngestResult {
  courseCode: string;
  count: number;
  queued: number;
  skipped: number;
  failed: number;
  results: IngestMaterialResult[];
}

/**
 * Re-runs the v2 ingestion path (policy → FERPA → digest → chunk →
 * contextualize → embed → upsert) on every non-set-aside material for the
 * given course. Idempotent — finalizeExtraction's v2 path calls
 * deleteByMaterial before re-upserting, so repeated runs converge.
 *
 * Shared by POST /api/capture/[code]/ingest (course-scoped, faculty/scoped-
 * grant facing) and POST /api/admin/v2-backfill (operator/CLI, any course).
 * Returns null when the course doesn't exist.
 */
export async function runCourseIngest(courseCode: string, opts: { mode?: IngestMode } = {}): Promise<IngestResult | null> {
  const ingestProvider = opts.mode === 'local' ? 'local' : null;

  const [courseRow] = await db
    .select({ code: courses.code })
    .from(courses)
    .where(eq(courses.code, courseCode))
    .limit(1);
  if (!courseRow) return null;

  const materials = await db
    .select()
    .from(courseMaterials)
    .where(and(eq(courseMaterials.courseCode, courseCode), not(eq(courseMaterials.ignored, true))));

  const results: IngestMaterialResult[] = [];

  for (const m of materials) {
    // Security review F2 (2026-10-07): a row already 'queued' or 'indexing'
    // is in flight — re-enqueuing it restarts paid extraction/vision/digest
    // work a second time on top of the run already underway. This matters
    // more now that a single-course scoped grant (not just the shared admin
    // credential) can trigger ingest repeatedly on their own course.
    if (m.indexingStatus === 'queued' || m.indexingStatus === 'indexing') {
      results.push({ id: m.id, fileName: m.fileName, status: 'skipped' });
      continue;
    }
    // Enqueue anything the worker can process — a row with extracted text OR a
    // readable local blob it can extract from disk (incl. vision OCR for
    // image-based slide decks). Skip already-'ready' rows and rows with neither
    // text nor a local blob.
    if (ingestAction(m) === 'skip') {
      results.push({ id: m.id, fileName: m.fileName, status: 'skipped' });
      continue;
    }
    try {
      await enqueue(m.id, { ingestProvider });
      results.push({ id: m.id, fileName: m.fileName, status: 'queued' });
    } catch (e) {
      results.push({ id: m.id, fileName: m.fileName, status: 'failed', error: String(e) });
    }
  }

  return {
    courseCode,
    count: results.length,
    queued: results.filter(r => r.status === 'queued').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    failed: results.filter(r => r.status === 'failed').length,
    results,
  };
}
