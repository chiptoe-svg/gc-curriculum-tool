import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCourseProfile } from '@/lib/db/course-profile-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getLatestSessionId, getSessionMessages } from '@/lib/db/capture-messages-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';
import { runStressTest } from '@/lib/ai/stress-test/run';
import type { CaptureChatContext } from '@/lib/ai/analyze/capture-chat';

interface RouteContext { params: Promise<{ code: string }> }

const COURSE_CODE_RE = /GC\s+\d{4}[a-z]{0,2}/gi;

function extractPrereqCodes(prerequisites: string, selfCode: string): string[] {
  const codes = (prerequisites.match(COURSE_CODE_RE) ?? [])
    .map(c => c.replace(/\s+/, ' ').toUpperCase().replace(/GC (\d)/, 'GC $1'));
  return Array.from(new Set(codes)).filter(c => c !== selfCode);
}

/**
 * POST /api/capture/[code]/stress-test?slug=...
 * Body: {}  (no client-supplied params; everything loaded server-side)
 * Returns: { result: StressTestResultType, telemetry: {...} }
 *
 * Loads the latest draft profile + latest session transcript + materials
 * for the course, then calls runStressTest. The output is advisory only —
 * never modifies the working draft.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded (ip)' }, { status: 429 });

  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const draft = await getCaptureProfileByCourse(courseCode);
  if (!draft) {
    return NextResponse.json({ error: 'no draft profile to stress-test — generate one first' }, { status: 400 });
  }

  // Reuse the exact chat context the synthesizer had so the reviewer
  // operates on the same scope. Mirrors what /api/capture/[code]/scores
  // assembles before calling generateCaptureProfileV2.
  const [builderProfile, materials] = await Promise.all([
    getCourseProfile(courseCode),
    listMaterialsByCourse(courseCode),
  ]);
  const prereqCodes = extractPrereqCodes(course.prerequisites ?? '', courseCode);
  const prereqProfilesRaw = await Promise.all(
    prereqCodes.map(async code => {
      const c = await getCourseByCode(code);
      if (!c) return null;
      const snapshot = await getLatestSnapshotByCourse(code);
      if (snapshot) {
        return { code: c.code, title: c.title, profile: snapshot.profile, reviewerStatus: `snapshot ${snapshot.caption ?? snapshot.createdAt.toISOString().slice(0, 10)}` };
      }
      const otherDraft = await getCaptureProfileByCourse(code);
      if (otherDraft) {
        return { code: c.code, title: c.title, profile: otherDraft.profile, reviewerStatus: `draft (${otherDraft.reviewerStatus})` };
      }
      return null;
    }),
  );
  const prerequisiteCaptureProfiles = prereqProfilesRaw.flatMap(p => p ? [p] : []);

  const chatContext: CaptureChatContext = {
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
        digest: m.digest,
        useDigest: m.useDigest,
        ignoredItems: m.ignoredItems,
      })),
    priorCaptureProfile: draft.profile,
    prerequisiteCaptureProfiles,
  };

  const sessionId = await getLatestSessionId(courseCode);
  const transcript = sessionId ? await getSessionMessages(courseCode, sessionId) : [];

  try {
    const out = await runStressTest({
      profile: draft.profile,
      chatContext,
      transcript,
    });
    return NextResponse.json({
      result: out.result,
      telemetry: { ...out.telemetry, model: out.model },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'stress-test failed';
    console.error(`POST /api/capture/${courseCode}/stress-test failed:`, message);
    return NextResponse.json({ error: 'stress-test failed', detail: message.slice(0, 500) }, { status: 500 });
  }
}
