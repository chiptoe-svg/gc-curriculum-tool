import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { resolveFlag } from '@/lib/db/flag-queries';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const resolvedBy = typeof body.resolvedBy === 'string' ? body.resolvedBy.trim() : '';
  const resolutionNote = typeof body.resolutionNote === 'string' ? body.resolutionNote.trim() : '';
  if (!resolvedBy || !resolutionNote) {
    return NextResponse.json({ error: 'resolvedBy and resolutionNote are required' }, { status: 400 });
  }

  try {
    const flag = await resolveFlag(id, { resolvedBy, resolutionNote });
    return NextResponse.json({ flag });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'resolve failed';
    if (/already resolved/i.test(msg)) return NextResponse.json({ error: msg }, { status: 409 });
    if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
