import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { isValidSlug } from '@/lib/slug';
import { resolveScopedSession } from '@/lib/sandbox/access';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { formatCourseLabel } from '@/lib/courses/parse-course-code';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { listPairedCodes } from '@/lib/db/course-codes-queries';
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { getCaptureConversation } from '@/lib/db/capture-conversations-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getLatestSessionId, getSessionInstructor, listPriorSessionSummaries } from '@/lib/db/capture-messages-queries';
import { composeSessionBriefing } from '@/lib/ai/agent/session-briefing';
import type { SessionBriefingView } from './CaptureChatPanel';
import { CaptureClient } from './CaptureClient';
import { isTriageEnabled } from '@/lib/capture/triage-flag';
import { FeedbackLink } from '@/app/FeedbackLink';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ slug?: string }>;
}

// Self-standing CourseCapture entry point at /capture/[code]?slug=...
// Single chat surface that drives the depth-rating Course Outcome Profile flow.
export default async function CapturePage({ params, searchParams }: Props) {
  const { code: rawCode } = await params;
  const { slug = '' } = await searchParams;
  const code = decodeURIComponent(rawCode);

  // External-tester access: a scoped session bound to THIS course authorizes the
  // page in place of the faculty slug (middleware already skipped Basic Auth).
  const cookieHeader = (await headers()).get('cookie');
  const scoped = await resolveScopedSession({ headers: { get: (n: string) => (n.toLowerCase() === 'cookie' ? cookieHeader : null) } });
  const isScopedForThis = scoped?.courseCode === code;

  if (!isValidSlug(slug) && !isScopedForThis) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">
          Open this page through the access link your administrator shared. The link
          carries the slug query parameter that grants access.
        </p>
      </div>
    );
  }

  // NEVER forward the faculty slug to a scoped tester's client — CaptureClient
  // serializes it into props + fetch URLs. Their API calls authorize via the
  // session cookie (authorizeCourseWrite), so an empty slug client-side leaks nothing.
  const clientSlug = isScopedForThis ? '' : slug;

  const course = await getCourseByCode(code);
  if (!course) notFound();

  const [materials, priorCapture, savedConversation, latestSnapshot, pairedCodeRows] = await Promise.all([
    listMaterialsByCourse(code),
    getCaptureProfileByCourse(code),
    getCaptureConversation(code),
    getLatestSnapshotByCourse(code),
    listPairedCodes(code),
  ]);

  // Tells the chat panel's session-start chooser whether there's a prior
  // snapshot to "build on" vs. forcing fresh-only. Just the identity +
  // date — full snapshot is heavyweight and unnecessary here.
  const priorSnapshotInfo = latestSnapshot
    ? {
        instructorName: latestSnapshot.instructorName,
        createdAt: latestSnapshot.createdAt.toISOString(),
      }
    : null;

  // Auditor identity stamped on the in-flight session (if any) — used to
  // pre-fill the always-visible "Auditor: X · change" badge on resume so
  // mid-session changes propagate without losing the prior selection.
  const currentSessionId = await getLatestSessionId(code);
  const initialInstructor = currentSessionId
    ? await getSessionInstructor(code, currentSessionId)
    : null;

  // Distilled recap of prior sessions (excludes the in-flight one). Serializable
  // view: Date -> ISO string, citations dropped (not surfaced in the card).
  const priorSummaries = await listPriorSessionSummaries(code, currentSessionId ?? '', 3);
  const priorBriefings: SessionBriefingView[] = composeSessionBriefing(priorSummaries).map(b => ({
    sessionId: b.sessionId,
    startedAt: b.startedAt.toISOString(),
    turnCount: b.turnCount,
    readiness: b.readiness,
    stickyFindings: b.stickyFindings.map(f => ({ text: f.text })),
    lastFacultyTurn: b.lastFacultyTurn,
  }));

  const courseView = {
    code: course.code,
    title: course.title,
    description: course.description,
    prerequisites: course.prerequisites,
    learningObjectives: course.learningObjectives as string[],
    majorProjects: course.majorProjects as string[],
    skillsRequired: course.skillsRequired as string[],
    auditMode: (course.auditMode === 'simple' ? 'simple' : 'full') as 'full' | 'simple',
    canvasCourseName: course.canvasCourseName ?? null,
    canvasImportedAt: course.canvasImportedAt ? course.canvasImportedAt.toISOString() : null,
    pairedCodes: pairedCodeRows.map(r => ({ pairedCode: r.pairedCode, role: r.role as 'lecture' | 'lab' | 'other', canvasImportedAt: r.canvasImportedAt ? r.canvasImportedAt.toISOString() : null })),
  };

  const materialsView = materials.map(m => ({
    id: m.id,
    fileName: m.fileName,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
    pageCount: m.pageCount,
    extractionStatus: m.extractionStatus,
    extractionMethod: m.extractionMethod,
    extractedText: m.extractedText,
    ignored: m.ignored,
    digest: m.digest ?? null,
    digestGeneratedAt: m.digestGeneratedAt ? m.digestGeneratedAt.toISOString() : null,
    useDigest: m.useDigest,
    indexingStatus: (m.indexingStatus ?? 'pending') as 'pending' | 'queued' | 'indexing' | 'ready' | 'failed' | 'skipped',
    indexedAt: m.indexedAt ? m.indexedAt.toISOString() : null,
    ferpaRisk: (m.ferpaRisk ?? 'low') as 'low' | 'medium' | 'high',
    autoSetAside: m.autoSetAside,
    setAsideReason: m.setAsideReason ?? null,
    ignoredItems: m.ignoredItems,
    blobUrl: m.blobUrl,
    sourceCode: m.sourceCode ?? null,
    tier: (m.tier as 'high' | 'middle' | 'background' | null) ?? null,
    rawCleared: m.rawCleared ?? false,
  }));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">CourseCapture</p>
            <h1 className="mt-0.5 text-xl font-semibold">
              {formatCourseLabel(course.code, pairedCodeRows)} <span className="text-muted-foreground">— {course.title}</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {/* The LAN landing is the canonical public course list — the
                faculty guide's published entry point. A relative link would
                keep users on the funnel origin instead of sending them to
                the shared course list. No slug: the landing is public, and
                appending the faculty slug to a shareable URL leaks it. */}
            <a
              href="http://gcworkflow.clemson.edu:3000/"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Course List
            </a>
            <a
              href="https://chiptoe-svg.github.io/gc-curriculum-tool/docs/using-coursecapture-and-explore.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground"
              title="How-to guide for CourseCapture & Explore (opens in new tab)"
            >
              Guide ↗
            </a>
            <FeedbackLink />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        <CaptureClient
          course={courseView}
          initialMaterials={materialsView}
          slug={clientSlug}
          catalogSyncedAt={course.lastSyncedAt ? course.lastSyncedAt.toISOString() : null}
          existingProfile={priorCapture?.profile ?? null}
          existingReviewerStatus={priorCapture?.reviewerStatus ?? null}
          existingReviewerNote={priorCapture?.reviewerNote ?? null}
          initialMessages={savedConversation?.messages ?? []}
          initialReadiness={savedConversation?.readiness ?? null}
          savedConversationAt={savedConversation?.updatedAt ?? null}
          priorSnapshotInfo={priorSnapshotInfo}
          hasSnapshot={latestSnapshot != null}
          initialInstructor={initialInstructor}
          priorBriefings={priorBriefings}
          triageEnabled={isTriageEnabled()}
        />
      </main>
    </div>
  );
}
