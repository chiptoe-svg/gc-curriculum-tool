import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { hasJsonContentType } from '@/lib/http/require-json';
import { courseExists, createCourse, updateCourseClassification } from '@/lib/db/courses-queries';
import { lookupCatalogCourse, validateCourseTitle, validateCourseCode, levelFromCode } from '@/lib/curriculum/catalog-lookup';
import { CATEGORY_ORDER, CATEGORY_LABELS, type CourseCategory } from '@/lib/db/course-category-seed';

const NO_STORE = { 'Cache-Control': 'no-store' };

// POST /api/admin/access/courses — "Add a course" (spec:
// docs/superpowers/specs/2026-10-07-access-panel-add-course-addendum.md).
// Body: { code, title?, category?, slug }. JSON-only (415) + the fix-round-1
// cross-site guard on non-GET /api/admin/** (middleware) apply here too —
// same CSRF protection as the other access routes.
export async function POST(req: Request): Promise<Response> {
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: 'content-type must be application/json' }, { status: 415, headers: NO_STORE });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!checkAdminAuth(req, { slug: typeof body.slug === 'string' ? body.slug : '' })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  // Trims, canonicalizes (uppercase subject, lower-case suffix — matching
  // the live data convention) and validates against the exact shape
  // authorize() accepts, capped at 16 chars with no control characters
  // (fix round 2, N2/N3 — rejects '*', slashes, NUL, HTML, 10,000-char
  // strings, and un-decodable escapes, all of which previously created a row).
  const codeR = validateCourseCode(body.code);
  if ('error' in codeR) return NextResponse.json({ error: codeR.error }, { status: 400, headers: NO_STORE });
  const code = codeR.code;

  if (await courseExists(code)) {
    return NextResponse.json({ error: `${code} is already on the course list` }, { status: 409, headers: NO_STORE });
  }

  let category: CourseCategory = 'other';
  if ('category' in body) {
    if (typeof body.category !== 'string' || !(CATEGORY_ORDER as readonly string[]).includes(body.category)) {
      return NextResponse.json({ error: `category must be one of ${CATEGORY_ORDER.join(', ')}` }, { status: 400, headers: NO_STORE });
    }
    category = body.category as CourseCategory;
  }

  // Catalog title always wins for a catalog code — a supplied title is
  // ignored (spec). Otherwise (section code or genuinely unknown) a title
  // is required.
  const catalog = await lookupCatalogCourse(code);
  let title: string;
  if (catalog?.title) {
    title = catalog.title;
  } else {
    const titleR = validateCourseTitle(body.title);
    if ('error' in titleR) return NextResponse.json({ error: titleR.error }, { status: 400, headers: NO_STORE });
    title = titleR.title;
  }

  // Reuse the same insert path POST /api/admin/courses/roster (mode: 'one')
  // uses, so level/track defaults and pairing behave identically.
  await createCourse({ code, title, level: levelFromCode(code) ?? undefined });
  if (category !== 'other') {
    await updateCourseClassification(code, { category });
  }

  return NextResponse.json({ code, title, category, categoryLabel: CATEGORY_LABELS[category] }, { headers: NO_STORE });
}
