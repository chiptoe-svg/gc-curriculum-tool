import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCourseProfile } from '@/lib/db/course-profile-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { captureChatTurn, ChatMessage, CaptureChatContext } from '@/lib/ai/analyze/capture-chat';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

// Parse "GC 1040, GC 1020" / "GC 1040 or GC 1020" / etc. into a list of
// course codes. Matches the catalog convention from lib/sheets/fetchSheet.ts.
const COURSE_CODE_RE = /GC\s+\d{4}[a-z]{0,2}/gi;

function extractPrereqCodes(prerequisites: string, selfCode: string): string[] {
  const codes = (prerequisites.match(COURSE_CODE_RE) ?? [])
    .map(c => c.replace(/\s+/, ' ').toUpperCase().replace(/GC (\d)/, 'GC $1'));
  // Dedupe and exclude self.
  return Array.from(new Set(codes)).filter(c => c !== selfCode);
}

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

  // Pull any prerequisite courses' confirmed CourseCapture profiles so the
  // auditor can use them as authoritative evidence of what students arrive
  // with — the cleanest fix for the chicken-and-egg prereq problem.
  // Prefer the latest confirmed snapshot of each prereq course; fall back to
  // working draft only if no snapshot exists. Audit reasoning about upstream
  // state should be grounded in confirmed history, not in-flight edits.
  const prereqCodes = extractPrereqCodes(course.prerequisites ?? '', courseCode);
  const prereqProfilesRaw = await Promise.all(
    prereqCodes.map(async code => {
      const c = await getCourseByCode(code);
      if (!c) return null;
      const snapshot = await getLatestSnapshotByCourse(code);
      if (snapshot) {
        return { code: c.code, title: c.title, profile: snapshot.profile, reviewerStatus: `snapshot ${snapshot.caption ?? snapshot.createdAt.toISOString().slice(0, 10)}` };
      }
      const draft = await getCaptureProfileByCourse(code);
      if (draft) {
        return { code: c.code, title: c.title, profile: draft.profile, reviewerStatus: `draft (${draft.reviewerStatus})` };
      }
      return null;
    }),
  );
  const prerequisiteCaptureProfiles = prereqProfilesRaw.flatMap(p => p ? [p] : []);

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
    materials: materials
      .filter(m => !m.ignored)
      .map(m => ({
        id: m.id,
        fileName: m.fileName,
        extractionStatus: m.extractionStatus,
        extractedText: m.extractedText,
      })),
    priorCaptureProfile: priorCapture?.profile ?? null,
    prerequisiteCaptureProfiles,
  };

  try {
    const { reply, readiness } = await captureChatTurn(context, history);
    return NextResponse.json({ reply, readiness });
  } catch (err) {
    console.error(`POST /api/capture/${courseCode}/chat failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
