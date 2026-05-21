import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCourseKud, listKudRunsForCourse } from '@/lib/db/course-kud-queries';

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const [rawMaterials, currentKud, kudRuns] = await Promise.all([
    listMaterialsByCourse(courseCode),
    getCourseKud(courseCode),
    listKudRunsForCourse(courseCode),
  ]);

  return NextResponse.json({
    course: {
      code: course.code,
      title: course.title,
      level: course.level,
      track: course.track,
      description: course.description,
      prerequisites: course.prerequisites,
      learningObjectives: course.learningObjectives,
      majorProjects: course.majorProjects,
      skillsRequired: course.skillsRequired,
      builderStatus: course.builderStatus,
    },
    materials: rawMaterials.map((m) => ({
      id: m.id,
      fileName: m.fileName,
      extractionStatus: m.extractionStatus,
      extractionMethod: m.extractionMethod,
      pageCount: m.pageCount,
    })),
    kud: {
      current: currentKud
        ? {
            thresholdConcept: currentKud.thresholdConcept,
            know: currentKud.know as string[],
            understand: currentKud.understand as string[],
            do: currentKud.do as string[],
            manuallyEdited: currentKud.manuallyEdited,
            sourceRunId: currentKud.sourceRunId,
            approvedAt: currentKud.approvedAt?.toISOString() ?? null,
          }
        : null,
      runs: kudRuns.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        model: r.model,
        costUsdCents: r.costUsdCents,
      })),
    },
  });
}
