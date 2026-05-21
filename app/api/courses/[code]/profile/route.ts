import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { isValidSlug } from '@/lib/slug';
import { updateProfileFromEdit } from '@/lib/db/course-profile-queries';
import { getCourseByCode, updateBuilderStatus } from '@/lib/db/courses-queries';
import { resetKudApproval } from '@/lib/db/course-kud-queries';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';

const evidenceSchema = z.object({
  fileName: z.string().min(1),
  quote: z.string().min(1),
});

const competencySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1),
  level: z.string().min(1).max(100),
  evidence: z.array(evidenceSchema),
});

const patchSchema = z.object({
  summary: z.string().min(1),
  learningObjectives: z.array(z.string().min(1)),
  skills: z.array(z.string().min(1)),
  competencies: z.array(competencySchema),
});

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function PATCH(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  try {
    await updateProfileFromEdit({
      courseCode,
      summary: parsed.data.summary,
      learningObjectives: parsed.data.learningObjectives,
      skills: parsed.data.skills,
      competencies: parsed.data.competencies,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/courses/${courseCode}/profile failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}

const builderProfileSchema = z.object({
  learningObjectives: z.array(z.string()),
  majorProjects: z.array(z.string()),
  skillsRequired: z.array(z.string()),
});

export async function PUT(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const parsed = builderProfileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    await db.update(courses).set({
      learningObjectives: parsed.data.learningObjectives,
      majorProjects: parsed.data.majorProjects,
      skillsRequired: parsed.data.skillsRequired,
    }).where(eq(courses.code, courseCode));

    const wasApprovedOrGenerated = course.builderStatus === 'approved' || course.builderStatus === 'kuds_generated';

    const hasContent =
      parsed.data.learningObjectives.length > 0 &&
      parsed.data.majorProjects.length > 0 &&
      parsed.data.skillsRequired.length > 0;

    if (wasApprovedOrGenerated) {
      await resetKudApproval(courseCode);
      await updateBuilderStatus(courseCode, 'profile_complete');
    } else if (hasContent) {
      await updateBuilderStatus(courseCode, 'profile_complete');
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`PUT /api/courses/${courseCode}/profile failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
