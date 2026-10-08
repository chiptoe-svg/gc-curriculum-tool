// app/api/admin/courses/roster/route.ts
import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { authorizeRequest } from '@/lib/auth/route-auth';
import {
  bulkCreateCourses,
  createCourse,
  type NewCourseInput,
} from '@/lib/db/courses-queries';
import { isHttpUrl } from '@/lib/http/is-http-url';

// ---------------------------------------------------------------------------
// POST /api/admin/courses/roster?slug=<slug>
//
// Two modes:
//   { mode: 'bulk', text: string }
//     Parse lines: each line may be `CODE`, `CODE — Title`, `CODE - Title`,
//     `CODE, Title`, or `CODE\tTitle`. Tolerates leading/trailing whitespace.
//     Returns { created: string[], skipped: string[] }.
//
//   { mode: 'one', code, title, level?, track? }
//     Insert a single course (no-op if code already exists).
//     Returns { ok: true }.
//
// Auth: the request's grant must pass authorize() for this path (the `create`
// capability) — fails closed with no grant (spec 2026-10-08 §4); bulk also
// needs that grant to cover all courses. Plus checkAdminAuth (Bearer
// ADMIN_TOKEN / slug-in-header, or legacy ?slug=) as the second factor.
// ---------------------------------------------------------------------------

/** Light parser: `GC 1234` / `GC1234` / `GC 1234L` etc. */
function parseCourseLines(text: string): NewCourseInput[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Split on em-dash, en-dash, hyphen-space, comma, or tab — whichever
      // comes first after the course code token.
      const m = line.match(/^([A-Z]{2,4}\s*\d{3,4}\w*)\s*(?:[—–\-,\t]\s*(.+))?$/i);
      if (!m || !m[1]) return null;
      const code = m[1].replace(/\s+/, ' ').trim().toUpperCase();
      const title = m[2]?.trim() ?? code;
      return { code, title } satisfies NewCourseInput;
    })
    .filter((x): x is NewCourseInput => x !== null);
}

export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!checkAdminAuth(req, { slug })) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const mode = body.mode;

  // A create grant scoped to fewer than all courses (the create-only role,
  // or a personal create-only link) may add a single course but not
  // bulk-preload. Same outcome as the old role check for both built-in roles.
  if (mode === 'bulk' && !auth.grant.scope.includes('*')) {
    return NextResponse.json({ error: 'create-only role cannot bulk-preload' }, { status: 403 });
  }

  if (mode === 'bulk') {
    const MAX_LINES = 500;
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    const items = parseCourseLines(text);
    if (items.length === 0) {
      return NextResponse.json({ error: 'no parseable course lines found' }, { status: 400 });
    }
    if (items.length > MAX_LINES) {
      return NextResponse.json(
        { error: 'too many courses; max 500 per request' },
        { status: 400 },
      );
    }
    const result = await bulkCreateCourses(items);
    return NextResponse.json(result);
  }

  if (mode === 'one') {
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!code || !title) {
      return NextResponse.json({ error: 'code and title are required' }, { status: 400 });
    }
    const level = typeof body.level === 'number' ? body.level : undefined;
    const track = typeof body.track === 'string' ? body.track : undefined;
    const catalogUrlRaw = typeof body.catalogUrl === 'string' ? body.catalogUrl.trim() : '';
    if (catalogUrlRaw && !isHttpUrl(catalogUrlRaw)) {
      return NextResponse.json({ error: 'catalogUrl must be an http(s) URL' }, { status: 400 });
    }
    const pairedCode = typeof body.pairedCode === 'string' ? body.pairedCode.trim() : '';
    const pairedRole = typeof body.pairedRole === 'string' ? body.pairedRole : '';
    if (pairedCode && !['lecture', 'lab', 'other'].includes(pairedRole)) {
      return NextResponse.json({ error: 'pairedRole must be lecture | lab | other when pairedCode is set' }, { status: 400 });
    }
    await createCourse({
      code, title, level, track, catalogUrl: catalogUrlRaw || null,
      ...(pairedCode ? { pairedCode, pairedRole: pairedRole as 'lecture' | 'lab' | 'other' } : {}),
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'mode must be "bulk" or "one"' }, { status: 400 });
}
