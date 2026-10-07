import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { courseExists } from '@/lib/db/courses-queries';
import { lookupCatalogCourse, baseCodeOf } from '@/lib/curriculum/catalog-lookup';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET /api/admin/access/catalog?code=<code> — the Add-a-course lookup (spec:
// docs/superpowers/specs/2026-10-07-access-panel-add-course-addendum.md).
// A GET/read, so the fix-round-1 CSRF guard (non-GET only) and the
// JSON-content-type requirement (POST-only) don't apply here; auth is the
// standard two-factor admin pattern.
export async function GET(req: Request): Promise<Response> {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  const url = new URL(req.url);
  const raw = url.searchParams.get('code');
  const code = raw?.trim() ?? '';
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400, headers: NO_STORE });

  const onCourseList = await courseExists(code);

  const exact = await lookupCatalogCourse(code);
  if (exact) {
    return NextResponse.json(
      { found: true, code: exact.code, title: exact.title, description: exact.description, onCourseList, baseCode: null, baseTitle: null },
      { headers: NO_STORE },
    );
  }

  // Not found exactly — for a section code (e.g. "GC 4900ap"), fall back to
  // its base ("GC 4900") so the UI can show "Sections of GC 4900 are
  // titled '…'" instead of a bare "not in the catalog".
  const base = baseCodeOf(code);
  const baseLookup = base ? await lookupCatalogCourse(base) : null;
  return NextResponse.json(
    {
      found: false,
      code,
      title: null,
      description: null,
      onCourseList,
      baseCode: baseLookup ? baseLookup.code : null,
      baseTitle: baseLookup ? baseLookup.title : null,
    },
    { headers: NO_STORE },
  );
}
