// app/api/admin/courses/roster/route.ts
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import {
  bulkCreateCourses,
  createCourse,
  type NewCourseInput,
} from '@/lib/db/courses-queries';

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
// Auth: slug from query string (isValidSlug → 401 on miss).
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
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const mode = body.mode;

  if (mode === 'bulk') {
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    const items = parseCourseLines(text);
    if (items.length === 0) {
      return NextResponse.json({ error: 'no parseable course lines found' }, { status: 400 });
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
    await createCourse({ code, title, level, track });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'mode must be "bulk" or "one"' }, { status: 400 });
}
