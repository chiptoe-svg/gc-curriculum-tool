import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { fetchIndexCourseCodes, fetchCourseTabCsv } from '@/lib/sheets/fetchSheet';
import { parseCourseTab } from '@/lib/sheets/parseCourseTab';
import { upsertCourses, recordSyncResult } from '@/lib/db/courses-queries';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!checkAdminAuth(req, { slug })) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    return NextResponse.json({ error: 'GOOGLE_SHEET_ID not configured' }, { status: 500 });
  }

  const codes = await fetchIndexCourseCodes(sheetId);
  const parsed = [];
  const errors: string[] = [];

  for (const code of codes) {
    try {
      const csv = await fetchCourseTabCsv(sheetId, code);
      parsed.push(parseCourseTab(csv));
    } catch (e) {
      errors.push(`${code}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const count = await upsertCourses(parsed);
  await recordSyncResult(count, errors);

  return NextResponse.json({ synced: count, errors, lastSyncedAt: new Date().toISOString() });
}
