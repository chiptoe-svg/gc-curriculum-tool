import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getTargetById, updateTarget } from '@/lib/db/explore-queries';
import { targetSpecSchema } from '@/lib/ai/explore/schema';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string; id: string }> }

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode, id } = await params;
  const courseCode = decodeURIComponent(rawCode);
  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const target = await getTargetById(id);
  if (!target) return NextResponse.json({ error: 'target not found' }, { status: 404 });
  if (target.courseCode !== courseCode) {
    return NextResponse.json({ error: 'target does not belong to this course' }, { status: 403 });
  }
  return NextResponse.json({ target });
}

// PATCH /api/explore/[code]/targets/[id]?slug=...
// Body: { spec?, caption?, retired? }
export async function PATCH(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode, id } = await params;
  const courseCode = decodeURIComponent(rawCode);
  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const existing = await getTargetById(id);
  if (!existing) return NextResponse.json({ error: 'target not found' }, { status: 404 });
  if (existing.courseCode !== courseCode) {
    return NextResponse.json({ error: 'target does not belong to this course' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const update: { id: string; spec?: typeof existing.spec; caption?: string | null; retired?: boolean } = { id };
  if (body.spec !== undefined) {
    const parsed = targetSpecSchema.safeParse(body.spec);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid target spec', detail: parsed.error.message }, { status: 400 });
    }
    update.spec = parsed.data;
  }
  if (body.caption !== undefined) {
    update.caption = typeof body.caption === 'string' && body.caption.trim() ? body.caption.trim() : null;
  }
  if (typeof body.retired === 'boolean') {
    update.retired = body.retired;
  }
  const updated = await updateTarget(update);
  return NextResponse.json({ target: updated });
}
