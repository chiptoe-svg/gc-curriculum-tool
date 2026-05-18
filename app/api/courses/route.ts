import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { listCourses } from '@/lib/db/courses-queries';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  const list = await listCourses();
  return NextResponse.json(list);
}
