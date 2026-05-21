import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { listCourses, listApprovedCourses } from '@/lib/db/courses-queries';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  const onlyApproved = url.searchParams.get('approved') === 'true';
  const list = onlyApproved ? await listApprovedCourses() : await listCourses();
  return NextResponse.json(list);
}
