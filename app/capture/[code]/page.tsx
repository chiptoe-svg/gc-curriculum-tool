import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCourseProfile } from '@/lib/db/course-profile-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { getCaptureConversation } from '@/lib/db/capture-conversations-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getLatestSessionId, getSessionInstructor, listPriorSessionSummaries } from '@/lib/db/capture-messages-queries';
import { composeSessionBriefing } from '@/lib/ai/agent/session-briefing';
import type { SessionBriefingView } from './CaptureChatPanel';
import { CaptureClient } from './CaptureClient';
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

  if (!isValidSlug(slug)) {
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

  const course = await getCourseByCode(code);
  if (!course) notFound();

  const [builderProfile, materials, priorCapture, savedConversation, latestSnapshot] = await Promise.all([
    getCourseProfile(code),
    listMaterialsByCourse(code),
    getCaptureProfileByCourse(code),
    getCaptureConversation(code),
    getLatestSnapshotByCourse(code),
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

  const materialCounts = {
    total: materials.length,
    canvas: materials.filter(m => m.fileName.startsWith('Canvas:')).length,
    uploaded: materials.filter(m => !m.fileName.startsWith('Canvas:')).length,
    extractedOk: materials.filter(m => m.extractionStatus === 'ok').length,
    ignored: materials.filter(m => m.ignored).length,
  };

  const courseView = {
    code: course.code,
    title: course.title,
    description: course.description,
    prerequisites: course.prerequisites,
    learningObjectives: course.learningObjectives as string[],
    majorProjects: course.majorProjects as string[],
    skillsRequired: course.skillsRequired as string[],
    auditMode: (course.auditMode === 'simple' ? 'simple' : 'full') as 'full' | 'simple',
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
    indexingStatus: (m.indexingStatus ?? 'pending') as 'pending' | 'indexing' | 'ready' | 'failed' | 'skipped',
    indexedAt: m.indexedAt ? m.indexedAt.toISOString() : null,
    ferpaRisk: (m.ferpaRisk ?? 'low') as 'low' | 'medium' | 'high',
    autoSetAside: m.autoSetAside,
    setAsideReason: m.setAsideReason ?? null,
    ignoredItems: m.ignoredItems,
    blobUrl: m.blobUrl,
  }));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">CourseCapture · v1</p>
            <h1 className="mt-0.5 text-xl font-semibold">
              {course.code} <span className="text-muted-foreground">— {course.title}</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://chiptoe-svg.github.io/gc-curriculum-tool/docs/using-coursecapture-and-explore.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground"
              title="How-to guide for CourseCapture & Explore (opens in new tab)"
            >
              Guide ↗
            </a>
            <Link
              href={`/program?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
              title="Program-level coverage matrix"
            >
              Program
            </Link>
            <Link
              href={`/settings?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
              title="AI model selection per function"
            >
              Settings
            </Link>
            <Link
              href={`/ask?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
              title="Curriculum chat — program-level questions"
            >
              💬 Ask
            </Link>
            <Link
              href={`/explore/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Explore →
            </Link>
            <FeedbackLink />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        <section className="mb-5 rounded-md border bg-muted/30 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Loaded:</span>{' '}
            catalog entry · {course.learningObjectives.length} stated objectives ·{' '}
            {course.majorProjects.length} major projects ·{' '}
            {materialCounts.total} materials ({materialCounts.canvas} Canvas-imported,{' '}
            {materialCounts.uploaded} uploaded; {materialCounts.extractedOk} with extracted text
            {materialCounts.ignored > 0 && `; ${materialCounts.ignored} ignored`}) ·{' '}
            builder profile {builderProfile ? '✓' : '—'} ·{' '}
            prior capture {priorCapture ? '✓' : '—'}
          </p>
        </section>

        <CaptureClient
          course={courseView}
          initialMaterials={materialsView}
          slug={slug}
          existingProfile={priorCapture?.profile ?? null}
          existingReviewerStatus={priorCapture?.reviewerStatus ?? null}
          existingReviewerNote={priorCapture?.reviewerNote ?? null}
          initialMessages={savedConversation?.messages ?? []}
          initialReadiness={savedConversation?.readiness ?? null}
          savedConversationAt={savedConversation?.updatedAt ?? null}
          priorSnapshotInfo={priorSnapshotInfo}
          initialInstructor={initialInstructor}
          priorBriefings={priorBriefings}
        />
      </main>
    </div>
  );
}
