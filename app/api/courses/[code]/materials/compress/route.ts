import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse, updateMaterialDigest } from '@/lib/db/course-materials-queries';
import { isCompressionCandidate } from '@/lib/capture/material-compression';
import { generateMaterialDigest } from '@/lib/ai/analyze/material-digest';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// POST /api/courses/[code]/materials/compress?slug=...
// Body: { force?: boolean }  // if true, re-summarize rows that already have a summary
// Returns: { summarized: number, skipped: number, failed: number, results: ... }
//
// Backfill for materials uploaded before reference-compression shipped, or
// for re-running the summarizer after a prompt change. The primary path is
// finalizeExtraction at upload time; this endpoint is the escape hatch.
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  if (!(await authorizeCourseWrite(req, courseCode, slug))) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { force?: boolean };
  const force = body.force === true;

  const materials = await listMaterialsByCourse(courseCode);
  const candidates = materials.filter(m =>
    !m.ignored &&
    isCompressionCandidate({
      fileName: m.fileName,
      extractedText: m.extractedText,
      digest: m.digest,
      useDigest: m.useDigest,
    }) &&
    (force || m.digest === null),
  );

  let summarized = 0;
  let failed = 0;
  const skipped = materials.length - candidates.length;
  const results: Array<{ id: string; fileName: string; status: 'summarized' | 'failed'; reason?: string }> = [];

  // Serial: keeps OpenAI usage predictable. Faculty hit this rarely.
  for (const m of candidates) {
    try {
      const { digest, model } = await generateMaterialDigest({
        fileName: m.fileName,
        extractedText: m.extractedText!,
      });
      await updateMaterialDigest({ id: m.id, digest, digestModel: model });
      summarized += 1;
      results.push({ id: m.id, fileName: m.fileName, status: 'summarized' });
    } catch (err) {
      failed += 1;
      const reason = err instanceof Error ? err.message : 'unknown error';
      console.error(`material-digest failed for ${m.id} (${m.fileName})`, err);
      results.push({ id: m.id, fileName: m.fileName, status: 'failed', reason });
    }
  }

  return NextResponse.json({ summarized, skipped, failed, results });
}
