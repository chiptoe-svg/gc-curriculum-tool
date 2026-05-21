import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidSlug } from '@/lib/slug';
import { updateProfileFromEdit } from '@/lib/db/course-profile-queries';

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
