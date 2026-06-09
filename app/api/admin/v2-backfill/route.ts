import { NextResponse } from 'next/server';
import { eq, and, not } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { isValidSlug } from '@/lib/slug';
import { courseMaterials, courses } from '@/lib/db/schema';
import { finalizeExtraction } from '@/lib/capture/finalize-extraction';
import { createVectorStore } from '@/lib/capture/vector-store';

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
  const body = await req.json().catch(() => ({})) as { courseCode?: unknown; slug?: unknown };
  if (!isValidSlug(typeof body.slug === 'string' ? body.slug : '')) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const courseCode = typeof body.courseCode === 'string' ? body.courseCode.trim() : '';
  if (!courseCode) {
    return NextResponse.json({ error: 'courseCode required' }, { status: 400 });
  }

  const [course] = await db
    .select()
    .from(courses)
    .where(eq(courses.code, courseCode))
    .limit(1);
  if (!course) {
    return NextResponse.json({ error: 'course not found' }, { status: 404 });
  }

  const materials = await db
    .select()
    .from(courseMaterials)
    .where(and(eq(courseMaterials.courseCode, courseCode), not(eq(courseMaterials.ignored, true))));

  const vectorStore = createVectorStore();
  const results: Array<{ id: string; fileName: string; status: string; error?: string }> = [];

  for (const m of materials) {
    if (m.extractionStatus !== 'ok' || !m.extractedText) {
      results.push({ id: m.id, fileName: m.fileName, status: 'skipped' });
      continue;
    }
    try {
      await finalizeExtraction({
        id: m.id,
        courseCode,
        fileName: m.fileName,
        extractionStatus: 'ok',
        extractedText: m.extractedText,
        vectorStore,
        courseHasLearningObjectives: course.learningObjectives.length > 0,
      });
      // finalizeExtraction catches its own pipeline errors and sets
      // indexing_status='failed' instead of throwing. Re-read the
      // canonical status from the DB to know whether the material
      // actually indexed.
      const [updated] = await db
        .select({ status: courseMaterials.indexingStatus })
        .from(courseMaterials)
        .where(eq(courseMaterials.id, m.id))
        .limit(1);
      const actual = updated?.status ?? 'unknown';
      if (actual === 'ready') {
        results.push({ id: m.id, fileName: m.fileName, status: 'ok' });
      } else if (actual === 'skipped') {
        results.push({ id: m.id, fileName: m.fileName, status: 'skipped' });
      } else {
        results.push({ id: m.id, fileName: m.fileName, status: 'failed', error: `indexing_status=${actual} after finalizeExtraction (see server log)` });
      }
    } catch (e) {
      results.push({ id: m.id, fileName: m.fileName, status: 'failed', error: String(e) });
    }
  }

  return NextResponse.json({
    courseCode,
    count: results.length,
    ok: results.filter(r => r.status === 'ok').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    failed: results.filter(r => r.status === 'failed').length,
    results,
  });
}
