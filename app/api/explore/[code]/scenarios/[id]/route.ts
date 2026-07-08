import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { hashIp } from '@/lib/ip-hash';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { getScenario, saveScenario } from '@/lib/db/explore-scenario-queries';

interface Ctx { params: Promise<{ code: string; id: string }> }

/**
 * PATCH /api/explore/[code]/scenarios/[id]?slug=...
 * Body: { caption: string }
 *
 * Sets a caption (name) on a scenario. Slug-gated.
 */
export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
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

  const body = await req.json().catch(() => ({}));
  const caption = typeof body.caption === 'string' ? body.caption.trim() : '';
  if (!caption) {
    return NextResponse.json({ error: 'caption required' }, { status: 400 });
  }

  const s = await getScenario(id);
  if (!s || s.courseCode !== courseCode) {
    return NextResponse.json({ error: 'scenario not found' }, { status: 404 });
  }

  await saveScenario({ ...s, caption });

  return NextResponse.json({ ok: true });
}
