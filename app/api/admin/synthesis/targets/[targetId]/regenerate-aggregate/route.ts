// app/api/admin/synthesis/targets/[targetId]/regenerate-aggregate/route.ts
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { regenerateAggregate } from '@/lib/ai/position-capture/aggregate';

interface RouteContext { params: Promise<{ targetId: string }> }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  const { targetId } = await params;

  try {
    const result = await regenerateAggregate(targetId);
    return NextResponse.json({ ok: true, positionIds: result.positionIds, markdown: result.markdown });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'regenerate failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
