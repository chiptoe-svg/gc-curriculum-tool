import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import {
  generateIngestionCheckIn,
  type CheckInInput,
  type CheckInResult,
} from '@/lib/ai/analyze/ingestion-checkin';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// GET /api/courses/[code]/checkin?slug=...
//
// Pre-audit curation review: pulls the course catalog row + indexable
// materials, asks generateIngestionCheckIn for a heads-up (FERPA risk
// kept, key sources missing, stacked auto-set-asides), returns either
// an empty-silent payload or a one-line message + up to three highlights.
//
// Light-tier; ~1–3s on qwen3.6-35b-a3b-fp8. Fine to run on every page
// open during the trial. Silent on AI failure — the panel just renders
// nothing.
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  // Mirror the audit-context filter: only materials the audit chat could
  // actually retrieve evidence from.
  const materials = (await listMaterialsByCourse(courseCode))
    .filter(m => !m.ignored && m.extractionStatus === 'ok');

  const input: CheckInInput = {
    catalog: {
      code: course.code,
      title: course.title,
      learningObjectives: course.learningObjectives ?? [],
      majorProjects: course.majorProjects ?? [],
    },
    materials: materials.map(m => ({
      fileName: m.fileName,
      ferpaRisk: (m.ferpaRisk ?? 'low') as 'low' | 'medium' | 'high',
      autoSetAside: !!m.autoSetAside,
      setAsideReason: m.setAsideReason ?? null,
      digestSnippet: (m.digest ?? m.extractedText ?? '').slice(0, 400),
    })),
  };

  try {
    const result = await generateIngestionCheckIn(input);
    return NextResponse.json(result);
  } catch (e) {
    // Silent failure — the panel renders nothing if the AI call fails.
    console.error('ingestion-checkin failed:', e);
    const empty: CheckInResult = { message: null, highlights: [], model: 'failed' };
    return NextResponse.json(empty);
  }
}
