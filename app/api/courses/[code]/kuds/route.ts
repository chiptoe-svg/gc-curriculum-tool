import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidSlug } from '@/lib/slug';
import { getCourseKud, saveKudDraft } from '@/lib/db/course-kud-queries';

const kudDraftSchema = z.object({
  thresholdConcept: z.string().min(1),
  know: z.array(z.string().min(1)).min(1).max(7),
  understand: z.array(z.string().min(1)).min(1).max(7),
  do: z.array(z.string().min(1)).min(1).max(7),
});

interface RouteContext { params: Promise<{ code: string }> }

export async function PUT(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const parsed = kudDraftSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const existing = await getCourseKud(courseCode);

  const manuallyEdited = existing
    ? JSON.stringify(existing.know) !== JSON.stringify(parsed.data.know) ||
      JSON.stringify(existing.understand) !== JSON.stringify(parsed.data.understand) ||
      JSON.stringify(existing.do) !== JSON.stringify(parsed.data.do)
    : false;

  try {
    await saveKudDraft({
      courseCode,
      thresholdConcept: parsed.data.thresholdConcept,
      know: parsed.data.know,
      understand: parsed.data.understand,
      do: parsed.data.do,
      manuallyEdited,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`PUT /api/courses/${courseCode}/kuds failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
