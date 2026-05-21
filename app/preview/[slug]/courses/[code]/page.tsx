import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getLatestRunForCourse, getCourseProfile, listRunsForCourse } from '@/lib/db/course-profile-queries';
import { MaterialsZone } from './MaterialsZone';
import { CourseAnalyzeZone } from '@/components/CourseAnalyzeZone';
import { CourseProfileEditor } from '@/components/CourseProfileEditor';
import { ProfileRunHistory } from '@/components/ProfileRunHistory';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string; code: string }>;
}

export default async function CourseDetailPage({ params }: Props) {
  const { slug, code } = await params;
  if (!isValidSlug(slug)) notFound();

  const course = await getCourseByCode(code);
  if (!course) notFound();

  const [rawMaterials, latestRun, currentProfile, allRuns] = await Promise.all([
    listMaterialsByCourse(code),
    getLatestRunForCourse(code),
    getCourseProfile(code),
    listRunsForCourse(code),
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
  const manuallyEdited = currentProfile?.manuallyEdited ?? false;
  const lastRunMeta = latestRun
    ? {
        id: latestRun.id,
        createdAt: latestRun.createdAt.toISOString(),
        materialCount: latestRun.materialCount,
        costUsdCents: latestRun.costUsdCents,
      }
    : null;

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-12 space-y-8">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href={`/preview/${slug}`} className="underline underline-offset-2 hover:text-foreground">
          &larr; Back to prototype
        </Link>
      </div>

      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{course.code}</p>
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <p className="text-sm text-muted-foreground">Level {course.level} · {course.track}</p>
      </header>

      {/* Zone 1 — Materials (Plan 1). Zones 2 + 3 added by Plans 2 and 3. */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Assignment Materials</h2>
          <span className="text-xs text-muted-foreground">{materials.length} file{materials.length !== 1 ? 's' : ''}</span>
        </div>

        <MaterialsZone
          courseCode={code}
          slug={slug}
          initialMaterials={materials}
        />
      </section>

      <CourseAnalyzeZone
        slug={slug}
        courseCode={code}
        okCount={okCount}
        lastRun={lastRunMeta}
        manuallyEdited={manuallyEdited}
        onAnalyzed={() => {}}
      />

      {/* Zone 3 — Profile (editable, Plan 3) */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Profile</h2>
        {currentProfile ? (
          <CourseProfileEditor
            courseCode={code}
            slug={slug}
            profile={{
              summary: currentProfile.summary,
              learningObjectives: currentProfile.learningObjectives as string[],
              skills: currentProfile.skills as string[],
              competencies: currentProfile.competencies as Array<{
                name: string;
                description: string;
                level: string;
                evidence: Array<{ fileName: string; quote: string }>;
              }>,
              catalogDivergence: currentProfile.catalogDivergence as {
                reinforced: string[];
                additions: string[];
                gaps: string[];
              } | null,
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No profile yet. Upload materials and click &ldquo;Analyze materials&rdquo; to generate one.
          </p>
        )}
      </section>

      <ProfileRunHistory
        runs={allRuns.map((r) => ({
          id: r.id,
          courseCode: r.courseCode,
          materialCount: r.materialCount,
          model: r.model,
          costUsdCents: r.costUsdCents,
          createdAt: r.createdAt.toISOString(),
        }))}
        slug={slug}
        courseCode={code}
        currentRunId={currentProfile?.sourceRunId ?? null}
      />
    </main>
  );
}
