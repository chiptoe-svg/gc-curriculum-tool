import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import {
  generateIngestionCheckIn,
  type CheckInInput,
  type CheckInResult,
} from '@/lib/ai/analyze/ingestion-checkin';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// GET /api/courses/[code]/checkin?slug=...
//
// Pre-audit curation review: pulls the course catalog row + indexable
// materials, asks generateIngestionCheckIn for a heads-up (FERPA risk
// kept, key sources missing, stacked auto-set-asides), returns either
// an empty-silent payload or a one-line message + up to three highlights.
//
// Light-tier; ~1–3s on qwen3.6-35b-a3b-fp8. Fine to run on every page
// open during the trial. Silent on AI failure — the panel just renders
// nothing.
export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  // Mirror the audit-context filter: only materials the audit chat could
  // actually retrieve evidence from.
  const materials = (await listMaterialsByCourse(courseCode))
    .filter(m => !m.ignored && m.extractionStatus === 'ok');

  const input: CheckInInput = {
    catalog: {
      code: course.code,
      title: course.title,
      learningObjectives: course.learningObjectives ?? [],
      majorProjects: course.majorProjects ?? [],
    },
    materials: materials.map(m => ({
      fileName: m.fileName,
      ferpaRisk: (m.ferpaRisk ?? 'low') as 'low' | 'medium' | 'high',
      autoSetAside: !!m.autoSetAside,
      setAsideReason: m.setAsideReason ?? null,
      digestSnippet: (m.digest ?? m.extractedText ?? '').slice(0, 400),
    })),
  };

  // Rule-based suppression of two known false-positive signals — applied
  // after the LLM runs so the other signals (FERPA, stacked auto-set-asides,
  // near-empty digests) still surface.
  // 1. "No syllabus uploaded" when the Sheets catalog already lists this
  //    course's learning objectives and major projects. The tactical
  //    Canvas-Syllabus suppression (shipped 2026-05-26) marks the Canvas
  //    syllabus material as ignored at import time precisely because the
  //    catalog covers it; the check-in LLM doesn't see the ignored row, so
  //    it incorrectly flags the syllabus as missing.
  // 2. "No rubrics found for listed major projects" when the Canvas
  //    Assignments material is in the audit context — per-assignment
  //    rubrics typically live inside Canvas Assignment descriptions, which
  //    are already in the assignments material's digest.
  const catalogCoversSyllabus =
    (course.learningObjectives ?? []).length > 0 &&
    (course.majorProjects ?? []).length > 0;
  const hasCanvasAssignments = materials.some(m => m.fileName === 'Canvas: Assignments');

  try {
    const result = await generateIngestionCheckIn(input);
    const filteredHighlights = (result.highlights ?? []).filter(h => {
      if (h.kind !== 'missing') return true;
      if (catalogCoversSyllabus && /syllabus/i.test(h.text)) return false;
      if (hasCanvasAssignments && /rubric/i.test(h.text)) return false;
      return true;
    });
    // If filtering dropped every highlight, suppress the leading message too —
    // it's almost certainly summarizing the same dropped signals.
    const filtered: CheckInResult = filteredHighlights.length === 0
      ? { message: null, highlights: [], model: result.model }
      : { ...result, highlights: filteredHighlights };
    return NextResponse.json(filtered);
  } catch (e) {
    // Silent failure — the panel renders nothing if the AI call fails.
    console.error('ingestion-checkin failed:', e);
    const empty: CheckInResult = { message: null, highlights: [], model: 'failed' };
    return NextResponse.json(empty);
  }
}
