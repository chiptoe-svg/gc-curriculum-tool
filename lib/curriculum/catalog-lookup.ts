/**
 * Catalog course lookup for the faculty access panel's "Add a course"
 * feature (spec: docs/superpowers/specs/2026-10-07-access-panel-add-course-addendum.md).
 * Reads the app's own `course_catalog_entries` table (filled by
 * scripts/catalog/{sync-catalog-prereqs,sync-catalog-courses}.ts) — never
 * the clemson-advising sqlite file at runtime.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseCatalogEntries } from '@/lib/db/schema';
import { normalizeCode } from '@/lib/auth/authorize';
import { parseCourseCode, composeCourseCode } from '@/lib/courses/parse-course-code';

export interface CatalogLookupResult {
  code: string;
  title: string | null;
  description: string | null;
  credits: string | null;
}

/** The catalog's row for `code` (normalized before querying), or null. */
export async function lookupCatalogCourse(code: string): Promise<CatalogLookupResult | null> {
  const normalized = normalizeCode(code);
  const rows = await db
    .select({
      courseCode: courseCatalogEntries.courseCode,
      title: courseCatalogEntries.title,
      description: courseCatalogEntries.description,
      credits: courseCatalogEntries.credits,
    })
    .from(courseCatalogEntries)
    .where(eq(courseCatalogEntries.courseCode, normalized))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { code: row.courseCode, title: row.title, description: row.description, credits: row.credits };
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Trimmed, 1-120 chars, no control characters — same shape as a grant
 * label (lib/auth/grant-admin.ts), independently defined here since course
 * titles and grant labels are different domains that happen to share a shape. */
export function validateCourseTitle(raw: unknown): { title: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'title must be a string' };
  const title = raw.trim();
  if (title.length < 1 || title.length > 120) return { error: 'title must be 1-120 characters' };
  if (CONTROL_CHARS.test(title)) return { error: 'title must not contain control characters' };
  return { title };
}

/** First digit of the course number ("ENTR 4080" → 4), matching the
 * `courses.level` convention (1-4). null when the code has no parseable number. */
export function levelFromCode(code: string): number | null {
  const { number } = parseCourseCode(code);
  if (number === null) return null;
  return Math.floor(number / 1000);
}

/** The base code with any section suffix stripped ("GC 4900ap" → "GC
 * 4900"), or null when there's no suffix to strip (bare code, or no
 * parseable number) — i.e. null means "no fallback lookup is useful here". */
export function baseCodeOf(code: string): string | null {
  const parsed = parseCourseCode(code);
  if (parsed.number === null || !parsed.suffix) return null;
  return composeCourseCode({ ...parsed, suffix: '' });
}
