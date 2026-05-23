import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCourseProfile } from '@/lib/db/course-profile-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import {
  getCaptureProfileByCourse,
  upsertCaptureProfile,
  setCaptureProfileStatus,
} from '@/lib/db/course-capture-profiles-queries';
import { generateCaptureProfile } from '@/lib/ai/analyze/capture-scores';
import type { ChatMessage, CaptureChatContext } from '@/lib/ai/analyze/capture-chat';
import {
  captureProfileSchema,
  type CaptureProfile,
  type CaptureReviewerStatus,
} from '@/lib/ai/capture/schema';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// POST /api/capture/[code]/scores?slug=...
// Body modes:
//   { messages: ChatMessage[] }                 → generate + persist profile
//   { profile: CaptureProfile, status?: '…' }   → reviewer-edited persist
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

  // Mode 2: reviewer-edited persist (faculty confirmed/edited the AI draft).
  if (body.profile && typeof body.profile === 'object') {
    let parsed: CaptureProfile;
    try {
      parsed = captureProfileSchema.parse(body.profile);
    } catch (err) {
      return NextResponse.json(
        { error: 'invalid profile', detail: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }
    const status: CaptureReviewerStatus =
      body.status === 'confirmed' ? 'confirmed'
        : body.status === 'edited' ? 'edited'
        : 'edited';
    await upsertCaptureProfile({
      courseCode,
      profile: parsed,
      reviewerStatus: status,
      reviewerNote: typeof body.reviewerNote === 'string' ? body.reviewerNote : null,
    });
    return NextResponse.json({ profile: parsed, reviewerStatus: status });
  }

  // Mode 1: generate from transcript.
  if (!Array.isArray(body.messages)) {
    return NextResponse.json(
      { error: 'expected { messages: [...] } or { profile: {...} }' },
      { status: 400 },
    );
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
    materials: materials
      .filter(m => !m.ignored)
      .map(m => ({
        id: m.id,
        fileName: m.fileName,
        extractionStatus: m.extractionStatus,
        extractedText: m.extractedText,
      })),
    priorCaptureProfile: priorCapture?.profile ?? null,
  };

  try {
    const { profile, telemetry, model } = await generateCaptureProfile(context, history);
    await upsertCaptureProfile({ courseCode, profile, reviewerStatus: 'ai_drafted' });
    return NextResponse.json({
      profile,
      reviewerStatus: 'ai_drafted',
      telemetry: { ...telemetry, model },
    });
  } catch (err) {
    console.error(`POST /api/capture/${courseCode}/scores failed`, err);
    return NextResponse.json(
      { error: 'scoring failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// PATCH /api/capture/[code]/scores?slug=...
// Body: { status: 'confirmed' | 'edited', reviewerNote?: string }
// Toggles the reviewer status without rewriting the profile blob.
export async function PATCH(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const status = body.status === 'confirmed' || body.status === 'edited' || body.status === 'ai_drafted'
    ? body.status as CaptureReviewerStatus
    : null;
  if (!status) {
    return NextResponse.json({ error: 'status must be confirmed | edited | ai_drafted' }, { status: 400 });
  }
  const note = typeof body.reviewerNote === 'string' ? body.reviewerNote : null;
  const updated = await setCaptureProfileStatus(courseCode, status, note);
  if (!updated) return NextResponse.json({ error: 'no profile to update' }, { status: 404 });
  return NextResponse.json({ reviewerStatus: status });
}
