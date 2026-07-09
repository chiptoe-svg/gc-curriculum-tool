import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { hashIp } from '@/lib/ip-hash';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { adoptScenario } from '@/lib/ai/explore/adopt';

interface Ctx { params: Promise<{ code: string; id: string }> }

/**
 * POST /api/explore/[code]/scenarios/[id]/adopt?slug=...
 *
 * Adopts a scenario as the course's next planned version. Seeds the
 * course's capture draft (course_capture_profiles) with intended targets,
 * revised objectives, and new incoming expectations from the scenario.
 * Slug-gated + IP rate-limited.
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code, id } = await params;
  const courseCode = decodeURIComponent(code);

  const r = await adoptScenario(id, courseCode);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404 });

  return NextResponse.json({ ok: true });
}
