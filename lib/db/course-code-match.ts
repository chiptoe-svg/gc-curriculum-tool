import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';

/** A course code's comparison key: upper case, letters and digits only ("GC  4800", "gc-4800" → "GC4800"). */
export const codeKey = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * The tracked course a typed code names, or null; matched on codeKey on both sides, so a stored "GC4800",
 * "GC-4800" or "GC 4900ap" is found from any spacing or case. (A regex class with no backslash: a `\s` inside the
 * sql tagged template is cooked to a plain "s".)
 */
export async function findCourseByTypedCode(typed: string): Promise<{ code: string } | null> {
  const key = codeKey(typed);
  if (!key) return null;
  const [row] = await db.select({ code: courses.code }).from(courses)
    .where(sql`upper(regexp_replace(${courses.code}, '[^A-Za-z0-9]', '', 'g')) = ${key}`).limit(1);
  return row ?? null;
}
