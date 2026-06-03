import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCourseProfile } from '@/lib/db/course-profile-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCaptureProfileByCourse, setCaptureProfileStatus } from '@/lib/db/course-capture-profiles-queries';
import { getCaptureConversation } from '@/lib/db/capture-conversations-queries';
import { getLatestSessionId, getSessionInstructor } from '@/lib/db/capture-messages-queries';
import { getLatestSnapshotByCourse, createSnapshot, listSnapshotsByCourse, type InputsMeta } from '@/lib/db/capture-snapshots-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';
import { updateWikiForSnapshot } from '@/lib/ai/wiki/update';
import { writeAndPush } from '@/lib/wiki/git-ops';

interface RouteContext { params: Promise<{ code: string }> }

const COURSE_CODE_RE = /GC\s+\d{4}[a-z]{0,2}/gi;

// POST /api/capture/[code]/snapshots?slug=...
// Body: { caption?: string, captionNote?: string }
// Copies the current working draft into a new immutable snapshot row,
// freezing the inputs context that produced it. Marks the working draft
// as 'confirmed' so subsequent edits move it back to 'edited'.
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
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const draft = await getCaptureProfileByCourse(courseCode);
  if (!draft) {
    return NextResponse.json(
      { error: 'no working draft to snapshot — run Generate Course Outcome Profile first' },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const caption = typeof body.caption === 'string' && body.caption.trim().length > 0
    ? body.caption.trim()
    : null;
  const captionNote = typeof body.captionNote === 'string' && body.captionNote.trim().length > 0
    ? body.captionNote.trim()
    : null;

  const [builderProfile, materials, conversation] = await Promise.all([
    getCourseProfile(courseCode),
    listMaterialsByCourse(courseCode),
    getCaptureConversation(courseCode),
  ]);

  // Collect prereq snapshots that were in play at snapshot time.
  const prereqCodes = (course.prerequisites ?? '').match(COURSE_CODE_RE)?.map(c =>
    c.replace(/\s+/, ' ').toUpperCase().replace(/GC (\d)/, 'GC $1'),
  ) ?? [];
  const prereqSnapshots = await Promise.all(
    Array.from(new Set(prereqCodes))
      .filter(c => c !== courseCode)
      .map(async code => {
        const snap = await getLatestSnapshotByCourse(code);
        return snap ? { courseCode: code, snapshotId: snap.id, caption: snap.caption } : null;
      }),
  );

  const inputsMeta: InputsMeta = {
    catalog: {
      description: course.description ?? '',
      prerequisites: course.prerequisites ?? '',
      learningObjectives: course.learningObjectives as string[],
      majorProjects: course.majorProjects as string[],
      skillsRequired: course.skillsRequired as string[],
    },
    builderProfilePresent: builderProfile !== null,
    materials: materials.map(m => ({
      id: m.id,
      fileName: m.fileName,
      extractionStatus: m.extractionStatus,
      sizeBytes: m.sizeBytes,
      ignored: m.ignored,
    })),
    prereqSnapshotsUsed: prereqSnapshots.flatMap(p => p ? [p] : []),
    scanPasses: {
      canvasImportedAt: null,  // not currently tracked per-course; future enhancement
      googleDocsScannedAt: null,
    },
  };

  // Inherit auditor identity from the v2 session that produced this draft.
  // For pre-chooser sessions (no instructor_name stamped on any message),
  // falls through to null and is rendered as "Department canonical" by
  // consumers — same display as the backfilled pre-2026-06-03 snapshots.
  const latestSessionId = await getLatestSessionId(courseCode);
  const sessionInstructor = latestSessionId
    ? await getSessionInstructor(courseCode, latestSessionId)
    : null;

  const snapshot = await createSnapshot({
    courseCode,
    profile: draft.profile,
    inputsMeta,
    transcript: conversation?.messages ?? [],
    caption,
    captionNote,
    // Freeze the current draft's reviewerNote into the snapshot. Wiki-readiness:
    // departmental-context narrative survives in the immutable record.
    reviewerNote: draft.reviewerNote ?? null,
    model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o',
    instructorName: sessionInstructor,
  });

  // Mark the working draft as confirmed (so edits since snapshot will move
  // it back to 'edited' and signal "you have unsnapshotted changes").
  await setCaptureProfileStatus(courseCode, 'confirmed');

  // Fire wiki-update in the background. Snapshot is already persisted; if
  // wiki regen fails we log + continue. The next snapshot will catch up.
  // Don't await — let the response return immediately.
  (async () => {
    try {
      const { raw, wiki, logEntry } = await updateWikiForSnapshot(snapshot.id);
      // writeAndPush handles both raw (deterministic) and wiki (LLM-generated)
      // entries — both are just { path, content } pairs.
      const allPages = [...raw, ...wiki];
      const commitMessage = `feat(${snapshot.courseCode.toLowerCase().replace(/\s+/g, '-')}): snapshot ${new Date().toISOString().slice(0, 10)} — ${snapshot.caption ?? 'untitled'}`;
      await writeAndPush({ pages: allPages, logEntry, commitMessage });
    } catch (err) {
      console.error(
        'wiki-update failed for snapshot',
        snapshot.id,
        'course', snapshot.courseCode,
        err instanceof Error ? err.message : err,
        err instanceof Error ? err.stack : '',
      );
    }
  })();

  return NextResponse.json({
    snapshot: {
      id: snapshot.id,
      caption: snapshot.caption,
      captionNote: snapshot.captionNote,
      scaleVersion: snapshot.scaleVersion,
      model: snapshot.model,
      createdAt: snapshot.createdAt,
    },
  });
}

// GET /api/capture/[code]/snapshots?slug=...&includeRetired=true
// Returns a list of snapshots for the course, newest first.
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);
  const includeRetired = url.searchParams.get('includeRetired') === 'true';

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const snapshots = await listSnapshotsByCourse(courseCode, { includeRetired });

  // Return list metadata only — the full profile/inputs/transcript is fetched
  // per-snapshot via the [id] endpoint to keep this list response small.
  return NextResponse.json({
    snapshots: snapshots.map(s => ({
      id: s.id,
      caption: s.caption,
      captionNote: s.captionNote,
      scaleVersion: s.scaleVersion,
      model: s.model,
      retiredAt: s.retiredAt,
      createdAt: s.createdAt,
      verificationSummary: s.profile.verification_summary,
    })),
  });
}
