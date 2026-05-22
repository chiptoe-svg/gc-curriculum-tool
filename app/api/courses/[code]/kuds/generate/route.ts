import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode, updateBuilderStatus } from '@/lib/db/courses-queries';
import { insertKudRun, upsertCourseKud } from '@/lib/db/course-kud-queries';
import { generateCourseKud } from '@/lib/ai/analyze/kud-generate';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const notes = typeof body.notes === 'string' ? body.notes.trim() : undefined;
  const rawHistory = Array.isArray(body.conversationHistory)
    ? (body.conversationHistory as Array<Record<string, unknown>>)
    : [];
  const conversationContext = rawHistory
    .filter(m => typeof m.role === 'string' && typeof m.content === 'string')
    .map(m => `${String(m.role) === 'assistant' ? 'AI' : 'Instructor'}: ${String(m.content)}`)
    .join('\n\n');

  try {
    const { data, telemetry } = await generateCourseKud({
      title: course.title,
      description: course.description,
      learningObjectives: course.learningObjectives as string[],
      majorProjects: course.majorProjects as string[],
      skillsRequired: course.skillsRequired as string[],
      notes,
      conversationContext: conversationContext || undefined,
    });

    const profileSnapshot = {
      learningObjectives: course.learningObjectives as string[],
      majorProjects: course.majorProjects as string[],
      skillsRequired: course.skillsRequired as string[],
    };

    const runId = await insertKudRun({
      courseCode,
      result: data,
      profileSnapshot,
      model: 'claude-sonnet-4-6',
      costUsdCents: telemetry.costUsdCents,
    });

    await upsertCourseKud({
      courseCode,
      thresholdConcept: data.thresholdConcept,
      know: data.know,
      understand: data.understand,
      do: data.do,
      sourceRunId: runId,
    });

    await updateBuilderStatus(courseCode, 'kuds_generated');

    return NextResponse.json({ runId, draft: data });
  } catch (err) {
    console.error(`POST /api/courses/${courseCode}/kuds/generate failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
