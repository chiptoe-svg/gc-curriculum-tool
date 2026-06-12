import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode, upsertCourses } from '@/lib/db/courses-queries';
import { fetchCourseTabCsv } from '@/lib/sheets/fetchSheet';
import { parseCourseTab } from '@/lib/sheets/parseCourseTab';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string }> }

// POST /api/courses/[code]/sync-from-sheet?slug=...
// Re-reads this course's tab from the configured Google Sheet and updates
// the catalog row in place. Returns the updated course so the UI can refresh
// without a full page reload.
//
// The course must have a tab in the sheet matching its code exactly (e.g.,
// "GC 3460"). Specialty Area courses without tabs return 404.
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const existing = await getCourseByCode(courseCode);
  if (!existing) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!sheetId) {
    return NextResponse.json(
      { error: 'GOOGLE_SHEET_ID not configured on the server' },
      { status: 500 },
    );
  }

  let csv: string;
  try {
    csv = await fetchCourseTabCsv(sheetId, courseCode);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The sheet tab is named after the course code. Surface a clear message
    // when it doesn't exist rather than the generic Google error.
    return NextResponse.json(
      { error: `failed to fetch sheet tab for ${courseCode}: ${msg}` },
      { status: 404 },
    );
  }

  let parsed;
  try {
    parsed = parseCourseTab(csv);
  } catch (e) {
    return NextResponse.json(
      { error: `failed to parse sheet tab: ${e instanceof Error ? e.message : String(e)}` },
      { status: 422 },
    );
  }

  // Force the parsed course to use the URL's code, not whatever the sheet
  // tab claims, so we don't accidentally rename a row.
  parsed.code = courseCode;

  // Google returns a non-error (HTTP 200, first tab, or empty content) when a
  // named tab is missing — so emptiness is the reliable signal that this course
  // has no sheet tab.  Refuse to stamp lastSyncedAt with nothing usable.
  const hasSubstance =
    (parsed.description && parsed.description.trim()) ||
    (parsed.learningObjectives && parsed.learningObjectives.length > 0) ||
    (parsed.majorProjects && parsed.majorProjects.length > 0) ||
    (parsed.skillsRequired && parsed.skillsRequired.length > 0);

  if (!hasSubstance) {
    return NextResponse.json(
      { error: `no usable sheet tab for ${courseCode} — nothing was synced (the tab is missing or empty)` },
      { status: 404 },
    );
  }

  await upsertCourses([parsed]);
  const updated = await getCourseByCode(courseCode);
  if (!updated) {
    return NextResponse.json({ error: 'sync ran but course disappeared' }, { status: 500 });
  }

  return NextResponse.json({
    course: {
      code: updated.code,
      title: updated.title,
      description: updated.description,
      prerequisites: updated.prerequisites,
      learningObjectives: updated.learningObjectives,
      majorProjects: updated.majorProjects,
      skillsRequired: updated.skillsRequired,
      lastSyncedAt: updated.lastSyncedAt,
    },
  });
}
