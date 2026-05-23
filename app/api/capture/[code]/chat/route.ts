import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCourseProfile } from '@/lib/db/course-profile-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { captureChatTurn, ChatMessage, CaptureChatContext } from '@/lib/ai/analyze/capture-chat';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// POST /api/capture/[code]/chat?slug=...
// Body: { messages: ChatMessage[] }
// Returns: { reply: string }
//
// Stateless multi-turn chat. The full conversation history is provided on
// each request; we re-load the course context server-side every time so the
// caller doesn't have to round-trip large blobs.
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
  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
  }

  const history: ChatMessage[] = (body.messages as unknown[])
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        typeof m === 'object' &&
        m !== null &&
        ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string',
    )
    .map(m => ({ role: m.role, content: m.content }));

  const [builderProfile, materials, priorCapture] = await Promise.all([
    getCourseProfile(courseCode),
    listMaterialsByCourse(courseCode),
    getCaptureProfileByCourse(courseCode),
  ]);

  const context: CaptureChatContext = {
    course: {
      code: course.code,
      title: course.title,
      description: course.description ?? '',
      prerequisites: course.prerequisites ?? '',
      learningObjectives: course.learningObjectives as string[],
      majorProjects: course.majorProjects as string[],
      skillsRequired: course.skillsRequired as string[],
    },
    builderProfile: builderProfile
      ? {
          summary: builderProfile.summary,
          learningObjectives: builderProfile.learningObjectives,
          skills: builderProfile.skills,
          competencies: builderProfile.competencies,
        }
      : null,
    materials: materials.map(m => ({
      id: m.id,
      fileName: m.fileName,
      extractionStatus: m.extractionStatus,
      extractedText: m.extractedText,
    })),
    priorCaptureProfile: priorCapture?.profile ?? null,
  };

  try {
    const reply = await captureChatTurn(context, history);
    return NextResponse.json({ reply });
  } catch (err) {
    console.error(`POST /api/capture/${courseCode}/chat failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
