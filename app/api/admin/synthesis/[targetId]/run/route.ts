import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { synthesizeTarget } from '@/lib/ai/synthesis/orchestrator';

export const maxDuration = 120;

interface Ctx { params: Promise<{ targetId: string }>; }

export async function POST(req: Request, { params }: Ctx) {
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }
  const { targetId } = await params;

  try {
    const run = await synthesizeTarget(targetId);
    return NextResponse.json({ run });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/daily cap/i.test(msg)) return NextResponse.json({ error: msg }, { status: 429 });
    if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
    if (/no submissions/i.test(msg)) return NextResponse.json({ error: msg }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
