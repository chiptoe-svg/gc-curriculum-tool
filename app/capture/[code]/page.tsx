import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCourseProfile } from '@/lib/db/course-profile-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { getCaptureConversation } from '@/lib/db/capture-conversations-queries';
import { CaptureClient } from './CaptureClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ slug?: string }>;
}

// Self-standing CourseCapture entry point at /capture/[code]?slug=...
// Distinct from the existing /preview/[slug]/courses/[code] shell; this page
// is a single chat surface that drives the depth-rating Course Outcome
// Profile flow.
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

  const [builderProfile, materials, priorCapture, savedConversation] = await Promise.all([
    getCourseProfile(code),
    listMaterialsByCourse(code),
    getCaptureProfileByCourse(code),
    getCaptureConversation(code),
  ]);

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
              href={`/explore/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Explore →
            </Link>
            <Link
              href={`/preview/${encodeURIComponent(slug)}/courses/${encodeURIComponent(code)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Course Builder view
            </Link>
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
          initialMessages={savedConversation?.messages ?? []}
          initialReadiness={savedConversation?.readiness ?? null}
          savedConversationAt={savedConversation?.updatedAt ?? null}
        />
      </main>
    </div>
  );
}
