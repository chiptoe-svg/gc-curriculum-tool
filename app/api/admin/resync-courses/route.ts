import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { fetchIndexCourseCodes, fetchCourseTabCsv } from '@/lib/sheets/fetchSheet';
import { parseCourseTab } from '@/lib/sheets/parseCourseTab';
import { upsertCourses, recordSyncResult } from '@/lib/db/courses-queries';
import type { ParsedCourse } from '@/lib/sheets/parseCourseTab';

export const maxDuration = 120; // 28 tabs × ~500ms each + parsing

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!sheetId) {
    return NextResponse.json({ error: 'GOOGLE_SHEET_ID not set' }, { status: 500 });
  }

  const errors: string[] = [];
  let codes: string[] = [];
  try {
    codes = await fetchIndexCourseCodes(sheetId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `index fetch failed: ${msg}` }, { status: 502 });
  }

  // Fetch + parse all course tabs in parallel.
  const results = await Promise.allSettled(
    codes.map(async (code): Promise<ParsedCourse> => {
      const csv = await fetchCourseTabCsv(sheetId, code);
      return parseCourseTab(csv);
    })
  );

  const parsed: ParsedCourse[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') parsed.push(r.value);
    else errors.push(`${codes[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  });

  const synced = await upsertCourses(parsed);
  await recordSyncResult(synced, errors);

  return NextResponse.json({
    synced,
    skipped: errors.length,
    errors,
    lastSyncedAt: new Date().toISOString(),
  });
}
