import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode, setCourseAuditMode } from '@/lib/db/courses-queries';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  const { code } = await ctx.params;
  const decoded = decodeURIComponent(code);
  const course = await getCourseByCode(decoded);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(course);
}

// PATCH /api/courses/[code]?slug=...
// Body: { auditMode?: 'full' | 'simple' }
// Currently only `auditMode` is mutable from this route. 'simple' tells
// the audit pipeline to skip chunk indexing and feed digests inline;
// 'full' enables retrieval over indexed chunks.
export async function PATCH(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  const { code } = await ctx.params;
  const decoded = decodeURIComponent(code);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const auditMode = body.auditMode;
  if (auditMode !== 'full' && auditMode !== 'simple') {
    return NextResponse.json(
      { error: '`auditMode` must be "full" or "simple"' },
      { status: 400 },
    );
  }

  const updated = await setCourseAuditMode(decoded, auditMode);
  if (!updated) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  return NextResponse.json({ ok: true, auditMode });
}
