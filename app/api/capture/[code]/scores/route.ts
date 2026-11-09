import { creditsExhaustedResponse } from '@/lib/ai/credit-response';
import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCourseProfile } from '@/lib/db/course-profile-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import {
  getCaptureProfileByCourse,
  upsertCaptureProfile,
  setCaptureProfileStatus,
} from '@/lib/db/course-capture-profiles-queries';
import { generateCaptureProfileV2 } from '@/lib/ai/analyze/capture-scores';
import { preserveAdoptOverlay } from '@/lib/capture/adopt-overlay';
import { prereqCodesFor } from '@/lib/curriculum/prereq-map';
import type { CaptureChatContext } from '@/lib/ai/analyze/capture-chat';
import { getLatestSnapshotByCourse, getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { getSessionMode } from '@/lib/db/capture-sessions-queries';
import { buildCitationClassifiers } from '@/lib/capture/revision-evidence';
import { buildRevisionChanges } from '@/lib/capture/revision-changes';
import { getLatestSessionId, getSessionMessages } from '@/lib/db/capture-messages-queries';
import {
  captureProfileSchema,
  type CaptureProfile,
  type CaptureReviewerStatus,
} from '@/lib/ai/capture/schema';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';
import { assessMaterialsHealth } from '@/lib/capture/materials-health';
import { isSentToAI } from '@/lib/capture/material-in-use';

interface RouteContext { params: Promise<{ code: string }> }

// POST /api/capture/[code]/scores?slug=...
// Body modes:
//   { messages: ChatMessage[] }                 → generate + persist profile
//   { profile: CaptureProfile, status?: '…' }   → reviewer-edited persist
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

  const [builderProfile, materials, priorCapture, sessionId] = await Promise.all([
    getCourseProfile(courseCode),
    listMaterialsByCourse(courseCode),
    getCaptureProfileByCourse(courseCode),
    getLatestSessionId(courseCode),
  ]);

  // Revision mode chosen when an approved course was reopened (spec
  // 2026-11-08-course-revision-modes-labels-design.md). No row = today's path.
  const sessionMode = sessionId ? await getSessionMode(sessionId) : null;
  const revisionMode = sessionMode?.revisionMode ?? null;
  let baseline: Awaited<ReturnType<typeof getSnapshotById>> = null;
  if (revisionMode === 'targeted' || revisionMode === 'recheck') {
    baseline = sessionMode?.baselineSnapshotId ? await getSnapshotById(sessionMode.baselineSnapshotId) : null;
    if (!baseline || baseline.retiredAt) {
      return NextResponse.json(
        { error: 'baseline_withdrawn', message: 'The approved version this revision started from was withdrawn. Start over to revise the current version.' },
        { status: 409 },
      );
    }
  }
  // Re-check / targeted anchor on the approved snapshot; start over on nothing;
  // no mode keeps today's anchor (the draft).
  const priorProfile: CaptureProfile | null =
    baseline ? baseline.profile : revisionMode === 'fresh' ? null : priorCapture?.profile ?? null;

  // Extraction-health guard (issue #4 follow-up): a profile synthesized from a
  // corpus where materials silently failed to extract is under-evidenced. Compute
  // it, log it, and return it so the client can warn instead of scoring blind.
  const materialsHealth = assessMaterialsHealth(materials);
  if (materialsHealth.severity !== 'none') {
    console.warn(`[scores] ${courseCode}: ${materialsHealth.failedExtraction}/${materialsHealth.total} materials failed extraction (${materialsHealth.severity}) — profile will be under-evidenced. Failed: ${materialsHealth.failedFiles.join(', ')}`);
  }

  // Latest snapshot first, draft fall-back — see chat route for rationale.
  // Catalog-first prerequisite map (course sheet fallback) — the same map the
  // interview brief uses, so scoring sees the same prerequisite profiles.
  const prereqCodes = await prereqCodesFor(courseCode);
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
      .filter(isSentToAI)
      .map(m => ({
        id: m.id,
        fileName: m.fileName,
        extractionStatus: m.extractionStatus,
        extractedText: m.extractedText,
        digest: m.digest,
        useDigest: m.useDigest,
        ignoredItems: m.ignoredItems,
      })),
    priorCaptureProfile: priorProfile,
    prerequisiteCaptureProfiles,
  };

  try {
    // Synthesize from the append-only capture_messages transcript. The agent
    // persists each turn during the chat phase; here we hand the full session
    // log + materials/digests to the synthesis prompt. (v1 retired 2026-06-11.)
    const transcript = sessionId ? await getSessionMessages(courseCode, sessionId) : [];
    const { profile: rawProfile, telemetry, model } = await generateCaptureProfileV2({
      chatContext: context,
      sessionId: sessionId ?? '',
      transcript,
    });

    // Server-stamp generated_at — the model occasionally echoes a stale
    // timestamp from earlier context (e.g., the prior profile's value
    // leaking back in via transcript text), which makes the "generated"
    // line in the header lie about when synthesis actually ran. The
    // server's clock is the source of truth.
    const stampedProfile = { ...rawProfile, generated_at: new Date().toISOString() };

    // Preserve the adopt overlay (intended_target + adopted_from_scenario_id)
    // from the existing draft onto this fresh score. No-op when the draft has
    // no overlay (priorCapture is null or was never adopted).
    // Start over drops the overlay: as if the course were captured for the first time.
    const overlaid = priorCapture && revisionMode !== 'fresh'
      ? preserveAdoptOverlay(priorCapture.profile, stampedProfile)
      : stampedProfile;

    // Re-check / targeted: list every rating that moved against the approved
    // snapshot, labeled by whether it cites new evidence.
    let profile = overlaid;
    if (baseline && sessionId && (revisionMode === 'targeted' || revisionMode === 'recheck')) {
      const classifiers = await buildCitationClassifiers({
        courseCode, sessionId, baseline, materials, course, scored: overlaid,
      });
      profile = buildRevisionChanges({
        mode: revisionMode,
        baselineSnapshotId: baseline.id,
        baseline: baseline.profile,
        scored: overlaid,
        ...classifiers,
      });
    }

    // Clear the fork/drift baseline: a fresh AI re-score IS scored against the
    // current materials, so the "materials changed since the forked snapshot"
    // banner no longer applies. (The adopt target overlay is orthogonal and is
    // still carried by preserveAdoptOverlay above.)
    await upsertCaptureProfile({ courseCode, profile, reviewerStatus: 'ai_drafted', sourceSnapshotId: null });
    return NextResponse.json({
      profile,
      reviewerStatus: 'ai_drafted',
      telemetry: { ...telemetry, model },
      materialsHealth,
    });
  } catch (err) {
    const exhausted = creditsExhaustedResponse(err);
    if (exhausted) return exhausted;
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
  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  if (!(await authorizeCourseWrite(req, courseCode, slug))) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

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
