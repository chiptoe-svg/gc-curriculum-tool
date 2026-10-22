/**
 * Paired lecture/lab codes share one wiki page (owner, 2026-10-22: "GC 2071
 * should be bundled with GC 2070"). A link to a paired code is pointed at the
 * parent course's page, keeping what the reader sees: `[[gc-2071|GC 2071 lab]]`
 * → `[[gc-2070|GC 2071 lab]]`, `[[gc-1041]]` → `[[gc-1040|GC 1041]]`.
 * Pairs come from `course_codes`; applied to every generated page before it is
 * committed, whoever wrote it.
 */
import { db } from '@/lib/db/client';
import { courseCodes } from '@/lib/db/schema';

const slugOf = (code: string) => code.trim().toLowerCase().replace(/\s+/g, '-');

export function rewritePairedLinks(content: string, pairedToParent: Map<string, string>): string {
  if (pairedToParent.size === 0) return content;
  return content.replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, (whole, slug: string, label: string | undefined) => {
    const parent = pairedToParent.get(slug.trim());
    if (!parent) return whole;
    return `[[${parent}${label ?? `|${slug.trim().toUpperCase().replace(/-/, ' ')}`}]]`;
  });
}

/** paired-code slug → parent course slug, e.g. gc-2071 → gc-2070. Empty on any read failure. */
export async function loadPairedSlugMap(): Promise<Map<string, string>> {
  try {
    const rows = await db.select({ course: courseCodes.courseCode, paired: courseCodes.pairedCode }).from(courseCodes);
    return new Map(rows.map(r => [slugOf(r.paired), slugOf(r.course)]));
  } catch (err) {
    console.warn(`[wiki-update] paired course codes unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return new Map();
  }
}
