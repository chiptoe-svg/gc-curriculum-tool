import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getLatestRunForCourse, getCourseProfile, listRunsForCourse } from '@/lib/db/course-profile-queries';
import { getCourseKud, listKudRunsForCourse } from '@/lib/db/course-kud-queries';
import { CourseBuilderClient } from './CourseBuilderClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string; code: string }>;
}

export default async function CourseDetailPage({ params }: Props) {
  const { slug, code } = await params;
  if (!isValidSlug(slug)) notFound();

  const course = await getCourseByCode(code);
  if (!course) notFound();

  const [rawMaterials, latestProfileRun, currentProfile, allProfileRuns, currentKud, kudRuns] = await Promise.all([
    listMaterialsByCourse(code),
    getLatestRunForCourse(code),
    getCourseProfile(code),
    listRunsForCourse(code),
    getCourseKud(code),
    listKudRunsForCourse(code),
  ]);

  const materials = rawMaterials.map((m) => ({
    id: m.id,
    fileName: m.fileName,
    blobUrl: m.blobUrl,
    extractionStatus: m.extractionStatus as 'pending' | 'ok' | 'low_text' | 'failed',
    extractionMethod: m.extractionMethod ?? undefined,
    pageCount: m.pageCount ?? undefined,
  }));

  const okCount = rawMaterials.filter((m) => m.extractionStatus === 'ok').length;

  const lastProfileRunMeta = latestProfileRun
    ? { id: latestProfileRun.id, createdAt: latestProfileRun.createdAt.toISOString(), materialCount: latestProfileRun.materialCount, costUsdCents: latestProfileRun.costUsdCents }
    : null;

  const aiProfile = currentProfile
    ? {
        summary: currentProfile.summary,
        learningObjectives: currentProfile.learningObjectives as string[],
        skills: currentProfile.skills as string[],
        competencies: currentProfile.competencies as Array<{ name: string; description: string; level: string; evidence: Array<{ fileName: string; quote: string }> }>,
        catalogDivergence: currentProfile.catalogDivergence as { reinforced: string[]; additions: string[]; gaps: string[] } | null,
      }
    : null;

  const kudRecord = currentKud
    ? {
        thresholdConcept: currentKud.thresholdConcept,
        know: currentKud.know as string[],
        understand: currentKud.understand as string[],
        do: currentKud.do as string[],
        manuallyEdited: currentKud.manuallyEdited,
        sourceRunId: currentKud.sourceRunId,
        approvedAt: currentKud.approvedAt?.toISOString() ?? null,
      }
    : null;

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-12 space-y-8">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href={`/preview/${slug}/courses`} className="underline underline-offset-2 hover:text-foreground">
          &larr; All courses
        </Link>
      </div>

      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{course.code}</p>
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <p className="text-sm text-muted-foreground">Level {course.level} · {course.track}</p>
      </header>

      <CourseBuilderClient
        slug={slug}
        course={{
          code: course.code,
          title: course.title,
          level: course.level,
          track: course.track,
          description: course.description,
          prerequisites: course.prerequisites,
          learningObjectives: course.learningObjectives as string[],
          majorProjects: course.majorProjects as string[],
          skillsRequired: course.skillsRequired as string[],
          builderStatus: course.builderStatus,
        }}
        materials={materials}
        currentKud={kudRecord}
        kudRuns={kudRuns.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), model: r.model, costUsdCents: r.costUsdCents }))}
        aiProfile={aiProfile}
        profileRuns={allProfileRuns.map((r) => ({ id: r.id, courseCode: r.courseCode, materialCount: r.materialCount, model: r.model, costUsdCents: r.costUsdCents, createdAt: r.createdAt.toISOString() }))}
        okMaterialCount={okCount}
        lastProfileRun={lastProfileRunMeta}
        aiProfileManuallyEdited={currentProfile?.manuallyEdited ?? false}
        currentProfileRunId={currentProfile?.sourceRunId ?? null}
      />
    </main>
  );
}
