import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { applyAnalyzeGuards } from '@/lib/ai/analyze/guards';
import { analyzeMaterial } from '@/lib/ai/course-profile/analyze-material';
import { synthesizeCourseProfile } from '@/lib/ai/course-profile/synthesize-course-profile';
import {
  cacheAnalysisFinding,
  insertProfileRun,
  upsertCourseProfile,
} from '@/lib/db/course-profile-queries';
import { recordSpend } from '@/lib/rate-limit/daily-cap';
import { getProvider } from '@/lib/ai/provider';

export const maxDuration = 120;

interface Ctx {
  params: Promise<{ code: string }>;
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  // 1. Slug gate
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const { code } = await params;
  const decoded = decodeURIComponent(code);

  // 2. Course must exist
  const course = await getCourseByCode(decoded);
  if (!course) {
    return NextResponse.json({ error: `course not found: ${decoded}` }, { status: 404 });
  }

  // 3. IP rate limit + daily cap guard
  const guard = await applyAnalyzeGuards(req);
  if (guard.short) return guard.short;

  // 4. Fetch all materials for the course
  const allMaterials = await listMaterialsByCourse(decoded);
  const readableMaterials = (allMaterials ?? []).filter((m) => m.extractionStatus === 'ok');
  if (readableMaterials.length === 0) {
    return NextResponse.json(
      { error: 'no readable materials — upload files and wait for extraction to succeed before analyzing' },
      { status: 400 }
    );
  }

  const courseContext = {
    code: course.code,
    title: course.title,
    level: course.level,
    track: course.track,
    description: course.description,
  };

  const uncachedMaterials = readableMaterials.filter((m) => m.analysisFinding === null);
  const cachedMaterials = readableMaterials.filter((m) => m.analysisFinding !== null);

  // 5. Resolve native document bytes for Anthropic provider (PDF only)
  const provider = getProvider();
  const useNativePdf = provider.name === 'anthropic';

  const nativeBytes = new Map<string, { bytes: Buffer; mimeType: string }>();

  if (useNativePdf) {
    const pdfMaterials = uncachedMaterials.filter((m) => m.mimeType === 'application/pdf');
    await Promise.all(
      pdfMaterials.map(async (m) => {
        try {
          const resp = await fetch(m.blobUrl);
          if (!resp.ok) {
            console.error('[analyze-materials] blob fetch non-ok for material', m.id, resp.status);
            return;
          }
          const buf = Buffer.from(await resp.arrayBuffer());
          nativeBytes.set(m.id, { bytes: buf, mimeType: m.mimeType });
        } catch (err) {
          console.error('[analyze-materials] blob fetch failed for material', m.id, err);
        }
      })
    );
  }

  // 6. Per-file analysis in parallel, skipping cached findings
  let totalCostUsdCents = 0;

  const newFindingResults = await Promise.all(
    uncachedMaterials.map((m) => {
      const native = nativeBytes.get(m.id);
      return analyzeMaterial({
        courseContext,
        fileName: m.fileName,
        extractedText: m.extractedText ?? '',
        ...(native ? { documentBytes: native.bytes, documentMimeType: native.mimeType } : {}),
      });
    })
  );

  await Promise.all(
    uncachedMaterials.map(async (m, i) => {
      const result = newFindingResults[i];
      if (!result) return;
      totalCostUsdCents += result.telemetry.costUsdCents;
      await cacheAnalysisFinding({
        materialId: m.id,
        finding: result.data,
        model: provider.model,
        costUsdCents: result.telemetry.costUsdCents,
      });
    })
  );

  const allFindings = [
    ...cachedMaterials.map((m) => ({
      fileName: m.fileName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      finding: m.analysisFinding as any,
    })),
    ...uncachedMaterials.map((m, i) => ({
      fileName: m.fileName,
      finding: newFindingResults[i]!.data,
    })),
  ];

  // 7. Synthesis call — if this throws, cached per-file findings are kept
  let synthesisResult: Awaited<ReturnType<typeof synthesizeCourseProfile>>;
  try {
    synthesisResult = await synthesizeCourseProfile({
      course: {
        code: course.code,
        title: course.title,
        level: course.level,
        track: course.track,
        description: course.description,
        learningObjectives: (course.learningObjectives as string[]) ?? [],
        skillsRequired: (course.skillsRequired as string[]) ?? [],
      },
      findings: allFindings,
    });
  } catch {
    return NextResponse.json({ error: 'synthesis failed' }, { status: 500 });
  }

  totalCostUsdCents += synthesisResult.telemetry.costUsdCents;

  // 8. Persist
  const runId = await insertProfileRun({
    courseCode: decoded,
    result: synthesisResult.data,
    materialCount: readableMaterials.length,
    model: provider.model,
    costUsdCents: totalCostUsdCents,
  });

  await upsertCourseProfile({
    courseCode: decoded,
    result: synthesisResult.data,
    runId,
  });

  // 9. Record spend
  await recordSpend(totalCostUsdCents);

  return NextResponse.json({
    runId,
    totalCostUsdCents,
    materialCount: readableMaterials.length,
    newlyAnalyzed: uncachedMaterials.length,
  });
}
