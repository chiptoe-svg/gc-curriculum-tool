import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { updateCourseClassification, type CourseClassificationPatch } from '@/lib/db/courses-queries';
import { isHttpUrl } from '@/lib/http/is-http-url';

const CATEGORIES = ['gc_core', 'specialty', 'major_req', 'other'] as const;

// PATCH /api/admin/courses/[code]?slug=<slug>
// Body (each key optional): { category?, buildsToCareer?, catalogUrl? }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!checkAdminAuth(req, { slug })) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const { code } = await params;
  const decodedCode = decodeURIComponent(code);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: CourseClassificationPatch = {};

  if ('category' in body) {
    if (typeof body['category'] !== 'string' || !(CATEGORIES as readonly string[]).includes(body['category'])) {
      return NextResponse.json({ error: 'category must be one of ' + CATEGORIES.join(', ') }, { status: 400 });
    }
    patch.category = body['category'] as CourseClassificationPatch['category'];
  }
  if ('buildsToCareer' in body) {
    if (typeof body['buildsToCareer'] !== 'boolean') {
      return NextResponse.json({ error: 'buildsToCareer must be a boolean' }, { status: 400 });
    }
    patch.buildsToCareer = body['buildsToCareer'];
  }
  if ('catalogUrl' in body) {
    if (body['catalogUrl'] === null) {
      patch.catalogUrl = null;
    } else if (typeof body['catalogUrl'] === 'string' && isHttpUrl(body['catalogUrl'].trim())) {
      patch.catalogUrl = body['catalogUrl'].trim();
    } else {
      return NextResponse.json({ error: 'catalogUrl must be an http(s) URL or null' }, { status: 400 });
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no updatable fields provided' }, { status: 400 });
  }

  const found = await updateCourseClassification(decodedCode, patch);
  if (!found) return NextResponse.json({ error: 'course not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
