import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCourseProfile } from '@/lib/db/course-profile-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// GET /api/capture/[code]/context?slug=...
// Bundles everything CourseCapture needs to start a session for a course:
// catalog row, current Course Builder profile (if any), all materials with
// extracted text, and any prior capture profile. No re-ingestion — every
// row comes from existing tables.
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
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

  const [profile, materials, existingCaptureProfile] = await Promise.all([
    getCourseProfile(courseCode),
    listMaterialsByCourse(courseCode),
    getCaptureProfileByCourse(courseCode),
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
      auditMode: course.auditMode,
    },
    profile: profile
      ? {
          summary: profile.summary,
          learningObjectives: profile.learningObjectives,
          skills: profile.skills,
          competencies: profile.competencies,
          catalogDivergence: profile.catalogDivergence,
          manuallyEdited: profile.manuallyEdited,
          updatedAt: profile.updatedAt,
        }
      : null,
    materials: materials.map(m => ({
      id: m.id,
      fileName: m.fileName,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      pageCount: m.pageCount,
      extractionStatus: m.extractionStatus,
      extractionMethod: m.extractionMethod,
      extractedText: m.extractedText,
      ignored: m.ignored,
      uploadedAt: m.uploadedAt,
      digest: m.digest,
      digestGeneratedAt: m.digestGeneratedAt,
      useDigest: m.useDigest,
      indexingStatus: m.indexingStatus,
      indexedAt: m.indexedAt,
      ferpaRisk: m.ferpaRisk,
      autoSetAside: m.autoSetAside,
      setAsideReason: m.setAsideReason,
      ignoredItems: m.ignoredItems,
      blobUrl: m.blobUrl,
      sourceCode: m.sourceCode,
      tier: m.tier,
      rawCleared: m.rawCleared,
      retiredAt: m.retiredAt ? m.retiredAt.toISOString() : null,
    })),
    existingCaptureProfile: existingCaptureProfile
      ? {
          profile: existingCaptureProfile.profile,
          reviewerStatus: existingCaptureProfile.reviewerStatus,
          reviewerNote: existingCaptureProfile.reviewerNote,
          scaleVersion: existingCaptureProfile.scaleVersion,
          updatedAt: existingCaptureProfile.updatedAt,
        }
      : null,
  });
}
