import { NextResponse } from 'next/server';
import { authorizeCourseWrite } from '@/lib/sandbox/access';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { mergePrereqGapWithSkills } from '@/lib/ai/analyze/decompose-prereq-gap';

/**
 * Decompose ONE prereq-gap finding into KUD+-formatted competencies and
 * merge with the course's existing skillsRequired list. Returns the
 * unified replacement list for the faculty to copy + paste into the
 * Sheet's Skills/Competencies Required cell.
 *
 * POST body: { slug, gapText }
 * Response: { merged_skills: [{ text, from, rationale }], existingSkills }
 *
 * The course code in the URL identifies whose skillsRequired list to
 * merge into — typically the same course the audit is for (the gap
 * findings are about that course's own incoming assumptions).
 */

export const maxDuration = 60;

interface Ctx { params: Promise<{ code: string }> }

export async function POST(req: Request, { params }: Ctx) {
  try {
    return await run(req, params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[merge-prereq-gap] unhandled exception:', msg);
    return NextResponse.json(
      { error: `Unexpected server error during prereq-gap merge: ${msg}` },
      { status: 500 },
    );
  }
}

async function run(req: Request, params: Ctx['params']): Promise<Response> {
  const { code } = await params;
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!(await authorizeCourseWrite(req, code, slug))) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const gapText = typeof body.gapText === 'string' ? body.gapText.trim() : '';
  if (!gapText) {
    return NextResponse.json({ error: 'gapText is required' }, { status: 400 });
  }

  const course = await getCourseByCode(code);
  if (!course) {
    return NextResponse.json({ error: `Course not found: ${code}` }, { status: 404 });
  }
  const existingSkills = Array.isArray(course.skillsRequired) ? course.skillsRequired : [];

  const merged = await mergePrereqGapWithSkills({
    gapText,
    sourceCourseCode: code,
    existingSkills,
  });

  return NextResponse.json({
    merged_skills: merged.merged_skills,
    existingSkills,
  });
}
