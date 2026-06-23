import { NextResponse } from 'next/server';
import { eq, and, not } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { courseMaterials, courses } from '@/lib/db/schema';
import { enqueue } from '@/lib/capture/ingest-queue';
import { ingestAction } from '@/lib/capture/ingest-selection';

/**
 * POST /api/admin/v2-backfill
 * Body: { courseCode: string }
 *
 * Re-runs the v2 ingestion path (policy → FERPA → digest → chunk →
 * contextualize → embed → upsert) on every non-set-aside material for
 * the given course. Idempotent — finalizeExtraction's v2 path calls
 * deleteByMaterial before re-upserting, so repeated runs converge.
 *
 * Requires COURSECAPTURE_V2_INGESTION=1 to do anything useful — when the
 * flag is off, finalizeExtraction runs the legacy compression path and
 * indexing_status is never set to 'ready'. The route still succeeds.
 *
 * Gated by /api/admin/* middleware (FACULTY_BASIC_AUTH).
 */
export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { courseCode?: unknown; slug?: unknown; mode?: unknown };
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const courseCode = typeof body.courseCode === 'string' ? body.courseCode.trim() : '';
  if (!courseCode) {
    return NextResponse.json({ error: 'courseCode required' }, { status: 400 });
  }
  const mode = body.mode === undefined ? 'hybrid' : body.mode;
  if (mode !== 'hybrid' && mode !== 'local') {
    return NextResponse.json({ error: "mode must be 'hybrid' or 'local'" }, { status: 400 });
  }
  const ingestProvider = mode === 'local' ? 'local' : null;

  const [courseRow] = await db
    .select({ code: courses.code })
    .from(courses)
    .where(eq(courses.code, courseCode))
    .limit(1);
  if (!courseRow) {
    return NextResponse.json({ error: 'course not found' }, { status: 404 });
  }

  const materials = await db
    .select()
    .from(courseMaterials)
    .where(and(eq(courseMaterials.courseCode, courseCode), not(eq(courseMaterials.ignored, true))));

  const results: Array<{ id: string; fileName: string; status: string; error?: string }> = [];

  for (const m of materials) {
    // Enqueue anything the worker can process — a row with extracted text OR a
    // readable local blob it can extract from disk (incl. vision OCR for
    // image-based slide decks). Skip already-'ready' rows and rows with neither
    // text nor a local blob. The old `extraction_status === 'ok'` guard wrongly
    // skipped every freshly-uploaded (still-pending) file — see ingest-selection.ts.
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

  return NextResponse.json({
    courseCode,
    count: results.length,
    queued: results.filter(r => r.status === 'queued').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    failed: results.filter(r => r.status === 'failed').length,
    results,
  });
}
