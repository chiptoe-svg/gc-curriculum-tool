import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';

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
