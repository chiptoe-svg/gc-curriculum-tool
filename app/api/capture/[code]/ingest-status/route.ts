import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { estimateIngestSeconds } from '@/lib/capture/ingest-eta';

interface RouteContext {
  params: Promise<{ code: string }>;
}

// GET /api/capture/[code]/ingest-status?slug=...
// Poll-able ingest progress: how many materials are indexed vs. still in flight,
// how many failed extraction, and a self-correcting ETA for the remainder.
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  if (!(await authorizeCourseWrite(req, courseCode, slug))) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const materials = (await listMaterialsByCourse(courseCode)).filter((m) => !m.ignored);
  const total = materials.length;
  const done = materials.filter((m) => m.indexingStatus === 'ready').length;
  const failed = materials.filter(
    (m) => m.indexingStatus === 'failed' || m.extractionStatus === 'failed',
  ).length;
  const pending = materials.filter(
    (m) => m.indexingStatus !== 'ready' && m.indexingStatus !== 'failed',
  );
  const etaSeconds = Math.round(
    estimateIngestSeconds(
      pending.map((m) => ({
        pageCount: m.pageCount ?? 1,
        imageHeavy: m.mimeType === 'application/pdf',
      })),
    ),
  );
  return NextResponse.json({ total, done, failed, etaSeconds });
}
